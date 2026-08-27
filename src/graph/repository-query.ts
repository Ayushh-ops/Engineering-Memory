import type {
    ClassGraphNode,
    CommitGraphNode,
    FileGraphNode,
    FunctionGraphNode,
    GraphNode,
    MethodGraphNode,
    RepositoryGraph,
    SymbolChangeGraphNode
} from "./repository-graph";

export type GraphSymbolNode = ClassGraphNode | FunctionGraphNode | MethodGraphNode;

export type RepositoryGraphQuery =
    | { type: "related-files"; path: string }
    | { type: "file-symbols"; path: string }
    | { type: "file-imports"; path: string }
    | {
        type: "symbol-callers";
        symbol: {
            type: "class" | "function" | "method";
            path: string;
            name: string;
        };
    }
    | { type: "commit-changes"; sha: string }
    | { type: "commit-symbol-changes"; sha: string }
    | { type: "affected-symbols"; sha: string };

export interface RepositoryGraphQueryResult {
    files: FileGraphNode[];
    symbols: GraphSymbolNode[];
    commits: CommitGraphNode[];
    symbolChanges: SymbolChangeGraphNode[];
}

const emptyResult = (): RepositoryGraphQueryResult => ({
    files: [],
    symbols: [],
    commits: [],
    symbolChanges: []
});

function uniqueInGraphOrder<T extends GraphNode>(nodes: T[]): T[] {
    const seen = new Set<string>();
    return nodes.filter((node) => {
        if (seen.has(node.id)) return false;
        seen.add(node.id);
        return true;
    });
}

function nodesByIds<T extends GraphNode>(nodes: T[], ids: Set<string>): T[] {
    return uniqueInGraphOrder(nodes.filter((node) => ids.has(node.id)));
}

function fileNodes(graph: RepositoryGraph, path: string): FileGraphNode[] {
    return uniqueInGraphOrder(graph.nodes.filter(
        (node): node is FileGraphNode => node.type === "file" && node.path === path
    ));
}

function symbolNodes(graph: RepositoryGraph, path: string): GraphSymbolNode[] {
    return uniqueInGraphOrder(graph.nodes.filter(
        (node): node is GraphSymbolNode =>
            (node.type === "class" || node.type === "function" || node.type === "method") &&
            node.path === path
    ));
}

function commitNodes(graph: RepositoryGraph, sha: string): CommitGraphNode[] {
    return uniqueInGraphOrder(graph.nodes.filter(
        (node): node is CommitGraphNode => node.type === "commit" && node.sha === sha
    ));
}

function queryRelatedFiles(graph: RepositoryGraph, path: string): RepositoryGraphQueryResult {
    const files = fileNodes(graph, path);
    if (files.length === 0) return emptyResult();

    const fileIds = new Set(files.map((file) => file.id));
    const relatedIds = new Set<string>();
    for (const edge of graph.edges) {
        if (edge.type !== "imports") continue;
        if (fileIds.has(edge.from)) relatedIds.add(edge.to);
        if (fileIds.has(edge.to)) relatedIds.add(edge.from);
    }

    return { ...emptyResult(), files: nodesByIds(graph.nodes, relatedIds).filter(
        (node): node is FileGraphNode => node.type === "file"
    ) };
}

function queryFileImports(graph: RepositoryGraph, path: string): RepositoryGraphQueryResult {
    const files = fileNodes(graph, path);
    if (files.length === 0) return emptyResult();

    const fileIds = new Set(files.map((file) => file.id));
    const importedIds = new Set<string>();
    for (const edge of graph.edges) {
        if (edge.type === "imports" && fileIds.has(edge.from)) importedIds.add(edge.to);
    }

    return { ...emptyResult(), files: nodesByIds(graph.nodes, importedIds).filter(
        (node): node is FileGraphNode => node.type === "file"
    ) };
}

function querySymbolCallers(
    graph: RepositoryGraph,
    symbol: Extract<RepositoryGraphQuery, { type: "symbol-callers" }>['symbol']
): RepositoryGraphQueryResult {
    const targetIds = new Set(symbolNodes(graph, symbol.path)
        .filter((node) => node.type === symbol.type && node.name === symbol.name)
        .map((node) => node.id));
    if (targetIds.size === 0) return emptyResult();

    const callerIds = new Set<string>();
    for (const edge of graph.edges) {
        if (edge.type === "calls" && targetIds.has(edge.to)) callerIds.add(edge.from);
    }

    return { ...emptyResult(), symbols: nodesByIds(graph.nodes, callerIds).filter(
        (node): node is GraphSymbolNode =>
            node.type === "class" || node.type === "function" || node.type === "method"
    ) };
}

function queryCommitChanges(graph: RepositoryGraph, sha: string): RepositoryGraphQueryResult {
    const commits = commitNodes(graph, sha);
    if (commits.length === 0) return emptyResult();

    const commitIds = new Set(commits.map((commit) => commit.id));
    const changedIds = new Set<string>();
    for (const edge of graph.edges) {
        if (edge.type === "changed" && commitIds.has(edge.from)) changedIds.add(edge.to);
    }

    const changedNodes = nodesByIds(graph.nodes, changedIds);
    return {
        ...emptyResult(),
        files: changedNodes.filter((node): node is FileGraphNode => node.type === "file"),
        commits,
        symbolChanges: changedNodes.filter(
            (node): node is SymbolChangeGraphNode => node.type === "symbol-change"
        )
    };
}

function queryCommitSymbolChanges(graph: RepositoryGraph, sha: string): RepositoryGraphQueryResult {
    const result = queryCommitChanges(graph, sha);
    return { ...emptyResult(), symbolChanges: result.symbolChanges, commits: result.commits };
}

function queryAffectedSymbols(graph: RepositoryGraph, sha: string): RepositoryGraphQueryResult {
    const changes = queryCommitSymbolChanges(graph, sha);
    if (changes.commits.length === 0) return emptyResult();

    const changeIds = new Set(changes.symbolChanges.map((change) => change.id));
    const affectedIds = new Set<string>();
    for (const edge of graph.edges) {
        if (edge.type === "affects" && changeIds.has(edge.from)) affectedIds.add(edge.to);
    }

    return {
        ...emptyResult(),
        symbols: nodesByIds(graph.nodes, affectedIds).filter(
            (node): node is GraphSymbolNode =>
                node.type === "class" || node.type === "function" || node.type === "method"
        ),
        commits: changes.commits,
        symbolChanges: changes.symbolChanges
    };
}

export function queryRepositoryGraph(
    graph: RepositoryGraph,
    query: RepositoryGraphQuery
): RepositoryGraphQueryResult {
    switch (query.type) {
        case "related-files":
            return queryRelatedFiles(graph, query.path);
        case "file-symbols":
            return { ...emptyResult(), symbols: symbolNodes(graph, query.path) };
        case "file-imports":
            return queryFileImports(graph, query.path);
        case "symbol-callers":
            return querySymbolCallers(graph, query.symbol);
        case "commit-changes":
            return queryCommitChanges(graph, query.sha);
        case "commit-symbol-changes":
            return queryCommitSymbolChanges(graph, query.sha);
        case "affected-symbols":
            return queryAffectedSymbols(graph, query.sha);
    }
}

export function isRepositoryGraph(value: unknown): value is RepositoryGraph {
    if (!value || typeof value !== "object") return false;
    const candidate = value as { nodes?: unknown; edges?: unknown };
    if (!Array.isArray(candidate.nodes) || !Array.isArray(candidate.edges)) return false;

    return candidate.nodes.every((node) => {
        if (!node || typeof node !== "object") return false;
        const item = node as Record<string, unknown>;
        if (typeof item.id !== "string" || item.id.length === 0 ||
            typeof item.name !== "string" || typeof item.type !== "string") {
            return false;
        }

        if (["file", "class", "function", "method", "symbol-change"].includes(item.type)) {
            return typeof item.path === "string" && item.path.length > 0;
        }

        if (item.type === "commit") {
            return typeof item.sha === "string" && item.sha.length > 0 &&
                typeof item.message === "string" &&
                typeof item.authorName === "string" &&
                typeof item.authorDate === "string";
        }

        return item.type === "repository";
    }) && candidate.edges.every((edge) => {
        if (!edge || typeof edge !== "object") return false;
        const item = edge as { from?: unknown; to?: unknown; type?: unknown };
        return typeof item.from === "string" && item.from.length > 0 &&
            typeof item.to === "string" && item.to.length > 0 &&
            ["contains", "imports", "calls", "changed", "in-file", "affects"].includes(String(item.type));
    });
}

export function isRepositoryGraphQuery(value: unknown): value is RepositoryGraphQuery {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.type !== "string") return false;

    if (["related-files", "file-symbols", "file-imports", "commit-changes", "commit-symbol-changes", "affected-symbols"].includes(candidate.type)) {
        return typeof candidate.path === "string"
            ? ["related-files", "file-symbols", "file-imports"].includes(candidate.type) && candidate.path.length > 0
            : typeof candidate.sha === "string" && candidate.sha.length > 0;
    }

    if (candidate.type !== "symbol-callers" || !candidate.symbol || typeof candidate.symbol !== "object") return false;
    const symbol = candidate.symbol as Record<string, unknown>;
    return ["class", "function", "method"].includes(String(symbol.type)) &&
        typeof symbol.path === "string" && symbol.path.length > 0 &&
        typeof symbol.name === "string" && symbol.name.length > 0;
}
