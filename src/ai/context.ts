import type { RepositoryContext } from "../graph/repository-context";

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
}

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

export function buildAiContext(context: RepositoryContext, repository: string): AiRepositoryContext {
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

    return {
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
        symbolChanges
    };
}
