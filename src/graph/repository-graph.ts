import type {
    FileChangeAnalysis,
    HistoricalSymbolType,
    SymbolChangeType
} from "../analyzers/typescript-history";
import type { RepositoryFileAnalysis, ResolvedImportRelationship } from "../resolvers/relative-imports";

export type GraphNodeType = "repository" | "file" | "class" | "function" | "method" | "commit" | "symbol-change";
export type GraphEdgeType = "contains" | "imports" | "calls" | "changed" | "in-file" | "affects";

interface NamedGraphNode {
    id: string;
    name: string;
}

export interface RepositoryGraphNode extends NamedGraphNode {
    type: "repository";
}

export interface FileGraphNode extends NamedGraphNode {
    type: "file";
    path: string;
}

export interface ClassGraphNode extends NamedGraphNode {
    type: "class";
    path: string;
}

export interface FunctionGraphNode extends NamedGraphNode {
    type: "function";
    path: string;
}

export interface MethodGraphNode extends NamedGraphNode {
    type: "method";
    path: string;
}

export interface CommitGraphNode {
    id: string;
    type: "commit";
    sha: string;
    message: string;
    authorName: string;
    authorDate: string;
}

export interface SymbolChangeGraphNode extends NamedGraphNode {
    type: "symbol-change";
    path: string;
    symbolType: HistoricalSymbolType;
    changeType: SymbolChangeType;
}

export type GraphNode =
    | RepositoryGraphNode
    | FileGraphNode
    | ClassGraphNode
    | FunctionGraphNode
    | MethodGraphNode
    | CommitGraphNode
    | SymbolChangeGraphNode;

export interface GraphEdge {
    from: string;
    to: string;
    type: GraphEdgeType;
}

export interface RepositoryGraph {
    nodes: GraphNode[];
    edges: GraphEdge[];
}

/** The commit data needed to compose history into an existing repository graph. */
export interface RepositoryHistoryCommit {
    sha: string;
    message: string;
    authorName: string;
    authorDate: string;
    files: Array<{ filename: string }>;
}

export interface RepositoryHistoricalChanges {
    sha: string;
    files: FileChangeAnalysis[];
}

function idComponent(value: string): string {
    return encodeURIComponent(value).replace(/:/g, "%3A");
}

function repositoryId(repository: string): string {
    return `repository:${idComponent(repository)}`;
}

function fileId(path: string): string {
    return `file:${idComponent(path)}`;
}

function classId(path: string, name: string): string {
    return `class:${idComponent(path)}:${idComponent(name)}`;
}

function functionId(path: string, name: string): string {
    return `function:${idComponent(path)}:${idComponent(name)}`;
}

function methodId(path: string, className: string, methodName: string): string {
    return `method:${idComponent(path)}:${idComponent(className)}.${idComponent(methodName)}`;
}

function commitId(sha: string): string {
    return `commit:${sha}`;
}

function symbolChangeId(
    sha: string,
    path: string,
    symbolType: HistoricalSymbolType,
    name: string,
    changeType: SymbolChangeType
): string {
    return [sha, path, symbolType, name, changeType]
        .map(idComponent)
        .reduce((id, component) => `${id}:${component}`, "symbol-change");
}

/** Builds an in-memory graph from existing analysis and import-resolution output. */
export function buildRepositoryGraph(
    repository: string,
    files: RepositoryFileAnalysis[],
    resolvedRelationships: ResolvedImportRelationship[],
    history: RepositoryHistoryCommit[] = [],
    historicalChanges: RepositoryHistoricalChanges | null = null
): RepositoryGraph {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeIds = new Set<string>();
    const edgeKeys = new Set<string>();
    const fileSymbols = new Map<string, {
        classes: Map<string, string | null>;
        functions: Map<string, string | null>;
        methods: Map<string, string | null>;
    }>();

    const addNode = (node: GraphNode): void => {
        if (!nodeIds.has(node.id)) {
            nodeIds.add(node.id);
            nodes.push(node);
        }
    };
    const addEdge = (edge: GraphEdge): void => {
        const key = `${edge.type}\u0000${edge.from}\u0000${edge.to}`;
        if (!edgeKeys.has(key)) {
            edgeKeys.add(key);
            edges.push(edge);
        }
    };

    const rootId = repositoryId(repository);
    addNode({ id: rootId, type: "repository", name: repository });

    const addSymbol = (symbols: Map<string, string | null>, name: string, id: string): void => {
        if (symbols.has(name)) {
            symbols.set(name, null);
        } else {
            symbols.set(name, id);
        }
    };

    const builtPaths = new Set<string>();
    for (const file of files) {
        const currentFileId = fileId(file.path);
        addNode({ id: currentFileId, type: "file", name: file.path, path: file.path });
        addEdge({ from: rootId, to: currentFileId, type: "contains" });
        if (builtPaths.has(file.path)) continue;
        builtPaths.add(file.path);
        const symbols = fileSymbols.get(file.path) ?? {
            classes: new Map(),
            functions: new Map(),
            methods: new Map()
        };
        fileSymbols.set(file.path, symbols);

        for (const analyzedClass of file.analysis.classes) {
            if (!analyzedClass.name) continue;
            const currentClassId = classId(file.path, analyzedClass.name);
            addNode({ id: currentClassId, type: "class", name: analyzedClass.name, path: file.path });
            addEdge({ from: currentFileId, to: currentClassId, type: "contains" });
            addSymbol(symbols.classes, analyzedClass.name, currentClassId);
            for (const analyzedMethod of analyzedClass.methods) {
                const currentMethodId = methodId(file.path, analyzedClass.name, analyzedMethod.name);
                addNode({ id: currentMethodId, type: "method", name: `${analyzedClass.name}.${analyzedMethod.name}`, path: file.path });
                addEdge({ from: currentClassId, to: currentMethodId, type: "contains" });
                const key = `${analyzedClass.name}.${analyzedMethod.name}`;
                addSymbol(symbols.methods, key, currentMethodId);
            }
        }

        for (const analyzedFunction of file.analysis.functions) {
            if (!analyzedFunction.name) continue;
            const currentFunctionId = functionId(file.path, analyzedFunction.name);
            addNode({ id: currentFunctionId, type: "function", name: analyzedFunction.name, path: file.path });
            addEdge({ from: currentFileId, to: currentFunctionId, type: "contains" });
            addSymbol(symbols.functions, analyzedFunction.name, currentFunctionId);
        }
    }

    const knownFileIds = new Map<string, string>();
    for (const file of files) {
        knownFileIds.set(file.path, fileId(file.path));
    }

    for (const commit of history) {
        const currentCommitId = commitId(commit.sha);
        addNode({
            id: currentCommitId,
            type: "commit",
            sha: commit.sha,
            message: commit.message,
            authorName: commit.authorName,
            authorDate: commit.authorDate
        });

        for (const changedFile of commit.files) {
            const changedFileId = knownFileIds.get(changedFile.filename);
            if (changedFileId) {
                addEdge({ from: currentCommitId, to: changedFileId, type: "changed" });
            }
        }
    }

    if (historicalChanges) {
        const currentCommitId = commitId(historicalChanges.sha);

        for (const fileChange of historicalChanges.files) {
            if (!fileChange.applicable) continue;

            const currentFileId = fileId(fileChange.path);
            for (const change of fileChange.changes) {
                const currentChangeId = symbolChangeId(
                    historicalChanges.sha,
                    fileChange.path,
                    change.symbolType,
                    change.name,
                    change.type
                );
                addNode({
                    id: currentChangeId,
                    type: "symbol-change",
                    name: change.name,
                    path: fileChange.path,
                    symbolType: change.symbolType,
                    changeType: change.type
                });
                addEdge({ from: currentCommitId, to: currentChangeId, type: "changed" });
                addEdge({ from: currentChangeId, to: currentFileId, type: "in-file" });

                const symbols = fileSymbols.get(fileChange.path);
                if (!symbols) continue;

                const symbolId = change.symbolType === "class"
                    ? symbols.classes.get(change.name)
                    : change.symbolType === "function"
                        ? symbols.functions.get(change.name)
                        : symbols.methods.get(change.name);
                if (symbolId) addEdge({ from: currentChangeId, to: symbolId, type: "affects" });
            }
        }
    }

    for (const relationship of resolvedRelationships) {
        addEdge({ from: fileId(relationship.from), to: fileId(relationship.to), type: "imports" });
    }

    for (const file of files) {
        const symbols = fileSymbols.get(file.path);
        if (!symbols) continue;
        for (const relationship of file.analysis.relationships) {
            if (relationship.type !== "calls") continue;
            const from = symbols.functions.get(relationship.from) ?? symbols.methods.get(relationship.from);
            const to = symbols.functions.get(relationship.to) ?? symbols.methods.get(relationship.to);
            if (from && to) addEdge({ from, to, type: "calls" });
        }
    }

    return { nodes, edges };
}
