import type { RepositoryContext } from "../graph/repository-context";
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
}

/**
 * Upper bound, in characters, for the serialized AI context. It is a safety
 * boundary for the whole context object; `buildAiContext` keeps the compact
 * impact projection inside it and `AiAnswerService` re-checks the result.
 */
export const MAX_AI_CONTEXT_BYTES = 24000;

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

export function buildAiContext(
    context: RepositoryContext,
    repository: string,
    evidence: RepositorySourceEvidence[] = [],
    impact?: ChangeImpactAnalysisResult,
    fileContent?: string
): AiRepositoryContext {
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

    const commits = context.commits.map((commit) => ({
        sha: commit.sha,
        message: commit.message,
        authorName: commit.authorName,
        authorDate: commit.authorDate
    }));

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
            .slice(0, 10)
        : [];

    const directDependentPaths = targetPath
        ? context.imports
            .filter((edge) => (decodeGraphFileId(edge.to) ?? edge.to) === targetPath)
            .map((edge) => decodeGraphFileId(edge.from) ?? edge.from)
            .filter((p, idx, arr) => arr.indexOf(p) === idx)
            .slice(0, 10)
        : [];

    let cappedContent: string | undefined = undefined;
    let fileTruncated: boolean | undefined = undefined;
    let fileTruncatedLines: number | undefined = undefined;

    if (fileContent) {
        const lines = fileContent.split("\n");
        const totalLines = lines.length;
        const snippetLineCount = Math.min(150, totalLines);
        const snippet = lines.slice(0, snippetLineCount).join("\n");
        const isTruncated = totalLines > 150;
        if (isTruncated) {
            fileTruncated = true;
            fileTruncatedLines = snippetLineCount;
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
                // Shorten line if too long
                const truncatedLine = trimmed.length > 120 ? trimmed.slice(0, 117) + "..." : trimmed;
                outlineEntries.push(`L${lineNum}: ${truncatedLine}`);
            }
        }

        // Outline section: cap outline entries so snippet also fits
        const outlineText = outlineEntries.length > 0 ? `Outline:\n${outlineEntries.join("\n")}` : "";
        const importsText = directImportPaths.length > 0 ? `Direct imports: ${directImportPaths.join(", ")}` : "";
        const dependentsText = directDependentPaths.length > 0 ? `Direct dependents: ${directDependentPaths.join(", ")}` : "";
        const snippetText = `First ${snippetLineCount} lines:\n${snippet}`;

        const otherSections = [importsText, dependentsText, snippetText].filter(Boolean).join("\n\n");
        // Remaining budget for outline from 8000 chars
        const outlineBudget = Math.max(0, 8000 - otherSections.length - 4);
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
        ...(fileContent && directImportPaths.length > 0 ? { directImports: directImportPaths } : {}),
        ...(fileContent && directDependentPaths.length > 0 ? { directDependents: directDependentPaths } : {}),
        ...(evidence.length > 0 ? { evidence } : {}),
        ...(cappedContent !== undefined ? { fileContent: cappedContent } : {}),
        ...(fileTruncated !== undefined ? { fileTruncated } : {}),
        ...(fileTruncatedLines !== undefined ? { fileTruncatedLines } : {})
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
