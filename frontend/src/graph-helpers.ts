import type { RepositoryGraph } from './api';

export interface NeighborInfo {
    selectedNodeIds: Set<string>;
    calleeNeighborIds: Set<string>;
    dependentNeighborIds: Set<string>;
    directNeighborIds: Set<string>;
    outgoingEdgeIds: Set<string>;
    incomingEdgeIds: Set<string>;
    hasSelection: boolean;
}

export function getNeighborInfo(
    graph: RepositoryGraph | null,
    selectedFile: string | null,
    selectedSymbol?: { name: string; type: string; path: string } | null
): NeighborInfo {
    const empty: NeighborInfo = {
        selectedNodeIds: new Set(),
        calleeNeighborIds: new Set(),
        dependentNeighborIds: new Set(),
        directNeighborIds: new Set(),
        outgoingEdgeIds: new Set(),
        incomingEdgeIds: new Set(),
        hasSelection: false
    };

    if (!graph || !selectedFile) {
        return empty;
    }

    const selectedNodeIds = new Set<string>();
    const currentFileNodeIds = new Set<string>();

    for (const rawNode of graph.nodes) {
        const n = rawNode as any;
        const nPath = n.path || (n.type === 'file' ? n.id : undefined);
        if (nPath === selectedFile || n.id === selectedFile || (n.type === 'file' && n.name === selectedFile)) {
            currentFileNodeIds.add(n.id);
            if (selectedSymbol) {
                if (n.name === selectedSymbol.name && n.type === selectedSymbol.type) {
                    selectedNodeIds.add(n.id);
                }
            } else if (n.type === 'file') {
                selectedNodeIds.add(n.id);
            }
        }
    }

    if (selectedNodeIds.size === 0 && currentFileNodeIds.size > 0) {
        for (const id of currentFileNodeIds) {
            selectedNodeIds.add(id);
        }
    }

    if (selectedNodeIds.size === 0) {
        return empty;
    }

    const calleeNeighborIds = new Set<string>();
    const dependentNeighborIds = new Set<string>();
    const outgoingEdgeIds = new Set<string>();
    const incomingEdgeIds = new Set<string>();

    const nodeMap = new Map<string, any>();
    for (const rawNode of graph.nodes) {
        const n = rawNode as any;
        nodeMap.set(n.id, n);
    }

    for (const e of graph.edges) {
        const edgeId = e.id || `${e.from}->${e.to}:${e.type}`;
        const fromNode = nodeMap.get(e.from);
        const toNode = nodeMap.get(e.to);

        // Outgoing: selected node to callee or imported file/symbol
        if (selectedNodeIds.has(e.from) && !selectedNodeIds.has(e.to)) {
            calleeNeighborIds.add(e.to);
            outgoingEdgeIds.add(edgeId);
        }
        // Incoming: dependent node to selected node (ignore repo root node so it does not turn amber)
        if (selectedNodeIds.has(e.to) && !selectedNodeIds.has(e.from)) {
            if (fromNode?.type !== 'repository') {
                dependentNeighborIds.add(e.from);
                incomingEdgeIds.add(edgeId);
            }
        }
    }

    const directNeighborIds = new Set<string>([...calleeNeighborIds, ...dependentNeighborIds]);

    return {
        selectedNodeIds,
        calleeNeighborIds,
        dependentNeighborIds,
        directNeighborIds,
        outgoingEdgeIds,
        incomingEdgeIds,
        hasSelection: true
    };
}

export interface ConnectedSymbol {
    name: string;
    type: string;
    id: string;
}

export function getConnectedFiles(
    graph: RepositoryGraph | null,
    selectedFile: string | null
): {
    imports: string[];
    importedBy: string[];
    calls: string[];
    contains: ConnectedSymbol[];
} {
    if (!graph || !selectedFile) {
        return { imports: [], importedBy: [], calls: [], contains: [] };
    }

    const currentFileNodeIds = new Set<string>();
    const nodeMap = new Map<string, any>();

    for (const rawNode of graph.nodes) {
        const n = rawNode as any;
        nodeMap.set(n.id, n);
        const nPath = n.path || (n.type === 'file' ? n.id : undefined);
        if (nPath === selectedFile || n.id === selectedFile || (n.type === 'file' && n.name === selectedFile)) {
            currentFileNodeIds.add(n.id);
        }
    }

    const importsSet = new Set<string>();
    const importedBySet = new Set<string>();
    const callsSet = new Set<string>();

    for (const edge of graph.edges) {
        const fromNode = nodeMap.get(edge.from) as any;
        const toNode = nodeMap.get(edge.to) as any;
        const fromPath = fromNode?.path || (fromNode?.type === 'file' ? fromNode.id : undefined);
        const toPath = toNode?.path || (toNode?.type === 'file' ? toNode.id : undefined);

        if (edge.type === 'imports') {
            if (currentFileNodeIds.has(edge.from) && toPath && toPath !== selectedFile) {
                importsSet.add(toPath);
            }
            if (currentFileNodeIds.has(edge.to) && fromPath && fromPath !== selectedFile) {
                importedBySet.add(fromPath);
            }
        } else if (edge.type === 'calls') {
            if (currentFileNodeIds.has(edge.from) && toPath && toPath !== selectedFile) {
                callsSet.add(toPath);
            }
            if (currentFileNodeIds.has(edge.to) && fromPath && fromPath !== selectedFile) {
                callsSet.add(fromPath);
            }
        }
    }

    // Contains: symbols (functions, classes, methods) inside selectedFile
    const contains: ConnectedSymbol[] = [];
    const seenSymbols = new Set<string>();

    for (const rawNode of graph.nodes) {
        const n = rawNode as any;
        if (n.type === 'function' || n.type === 'class' || n.type === 'method') {
            const nPath = n.path || (n.type === 'file' ? n.id : undefined);
            if (nPath === selectedFile) {
                const key = `${n.type}:${n.name}`;
                if (!seenSymbols.has(key)) {
                    seenSymbols.add(key);
                    contains.push({
                        name: n.name,
                        type: n.type,
                        id: n.id
                    });
                }
            }
        }
    }

    contains.sort((a, b) => a.name.localeCompare(b.name));

    return {
        imports: Array.from(importsSet).sort(),
        importedBy: Array.from(importedBySet).sort(),
        calls: Array.from(callsSet).sort(),
        contains
    };
}

export function getFocusedGraph(
    graph: RepositoryGraph,
    selectedFile: string | null,
    selectedSymbol: any,
    depth: 1 | 2
): RepositoryGraph {
    if (!selectedFile) return graph;

    const { selectedNodeIds } = getNeighborInfo(graph, selectedFile, selectedSymbol);
    if (selectedNodeIds.size === 0) return graph;

    const depth1Ids = new Set<string>(selectedNodeIds);
    for (const e of graph.edges) {
        if (selectedNodeIds.has(e.from)) depth1Ids.add(e.to);
        if (selectedNodeIds.has(e.to)) depth1Ids.add(e.from);
    }

    const allowedNodeIds = new Set<string>(depth1Ids);
    if (depth === 2) {
        for (const e of graph.edges) {
            if (depth1Ids.has(e.from)) allowedNodeIds.add(e.to);
            if (depth1Ids.has(e.to)) allowedNodeIds.add(e.from);
        }
    }

    return {
        nodes: graph.nodes.filter(n => allowedNodeIds.has(n.id)),
        edges: graph.edges.filter(e => allowedNodeIds.has(e.from) && allowedNodeIds.has(e.to))
    };
}
