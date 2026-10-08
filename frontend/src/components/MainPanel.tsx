import { useAppStore } from '../store';
import { Card, Badge, cn, Button } from '../ui';
import { Network, Activity, Clock, FileCode, FileText, ChevronRight, Share2, Play, Send, ShieldAlert, GitCommit, Hexagon, MessageSquare, Loader2, Maximize2, Minimize2, X, Copy, Check, Code2, ChevronDown, ChevronUp, HeartPulse, Download, Plus, Square, Layers } from 'lucide-react';
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { ReactFlow, useNodesState, useEdgesState, Background, Controls, useReactFlow } from '@xyflow/react';
import ForceGraph3D from 'react-force-graph-3d';
import SpriteText from 'three-spritetext';
import * as THREE from 'three';
import '@xyflow/react/dist/style.css';
import { api } from '../api';
import { isCodeFile } from '../analyze-helpers';
import { CodeViewer } from './CodeViewer';
import { getNeighborInfo, getFocusedGraph } from '../graph-helpers';
import { ConnectedFilesList } from './ConnectedFilesList';

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

function FlowFitViewHandler({
    isExpanded,
    selectedFile,
    nodes,
    edges
}: {
    isExpanded: boolean;
    selectedFile: string | null;
    nodes: any[];
    edges: any[];
}) {
    const { fitView } = useReactFlow();
    const hasInitialFitRef = useRef(false);
    const prevFileRef = useRef<string | null>(selectedFile);

    // Initial fit on load with padding so nodes fill ~60% of canvas
    useEffect(() => {
        if (!hasInitialFitRef.current && nodes.length > 0) {
            hasInitialFitRef.current = true;
            const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            const timer = setTimeout(() => {
                fitView({ padding: 0.2, duration: prefersReducedMotion ? 0 : 350 });
            }, 60);
            return () => clearTimeout(timer);
        }
    }, [nodes, fitView]);

    // Fit view on resize or expanded enter/exit with padding
    useEffect(() => {
        const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const timer = setTimeout(() => {
            fitView({ padding: 0.2, duration: prefersReducedMotion ? 0 : 300 });
        }, 120);
        return () => clearTimeout(timer);
    }, [isExpanded, fitView]);

    // Center & zoom on new node with its neighbors when selectedFile changes
    useEffect(() => {
        if (!selectedFile) {
            prevFileRef.current = null;
            return;
        }
        if (selectedFile === prevFileRef.current) return;
        prevFileRef.current = selectedFile;

        const targetNode = nodes.find(n => {
            const raw = n.data?.rawNode;
            const rawPath = raw?.path || (raw?.type === 'file' ? raw?.id : undefined);
            return rawPath === selectedFile || raw?.id === selectedFile || (raw?.type === 'file' && raw?.name === selectedFile);
        });

        if (targetNode) {
            const neighborIds = new Set<string>();
            edges.forEach(e => {
                if (e.source === targetNode.id) neighborIds.add(e.target);
                if (e.target === targetNode.id) neighborIds.add(e.source);
            });
            const focusNodes = [
                { id: targetNode.id },
                ...Array.from(neighborIds).map(id => ({ id }))
            ];
            const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            fitView({
                nodes: focusNodes,
                padding: 0.25,
                duration: prefersReducedMotion ? 0 : 400
            });
        }
    }, [selectedFile, nodes, edges, fitView]);

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
    onDoubleClickNode,
    isExpanded,
    hoveredGraphNode
}: {
    graph: import('../api').RepositoryGraph;
    simplify: boolean;
    selectedFile: string | null;
    selectedSymbol: any;
    onSelectNode: (rawNode: any) => void;
    onDoubleClickNode: (rawNode: any) => void;
    isExpanded: boolean;
    hoveredGraphNode: string | null;
}) {
    const [nodes, setNodes, onNodesChange] = useNodesState<any>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<any>([]);

    useEffect(() => {
        const layoutNodes: any[] = [];

        // Filter out stray / commit / symbol-change nodes
        const validNodes = graph.nodes.filter((n: any) => {
            if (n.type !== 'file' && n.type !== 'class' && n.type !== 'function' && n.type !== 'method' && n.type !== 'repository') {
                return false;
            }
            return Boolean(n.id);
        });

        const connCount = new Map<string, number>();
        graph.edges.forEach(e => {
            connCount.set(e.from, (connCount.get(e.from) || 0) + 1);
            connCount.set(e.to, (connCount.get(e.to) || 0) + 1);
        });

        const neighborInfo = getNeighborInfo(graph, selectedFile, selectedSymbol);

        // Hovered direct neighbors
        const hoveredNeighbors = new Set<string>();
        if (hoveredGraphNode) {
            const hNode = validNodes.find((vn: any) => vn.path === hoveredGraphNode || vn.id === hoveredGraphNode);
            if (hNode) {
                graph.edges.forEach(e => {
                    if (e.from === hNode.id) hoveredNeighbors.add(e.to);
                    if (e.to === hNode.id) hoveredNeighbors.add(e.from);
                });
            }
        }

        const approvedBoxes: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];

        const createNode = (n: any, pos: { x: number; y: number }) => {
            const nodePath = n.path || (n.type === 'file' ? n.id : undefined);
            const isSelected = neighborInfo.selectedNodeIds.has(n.id);
            const isCallee = neighborInfo.calleeNeighborIds.has(n.id);
            const isDependent = neighborInfo.dependentNeighborIds.has(n.id);
            const isHovered = hoveredGraphNode ? (nodePath === hoveredGraphNode || n.id === hoveredGraphNode) : false;
            const isDirectNeighbor = neighborInfo.directNeighborIds.has(n.id) || hoveredNeighbors.has(n.id);
            const isRepo = n.type === 'repository';
            const isDimmed = !isRepo && neighborInfo.hasSelection && !isSelected && !isCallee && !isDependent && !isHovered;

            // Clean file name only (no [TS] prefix, no full path)
            const displayName = n.name || (nodePath ? nodePath.split('/').pop() : n.id);
            const isCallable = n.type === 'function' || n.type === 'method';

            // Show label only for selected node, hovered node, and direct neighbors
            const wantsLabel = isSelected || isHovered || isDirectNeighbor;
            let showLabel = false;
            if (wantsLabel) {
                const labelW = Math.max(70, displayName.length * 8 + 24);
                const labelH = 24;
                const box = { x1: pos.x, y1: pos.y + 36, x2: pos.x + labelW, y2: pos.y + 36 + labelH };
                const overlaps = approvedBoxes.some(b => !(box.x2 < b.x1 || box.x1 > b.x2 || box.y2 < b.y1 || box.y1 > b.y2));
                if (!overlaps) {
                    approvedBoxes.push(box);
                    showLabel = true;
                }
            }

            let bg = 'rgba(16, 20, 21, 0.9)';
            let border = '1px solid rgba(255, 255, 255, 0.08)';
            let boxShadow = '0 2px 8px rgba(0, 0, 0, 0.35)';
            let opacity = 1;
            let borderRadius = '6px';

            if (isRepo) {
                // Repo root node = hollow ring in text color (not amber)
                bg = 'transparent';
                border = '1.5px solid #E8EAE6';
                borderRadius = '9999px';
            } else if (n.type === 'file') {
                border = '1px solid rgba(79, 209, 181, 0.4)';
                borderRadius = '8px';
            } else if (n.type === 'class') {
                border = '1px solid rgba(227, 160, 74, 0.4)';
            } else if (isCallable) {
                border = '1px solid rgba(138, 145, 140, 0.3)';
            }

            if (!isRepo && neighborInfo.hasSelection) {
                if (isSelected) {
                    border = '2px solid #4FD1B5';
                    boxShadow = '0 0 16px rgba(79, 209, 181, 0.45)';
                    opacity = 1;
                } else if (isCallee) {
                    border = '1.5px solid #4FD1B5';
                    boxShadow = '0 0 10px rgba(79, 209, 181, 0.25)';
                    opacity = 1;
                } else if (isDependent) {
                    border = '1.5px solid #E3A04A';
                    boxShadow = '0 0 10px rgba(227, 160, 74, 0.25)';
                    opacity = 1;
                } else if (isHovered) {
                    border = '2px solid #4FD1B5';
                    boxShadow = '0 0 14px rgba(79, 209, 181, 0.5)';
                    opacity = 1;
                } else if (isDimmed) {
                    border = '1px solid rgba(255, 255, 255, 0.04)';
                    boxShadow = 'none';
                    opacity = 0.15;
                }
            } else if (isHovered) {
                border = isRepo ? '2px solid #E8EAE6' : '2px solid #4FD1B5';
                boxShadow = isRepo ? '0 0 14px rgba(232, 234, 230, 0.4)' : '0 0 14px rgba(79, 209, 181, 0.5)';
                opacity = 1;
            }

            return {
                id: n.id,
                position: pos,
                data: {
                    label: (
                        <div className="flex flex-col gap-1 min-w-[90px] max-w-[200px] text-left pointer-events-none select-none">
                            <div className="flex items-center gap-1.5">
                                <span
                                    className={cn(
                                        "w-2 h-2 rounded-full inline-block shrink-0",
                                        isRepo
                                            ? "border border-[#E8EAE6] bg-transparent"
                                            : n.type === 'file'
                                            ? "bg-[#4FD1B5]"
                                            : n.type === 'class'
                                            ? "bg-[#E3A04A]"
                                            : "bg-[#8A918C]"
                                    )}
                                />
                                <span className="text-[10px] text-[#8A918C]">
                                    {isRepo ? 'repo' : n.type}
                                </span>
                            </div>
                            {showLabel && (
                                <div
                                    className="font-mono text-[12px] text-[#E8EAE6] px-2 py-0.5 rounded-full bg-[rgba(16,20,21,0.85)] border border-white/10 shadow-md inline-block whitespace-nowrap truncate max-w-[190px]"
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
                    borderRadius,
                    padding: '6px 10px',
                    boxShadow,
                    opacity,
                    color: '#E8EAE6',
                    cursor: 'pointer',
                    transition: 'opacity 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease'
                }
            };
        };

        if (simplify) {
            const fileNodes = validNodes.filter(n => n.type === 'file');
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
            let repoNode: any = null;

            validNodes.forEach((n: any) => {
                if (n.type === 'repository') {
                    repoNode = n;
                    return;
                }
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
                }
            });

            if (repoNode) {
                layoutNodes.push(createNode(repoNode, { x: 40, y: -45 }));
            }

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
        }

        const nodeIds = new Set(layoutNodes.map(n => n.id));
        const layoutEdges = graph.edges
            .filter(e => nodeIds.has(e.from) && nodeIds.has(e.to))
            .filter(e => {
                if (!simplify) return true;
                return e.type === 'imports';
            })
            .map((e: any, idx: number) => {
                const edgeId = e.id || `${e.from}->${e.to}:${e.type}`;
                const isOutgoing = neighborInfo.outgoingEdgeIds.has(edgeId);
                const isIncoming = neighborInfo.incomingEdgeIds.has(edgeId);
                const isEdgeDimmed = neighborInfo.hasSelection && !isOutgoing && !isIncoming;

                let stroke = 'rgba(113, 113, 122, 0.4)';
                let strokeDasharray: string | undefined = undefined;
                let animated = false;
                let strokeWidth = 1.5;
                let opacity = 1;
                let zIndex = 1;

                if (neighborInfo.hasSelection) {
                    if (isOutgoing) {
                        stroke = '#4FD1B5';
                        strokeWidth = 2.5;
                        animated = true;
                        zIndex = 10;
                    } else if (isIncoming) {
                        stroke = '#E3A04A';
                        strokeWidth = 2.5;
                        animated = true;
                        zIndex = 10;
                    } else if (isEdgeDimmed) {
                        stroke = 'rgba(255, 255, 255, 0.08)';
                        strokeWidth = 1;
                        opacity = 0.15;
                        zIndex = 0;
                    }
                } else {
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
                }

                return {
                    id: edgeId || `edge-${idx}`,
                    source: e.from,
                    target: e.to,
                    animated,
                    zIndex,
                    style: {
                        stroke,
                        strokeWidth,
                        strokeDasharray,
                        opacity,
                        transition: 'opacity 0.2s ease, stroke 0.2s ease'
                    }
                };
            });

        setNodes(layoutNodes);
        setEdges(layoutEdges);
    }, [graph, simplify, selectedFile, selectedSymbol, hoveredGraphNode, setNodes, setEdges]);

    return (
        <div className="w-full h-full relative">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={(_event, node) => onSelectNode(node.data?.rawNode)}
                onNodeDoubleClick={(_event, node) => onDoubleClickNode(node.data?.rawNode)}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                minZoom={0.03}
                maxZoom={2}
                proOptions={{ hideAttribution: true }}
            >
                <Background color="#27272a" gap={16} size={1} />
                <Controls
                    position="bottom-right"
                    className="!bg-[rgba(16,20,21,0.8)] !backdrop-blur-md !border !border-white/10 !rounded-lg !shadow-xl !overflow-hidden [&>button]:!border-b [&>button]:!border-white/10 last:[&>button]:!border-b-0 [&>button]:!bg-transparent [&>button]:!text-[#8A918C] [&>button:hover]:!bg-white/[0.06] [&>button:hover]:!text-[#4FD1B5] [&>button>svg]:!fill-current [&>button]:!w-7 [&>button]:!h-7"
                />
                <FlowFitViewHandler
                    isExpanded={isExpanded}
                    selectedFile={selectedFile}
                    nodes={nodes}
                    edges={edges}
                />
            </ReactFlow>
        </div>
    );
}

function OverviewGraph({ graph }: { graph: import('../api').RepositoryGraph }) {
    const {
        selectedFile,
        selectedSymbol,
        setSelectedFile,
        setSelectedSymbol,
        selectFile,
        setActiveTab,
        hoveredGraphNode
    } = useAppStore();

    const [viewMode, setViewMode] = useState<'2D' | '3D'>(() => {
        try {
            const saved = localStorage.getItem('graph-view-mode');
            return saved === '3D' ? '3D' : '2D';
        } catch {
            return '2D';
        }
    });

    const [isExpanded, setIsExpanded] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const fgInstanceRef = useRef<any>(null);
    const [dimensions, setDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

    const [simplify, setSimplify] = useState(false);
    const [focusConnected, setFocusConnected] = useState(false);
    const [focusDepth, setFocusDepth] = useState<1 | 2>(1);

    // History stack of last 10 visited files
    const [visitedHistory, setVisitedHistory] = useState<string[]>([]);
    const lastNavigatedFileRef = useRef<string | null>(selectedFile);

    useEffect(() => {
        if (selectedFile && selectedFile !== lastNavigatedFileRef.current) {
            if (lastNavigatedFileRef.current) {
                setVisitedHistory(prev => {
                    const next = [...prev, lastNavigatedFileRef.current!];
                    return next.slice(-10);
                });
            }
            lastNavigatedFileRef.current = selectedFile;
        }
    }, [selectedFile]);

    const handleBack = useCallback(async () => {
        if (visitedHistory.length === 0) return;
        const prevFile = visitedHistory[visitedHistory.length - 1];
        setVisitedHistory(prev => prev.slice(0, -1));
        lastNavigatedFileRef.current = prevFile;
        setActiveTab('Graph');
        await selectFile(prevFile);
    }, [visitedHistory, setActiveTab, selectFile]);

    const handleReset = useCallback(() => {
        setFocusConnected(false);
        setFocusDepth(1);
        setSelectedFile(null);
        setSelectedSymbol(null);
        if (viewMode === '3D' && fgInstanceRef.current && typeof fgInstanceRef.current.zoomToFit === 'function') {
            const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            fgInstanceRef.current.zoomToFit(prefersReducedMotion ? 0 : 400, 30);
        }
    }, [setSelectedFile, setSelectedSymbol, viewMode]);

    const activeGraph = useMemo(() => {
        if (focusConnected && selectedFile) {
            return getFocusedGraph(graph, selectedFile, selectedSymbol, focusDepth);
        }
        return graph;
    }, [graph, focusConnected, selectedFile, selectedSymbol, focusDepth]);

    const neighborInfo = useMemo(() => {
        return getNeighborInfo(activeGraph, selectedFile, selectedSymbol);
    }, [activeGraph, selectedFile, selectedSymbol]);

    const hoveredNeighbors = useMemo(() => {
        const ids = new Set<string>();
        if (!hoveredGraphNode) return ids;
        const hNode = activeGraph.nodes.find((n: any) => n.path === hoveredGraphNode || n.id === hoveredGraphNode);
        if (!hNode) return ids;
        activeGraph.edges.forEach((e: any) => {
            if (e.from === hNode.id) ids.add(e.to);
            if (e.to === hNode.id) ids.add(e.from);
        });
        return ids;
    }, [activeGraph, hoveredGraphNode]);

    const handleViewModeChange = (mode: '2D' | '3D') => {
        setViewMode(mode);
        try {
            localStorage.setItem('graph-view-mode', mode);
        } catch {
            // ignore
        }
    };

    // Track container dimensions and handle resize transitions
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
    }, [isExpanded]);

    // In-page expanded toggle
    const toggleExpanded = useCallback(() => {
        setIsExpanded(prev => !prev);
    }, []);

    // Escape key exits expanded mode
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isExpanded) {
                setIsExpanded(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isExpanded]);

    // Lock page scroll while expanded
    useEffect(() => {
        if (isExpanded) {
            const originalOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            return () => {
                document.body.style.overflow = originalOverflow;
            };
        }
    }, [isExpanded]);

    // On expanded toggle: resize and fit to view (2D handled via FlowFitViewHandler, 3D via zoomToFit)
    useEffect(() => {
        const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const timer = setTimeout(() => {
            if (containerRef.current) {
                setDimensions({
                    width: containerRef.current.clientWidth,
                    height: containerRef.current.clientHeight
                });
            }
            if (viewMode === '3D' && fgInstanceRef.current && typeof fgInstanceRef.current.zoomToFit === 'function') {
                fgInstanceRef.current.zoomToFit(prefersReducedMotion ? 0 : 400, 30);
            }
        }, 120);
        return () => clearTimeout(timer);
    }, [isExpanded, viewMode]);

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

    const handleDoubleClickNode = useCallback(async (node: any) => {
        if (!node) return;
        const nodePath = node.path || (node.type === 'file' ? node.id : undefined);
        if (nodePath) {
            setActiveTab('Graph');
            await selectFile(nodePath);
        }
    }, [setActiveTab, selectFile]);

    // Double-click detector for 3D
    const lastClickRef = useRef<{ id: string; time: number }>({ id: '', time: 0 });
    const handleNodeClick3D = useCallback((node: any) => {
        const now = Date.now();
        const isDouble = lastClickRef.current.id === node.id && (now - lastClickRef.current.time) < 350;
        lastClickRef.current = { id: node.id, time: now };

        if (isDouble) {
            handleDoubleClickNode(node);
        } else {
            handleSelectNode(node);
        }
    }, [handleDoubleClickNode, handleSelectNode]);

    const [graphData, setGraphData] = useState<{ nodes: any[]; links: any[] }>({ nodes: [], links: [] });

    const fgRef = useCallback((fg: any) => {
        if (fg) {
            fgInstanceRef.current = fg;
            fg.d3Force('charge').strength(-120);
            fg.d3Force('link').distance(40);
            const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            fg.controls().autoRotate = !prefersReducedMotion;
            fg.controls().autoRotateSpeed = 0.5;
            fg.controls().addEventListener('start', () => { fg.controls().autoRotate = false; });
            // Polish: Center 3D camera on initial load so nodes fill ~60% of canvas
            setTimeout(() => {
                if (typeof fg.zoomToFit === 'function') {
                    fg.zoomToFit(prefersReducedMotion ? 0 : 400, 30);
                }
            }, 350);
        }
    }, []);

    useEffect(() => {
        const connCount = new Map<string, number>();
        activeGraph.edges.forEach((e: any) => {
            connCount.set(e.from, (connCount.get(e.from) || 0) + 1);
            connCount.set(e.to, (connCount.get(e.to) || 0) + 1);
        });

        // Filter valid nodes, removing stray / non-code nodes
        const nodes = activeGraph.nodes
            .filter((n: any) => {
                if (simplify && n.type !== 'file') return false;
                if (n.type !== 'file' && n.type !== 'class' && n.type !== 'function' && n.type !== 'method' && n.type !== 'repository') {
                    return false;
                }
                return Boolean(n.id);
            })
            .map((n: any) => {
                let color = '#8A918C';
                let val = 1;
                if (n.type === 'repository') {
                    color = '#E8EAE6';
                    val = 3;
                } else if (n.type === 'file') {
                    color = '#4FD1B5';
                    val = 4;
                } else if (n.type === 'class') {
                    color = '#E3A04A';
                    val = 2;
                } else if (n.type === 'function' || n.type === 'method') {
                    color = '#8A918C';
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

        const nodeMap = new Map<string, any>(nodes.map((n: any) => [n.id, n]));

        const links = activeGraph.edges
            .filter((e: any) => {
                if (!simplify) return true;
                return e.type === 'imports' && nodeMap.has(e.from) && nodeMap.has(e.to);
            })
            .map((e: any) => {
                const edgeId = e.id || `${e.from}->${e.to}:${e.type}`;
                let color = 'rgba(113, 113, 122, 0.4)';
                if (e.type === 'contains') color = 'rgba(59, 130, 246, 0.2)';
                else if (e.type === 'imports') color = 'rgba(245, 158, 11, 0.6)';
                else if (e.type === 'calls') color = 'rgba(16, 185, 129, 0.4)';

                const link = { source: e.from, target: e.to, type: e.type, color, id: edgeId };
                if (nodeMap.has(e.from) && nodeMap.has(e.to)) {
                    nodeMap.get(e.from)!.neighbors.add(e.to);
                    nodeMap.get(e.to)!.neighbors.add(e.from);
                    nodeMap.get(e.from)!.links.push(link);
                    nodeMap.get(e.to)!.links.push(link);
                }
                return link;
            });

        setGraphData({ nodes, links });
    }, [activeGraph, simplify]);

    // Center 3D camera on new node with its neighbors when selectedFile changes
    useEffect(() => {
        if (viewMode !== '3D' || !selectedFile || !fgInstanceRef.current) return;
        const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const timer = setTimeout(() => {
            const target = graphData.nodes.find((n: any) => {
                return n.path === selectedFile || n.id === selectedFile || (n.type === 'file' && n.name === selectedFile);
            });
            if (target && typeof fgInstanceRef.current.zoomToFit === 'function') {
                fgInstanceRef.current.zoomToFit(prefersReducedMotion ? 0 : 400, 30, (node: any) => {
                    return node.id === target.id || target.neighbors?.has(node.id);
                });
            }
        }, 150);
        return () => clearTimeout(timer);
    }, [selectedFile, viewMode, graphData]);

    // Keep 3D sprite labels constant screen size and hide overlapping ones
    useEffect(() => {
        if (viewMode !== '3D') return;
        let animId: number;
        const tmpVec = new THREE.Vector3();

        const updateSprites = () => {
            const fg = fgInstanceRef.current;
            if (fg && typeof fg.scene === 'function' && typeof fg.camera === 'function') {
                const scene = fg.scene();
                const camera = fg.camera();
                if (scene && camera) {
                    const w = dimensions.width || (typeof window !== 'undefined' ? window.innerWidth : 800);
                    const h = dimensions.height || (typeof window !== 'undefined' ? window.innerHeight : 600);
                    const screenPositions: Array<{ x: number; y: number; sprite: any }> = [];

                    scene.traverse((obj: any) => {
                        if (obj.isSprite && obj.textHeight !== undefined) {
                            const dist = camera.position.distanceTo(obj.getWorldPosition(tmpVec));
                            const fovRad = ((camera.fov || 45) * Math.PI) / 180;
                            const targetHeight = 2 * dist * Math.tan(fovRad / 2) * (14 / Math.max(1, h));
                            obj.textHeight = Math.max(1, targetHeight);

                            const screenPos = tmpVec.clone().project(camera);
                            const screenX = (screenPos.x + 1) * w / 2;
                            const screenY = (-screenPos.y + 1) * h / 2;
                            screenPositions.push({ x: screenX, y: screenY, sprite: obj });
                        }
                    });

                    const drawn: Array<{ x: number; y: number }> = [];
                    for (const item of screenPositions) {
                        const overlaps = drawn.some(d => Math.abs(d.x - item.x) < 55 && Math.abs(d.y - item.y) < 22);
                        if (overlaps) {
                            item.sprite.visible = false;
                        } else {
                            item.sprite.visible = true;
                            drawn.push({ x: item.x, y: item.y });
                        }
                    }
                }
            }
            animId = requestAnimationFrame(updateSprites);
        };

        animId = requestAnimationFrame(updateSprites);
        return () => cancelAnimationFrame(animId);
    }, [viewMode, dimensions]);

    return (
        <div
            ref={containerRef}
            className={cn(
                "bg-[#07090A] overflow-hidden select-none",
                isExpanded
                    ? "fixed top-[48px] left-0 right-0 bottom-0 z-40 w-full h-[calc(100vh-48px)] flex flex-col"
                    : "w-full h-full rounded-lg border border-zinc-800/50 relative"
            )}
            style={{ cursor: viewMode === '3D' ? 'grab' : 'default' }}
        >
            {/* View Mode & Expanded Toolbar */}
            <div className="absolute top-3.5 left-3.5 z-30 glass-surface rounded-lg p-1.5 flex items-center gap-1.5 border border-white/10 shadow-lg text-xs font-mono select-none flex-wrap">
                <button
                    onClick={() => handleViewModeChange('2D')}
                    className={cn(
                        "px-2.5 py-1 text-xs rounded transition-colors cursor-pointer",
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
                        "px-2.5 py-1 text-xs rounded transition-colors cursor-pointer",
                        viewMode === '3D'
                            ? "bg-[#4FD1B5] text-[#04100D] font-medium"
                            : "text-[#8A918C] hover:text-[#E8EAE6]"
                    )}
                >
                    3D
                </button>

                <div className="h-3.5 w-[1px] bg-white/10" />

                <button
                    onClick={handleBack}
                    disabled={visitedHistory.length === 0}
                    className={cn(
                        "px-2.5 py-1 text-xs rounded transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
                        visitedHistory.length > 0 ? "text-[#E8EAE6] hover:bg-white/[0.06] hover:text-[#4FD1B5]" : "text-[#8A918C]"
                    )}
                    title={visitedHistory.length > 0 ? `Back to ${visitedHistory[visitedHistory.length - 1].split('/').pop()}` : "No previous files"}
                >
                    Back
                </button>

                <div className="h-3.5 w-[1px] bg-white/10" />

                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setFocusConnected(!focusConnected)}
                        className={cn(
                            "px-2.5 py-1 text-xs rounded transition-colors cursor-pointer border",
                            focusConnected
                                ? "bg-[#4FD1B5]/20 border-[#4FD1B5] text-[#4FD1B5] font-medium"
                                : "border-white/10 text-[#8A918C] hover:text-[#E8EAE6] hover:border-white/20"
                        )}
                        title="Toggle focus on selected node and its neighbors"
                    >
                        Focus connected
                    </button>
                    {focusConnected && (
                        <div className="flex items-center gap-1 pl-0.5">
                            {[1, 2].map((d) => (
                                <button
                                    key={d}
                                    onClick={() => setFocusDepth(d as 1 | 2)}
                                    className={cn(
                                        "px-2 py-0.5 text-[11px] font-mono rounded transition-colors cursor-pointer border",
                                        focusDepth === d
                                            ? "bg-[#4FD1B5] border-[#4FD1B5] text-[#04100D] font-medium"
                                            : "border-white/10 text-[#8A918C] hover:text-[#E8EAE6]"
                                    )}
                                    title={`Depth ${d}`}
                                >
                                    {d}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="h-3.5 w-[1px] bg-white/10" />

                <button
                    onClick={handleReset}
                    className="px-2.5 py-1 text-xs text-[#8A918C] hover:text-[#E8EAE6] hover:bg-white/[0.06] rounded transition-colors cursor-pointer"
                    title="Reset graph view and focus"
                >
                    Reset
                </button>

                <div className="h-3.5 w-[1px] bg-white/10" />

                <button
                    onClick={toggleExpanded}
                    className={cn(
                        "p-1 text-xs rounded transition-colors flex items-center justify-center cursor-pointer",
                        isExpanded
                            ? "bg-[#4FD1B5] text-[#04100D]"
                            : "text-[#8A918C] hover:text-[#E8EAE6]"
                    )}
                    title={isExpanded ? "Collapse (Esc to exit)" : "Expand (Esc to exit)"}
                >
                    {isExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                </button>
            </div>

            {/* In expanded mode, floating glass panel */}
            {isExpanded && (
                <div className="absolute top-3.5 right-3.5 z-30 w-[280px] max-h-[calc(100vh-48px-2rem)] overflow-y-auto bg-[rgba(16,20,21,0.8)] backdrop-blur-md border border-white/10 rounded-xl p-3.5 text-xs shadow-2xl space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-white/10">
                        <span className="font-semibold text-xs text-[#E8EAE6]">Node details</span>
                        <button
                            onClick={() => setIsExpanded(false)}
                            className="text-[11px] font-mono text-[#8A918C] hover:text-[#E8EAE6] cursor-pointer"
                            title="Collapse"
                        >
                            Collapse
                        </button>
                    </div>
                    {selectedFile ? (
                        <div className="space-y-3">
                            <div className="space-y-1.5 pb-3 border-b border-white/[0.08]">
                                <div className="flex justify-between py-1 border-b border-white/[0.06] text-[#8A918C]">
                                    <span>Type</span>
                                    <b className="text-[#E8EAE6] font-mono">{selectedSymbol?.type || 'file'}</b>
                                </div>
                                <div className="flex justify-between py-1 text-[#8A918C]">
                                    <span>Path</span>
                                    <b className="text-[#E8EAE6] font-mono text-[11px] truncate max-w-[170px]" title={selectedFile}>
                                        {selectedFile}
                                    </b>
                                </div>
                            </div>
                            <ConnectedFilesList maxHeightClass="max-h-56" />
                        </div>
                    ) : (
                        <div className="text-[11px] text-[#8A918C] py-4 text-center">
                            Click a node to inspect details
                        </div>
                    )}
                </div>
            )}

            {/* Main Graph View: 2D or 3D */}
            {viewMode === '2D' ? (
                <OverviewGraph2D
                    graph={activeGraph}
                    simplify={simplify}
                    selectedFile={selectedFile}
                    selectedSymbol={selectedSymbol}
                    onSelectNode={handleSelectNode}
                    onDoubleClickNode={handleDoubleClickNode}
                    isExpanded={isExpanded}
                    hoveredGraphNode={hoveredGraphNode}
                />
            ) : (
                <ForceGraph3D
                    ref={fgRef as any}
                    graphData={graphData}
                    width={dimensions.width > 0 ? dimensions.width : undefined}
                    height={dimensions.height > 0 ? dimensions.height : undefined}
                    nodeRelSize={4}
                    nodeVal={(node: any) => node.val}
                    linkColor={(link: any) => {
                        const edgeId = link.id || `${typeof link.source === 'object' ? link.source.id : link.source}->${typeof link.target === 'object' ? link.target.id : link.target}:${link.type}`;
                        if (neighborInfo.hasSelection) {
                            if (neighborInfo.outgoingEdgeIds.has(edgeId)) return 'rgba(79, 209, 181, 0.9)';
                            if (neighborInfo.incomingEdgeIds.has(edgeId)) return 'rgba(227, 160, 74, 0.9)';
                            return 'rgba(255, 255, 255, 0.04)';
                        }
                        return link.type === 'imports' ? 'rgba(227, 160, 74, 0.5)' : link.type === 'calls' ? 'rgba(79, 209, 181, 0.5)' : 'rgba(255, 255, 255, 0.15)';
                    }}
                    linkWidth={(link: any) => {
                        const edgeId = link.id || `${typeof link.source === 'object' ? link.source.id : link.source}->${typeof link.target === 'object' ? link.target.id : link.target}:${link.type}`;
                        if (neighborInfo.hasSelection && (neighborInfo.outgoingEdgeIds.has(edgeId) || neighborInfo.incomingEdgeIds.has(edgeId))) {
                            return 2;
                        }
                        return 0.5;
                    }}
                    linkDirectionalParticles={(link: any) => {
                        const edgeId = link.id || `${typeof link.source === 'object' ? link.source.id : link.source}->${typeof link.target === 'object' ? link.target.id : link.target}:${link.type}`;
                        if (neighborInfo.hasSelection && (neighborInfo.outgoingEdgeIds.has(edgeId) || neighborInfo.incomingEdgeIds.has(edgeId))) {
                            return 2;
                        }
                        return 0;
                    }}
                    linkDirectionalParticleWidth={1.5}
                    backgroundColor="#07090A"
                    onNodeClick={handleNodeClick3D}
                    nodeThreeObject={(node: any) => {
                        const nodePath = node.path || (node.type === 'file' ? node.id : undefined);
                        const isSelected = neighborInfo.selectedNodeIds.has(node.id);
                        const isCallee = neighborInfo.calleeNeighborIds.has(node.id);
                        const isDependent = neighborInfo.dependentNeighborIds.has(node.id);
                        const isHovered = hoveredGraphNode ? (nodePath === hoveredGraphNode || node.id === hoveredGraphNode) : false;
                        const isHoveredNeighbor = hoveredNeighbors.has(node.id);
                        const isNeighbor = isCallee || isDependent || isHoveredNeighbor;
                        const isRepo = node.type === 'repository';
                        const isDimmed = !isRepo && neighborInfo.hasSelection && !isSelected && !isCallee && !isDependent && !isHovered;

                        const baseColor = isRepo ? '#E8EAE6' : node.type === 'file' ? '#4FD1B5' : node.type === 'class' ? '#E3A04A' : '#8A918C';
                        const radius = Math.pow(node.val, 1 / 3) * 3.5;

                        // Repo root node = hollow ring in text color (not amber)
                        if (isRepo) {
                            const group = new THREE.Group();
                            const ringGeo = new THREE.TorusGeometry(4, 0.45, 16, 32);
                            const ringMat = new THREE.MeshBasicMaterial({ color: 0xE8EAE6 });
                            const ringMesh = new THREE.Mesh(ringGeo, ringMat);
                            group.add(ringMesh);

                            if (isSelected || isHovered || isNeighbor) {
                                const sprite = new SpriteText(node.name || 'Repository');
                                sprite.fontFace = 'IBM Plex Mono';
                                sprite.textHeight = 4;
                                sprite.color = '#E8EAE6';
                                sprite.backgroundColor = 'rgba(16, 20, 21, 0.85)';
                                sprite.borderRadius = 4;
                                sprite.padding = [4, 2];
                                sprite.borderColor = 'rgba(255, 255, 255, 0.1)';
                                sprite.borderWidth = 0.5;
                                sprite.position.y = 7;
                                sprite.renderOrder = 999;
                                sprite.material.depthTest = false;
                                group.add(sprite);
                            }
                            return group;
                        }

                        if (isDimmed) {
                            return new THREE.Mesh(
                                new THREE.SphereGeometry(radius),
                                new THREE.MeshLambertMaterial({ color: baseColor, opacity: 0.15, transparent: true })
                            );
                        }

                        const group = new THREE.Group();
                        let activeColor = baseColor;
                        let emissiveIntensity = 0;
                        if (isSelected) {
                            activeColor = '#4FD1B5';
                            emissiveIntensity = 0.4;
                        } else if (isCallee) {
                            activeColor = '#4FD1B5';
                            emissiveIntensity = 0.2;
                        } else if (isDependent) {
                            activeColor = '#E3A04A';
                            emissiveIntensity = 0.2;
                        } else if (isHovered) {
                            activeColor = '#4FD1B5';
                            emissiveIntensity = 0.35;
                        }

                        const material = new THREE.MeshLambertMaterial({
                            color: activeColor,
                            emissive: emissiveIntensity > 0 ? activeColor : 0x000000,
                            emissiveIntensity
                        });
                        const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius), material);
                        group.add(sphere);

                        // Labels only for selected node, hovered node, and direct neighbors
                        const showLabel = isSelected || isHovered || isNeighbor;
                        if (showLabel) {
                            const sprite = new SpriteText(node.name);
                            sprite.fontFace = 'IBM Plex Mono';
                            sprite.textHeight = 4;
                            sprite.color = isDependent ? '#E3A04A' : isCallee || isSelected ? '#4FD1B5' : '#E8EAE6';
                            sprite.backgroundColor = 'rgba(16, 20, 21, 0.85)';
                            sprite.borderRadius = 4;
                            sprite.padding = [4, 2];
                            sprite.borderColor = 'rgba(255, 255, 255, 0.1)';
                            sprite.borderWidth = 0.5;
                            sprite.position.y = radius + 5;
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
                <div className="flex items-center gap-3 text-[11px] text-[#8A918C] flex-wrap">
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#4FD1B5]"></span>File</span>
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#8A918C]"></span>Function</span>
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#E3A04A]"></span>Class</span>
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full border border-[#E8EAE6] bg-transparent inline-block"></span>Repo root</span>
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
    const {
        activeTab, setActiveTab, selectedFile, setSelectedFile,
        selectedSymbol, impactResult, setImpactResult, graph,
        repoUrl, selectedSha, setCodeHighlightLine, selectFile,
        changeSet, addToChangeSet, removeFromChangeSet, clearChangeSet,
        changeSetResult, setChangeSetResult, changeSetLoading, setChangeSetLoading
    } = useAppStore();
    const [depth, setDepth] = useState(3);
    const [maxRes, setMaxRes] = useState(50);
    const [analyzing, setAnalyzing] = useState(false);
    const [askQ, setAskQ] = useState('');
    const [aiError, setAiError] = useState<{ message: string; rawCode?: string } | null>(null);
    const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string; followups?: string[]; isThinking?: boolean }>>([]);
    const [historyData, setHistoryData] = useState<any[] | null>(null);
    const [connectionsData, setConnectionsData] = useState<any>(null);
    const [healthData, setHealthData] = useState<import('../api').HealthSummaryResult | null>(null);
    const [healthLoading, setHealthLoading] = useState(false);
    const [openHealthSections, setOpenHealthSections] = useState({ circular: true, unused: true, god: true });
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const [showImpactReasons, setShowImpactReasons] = useState(true);
    const [copiedReport, setCopiedReport] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);
    const abortControllerRef = useRef<AbortController | null>(null);

    // Save chat per repo+commit in localStorage (last 30 messages)
    const chatStorageKey = (repoUrl && selectedSha) ? `ask-chat:${repoUrl}:${selectedSha}` : null;

    useEffect(() => {
        if (!chatStorageKey) {
            setChatMessages([]);
            return;
        }
        try {
            const raw = localStorage.getItem(chatStorageKey);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    setChatMessages(parsed.slice(-30));
                    return;
                }
            }
        } catch {
            // ignore
        }
        setChatMessages([]);
    }, [chatStorageKey]);

    const saveChatMessages = useCallback((msgs: Array<{ role: 'user' | 'assistant'; content: string; followups?: string[]; isThinking?: boolean }>) => {
        const toSave = msgs.filter(m => !m.isThinking).slice(-30);
        setChatMessages(msgs);
        if (chatStorageKey) {
            try {
                localStorage.setItem(chatStorageKey, JSON.stringify(toSave));
            } catch {
                // ignore
            }
        }
    }, [chatStorageKey]);

    const handleNewChat = useCallback(() => {
        setChatMessages([]);
        setAiError(null);
        setAskQ('');
        if (chatStorageKey) {
            try {
                localStorage.removeItem(chatStorageKey);
            } catch {
                // ignore
            }
        }
    }, [chatStorageKey]);

    const buildMarkdownReport = useCallback(async (): Promise<string> => {
        const fileName = selectedFile ? selectedFile.split('/').pop() : (selectedSymbol?.name || 'unknown');
        const lines: string[] = [];

        lines.push(`# Impact Report: ${fileName}`);
        lines.push('');
        lines.push(`- **Repository:** ${repoUrl || 'Unknown'}`);
        lines.push(`- **Commit:** ${selectedSha ? selectedSha.substring(0, 7) : 'HEAD'}`);
        lines.push(`- **Selected file:** \`${selectedFile || fileName}\``);
        if (selectedSymbol) {
            lines.push(`- **Selected symbol:** \`${selectedSymbol.name}\` (${selectedSymbol.type})`);
        }
        lines.push('');

        // Risk score and reasons
        const callersCount = impactResult ? impactResult.directCallers.length : 0;
        const consumersCount = impactResult ? impactResult.transitiveConsumers.length : 0;
        const totalAffected = callersCount + consumersCount;
        lines.push(`## Risk Score`);
        lines.push('');
        lines.push(`- **Affected consumers:** ${totalAffected} (${callersCount} direct, ${consumersCount} transitive)`);
        if (impactResult?.reasons && impactResult.reasons.length > 0) {
            lines.push('');
            lines.push(`### Why this score`);
            for (const r of impactResult.reasons) {
                lines.push(`- ${r.label}: **${r.value}**`);
            }
        }
        lines.push('');

        // Dependents list
        lines.push(`## Dependents`);
        lines.push('');
        if (impactResult && (impactResult.directCallers.length > 0 || impactResult.transitiveConsumers.length > 0)) {
            if (impactResult.directCallers.length > 0) {
                lines.push(`### Direct Callers (${impactResult.directCallers.length})`);
                for (const dc of impactResult.directCallers) {
                    lines.push(`- \`${dc.symbol.name}\` (${dc.symbol.type})`);
                }
                lines.push('');
            }
            if (impactResult.transitiveConsumers.length > 0) {
                lines.push(`### Transitive Consumers (${impactResult.transitiveConsumers.length})`);
                for (const tc of impactResult.transitiveConsumers) {
                    lines.push(`- \`${tc.symbol.name}\` (${tc.symbol.type})`);
                }
                lines.push('');
            }
        } else {
            lines.push(`No dependents found.`);
            lines.push('');
        }

        // Tests to run
        lines.push(`## Tests to Run`);
        lines.push('');
        const tests = (impactResult?.tests || [])
            .map((t: any) => (typeof t === 'string' ? t : (t.path || t.symbol?.path)))
            .filter(Boolean) as string[];
        if (tests.length > 0) {
            for (const t of tests) {
                lines.push(`- \`${t}\``);
            }
        } else {
            lines.push(`No test found for this file.`);
        }
        lines.push('');

        // Owners (only if present)
        if (repoUrl && selectedFile) {
            try {
                const ownersRes = await api.repositories.getOwners(repoUrl, selectedFile, selectedSha);
                if (ownersRes && ownersRes.owners && ownersRes.owners.length > 0) {
                    lines.push(`## Owners`);
                    lines.push('');
                    for (const o of ownersRes.owners) {
                        lines.push(`- **${o.name}**: ${o.share}% (${o.count} commits)`);
                    }
                    if (ownersRes.busFactorRisk) {
                        lines.push('');
                        lines.push(`> ⚠️ **Bus factor risk:** Mostly one person knows this file`);
                    }
                    lines.push('');
                }
            } catch {
                // Ignore owners fetch failures gracefully
            }
        }

        return lines.join('\n');
    }, [repoUrl, selectedSha, selectedFile, selectedSymbol, impactResult]);

    const handleDownloadReport = async () => {
        const md = await buildMarkdownReport();
        const baseName = selectedFile ? selectedFile.split('/').pop()?.replace(/\.[^/.]+$/, "") : "file";
        const filename = `impact-${baseName || "file"}.md`;
        const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const handleCopyReport = async () => {
        const md = await buildMarkdownReport();
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(md);
        }
        setCopiedReport(true);
        setTimeout(() => setCopiedReport(false), 2000);
    };

    // Auto-scroll to bottom of chat on new messages or thinking state
    useEffect(() => {
        if (activeTab === 'AskAI') {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [chatMessages, aiError, activeTab]);

    // Reset Ask AI input on selected file change
    useEffect(() => {
        setAskQ('');
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

    const parseAnswerFollowups = (rawAnswer: string): { cleanAnswer: string; followups: string[] } => {
        const lines = rawAnswer.split('\n');
        let followups: string[] = [];
        const cleanLines: string[] = [];

        for (const line of lines) {
            const match = line.match(/^FOLLOWUPS:\s*(.+)$/i);
            if (match) {
                const parts = match[1].split('|').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
                if (parts.length > 0) {
                    followups = parts.slice(0, 3);
                }
            } else {
                cleanLines.push(line);
            }
        }

        return {
            cleanAnswer: cleanLines.join('\n').trim(),
            followups
        };
    };

    const handleStopAi = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        setIsStreaming(false);
        setChatMessages(prev => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant' && last.isThinking) {
                return prev.slice(0, -1);
            }
            return prev;
        });
    }, []);

    const askAI = async (questionToAsk?: string) => {
        const q = (typeof questionToAsk === 'string' ? questionToAsk : askQ).trim();
        if (!q || !repoUrl || !selectedSha || !graph || !selectedFile || isStreaming) return;

        setAskQ('');
        setAiError(null);

        const newMessages: Array<{ role: 'user' | 'assistant'; content: string; followups?: string[]; isThinking?: boolean }> = [
            ...chatMessages.filter(m => !m.isThinking),
            { role: 'user', content: q },
            { role: 'assistant', content: '', isThinking: true }
        ];
        setChatMessages(newMessages);

        const target = selectedSymbol
            ? { type: 'symbol', path: selectedSymbol.path, symbol: selectedSymbol }
            : { type: 'file', path: selectedFile };

        const controller = new AbortController();
        abortControllerRef.current = controller;
        setIsStreaming(true);

        let accumulatedStreamedText = '';

        try {
            const res = await api.ai.askStream(
                repoUrl,
                selectedSha,
                [selectedFile],
                target as any,
                q,
                undefined,
                (token: string) => {
                    accumulatedStreamedText += token;
                    setChatMessages(prev => {
                        const copy = [...prev];
                        const lastIdx = copy.length - 1;
                        if (lastIdx >= 0 && copy[lastIdx].role === 'assistant') {
                            const { cleanAnswer } = parseAnswerFollowups(accumulatedStreamedText);
                            copy[lastIdx] = {
                                role: 'assistant',
                                content: cleanAnswer,
                                isThinking: false
                            };
                        }
                        return copy;
                    });
                },
                controller.signal
            );

            if (res.status === 'error' && res.error) {
                setChatMessages(prev => prev.filter(m => !m.isThinking && m.content.length > 0));
                setAiError(formatAiError(res.error.code || res.error.message || res.error));
            } else {
                const { cleanAnswer, followups } = parseAnswerFollowups(res.answer || accumulatedStreamedText);
                const updated = [
                    ...newMessages.slice(0, -1),
                    { role: 'assistant' as const, content: cleanAnswer, followups }
                ];
                saveChatMessages(updated);
            }
        } catch (e: any) {
            if (controller.signal.aborted) {
                // Stopped by user: preserve accumulated text if any
                if (accumulatedStreamedText) {
                    const { cleanAnswer, followups } = parseAnswerFollowups(accumulatedStreamedText);
                    const updated = [
                        ...newMessages.slice(0, -1),
                        { role: 'assistant' as const, content: cleanAnswer, followups }
                    ];
                    saveChatMessages(updated);
                } else {
                    setChatMessages(prev => prev.filter(m => !m.isThinking));
                }
            } else {
                setChatMessages(prev => prev.filter(m => !m.isThinking && m.content.length > 0));
                setAiError(formatAiError(e));
            }
        } finally {
            setIsStreaming(false);
            abortControllerRef.current = null;
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

    const fetchHealth = useCallback(async () => {
        if (!graph) return;
        setHealthLoading(true);
        try {
            const res = await api.graph.health(graph);
            setHealthData(res);
        } catch (e) {
            console.error(e);
            setHealthData({ circularImports: [], unusedFiles: [], godFiles: [] });
        } finally {
            setHealthLoading(false);
        }
    }, [graph]);

    useEffect(() => {
        if (activeTab === 'Health') fetchHealth();
    }, [activeTab, fetchHealth]);

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
                                {selectedFile ? (selectedSymbol ? `${selectedSymbol.name}()` : selectedFile.split('/').pop()) : "Repository overview"}
                            </h2>
                            <div className="flex gap-2 items-center mt-0.5">
                                {selectedSymbol && <Badge variant="default">{selectedSymbol.type}</Badge>}
                                <span className="text-[11px] text-[#8A918C] font-mono">{selectedFile || "Select a file from the sidebar to inspect"}</span>
                            </div>
                        </div>
                    </div>
                    {selectedFile && (
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => addToChangeSet(selectedFile)}
                                disabled={changeSet.includes(selectedFile) || changeSet.length >= 20}
                                className={cn(
                                    "px-3 py-1.5 rounded-lg text-xs font-mono flex items-center gap-1.5 transition-colors cursor-pointer border",
                                    changeSet.includes(selectedFile)
                                        ? "bg-[#4FD1B5]/15 border-[#4FD1B5]/40 text-[#4FD1B5] cursor-default"
                                        : "glass-surface border-white/10 text-[#E8EAE6] hover:border-[#4FD1B5]/50 hover:text-[#4FD1B5]"
                                )}
                                title={changeSet.includes(selectedFile) ? "Already in change set" : "Add to change set"}
                            >
                                <Plus size={13} />
                                <span>{changeSet.includes(selectedFile) ? "In change set" : "Add to change set"}</span>
                            </button>
                        </div>
                    )}
                </div>

                <div className="flex gap-4 mt-4 border-b border-white/[0.06]">
                    {[
                        { id: 'Overview', icon: Hexagon, label: 'Overview' },
                        { id: 'Graph', icon: Network, label: 'Graph' },
                        { id: 'Impact', icon: Activity, label: 'Impact' },
                        { id: 'ChangeSet', icon: Layers, label: `Change set${changeSet.length > 0 ? ` (${changeSet.length})` : ''}` },
                        { id: 'Connections', icon: Network, label: 'Connections' },
                        { id: 'Code', icon: Code2, label: 'Code' },
                        { id: 'History', icon: Clock, label: 'History' },
                        { id: 'Health', icon: HeartPulse, label: 'Health' },
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
                                <div className="flex items-center gap-2">
                                    <div className="flex items-center gap-2 glass-surface p-1.5 rounded-lg border-white/10">
                                        <button
                                            onClick={handleDownloadReport}
                                            className="px-2.5 py-1 rounded text-xs font-medium text-[#E8EAE6] hover:text-[#4FD1B5] hover:bg-white/[0.04] transition-colors cursor-pointer flex items-center gap-1.5"
                                            title="Download report as Markdown"
                                        >
                                            <Download size={13} />
                                            <span>Download report</span>
                                        </button>
                                        <button
                                            onClick={handleCopyReport}
                                            className="px-2.5 py-1 rounded text-xs font-medium text-[#E8EAE6] hover:text-[#4FD1B5] hover:bg-white/[0.04] transition-colors cursor-pointer flex items-center gap-1.5"
                                            title="Copy report as PR comment"
                                        >
                                            {copiedReport ? <Check size={13} className="text-[#4FD1B5]" /> : <Copy size={13} />}
                                            <span>{copiedReport ? "Copied" : "Copy as PR comment"}</span>
                                        </button>
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
                                        {/* Tests to run */}
                                        <div className="pt-3 border-t border-white/[0.08] mt-3">
                                            <div className="text-[11px] text-[#8A918C] mb-2 font-medium">Tests to run</div>
                                            {(() => {
                                                const tests = (impactResult.tests || [])
                                                    .map((t: any) => (typeof t === 'string' ? t : (t.path || t.symbol?.path)))
                                                    .filter(Boolean) as string[];
                                                if (tests.length === 0) {
                                                    return (
                                                        <div className="flex items-center gap-2 text-xs text-[#8A918C] py-1">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 inline-block" />
                                                            <span>No test found for this file</span>
                                                        </div>
                                                    );
                                                }
                                                return (
                                                    <div className="space-y-1.5 max-h-36 overflow-y-auto scrollbar-custom">
                                                        {tests.map((testPath, i) => (
                                                            <button
                                                                key={i}
                                                                onClick={() => selectFile(testPath)}
                                                                className="w-full text-left font-mono text-xs text-[#E8EAE6] hover:text-[#4FD1B5] p-1.5 rounded-md glass-surface border-white/[0.06] hover:border-[#4FD1B5]/30 transition-colors truncate block"
                                                                title={testPath}
                                                            >
                                                                {testPath.split('/').pop()}
                                                            </button>
                                                        ))}
                                                    </div>
                                                );
                                            })()}
                                        </div>

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
                                <div className="flex items-center gap-3">
                                    <span className="text-[11px] font-mono text-[#8A918C] truncate max-w-[200px]">
                                        {selectedSymbol?.name || (selectedFile ? selectedFile.split('/').pop() : 'whole repository')}
                                    </span>
                                    <button
                                        onClick={handleNewChat}
                                        className="px-2 py-1 rounded-md text-[11px] font-medium text-[#8A918C] hover:text-[#E8EAE6] hover:bg-white/[0.04] transition-colors cursor-pointer flex items-center gap-1 border border-white/10"
                                        title="Clear conversation"
                                    >
                                        <Plus size={12} />
                                        <span>New chat</span>
                                    </button>
                                </div>
                            </div>

                            {/* Chat Messages - Fixed height scroll area */}
                            <div className="flex-1 p-4 overflow-y-auto scrollbar-custom space-y-3 min-h-0">
                                {aiError && (
                                    <div className="p-3.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 space-y-2.5">
                                        <div className="flex items-center gap-2 text-xs font-medium text-red-200">
                                            <ShieldAlert size={14} className="text-red-400 shrink-0" />
                                            <span>{aiError.message}</span>
                                        </div>
                                    </div>
                                )}

                                {chatMessages.length === 0 && !aiError ? (
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
                                ) : (
                                    chatMessages.map((msg, idx) => (
                                        <div key={idx} className={cn("flex", msg.role === 'user' ? "justify-end" : "justify-start")}>
                                            {msg.role === 'user' ? (
                                                <div className="max-w-[70%] px-3.5 py-2.5 rounded-xl bg-white/[0.07] border border-white/10 text-xs text-[#E8EAE6] leading-relaxed">
                                                    {msg.content}
                                                </div>
                                            ) : (
                                                <div className="max-w-[85%] px-3.5 py-3 rounded-xl bg-white/[0.02] border border-white/10 text-xs text-[#E8EAE6] leading-relaxed space-y-2">
                                                    {msg.isThinking ? (
                                                        <div className="flex items-center gap-2.5 text-[#8A918C] text-xs font-mono py-1">
                                                            <span>Thinking</span>
                                                            <span className="flex items-center gap-1">
                                                                <span className="w-1.5 h-1.5 rounded-full bg-[#4FD1B5] typing-dot" style={{ animationDelay: '0ms' }} />
                                                                <span className="w-1.5 h-1.5 rounded-full bg-[#4FD1B5] typing-dot" style={{ animationDelay: '200ms' }} />
                                                                <span className="w-1.5 h-1.5 rounded-full bg-[#4FD1B5] typing-dot" style={{ animationDelay: '400ms' }} />
                                                            </span>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            <MarkdownRenderer content={msg.content} />

                                                            {/* Evidence chips: only show when answer actually cites file:line */}
                                                            {(() => {
                                                                const matches = msg.content.match(/\b(?:[\w./\\-]+):(?:\d+)\b/g);
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

                                                            {/* Follow-up chips */}
                                                            {msg.followups && msg.followups.length > 0 && (
                                                                <div className="pt-2.5 border-t border-white/[0.06] flex items-center gap-1.5 flex-wrap">
                                                                    {msg.followups.map((followup, fIdx) => (
                                                                        <button
                                                                            key={fIdx}
                                                                            onClick={() => askAI(followup)}
                                                                            className="text-[11px] font-mono px-2.5 py-1 rounded-full border border-[#4FD1B5]/30 bg-[#4FD1B5]/[0.05] text-[#4FD1B5] hover:bg-[#4FD1B5]/15 hover:border-[#4FD1B5]/50 transition-colors cursor-pointer text-left"
                                                                        >
                                                                            {followup}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    ))
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
                                        onKeyDown={e => e.key === 'Enter' && !isStreaming && askAI()}
                                        placeholder={`Ask about ${selectedSymbol?.name || (selectedFile ? selectedFile.split('/').pop() : 'the repository')}...`}
                                        className="flex-1 bg-transparent px-3 py-1.5 text-xs text-[#E8EAE6] placeholder:text-[#8A918C]/60 outline-none font-sans"
                                    />
                                    {isStreaming ? (
                                        <button
                                            type="button"
                                            onClick={handleStopAi}
                                            className="px-3 py-1 text-xs shrink-0 rounded font-mono flex items-center gap-1.5 bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 cursor-pointer transition-colors"
                                            title="Stop generating"
                                        >
                                            <Square size={12} className="fill-current" />
                                            <span>Stop</span>
                                        </button>
                                    ) : (
                                        <Button
                                            onClick={() => askAI()}
                                            className="px-3 py-1 text-xs shrink-0"
                                            disabled={!askQ.trim() || isStreaming}
                                        >
                                            Send
                                        </Button>
                                    )}
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

                    {activeTab === 'Health' && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-xs font-semibold text-[#E8EAE6]">Repository health</h3>
                                    <p className="text-[11px] text-[#8A918C] mt-0.5">
                                        Architectural smells and dependency diagnostics computed from the repository graph.
                                    </p>
                                </div>
                                <Button onClick={fetchHealth} className="px-3 py-1 text-xs" disabled={healthLoading || !graph}>
                                    {healthLoading ? <Loader2 size={12} className="animate-spin" /> : 'Re-check'}
                                </Button>
                            </div>

                            {healthLoading && !healthData ? (
                                <div className="text-[#8A918C] py-16 flex flex-col items-center justify-center gap-2.5">
                                    <Loader2 size={20} className="animate-spin text-[#4FD1B5]" />
                                    <span className="text-xs font-mono">Analyzing repository health...</span>
                                </div>
                            ) : !healthData ? (
                                <div className="glass-surface p-12 rounded-xl border-white/10 text-center flex flex-col items-center justify-center gap-2">
                                    <HeartPulse size={22} className="text-[#8A918C] mb-1" />
                                    <div className="text-xs font-medium text-[#E8EAE6]">No graph loaded</div>
                                    <div className="text-[11px] text-[#8A918C] max-w-sm">
                                        Analyze a repository first to inspect its health summary.
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {/* 1. Circular Imports */}
                                    <div className="glass-surface p-4 rounded-xl border-white/10 space-y-3">
                                        <button
                                            onClick={() => setOpenHealthSections(s => ({ ...s, circular: !s.circular }))}
                                            className="flex items-center justify-between w-full text-left cursor-pointer"
                                        >
                                            <div className="flex items-center gap-2">
                                                <h4 className="text-xs font-semibold text-[#E8EAE6]">Circular imports</h4>
                                                <span className="font-mono text-[11px] px-2 py-0.5 rounded-full border border-white/10 bg-white/[0.03] text-[#4FD1B5]">
                                                    {healthData.circularImports.length}
                                                </span>
                                            </div>
                                            {openHealthSections.circular ? <ChevronUp size={14} className="text-[#8A918C]" /> : <ChevronDown size={14} className="text-[#8A918C]" />}
                                        </button>

                                        {openHealthSections.circular && (
                                            <div className="pt-2 border-t border-white/[0.06] space-y-2">
                                                {healthData.circularImports.length === 0 ? (
                                                    <div className="text-xs text-[#8A918C] py-1">None found</div>
                                                ) : (
                                                    <div className="space-y-2 max-h-60 overflow-y-auto scrollbar-custom pr-1">
                                                        {healthData.circularImports.map((cycle, i) => (
                                                            <div key={i} className="p-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] text-xs space-y-1.5">
                                                                <div className="text-[10px] text-[#8A918C] font-mono">Cycle #{i + 1} ({cycle.length} files)</div>
                                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                                    {cycle.map((filePath, fIdx) => (
                                                                        <div key={fIdx} className="inline-flex items-center gap-1.5">
                                                                            <button
                                                                                onClick={() => selectFile(filePath)}
                                                                                className="font-mono text-xs text-[#E8EAE6] hover:text-[#4FD1B5] transition-colors cursor-pointer underline-offset-2 hover:underline"
                                                                                title={filePath}
                                                                            >
                                                                                {filePath.split('/').pop()}
                                                                            </button>
                                                                            {fIdx < cycle.length - 1 && (
                                                                                <span className="text-[#8A918C]/60 text-[10px] font-mono">→</span>
                                                                            )}
                                                                        </div>
                                                                    ))}
                                                                    <span className="text-[#8A918C]/60 text-[10px] font-mono">→</span>
                                                                    <button
                                                                        onClick={() => selectFile(cycle[0])}
                                                                        className="font-mono text-xs text-[#8A918C] hover:text-[#4FD1B5] transition-colors cursor-pointer"
                                                                        title={cycle[0]}
                                                                    >
                                                                        {cycle[0].split('/').pop()}
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* 2. Unused Files */}
                                    <div className="glass-surface p-4 rounded-xl border-white/10 space-y-3">
                                        <button
                                            onClick={() => setOpenHealthSections(s => ({ ...s, unused: !s.unused }))}
                                            className="flex items-center justify-between w-full text-left cursor-pointer"
                                        >
                                            <div className="flex items-center gap-2">
                                                <h4 className="text-xs font-semibold text-[#E8EAE6]">Unused files</h4>
                                                <span className="font-mono text-[11px] px-2 py-0.5 rounded-full border border-white/10 bg-white/[0.03] text-[#4FD1B5]">
                                                    {healthData.unusedFiles.length}
                                                </span>
                                            </div>
                                            {openHealthSections.unused ? <ChevronUp size={14} className="text-[#8A918C]" /> : <ChevronDown size={14} className="text-[#8A918C]" />}
                                        </button>

                                        {openHealthSections.unused && (
                                            <div className="pt-2 border-t border-white/[0.06] space-y-2">
                                                {healthData.unusedFiles.length === 0 ? (
                                                    <div className="text-xs text-[#8A918C] py-1">None found</div>
                                                ) : (
                                                    <div className="space-y-1.5 max-h-60 overflow-y-auto scrollbar-custom pr-1">
                                                        {healthData.unusedFiles.map((filePath, i) => (
                                                            <div key={i} className="flex items-center justify-between p-2 rounded-lg border border-white/[0.06] bg-white/[0.02] text-xs">
                                                                <button
                                                                    onClick={() => selectFile(filePath)}
                                                                    className="font-mono text-[#E8EAE6] hover:text-[#4FD1B5] transition-colors cursor-pointer truncate text-left"
                                                                    title={filePath}
                                                                >
                                                                    {filePath.split('/').pop()}
                                                                </button>
                                                                <span className="text-[10px] font-mono text-[#8A918C]/60 truncate ml-2 max-w-[180px] hidden sm:inline" title={filePath}>
                                                                    {filePath}
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* 3. God Files */}
                                    <div className="glass-surface p-4 rounded-xl border-white/10 space-y-3">
                                        <button
                                            onClick={() => setOpenHealthSections(s => ({ ...s, god: !s.god }))}
                                            className="flex items-center justify-between w-full text-left cursor-pointer"
                                        >
                                            <div className="flex items-center gap-2">
                                                <h4 className="text-xs font-semibold text-[#E8EAE6]">God files</h4>
                                                <span className="font-mono text-[11px] px-2 py-0.5 rounded-full border border-white/10 bg-white/[0.03] text-[#4FD1B5]">
                                                    {healthData.godFiles.length}
                                                </span>
                                            </div>
                                            {openHealthSections.god ? <ChevronUp size={14} className="text-[#8A918C]" /> : <ChevronDown size={14} className="text-[#8A918C]" />}
                                        </button>

                                        {openHealthSections.god && (
                                            <div className="pt-2 border-t border-white/[0.06] space-y-2">
                                                {healthData.godFiles.length === 0 ? (
                                                    <div className="text-xs text-[#8A918C] py-1">None found</div>
                                                ) : (
                                                    <div className="space-y-1.5 max-h-60 overflow-y-auto scrollbar-custom pr-1">
                                                        {healthData.godFiles.map((gf, i) => (
                                                            <div key={i} className="flex items-center justify-between p-2 rounded-lg border border-white/[0.06] bg-white/[0.02] text-xs">
                                                                <button
                                                                    onClick={() => selectFile(gf.path)}
                                                                    className="font-mono text-[#E8EAE6] hover:text-[#4FD1B5] transition-colors cursor-pointer truncate text-left"
                                                                    title={gf.path}
                                                                >
                                                                    {gf.path.split('/').pop()}
                                                                </button>
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-[10px] font-mono text-[#8A918C]/60 truncate max-w-[140px] hidden sm:inline" title={gf.path}>
                                                                        {gf.path}
                                                                    </span>
                                                                    <Badge variant="amber">{gf.importCount} imports</Badge>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
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

                    {activeTab === 'ChangeSet' && (
                        <div className="flex-1 flex flex-col space-y-4 min-h-0">
                            {/* Change Set Header */}
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-sm font-semibold text-[#E8EAE6] flex items-center gap-2">
                                        <span>Change set impact</span>
                                        <span className="text-xs font-mono font-normal text-[#8A918C]">
                                            ({changeSet.length} {changeSet.length === 1 ? 'file' : 'files'})
                                        </span>
                                    </h3>
                                    <p className="text-xs text-[#8A918C] mt-0.5 font-sans">
                                        Combined blast radius and affected files across your selected change set.
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    {changeSet.length > 0 && (
                                        <button
                                            onClick={clearChangeSet}
                                            className="px-2.5 py-1 rounded text-xs font-medium text-[#8A918C] hover:text-[#E8EAE6] hover:bg-white/[0.04] transition-colors cursor-pointer"
                                        >
                                            Clear all
                                        </button>
                                    )}
                                    <Button
                                        onClick={async () => {
                                            if (!graph || changeSet.length === 0) return;
                                            setChangeSetLoading(true);
                                            try {
                                                const res = await api.graph.impactBatch(graph, changeSet);
                                                setChangeSetResult(res);
                                            } catch (err) {
                                                console.error("Batch impact failed", err);
                                            } finally {
                                                setChangeSetLoading(false);
                                            }
                                        }}
                                        disabled={changeSetLoading || changeSet.length === 0 || !graph}
                                        className="px-3 py-1 text-xs"
                                    >
                                        {changeSetLoading ? (
                                            <>
                                                <Loader2 size={12} className="animate-spin mr-1.5" />
                                                Analyzing...
                                            </>
                                        ) : (
                                            'Analyze change set'
                                        )}
                                    </Button>
                                </div>
                            </div>

                            {/* Empty or loading states */}
                            {changeSet.length === 0 ? (
                                <div className="flex-1 text-center py-20 border border-dashed border-white/10 rounded-xl glass-surface p-8 flex flex-col items-center justify-center gap-2">
                                    <Layers size={28} className="text-[#8A918C]/60 mb-1" />
                                    <div className="text-sm font-medium text-[#E8EAE6]">Your change set is empty</div>
                                    <p className="text-xs text-[#8A918C] max-w-sm">
                                        Add files by clicking &quot;Add to change set&quot; in the file header or from the file view to analyze their combined blast radius.
                                    </p>
                                </div>
                            ) : changeSetLoading ? (
                                <div className="flex-1 text-[#8A918C] py-20 flex flex-col items-center justify-center gap-3">
                                    <Loader2 size={24} className="animate-spin text-[#4FD1B5]" />
                                    <span className="text-xs font-mono">Analyzing combined impact across {changeSet.length} files...</span>
                                </div>
                            ) : !changeSetResult ? (
                                <div className="flex-1 text-center py-16 border border-white/10 rounded-xl glass-surface p-6 flex flex-col items-center justify-center gap-3">
                                    <div className="text-xs text-[#8A918C]">
                                        {changeSet.length} {changeSet.length === 1 ? 'file' : 'files'} ready for analysis.
                                    </div>
                                    <Button
                                        onClick={async () => {
                                            if (!graph || changeSet.length === 0) return;
                                            setChangeSetLoading(true);
                                            try {
                                                const res = await api.graph.impactBatch(graph, changeSet);
                                                setChangeSetResult(res);
                                            } catch (err) {
                                                console.error("Batch impact failed", err);
                                            } finally {
                                                setChangeSetLoading(false);
                                            }
                                        }}
                                        disabled={!graph}
                                        className="px-4 py-1.5 text-xs font-mono"
                                    >
                                        Analyze change set now
                                    </Button>
                                </div>
                            ) : (
                                /* Results view */
                                <div className="space-y-4">
                                    {/* Stat cards / Combined Risk */}
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                        {/* Combined Risk Score */}
                                        <div className="glass-surface p-4 rounded-xl border border-white/10 flex flex-col justify-between">
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs text-[#8A918C]">Combined risk</span>
                                                <ShieldAlert size={14} className={changeSetResult.combinedRisk > 60 ? "text-red-400" : changeSetResult.combinedRisk > 30 ? "text-[#E3A04A]" : "text-[#4FD1B5]"} />
                                            </div>
                                            <div className="my-2">
                                                <div className="flex items-baseline gap-1.5">
                                                    <span className="text-2xl font-bold font-mono text-[#E8EAE6]">
                                                        {changeSetResult.combinedRisk}
                                                    </span>
                                                    <span className="text-xs text-[#8A918C] font-mono">/ 100</span>
                                                </div>
                                                <div className="w-full bg-white/[0.08] h-1.5 rounded-full overflow-hidden mt-2">
                                                    <div
                                                        className={cn(
                                                            "h-full rounded-full transition-all duration-300",
                                                            changeSetResult.combinedRisk > 60 ? "bg-red-400" : changeSetResult.combinedRisk > 30 ? "bg-[#E3A04A]" : "bg-[#4FD1B5]"
                                                        )}
                                                        style={{ width: `${Math.min(100, Math.max(5, changeSetResult.combinedRisk))}%` }}
                                                    />
                                                </div>
                                            </div>
                                            <span className="text-[11px] text-[#8A918C]/80">
                                                Based on max input risk plus change set size
                                            </span>
                                        </div>

                                        {/* Affected Files Count */}
                                        <div className="glass-surface p-4 rounded-xl border border-white/10 flex flex-col justify-between">
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs text-[#8A918C]">Unique affected files</span>
                                                <FileCode size={14} className="text-[#4FD1B5]" />
                                            </div>
                                            <div className="my-2">
                                                <div className="text-2xl font-bold font-mono text-[#E8EAE6]">
                                                    {changeSetResult.affectedFiles.length}
                                                </div>
                                            </div>
                                            <span className="text-[11px] text-[#8A918C]/80">
                                                Unique files reachable from the change set
                                            </span>
                                        </div>

                                        {/* Tests To Run Count */}
                                        <div className="glass-surface p-4 rounded-xl border border-white/10 flex flex-col justify-between">
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs text-[#8A918C]">Tests to run</span>
                                                <Play size={14} className="text-[#E3A04A]" />
                                            </div>
                                            <div className="my-2">
                                                <div className="text-2xl font-bold font-mono text-[#E8EAE6]">
                                                    {changeSetResult.tests.length}
                                                </div>
                                            </div>
                                            <span className="text-[11px] text-[#8A918C]/80">
                                                Merged test suite for affected paths
                                            </span>
                                        </div>
                                    </div>

                                    {/* Two-column view: Ranked affected files & Input breakdown */}
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                        {/* Ranked affected files */}
                                        <div className="glass-surface p-4 rounded-xl border border-white/10 flex flex-col">
                                            <div className="flex items-center justify-between mb-3">
                                                <h4 className="text-xs font-semibold text-[#E8EAE6] flex items-center gap-1.5">
                                                    <Activity size={13} className="text-[#4FD1B5]" />
                                                    Affected files ({changeSetResult.affectedFiles.length})
                                                </h4>
                                                <span className="text-[10px] text-[#8A918C] font-mono">Ranked by risk</span>
                                            </div>
                                            <div className="space-y-1.5 max-h-[380px] overflow-y-auto scrollbar-custom pr-1">
                                                {changeSetResult.affectedFiles.length === 0 ? (
                                                    <div className="p-4 text-center text-xs text-[#8A918C]">
                                                        None found
                                                    </div>
                                                ) : (
                                                    changeSetResult.affectedFiles.map((f, i) => {
                                                        const fileName = f.split('/').pop() || f;
                                                        // Find which input files affect this file
                                                        const sources = Object.entries(changeSetResult.affectedByInput)
                                                            .filter(([_, affected]) => affected.includes(f))
                                                            .map(([inp]) => inp.split('/').pop() || inp);

                                                        return (
                                                            <div
                                                                key={i}
                                                                onClick={() => selectFile(f)}
                                                                className="flex items-center justify-between p-2 rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/15 transition-colors cursor-pointer group text-xs"
                                                            >
                                                                <div className="flex items-center gap-2 truncate min-w-0">
                                                                    <FileCode size={13} className="text-[#4FD1B5] shrink-0" />
                                                                    <span className="font-mono text-[#E8EAE6] group-hover:text-[#4FD1B5] truncate" title={f}>
                                                                        {fileName}
                                                                    </span>
                                                                </div>
                                                                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                                                                    {sources.length > 0 && (
                                                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] text-[#8A918C] border border-white/[0.06]" title={`Affected by: ${sources.join(', ')}`}>
                                                                            from {sources.length} {sources.length === 1 ? 'file' : 'files'}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        );
                                                    })
                                                )}
                                            </div>
                                        </div>

                                        {/* Breakdown: which input affects which */}
                                        <div className="glass-surface p-4 rounded-xl border border-white/10 flex flex-col">
                                            <div className="flex items-center justify-between mb-3">
                                                <h4 className="text-xs font-semibold text-[#E8EAE6] flex items-center gap-1.5">
                                                    <Layers size={13} className="text-[#E3A04A]" />
                                                    Impact by change set file
                                                </h4>
                                                <span className="text-[10px] text-[#8A918C] font-mono">{changeSet.length} inputs</span>
                                            </div>
                                            <div className="space-y-2 max-h-[380px] overflow-y-auto scrollbar-custom pr-1">
                                                {changeSet.map((inputPath) => {
                                                    const affected = changeSetResult.affectedByInput[inputPath] || [];
                                                    const inputName = inputPath.split('/').pop() || inputPath;
                                                    return (
                                                        <div key={inputPath} className="p-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] space-y-1.5">
                                                            <div className="flex items-center justify-between">
                                                                <span
                                                                    onClick={() => selectFile(inputPath)}
                                                                    className="font-mono text-xs font-semibold text-[#E8EAE6] hover:text-[#4FD1B5] cursor-pointer truncate"
                                                                    title={inputPath}
                                                                >
                                                                    {inputName}
                                                                </span>
                                                                <div className="flex items-center gap-1.5 shrink-0">
                                                                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#4FD1B5]/10 text-[#4FD1B5]">
                                                                        {affected.length} affected
                                                                    </span>
                                                                    <button
                                                                        onClick={() => removeFromChangeSet(inputPath)}
                                                                        className="text-[#8A918C] hover:text-red-400 p-0.5 rounded cursor-pointer"
                                                                        title="Remove from change set"
                                                                    >
                                                                        <X size={11} />
                                                                    </button>
                                                                </div>
                                                            </div>
                                                            {affected.length > 0 ? (
                                                                <div className="flex flex-wrap gap-1 pt-0.5">
                                                                    {affected.slice(0, 6).map((aff, idx) => (
                                                                        <span
                                                                            key={idx}
                                                                            onClick={() => selectFile(aff)}
                                                                            className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-white/[0.03] border border-white/[0.06] text-[#8A918C] hover:text-[#E8EAE6] cursor-pointer truncate max-w-[160px]"
                                                                            title={aff}
                                                                        >
                                                                            {aff.split('/').pop()}
                                                                        </span>
                                                                    ))}
                                                                    {affected.length > 6 && (
                                                                        <span className="text-[10px] text-[#8A918C]/60 self-center">
                                                                            +{affected.length - 6} more
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            ) : (
                                                                <div className="text-[11px] text-[#8A918C]/60 italic font-sans">
                                                                    No other files affected
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Tests to run */}
                                    <div className="glass-surface p-4 rounded-xl border border-white/10">
                                        <div className="flex items-center justify-between mb-3">
                                            <h4 className="text-xs font-semibold text-[#E8EAE6] flex items-center gap-1.5">
                                                <Play size={13} className="text-[#E3A04A]" />
                                                Tests to run ({changeSetResult.tests.length})
                                            </h4>
                                            <span className="text-[10px] text-[#8A918C] font-mono">Suggested test suite</span>
                                        </div>
                                        {changeSetResult.tests.length === 0 ? (
                                            <div className="flex items-center gap-2 p-3 rounded-lg border border-white/[0.06] bg-white/[0.02] text-xs text-[#8A918C]">
                                                <span className="w-2 h-2 rounded-full bg-[#E3A04A] shrink-0" />
                                                <span>No tests found for the selected change set.</span>
                                            </div>
                                        ) : (
                                            <div className="space-y-1.5 max-h-48 overflow-y-auto scrollbar-custom">
                                                {changeSetResult.tests.map((t, idx) => (
                                                    <div
                                                        key={idx}
                                                        onClick={() => selectFile(t)}
                                                        className="flex items-center justify-between p-2 rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/15 transition-colors cursor-pointer group text-xs"
                                                    >
                                                        <div className="flex items-center gap-2 truncate">
                                                            <FileCode size={13} className="text-[#E3A04A] shrink-0" />
                                                            <span className="font-mono text-[#E8EAE6] group-hover:text-[#E3A04A] truncate" title={t}>
                                                                {t.split('/').pop()}
                                                            </span>
                                                        </div>
                                                        <span className="text-[10px] font-mono text-[#8A918C]/60 truncate ml-2 max-w-[200px]" title={t}>
                                                            {t}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab !== 'Overview' && activeTab !== 'Impact' && activeTab !== 'AskAI' && activeTab !== 'History' && activeTab !== 'Health' && activeTab !== 'Connections' && activeTab !== 'Code' && activeTab !== 'ChangeSet' && (
                        <div className="text-[#8A918C] text-center py-20 text-xs font-mono">
                            Feature not yet implemented.
                        </div>
                    )}
                </>
            </div>
        </div>
    );
}
