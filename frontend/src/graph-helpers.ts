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

export function compute2DLayout(
    nodes: Array<{ id: string; type?: string; [key: string]: any }>,
    edges: Array<{ from: string; to: string; type?: string; [key: string]: any }>,
    options?: {
        centerId?: string | null;
        isFocused?: boolean;
        focusDepth?: 1 | 2;
    }
): Map<string, { x: number; y: number }> {
    const positions = new Map<string, { x: number; y: number }>();
    if (nodes.length === 0) return positions;

    // 1. If in focused mode with a selected node, use clean radial layout
    if (options?.isFocused && options.centerId) {
        const centerId = options.centerId;
        positions.set(centerId, { x: 0, y: 0 });

        const depth1 = nodes.filter(n =>
            n.id !== centerId &&
            edges.some(e => (e.from === centerId && e.to === n.id) || (e.to === centerId && e.from === n.id))
        );
        const depth1Ids = new Set(depth1.map(n => n.id));
        const depth2 = nodes.filter(n => n.id !== centerId && !depth1Ids.has(n.id));

        const r1 = Math.max(220, depth1.length * 34);
        depth1.forEach((n, i) => {
            const angle = (2 * Math.PI * i) / Math.max(1, depth1.length);
            positions.set(n.id, {
                x: Math.round(Math.cos(angle) * r1),
                y: Math.round(Math.sin(angle) * r1)
            });
        });

        if (depth2.length > 0) {
            const r2 = r1 + Math.max(200, depth2.length * 26);
            depth2.forEach((n, i) => {
                const angle = (2 * Math.PI * i) / Math.max(1, depth2.length) + 0.3;
                positions.set(n.id, {
                    x: Math.round(Math.cos(angle) * r2),
                    y: Math.round(Math.sin(angle) * r2)
                });
            });
        }

        return positions;
    }

    // 2. Auto force-directed layout for full graph or simplified graph
    interface SimNode {
        id: string;
        x: number;
        y: number;
        vx: number;
        vy: number;
    }

    const simNodes: SimNode[] = [];
    const simMap = new Map<string, SimNode>();

    nodes.forEach((n, idx) => {
        if (n.type === 'repository') {
            const sn: SimNode = { id: n.id, x: 0, y: 0, vx: 0, vy: 0 };
            simNodes.push(sn);
            simMap.set(n.id, sn);
            return;
        }
        const theta = idx * 2.399963; // golden angle
        const r = 90 + Math.sqrt(idx) * 80;
        const sn: SimNode = {
            id: n.id,
            x: Math.cos(theta) * r,
            y: Math.sin(theta) * r * 0.7,
            vx: 0,
            vy: 0
        };
        simNodes.push(sn);
        simMap.set(n.id, sn);
    });

    const edgePairs: Array<[SimNode, SimNode]> = [];
    edges.forEach(e => {
        const u = simMap.get(e.from);
        const v = simMap.get(e.to);
        if (u && v && u !== v) {
            edgePairs.push([u, v]);
        }
    });

    const k = 190;
    const k2 = k * k;
    const iterations = 100;

    for (let step = 0; step < iterations; step++) {
        const temp = Math.max(1, 30 * (1 - step / iterations));

        for (let i = 0; i < simNodes.length; i++) {
            const u = simNodes[i];
            for (let j = i + 1; j < simNodes.length; j++) {
                const v = simNodes[j];
                const dx = u.x - v.x;
                const dy = (u.y - v.y) * 1.5;
                const dist2 = dx * dx + dy * dy + 1;
                const dist = Math.sqrt(dist2);
                if (dist < 600) {
                    const force = k2 / dist;
                    const fx = (dx / dist) * force;
                    const fy = (dy / dist) * force;
                    u.vx += fx;
                    u.vy += fy;
                    v.vx -= fx;
                    v.vy -= fy;
                }
            }
        }

        for (let e = 0; e < edgePairs.length; e++) {
            const [u, v] = edgePairs[e];
            const dx = v.x - u.x;
            const dy = v.y - u.y;
            const dist = Math.sqrt(dx * dx + dy * dy) + 0.1;
            const force = (dist * dist) / k * 0.04;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            u.vx += fx;
            u.vy += fy;
            v.vx -= fx;
            v.vy -= fy;
        }

        for (let i = 0; i < simNodes.length; i++) {
            const u = simNodes[i];
            u.vx -= u.x * 0.025;
            u.vy -= u.y * 0.025;
        }

        for (let i = 0; i < simNodes.length; i++) {
            const u = simNodes[i];
            const vel = Math.sqrt(u.vx * u.vx + u.vy * u.vy);
            if (vel > temp) {
                u.vx = (u.vx / vel) * temp;
                u.vy = (u.vy / vel) * temp;
            }
            u.x += u.vx;
            u.y += u.vy;
            u.vx *= 0.45;
            u.vy *= 0.45;
        }
    }

    simNodes.forEach(sn => {
        positions.set(sn.id, { x: Math.round(sn.x), y: Math.round(sn.y) });
    });

    return positions;
}
