import type {
    CommitGraphNode,
    FileGraphNode,
    GraphEdge,
    GraphNode,
    RepositoryGraph,
    SymbolChangeGraphNode
} from "./repository-graph";
import {
    queryRepositoryGraph,
    type GraphSymbolNode,
    type RepositoryGraphQuery
} from "./repository-query";

type ContextSymbolTarget = {
    type: "class" | "function" | "method";
    path: string;
    name: string;
};

export type RepositoryContextTarget =
    | { type: "file"; path: string }
    | { type: "symbol"; symbol: ContextSymbolTarget }
    | { type: "commit"; sha: string };

export interface RepositoryContextLimits {
    maxFiles: number;
    maxSymbols: number;
    maxCallers: number;
    maxCommits: number;
    maxSymbolChanges: number;
}

export interface RepositoryContextRequest {
    target: RepositoryContextTarget;
    limits?: Partial<RepositoryContextLimits>;
}

export const defaultRepositoryContextLimits: RepositoryContextLimits = {
    maxFiles: 8,
    maxSymbols: 40,
    maxCallers: 20,
    maxCommits: 10,
    maxSymbolChanges: 40
};

export const maxRepositoryContextLimits: RepositoryContextLimits = {
    maxFiles: 50,
    maxSymbols: 200,
    maxCallers: 100,
    maxCommits: 50,
    maxSymbolChanges: 200
};

export interface RepositoryContext {
    target: {
        request: RepositoryContextTarget;
        node: GraphNode;
    };
    files: FileGraphNode[];
    symbols: GraphSymbolNode[];
    imports: GraphEdge[];
    callers: GraphSymbolNode[];
    commits: CommitGraphNode[];
    symbolChanges: SymbolChangeGraphNode[];
}

export type RepositoryContextResult =
    | { status: "ok"; context: RepositoryContext }
    | { status: "missing"; target: RepositoryContextTarget }
    | { status: "ambiguous"; target: RepositoryContextTarget };

function unique<T extends { id: string }>(items: T[]): T[] {
    const seen = new Set<string>();
    return items.filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
    });
}

function nodesByIds<T extends GraphNode>(graph: RepositoryGraph, ids: Set<string>): T[] {
    return unique(graph.nodes.filter((node): node is T => ids.has(node.id)));
}

function limited<T>(items: T[], limit: number): T[] {
    return items.slice(0, limit);
}

function matchingTargetNodes(graph: RepositoryGraph, target: RepositoryContextTarget): GraphNode[] {
    if (target.type === "file") {
        return graph.nodes.filter((node): node is FileGraphNode =>
            node.type === "file" && node.path === target.path
        );
    }
    if (target.type === "commit") {
        return graph.nodes.filter((node): node is CommitGraphNode =>
            node.type === "commit" && node.sha === target.sha
        );
    }
    return graph.nodes.filter((node): node is GraphSymbolNode =>
        (node.type === "class" || node.type === "function" || node.type === "method") &&
        node.type === target.symbol.type && node.path === target.symbol.path && node.name === target.symbol.name
    );
}

function directChangedCommits(graph: RepositoryGraph, fileIds: Set<string>): CommitGraphNode[] {
    const commitIds = new Set<string>();
    for (const edge of graph.edges) {
        if (edge.type === "changed" && fileIds.has(edge.to)) commitIds.add(edge.from);
    }
    return nodesByIds<CommitGraphNode>(graph, commitIds).filter((node) => node.type === "commit");
}

function importsForFiles(graph: RepositoryGraph, fileIds: Set<string>): GraphEdge[] {
    return graph.edges.filter((edge) =>
        edge.type === "imports" && fileIds.has(edge.from) && fileIds.has(edge.to)
    );
}

function changesForCommits(graph: RepositoryGraph, commits: CommitGraphNode[]): SymbolChangeGraphNode[] {
    const changes = new Map<string, SymbolChangeGraphNode>();
    for (const commit of commits) {
        for (const change of queryRepositoryGraph(graph, {
            type: "commit-symbol-changes",
            sha: commit.sha
        }).symbolChanges) {
            changes.set(change.id, change);
        }
    }
    return nodesByIds<SymbolChangeGraphNode>(graph, new Set(changes.keys()));
}

function symbolsInGraphOrder(graph: RepositoryGraph, symbols: GraphSymbolNode[]): GraphSymbolNode[] {
    return nodesByIds<GraphSymbolNode>(graph, new Set(symbols.map((symbol) => symbol.id)));
}

function normalizeLimits(request: RepositoryContextRequest): RepositoryContextLimits | null {
    const limits = { ...defaultRepositoryContextLimits, ...request.limits };
    for (const key of Object.keys(defaultRepositoryContextLimits) as Array<keyof RepositoryContextLimits>) {
        if (!Number.isInteger(limits[key]) || limits[key] < 1 || limits[key] > maxRepositoryContextLimits[key]) {
            return null;
        }
    }
    return limits;
}

export function isRepositoryContextRequest(value: unknown): value is RepositoryContextRequest {
    if (!value || typeof value !== "object") return false;
    const request = value as Record<string, unknown>;
    const target = request.target;
    if (!target || typeof target !== "object") return false;
    const candidate = target as Record<string, unknown>;
    const symbol = candidate.symbol as Record<string, unknown> | undefined;
    const validTarget = candidate.type === "file"
        ? typeof candidate.path === "string" && candidate.path.length > 0
        : candidate.type === "commit"
            ? typeof candidate.sha === "string" && candidate.sha.length > 0
            : candidate.type === "symbol" && !!symbol &&
                ["class", "function", "method"].includes(String(symbol.type)) &&
                typeof symbol.path === "string" && symbol.path.length > 0 &&
                typeof symbol.name === "string" && symbol.name.length > 0;
    if (!validTarget) return false;
    if (request.limits !== undefined &&
        (!request.limits || typeof request.limits !== "object" || Array.isArray(request.limits))) {
        return false;
    }
    return request.limits === undefined || normalizeLimits(request as unknown as RepositoryContextRequest) !== null;
}

export function assembleRepositoryContext(
    graph: RepositoryGraph,
    request: RepositoryContextRequest
): RepositoryContextResult {
    const limits = normalizeLimits(request);
    if (!limits) throw new Error("Invalid repository context limits.");

    const matches = matchingTargetNodes(graph, request.target);
    if (matches.length === 0) return { status: "missing", target: request.target };
    if (matches.length > 1) return { status: "ambiguous", target: request.target };

    const targetNode = matches[0];
    let files: FileGraphNode[] = [];
    let symbols: GraphSymbolNode[] = [];
    let callers: GraphSymbolNode[] = [];
    let commits: CommitGraphNode[] = [];
    let symbolChanges: SymbolChangeGraphNode[] = [];

    if (request.target.type === "file") {
        const targetPath = request.target.path;
        files = [targetNode as FileGraphNode, ...queryRepositoryGraph(graph, {
            type: "file-imports",
            path: targetPath
        }).files];
        symbols = limited(
            queryRepositoryGraph(graph, { type: "file-symbols", path: targetPath }).symbols,
            limits.maxSymbols
        );
        for (const symbol of symbols) {
            callers.push(...queryRepositoryGraph(graph, {
                type: "symbol-callers",
                symbol: { type: symbol.type, path: symbol.path, name: symbol.name }
            }).symbols);
        }
        commits = directChangedCommits(graph, new Set([targetNode.id]));
        symbolChanges = changesForCommits(graph, commits).filter((change) => change.path === targetPath);
    } else if (request.target.type === "symbol") {
        const symbol = targetNode as GraphSymbolNode;
        files = graph.nodes.filter((node): node is FileGraphNode =>
            node.type === "file" && node.path === symbol.path
        );
        symbols = [symbol];
        callers = queryRepositoryGraph(graph, {
            type: "symbol-callers",
            symbol: request.target.symbol
        }).symbols;
        commits = directChangedCommits(graph, new Set(files.map((file) => file.id)));
        symbolChanges = changesForCommits(graph, commits).filter((change) => change.path === symbol.path);
    } else {
        commits = [targetNode as CommitGraphNode];
        const result = queryRepositoryGraph(graph, { type: "commit-changes", sha: request.target.sha });
        files = result.files;
        symbolChanges = result.symbolChanges;
        symbols = queryRepositoryGraph(graph, { type: "affected-symbols", sha: request.target.sha }).symbols;
    }

    files = limited(unique(files), limits.maxFiles);
    symbols = limited(unique(symbols), limits.maxSymbols);
    callers = limited(symbolsInGraphOrder(graph, callers), limits.maxCallers);
    commits = limited(unique(commits), limits.maxCommits);
    symbolChanges = limited(unique(symbolChanges), limits.maxSymbolChanges);
    const includedFileIds = new Set(files.map((file) => file.id));

    return {
        status: "ok",
        context: {
            target: { request: request.target, node: targetNode },
            files,
            symbols,
            imports: importsForFiles(graph, includedFileIds),
            callers,
            commits,
            symbolChanges
        }
    };
}