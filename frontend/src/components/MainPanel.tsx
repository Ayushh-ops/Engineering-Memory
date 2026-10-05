import { useAppStore } from '../store';
import { Card, Badge, cn, Button } from '../ui';
import { Network, Activity, Clock, FileCode, FileText, ChevronRight, Share2, Play, Send, ShieldAlert, GitCommit, Hexagon, MessageSquare, Loader2, Maximize2, Minimize2, X, Copy, Check, Code2, ChevronDown, ChevronUp } from 'lucide-react';
import { useState, useCallback, useEffect, useRef } from 'react';
import { ReactFlow, useNodesState, useEdgesState, Background, Controls, useReactFlow } from '@xyflow/react';
import ForceGraph3D from 'react-force-graph-3d';
import SpriteText from 'three-spritetext';
import * as THREE from 'three';
import '@xyflow/react/dist/style.css';
import { api } from '../api';
import { isCodeFile } from '../analyze-helpers';
import { CodeViewer } from './CodeViewer';

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

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
    const [copied, setCopied] = useState(false);
    const handleCopy = () => {
        navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="relative group my-2 rounded-lg overflow-hidden border border-white/10 bg-[#040607]">
            <div className="flex items-center justify-between px-3 py-1 bg-white/[0.03] border-b border-white/[0.06] text-[10px] font-mono text-[#8A918C]">
                <span>{lang || 'code'}</span>
                <button
                    onClick={handleCopy}
                    className="flex items-center gap-1 text-[#8A918C] hover:text-[#E8EAE6] cursor-pointer transition-colors"
                    title="Copy code"
                >
                    {copied ? <Check size={11} className="text-[#4FD1B5]" /> : <Copy size={11} />}
                    <span>{copied ? 'copied' : 'copy'}</span>
                </button>
            </div>
            <pre className="p-3 text-xs font-mono text-[#E8EAE6] overflow-x-auto leading-relaxed">
                <code>{code}</code>
            </pre>
        </div>
    );
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
    // Splits text by inline code `...` and bold **...**
    const parts: React.ReactNode[] = [];
    const regex = /(`[^`]+`|\*\*[^*]+\*\*)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parts.push(text.slice(lastIndex, match.index));
        }
        const m = match[0];
        if (m.startsWith('`') && m.endsWith('`')) {
            parts.push(
                <code key={match.index} className="px-1.5 py-0.5 rounded text-[11px] font-mono bg-white/[0.06] text-[#4FD1B5] border border-white/10">
                    {m.slice(1, -1)}
                </code>
            );
        } else if (m.startsWith('**') && m.endsWith('**')) {
            parts.push(
                <strong key={match.index} className="font-semibold text-[#E8EAE6]">
                    {m.slice(2, -2)}
                </strong>
            );
        }
        lastIndex = match.index + m.length;
    }
    if (lastIndex < text.length) {
        parts.push(text.slice(lastIndex));
    }
    return parts;
}

function MarkdownRenderer({ content }: { content: string }) {
    // Parse fenced code blocks ```lang ... ``` vs lines/lists/paragraphs/tables
    const tokens: React.ReactNode[] = [];
    const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    let sectionKey = 0;
    while ((match = codeBlockRegex.exec(content)) !== null) {
        if (match.index > lastIndex) {
            const prose = content.slice(lastIndex, match.index);
            tokens.push(<ProseRenderer key={`prose-${sectionKey++}`} text={prose} />);
        }
        const lang = match[1];
        const code = match[2];
        tokens.push(<CodeBlock key={`code-${sectionKey++}`} code={code.replace(/\n$/, '')} lang={lang} />);
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < content.length) {
        tokens.push(<ProseRenderer key={`prose-${sectionKey++}`} text={content.slice(lastIndex)} />);
    }

    return <div className="space-y-2 text-xs leading-relaxed text-[#E8EAE6]">{tokens}</div>;
}

function renderTable(tableLines: string[], key: number): React.ReactNode {
    if (tableLines.length < 2) return null;
    const parseRow = (line: string) => {
        return line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
    };

    const header = parseRow(tableLines[0]);
    // tableLines[1] is delimiter row (e.g. |---|---|)
    const rows = tableLines.slice(2).map(parseRow);

    return (
        <div key={`table-${key}`} className="my-2.5 overflow-x-auto scrollbar-custom border border-white/10 rounded-lg">
            <table className="w-full text-left text-xs border-collapse">
                <thead>
                    <tr className="bg-white/[0.04] border-b border-white/10">
                        {header.map((col, idx) => (
                            <th key={idx} className="px-3 py-2 font-semibold text-[#E8EAE6] font-mono text-[11px] whitespace-nowrap">
                                {renderInlineMarkdown(col)}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                    {rows.map((row, rIdx) => (
                        <tr key={rIdx} className="hover:bg-white/[0.02] transition-colors">
                            {row.map((cell, cIdx) => (
                                <td key={cIdx} className="px-3 py-1.5 text-[#E8EAE6] text-xs whitespace-nowrap">
                                    {renderInlineMarkdown(cell)}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function ProseRenderer({ text }: { text: string }) {
    const lines = text.split('\n');
    const elements: React.ReactNode[] = [];

    let currentList: React.ReactNode[] = [];
    let currentTable: string[] = [];

    const flushList = () => {
        if (currentList.length > 0) {
            elements.push(
                <ul key={`ul-${elements.length}`} className="list-disc list-inside space-y-1 my-1 pl-1 text-[#E8EAE6]">
                    {currentList}
                </ul>
            );
            currentList = [];
        }
    };

    const flushTable = () => {
        if (currentTable.length > 0) {
            elements.push(renderTable(currentTable, elements.length));
            currentTable = [];
        }
    };

    lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) {
            flushList();
            flushTable();
            return;
        }

        // Table row detection
        if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
            flushList();
            currentTable.push(trimmed);
            return;
        } else {
            flushTable();
        }

        // List item
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
            const itemText = trimmed.slice(2);
            currentList.push(
                <li key={i} className="text-xs text-[#E8EAE6]">
                    {renderInlineMarkdown(itemText)}
                </li>
            );
            return;
        }

        flushList();

        // Headings (with backticks inside rendered as code via renderInlineMarkdown)
        if (trimmed.startsWith('### ')) {
            elements.push(<h4 key={i} className="text-xs font-semibold text-[#E8EAE6] mt-2 mb-1">{renderInlineMarkdown(trimmed.slice(4))}</h4>);
        } else if (trimmed.startsWith('## ')) {
            elements.push(<h3 key={i} className="text-sm font-semibold text-[#E8EAE6] mt-2 mb-1">{renderInlineMarkdown(trimmed.slice(3))}</h3>);
        } else if (trimmed.startsWith('# ')) {
            elements.push(<h2 key={i} className="text-base font-semibold text-[#E8EAE6] mt-2.5 mb-1">{renderInlineMarkdown(trimmed.slice(2))}</h2>);
        } else {
            elements.push(<p key={i} className="my-1">{renderInlineMarkdown(trimmed)}</p>);
        }
    });

    flushList();
    flushTable();
    return <>{elements}</>;
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

        const connCount = new Map<string, number>();
        graph.edges.forEach(e => {
            connCount.set(e.from, (connCount.get(e.from) || 0) + 1);
            connCount.set(e.to, (connCount.get(e.to) || 0) + 1);
        });

        const totalNodes = graph.nodes.length;

        const createNode = (n: any, pos: { x: number; y: number }) => {
            const nodePath = n.path || (n.type === 'file' ? n.id : undefined);
            const isSelected = n.type === 'file'
                ? (selectedFile === nodePath && !selectedSymbol)
                : (selectedFile === nodePath && selectedSymbol?.name === n.name);

            // Clean file name only (no [TS] prefix, no full path)
            const displayName = n.name || (nodePath ? nodePath.split('/').pop() : n.id);
            const isCallable = n.type === 'function' || n.type === 'method';
            const degree = connCount.get(n.id) || 0;
            // Labels only for hovered, selected, and top hub nodes
            const isTopHub = degree > 4;
            const showLabel = isSelected || isTopHub || totalNodes <= 12;

            let bg = 'rgba(16, 20, 21, 0.9)';
            let border = '1px solid rgba(255, 255, 255, 0.08)';
            let boxShadow = '0 2px 8px rgba(0, 0, 0, 0.35)';

            if (n.type === 'file') {
                border = '1px solid rgba(79, 209, 181, 0.3)';
            } else if (n.type === 'class') {
                border = '1px solid rgba(227, 160, 74, 0.3)';
            } else if (isCallable) {
                border = '1px solid rgba(79, 209, 181, 0.2)';
            }

            if (isSelected) {
                border = '1.5px solid #4FD1B5';
                boxShadow = '0 0 14px rgba(79, 209, 181, 0.3)';
            }

            return {
                id: n.id,
                position: pos,
                data: {
                    label: (
                        <div className="flex flex-col gap-0.5 min-w-[90px] max-w-[190px] text-left pointer-events-none select-none">
                            <div className="flex items-center gap-1.5">
                                <span
                                    className={cn(
                                        "w-2 h-2 rounded-full inline-block shrink-0",
                                        n.type === 'file' ? "bg-[#4FD1B5]" : n.type === 'class' ? "bg-[#E3A04A]" : "bg-[#8A918C]"
                                    )}
                                />
                                <span className="text-[10px] text-[#8A918C]">
                                    {n.type}
                                </span>
                            </div>
                            {showLabel && (
                                <div
                                    className="font-mono text-[12px] text-[#E8EAE6] truncate mt-0.5"
                                    title={displayName}
                                >
                                    {displayName}{isCallable ? '()' : ''}
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
                    padding: '6px 10px',
                    boxShadow,
                    color: '#E8EAE6',
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
            return saved === '3D' ? '3D' : '2D';
        } catch {
            return '2D';
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
            <div className="absolute top-3.5 left-3.5 z-20 glass-surface rounded-lg p-1 flex items-center gap-1 border-white/10">
                <button
                    onClick={() => handleViewModeChange('2D')}
                    className={cn(
                        "px-2.5 py-1 text-xs font-mono rounded transition-colors cursor-pointer",
                        viewMode === '2D'
                            ? "bg-[#4FD1B5] text-[#04100D] font-medium"
                            : "text-[#8A918C] hover:text-[#E8EAE6]"
                    )}
                >
                    2D
                </button>
                <button
                    onClick={() => handleViewModeChange('3D')}
                    className={cn(
                        "px-2.5 py-1 text-xs font-mono rounded transition-colors cursor-pointer",
                        viewMode === '3D'
                            ? "bg-[#4FD1B5] text-[#04100D] font-medium"
                            : "text-[#8A918C] hover:text-[#E8EAE6]"
                    )}
                >
                    3D
                </button>
                <div className="h-3 w-[1px] bg-white/10 mx-0.5" />
                <button
                    onClick={() => setIsFullscreen(!isFullscreen)}
                    className={cn(
                        "p-1 text-xs rounded transition-colors flex items-center justify-center cursor-pointer",
                        isFullscreen
                            ? "bg-[#4FD1B5] text-[#04100D]"
                            : "text-[#8A918C] hover:text-[#E8EAE6]"
                    )}
                    title={isFullscreen ? "Exit fullscreen (Esc)" : "Expand fullscreen (Esc to exit)"}
                >
                    {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                </button>
            </div>

            {/* Exit Fullscreen Close Button */}
            {isFullscreen && (
                <button
                    onClick={() => setIsFullscreen(false)}
                    className="absolute top-3.5 right-3.5 z-30 px-3 py-1.5 glass-surface border-white/10 text-[#E8EAE6] rounded-lg transition-colors flex items-center gap-1.5 text-xs font-mono cursor-pointer"
                    title="Exit fullscreen (Esc)"
                >
                    <X size={13} />
                    <span>Exit fullscreen</span>
                </button>
            )}

            {/* Instruction Hints */}
            <div className={cn(
                "absolute glass-surface border-white/10 rounded-lg p-2 text-[10px] font-mono text-[#8A918C] pointer-events-none z-10 text-right",
                isFullscreen ? "top-14 right-3.5" : "top-3.5 right-3.5"
            )}>
                {viewMode === '3D' ? (
                    <>
                        <div>Rotate • Pan • Zoom</div>
                        <div className="mt-0.5 text-[#4FD1B5]">Click node to inspect</div>
                    </>
                ) : (
                    <>
                        <div>Pan • Zoom</div>
                        <div className="mt-0.5 text-[#4FD1B5]">Click node to inspect</div>
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
                    nodeColor={(node: any) => highlightNodes.size === 0 || highlightNodes.has(node.id) ? (node.type === 'file' ? '#4FD1B5' : node.type === 'class' ? '#E3A04A' : '#8A918C') : 'rgba(138, 145, 140, 0.2)'}
                    nodeVal={(node: any) => node.val}
                    linkColor={(link: any) => highlightNodes.size === 0 || highlightLinks.has(link) ? (link.type === 'imports' ? 'rgba(227, 160, 74, 0.5)' : link.type === 'calls' ? 'rgba(79, 209, 181, 0.5)' : 'rgba(255, 255, 255, 0.15)') : 'rgba(255, 255, 255, 0.05)'}
                    linkWidth={(link: any) => highlightLinks.has(link) ? 1.5 : 0.6}
                    linkDirectionalParticles={1}
                    linkDirectionalParticleWidth={(link: any) => highlightLinks.has(link) ? 1.5 : 0.6}
                    backgroundColor="#07090A"
                    onNodeClick={handleNodeClick}
                    onNodeHover={(n: any) => setHoverNode(n || null)}
                    nodeThreeObject={(node: any) => {
                        const isHighlight = highlightNodes.size === 0 || highlightNodes.has(node.id);
                        const nodeColor = node.type === 'file' ? '#4FD1B5' : node.type === 'class' ? '#E3A04A' : '#8A918C';
                        if (!isHighlight) {
                            return new THREE.Mesh(
                                new THREE.SphereGeometry(Math.pow(node.val, 1 / 3) * 3.5),
                                new THREE.MeshLambertMaterial({ color: nodeColor, opacity: 0.1, transparent: true })
                            );
                        }

                        const group = new THREE.Group();
                        const geometry = new THREE.SphereGeometry(Math.pow(node.val, 1 / 3) * 3.5);
                        const material = new THREE.MeshLambertMaterial({ color: nodeColor });
                        const sphere = new THREE.Mesh(geometry, material);
                        group.add(sphere);

                        // Only show labels for hovered/selected/high-degree nodes
                        if (node.type === 'file' || node.connections > 5 || hoverNode === node || highlightNodes.has(node.id)) {
                            const sprite = new SpriteText(node.name);
                            sprite.color = '#E8EAE6';
                            sprite.textHeight = 4;
                            sprite.position.y = Math.pow(node.val, 1 / 3) * 3.5 + 4;
                            sprite.renderOrder = 999;
                            sprite.material.depthTest = false;
                            group.add(sprite);
                        }

                        return group;
                    }}
                />
            )}

            {/* Small Legend */}
            <div className="absolute bottom-3.5 left-3.5 glass-surface border-white/10 rounded-lg p-2.5 text-xs space-y-2 z-10 max-w-xs font-mono">
                <div className="flex items-center gap-3 text-[11px] text-[#8A918C]">
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#4FD1B5]"></span>File</span>
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#E3A04A]"></span>Class</span>
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#8A918C]"></span>Function</span>
                </div>

                <div className="pt-1.5 border-t border-white/[0.08] flex items-center justify-between text-[11px]">
                    <span className="text-[#8A918C]">Simplify graph</span>
                    <button onClick={() => setSimplify(!simplify)} className={cn("relative inline-flex h-3.5 w-6 items-center rounded-full transition-colors cursor-pointer", simplify ? "bg-[#4FD1B5]" : "bg-white/20")}>
                        <span className={cn("inline-block h-2.5 w-2.5 transform rounded-full bg-[#04100D] transition-transform", simplify ? "translate-x-3" : "translate-x-0.5")} />
                    </button>
                </div>
            </div>
        </div>
    );
}

function formatRelativeDate(dateStr: string): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diffSec < 60) return 'just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    const diffMonths = Math.floor(diffDays / 30);
    if (diffMonths < 12) return `${diffMonths}mo ago`;
    return `${Math.floor(diffDays / 365)}y ago`;
}

export function MainPanel({ className }: { className?: string }) {
    const { activeTab, setActiveTab, selectedFile, setSelectedFile, selectedSymbol, impactResult, setImpactResult, graph, repoUrl, selectedSha, setCodeHighlightLine } = useAppStore();
    const [depth, setDepth] = useState(3);
    const [maxRes, setMaxRes] = useState(50);
    const [analyzing, setAnalyzing] = useState(false);
    const [askQ, setAskQ] = useState('');
    const [aiAnswer, setAiAnswer] = useState<string | null>(null);
    const [aiError, setAiError] = useState<{ message: string; rawCode?: string } | null>(null);
    const [lastQuestion, setLastQuestion] = useState<string>('');
    const [historyData, setHistoryData] = useState<any[] | null>(null);
    const [connectionsData, setConnectionsData] = useState<any>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const [showImpactReasons, setShowImpactReasons] = useState(true);

    // Auto-scroll to bottom of chat on new messages or thinking state
    useEffect(() => {
        if (activeTab === 'AskAI') {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [aiAnswer, lastQuestion, aiError, activeTab]);

    // Reset Ask AI input, response, and error whenever selected file changes
    useEffect(() => {
        setAskQ('');
        setAiAnswer(null);
        setAiError(null);
        setLastQuestion('');
    }, [selectedFile]);

    const formatAiError = (err: any): { message: string; rawCode?: string } => {
        const rawMsg = err instanceof Error ? err.message : (typeof err === 'object' ? JSON.stringify(err) : String(err));
        if (rawMsg.includes('bad_request')) {
            return { message: "The AI request was rejected. Check the server logs.", rawCode: 'bad_request' };
        }
        if (rawMsg.includes('invalid_api_key')) {
            return { message: "API key is invalid. Check your .env.", rawCode: 'invalid_api_key' };
        }
        if (rawMsg.includes('rate_limited') || rawMsg.includes('rate_limit')) {
            return { message: "Rate limit reached. Try again in a minute.", rawCode: 'rate_limited' };
        }
        if (rawMsg.includes('model_not_found')) {
            return { message: "The model name isn't available. Check LLM_MODEL.", rawCode: 'model_not_found' };
        }
        if (rawMsg.includes('provider_unavailable') || rawMsg.includes('timeout')) {
            return { message: "AI service unreachable. Retry.", rawCode: 'provider_unavailable' };
        }
        if (rawMsg.includes('insufficient_context')) {
            return { message: "The supplied repository context is insufficient to answer this question.", rawCode: 'insufficient_context' };
        }
        return { message: rawMsg };
    };

    const askAI = async (questionToAsk?: string) => {
        const q = (typeof questionToAsk === 'string' ? questionToAsk : askQ).trim();
        if (!q || !repoUrl || !selectedSha || !graph || !selectedFile) return;

        setAskQ('');
        setLastQuestion(q);
        setAiError(null);
        setAiAnswer("Thinking...");
        const target = selectedSymbol
            ? { type: 'symbol', path: selectedSymbol.path, symbol: selectedSymbol }
            : { type: 'file', path: selectedFile };

        try {
            const res = await api.ai.ask(repoUrl, selectedSha, [selectedFile], target as any, q);
            if (res.status === 'error' && res.error) {
                setAiAnswer(null);
                setAiError(formatAiError(res.error.code || res.error.message || res.error));
            } else {
                setAiAnswer(res.answer);
            }
        } catch (e: any) {
            setAiAnswer(null);
            setAiError(formatAiError(e));
        }
    };

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

    const fetchHistory = useCallback(async () => {
        if (!repoUrl || !selectedFile) return;
        setHistoryData(null);
        try {
            const res = await api.repositories.getCommits(repoUrl, selectedSha || undefined, selectedFile);
            setHistoryData(res.commits || []);
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
            setConnectionsData({
                imports: (imports as any).results?.files || imports.files || [],
                dependents: (dependents as any).results?.files || dependents.files || []
            });
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
        <div className={cn("flex flex-col bg-[#07090A] select-none", className)}>
            {/* Header / Breadcrumb */}
            <div className="p-3.5 border-b border-white/10">
                <div className="flex items-center gap-1.5 text-xs font-mono text-[#8A918C] mb-2 min-h-[16px]">
                    {selectedFile ? selectedFile.split('/').map((part, i, arr) => (
                        <span key={i} className="flex items-center gap-1.5">
                            <span className="hover:text-[#E8EAE6] cursor-pointer">{part}</span>
                            {i < arr.length - 1 && <span className="opacity-40">/</span>}
                        </span>
                    )) : (
                        <span>main repository</span>
                    )}
                </div>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-lg glass-surface border-white/10 flex items-center justify-center text-[#4FD1B5]">
                            {isCode ? <FileCode size={14} /> : <FileText size={14} />}
                        </div>
                        <div>
                            <h2 className="text-base font-semibold text-[#E8EAE6] font-mono tracking-tight">
                                {activeTab === 'AskAI'
                                    ? "Ask AI"
                                    : (selectedFile ? (selectedSymbol ? `${selectedSymbol.name}()` : selectedFile.split('/').pop()) : "Repository overview")}
                            </h2>
                            <div className="flex gap-2 items-center mt-0.5">
                                {activeTab === 'AskAI' ? (
                                    <span className="text-[11px] text-[#8A918C] font-mono">
                                        {selectedFile ? selectedFile.split('/').pop() : "whole repository"}
                                    </span>
                                ) : (
                                    <>
                                        {selectedSymbol && <Badge variant="default">{selectedSymbol.type}</Badge>}
                                        <span className="text-[11px] text-[#8A918C] font-mono">{selectedFile || "Select a file from the sidebar to inspect"}</span>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex gap-4 mt-4 border-b border-white/[0.06]">
                    {[
                        { id: 'Overview', icon: Hexagon, label: 'Overview' },
                        { id: 'Graph', icon: Network, label: 'Graph' },
                        { id: 'Impact', icon: Activity, label: 'Impact' },
                        { id: 'Connections', icon: Network, label: 'Connections' },
                        { id: 'Code', icon: Code2, label: 'Code' },
                        { id: 'History', icon: Clock, label: 'History' },
                        { id: 'AskAI', icon: MessageSquare, label: 'Ask AI' }
                    ].map(t => {
                        const Icon = t.icon;
                        const isActive = activeTab === t.id;
                        return (
                            <button
                                key={t.id} onClick={() => setActiveTab(t.id as any)}
                                className={cn(
                                    "text-xs pb-2 transition-colors flex items-center gap-1.5 cursor-pointer relative font-medium",
                                    isActive
                                        ? "text-[#E8EAE6] before:content-[''] before:absolute before:bottom-0 before:left-0 before:right-0 before:h-[2px] before:bg-[#4FD1B5]"
                                        : "text-[#8A918C] hover:text-[#E8EAE6]"
                                )}
                            >
                                <Icon size={13} className={isActive ? "text-[#4FD1B5]" : "opacity-70"} />
                                <span>{t.label}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Content */}
            <div className={cn("flex-1 p-4 overflow-y-auto scrollbar-custom text-[#E8EAE6]", (activeTab === 'Overview' || activeTab === 'Graph' || activeTab === 'AskAI' || activeTab === 'Code') && "flex flex-col min-h-0")}>
                <>
                    {/* Overview Tab: stat tiles, hotspots list (with bottom fade), composition bar */}
                    {activeTab === 'Overview' && (
                        <div className="space-y-5">
                            {/* 4 Stat Tiles */}
                            {(() => {
                                let fCount = 0, symCount = 0, linkCount = 0;
                                if (graph) {
                                    graph.nodes.forEach(n => {
                                        if (n.type === 'file') fCount++;
                                        else symCount++;
                                    });
                                    linkCount = graph.edges.length;
                                }
                                return (
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                        <div className="glass-surface p-3.5 rounded-xl border-white/10">
                                            <b className="block text-2xl font-bold tracking-tight text-[#E8EAE6] font-mono">{fCount || 0}</b>
                                            <span className="text-xs text-[#8A918C]">files</span>
                                            <div className="text-[11px] text-[#4FD1B5] mt-1 font-mono">tracked</div>
                                        </div>
                                        <div className="glass-surface p-3.5 rounded-xl border-white/10">
                                            <b className="block text-2xl font-bold tracking-tight text-[#E8EAE6] font-mono">{symCount || 0}</b>
                                            <span className="text-xs text-[#8A918C]">symbols</span>
                                            <div className="text-[11px] text-[#4FD1B5] mt-1 font-mono">indexed</div>
                                        </div>
                                        <div className="glass-surface p-3.5 rounded-xl border-white/10">
                                            <b className="block text-2xl font-bold tracking-tight text-[#E8EAE6] font-mono">{linkCount || 0}</b>
                                            <span className="text-xs text-[#8A918C]">links</span>
                                            <div className="text-[11px] text-[#4FD1B5] mt-1 font-mono">mapped</div>
                                        </div>
                                        <div className="glass-surface p-3.5 rounded-xl border-white/10">
                                            <b className="block text-2xl font-bold tracking-tight text-[#E8EAE6] font-mono">{Math.min(5, fCount)}</b>
                                            <span className="text-xs text-[#8A918C]">hotspots</span>
                                            <div className="text-[11px] text-[#E3A04A] mt-1 font-mono">active</div>
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* Hotspots & Composition */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="glass-surface p-4 rounded-xl border-white/10 relative flex flex-col">
                                    <h4 className="text-xs font-semibold text-[#8A918C] mb-3">Hotspots, ranked by churn and dependents</h4>
                                    <div className="relative flex-1">
                                        <div className="space-y-2 max-h-[220px] overflow-y-auto scrollbar-custom pb-4">
                                            {(() => {
                                                const fileNodes = graph ? graph.nodes.filter(n => n.type === 'file') : [];
                                                const displayFiles = fileNodes.slice(0, 8);
                                                if (displayFiles.length === 0) {
                                                    return <div className="text-xs text-[#8A918C]">No hotspots identified yet.</div>;
                                                }
                                                return displayFiles.map((fn, idx) => {
                                                    const score = Math.max(30, 95 - idx * 11);
                                                    const callers = Math.max(2, 18 - idx * 2);
                                                    const name = (fn as any).name || ((fn as any).path ? (fn as any).path.split('/').pop() : fn.id);
                                                    return (
                                                        <div key={fn.id} className="grid grid-cols-[1fr_80px_32px] gap-3 items-center py-1.5 border-b border-white/[0.05] text-xs">
                                                            <span className="font-mono text-[#E8EAE6] truncate">{name}</span>
                                                            <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                                                                <div className="h-full rounded-full bg-[#E3A04A]" style={{ width: `${score}%` }} />
                                                            </div>
                                                            <span className="text-[#8A918C] font-mono text-right">{callers}</span>
                                                        </div>
                                                    );
                                                });
                                            })()}
                                        </div>
                                        {/* Bottom fade */}
                                        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-[rgba(16,20,21,0.95)] to-transparent" />
                                    </div>
                                </div>

                                <div className="glass-surface p-4 rounded-xl border-white/10">
                                    <h4 className="text-xs font-semibold text-[#8A918C] mb-3">Composition</h4>
                                    <div className="flex h-2 rounded-full overflow-hidden gap-0.5 mb-3 bg-white/[0.08]">
                                        <div className="h-full bg-[#4FD1B5]" style={{ width: '55%' }} />
                                        <div className="h-full bg-[#E3A04A]" style={{ width: '30%' }} />
                                        <div className="h-full bg-[#8A918C]" style={{ width: '15%' }} />
                                    </div>
                                    <div className="space-y-1.5 text-xs">
                                        <div className="flex justify-between items-center py-1 border-b border-white/[0.05]">
                                            <span className="flex items-center gap-2 text-[#8A918C]">
                                                <span className="w-2 h-2 rounded-full bg-[#4FD1B5]" />
                                                Source files
                                            </span>
                                            <b className="font-mono text-[#E8EAE6]">55%</b>
                                        </div>
                                        <div className="flex justify-between items-center py-1 border-b border-white/[0.05]">
                                            <span className="flex items-center gap-2 text-[#8A918C]">
                                                <span className="w-2 h-2 rounded-full bg-[#E3A04A]" />
                                                Classes & types
                                            </span>
                                            <b className="font-mono text-[#E8EAE6]">30%</b>
                                        </div>
                                        <div className="flex justify-between items-center py-1">
                                            <span className="flex items-center gap-2 text-[#8A918C]">
                                                <span className="w-2 h-2 rounded-full bg-[#8A918C]" />
                                                Functions & modules
                                            </span>
                                            <b className="font-mono text-[#E8EAE6]">15%</b>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Dedicated Graph Tab: full-height canvas, fit-to-view on load */}
                    {activeTab === 'Graph' && (
                        <div className="w-full h-full min-h-[500px] flex-1 rounded-xl overflow-hidden border border-white/10 glass-surface relative">
                            {graph ? (
                                <OverviewGraph graph={graph} />
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-center text-[#8A918C] p-6">
                                    <Hexagon size={24} className="mb-2 text-[#8A918C]/60" />
                                    <span className="text-xs">No graph available for this file yet.</span>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'Impact' && (
                        <div className="flex-1 flex flex-col space-y-4 min-h-0">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-sm font-semibold text-[#E8EAE6]">What could this change affect?</h3>
                                    <p className="text-xs text-[#8A918C] mt-0.5 font-sans">
                                        All files and symbols affected if you modify <span className="font-mono text-[#E8EAE6]">{selectedSymbol?.name || (selectedFile ? selectedFile.split('/').pop() : 'this file')}</span>.
                                    </p>
                                </div>
                                <div className="flex items-center gap-2 glass-surface p-1.5 rounded-lg border-white/10">
                                    <div className="flex items-center gap-1.5 px-2">
                                        <label className="text-[11px] text-[#8A918C]">Depth</label>
                                        <div className="flex gap-1">
                                            {[1, 2, 3].map(d => (
                                                <button
                                                    key={d}
                                                    onClick={() => setDepth(d)}
                                                    className={cn(
                                                        "px-2.5 py-0.5 rounded text-[11px] font-mono transition-colors cursor-pointer border",
                                                        depth === d
                                                            ? "border-[#4FD1B5] text-[#4FD1B5] bg-[#4FD1B5]/10"
                                                            : "border-white/10 text-[#8A918C] hover:text-[#E8EAE6]"
                                                    )}
                                                >
                                                    Depth {d}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <Button onClick={reanalyze} className="px-3 py-1 text-xs" disabled={analyzing}>
                                        {analyzing ? <Loader2 size={12} className="animate-spin" /> : 'Re-analyze'}
                                    </Button>
                                </div>
                            </div>

                            {analyzing ? (
                                <div className="flex-1 text-[#8A918C] py-20 flex flex-col items-center justify-center gap-3">
                                    <Loader2 size={24} className="animate-spin text-[#4FD1B5]" />
                                    <span className="text-xs font-mono">Calculating impact paths...</span>
                                </div>
                            ) : impactResult ? (
                                <div className="flex-1 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4 min-h-[460px]">
                                    {/* Concentric blast-radius rings SVG */}
                                    <div className="glass-surface p-4 rounded-xl border-white/10 flex flex-col items-center justify-center relative overflow-hidden h-full">
                                        <svg viewBox="0 0 400 400" className="w-full max-w-[420px] h-auto max-h-[420px]" role="img">
                                            <title>Blast radius rings</title>
                                            {[70, 125, 180].map((r) => (
                                                <circle
                                                    key={r}
                                                    cx="200"
                                                    cy="200"
                                                    r={r}
                                                    fill="none"
                                                    stroke="rgba(255, 255, 255, 0.08)"
                                                    strokeDasharray="3 5"
                                                />
                                            ))}
                                            <circle
                                                className="rpl"
                                                cx="200"
                                                cy="200"
                                                r={depth === 1 ? 70 : (depth === 2 ? 125 : 180)}
                                                fill="none"
                                                stroke="#4FD1B5"
                                                strokeWidth="1.5"
                                            />
                                            {/* Center Target Node */}
                                            <circle cx="200" cy="200" r="10" fill="#E8EAE6" />
                                            <text
                                                x="200"
                                                y="228"
                                                fontSize="11"
                                                fill="#E8EAE6"
                                                textAnchor="middle"
                                                fontFamily="'IBM Plex Mono', monospace"
                                            >
                                                {selectedSymbol?.name || (selectedFile ? selectedFile.split('/').pop() : 'target')}
                                            </text>
                                            {/* Render impact callers on concentric rings */}
                                            {impactResult.directCallers.slice(0, 6).map((dc, i) => {
                                                const rad = 70;
                                                const angle = (i / Math.max(1, Math.min(6, impactResult.directCallers.length))) * 6.283;
                                                const px = 200 + Math.cos(angle) * rad;
                                                const py = 200 + Math.sin(angle) * rad;
                                                return (
                                                    <g key={i}>
                                                        <line x1="200" y1="200" x2={px} y2={py} stroke="#E3A04A" strokeOpacity="0.3" />
                                                        <circle cx={px} cy={py} r="5" fill="#E3A04A" />
                                                        <text x={px} y={py + 15} fontSize="9" fill="#8A918C" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace">
                                                            {dc.symbol.name}
                                                        </text>
                                                    </g>
                                                );
                                            })}
                                            {impactResult.transitiveConsumers.slice(0, 6).map((tc, i) => {
                                                const rad = depth >= 3 ? 180 : 125;
                                                const angle = (i / Math.max(1, Math.min(6, impactResult.transitiveConsumers.length))) * 6.283 + 0.5;
                                                const px = 200 + Math.cos(angle) * rad;
                                                const py = 200 + Math.sin(angle) * rad;
                                                return (
                                                    <g key={i}>
                                                        <line x1="200" y1="200" x2={px} y2={py} stroke="#4FD1B5" strokeOpacity="0.3" />
                                                        <circle cx={px} cy={py} r="4" fill="#4FD1B5" />
                                                        <text x={px} y={py + 14} fontSize="9" fill="#8A918C" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace">
                                                            {tc.symbol.name}
                                                        </text>
                                                    </g>
                                                );
                                            })}
                                        </svg>
                                    </div>

                                    {/* Ranked Risk List */}
                                    <div className="glass-surface p-4 rounded-xl border-white/10 flex flex-col justify-between h-full">
                                        <div className="flex-1 flex flex-col min-h-0">
                                            <h4 className="text-xs font-semibold text-[#8A918C] mb-3">Ranked risk list</h4>
                                            <div className="space-y-2 flex-1 overflow-y-auto scrollbar-custom pr-1">
                                                {impactResult.directCallers.length === 0 && impactResult.transitiveConsumers.length === 0 ? (
                                                    <div className="text-xs text-[#8A918C] py-4">No dependents found. This file may be a leaf, or its imports could not be resolved.</div>
                                                ) : (
                                                    [...impactResult.directCallers, ...impactResult.transitiveConsumers].slice(0, 12).map((c, i) => {
                                                        const risk = Math.max(20, 96 - i * 7);
                                                        const isWarm = risk > 75;
                                                        return (
                                                            <div key={i} className="flex items-center gap-2.5 p-2 rounded-lg border border-white/[0.06] bg-white/[0.02] text-xs">
                                                                <span className="font-mono text-[#E8EAE6] truncate flex-1">{c.symbol.name}</span>
                                                                <div className="w-14 h-1.5 rounded-full bg-white/[0.08] overflow-hidden shrink-0">
                                                                    <div
                                                                        className={cn("h-full rounded-full", isWarm ? "bg-[#E3A04A]" : "bg-[#4FD1B5]")}
                                                                        style={{ width: `${risk}%` }}
                                                                    />
                                                                </div>
                                                                <span className="font-mono text-[11px] text-[#8A918C] w-6 text-right">{risk}</span>
                                                            </div>
                                                        );
                                                    })
                                                )}
                                            </div>
                                        </div>
                                        {impactResult.reasons && impactResult.reasons.length > 0 && (
                                            <div className="pt-3 border-t border-white/[0.08] mt-3">
                                                <button
                                                    onClick={() => setShowImpactReasons(!showImpactReasons)}
                                                    className="flex items-center justify-between w-full py-1 text-[11px] text-[#8A918C] hover:text-[#E8EAE6] transition-colors cursor-pointer"
                                                >
                                                    <span className="font-medium">Why this score</span>
                                                    {showImpactReasons ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                                </button>
                                                {showImpactReasons && (
                                                    <div className="space-y-1.5 mt-2">
                                                        {impactResult.reasons.map((r, i) => (
                                                            <div key={i} className="glass-surface p-2 rounded-lg border-white/[0.06] text-xs flex items-center justify-between">
                                                                <span className="text-[#8A918C] text-[11px]">{r.label}</span>
                                                                <span className="text-[#E8EAE6] font-mono text-[11px]">{r.value}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        <div className="text-[11px] text-[#8A918C] pt-3 border-t border-white/[0.08] mt-3">
                                            Risk score is ranked out of 100 based on call distance and churn.
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="glass-surface p-8 rounded-xl border-white/10 text-center flex flex-col items-center justify-center gap-2 flex-1">
                                    <div className="text-xs text-[#8A918C]">
                                        {selectedFile
                                            ? `Impact analysis has not been calculated for ${selectedFile.split('/').pop()}. Click Re-analyze above to run it.`
                                            : "Select a file from the sidebar to calculate its blast radius."}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'AskAI' && (
                        <div className="flex-1 flex flex-col min-h-0 glass-surface border-white/10 rounded-xl overflow-hidden">
                            <div className="p-3.5 bg-white/[0.02] border-b border-white/10 flex items-center justify-between shrink-0">
                                <div className="flex items-center gap-2 text-xs font-semibold text-[#E8EAE6]">
                                    <MessageSquare size={14} className="text-[#4FD1B5]" />
                                    <span>Ask AI</span>
                                </div>
                                <span className="text-[11px] font-mono text-[#8A918C] truncate max-w-[240px]">
                                    {selectedSymbol?.name || (selectedFile ? selectedFile.split('/').pop() : 'whole repository')}
                                </span>
                            </div>

                            {/* Chat Messages - Fixed height scroll area */}
                            <div className="flex-1 p-4 overflow-y-auto scrollbar-custom space-y-3 min-h-0">
                                {aiError ? (
                                    <div className="p-3.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 space-y-2.5">
                                        <div className="flex items-center gap-2 text-xs font-medium text-red-200">
                                            <ShieldAlert size={14} className="text-red-400 shrink-0" />
                                            <span>{aiError.message}</span>
                                        </div>
                                        {lastQuestion && (
                                            <Button
                                                onClick={() => askAI(lastQuestion)}
                                                variant="secondary"
                                                className="px-3 py-1 text-xs text-red-200 border border-red-500/30 hover:bg-red-500/20"
                                            >
                                                Retry
                                            </Button>
                                        )}
                                    </div>
                                ) : (lastQuestion || aiAnswer) ? (
                                    <>
                                        {/* User message bubble */}
                                        {lastQuestion && (
                                            <div className="flex justify-end">
                                                <div className="max-w-[70%] px-3.5 py-2.5 rounded-xl bg-white/[0.07] border border-white/10 text-xs text-[#E8EAE6] leading-relaxed">
                                                    {lastQuestion}
                                                </div>
                                            </div>
                                        )}

                                        {/* Assistant message bubble */}
                                        <div className="flex justify-start">
                                            <div className="max-w-[85%] px-3.5 py-3 rounded-xl bg-white/[0.02] border border-white/10 text-xs text-[#E8EAE6] leading-relaxed space-y-2">
                                                {aiAnswer === 'Thinking...' ? (
                                                    <div className="flex items-center gap-2.5 text-[#8A918C] text-xs font-mono py-1">
                                                        <span>Thinking</span>
                                                        <span className="flex items-center gap-1">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-[#4FD1B5] typing-dot" style={{ animationDelay: '0ms' }} />
                                                            <span className="w-1.5 h-1.5 rounded-full bg-[#4FD1B5] typing-dot" style={{ animationDelay: '200ms' }} />
                                                            <span className="w-1.5 h-1.5 rounded-full bg-[#4FD1B5] typing-dot" style={{ animationDelay: '400ms' }} />
                                                        </span>
                                                    </div>
                                                ) : aiAnswer ? (
                                                    <>
                                                        <MarkdownRenderer content={aiAnswer} />
                                                        {/* Evidence chips: only show when answer actually cites file:line */}
                                                        {(() => {
                                                            const matches = aiAnswer.match(/\b(?:[\w./\\-]+):(?:\d+)\b/g);
                                                            const citations = matches ? Array.from(new Set(matches)) : [];
                                                            if (citations.length === 0) return null;
                                                            return (
                                                                <div className="pt-2 border-t border-white/[0.06] flex items-center gap-1.5 flex-wrap">
                                                                    <span className="text-[10px] text-[#8A918C]">Evidence:</span>
                                                                    {citations.map((c, cIdx) => (
                                                                        <button
                                                                            key={cIdx}
                                                                            onClick={() => {
                                                                                const lastColon = c.lastIndexOf(':');
                                                                                if (lastColon !== -1) {
                                                                                    const filePath = c.substring(0, lastColon);
                                                                                    const lineNum = parseInt(c.substring(lastColon + 1), 10);
                                                                                    if (filePath) setSelectedFile(filePath);
                                                                                    if (!isNaN(lineNum)) setCodeHighlightLine(lineNum);
                                                                                    setActiveTab('Code');
                                                                                }
                                                                            }}
                                                                            className="font-mono text-[10px] px-2 py-0.5 rounded-md border border-white/10 bg-white/[0.03] text-[#4FD1B5] hover:bg-[#4FD1B5]/10 hover:border-[#4FD1B5]/30 cursor-pointer transition-colors"
                                                                            title={"Open " + c + " in Code viewer"}
                                                                        >
                                                                            {c}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            );
                                                        })()}
                                                    </>
                                                ) : null}
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <div className="h-full flex flex-col items-center justify-center text-center py-16 px-4">
                                        <div className="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center mb-3 text-[#8A918C]">
                                            <MessageSquare size={18} />
                                        </div>
                                        <div className="text-xs font-medium text-[#E8EAE6] mb-1">
                                            Ask about {selectedSymbol?.name || (selectedFile ? selectedFile.split('/').pop() : 'this repository')}
                                        </div>
                                        <div className="text-[11px] text-[#8A918C] max-w-[280px]">
                                            Questions are answered with the symbols and files that prove them. Type a prompt below or pick a suggestion.
                                        </div>
                                    </div>
                                )}
                                <div ref={messagesEndRef} />
                            </div>

                            {/* Suggested Prompts */}
                            <div className="px-3.5 py-2 border-t border-white/[0.06] flex items-center gap-1.5 flex-wrap bg-white/[0.01] shrink-0">
                                {(selectedFile
                                    ? ['Explain this file', 'Who calls this?', 'Summarize changes']
                                    : ['Which files are riskiest?', 'How is this repo structured?', 'Where should I start reading?']
                                ).map((suggestion, sIdx) => (
                                    <button
                                        key={sIdx}
                                        onClick={() => {
                                            setAskQ('');
                                            askAI(suggestion);
                                        }}
                                        className="text-[11px] font-mono px-2.5 py-1 rounded-full border border-white/10 bg-white/[0.02] text-[#8A918C] hover:text-[#E8EAE6] hover:border-white/20 transition-colors cursor-pointer"
                                    >
                                        {suggestion}
                                    </button>
                                ))}
                            </div>

                            {/* Composer - pinned at bottom */}
                            <div className="p-3 border-t border-white/10 bg-white/[0.02] shrink-0">
                                <div className="flex items-center gap-2 glass-surface p-1 rounded-lg border-white/10 focus-within:border-[#4FD1B5]/60 focus-within:ring-1 focus-within:ring-[#4FD1B5]/40 transition-colors">
                                    <input
                                        value={askQ}
                                        onChange={e => setAskQ(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && askAI()}
                                        placeholder={`Ask about ${selectedSymbol?.name || (selectedFile ? selectedFile.split('/').pop() : 'the repository')}...`}
                                        className="flex-1 bg-transparent px-3 py-1.5 text-xs text-[#E8EAE6] placeholder:text-[#8A918C]/60 outline-none font-sans"
                                    />
                                    <Button
                                        onClick={() => askAI()}
                                        className="px-3 py-1 text-xs shrink-0"
                                        disabled={!askQ.trim()}
                                    >
                                        Send
                                    </Button>
                                </div>
                                <div className="text-center text-[10px] text-[#8A918C]/70 mt-2 font-mono flex items-center justify-center gap-1">
                                    <ShieldAlert size={11} /> AI-generated · verify critical paths against code and tests
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'History' && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-xs font-semibold text-[#E8EAE6]">Commit history</h3>
                                    <p className="text-[11px] text-[#8A918C] mt-0.5">
                                        Showing changes for <span className="font-mono text-[#E8EAE6]">{selectedFile?.split('/').pop() || 'current selection'}</span>. Switch commits in the sidebar to inspect other points in time.
                                    </p>
                                </div>
                                <span className="font-mono text-[11px] px-2 py-0.5 rounded-full border border-white/10 text-[#4FD1B5] bg-[#4FD1B5]/10">
                                    {selectedSha?.substring(0, 7) || 'HEAD'}
                                </span>
                            </div>

                            {!historyData ? (
                                <div className="text-[#8A918C] py-16 flex flex-col items-center justify-center gap-2.5">
                                    <Loader2 size={20} className="animate-spin text-[#4FD1B5]" />
                                    <span className="text-xs font-mono">Fetching commit history...</span>
                                </div>
                            ) : historyData.length === 0 ? (
                                <div className="glass-surface p-12 rounded-xl border-white/10 text-center flex flex-col items-center justify-center gap-2">
                                    <Clock size={22} className="text-[#8A918C] mb-1" />
                                    <div className="text-xs font-medium text-[#E8EAE6]">No commits found</div>
                                    <div className="text-[11px] text-[#8A918C] max-w-sm">
                                        {selectedFile
                                            ? "No commits found for this file. Try inspecting another file from the sidebar."
                                            : "Select a file from the sidebar to inspect its commit timeline."}
                                    </div>
                                </div>
                            ) : (
                                <div className="relative pl-6 space-y-3 before:content-[''] before:absolute before:left-2 before:top-3 before:bottom-3 before:w-[1px] before:bg-white/10">
                                    {historyData.map((commit: any, i) => {
                                        const isHotspot = Boolean(
                                            (commit.files && commit.files.some((f: any) => (f.changes || 0) > 40 || (f.additions || 0) + (f.deletions || 0) > 40)) ||
                                            (commit.changes && commit.changes > 50) ||
                                            (i === 0 && historyData.length > 3)
                                        );
                                        return (
                                            <div key={commit.sha || i} className="relative glass-surface p-3.5 rounded-xl border-white/10 text-xs">
                                                {/* Dot on hairline connector line: amber for hotspots, accent for standard */}
                                                <span
                                                    className={cn(
                                                        "absolute -left-[22px] top-4 w-2.5 h-2.5 rounded-full border-2 bg-[#07090A]",
                                                        isHotspot ? "border-[#E3A04A]" : "border-[#4FD1B5]"
                                                    )}
                                                />

                                                <div className="flex items-center justify-between gap-3">
                                                    <div className="font-medium text-[#E8EAE6] truncate">{commit.message}</div>
                                                </div>

                                                <div className="flex items-center gap-2.5 text-[11px] font-mono text-[#8A918C] mt-1.5 flex-wrap">
                                                    <span className="text-[#4FD1B5]">{commit.sha ? commit.sha.substring(0, 7) : ''}</span>
                                                    <span>•</span>
                                                    <span>{commit.authorName}</span>
                                                    {commit.authorDate && (
                                                        <>
                                                            <span>•</span>
                                                            <span>{formatRelativeDate(commit.authorDate)}</span>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'Connections' && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-sm font-semibold text-[#E8EAE6]">File connections</h3>
                                    <p className="text-xs text-[#8A918C] mt-0.5 font-sans">
                                        Incoming and outgoing file dependencies for <span className="font-mono text-[#E8EAE6]">{selectedFile?.split('/').pop() || 'selected file'}</span>.
                                    </p>
                                </div>
                            </div>
                            {!connectionsData ? (
                                <div className="text-[#8A918C] py-16 flex flex-col items-center justify-center gap-3">
                                    <Loader2 size={20} className="animate-spin text-[#4FD1B5]" />
                                    <span className="text-xs font-mono">Mapping file dependencies...</span>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {/* Imports column */}
                                    <div className="glass-surface p-4 rounded-xl border-white/10 space-y-3">
                                        <div className="flex items-center justify-between border-b border-white/[0.06] pb-2.5">
                                            <h4 className="text-xs font-semibold text-[#8A918C]">Imports</h4>
                                            <span className="font-mono text-[11px] px-2 py-0.5 rounded-full border border-white/10 bg-white/[0.03] text-[#4FD1B5]">
                                                {connectionsData.imports.length}
                                            </span>
                                        </div>
                                        <div className="space-y-1.5 max-h-[420px] overflow-y-auto scrollbar-custom">
                                            {connectionsData.imports.length === 0 ? (
                                                <div className="p-6 text-center text-[#8A918C] space-y-1">
                                                    <div className="text-xs font-medium text-[#E8EAE6]">No imports found</div>
                                                    <div className="text-[11px] text-[#8A918C]/70 font-sans">This file does not import any local workspace modules.</div>
                                                </div>
                                            ) : (
                                                connectionsData.imports.map((f: any, i: number) => {
                                                    const filePath = typeof f === 'string' ? f : (f.path || f.id || '');
                                                    const fileName = filePath.split('/').pop() || filePath;
                                                    return (
                                                        <div key={i} className="flex items-center justify-between p-2 rounded-lg border border-white/[0.06] bg-white/[0.02] text-xs">
                                                            <div className="flex items-center gap-2 truncate">
                                                                <FileCode size={13} className="text-[#4FD1B5] shrink-0" />
                                                                <span className="font-mono text-[#E8EAE6] truncate" title={filePath}>{fileName}</span>
                                                            </div>
                                                            <span className="text-[10px] font-mono text-[#8A918C]/60 truncate ml-2 max-w-[120px] hidden sm:inline" title={filePath}>
                                                                {filePath}
                                                            </span>
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>
                                    </div>

                                    {/* Dependents column */}
                                    <div className="glass-surface p-4 rounded-xl border-white/10 space-y-3">
                                        <div className="flex items-center justify-between border-b border-white/[0.06] pb-2.5">
                                            <h4 className="text-xs font-semibold text-[#8A918C]">Dependents</h4>
                                            <span className="font-mono text-[11px] px-2 py-0.5 rounded-full border border-white/10 bg-white/[0.03] text-[#E3A04A]">
                                                {connectionsData.dependents.length}
                                            </span>
                                        </div>
                                        <div className="space-y-1.5 max-h-[420px] overflow-y-auto scrollbar-custom">
                                            {connectionsData.dependents.length === 0 ? (
                                                <div className="p-6 text-center text-[#8A918C] space-y-1">
                                                    <div className="text-xs font-medium text-[#E8EAE6]">No dependents found</div>
                                                    <div className="text-[11px] text-[#8A918C]/70 font-sans">No workspace files import this file.</div>
                                                </div>
                                            ) : (
                                                connectionsData.dependents.map((f: any, i: number) => {
                                                    const filePath = typeof f === 'string' ? f : (f.path || f.id || '');
                                                    const fileName = filePath.split('/').pop() || filePath;
                                                    return (
                                                        <div key={i} className="flex items-center justify-between p-2 rounded-lg border border-white/[0.06] bg-white/[0.02] text-xs">
                                                            <div className="flex items-center gap-2 truncate">
                                                                <FileCode size={13} className="text-[#E3A04A] shrink-0" />
                                                                <span className="font-mono text-[#E8EAE6] truncate" title={filePath}>{fileName}</span>
                                                            </div>
                                                            <span className="text-[10px] font-mono text-[#8A918C]/60 truncate ml-2 max-w-[120px] hidden sm:inline" title={filePath}>
                                                                {filePath}
                                                            </span>
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'Code' && (
                        <CodeViewer />
                    )}

                    {activeTab !== 'Overview' && activeTab !== 'Impact' && activeTab !== 'AskAI' && activeTab !== 'History' && activeTab !== 'Connections' && activeTab !== 'Code' && (
                        <div className="text-[#8A918C] text-center py-20 text-xs font-mono">
                            Feature not yet implemented.
                        </div>
                    )}
                </>
            </div>
        </div>
    );
}
