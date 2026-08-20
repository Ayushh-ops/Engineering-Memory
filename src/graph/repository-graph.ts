import type { RepositoryFileAnalysis, ResolvedImportRelationship } from "../resolvers/relative-imports";

export type GraphNodeType = "repository" | "file" | "class" | "function" | "method";
export type GraphEdgeType = "contains" | "imports" | "calls";

export interface GraphNode {
    id: string;
    type: GraphNodeType;
    name?: string;
    path?: string;
}

export interface GraphEdge {
    from: string;
    to: string;
    type: GraphEdgeType;
}

export interface RepositoryGraph {
    nodes: GraphNode[];
    edges: GraphEdge[];
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

/** Builds an in-memory graph from existing analysis and import-resolution output. */
export function buildRepositoryGraph(
    repository: string,
    files: RepositoryFileAnalysis[],
    resolvedRelationships: ResolvedImportRelationship[]
): RepositoryGraph {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeIds = new Set<string>();
    const edgeKeys = new Set<string>();
    const fileSymbols = new Map<string, { functions: Map<string, string | null>; methods: Map<string, string | null> }>();

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
        const symbols = fileSymbols.get(file.path) ?? { functions: new Map(), methods: new Map() };
        fileSymbols.set(file.path, symbols);

        for (const analyzedClass of file.analysis.classes) {
            if (!analyzedClass.name) continue;
            const currentClassId = classId(file.path, analyzedClass.name);
            addNode({ id: currentClassId, type: "class", name: analyzedClass.name, path: file.path });
            addEdge({ from: currentFileId, to: currentClassId, type: "contains" });
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
