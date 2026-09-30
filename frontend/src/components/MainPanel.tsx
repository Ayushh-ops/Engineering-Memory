import { useAppStore } from '../store';
import { Card, Badge, cn, Button } from '../ui';
import { Network, Activity, Clock, FileCode, FileText, ChevronRight, Share2, Play, Send, ShieldAlert, GitCommit, Hexagon, MessageSquare, Loader2, Maximize2, Minimize2, X } from 'lucide-react';
import { useState, useCallback, useEffect, useRef } from 'react';
import { ReactFlow, useNodesState, useEdgesState, Background, Controls, useReactFlow } from '@xyflow/react';
import ForceGraph3D from 'react-force-graph-3d';
import SpriteText from 'three-spritetext';
import * as THREE from 'three';
import '@xyflow/react/dist/style.css';
import { api } from '../api';
import { isCodeFile } from '../analyze-helpers';

function ImpactGraph({ impactNodes, paths, targetNodeId }: { impactNodes: any[], paths: any[], targetNodeId?: string }) {
    // Transform to react-flow shape
    const [nodes, setNodes, onNodesChange] = useNodesState<any>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<any>([]);

    useEffect(() => {
        const layoutNodes = impactNodes.map((n, i) => ({
            id: n.id,
            position: { x: (i % 3) * 200, y: Math.floor(i / 3) * 100 },
            data: { label: n.name || n.path.split('/').pop() },
            style: {
                background: n.id === targetNodeId ? 'rgba(239, 68, 68, 0.1)' : 'rgba(39, 39, 42, 0.8)',
                border: n.id === targetNodeId ? '1px solid rgba(239, 68, 68, 0.5)' : '1px solid rgba(63, 63, 70, 0.5)',
                color: '#e5e7eb',
                borderRadius: '8px',
                padding: '10px 15px',
                fontSize: '12px',
                boxShadow: n.id === targetNodeId ? '0 0 15px rgba(239,68,68,0.2)' : 'none'
            }
        }));
        setNodes(layoutNodes as any);

        const layoutEdges = [];
        for (const p of paths) {
            for (const r of p.relationships) {
                layoutEdges.push({
                    id: r.relationshipId,
                    source: r.from,
                    target: r.to,
                    animated: true,
                    style: { stroke: 'rgba(52, 211, 153, 0.5)' }
                });
            }
        }
        setEdges(layoutEdges);
    }, [impactNodes, paths, targetNodeId, setNodes, setEdges]);

    return (
        <div className="w-full h-full bg-[#0a0a0b] rounded-lg border border-zinc-800/50 overflow-hidden relative">
            <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} fitView>
                <Background color="#27272a" gap={16} size={1} />
                <Controls className="bg-zinc-800 border-zinc-700 fill-gray-300" />
            </ReactFlow>
        </div>
    );
}

export function getLanguageBadge(filePath?: string): { label: string; color: string; bg: string; border: string } | null {
    if (!filePath) return null;
    const lower = filePath.toLowerCase();
    if (lower.endsWith('.ts')) return { label: 'TS', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.15)', border: 'rgba(56, 189, 248, 0.4)' };
    if (lower.endsWith('.tsx')) return { label: 'TSX', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.15)', border: 'rgba(56, 189, 248, 0.4)' };
    if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return { label: 'JS', color: '#facc15', bg: 'rgba(250, 204, 21, 0.15)', border: 'rgba(250, 204, 21, 0.4)' };
    if (lower.endsWith('.jsx')) return { label: 'JSX', color: '#facc15', bg: 'rgba(250, 204, 21, 0.15)', border: 'rgba(250, 204, 21, 0.4)' };
    if (lower.endsWith('.py') || lower.endsWith('.pyw')) return { label: 'PY', color: '#34d399', bg: 'rgba(52, 211, 153, 0.15)', border: 'rgba(52, 211, 153, 0.4)' };
    if (lower.endsWith('.java')) return { label: 'JAVA', color: '#fb923c', bg: 'rgba(251, 146, 60, 0.15)', border: 'rgba(251, 146, 60, 0.4)' };
    if (lower.endsWith('.go')) return { label: 'GO', color: '#22d3ee', bg: 'rgba(34, 211, 238, 0.15)', border: 'rgba(34, 211, 238, 0.4)' };
    if (lower.endsWith('.cpp') || lower.endsWith('.cc') || lower.endsWith('.cxx') || lower.endsWith('.h') || lower.endsWith('.hpp')) {
        return { label: 'C++', color: '#c084fc', bg: 'rgba(192, 132, 252, 0.15)', border: 'rgba(192, 132, 252, 0.4)' };
    }
    return null;
}

function FlowFitViewOnResize({ isFullscreen }: { isFullscreen: boolean }) {
    const { fitView } = useReactFlow();
    useEffect(() => {
        const timer = setTimeout(() => {
            fitView({ padding: 0.15, duration: 300 });
        }, 120);
        return () => clearTimeout(timer);
    }, [isFullscreen, fitView]);
    return null;
}

function OverviewGraph2D({
    graph,
    simplify,
    selectedFile,
    selectedSymbol,
    onSelectNode,
    isFullscreen
}: {
    graph: import('../api').RepositoryGraph;
    simplify: boolean;
    selectedFile: string | null;
    selectedSymbol: any;
    onSelectNode: (rawNode: any) => void;
    isFullscreen: boolean;
}) {
    const [nodes, setNodes, onNodesChange] = useNodesState<any>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<any>([]);

    useEffect(() => {
        const layoutNodes: any[] = [];

        const createNode = (n: any, pos: { x: number; y: number }) => {
            const nodePath = n.path || (n.type === 'file' ? n.id : undefined);
            const isSelected = n.type === 'file'
                ? (selectedFile === nodePath && !selectedSymbol)
                : (selectedFile === nodePath && selectedSymbol?.name === n.name);

            const langBadge = getLanguageBadge(nodePath);
            const displayName = n.name || (nodePath ? nodePath.split('/').pop() : n.id);
            const isCallable = n.type === 'function' || n.type === 'method';

            let bg = 'rgba(24, 24, 27, 0.95)';
            let border = '1px solid rgba(63, 63, 70, 0.6)';
            let boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.3)';

            if (n.type === 'file') {
                bg = 'rgba(15, 23, 42, 0.95)';
                border = '1px solid rgba(59, 130, 246, 0.5)';
            } else if (n.type === 'class') {
                bg = 'rgba(30, 20, 10, 0.95)';
                border = '1px solid rgba(245, 158, 11, 0.5)';
            } else if (isCallable) {
                bg = 'rgba(6, 30, 20, 0.95)';
                border = '1px solid rgba(16, 185, 129, 0.5)';
            }

            if (isSelected) {
                border = '2px solid rgba(56, 189, 248, 1)';
                boxShadow = '0 0 16px rgba(56, 189, 248, 0.45)';
            }

            return {
                id: n.id,
                position: pos,
                data: {
                    label: (
                        <div className="flex flex-col gap-1 min-w-[130px] max-w-[220px] text-left pointer-events-none select-none">
                            <div className="flex items-center justify-between gap-1.5">
                                <div className="flex items-center gap-1.5">
                                    <span
                                        className={cn(
                                            "w-2 h-2 rounded-full inline-block shrink-0",
                                            n.type === 'file' ? "bg-blue-400" : n.type === 'class' ? "bg-amber-400" : "bg-emerald-400"
                                        )}
                                    />
                                    <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                                        {n.type}
                                    </span>
                                </div>
                                {langBadge && (
                                    <span
                                        className="px-1 py-0.5 rounded text-[9px] font-mono font-bold leading-none shrink-0"
                                        style={{
                                            color: langBadge.color,
                                            backgroundColor: langBadge.bg,
                                            border: `1px solid ${langBadge.border}`
                                        }}
                                    >
                                        {langBadge.label}
                                    </span>
                                )}
                            </div>
                            <div
                                className="font-medium text-xs text-zinc-100 truncate"
                                title={displayName}
                            >
                                {displayName}{isCallable ? '()' : ''}
                            </div>
                            {n.type === 'file' && nodePath && (
                                <div className="text-[10px] text-zinc-500 truncate" title={nodePath}>
                                    {nodePath}
                                </div>
                            )}
                        </div>
                    ),
                    rawNode: n
                },
                style: {
                    background: bg,
                    border,
                    borderRadius: n.type === 'file' ? '8px' : '6px',
                    padding: '8px 12px',
                    boxShadow,
                    color: '#e5e7eb',
                    cursor: 'pointer'
                }
            };
        };

        if (simplify) {
            const fileNodes = graph.nodes.filter(n => n.type === 'file');
            const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(fileNodes.length))));
            const colWidth = 260;
            const rowHeight = 110;

            fileNodes.forEach((n, idx) => {
                const col = idx % cols;
                const row = Math.floor(idx / cols);
                layoutNodes.push(createNode(n, { x: 40 + col * colWidth, y: 40 + row * rowHeight }));
            });
        } else {
            // Group by file path
            const fileMap = new Map<string, { fileNode?: any; children: any[] }>();
            const orphans: any[] = [];

            graph.nodes.forEach((n: any) => {
                const path = n.path || (n.type === 'file' ? n.id : undefined);
                if (path) {
                    if (!fileMap.has(path)) {
                        fileMap.set(path, { children: [] });
                    }
                    const group = fileMap.get(path)!;
                    if (n.type === 'file') {
                        group.fileNode = n;
                    } else {
                        group.children.push(n);
                    }
                } else {
                    orphans.push(n);
                }
            });

            let currentX = 40;
            fileMap.forEach((group) => {
                const { fileNode, children } = group;
                const subCols = children.length > 6 ? 2 : 1;
                const subColWidth = 210;
                const clusterWidth = Math.max(240, subCols * subColWidth);

                if (fileNode) {
                    const fileX = currentX + Math.floor((clusterWidth - 210) / 2);
                    layoutNodes.push(createNode(fileNode, { x: fileX, y: 40 }));
                }

                children.forEach((child, idx) => {
                    const subCol = idx % subCols;
                    const subRow = Math.floor(idx / subCols);
                    const childX = currentX + subCol * subColWidth;
                    const childY = (fileNode ? 140 : 40) + subRow * 75;
                    layoutNodes.push(createNode(child, { x: childX, y: childY }));
                });

                currentX += clusterWidth + 80;
            });

            if (orphans.length > 0) {
                orphans.forEach((n, idx) => {
                    layoutNodes.push(createNode(n, { x: currentX, y: 40 + idx * 75 }));
                });
            }
        }

        const nodeIds = new Set(layoutNodes.map(n => n.id));
        const layoutEdges = graph.edges
            .filter(e => nodeIds.has(e.from) && nodeIds.has(e.to))
            .filter(e => {
                if (!simplify) return true;
                return e.type === 'imports';
            })
            .map((e: any, idx: number) => {
                let stroke = 'rgba(113, 113, 122, 0.4)';
                let strokeDasharray: string | undefined = undefined;
                let animated = false;
                let strokeWidth = 1.5;

                if (e.type === 'contains') {
                    stroke = 'rgba(59, 130, 246, 0.35)';
                    strokeDasharray = '4 3';
                    strokeWidth = 1;
                } else if (e.type === 'imports') {
                    stroke = 'rgba(245, 158, 11, 0.7)';
                    animated = true;
                    strokeWidth = 2;
                } else if (e.type === 'calls') {
                    stroke = 'rgba(16, 185, 129, 0.7)';
                    animated = true;
                    strokeWidth = 2;
                }

                return {
                    id: e.id || `edge-${e.from}-${e.to}-${e.type}-${idx}`,
                    source: e.from,
                    target: e.to,
                    animated,
                    style: {
                        stroke,
                        strokeWidth,
                        strokeDasharray
                    }
                };
            });

        setNodes(layoutNodes);
        setEdges(layoutEdges);
    }, [graph, simplify, selectedFile, selectedSymbol, setNodes, setEdges]);

    return (
        <div className="w-full h-full relative">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={(_event, node) => onSelectNode(node.data?.rawNode)}
                fitView
                minZoom={0.1}
                maxZoom={2}
            >
                <Background color="#27272a" gap={16} size={1} />
                <Controls
                    position="bottom-right"
                    className="bg-zinc-900 border-zinc-800 fill-zinc-300 [&>button]:border-zinc-800 [&>button]:bg-zinc-900 [&>button]:hover:bg-zinc-800 [&>button]:fill-zinc-300"
                />
                <FlowFitViewOnResize isFullscreen={isFullscreen} />
            </ReactFlow>
        </div>
    );
}

function OverviewGraph({ graph }: { graph: import('../api').RepositoryGraph }) {
    const { selectedFile, selectedSymbol, setSelectedFile, setSelectedSymbol } = useAppStore();
    const [viewMode, setViewMode] = useState<'2D' | '3D'>(() => {
        try {
            const saved = localStorage.getItem('graph-view-mode');
            return saved === '2D' ? '2D' : '3D';
        } catch {
            return '3D';
        }
    });
    const [isFullscreen, setIsFullscreen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const fgInstanceRef = useRef<any>(null);
    const [dimensions, setDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

    const handleViewModeChange = (mode: '2D' | '3D') => {
        setViewMode(mode);
        try {
            localStorage.setItem('graph-view-mode', mode);
        } catch {
            // ignore
        }
    };

    // Track container dimensions and handle resize/fullscreen transitions
    useEffect(() => {
        if (!containerRef.current) return;
        const updateSize = () => {
            if (!containerRef.current) return;
            const w = containerRef.current.clientWidth;
            const h = containerRef.current.clientHeight;
            if (w > 0 && h > 0) {
                setDimensions({ width: w, height: h });
            }
        };
        updateSize();

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                if (width > 0 && height > 0) {
                    setDimensions({ width: Math.floor(width), height: Math.floor(height) });
                }
            }
        });
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, [isFullscreen]);

    // Escape key listener for fullscreen
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isFullscreen) {
                setIsFullscreen(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isFullscreen]);

    // Re-fit 3D graph when dimensions change or entering/exiting fullscreen
    useEffect(() => {
        if (viewMode === '3D' && fgInstanceRef.current && dimensions.width > 0 && dimensions.height > 0) {
            const timer = setTimeout(() => {
                if (fgInstanceRef.current && typeof fgInstanceRef.current.zoomToFit === 'function') {
                    fgInstanceRef.current.zoomToFit(400, 40);
                }
            }, 120);
            return () => clearTimeout(timer);
        }
    }, [isFullscreen, dimensions.width, dimensions.height, viewMode]);

    const handleSelectNode = useCallback((node: any) => {
        if (!node) return;
        const nodePath = node.path || (node.type === 'file' ? node.id : undefined);
        if (node.type === 'file' && nodePath) {
            setSelectedFile(nodePath);
            setSelectedSymbol(null);
        } else if ((node.type === 'class' || node.type === 'function' || node.type === 'method') && nodePath) {
            setSelectedFile(nodePath);
            setSelectedSymbol({ name: node.name, type: node.type, path: nodePath });
        }
    }, [setSelectedFile, setSelectedSymbol]);

    const [graphData, setGraphData] = useState({ nodes: [], links: [] });
    const [simplify, setSimplify] = useState(false);
    const [highlightNodes, setHighlightNodes] = useState(new Set());
    const [highlightLinks, setHighlightLinks] = useState(new Set());
    const [hoverNode, setHoverNode] = useState<any>(null);

    const fgRef = (useCallback as any)((fg: any) => {
        if (fg) {
            fgInstanceRef.current = fg;
            fg.d3Force('charge').strength(-120);
            fg.d3Force('link').distance(40);
            fg.controls().autoRotate = true;
            fg.controls().autoRotateSpeed = 0.5;
            fg.controls().addEventListener('start', () => { fg.controls().autoRotate = false; });
            if (typeof fg.zoomToFit === 'function') {
                setTimeout(() => fg.zoomToFit(400, 40), 200);
            }
        }
    }, [simplify]);

    useEffect(() => {
        const connCount = new Map();
        graph.edges.forEach(e => {
            connCount.set(e.from, (connCount.get(e.from) || 0) + 1);
            connCount.set(e.to, (connCount.get(e.to) || 0) + 1);
        });

        // Filter for simplify
        const nodes = graph.nodes.filter(n => !simplify || n.type === 'file').map((n: any) => {
            let color = 'rgba(161, 161, 170, 1)'; // default
            let val = 1;
            if (n.type === 'file') {
                color = 'rgba(59, 130, 246, 1)';
                val = 4;
            } else if (n.type === 'class') {
                color = 'rgba(245, 158, 11, 1)';
                val = 2;
            } else if (n.type === 'function' || n.type === 'method') {
                color = 'rgba(16, 185, 129, 1)';
                val = 1;
            }

            const nodePath = n.path || (n.type === 'file' ? n.id : undefined);

            return {
                id: n.id,
                name: n.name || (nodePath ? nodePath.split('/').pop() : n.id),
                path: nodePath,
                color,
                val,
                type: n.type,
                connections: connCount.get(n.id) || 0,
                neighbors: new Set<string>(),
                links: [] as any[]
            };
        });

        const nodeMap = new Map(nodes.map(n => [n.id, n]));

        const links = graph.edges
            .filter(e => {
                if (!simplify) return true;
                return e.type === 'imports' && nodeMap.has(e.from) && nodeMap.has(e.to);
            })
            .map((e: any) => {
                let color = 'rgba(113, 113, 122, 0.4)';
                if (e.type === 'contains') color = 'rgba(59, 130, 246, 0.2)';
                else if (e.type === 'imports') color = 'rgba(245, 158, 11, 0.6)';
                else if (e.type === 'calls') color = 'rgba(16, 185, 129, 0.4)';

                const link = { source: e.from, target: e.to, type: e.type, color };
                if (nodeMap.has(e.from) && nodeMap.has(e.to)) {
                    nodeMap.get(e.from)!.neighbors.add(e.to);
                    nodeMap.get(e.to)!.neighbors.add(e.from);
                    nodeMap.get(e.from)!.links.push(link);
                    nodeMap.get(e.to)!.links.push(link);
                }
                return link;
            });

        setGraphData({ nodes, links } as any);
        setHighlightNodes(new Set());
        setHighlightLinks(new Set());
    }, [graph, simplify]);

    const handleNodeClick = (node: any) => {
        const newHighlightNodes = new Set();
        const newHighlightLinks = new Set();

        if (highlightNodes.has(node.id)) {
            // toggle off
        } else {
            newHighlightNodes.add(node.id);
            node.neighbors.forEach((neighbor: string) => newHighlightNodes.add(neighbor));
            node.links.forEach((link: any) => newHighlightLinks.add(link));
        }

        setHighlightNodes(newHighlightNodes);
        setHighlightLinks(newHighlightLinks);

        // Sync with store
        handleSelectNode(node);
    };

    return (
        <div
            ref={containerRef}
            className={cn(
                "bg-[#0a0a0b] overflow-hidden relative select-none",
                isFullscreen
                    ? "fixed inset-0 z-50 w-screen h-screen flex flex-col"
                    : "w-full h-full rounded-lg border border-zinc-800/50"
            )}
            style={{ cursor: viewMode === '3D' ? 'grab' : 'default' }}
        >
            {/* View Mode & Fullscreen Toolbar */}
            <div className="absolute top-4 left-4 z-20 bg-zinc-900/90 backdrop-blur border border-zinc-800 rounded-lg p-1 flex items-center gap-1 shadow-xl">
                <button
                    onClick={() => handleViewModeChange('2D')}
                    className={cn(
                        "px-3 py-1 text-xs font-semibold rounded transition-colors flex items-center gap-1 cursor-pointer",
                        viewMode === '2D'
                            ? "bg-blue-600 text-white shadow-sm"
                            : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                    )}
                >
                    2D
                </button>
                <button
                    onClick={() => handleViewModeChange('3D')}
                    className={cn(
                        "px-3 py-1 text-xs font-semibold rounded transition-colors flex items-center gap-1 cursor-pointer",
                        viewMode === '3D'
                            ? "bg-blue-600 text-white shadow-sm"
                            : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                    )}
                >
                    3D
                </button>
                <div className="h-4 w-[1px] bg-zinc-700/60 mx-0.5" />
                <button
                    onClick={() => setIsFullscreen(!isFullscreen)}
                    className={cn(
                        "p-1.5 text-xs font-semibold rounded transition-colors flex items-center justify-center cursor-pointer",
                        isFullscreen
                            ? "bg-blue-600 text-white shadow-sm"
                            : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                    )}
                    title={isFullscreen ? "Exit Fullscreen (Esc)" : "Expand Fullscreen (Esc to exit)"}
                >
                    {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                </button>
            </div>

            {/* Exit Fullscreen Close Button */}
            {isFullscreen && (
                <button
                    onClick={() => setIsFullscreen(false)}
                    className="absolute top-4 right-4 z-30 px-3 py-1.5 bg-zinc-900/95 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white rounded-lg transition-colors shadow-2xl flex items-center gap-1.5 text-xs font-medium cursor-pointer"
                    title="Exit Fullscreen (Esc)"
                >
                    <X size={14} />
                    <span>Exit Fullscreen</span>
                </button>
            )}

            {/* Instruction Hints */}
            <div className={cn(
                "absolute bg-zinc-900/80 backdrop-blur border border-zinc-800 rounded-lg p-2 text-[10px] text-zinc-400 pointer-events-none z-10 shadow-xl text-right",
                isFullscreen ? "top-16 right-4" : "top-4 right-4"
            )}>
                {viewMode === '3D' ? (
                    <>
                        <div>Left-click: Rotate • Right-click: Pan • Scroll: Zoom</div>
                        <div className="mt-1 text-emerald-500/80">Click node to highlight & select</div>
                    </>
                ) : (
                    <>
                        <div>Drag: Pan • Scroll: Zoom • Bottom-right: Controls</div>
                        <div className="mt-1 text-emerald-500/80">Click node to select file / symbol</div>
                    </>
                )}
            </div>

            {/* Main Graph View: 2D or 3D */}
            {viewMode === '2D' ? (
                <OverviewGraph2D
                    graph={graph}
                    simplify={simplify}
                    selectedFile={selectedFile}
                    selectedSymbol={selectedSymbol}
                    onSelectNode={handleSelectNode}
                    isFullscreen={isFullscreen}
                />
            ) : (
                <ForceGraph3D
                    ref={fgRef as any}
                    graphData={graphData}
                    width={dimensions.width > 0 ? dimensions.width : undefined}
                    height={dimensions.height > 0 ? dimensions.height : undefined}
                    nodeRelSize={4}
                    nodeAutoColorBy="group"
                    nodeColor={(node: any) => highlightNodes.size === 0 || highlightNodes.has(node.id) ? node.color : 'rgba(39, 39, 42, 0.2)'}
                    nodeVal={(node: any) => node.val}
                    linkColor={(link: any) => highlightNodes.size === 0 || highlightLinks.has(link) ? link.color : 'rgba(39, 39, 42, 0.1)'}
                    linkWidth={(link: any) => highlightLinks.has(link) ? 2 : 0.5}
                    linkDirectionalParticles={2}
                    linkDirectionalParticleWidth={(link: any) => highlightLinks.has(link) ? 2 : 0.8}
                    backgroundColor="#0a0a0b"
                    onNodeClick={handleNodeClick}
                    onNodeHover={(n: any) => setHoverNode(n || null)}
                    nodeThreeObject={(node: any) => {
                        const isHighlight = highlightNodes.size === 0 || highlightNodes.has(node.id);
                        if (!isHighlight) {
                            return new THREE.Mesh(
                                new THREE.SphereGeometry(Math.pow(node.val, 1 / 3) * 4),
                                new THREE.MeshLambertMaterial({ color: node.color, opacity: 0.1, transparent: true })
                            );
                        }

                        const group = new THREE.Group();
                        // Draw sphere
                        const geometry = new THREE.SphereGeometry(Math.pow(node.val, 1 / 3) * 4);
                        const material = new THREE.MeshLambertMaterial({ color: node.color });
                        const sphere = new THREE.Mesh(geometry, material);
                        group.add(sphere);

                        // Add text if important
                        if (node.type === 'file' || node.connections > 5 || hoverNode === node || highlightNodes.has(node.id)) {
                            const badge = getLanguageBadge(node.path);
                            const labelText = badge ? `[${badge.label}] ${node.name}` : node.name;
                            const sprite = new SpriteText(labelText);
                            sprite.color = '#e5e7eb';
                            sprite.textHeight = node.type === 'file' ? 6 : 4;
                            sprite.position.y = Math.pow(node.val, 1 / 3) * 4 + 4;
                            sprite.renderOrder = 999;
                            sprite.material.depthTest = false;
                            group.add(sprite);
                        }

                        return group;
                    }}
                />
            )}

            {/* Legend and Toggle */}
            <div className="absolute bottom-4 left-4 bg-zinc-900/80 backdrop-blur border border-zinc-800 rounded-lg p-3 text-xs space-y-3 z-10 shadow-xl max-w-xs">
                <div className="space-y-1.5">
                    <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-blue-500/80"></div> <span className="text-zinc-200">File</span></div>
                    <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-amber-500/80"></div> <span className="text-zinc-200">Class</span></div>
                    <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-emerald-500/80"></div> <span className="text-zinc-200">Function/Method</span></div>
                </div>

                <div className="pt-2 border-t border-zinc-800/60 space-y-1 text-[11px] text-zinc-400">
                    <div className="flex items-center gap-2"><div className="w-3 h-0.5 border-t border-dashed border-blue-400/80"></div> <span>contains</span></div>
                    <div className="flex items-center gap-2"><div className="w-3 h-0.5 bg-amber-400"></div> <span>imports</span></div>
                    <div className="flex items-center gap-2"><div className="w-3 h-0.5 bg-emerald-400"></div> <span>calls</span></div>
                </div>

                <div className="pt-2 border-t border-zinc-800 flex items-center justify-between">
                    <span className="text-zinc-400">Simplify Graph</span>
                    <button onClick={() => setSimplify(!simplify)} className={cn("relative inline-flex h-4 w-7 items-center rounded-full transition-colors cursor-pointer", simplify ? "bg-emerald-500" : "bg-zinc-700")}>
                        <span className={cn("inline-block h-3 w-3 transform rounded-full bg-white transition-transform", simplify ? "translate-x-3.5" : "translate-x-0.5")} />
                    </button>
                </div>
            </div>
        </div>
    );
}

export function MainPanel({ className }: { className?: string }) {
    const { activeTab, setActiveTab, selectedFile, selectedSymbol, impactResult, setImpactResult, graph, repoUrl, selectedSha } = useAppStore();
    const [depth, setDepth] = useState(3);
    const [maxRes, setMaxRes] = useState(50);
    const [analyzing, setAnalyzing] = useState(false);
    const [askQ, setAskQ] = useState('');
    const [aiAnswer, setAiAnswer] = useState<string | null>(null);
    const [historyData, setHistoryData] = useState<any[] | null>(null);
    const [connectionsData, setConnectionsData] = useState<any>(null);

    const reanalyze = async () => {
        if (!graph || !selectedFile) return;
        setAnalyzing(true);
        try {
            const target = selectedSymbol
                ? { type: 'symbol', path: selectedSymbol.path, symbol: selectedSymbol }
                : { type: 'file', path: selectedFile };
            const res = await api.graph.impact(graph, target as any, { maxDepth: depth, maxResults: maxRes });
            setImpactResult(res);
        } catch (e) {
            console.error(e);
        } finally {
            setAnalyzing(false);
        }
    };

    const askAI = async () => {
        if (!askQ || !repoUrl || !selectedSha || !graph || !selectedFile) return;
        setAiAnswer("Thinking...");
        const target = selectedSymbol
            ? { type: 'symbol', path: selectedSymbol.path, symbol: selectedSymbol }
            : { type: 'file', path: selectedFile };

        try {
            const res = await api.ai.ask(repoUrl, selectedSha, [selectedFile], target as any, askQ);
            setAiAnswer(res.answer);
        } catch (e: any) {
            const msg = e instanceof Error ? e.message : (e && typeof e === 'object' && e.message ? e.message : (typeof e === 'object' ? JSON.stringify(e) : String(e)));
            setAiAnswer(`Error: ${msg}`);
        }
    };

    const fetchHistory = useCallback(async () => {
        if (!repoUrl || !selectedSha || !selectedFile) return;
        try {
            const res = await api.repositories.analyzeHistory(repoUrl, selectedSha, [selectedFile]);

            // Fix: res is RepositoryHistoricalAnalysisResult
            if (res && res.files && res.files.length > 0) {
                const fileChange = res.files[0];
                if (fileChange.applicable && fileChange.changes && fileChange.changes.length > 0) {
                    let added = 0, modified = 0, removed = 0;
                    fileChange.changes.forEach((c: any) => {
                        if (c.type === 'added') added++;
                        if (c.type === 'modified') modified++;
                        if (c.type === 'removed') removed++;
                    });

                    setHistoryData([{
                        message: `Structural changes in ${selectedFile.split('/').pop()}`,
                        sha: selectedSha,
                        authorName: 'AST Diff',
                        changes: { added, modified, removed },
                        details: fileChange.changes
                    }]);
                } else {
                    setHistoryData([]);
                }
            } else {
                setHistoryData([]);
            }
        } catch (e) {
            console.error(e);
            setHistoryData([]);
        }
    }, [repoUrl, selectedSha, selectedFile]);

    useEffect(() => {
        if (activeTab === 'History') fetchHistory();
    }, [activeTab, fetchHistory]);

    const fetchConnections = useCallback(async () => {
        if (!graph || !selectedFile) return;
        try {
            const imports = await api.graph.query(graph, { type: 'file-imports', path: selectedFile });
            const dependents = await api.graph.query(graph, { type: 'file-dependents', path: selectedFile });
            setConnectionsData({ imports: imports.files || [], dependents: dependents.files || [] });
        } catch (e) {
            console.error(e);
            setConnectionsData({ imports: [], dependents: [] });
        }
    }, [graph, selectedFile]);

    useEffect(() => {
        if (activeTab === 'Connections') fetchConnections();
    }, [activeTab, fetchConnections]);

    const isCode = selectedFile ? isCodeFile(selectedFile) : false;

    // We will render the frame of MainPanel even if no file is selected so tabs work
    // and give visual feedback.

    return (
        <div className={cn("flex flex-col bg-[#0a0a0b]", className)}>
            {/* Header / Breadcrumb */}
            <div className="p-4 border-b border-zinc-800">
                <div className="flex items-center gap-2 text-xs text-zinc-500 mb-3 min-h-[16px]">
                    {selectedFile && selectedFile.split('/').map((part, i, arr) => (
                        <span key={i} className="flex items-center gap-2">
                            <span className="hover:text-zinc-300 cursor-pointer">{part}</span>
                            {i < arr.length - 1 && <ChevronRight size={12} />}
                        </span>
                    ))}
                </div>
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-blue-500/10 flex items-center justify-center">
                        {isCode ? <FileCode size={16} className="text-blue-400" /> : <FileText size={16} className="text-blue-400" />}
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-gray-100">{selectedFile ? (selectedSymbol ? `${selectedSymbol.name}()` : selectedFile.split('/').pop()) : "No file selected"}</h2>
                        <div className="flex gap-2 items-center mt-1">
                            {selectedSymbol && <Badge variant="blue">{selectedSymbol.type}</Badge>}
                            <span className="text-xs text-zinc-500">{selectedFile || "Select a file from the tree"}</span>
                        </div>
                    </div>
                </div>

                <div className="flex gap-4 mt-6">
                    {[
                        { id: 'Overview', icon: Hexagon, label: 'Graph' },
                        { id: 'Impact', icon: Activity, label: 'Impact' },
                        { id: 'Connections', icon: Network, label: 'Connections' },
                        { id: 'History', icon: Clock, label: 'History' },
                        { id: 'AskAI', icon: MessageSquare, label: 'Ask AI' }
                    ].map(t => {
                        const Icon = t.icon;
                        return (
                            <button
                                key={t.id} onClick={() => setActiveTab(t.id as any)}
                                className={cn("text-xs font-semibold pb-2 border-b-2 transition-colors flex items-center gap-1.5", activeTab === t.id ? "border-emerald-500 text-emerald-400" : "border-transparent text-zinc-400 hover:text-zinc-200")}
                            >
                                <Icon size={14} />
                                {t.label}
                            </button>
                        )
                    })}
                </div>
            </div>

            {/* Content */}
            <div className={cn("flex-1 p-4 overflow-y-auto scrollbar-custom", activeTab === 'Overview' && "flex flex-col min-h-0 overflow-hidden")}>
                <>
                    {activeTab === 'Impact' && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-lg font-bold text-gray-200">What could this change affect?</h3>
                                    <p className="text-xs text-zinc-400 mt-1">This analysis shows all files and symbols affected if you modify {selectedSymbol?.name || 'this'}.</p>
                                </div>
                                <div className="flex items-center gap-4 bg-[#121214] p-2 pr-2 rounded-lg border border-zinc-800">
                                    <div className="flex flex-col">
                                        <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 px-1">Analysis Depth</label>
                                        <select title="How many levels deep to trace transitive calls and dependencies" value={depth} onChange={(e) => setDepth(parseInt(e.target.value))} className="cursor-help bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-gray-300 outline-none focus:border-zinc-700">
                                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(d => <option key={d} value={d}>{d}</option>)}
                                        </select>
                                    </div>
                                    <div className="flex flex-col">
                                        <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 px-1">Max Results</label>
                                        <select title="Cap the number of total impact results returned" value={maxRes} onChange={(e) => setMaxRes(parseInt(e.target.value))} className="cursor-help bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-gray-300 outline-none focus:border-zinc-700">
                                            {[10, 50, 100, 500].map(d => <option key={d} value={d}>{d}</option>)}
                                        </select>
                                    </div>
                                    <Button onClick={reanalyze} className="mt-4 px-3 py-1 text-xs flex items-center gap-1 min-w-[90px] justify-center" disabled={analyzing}>
                                        {analyzing ? <Loader2 size={12} className="animate-spin" /> : 'Re-analyze'}
                                    </Button>
                                </div>
                            </div>

                            {analyzing ? (
                                <div className="text-zinc-500 py-20 flex flex-col items-center gap-3">
                                    <Loader2 size={32} className="animate-spin text-zinc-700" />
                                    Calculating impact paths...
                                </div>
                            ) : impactResult ? (
                                impactResult.targetNodeId ? (
                                    <>
                                        <div className="grid grid-cols-4 gap-4">
                                            <Card className="flex flex-col justify-center gap-1 bg-red-500/5 border-red-500/20">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-6 h-6 rounded-full bg-red-500/20 flex items-center justify-center"><Network size={12} className="text-red-400" /></div>
                                                    <span className="text-xl font-bold text-red-100">{impactResult.directCallers.length}</span>
                                                </div>
                                                <div className="text-[11px] text-zinc-400 ml-8">Direct callers</div>
                                            </Card>
                                            <Card className="flex flex-col justify-center gap-1 bg-blue-500/5 border-blue-500/20">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center"><Share2 size={12} className="text-blue-400" /></div>
                                                    <span className="text-xl font-bold text-blue-100">{impactResult.transitiveConsumers.length}</span>
                                                </div>
                                                <div className="text-[11px] text-zinc-400 ml-8">Transitive consumers</div>
                                            </Card>
                                        </div>

                                        <div className="h-[400px]">
                                            <ImpactGraph impactNodes={impactResult.impactNodes} paths={impactResult.paths} targetNodeId={impactResult.targetNodeId} />
                                        </div>

                                        <div>
                                            <h4 className="text-sm font-semibold mb-3 flex items-center gap-2"><Network size={14} className="text-emerald-500" /> Impact Paths</h4>
                                            <div className="space-y-1 bg-[#121214] rounded-lg border border-zinc-800 p-2">
                                                {impactResult.paths.map((p, i) => (
                                                    <div key={p.id} className="flex items-center justify-between py-2 px-3 hover:bg-zinc-800/50 rounded cursor-pointer group">
                                                        <div className="flex items-center gap-3">
                                                            <span className="text-xs text-zinc-600 bg-zinc-900 w-5 h-5 rounded-full flex items-center justify-center">{i + 1}</span>
                                                            <span className="text-xs text-red-400">{p.nodes[0] || 'target'}</span>
                                                            <ChevronRight size={12} className="text-zinc-600" />
                                                            <span className="text-xs text-zinc-300">{p.nodes[p.nodes.length - 1]}</span>
                                                        </div>
                                                        <div className="flex items-center gap-4">
                                                            <Badge>Depth {p.depth}</Badge>
                                                            <span className="text-[10px] text-zinc-500 group-hover:text-emerald-400 transition-colors">View path &rarr;</span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <div className="space-y-6">
                                        <div className="space-y-2">
                                            <h4 className="text-sm font-semibold flex items-center gap-2 text-zinc-300"><Share2 size={14} className="text-blue-400" /> Related Dependencies ({impactResult.relatedDependencies?.length || 0})</h4>
                                            <div className="space-y-1 bg-[#121214] rounded-lg border border-zinc-800 p-2 text-sm text-zinc-400 max-h-60 overflow-y-auto">
                                                {impactResult.relatedDependencies && impactResult.relatedDependencies.length > 0 ? impactResult.relatedDependencies.map((rd, i) => (
                                                    <div key={i} className="py-2 px-3 hover:bg-zinc-800/50 rounded">{rd}</div>
                                                )) : "No related dependencies found."}
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <h4 className="text-sm font-semibold flex items-center gap-2 text-zinc-300"><Activity size={14} className="text-emerald-400" /> Files to Review ({impactResult.reviewCandidates?.length || 0})</h4>
                                            <div className="space-y-1 bg-[#121214] rounded-lg border border-zinc-800 p-2 text-sm text-zinc-400 max-h-60 overflow-y-auto">
                                                {impactResult.reviewCandidates && impactResult.reviewCandidates.length > 0 ? impactResult.reviewCandidates.map((rc, i) => (
                                                    <div key={i} className="py-2 px-3 hover:bg-zinc-800/50 rounded text-red-300">{rc}</div>
                                                )) : "No review candidates identified."}
                                            </div>
                                        </div>
                                    </div>
                                )
                            ) : (
                                <div className="text-sm text-zinc-500 text-center py-20 flex flex-col items-center gap-3 bg-[#121214] rounded-lg border border-zinc-800/50 border-dashed">
                                    <Button onClick={reanalyze} variant="secondary">Run file-level analysis on {selectedFile?.split('/').pop()}</Button>
                                    {graph && !selectedSymbol && selectedFile && (() => {
                                        const fileSymbols = graph.nodes.filter(n => (n.type === 'class' || n.type === 'function' || n.type === 'method') && (n as any).path === selectedFile);
                                        if (fileSymbols.length) {
                                            return <span className="text-xs text-zinc-500 mt-2">Or select a specific symbol in the graph to analyze it.</span>
                                        }
                                        return null;
                                    })()}
                                    {!selectedFile && <span className="text-xs text-zinc-600">Please select a file from the Sidebar first.</span>}
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'AskAI' && (
                        <div className="flex flex-col border border-zinc-800 rounded-lg bg-[#121214] overflow-hidden" style={{ minHeight: '400px' }}>
                            <div className="p-4 bg-purple-500/10 border-b border-purple-500/20 flex items-center gap-2 text-purple-400 text-sm font-semibold">
                                <Activity size={18} /> Ask AI about this file
                            </div>
                            <div className="flex-1 p-4 overflow-y-auto text-sm text-gray-300 space-y-4">
                                {aiAnswer ? (
                                    <div className="whitespace-pre-wrap">{aiAnswer}</div>
                                ) : (
                                    <div className="text-zinc-500 text-center py-12 flex flex-col items-center gap-3">
                                        <Send size={32} className="text-zinc-700" />
                                        Ask a question to understand the impact of modifying {selectedSymbol?.name || 'this file'}.
                                    </div>
                                )}
                            </div>
                            <div className="p-3 border-t border-zinc-800 bg-black/20">
                                <div className="relative">
                                    <input
                                        value={askQ} onChange={e => setAskQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && askAI()}
                                        placeholder={`e.g. What does ${selectedSymbol?.name || 'this'} do?`}
                                        className="w-full bg-zinc-900 border border-zinc-700 rounded-md py-3 pl-4 pr-12 text-sm text-gray-200 focus:outline-none focus:border-purple-500 transition-colors"
                                    />
                                    <button onClick={askAI} className="absolute right-3 top-1/2 -translate-y-1/2 text-purple-400 hover:text-purple-300"><Send size={16} /></button>
                                </div>
                            </div>
                            <div className="p-2 text-center flex items-center justify-center gap-1 text-[10px] text-zinc-600 bg-black pb-3">
                                <ShieldAlert size={12} /> AI-generated · unverified. Verify important details from the code and evidence.
                            </div>
                        </div>
                    )}

                    {activeTab === 'History' && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-bold text-gray-200">File History</h3>
                                <span className="text-xs text-zinc-500 italic">Showing changes in commit <span className="text-emerald-400 font-mono">{selectedSha?.substring(0, 7)}</span> vs its parent — switch commits left to see other changes.</span>
                            </div>
                            {!historyData ? (
                                <div className="text-zinc-500 py-10 flex flex-col items-center justify-center gap-3"><Loader2 size={24} className="animate-spin text-zinc-700" />Fetching commit history...</div>
                            ) : historyData.length === 0 ? (
                                <div className="text-zinc-500 text-center py-10">No applicable history found for this file.</div>
                            ) : (
                                <div className="space-y-4">
                                    {historyData.map((commit: any, i) => (
                                        <div key={i} className="flex flex-col gap-2 p-4 bg-[#121214] rounded-lg border border-zinc-800">
                                            <div className="flex justify-between items-center w-full">
                                                <div className="flex items-center gap-3 w-full">
                                                    <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center shrink-0">
                                                        <GitCommit className="text-zinc-500" size={16} />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="font-semibold text-gray-300 truncate">{commit.message}</div>
                                                        <div className="text-xs text-zinc-500 flex gap-2">
                                                            <span className="text-emerald-400 font-mono">{commit.sha.substring(0, 7)}</span>
                                                            <span>•</span>
                                                            <span>{commit.authorName}</span>
                                                        </div>
                                                    </div>
                                                    <div className="flex gap-2">
                                                        {commit.changes?.added > 0 && <Badge variant="emerald">+{commit.changes.added}</Badge>}
                                                        {commit.changes?.modified > 0 && <Badge variant="blue">~{commit.changes.modified}</Badge>}
                                                        {commit.changes?.removed > 0 && <Badge variant="red">-{commit.changes.removed}</Badge>}
                                                    </div>
                                                </div>
                                            </div>
                                            {commit.details && commit.details.length > 0 && (
                                                <div className="mt-3 space-y-1.5 pl-14 w-full text-xs">
                                                    {commit.details.map((dt: any, idx: number) => (
                                                        <div key={idx} className="flex items-center justify-between py-1.5 px-3 border border-zinc-800/50 bg-zinc-900/30 rounded">
                                                            <div className="flex items-center gap-2">
                                                                <span className={cn(
                                                                    "w-2 h-2 rounded-full",
                                                                    dt.type === 'added' ? 'bg-emerald-500' : dt.type === 'modified' ? 'bg-blue-500' : 'bg-red-500'
                                                                )} />
                                                                <span className="text-zinc-300 font-mono">{dt.name}</span>
                                                            </div>
                                                            <Badge variant={dt.symbolType === 'class' ? 'amber' : 'emerald'}>{dt.symbolType}</Badge>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'Connections' && (
                        <div className="space-y-4">
                            <h3 className="text-lg font-bold text-gray-200">File Connections</h3>
                            {!connectionsData ? (
                                <div className="text-zinc-500 py-10 flex flex-col items-center justify-center gap-3"><Loader2 size={24} className="animate-spin text-zinc-700" />Mapping file dependencies...</div>
                            ) : (
                                <div className="grid grid-cols-2 gap-6">
                                    <div className="space-y-2">
                                        <h4 className="text-sm font-semibold text-zinc-400">Imports ({connectionsData.imports.length})</h4>
                                        {connectionsData.imports.length === 0 ? <div className="text-xs text-zinc-600">No imports found</div> : connectionsData.imports.map((f: any, i: number) => (
                                            <div key={i} className="flex gap-2 items-center p-2 border border-zinc-800 bg-[#121214] rounded text-sm text-gray-300">
                                                <FileCode size={14} className="text-blue-400" />
                                                <span className="truncate">{f.path}</span>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="space-y-2">
                                        <h4 className="text-sm font-semibold text-zinc-400">Dependents ({connectionsData.dependents.length})</h4>
                                        {connectionsData.dependents.length === 0 ? <div className="text-xs text-zinc-600">No dependents found</div> : connectionsData.dependents.map((f: any, i: number) => (
                                            <div key={i} className="flex gap-2 items-center p-2 border border-zinc-800 bg-[#121214] rounded text-sm text-gray-300">
                                                <FileCode size={14} className="text-blue-400" />
                                                <span className="truncate">{f.path}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'Overview' && (
                        <div className="flex-1 w-full h-full min-h-0 relative">
                            {graph ? (
                                <OverviewGraph graph={graph} />
                            ) : (
                                <div className="text-zinc-500 text-center py-20 text-sm flex flex-col items-center gap-3">
                                    <Hexagon size={32} className="text-zinc-700" />
                                    <div>No graph overview available for this file yet.</div>
                                    <div className="text-xs text-zinc-600">Select a file from the sidebar to analyze it.</div>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab !== 'Overview' && activeTab !== 'Impact' && activeTab !== 'AskAI' && activeTab !== 'History' && activeTab !== 'Connections' && (
                        <div className="text-zinc-500 text-center py-20 text-sm">
                            Feature not yet implemented.
                        </div>
                    )}
                </>
            </div>
        </div>
    );
}
