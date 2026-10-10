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

function decodeGraphFileId(id: string): string {
    if (!id) return '';
    if (id.startsWith('file:')) {
        try {
            return decodeURIComponent(id.slice(5));
        } catch {
            return id.slice(5);
        }
    }
    return id;
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
    const idToPath = new Map<string, string>();
    const decodedSelected = decodeGraphFileId(selectedFile);
    currentFileNodeIds.add(selectedFile);
    currentFileNodeIds.add(decodedSelected);

    for (const rawNode of graph.nodes) {
        const n = rawNode as any;
        const decodedId = decodeGraphFileId(n.id);
        const p = n.path || (n.type === 'file' ? decodedId : undefined);
        if (p) {
            idToPath.set(n.id, p);
        }
        if (
            p === selectedFile ||
            p === decodedSelected ||
            n.id === selectedFile ||
            decodedId === selectedFile ||
            decodedId === decodedSelected ||
            (n.type === 'file' && (n.name === selectedFile || n.name === decodedSelected)) ||
            (p && (p.endsWith('/' + selectedFile) || p.endsWith('/' + decodedSelected))) ||
            (decodedId && (decodedId.endsWith('/' + selectedFile) || decodedId.endsWith('/' + decodedSelected)))
        ) {
            currentFileNodeIds.add(n.id);
            if (p) currentFileNodeIds.add(p);
            if (decodedId) currentFileNodeIds.add(decodedId);
        }
    }

    const importsSet = new Set<string>();
    const importedBySet = new Set<string>();
    const callsSet = new Set<string>();

    for (const edge of graph.edges) {
        const rawFrom = idToPath.get(edge.from) || edge.from;
        const rawTo = idToPath.get(edge.to) || edge.to;
        const fromPath = decodeGraphFileId(rawFrom);
        const toPath = decodeGraphFileId(rawTo);

        const isFromTarget = currentFileNodeIds.has(edge.from) ||
            currentFileNodeIds.has(fromPath) ||
            fromPath === selectedFile ||
            fromPath === decodedSelected ||
            fromPath.endsWith('/' + selectedFile);

        const isToTarget = currentFileNodeIds.has(edge.to) ||
            currentFileNodeIds.has(toPath) ||
            toPath === selectedFile ||
            toPath === decodedSelected ||
            toPath.endsWith('/' + selectedFile);

        if (edge.type === 'imports') {
            if (isFromTarget && !isToTarget && toPath && toPath !== selectedFile && toPath !== decodedSelected) {
                importsSet.add(toPath);
            }
            if (isToTarget && !isFromTarget && fromPath && fromPath !== selectedFile && fromPath !== decodedSelected) {
                importedBySet.add(fromPath);
            }
        } else if (edge.type === 'calls') {
            if (isFromTarget && !isToTarget && toPath && toPath !== selectedFile && toPath !== decodedSelected) {
                callsSet.add(toPath);
            }
            if (isToTarget && !isFromTarget && fromPath && fromPath !== selectedFile && fromPath !== decodedSelected) {
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
            const decodedId = decodeGraphFileId(n.id);
            const nPath = n.path || (n.type === 'file' ? decodedId : undefined);
            if (
                nPath === selectedFile ||
                nPath === decodedSelected ||
                currentFileNodeIds.has(n.path) ||
                (nPath && (nPath.endsWith('/' + selectedFile) || nPath.endsWith('/' + decodedSelected)))
            ) {
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

export interface RiskDetails {
    score: number;
    directDependents: number;
    transitiveDependents: number;
    churnPercent: number;
    hasNoTests: boolean;
    reasons: Array<{ label: string; value: string }>;
}

export function computeRisk(
    filePath: string,
    graph: RepositoryGraph | null,
    commits: any[] = []
): RiskDetails {
    if (!graph || !filePath) {
        return {
            score: 0,
            directDependents: 0,
            transitiveDependents: 0,
            churnPercent: 0,
            hasNoTests: true,
            reasons: []
        };
    }

    const fileNode = graph.nodes.find((n: any) => n.type === 'file' && (n.path === filePath || n.id === filePath));
    const fileId = fileNode ? fileNode.id : filePath;

    // 1. Direct dependents (incoming imports or calls)
    const directSet = new Set<string>();
    for (const edge of graph.edges) {
        if (edge.to === fileId && (edge.type === 'imports' || edge.type === 'calls')) {
            directSet.add(edge.from);
        }
    }

    // 2. Transitive dependents (reverse BFS excluding direct and target file)
    const visited = new Set<string>([fileId, ...directSet]);
    const queue = Array.from(directSet);
    const transitiveSet = new Set<string>();

    while (queue.length > 0) {
        const curr = queue.shift()!;
        for (const edge of graph.edges) {
            if (edge.to === curr && (edge.type === 'imports' || edge.type === 'calls')) {
                if (!visited.has(edge.from)) {
                    visited.add(edge.from);
                    transitiveSet.add(edge.from);
                    queue.push(edge.from);
                }
            }
        }
    }

    const directDependents = directSet.size;
    const transitiveDependents = transitiveSet.size;

    // 3. Churn percent from commits
    let churnPercent = 0;
    if (commits && commits.length > 0) {
        const touchingCommitsCount = commits.filter((c: any) =>
            c.files && c.files.some((f: any) => f.filename === filePath || f.path === filePath)
        ).length;
        churnPercent = Math.min(100, Math.round((touchingCommitsCount / Math.max(1, commits.length)) * 100));
    }

    // 4. Test presence
    const baseName = filePath.split('/').pop()?.replace(/\.[^.]+$/, '') || '';
    const hasTests = graph.nodes.some((n: any) => {
        if (n.type !== 'file') return false;
        const p = n.path || n.id;
        if (!p) return false;
        const isTest = /\.(test|spec)\.[^.]+$/.test(p) || /(^|\/)(test|tests|__tests__)\//.test(p);
        if (!isTest) return false;
        const testBase = p.split('/').pop()?.replace(/\.(test|spec)\.[^.]+$/, '').replace(/\.[^.]+$/, '') || '';
        return testBase === baseName || p.includes(baseName);
    });
    const hasNoTests = !hasTests;

    let rawScore = 4 * directDependents + 2 * transitiveDependents + 0.25 * churnPercent + (hasNoTests ? 10 : 0);
    if (directDependents === 0 && transitiveDependents === 0) {
        rawScore = Math.min(15, rawScore);
    }
    const score = Math.min(100, Math.max(0, Math.round(rawScore)));

    const reasons: Array<{ label: string; value: string }> = [
        { label: "Direct dependents", value: `${directDependents} file${directDependents === 1 ? "" : "s"}` },
        { label: "Transitive dependents", value: `${transitiveDependents} file${transitiveDependents === 1 ? "" : "s"}` },
        { label: "Commit churn", value: `${churnPercent}%` },
        { label: "Test coverage", value: hasNoTests ? "No test found (+10)" : "Tests found (+0)" }
    ];

    return {
        score,
        directDependents,
        transitiveDependents,
        churnPercent,
        hasNoTests,
        reasons
    };
}

export function computeChangeSetRisk(
    changeSetFiles: string[],
    graph: RepositoryGraph | null,
    commits: any[] = []
): RiskDetails {
    if (!graph || changeSetFiles.length === 0) {
        return {
            score: 0,
            directDependents: 0,
            transitiveDependents: 0,
            churnPercent: 0,
            hasNoTests: true,
            reasons: []
        };
    }

    const inputNodeIds = new Set(
        changeSetFiles.map(path => {
            const n = graph.nodes.find((node: any) => node.type === 'file' && (node.path === path || node.id === path));
            return n ? n.id : path;
        })
    );

    const directSet = new Set<string>();
    for (const edge of graph.edges) {
        if (inputNodeIds.has(edge.to) && (edge.type === 'imports' || edge.type === 'calls')) {
            if (!inputNodeIds.has(edge.from)) {
                directSet.add(edge.from);
            }
        }
    }

    const visited = new Set<string>([...inputNodeIds, ...directSet]);
    const queue = Array.from(directSet);
    const transitiveSet = new Set<string>();

    while (queue.length > 0) {
        const curr = queue.shift()!;
        for (const edge of graph.edges) {
            if (edge.to === curr && (edge.type === 'imports' || edge.type === 'calls')) {
                if (!visited.has(edge.from)) {
                    visited.add(edge.from);
                    transitiveSet.add(edge.from);
                    queue.push(edge.from);
                }
            }
        }
    }

    const directDependents = directSet.size;
    const transitiveDependents = transitiveSet.size;

    let churnPercent = 0;
    if (commits && commits.length > 0) {
        const touchingCommitsCount = commits.filter((c: any) =>
            c.files && c.files.some((f: any) => changeSetFiles.includes(f.filename || f.path))
        ).length;
        churnPercent = Math.min(100, Math.round((touchingCommitsCount / Math.max(1, commits.length)) * 100));
    }

    let anyTestsFound = false;
    for (const file of changeSetFiles) {
        const baseName = file.split('/').pop()?.replace(/\.[^.]+$/, '') || '';
        const found = graph.nodes.some((n: any) => {
            if (n.type !== 'file') return false;
            const p = n.path || n.id;
            if (!p) return false;
            const isTest = /\.(test|spec)\.[^.]+$/.test(p) || /(^|\/)(test|tests|__tests__)\//.test(p);
            if (!isTest) return false;
            const testBase = p.split('/').pop()?.replace(/\.(test|spec)\.[^.]+$/, '').replace(/\.[^.]+$/, '') || '';
            return testBase === baseName || p.includes(baseName);
        });
        if (found) {
            anyTestsFound = true;
            break;
        }
    }
    const hasNoTests = !anyTestsFound;

    let rawScore = 4 * directDependents + 2 * transitiveDependents + 0.25 * churnPercent + (hasNoTests ? 10 : 0);
    if (directDependents === 0 && transitiveDependents === 0) {
        rawScore = Math.min(15, rawScore);
    }
    const score = Math.min(100, Math.max(0, Math.round(rawScore)));

    const reasons: Array<{ label: string; value: string }> = [
        { label: "Direct dependents", value: `${directDependents} file${directDependents === 1 ? "" : "s"}` },
        { label: "Transitive dependents", value: `${transitiveDependents} file${transitiveDependents === 1 ? "" : "s"}` },
        { label: "Commit churn", value: `${churnPercent}%` },
        { label: "Test coverage", value: hasNoTests ? "No test found (+10)" : "Tests found (+0)" }
    ];

    return {
        score,
        directDependents,
        transitiveDependents,
        churnPercent,
        hasNoTests,
        reasons
    };
}

export interface RepoStats {
    totalFiles: number;
    analyzedFiles: number;
    symbols: number;
    links: number;
    hotspots: number;
}

export function selectRepoStats(state: { graph: RepositoryGraph | null; treeFiles: string[]; commits?: any[] }): RepoStats {
    const { graph, treeFiles } = state;
    const fileNodes = graph ? graph.nodes.filter((n: any) => n.type === 'file') : [];
    const analyzedFiles = fileNodes.length;
    const totalFiles = treeFiles && treeFiles.length > 0 ? treeFiles.length : analyzedFiles;

    const symbols = graph ? graph.nodes.filter((n: any) => n.type !== 'file' && n.type !== 'repository').length : 0;
    const links = graph ? graph.edges.length : 0;
    const hotspots = Math.min(5, analyzedFiles);

    return {
        totalFiles,
        analyzedFiles,
        symbols,
        links,
        hotspots
    };
}

export interface Layout2DResult {
    positions: Map<string, { x: number; y: number }>;
    columnCounts: { imports: number; importedBy: number; indirect: number };
    nodeHops: Map<string, number>;
    leftIds: string[];
    rightIds: string[];
    indirectIds: string[];
    colSpacing: number;
    baseColOffset: number;
}

export function compute2DLayout(
    nodes: Array<{ id: string; type?: string; [key: string]: any }>,
    edges: Array<{ from: string; to: string; type?: string; [key: string]: any }>,
    options?: {
        centerId?: string | null;
        isFocused?: boolean;
        focusDepth?: 1 | 2;
    }
): Layout2DResult {
    const positions = new Map<string, { x: number; y: number }>();
    const nodeHops = new Map<string, number>();
    const columnCounts = { imports: 0, importedBy: 0, indirect: 0 };
    const colSpacing = 340;
    const defaultRes: Layout2DResult = {
        positions,
        columnCounts,
        nodeHops,
        leftIds: [],
        rightIds: [],
        indirectIds: [],
        colSpacing,
        baseColOffset: 1
    };
    if (nodes.length === 0) return defaultRes;

    const nodeHeight = 34;
    const verticalGap = 12;
    const rowStep = 46; // 34px pill height + 12px gap

    const centerId = options?.centerId;
    const centerNode = centerId ? nodes.find(n => n.id === centerId) : null;

    if (centerNode && centerId) {
        const cId: string = centerId;
        // Direct relationships:
        // Imports (selected -> file: selected imports file) -> Left column
        // Imported by (file -> selected: file imports selected) -> Right column
        const directImportsSet = new Set<string>();
        const directImportedBySet = new Set<string>();

        for (const e of edges) {
            if (e.from === cId && e.to !== cId) {
                directImportsSet.add(e.to);
            }
            if (e.to === cId && e.from !== cId) {
                directImportedBySet.add(e.from);
            }
        }

        // Indirect (2+ hops): compute shortest path hops from center
        const hopsMap = new Map<string, number>();
        hopsMap.set(cId, 0);
        const queue: Array<{ id: string; hops: number }> = [{ id: cId, hops: 0 }];
        const adj = new Map<string, string[]>();
        for (const e of edges) {
            if (!adj.has(e.from)) adj.set(e.from, []);
            if (!adj.has(e.to)) adj.set(e.to, []);
            adj.get(e.from)!.push(e.to);
            adj.get(e.to)!.push(e.from);
        }
        while (queue.length > 0) {
            const curr = queue.shift()!;
            const neighbors = adj.get(curr.id) || [];
            for (const nbr of neighbors) {
                if (!hopsMap.has(nbr)) {
                    hopsMap.set(nbr, curr.hops + 1);
                    queue.push({ id: nbr, hops: curr.hops + 1 });
                }
            }
        }

        const leftIds: string[] = [];      // Imports
        const rightIds: string[] = [];     // Imported by
        const indirectIds: string[] = [];  // Indirect (2+ hops)

        for (const n of nodes) {
            if (n.id === cId) continue;
            const hops = hopsMap.get(n.id) || 1;
            nodeHops.set(n.id, hops);

            if (hops >= 2) {
                indirectIds.push(n.id);
            } else if (directImportsSet.has(n.id) && !directImportedBySet.has(n.id)) {
                leftIds.push(n.id);
            } else if (directImportedBySet.has(n.id) && !directImportsSet.has(n.id)) {
                rightIds.push(n.id);
            } else if (directImportsSet.has(n.id) && directImportedBySet.has(n.id)) {
                leftIds.push(n.id);
            } else {
                // If connected indirectly or unclassified
                indirectIds.push(n.id);
            }
        }

        columnCounts.imports = leftIds.length;
        columnCounts.importedBy = rightIds.length;
        columnCounts.indirect = indirectIds.length;

        // Selected in center at (0, 0)
        positions.set(cId, { x: 0, y: 0 });

        // Left column (Imports) at x = -colSpacing
        const leftCount = leftIds.length;
        if (leftCount > 0) {
            const leftColCount = options?.focusDepth === 1 ? 1 : Math.max(1, Math.ceil(leftCount / 12));
            const leftChunkSize = Math.ceil(leftCount / leftColCount);
            for (let c = 0; c < leftColCount; c++) {
                const chunk = leftIds.slice(c * leftChunkSize, (c + 1) * leftChunkSize);
                const x = -colSpacing * (c + 1);
                const span = (chunk.length - 1) * rowStep;
                chunk.forEach((id, idx) => {
                    const y = Math.round(-span / 2 + idx * rowStep);
                    positions.set(id, { x, y });
                });
            }
        }

        // Right column (Imported by) at x = colSpacing
        // Direct mode: show ONE column of importers (max 12 rows, row height 34px) so no edge passes behind another pill
        const rightCount = rightIds.length;
        const isDirectMode = options?.focusDepth === 1;
        const rightColCount = isDirectMode ? 1 : Math.max(1, Math.ceil(rightCount / 12));
        if (rightCount > 0) {
            const rightChunkSize = isDirectMode ? 12 : Math.ceil(rightCount / rightColCount);
            for (let c = 0; c < rightColCount; c++) {
                const chunk = rightIds.slice(c * rightChunkSize, (c + 1) * rightChunkSize);
                const x = colSpacing * (c + 1);
                const span = (chunk.length - 1) * rowStep;
                chunk.forEach((id, idx) => {
                    const y = Math.round(-span / 2 + idx * rowStep);
                    positions.set(id, { x, y });
                });
            }
        }

        // Indirect mode: add the second column further right
        const indirectCount = indirectIds.length;
        const baseColOffset = rightColCount;
        if (indirectCount > 0 && !isDirectMode) {
            const indColCount = Math.max(1, Math.ceil(indirectCount / 12));
            const indChunkSize = Math.ceil(indirectCount / indColCount);
            for (let c = 0; c < indColCount; c++) {
                const chunk = indirectIds.slice(c * indChunkSize, (c + 1) * indChunkSize);
                const x = colSpacing * (baseColOffset + 1 + c);
                const span = (chunk.length - 1) * rowStep;
                chunk.forEach((id, idx) => {
                    const y = Math.round(-span / 2 + idx * rowStep);
                    positions.set(id, { x, y });
                });
            }
        }

        return {
            positions,
            columnCounts,
            nodeHops,
            leftIds,
            rightIds,
            indirectIds,
            colSpacing,
            baseColOffset
        };
    }

    // When no node is selected: multiple columns (max 10 per column), 40px vertical gap, centered vertically at y = 0
    const inDegrees = new Map<string, number>();
    const outDegrees = new Map<string, number>();
    nodes.forEach(n => {
        inDegrees.set(n.id, 0);
        outDegrees.set(n.id, 0);
    });
    edges.forEach(e => {
        if (outDegrees.has(e.from)) outDegrees.set(e.from, (outDegrees.get(e.from) || 0) + 1);
        if (inDegrees.has(e.to)) inDegrees.set(e.to, (inDegrees.get(e.to) || 0) + 1);
    });

    const sortedNodes = [...nodes].sort((a, b) => {
        const flowA = (outDegrees.get(a.id) || 0) - (inDegrees.get(a.id) || 0);
        const flowB = (outDegrees.get(b.id) || 0) - (inDegrees.get(b.id) || 0);
        return flowB - flowA;
    });

    const numCols = Math.max(1, Math.ceil(sortedNodes.length / 10));
    const perCol = Math.ceil(sortedNodes.length / numCols);

    for (let c = 0; c < numCols; c++) {
        const chunk = sortedNodes.slice(c * perCol, (c + 1) * perCol);
        const x = Math.round((c - (numCols - 1) / 2) * colSpacing);
        const span = (chunk.length - 1) * rowStep;
        chunk.forEach((n, idx) => {
            const y = Math.round(-span / 2 + idx * rowStep);
            positions.set(n.id, { x, y });
        });
    }

    return {
        positions,
        columnCounts,
        nodeHops,
        leftIds: [],
        rightIds: [],
        indirectIds: [],
        colSpacing,
        baseColOffset: 1
    };
}
