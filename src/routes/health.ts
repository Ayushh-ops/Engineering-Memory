import { Router, Request, Response } from "express";
import { RepositoryGraph } from "../graph/repository-graph";
import { isRepositoryGraph } from "../graph/repository-query";

const router = Router();

router.get("/health", (req: Request, res: Response) => {
    res.status(200).json({
        status: "ok",
        timestamp: new Date().toISOString()
    });
});

export interface HealthSummaryResult {
    circularImports: string[][];
    unusedFiles: string[];
    godFiles: Array<{ path: string; importCount: number }>;
}

const SOURCE_EXTENSIONS = new Set([
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".go", ".rs", ".java", ".c", ".cpp", ".cc", ".cxx", ".h", ".hpp",
    ".cs", ".rb", ".php", ".swift", ".kt", ".scala"
]);

function isSourceFile(path: string): boolean {
    const extMatch = path.match(/\.([a-zA-Z0-9]+)$/);
    if (!extMatch) return false;
    return SOURCE_EXTENSIONS.has("." + extMatch[1].toLowerCase());
}

function isTestPath(path: string): boolean {
    const normalized = path.replace(/\\/g, "/").toLowerCase();
    const parts = normalized.split("/");
    const fileName = parts[parts.length - 1];
    const hasTestDir = parts.slice(0, -1).some((p) => p === "test" || p === "tests" || p === "__tests__");
    const matchesPattern = /\.(test|spec)\.[^.]+$/.test(fileName) || fileName.startsWith("test_") || fileName.endsWith("_test.py") || fileName.endsWith("_test.go");
    return hasTestDir || matchesPattern;
}

function isConfigPath(path: string): boolean {
    const normalized = path.replace(/\\/g, "/").toLowerCase();
    const fileName = normalized.split("/").pop() || "";
    if (fileName.includes(".config.") || /\.config\.[^.]+$/.test(fileName)) return true;
    if (fileName.startsWith(".eslintrc") || fileName.includes("eslint")) return true;
    if (fileName.includes("vite")) return true;
    if (fileName.includes("postcss")) return true;
    if (fileName.includes("tailwind")) return true;
    if (fileName.includes("tsconfig") || fileName.includes("package.json") || fileName.includes("package-lock.json")) return true;
    if (fileName.endsWith(".lock") || fileName === "yarn.lock" || fileName === "pnpm-lock.yaml") return true;
    if (/\.(json|yaml|yml|toml|ini|env|config)$/.test(fileName)) return true;
    return false;
}

function isDocPath(path: string): boolean {
    const normalized = path.replace(/\\/g, "/").toLowerCase();
    const parts = normalized.split("/");
    const fileName = parts[parts.length - 1];
    if (parts.some((p) => p === "docs" || p === "doc" || p === "documentation")) return true;
    if (/\.(md|markdown|rst|txt|doc|docx|pdf)$/.test(fileName)) return true;
    return false;
}

function isExcludedFrameworkOrMigration(path: string): boolean {
    const normalized = path.replace(/\\/g, "/");
    const lower = normalized.toLowerCase();
    const parts = lower.split("/");
    const fileName = parts[parts.length - 1];

    // Exclude migrations/**
    if (parts.includes("migrations")) return true;

    // Exclude management/commands
    if (parts.includes("management") || parts.includes("commands")) return true;

    // Exclude admin.py, apps.py, models.py, views.py, serializers.py, urls.py, settings.py, __init__.py, wsgi.py, asgi.py, manage.py
    const djangoExcluded = [
        "admin.py", "apps.py", "models.py", "views.py", "serializers.py",
        "urls.py", "settings.py", "__init__.py", "wsgi.py", "asgi.py", "manage.py"
    ];
    if (djangoExcluded.includes(fileName)) return true;

    return false;
}

function isEntryPath(path: string): boolean {
    const normalized = path.replace(/\\/g, "/");
    const fileName = normalized.split("/").pop() || "";
    const lower = fileName.toLowerCase();
    const baseName = lower.replace(/\.[^.]+$/, "");

    // Python entry / framework files
    if (["__init__.py", "settings.py", "urls.py", "wsgi.py", "asgi.py", "manage.py"].includes(lower)) {
        return true;
    }
    // main.*, index.*, app.* (including App.*), server.*
    if (["main", "index", "app", "server"].includes(baseName)) {
        return true;
    }
    return false;
}

export function computeGraphHealth(graph: RepositoryGraph): HealthSummaryResult {
    const fileNodes = graph.nodes.filter((n) => n.type === "file");
    const fileIdToPath = new Map<string, string>();
    for (const f of fileNodes) {
        fileIdToPath.set(f.id, f.path);
    }

    // Build adjacency list for imports between file nodes
    const adj = new Map<string, Set<string>>();
    const inDegree = new Map<string, number>();
    const outDegree = new Map<string, number>();

    for (const f of fileNodes) {
        adj.set(f.path, new Set());
        inDegree.set(f.path, 0);
        outDegree.set(f.path, 0);
    }

    for (const edge of graph.edges) {
        if (edge.type !== "imports") continue;
        const fromPath = fileIdToPath.get(edge.from);
        const toPath = fileIdToPath.get(edge.to);
        if (fromPath && toPath && fromPath !== toPath) {
            const targets = adj.get(fromPath)!;
            if (!targets.has(toPath)) {
                targets.add(toPath);
                outDegree.set(fromPath, (outDegree.get(fromPath) || 0) + 1);
                inDegree.set(toPath, (inDegree.get(toPath) || 0) + 1);
            }
        }
    }

    // (a) Circular imports (elementary cycles, max 20)
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const stack: string[] = [];
    const seenCycleSignatures = new Set<string>();

    const dfs = (curr: string) => {
        if (cycles.length >= 20) return;
        visited.add(curr);
        inStack.add(curr);
        stack.push(curr);

        const neighbors = adj.get(curr) ? Array.from(adj.get(curr)!) : [];
        for (const next of neighbors) {
            if (cycles.length >= 20) break;
            if (!visited.has(next)) {
                dfs(next);
            } else if (inStack.has(next)) {
                // Found cycle from 'next' to end of stack
                const cycleStartIndex = stack.indexOf(next);
                if (cycleStartIndex !== -1) {
                    const cycle = stack.slice(cycleStartIndex);
                    // Canonical cycle signature: rotate so smallest file name is first
                    let minIdx = 0;
                    for (let i = 1; i < cycle.length; i++) {
                        if (cycle[i].localeCompare(cycle[minIdx]) < 0) {
                            minIdx = i;
                        }
                    }
                    const canonical = [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)];
                    const sig = canonical.join(" -> ");
                    if (!seenCycleSignatures.has(sig)) {
                        seenCycleSignatures.add(sig);
                        cycles.push(canonical);
                    }
                }
            }
        }

        stack.pop();
        inStack.delete(curr);
    };

    for (const f of fileNodes) {
        if (!visited.has(f.path)) {
            dfs(f.path);
        }
    }

    // (b) Unused files: only source files not imported anywhere, excluding entry files, test files, config files, framework/migrations, and docs
    const unusedFiles: string[] = [];
    for (const f of fileNodes) {
        const depCount = inDegree.get(f.path) || 0;
        if (depCount === 0) {
            if (!isSourceFile(f.path)) continue;
            if (isEntryPath(f.path)) continue;
            if (isTestPath(f.path)) continue;
            if (isConfigPath(f.path)) continue;
            if (isDocPath(f.path)) continue;
            if (isExcludedFrameworkOrMigration(f.path)) continue;
            unusedFiles.push(f.path);
        }
    }
    unusedFiles.sort((a, b) => a.localeCompare(b));

    // (c) God files: top 10 by import count (outDegree), only if above 15
    const godFiles: Array<{ path: string; importCount: number }> = [];
    for (const f of fileNodes) {
        const impCount = outDegree.get(f.path) || 0;
        if (impCount > 15) {
            godFiles.push({ path: f.path, importCount: impCount });
        }
    }
    godFiles.sort((a, b) => b.importCount - a.importCount || a.path.localeCompare(b.path));
    const topGodFiles = godFiles.slice(0, 10);

    return {
        circularImports: cycles.slice(0, 20),
        unusedFiles,
        godFiles: topGodFiles
    };
}

const handleHealthSummary = (req: Request, res: Response) => {
    let graph: RepositoryGraph | undefined;
    if (req.body && req.body.graph) {
        graph = req.body.graph;
    } else if (req.query && typeof req.query.graph === "string") {
        try {
            graph = JSON.parse(req.query.graph);
        } catch {
            return res.status(400).json({ error: "Invalid JSON in graph query parameter." });
        }
    }

    if (!graph || !isRepositoryGraph(graph)) {
        return res.status(400).json({ error: "A valid graph is required." });
    }

    const summary = computeGraphHealth(graph);
    return res.status(200).json(summary);
};

router.get("/health/summary", handleHealthSummary);
router.post("/health/summary", handleHealthSummary);
router.get("/repositories/graph/health", handleHealthSummary);
router.post("/repositories/graph/health", handleHealthSummary);

export default router;