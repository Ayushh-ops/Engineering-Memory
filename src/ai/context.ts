import type { RepositoryContext } from "../graph/repository-context";
import type { RepositoryGraph } from "../graph/repository-graph";
import type { RepositorySourceEvidence } from "../services/repository-source-evidence-service";
import type { ChangeImpactAnalysisResult } from "../services/change-impact-analysis-service";
import { buildAiImpactContext, type AiImpactContext } from "./impact-context";

export type AiTarget = {
    type: "file" | "symbol" | "commit";
    path?: string;
    symbolType?: "class" | "function" | "method";
    symbolName?: string;
    sha?: string;
};

export interface AiFileContext {
    path: string;
    symbols: Array<{ type: "class" | "function" | "method"; name: string }>;
    imports: string[];
}

export interface AiSymbolContext {
    type: "class" | "function" | "method";
    path: string;
    name: string;
}

export interface AiCommitContext {
    sha: string;
    message: string;
    authorName: string;
    authorDate: string;
}

export interface AiSymbolChangeContext {
    type: "added" | "removed" | "modified";
    symbolType: "class" | "function" | "method";
    name: string;
    path: string;
    sha?: string;
}

export interface AiRiskContext {
    score: number;
    directDependents: number;
    transitiveDependents: number;
    hasTests: boolean;
    commitCount: number;
    ownersCount: number;
    reasons: Array<{ label: string; value: string }>;
}

export interface AiRepositoryContext {
    repository: string;
    target: AiTarget;
    files: AiFileContext[];
    symbols: AiSymbolContext[];
    imports: Array<{ from: string; to: string }>;
    callers: AiSymbolContext[];
    commits: AiCommitContext[];
    symbolChanges: AiSymbolChangeContext[];
    evidence?: RepositorySourceEvidence[];
    impact?: AiImpactContext;
    fileContent?: string;
    fileTruncated?: boolean;
    fileTruncatedLines?: number;
    directImports?: string[];
    directDependents?: string[];
    risk?: AiRiskContext;
    recentCommits?: Array<{ sha: string; message: string; author: string; date: string }>;
    owners?: any;
}

/**
 * Upper bound, in characters, for the serialized AI context. It is a safety
 * boundary for the whole context object; `buildAiContext` keeps the compact
 * impact projection inside it and `AiAnswerService` re-checks the result.
 */
export const MAX_AI_CONTEXT_BYTES = 12000;

export interface BuildAiContextOptions {
    question?: string;
    scope?: "file" | "dependents" | "repo";
    dependentFiles?: Array<{ path: string; content: string }>;
}

export function extractKeywords(question?: string): string[] {
    if (!question) return [];
    const tokens = question.match(/[a-zA-Z_$][a-zA-Z0-9_$]{3,}/g) || [];
    const stopWords = new Set(["what", "does", "this", "file", "with", "from", "that", "have", "here", "explain", "describe", "show", "tell", "which", "when", "where", "about", "code", "karta", "karti", "samjhao"]);
    return Array.from(new Set(tokens.map((t) => t.toLowerCase()))).filter((t) => !stopWords.has(t));
}

/** Reserved for the `"impact"` property wrapper around the compact projection. */
const AI_CONTEXT_IMPACT_WRAPPER_CHARS = 32;

function toTarget(context: RepositoryContext["target"]["request"]): AiTarget {
    if (context.type === "file") {
        return { type: "file", path: context.path };
    }
    if (context.type === "symbol") {
        return {
            type: "symbol",
            path: context.symbol.path,
            symbolType: context.symbol.type,
            symbolName: context.symbol.name
        };
    }
    return { type: "commit", sha: context.sha };
}

function decodeGraphFileId(id: string): string | null {
    if (!id.startsWith("file:")) return null;
    return decodeURIComponent(id.slice("file:".length));
}

export function computeFileRisk(
    filePath: string,
    graph?: RepositoryGraph,
    commits: Array<{ sha: string; authorName?: string; [key: string]: any }> = []
): AiRiskContext {
    const fileId = `file:${encodeURIComponent(filePath)}`;
    const allEdges = graph?.edges || [];
    const allNodes = graph?.nodes || [];

    // 1. Direct dependents (incoming imports or calls to filePath)
    const directSet = new Set<string>();
    for (const edge of allEdges) {
        const toDecoded = decodeGraphFileId(edge.to) ?? edge.to;
        if ((toDecoded === filePath || edge.to === filePath || edge.to === fileId) && (edge.type === "imports" || edge.type === "calls")) {
            const fromDecoded = decodeGraphFileId(edge.from) ?? edge.from;
            directSet.add(fromDecoded);
        }
    }

    // 2. Transitive dependents (reverse BFS excluding target file and direct dependents)
    const visited = new Set<string>([filePath, fileId, ...directSet]);
    const queue = Array.from(directSet);
    const transitiveSet = new Set<string>();

    while (queue.length > 0) {
        const curr = queue.shift()!;
        const currId = `file:${encodeURIComponent(curr)}`;
        for (const edge of allEdges) {
            const toDecoded = decodeGraphFileId(edge.to) ?? edge.to;
            if ((toDecoded === curr || edge.to === curr || edge.to === currId) && (edge.type === "imports" || edge.type === "calls")) {
                const fromDecoded = decodeGraphFileId(edge.from) ?? edge.from;
                if (!visited.has(fromDecoded) && !visited.has(edge.from)) {
                    visited.add(fromDecoded);
                    visited.add(edge.from);
                    transitiveSet.add(fromDecoded);
                    queue.push(fromDecoded);
                }
            }
        }
    }

    const directDependents = directSet.size;
    const transitiveDependents = transitiveSet.size;

    // 3. Test presence
    const isTestPathHelper = (p: string) => /\.(test|spec)(\.[^.]*|$)/.test(p) || /(^|\/)(test|tests|__tests__)\//.test(p);
    const baseName = filePath.split("/").pop()?.replace(/\.[^.]+$/, "") || "";
    let directTests = 0;
    let indirectTests = 0;
    for (const d of directSet) {
        if (isTestPathHelper(d)) directTests++;
    }
    for (const t of transitiveSet) {
        if (isTestPathHelper(t)) indirectTests++;
    }
    const hasConventionTest = allNodes.some((n: any) => {
        if (n.type !== "file") return false;
        const p = n.path || (typeof n.id === "string" ? decodeGraphFileId(n.id) : undefined);
        if (!p) return false;
        if (!isTestPathHelper(p)) return false;
        const testBase = p.split("/").pop()?.replace(/\.(test|spec)(\.[^.]*|$)/, "").replace(/\.[^.]+$/, "") || "";
        return testBase === baseName || p.includes(baseName);
    });
    if (hasConventionTest && directTests === 0 && indirectTests === 0) {
        directTests = 1;
    }
    const totalTests = directTests + indirectTests;
    const hasTests = totalTests > 0;
    const hasNoTests = !hasTests;

    // 4. Commits and owners
    const touchingCommits = commits.filter((c: any) => {
        if (c.files && Array.isArray(c.files)) {
            return c.files.some((f: any) => (f.filename || f.path) === filePath);
        }
        return true;
    });
    const commitCount = touchingCommits.length;
    const ownersCount = new Set(touchingCommits.map((c: any) => c.authorName).filter(Boolean)).size || (commitCount > 0 ? 1 : 0);
    const totalCommits = Math.max(1, commits.length);
    const churnPercent = Math.min(100, Math.round((commitCount / totalCommits) * 100));

    let rawScore = 4 * directDependents + 2 * transitiveDependents + 0.25 * churnPercent + (hasNoTests ? 10 : 0);
    if (directDependents === 0 && transitiveDependents === 0) {
        rawScore = Math.min(15, rawScore);
    }
    const score = Math.min(100, Math.max(0, Math.round(rawScore)));

    const testCoverageText = hasNoTests
        ? "No test covers this file"
        : directTests === 0
            ? `Only indirect tests cover it (${indirectTests})`
            : `Covered by ${totalTests} test${totalTests === 1 ? "" : "s"}`;

    const reasons: Array<{ label: string; value: string }> = [
        { label: "Direct dependents", value: `${directDependents} file${directDependents === 1 ? "" : "s"}` },
        { label: "Transitive dependents", value: `${transitiveDependents} file${transitiveDependents === 1 ? "" : "s"}` },
        { label: "Commit churn", value: `${commitCount} commit${commitCount === 1 ? "" : "s"} (${churnPercent}%)` },
        { label: "Owners count", value: `${ownersCount} owner${ownersCount === 1 ? "" : "s"}` },
        { label: "Test coverage", value: testCoverageText }
    ];

    return {
        score,
        directDependents,
        transitiveDependents,
        hasTests,
        commitCount,
        ownersCount,
        reasons
    };
}

export function buildAiContext(
    context: RepositoryContext,
    repository: string,
    evidence: RepositorySourceEvidence[] = [],
    impact?: ChangeImpactAnalysisResult,
    fileContent?: string,
    graph?: RepositoryGraph,
    providedRisk?: any,
    providedDependents?: string[],
    recentCommits?: Array<{ sha: string; message: string; author?: string; authorName?: string; date?: string; authorDate?: string }>,
    owners?: any,
    options?: BuildAiContextOptions
): AiRepositoryContext {
    const isRepoScope = options?.scope === "repo";
    const files = context.files.map((file) => {
        const fileSymbols = context.symbols.filter((symbol) => symbol.path === file.path);
        const imports = context.imports
            .filter((edge) => edge.from === file.id)
            .map((edge) => edge.to)
            .map((id) => decodeGraphFileId(id))
            .filter((value): value is string => value !== null);

        return {
            path: file.path,
            symbols: fileSymbols.map((symbol) => ({
                type: symbol.type,
                name: symbol.name
            })),
            imports
        };
    });

    const symbols = context.symbols.map((symbol) => ({
        type: symbol.type,
        path: symbol.path,
        name: symbol.name
    }));

    const callers = context.callers.map((symbol) => ({
        type: symbol.type,
        path: symbol.path,
        name: symbol.name
    }));

    const normalizedRecentCommits = recentCommits && recentCommits.length > 0
        ? recentCommits.slice(0, 5).map((commit) => ({
            sha: commit.sha ? commit.sha.substring(0, 7) : "",
            message: commit.message || "",
            author: commit.authorName || commit.author || "Author",
            date: commit.authorDate || commit.date || ""
        }))
        : undefined;

    const rawCommits = (context.commits.length > 0)
        ? context.commits.map((commit) => ({
            sha: commit.sha,
            message: commit.message,
            authorName: commit.authorName,
            authorDate: commit.authorDate
        }))
        : (normalizedRecentCommits
            ? normalizedRecentCommits.map((c) => ({
                sha: c.sha,
                message: c.message,
                authorName: c.author,
                authorDate: c.date
            }))
            : []);
    const commits = rawCommits.slice(0, 5);

    const symbolChanges = context.symbolChanges.map((change) => ({
        type: change.changeType,
        symbolType: change.symbolType,
        name: change.name,
        path: change.path,
        sha: change.id.split(":")[1] ?? undefined
    }));

    const targetPath = context.target.request.type === "file"
        ? context.target.request.path
        : context.target.request.type === "symbol"
            ? context.target.request.symbol.path
            : undefined;

    const directImportPaths = targetPath
        ? context.imports
            .filter((edge) => (decodeGraphFileId(edge.from) ?? edge.from) === targetPath)
            .map((edge) => decodeGraphFileId(edge.to) ?? edge.to)
            .filter((p, idx, arr) => arr.indexOf(p) === idx)
            .slice(0, 15)
        : [];

    const directDependentPaths = targetPath
        ? context.imports
            .filter((edge) => (decodeGraphFileId(edge.to) ?? edge.to) === targetPath)
            .map((edge) => decodeGraphFileId(edge.from) ?? edge.from)
            .filter((p, idx, arr) => arr.indexOf(p) === idx)
            .slice(0, 15)
        : [];

    let cappedContent: string | undefined = undefined;
    let fileTruncated: boolean | undefined = undefined;
    let fileTruncatedLines: number | undefined = undefined;

    if (fileContent && !isRepoScope) {
        const lines = fileContent.split("\n");
        const totalLines = lines.length;
        const snippetLineCount = Math.min(150, totalLines);
        const prefixedSnippet = lines.slice(0, snippetLineCount).map((l, idx) => `L${idx + 1}: ${l}`).join("\n");
        let snippetText = `First ${snippetLineCount} lines:\n${prefixedSnippet}`;
        const isTruncated = totalLines > 150;
        if (isTruncated) {
            fileTruncated = true;
            fileTruncatedLines = snippetLineCount;
        }

        if (options?.question) {
            const keywords = extractKeywords(options.question);
            if (keywords.length > 0) {
                const matchedRanges: Array<[number, number]> = [];
                for (let i = 0; i < lines.length; i++) {
                    const lineLower = lines[i].toLowerCase();
                    if (keywords.some((kw) => lineLower.includes(kw))) {
                        matchedRanges.push([Math.max(0, i - 12), Math.min(lines.length - 1, i + 12)]);
                    }
                }
                if (matchedRanges.length > 0) {
                    matchedRanges.sort((a, b) => a[0] - b[0]);
                    const merged: Array<[number, number]> = [];
                    for (const range of matchedRanges) {
                        if (merged.length === 0) {
                            merged.push(range);
                        } else {
                            const last = merged[merged.length - 1];
                            if (range[0] <= last[1] + 1) {
                                last[1] = Math.max(last[1], range[1]);
                            } else {
                                merged.push(range);
                            }
                        }
                    }
                    let linesCovered = merged.reduce((acc, [start, end]) => acc + (end - start + 1), 0);
                    if (linesCovered < 100) {
                        merged.unshift([0, Math.min(lines.length - 1, 99)]);
                        merged.sort((a, b) => a[0] - b[0]);
                        const remerged: Array<[number, number]> = [];
                        for (const range of merged) {
                            if (remerged.length === 0) {
                                remerged.push(range);
                            } else {
                                const last = remerged[remerged.length - 1];
                                if (range[0] <= last[1] + 1) {
                                    last[1] = Math.max(last[1], range[1]);
                                } else {
                                    remerged.push(range);
                                }
                            }
                        }
                        merged.length = 0;
                        merged.push(...remerged);
                    }
                    const chunks = merged.map(([start, end]) => {
                        const block: string[] = [];
                        for (let idx = start; idx <= end; idx++) {
                            block.push(`L${idx + 1}: ${lines[idx]}`);
                        }
                        return block.join("\n");
                    });
                    snippetText = `Focused lines (±12 window around matches):\n${chunks.join("\n\n--- ... ---\n\n")}`;
                }
            }
        }

        // Outline: imports, exported symbols and function signatures with line numbers
        const outlineEntries: string[] = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNum = i + 1;
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
                continue;
            }
            if (
                trimmed.startsWith("import ") ||
                trimmed.startsWith("export ") ||
                trimmed.startsWith("function ") ||
                trimmed.startsWith("async function ") ||
                trimmed.startsWith("class ") ||
                trimmed.startsWith("interface ") ||
                trimmed.startsWith("type ") ||
                /^(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/.test(trimmed) ||
                /^(?:public|private|protected|static|async)?\s*(?:function\s+)?\w+\s*\([^)]*\)\s*(?::\s*[^;{]+)?\s*[{;]/.test(trimmed)
            ) {
                const truncatedLine = trimmed.length > 120 ? trimmed.slice(0, 117) + "..." : trimmed;
                outlineEntries.push(`L${lineNum}: ${truncatedLine}`);
            }
        }

        const outlineText = outlineEntries.length > 0 ? `Outline:\n${outlineEntries.join("\n")}` : "";
        const importsText = directImportPaths.length > 0 ? `Direct imports: ${directImportPaths.join(", ")}` : "";
        const dependentsText = directDependentPaths.length > 0 ? `Direct dependents: ${directDependentPaths.join(", ")}` : "";

        if (snippetText.length > 6000) {
            snippetText = snippetText.slice(0, 6000);
            fileTruncated = true;
        }

        const otherSections = [importsText, dependentsText, snippetText].filter(Boolean).join("\n\n");
        const outlineBudget = Math.max(1500, 8000 - otherSections.length - 4);
        const cappedOutline = outlineText.length > outlineBudget ? outlineText.slice(0, outlineBudget) : outlineText;

        const sections: string[] = [];
        if (cappedOutline) sections.push(cappedOutline);
        if (importsText) sections.push(importsText);
        if (dependentsText) sections.push(dependentsText);
        sections.push(snippetText);

        let assembled = sections.join("\n\n");
        if (assembled.length > 8000) {
            assembled = assembled.slice(0, 8000);
            fileTruncated = true;
            fileTruncatedLines = fileTruncatedLines ?? snippetLineCount;
        }
        cappedContent = assembled;
    }

    let risk: AiRiskContext | undefined = undefined;
    if (providedRisk && typeof providedRisk === "object") {
        const score = typeof providedRisk.score === "number" ? providedRisk.score : 0;
        const directDependents = typeof providedRisk.directDependents === "number"
            ? providedRisk.directDependents
            : (providedDependents ? providedDependents.length : 0);
        const transitiveDependents = typeof providedRisk.transitiveDependents === "number"
            ? providedRisk.transitiveDependents
            : 0;
        const hasTests = Boolean(providedRisk.hasTests ?? (providedRisk.hasNoTests === false));
        const commitCount = typeof providedRisk.commitCount === "number"
            ? providedRisk.commitCount
            : (recentCommits ? recentCommits.length : 0);
        const ownersCount = typeof providedRisk.ownersCount === "number"
            ? providedRisk.ownersCount
            : (owners?.owners ? owners.owners.length : (Array.isArray(owners) ? owners.length : 0));
        const reasons = Array.isArray(providedRisk.reasons) ? providedRisk.reasons : [];
        risk = {
            score,
            directDependents,
            transitiveDependents,
            hasTests,
            commitCount,
            ownersCount,
            reasons
        };
    } else if (targetPath) {
        risk = computeFileRisk(targetPath, graph, context.commits);
    }

    const effectiveDirectDependents = (providedDependents && providedDependents.length > 0)
        ? providedDependents.slice(0, 15)
        : directDependentPaths.slice(0, 15);

    const cappedOwners = owners
        ? (Array.isArray(owners)
            ? owners.slice(0, 3)
            : (Array.isArray(owners.owners)
                ? { ...owners, owners: owners.owners.slice(0, 3) }
                : owners))
        : undefined;

    const dependentsSnippets = (options?.scope === "dependents" && options?.dependentFiles)
        ? options.dependentFiles.slice(0, 3).map((dep) => {
            const depLines = dep.content.split("\n").slice(0, 40).map((l, idx) => `L${idx + 1}: ${l}`).join("\n");
            return { path: dep.path, snippet: depLines };
        })
        : undefined;

    const repoSummary = isRepoScope
        ? {
            fileCount: files.length,
            symbolCount: symbols.length,
            topRiskFiles: files.slice(0, 5).map((f) => ({ path: f.path, score: (risk && f.path === targetPath ? risk.score : 0) })),
            health: "healthy"
        }
        : undefined;

    const base: AiRepositoryContext = {
        repository,
        target: toTarget(context.target.request),
        files,
        symbols,
        imports: context.imports
            .map((edge) => ({
                from: decodeGraphFileId(edge.from) ?? edge.from,
                to: decodeGraphFileId(edge.to) ?? edge.to
            }))
            .filter((edge) => edge.from.startsWith("src/") || edge.from.startsWith("lib/") || edge.from.startsWith("test/") || edge.from.startsWith("packages/") || edge.to.startsWith("src/") || edge.to.startsWith("lib/") || edge.to.startsWith("test/") || edge.to.startsWith("packages/")),
        callers,
        commits,
        symbolChanges,
        ...(risk ? { risk } : {}),
        ...(effectiveDirectDependents.length > 0 ? { directDependents: effectiveDirectDependents } : {}),
        ...(normalizedRecentCommits ? { recentCommits: normalizedRecentCommits } : {}),
        ...(cappedOwners ? { owners: cappedOwners } : {}),
        ...(!isRepoScope && fileContent && directImportPaths.length > 0 ? { directImports: directImportPaths } : {}),
        ...(!isRepoScope && evidence.length > 0 ? { evidence } : {}),
        ...(cappedContent !== undefined ? { fileContent: cappedContent } : {}),
        ...(fileTruncated !== undefined ? { fileTruncated } : {}),
        ...(fileTruncatedLines !== undefined ? { fileTruncatedLines } : {}),
        ...(dependentsSnippets ? { dependentsSnippets } : {}),
        ...(repoSummary ? { repoSummary } : {})
    };

    if (!impact) return base;

    const impactBudgetChars = Math.max(
        0,
        MAX_AI_CONTEXT_BYTES - JSON.stringify(base).length - AI_CONTEXT_IMPACT_WRAPPER_CHARS
    );

    return {
        ...base,
        impact: buildAiImpactContext(impact, { budgetChars: impactBudgetChars })
    };
}
