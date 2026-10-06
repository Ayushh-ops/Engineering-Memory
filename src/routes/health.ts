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

function isTestPath(path: string): boolean {
    const normalized = path.replace(/\\/g, "/");
    const parts = normalized.split("/");
    const fileName = parts[parts.length - 1];
    const hasTestDir = parts.slice(0, -1).some((p) => p === "test" || p === "tests" || p === "__tests__");
    const matchesPattern = /\.(test|spec)\.[^.]+$/.test(fileName);
    return hasTestDir || matchesPattern;
}

function isConfigPath(path: string): boolean {
    const normalized = path.replace(/\\/g, "/").toLowerCase();
    const fileName = normalized.split("/").pop() || "";
    if (fileName.includes(".config.") || fileName.startsWith(".eslintrc") || fileName.startsWith("eslint.config.")) return true;
    if (fileName.includes("vite") && fileName.includes("config")) return true;
    if (fileName.includes("postcss") && fileName.includes("config")) return true;
    if (fileName.includes("tailwind") && fileName.includes("config")) return true;
    if (fileName.includes("tsconfig") || fileName.includes("package.json") || fileName.includes("package-lock.json")) return true;
    if (fileName.endsWith(".lock") || fileName === "yarn.lock" || fileName === "pnpm-lock.yaml") return true;
    if (/\.(json|yaml|yml|toml|ini|env|config)$/.test(fileName)) return true;
    return false;
}

function isEntryPath(path: string): boolean {
    const normalized = path.replace(/\\/g, "/").toLowerCase();
    const fileName = normalized.split("/").pop() || "";
    const baseName = fileName.replace(/\.[^.]+$/, "");
    return ["main", "index", "app", "server"].includes(baseName);
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

    // (b) Unused files: no dependents (inDegree === 0), excluding entry files, test files, config files
    const unusedFiles: string[] = [];
    for (const f of fileNodes) {
        const depCount = inDegree.get(f.path) || 0;
        if (depCount === 0) {
            if (isEntryPath(f.path)) continue;
            if (isTestPath(f.path)) continue;
            if (isConfigPath(f.path)) continue;
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