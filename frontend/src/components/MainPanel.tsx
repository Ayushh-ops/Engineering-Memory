import { useAppStore } from '../store';
import { Card, Badge, cn, Button } from '../ui';
import { Network, Activity, Clock, FileCode, FileText, ChevronRight, ChevronLeft, MoreHorizontal, Share2, Play, Send, ShieldAlert, GitCommit, Hexagon, MessageSquare, Loader2, Maximize2, Minimize2, X, Copy, Check, Code2, ChevronDown, ChevronUp, HeartPulse, Download, Plus, Square, Layers, RefreshCw } from 'lucide-react';
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { ReactFlow, useNodesState, useEdgesState, Background, Controls, useReactFlow, Position, Handle, MarkerType, useViewport } from '@xyflow/react';
import ForceGraph3D from 'react-force-graph-3d';
import SpriteText from 'three-spritetext';
import * as THREE from 'three';
import '@xyflow/react/dist/style.css';
import { api } from '../api';
import { isCodeFile, getPathsToAnalyze } from '../analyze-helpers';
import { CodeViewer } from './CodeViewer';
import { getNeighborInfo, getFocusedGraph, computeRisk, computeChangeSetRisk, selectRepoStats, compute2DLayout, getConnectedFiles } from '../graph-helpers';
import { ConnectedFilesList } from './ConnectedFilesList';
import { ErrorBoundary } from './ErrorBoundary';

function downloadTextFile(filename: string, content: string, mime = 'text/markdown;charset=utf-8;') {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

interface ComponentToolbarProps {
    title: React.ReactNode;
    subtitle?: React.ReactNode;
    badge?: React.ReactNode;
    middle?: React.ReactNode;
    primaryAction?: React.ReactNode;
    onDownloadReport?: () => void;
    onCopyPRComment?: () => void;
    onReanalyze?: () => void;
    reanalyzeLabel?: string;
    onExport?: () => void;
    extraMenuItems?: { label: string; onClick: () => void }[];
}

function ComponentToolbar({
    title,
    subtitle,
    badge,
    middle,
    primaryAction,
    onDownloadReport,
    onCopyPRComment,
    onReanalyze,
    reanalyzeLabel,
    onExport,
    extraMenuItems = [],
}: ComponentToolbarProps) {
    const [menuOpen, setMenuOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const menuRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!menuOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuOpen(false);
            }
        };
        window.addEventListener('mousedown', handleClickOutside);
        return () => window.removeEventListener('mousedown', handleClickOutside);
    }, [menuOpen]);

    const handleCopy = () => {
        if (onCopyPRComment) {
            onCopyPRComment();
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
            setMenuOpen(false);
        }
    };

    return (
        <div className="flex items-center justify-between shrink-0 gap-3 whitespace-nowrap overflow-x-auto scrollbar-none py-1">
            {/* Title Left */}
            <div className="flex items-center gap-2 min-w-0">
                <div>
                    <div className="flex items-center gap-2">
                        <h3 className="text-xs font-semibold text-[#E8EAE6] truncate">{title}</h3>
                        {badge}
                    </div>
                    {subtitle && <p className="text-[11px] text-[#8A918C] mt-0.5">{subtitle}</p>}
                </div>
            </div>

            {/* Right Controls: Middle (e.g. depth segmented control) + Primary Action + "..." Menu */}
            <div className="flex items-center gap-2 shrink-0">
                {middle}

                {primaryAction}

                {/* "..." menu for secondary actions */}
                <div className="relative" ref={menuRef}>
                    <button
                        onClick={() => setMenuOpen(!menuOpen)}
                        className={cn(
                            "p-1.5 rounded-lg border border-white/10 glass-surface transition-colors cursor-pointer flex items-center justify-center",
                            menuOpen ? "bg-white/[0.08] text-[#E8EAE6]" : "text-[#8A918C] hover:text-[#E8EAE6] hover:border-white/20"
                        )}
                        title="More actions"
                    >
                        <MoreHorizontal size={14} />
                    </button>

                    {menuOpen && (
                        <div className="absolute right-0 top-full mt-1.5 w-52 glass-surface bg-[rgba(16,20,21,0.95)] backdrop-blur-md border border-white/10 rounded-lg p-1.5 shadow-2xl z-50 text-xs font-mono space-y-0.5">
                            {onDownloadReport && (
                                <button
                                    onClick={() => {
                                        onDownloadReport();
                                        setMenuOpen(false);
                                    }}
                                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left hover:bg-white/[0.06] transition-colors cursor-pointer text-[#E8EAE6]"
                                >
                                    <Download size={13} className="text-[#4FD1B5]" />
                                    <span>Download report</span>
                                </button>
                            )}

                            {onCopyPRComment && (
                                <button
                                    onClick={handleCopy}
                                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left hover:bg-white/[0.06] transition-colors cursor-pointer text-[#E8EAE6]"
                                >
                                    {copied ? <Check size={13} className="text-[#4FD1B5]" /> : <Copy size={13} className="text-[#4FD1B5]" />}
                                    <span>{copied ? "Copied comment" : "Copy as PR comment"}</span>
                                </button>
                            )}

                            {onReanalyze && (
                                <button
                                    onClick={() => {
                                        onReanalyze();
                                        setMenuOpen(false);
                                    }}
                                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left hover:bg-white/[0.06] transition-colors cursor-pointer text-[#E8EAE6]"
                                >
                                    <RefreshCw size={13} className="text-[#4FD1B5]" />
                                    <span>{reanalyzeLabel || "Re-analyze"}</span>
                                </button>
                            )}

                            {onExport && (
                                <button
                                    onClick={() => {
                                        onExport();
                                        setMenuOpen(false);
                                    }}
                                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left hover:bg-white/[0.06] transition-colors cursor-pointer text-[#E8EAE6]"
                                >
                                    <Layers size={13} className="text-[#4FD1B5]" />
                                    <span>Export</span>
                                </button>
                            )}

                            {extraMenuItems.map((item, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => {
                                        item.onClick();
                                        setMenuOpen(false);
                                    }}
                                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left hover:bg-white/[0.06] transition-colors cursor-pointer text-[#E8EAE6]"
                                >
                                    <span>{item.label}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

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
    simplify,
    focusDepth,
    resetTrigger,
    nodes,
    edges
}: {
    isExpanded: boolean;
    selectedFile: string | null;
    simplify: boolean;
    focusDepth: 1 | 2;
    resetTrigger: number;
    nodes: any[];
    edges: any[];
}) {
    const { fitView } = useReactFlow();

    // Call fitView with 40px padding (~0.12), maxZoom 2.5 after layout, and on entering/leaving fullscreen
    useEffect(() => {
        if (nodes.length === 0) return;
        const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const timer = setTimeout(() => {
            fitView({ padding: 0.12, maxZoom: 2.5, minZoom: 0.2, duration: prefersReducedMotion ? 0 : 300 });
        }, 80);
        return () => clearTimeout(timer);
    }, [nodes, edges, simplify, focusDepth, resetTrigger, isExpanded, fitView]);

    // Fit-to-view on window resize
    useEffect(() => {
        const handleResize = () => {
            fitView({ padding: 0.12, maxZoom: 2.5, minZoom: 0.2, duration: 0 });
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [fitView]);

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

export function cleanAnswerMarkers(text: string): string {
    if (!text) return '';
    return text
        // Clean 【file:path:14-46】 or 【path:14-46】 or 【file:path】 or 【path】 markers
        .replace(/【(?:file:)?([^】]+)】/g, '')
        // Clean (file:path:14-46) or (file:path) markers
        .replace(/\(file:[^\)]+\)/gi, '')
        // Clean [file:path:14-46] or [file:path] markers
        .replace(/\[file:[^\]]+\]/gi, '')
        // Strip any ```json block
        .replace(/```[ \t]*json\b[\s\S]*?(?:```|$)/gi, '')
        // Strip any stray `json` text
        .replace(/`json`/gi, '')
        // Strip <<<FOLLOWUPS>>> markers
        .replace(/<<<FOLLOWUPS>>>[\s\S]*?(?:<<<END_FOLLOWUPS>>>|$)/gi, '')
        .replace(/<<<END_FOLLOWUPS>>>/gi, '')
        .replace(/(?:^|\r?\n)[ \t]*(?:#+\s*)?(?:follow-?ups?|follow-?up\s*questions?|followups)[ \t]*[:：]?[\s\S]*$/gim, '')
        // Clean any extra spaces before punctuation or duplicate spaces
        .replace(/[ \t]+([.,;?!])/g, '$1')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}

export function extractValidEvidence(text: string, analyzedPaths: Set<string>): string[] {
    if (!text) return [];

    const pathToFirstLine = new Map<string, string | undefined>();
    const orderedPaths: string[] = [];

    const registerPath = (rawPath: string, lineStr?: string) => {
        if (!rawPath) return;
        // Never treat URLs or host:port as evidence
        if (
            rawPath.includes("http") ||
            rawPath.includes("localhost") ||
            rawPath.includes("127.0.0.1") ||
            rawPath.includes("://")
        ) {
            return;
        }

        const cleanPath = rawPath.replace(/^file:/i, "").replace(/^\.\//, "").trim();
        let matchedPath: string | null = null;

        if (analyzedPaths.has(cleanPath)) {
            matchedPath = cleanPath;
        } else if (analyzedPaths.has(rawPath)) {
            matchedPath = rawPath;
        } else if (analyzedPaths.size > 0) {
            for (const ap of analyzedPaths) {
                if (ap.endsWith("/" + cleanPath) || ap === cleanPath) {
                    matchedPath = ap;
                    break;
                }
            }
        } else if (/\.[a-zA-Z0-9]+$/.test(cleanPath)) {
            matchedPath = cleanPath;
        }

        if (matchedPath) {
            const cleanLine = lineStr ? lineStr.replace(/^L/i, "").trim() : undefined;
            if (!pathToFirstLine.has(matchedPath)) {
                pathToFirstLine.set(matchedPath, cleanLine || undefined);
                orderedPaths.push(matchedPath);
            } else if (!pathToFirstLine.get(matchedPath) && cleanLine) {
                pathToFirstLine.set(matchedPath, cleanLine);
            }
        }
    };

    // 1. Chinese/Japanese brackets: 【file:path:14-46】 or 【path:14-46】
    const marker1Regex = /【(?:file:)?([^】:]+?)(?::(?:line\s*|L)?(\d+(?:-\d+)?))?】/gi;
    let m1: RegExpExecArray | null;
    while ((m1 = marker1Regex.exec(text)) !== null) {
        registerPath(m1[1], m1[2]);
    }

    // 2. Parentheses with file prefix: (file:path:14-46) or (file:path)
    const marker2Regex = /\(file:([^\)\s:]+?)(?::(?:line\s*|L)?(\d+(?:-\d+)?))?\)/gi;
    let m2: RegExpExecArray | null;
    while ((m2 = marker2Regex.exec(text)) !== null) {
        registerPath(m2[1], m2[2]);
    }

    // 3. Square brackets with file prefix: [file:path:14-46] or [file:path]
    const marker3Regex = /\[file:([^\]\s:]+?)(?::(?:line\s*|L)?(\d+(?:-\d+)?))?\]/gi;
    let m3: RegExpExecArray | null;
    while ((m3 = marker3Regex.exec(text)) !== null) {
        registerPath(m3[1], m3[2]);
    }

    // 4. Standard path:line tokens e.g. src/auth.ts:14-46 or auth.ts:14
    const tokenRegex = /(?:^|[\s`(\[<"'])((?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+\.[a-zA-Z0-9]+)(?::(?:line\s*|L)?(\d+(?:-\d+)?))?(?:$|[\s`\)\]>"',;:?.])/g;
    let match: RegExpExecArray | null;
    while ((match = tokenRegex.exec(text)) !== null) {
        registerPath(match[1], match[2]);
    }

    return orderedPaths.map(p => {
        const line = pathToFirstLine.get(p);
        return line ? `${p}:${line}` : p;
    });
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
    if (!text) return [];

    let clean = text;

    // Auto-close unclosed ** if needed
    const boldMatches = clean.match(/\*\*/g);
    if (boldMatches && boldMatches.length % 2 !== 0) {
        clean += '**';
    }

    // Auto-close unclosed single ` if needed during streaming (excluding double backticks)
    const singleBackticks = clean.replace(/``/g, '').match(/(?<!\\)`/g);
    if (singleBackticks && singleBackticks.length % 2 !== 0) {
        clean += '`';
    }

    const parts: React.ReactNode[] = [];
    // Priority:
    // 1. Double-backtick code: ``code``
    // 2. Single-backtick code: `code` (e.g. `filter_` - trailing underscores stay inside code, not emphasis!)
    // 3. Bold/italic with asterisks: ***bold italic***, **bold**, *italic*
    // 4. Bold/italic with underscores ONLY with whitespace/line-start boundary (never inside identifiers like filter_ or var_name)
    const regex = /(``[\s\S]+?``|`[^`\r\n]+`|\*\*\*[^*]+?\*\*\*|\*\*[^*]+?\*\*|\*[^*]+?\*|(?<=\s|^)___([^_]+?)___(?=\s|[.,;?!:]|$)|(?<=\s|^)__([^_]+?)__(?=\s|[.,;?!:]|$)|(?<=\s|^)_([^_]+?)_(?=\s|[.,;?!:]|$))/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(clean)) !== null) {
        if (match.index > lastIndex) {
            const raw = clean.slice(lastIndex, match.index);
            if (raw) parts.push(raw);
        }
        const m = match[0];
        if (m.startsWith('``') && m.endsWith('``') && m.length >= 4) {
            // Render double-backtick inline code as plain text without interpolation
            const codeContent = m.slice(2, -2).trim();
            parts.push(
                <code key={`code-${match.index}`} className="px-1.5 py-0.5 rounded text-[11px] font-mono bg-white/[0.06] text-[#4FD1B5]">
                    {codeContent}
                </code>
            );
        } else if (m.startsWith('`') && m.endsWith('`') && m.length >= 2) {
            // Render single-backtick inline code as plain text without interpolation (trailing underscores like `filter_` stay inside code)
            const codeContent = m.slice(1, -1);
            parts.push(
                <code key={`code-${match.index}`} className="px-1.5 py-0.5 rounded text-[11px] font-mono bg-white/[0.06] text-[#4FD1B5]">
                    {codeContent}
                </code>
            );
        } else if (m.startsWith('***') && m.endsWith('***')) {
            parts.push(
                <strong key={`bold-${match.index}`} className="font-semibold text-[#E8EAE6] italic">
                    {m.slice(3, -3)}
                </strong>
            );
        } else if (m.startsWith('**') && m.endsWith('**')) {
            parts.push(
                <strong key={`bold-${match.index}`} className="font-semibold text-[#E8EAE6]">
                    {m.slice(2, -2)}
                </strong>
            );
        } else if (m.startsWith('*') && m.endsWith('*')) {
            parts.push(
                <em key={`em-${match.index}`} className="italic text-[#E8EAE6]">
                    {m.slice(1, -1)}
                </em>
            );
        } else if (m.startsWith('___') && m.endsWith('___')) {
            parts.push(
                <strong key={`bold-${match.index}`} className="font-semibold text-[#E8EAE6] italic">
                    {m.slice(3, -3)}
                </strong>
            );
        } else if (m.startsWith('__') && m.endsWith('__')) {
            parts.push(
                <strong key={`bold-${match.index}`} className="font-semibold text-[#E8EAE6]">
                    {m.slice(2, -2)}
                </strong>
            );
        } else if (m.startsWith('_') && m.endsWith('_')) {
            parts.push(
                <em key={`em-${match.index}`} className="italic text-[#E8EAE6]">
                    {m.slice(1, -1)}
                </em>
            );
        }
        lastIndex = match.index + m.length;
    }
    if (lastIndex < clean.length) {
        const remaining = clean.slice(lastIndex);
        if (remaining) parts.push(remaining);
    }
    return parts;
}

function MarkdownRenderer({ content }: { content: string }) {
    if (!content) return null;

    // Auto-close open code block during streaming
    let processedContent = content;
    const tripleBackticks = processedContent.match(/```/g);
    if (tripleBackticks && tripleBackticks.length % 2 !== 0) {
        processedContent += '\n```';
    }

    // Parse fenced code blocks ```lang ... ``` vs lines/lists/paragraphs/tables
    const tokens: React.ReactNode[] = [];
    const codeBlockRegex = /```([a-zA-Z0-9_-]*)\r?\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    let sectionKey = 0;
    while ((match = codeBlockRegex.exec(processedContent)) !== null) {
        if (match.index > lastIndex) {
            const prose = processedContent.slice(lastIndex, match.index);
            tokens.push(<ProseRenderer key={`prose-${sectionKey++}`} text={prose} />);
        }
        const lang = match[1];
        const code = match[2];
        tokens.push(<CodeBlock key={`code-${sectionKey++}`} code={code.replace(/\n$/, '')} lang={lang} />);
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < processedContent.length) {
        tokens.push(<ProseRenderer key={`prose-${sectionKey++}`} text={processedContent.slice(lastIndex)} />);
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

        // Numbered list item
        const orderedMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
        if (orderedMatch) {
            currentList.push(
                <li key={i} className="text-xs text-[#E8EAE6] list-decimal ml-4">
                    {renderInlineMarkdown(orderedMatch[2])}
                </li>
            );
            return;
        }

        // Bullet list item
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
            const itemText = trimmed.slice(2);
            currentList.push(
                <li key={i} className="text-xs text-[#E8EAE6] list-disc ml-4">
                    {renderInlineMarkdown(itemText)}
                </li>
            );
            return;
        }

        flushList();

        // Headings (with backticks inside rendered as code via renderInlineMarkdown)
        if (trimmed.startsWith('#### ')) {
            elements.push(<h5 key={i} className="text-xs font-semibold text-[#E8EAE6] mt-2 mb-1">{renderInlineMarkdown(trimmed.slice(5))}</h5>);
        } else if (trimmed.startsWith('### ')) {
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

function CustomGraphNode({ data }: { data: any }) {
    const { zoom } = useViewport();
    const effectiveFontSize = zoom > 0 && zoom < 1 ? Math.max(12, Math.round(12 / zoom)) : 12;
    const effectiveHeight = zoom > 0 && zoom < 1 ? Math.max(28, Math.round(28 / zoom)) : 28;

    return (
        <div style={{ ...data.style, fontSize: `${effectiveFontSize}px`, minHeight: `${effectiveHeight}px`, height: `${effectiveHeight}px` }}>
            <Handle
                id="target-left"
                type="target"
                position={Position.Left}
                style={{ opacity: 0, pointerEvents: 'none' }}
            />
            <Handle
                id="source-left"
                type="source"
                position={Position.Left}
                style={{ opacity: 0, pointerEvents: 'none' }}
            />
            <Handle
                id="target-right"
                type="target"
                position={Position.Right}
                style={{ opacity: 0, pointerEvents: 'none' }}
            />
            <Handle
                id="source-right"
                type="source"
                position={Position.Right}
                style={{ opacity: 0, pointerEvents: 'none' }}
            />
            {data.label}
        </div>
    );
}

function ColumnHeaderNode({ data }: { data: any }) {
    return (
        <div className="select-none pointer-events-none text-center">
            <div className="text-[12px] font-mono font-medium text-[#E8EAE6] flex items-center justify-center gap-1.5">
                <span>{data.title}</span>
                <span className="text-[11px] text-[#8A918C]">({data.count})</span>
            </div>
            {data.isEmpty && (
                <div className="text-[11px] text-[#8A918C]/60 mt-1 italic">
                    None
                </div>
            )}
        </div>
    );
}

const customNodeTypes = {
    custom: CustomGraphNode,
    columnHeader: ColumnHeaderNode
};

function OverviewGraph2D({
    graph,
    simplify,
    selectedFile,
    selectedSymbol,
    onSelectNode,
    onDoubleClickNode,
    isExpanded,
    hoveredGraphNode,
    focusDepth,
    resetTrigger,
    showCalls
}: {
    graph: import('../api').RepositoryGraph;
    simplify: boolean;
    selectedFile: string | null;
    selectedSymbol: any;
    onSelectNode: (rawNode: any) => void;
    onDoubleClickNode: (rawNode: any) => void;
    isExpanded: boolean;
    hoveredGraphNode: string | null;
    focusDepth: 1 | 2;
    resetTrigger: number;
    showCalls?: boolean;
}) {
    const [nodes, setNodes, onNodesChange] = useNodesState<any>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<any>([]);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

    useEffect(() => {
        // Use the same visible-node set for edges and nodes
        const visibleNodes: any[] = (graph?.nodes || []).filter((n: any) => Boolean(n && n.id));
        const visibleNodeIds = new Set(visibleNodes.map((n: any) => n.id));
        const validEdges = (graph?.edges || []).filter((e: any) => visibleNodeIds.has(e.from) && visibleNodeIds.has(e.to));

        const neighborInfo = getNeighborInfo(graph, selectedFile, selectedSymbol);

        // Find center node ID and name if focused
        let centerId: string | null = null;
        let centerName = '';
        if (selectedFile) {
            for (const n of visibleNodes) {
                const nPath = (n as any).path || (n.type === 'file' ? n.id : undefined);
                if (nPath === selectedFile || n.id === selectedFile || (n.type === 'file' && (n as any).name === selectedFile)) {
                    if (selectedSymbol) {
                        if ((n as any).name === selectedSymbol.name && n.type === selectedSymbol.type) {
                            centerId = n.id;
                            centerName = n.name || (nPath ? nPath.split('/').pop() : n.id);
                            break;
                        }
                    } else if (n.type === 'file') {
                        centerId = n.id;
                        centerName = n.name || (nPath ? nPath.split('/').pop() : n.id);
                        break;
                    }
                }
            }
            if (!centerId && neighborInfo.selectedNodeIds.size > 0) {
                centerId = Array.from(neighborInfo.selectedNodeIds)[0];
                const cNode = visibleNodes.find(n => n.id === centerId);
                centerName = cNode?.name || (cNode?.path ? cNode.path.split('/').pop() : centerId);
            }
        }

        const layoutResult = compute2DLayout(visibleNodes, validEdges, {
            centerId,
            isFocused: Boolean(selectedFile),
            focusDepth
        });

        const { positions, columnCounts, nodeHops, leftIds, rightIds, indirectIds, colSpacing, baseColOffset } = layoutResult;
        const leftIdSet = new Set(leftIds);
        const rightIdSet = new Set(rightIds);
        const indirectIdSet = new Set(indirectIds);

        // Compute top 3 highest-risk edges
        const nodeRiskMap = new Map<string, number>();
        visibleNodes.forEach(n => {
            const p = n.path || n.id;
            const r = computeRisk(p, graph).score;
            nodeRiskMap.set(n.id, r);
        });
        const scoredEdges = validEdges.map((e: any, idx: number) => {
            const risk = Math.max(nodeRiskMap.get(e.from) || 0, nodeRiskMap.get(e.to) || 0);
            const edgeId = e.id || `${e.from}->${e.to}:${e.type}`;
            return { edgeId, risk, idx };
        });
        scoredEdges.sort((a, b) => b.risk - a.risk || a.idx - b.idx);
        const top3RiskEdgeIds = new Set(scoredEdges.slice(0, 3).map(x => x.edgeId));

        // Active hover path calculation
        const activeHoverId = hoveredNodeId || hoveredGraphNode;
        let hoverPathNodeIds = new Set<string>();
        let hoverPathEdgeIds = new Set<string>();
        let activeHoverSentence = '';

        if (activeHoverId && centerId) {
            const hNode = visibleNodes.find(n => n.id === activeHoverId || n.path === activeHoverId);
            const hId = hNode ? hNode.id : activeHoverId;
            const hName = hNode ? (hNode.name || (hNode.path ? hNode.path.split('/').pop() : hId)) : hId;

            if (hId === centerId) {
                hoverPathNodeIds.add(centerId);
                activeHoverSentence = `${centerName}`;
            } else {
                // Check direct edge
                const dirOutgoing = validEdges.find(e => e.from === centerId && e.to === hId);
                const dirIncoming = validEdges.find(e => e.from === hId && e.to === centerId);

                if (dirOutgoing) {
                    hoverPathNodeIds.add(centerId);
                    hoverPathNodeIds.add(hId);
                    hoverPathEdgeIds.add(dirOutgoing.id || `${dirOutgoing.from}->${dirOutgoing.to}:${dirOutgoing.type}`);
                    activeHoverSentence = `${centerName} imports ${hName}`;
                } else if (dirIncoming) {
                    hoverPathNodeIds.add(centerId);
                    hoverPathNodeIds.add(hId);
                    hoverPathEdgeIds.add(dirIncoming.id || `${dirIncoming.from}->${dirIncoming.to}:${dirIncoming.type}`);
                    activeHoverSentence = `${hName} imports ${centerName}`;
                } else {
                    // BFS shortest path between hId and centerId
                    const adj = new Map<string, Array<{ neighbor: string; edgeId: string }>>();
                    for (const e of validEdges) {
                        const edgeId = e.id || `${e.from}->${e.to}:${e.type}`;
                        if (!adj.has(e.from)) adj.set(e.from, []);
                        if (!adj.has(e.to)) adj.set(e.to, []);
                        adj.get(e.from)!.push({ neighbor: e.to, edgeId });
                        adj.get(e.to)!.push({ neighbor: e.from, edgeId });
                    }
                    const visited = new Set<string>([hId]);
                    const queue: Array<{ id: string; pNodes: string[]; pEdges: string[] }> = [{ id: hId, pNodes: [hId], pEdges: [] }];
                    while (queue.length > 0) {
                        const curr = queue.shift()!;
                        if (curr.id === centerId) {
                            hoverPathNodeIds = new Set(curr.pNodes);
                            hoverPathEdgeIds = new Set(curr.pEdges);
                            const hops = curr.pEdges.length;
                            activeHoverSentence = `${hName} reaches ${centerName} (${hops} hops)`;
                            break;
                        }
                        for (const item of (adj.get(curr.id) || [])) {
                            if (!visited.has(item.neighbor)) {
                                visited.add(item.neighbor);
                                queue.push({
                                    id: item.neighbor,
                                    pNodes: [...curr.pNodes, item.neighbor],
                                    pEdges: [...curr.pEdges, item.edgeId]
                                });
                            }
                        }
                    }
                    if (hoverPathNodeIds.size === 0) {
                        hoverPathNodeIds.add(hId);
                        activeHoverSentence = `${hName}`;
                    }
                }
            }
        }

        // Compute connected nodes for fading unconnected ones when there is a selection
        const connectedToSelectedIds = new Set<string>();
        if (neighborInfo.hasSelection) {
            neighborInfo.selectedNodeIds.forEach(id => connectedToSelectedIds.add(id));
            let currentLevel = new Set(neighborInfo.selectedNodeIds);
            const maxDepth = focusDepth || 2;
            for (let d = 0; d < maxDepth; d++) {
                const nextLevel = new Set<string>();
                for (const edge of validEdges) {
                    if (currentLevel.has(edge.from) && !connectedToSelectedIds.has(edge.to)) {
                        connectedToSelectedIds.add(edge.to);
                        nextLevel.add(edge.to);
                    }
                    if (currentLevel.has(edge.to) && !connectedToSelectedIds.has(edge.from)) {
                        connectedToSelectedIds.add(edge.from);
                        nextLevel.add(edge.from);
                    }
                }
                currentLevel = nextLevel;
            }
        }

        const layoutNodes: any[] = visibleNodes.map((n: any) => {
            const pos = positions.get(n.id) || { x: 0, y: 0 };
            const nodePath = n.path || (n.type === 'file' ? n.id : undefined);
            const isSelected = neighborInfo.selectedNodeIds.has(n.id) || (centerId === n.id);
            const isRepo = n.type === 'repository';
            const isCallable = n.type === 'function' || n.type === 'method';

            // Base name only (client.js, not src/client.js)
            const rawName = n.name || (nodePath ? nodePath.split('/').pop() : n.id);
            const displayName = isRepo ? 'repo' : (rawName.includes('/') ? rawName.split('/').pop() : rawName);
            const labelText = isCallable ? `${displayName}()` : displayName;

            const hops = nodeHops.get(n.id) || 1;

            // Pill colors:
            // Selected file: brightest node (white fill, teal ring)
            // Left (Imports): teal
            // Right (Imported by): amber
            // Indirect: grey
            let bg = 'rgba(16, 20, 21, 0.95)';
            let border = '1px solid rgba(255, 255, 255, 0.08)';
            let boxShadow = '0 2px 6px rgba(0, 0, 0, 0.35)';
            let textColor = '#E8EAE6';
            let dotColor = '#4FD1B5';

            if (isRepo) {
                bg = 'transparent';
                border = '1.5px solid #E8EAE6';
                dotColor = '#E8EAE6';
            } else if (isSelected) {
                bg = '#FFFFFF';
                border = '2.5px solid #4FD1B5';
                boxShadow = '0 0 16px rgba(79, 209, 181, 0.55)';
                textColor = '#07090A';
                dotColor = '#4FD1B5';
            } else if (leftIdSet.has(n.id)) {
                border = '1px solid rgba(79, 209, 181, 0.45)';
                dotColor = '#4FD1B5';
            } else if (rightIdSet.has(n.id)) {
                border = '1px solid rgba(227, 160, 74, 0.45)';
                dotColor = '#E3A04A';
            } else if (indirectIdSet.has(n.id)) {
                border = '1px solid rgba(138, 145, 140, 0.35)';
                dotColor = '#8A918C';
            } else if (isCallable) {
                border = '1px solid rgba(111, 143, 154, 0.4)';
                dotColor = '#6F8F9A';
            }

            // Opacity: if active hover, dim everything not on hover path to 20%
            let nodeOpacity = 1;
            if (activeHoverId) {
                nodeOpacity = hoverPathNodeIds.has(n.id) ? 1 : 0.2;
            } else if (neighborInfo.hasSelection) {
                nodeOpacity = connectedToSelectedIds.has(n.id) ? 1 : 0.25;
            }

            const nodeStyle = {
                background: bg,
                border,
                borderRadius: '9999px',
                height: '28px',
                minHeight: '28px',
                boxSizing: 'border-box' as const,
                display: 'flex',
                alignItems: 'center',
                padding: '0 10px',
                boxShadow,
                opacity: nodeOpacity,
                color: textColor,
                fontSize: '12px',
                cursor: 'pointer',
                transition: 'border-color 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease',
                position: 'relative' as const
            };

            const isHovered = activeHoverId ? (nodePath === activeHoverId || n.id === activeHoverId) : false;
            const nodeTooltip = activeHoverSentence && isHovered ? activeHoverSentence : (nodePath || displayName);

            return {
                id: n.id,
                type: 'custom',
                position: pos,
                data: {
                    label: (
                        <div
                            className="flex items-center gap-1.5 font-mono select-none pointer-events-none truncate max-w-[220px]"
                            title={nodeTooltip}
                        >
                            <span
                                className={cn(
                                    "w-2 h-2 rounded-full inline-block shrink-0",
                                    isRepo && "border border-[#E8EAE6] bg-transparent"
                                )}
                                style={isRepo ? undefined : { backgroundColor: dotColor }}
                            />
                            <span
                                style={{ fontSize: 'inherit', color: textColor, fontWeight: isSelected ? '600' : '400' }}
                                className="truncate text-[12px] leading-none font-mono"
                            >
                                {labelText}
                            </span>
                            {hops >= 2 && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.08] text-[#8A918C] ml-1 font-sans shrink-0">
                                    {hops} hops
                                </span>
                            )}
                        </div>
                    ),
                    style: nodeStyle,
                    rawNode: n
                }
            };
        });

        // Insert Hub Column Headers when a file is selected
        if (selectedFile && centerId) {
            const importsMinY = leftIds.length > 0
                ? Math.min(...leftIds.map(id => positions.get(id)?.y ?? 0)) - 55
                : -40;
            layoutNodes.push({
                id: 'col-imports-header',
                type: 'columnHeader',
                position: { x: -colSpacing, y: importsMinY },
                selectable: false,
                draggable: false,
                data: {
                    title: 'Imports',
                    count: columnCounts.imports,
                    isEmpty: columnCounts.imports === 0
                }
            });

            const importedByMinY = rightIds.length > 0
                ? Math.min(...rightIds.map(id => positions.get(id)?.y ?? 0)) - 55
                : -40;
            layoutNodes.push({
                id: 'col-imported-by-header',
                type: 'columnHeader',
                position: { x: colSpacing, y: importedByMinY },
                selectable: false,
                draggable: false,
                data: {
                    title: 'Imported by',
                    count: columnCounts.importedBy,
                    isEmpty: columnCounts.importedBy === 0
                }
            });

            const indirectMinY = indirectIds.length > 0
                ? Math.min(...indirectIds.map(id => positions.get(id)?.y ?? 0)) - 55
                : -40;
            layoutNodes.push({
                id: 'col-indirect-header',
                type: 'columnHeader',
                position: { x: colSpacing * (baseColOffset + 1), y: indirectMinY },
                selectable: false,
                draggable: false,
                data: {
                    title: 'Indirect',
                    count: columnCounts.indirect,
                    isEmpty: columnCounts.indirect === 0
                }
            });
        }

        const layoutEdges = validEdges.map((e: any, idx: number) => {
            const edgeId = e.id || `${e.from}->${e.to}:${e.type}`;

            // Arrow direction: an arrow points to the file being imported (e.to)
            // Imports (selected uses): teal #4FD1B5, solid
            // Imported by (files using selected): amber #E3A04A, solid
            // Indirect (2+ hops): grey #8A918C, dashed
            // Calls: #6F8F9A, dotted
            let stroke = '#4FD1B5';
            let strokeDasharray: string | undefined = undefined;

            if (e.type === 'calls') {
                stroke = '#6F8F9A';
                strokeDasharray = '2 2';
            } else if (neighborInfo.hasSelection && centerId) {
                if (e.from === centerId) {
                    stroke = '#4FD1B5'; // Imports
                } else if (e.to === centerId) {
                    stroke = '#E3A04A'; // Imported by
                } else {
                    stroke = '#8A918C'; // Indirect
                    strokeDasharray = '4 4';
                }
            } else {
                if (e.type === 'contains') {
                    stroke = '#8A918C';
                    strokeDasharray = '4 4';
                } else if (e.type === 'imported_by') {
                    stroke = '#E3A04A';
                } else {
                    stroke = '#4FD1B5';
                }
            }

            const isTop3 = top3RiskEdgeIds.has(edgeId);

            let edgeOpacity = isTop3 ? 0.95 : 0.55;
            let strokeWidth = isTop3 ? 2 : 1.2;

            if (activeHoverId) {
                if (hoverPathEdgeIds.has(edgeId)) {
                    edgeOpacity = 0.95;
                    strokeWidth = 2;
                } else {
                    edgeOpacity = 0.2;
                }
            }

            const posSource = positions.get(e.from) || { x: 0, y: 0 };
            const posTarget = positions.get(e.to) || { x: 0, y: 0 };

            let sourceHandle = 'source-right';
            let targetHandle = 'target-left';
            if (posSource.x < posTarget.x) {
                sourceHandle = 'source-right';
                targetHandle = 'target-left';
            } else if (posSource.x > posTarget.x) {
                sourceHandle = 'source-left';
                targetHandle = 'target-right';
            } else {
                sourceHandle = 'source-right';
                targetHandle = 'target-right';
            }

            return {
                id: edgeId || `edge-${idx}`,
                source: e.from,
                target: e.to,
                sourceHandle,
                targetHandle,
                type: 'bezier',
                markerEnd: {
                    type: MarkerType.ArrowClosed,
                    color: stroke,
                    width: 6,
                    height: 6
                },
                zIndex: activeHoverId && hoverPathEdgeIds.has(edgeId) ? 10 : (isTop3 ? 5 : 1),
                style: {
                    stroke,
                    strokeWidth,
                    strokeDasharray,
                    opacity: edgeOpacity
                }
            };
        });

        setNodes(layoutNodes);
        setEdges(layoutEdges);
    }, [graph, simplify, selectedFile, selectedSymbol, hoveredGraphNode, hoveredNodeId, focusDepth, showCalls, setNodes, setEdges]);

    return (
        <div className="w-full h-full relative [&_.react-flow__edges]:!z-[1] [&_.react-flow__nodes]:!z-[2]">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={customNodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={(_event, node) => onSelectNode(node.data?.rawNode)}
                onNodeDoubleClick={(_event, node) => onDoubleClickNode(node.data?.rawNode)}
                onNodeMouseEnter={(_event, node) => setHoveredNodeId(node.id)}
                onNodeMouseLeave={() => setHoveredNodeId(null)}
                onPaneClick={() => onSelectNode(null)}
                fitView
                fitViewOptions={{ padding: 0.12, maxZoom: 2.5, minZoom: 0.2 }}
                maxZoom={2.5}
                minZoom={0.2}
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
                    simplify={simplify}
                    focusDepth={focusDepth}
                    resetTrigger={resetTrigger}
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
    const fitCameraToVisibleNodesRef = useRef<any>(null);
    const [dimensions, setDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
    const [graphData, setGraphData] = useState<{ nodes: any[]; links: any[] }>({ nodes: [], links: [] });

    const [simplify, setSimplify] = useState(false);
    const [showCalls, setShowCalls] = useState(false);
    const [focusDepth, setFocusDepth] = useState<1 | 2>(1);
    const [showAllNodes, setShowAllNodes] = useState(false);
    const [showLegend, setShowLegend] = useState(true);
    const [legendCollapsed, setLegendCollapsed] = useState(false);
    const [resetTrigger, setResetTrigger] = useState(0);

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

    // Reset showAllNodes when selection or filters change
    useEffect(() => {
        setShowAllNodes(false);
    }, [selectedFile, focusDepth, simplify, showCalls, viewMode]);

    const handleBack = useCallback(async () => {
        if (visitedHistory.length === 0) return;
        const prevFile = visitedHistory[visitedHistory.length - 1];
        setVisitedHistory(prev => prev.slice(0, -1));
        lastNavigatedFileRef.current = prevFile;
        setActiveTab('Graph');
        await selectFile(prevFile);
        setResetTrigger(prev => prev + 1);
    }, [visitedHistory, setActiveTab, selectFile]);

    const handleReset = useCallback(() => {
        setFocusDepth(1);
        setSelectedFile(null);
        setSelectedSymbol(null);
        setShowAllNodes(false);
        setResetTrigger(prev => prev + 1);
        if (viewMode === '3D' && fgInstanceRef.current) {
            fitCameraToVisibleNodesRef.current?.(graphData.nodes, 0.4);
        }
    }, [setSelectedFile, setSelectedSymbol, viewMode, graphData.nodes]);

    // Track full graph connection counts
    const connectionCounts = useMemo(() => {
        const counts = new Map<string, number>();
        if (!graph?.edges) return counts;
        for (const e of graph.edges) {
            counts.set(e.from, (counts.get(e.from) || 0) + 1);
            counts.set(e.to, (counts.get(e.to) || 0) + 1);
        }
        return counts;
    }, [graph]);

    // Base candidate pool: files only by default, functions/classes hidden unless showCalls is enabled, repo node removed unless nothing else exists
    const baseNodes = useMemo(() => {
        if (!graph?.nodes) return [];
        const nonRepoNodes = graph.nodes.filter((n: any) => {
            if (!showCalls && n.type !== 'file') return false;
            if (simplify && n.type !== 'file') return false;
            if (n.type !== 'file' && n.type !== 'class' && n.type !== 'function' && n.type !== 'method') return false;
            return Boolean(n.id);
        });
        const includeRepo = nonRepoNodes.length === 0;

        return graph.nodes.filter((n: any) => {
            if (n.type === 'repository') return includeRepo;
            if (!showCalls && n.type !== 'file') return false;
            if (simplify && n.type !== 'file') return false;
            if (n.type !== 'file' && n.type !== 'class' && n.type !== 'function' && n.type !== 'method') return false;
            return Boolean(n.id);
        });
    }, [graph, showCalls, simplify]);

    // Default cap: 12 nodes in 2D, 30 in 3D
    const defaultCap = viewMode === '2D' ? 12 : 30;

    // Compute displayed nodes (capped at defaultCap, max 12 per column in 2D, show all when showAllNodes is true)
    const { displayNodes, totalCandidateCount, totalImportersCount } = useMemo(() => {
        if (baseNodes.length === 0) {
            return { displayNodes: [], totalCandidateCount: 0, totalImportersCount: 0 };
        }

        // Case A: No file selected -> show top files by connections
        if (!selectedFile) {
            const sorted = [...baseNodes].sort((a, b) => {
                const connA = connectionCounts.get(a.id) || 0;
                const connB = connectionCounts.get(b.id) || 0;
                return connB - connA;
            });
            const total = sorted.length;
            const displayed = showAllNodes ? sorted : sorted.slice(0, defaultCap);

            return {
                displayNodes: displayed,
                totalCandidateCount: total,
                totalImportersCount: 0
            };
        }

        // Case B: A file is selected
        const baseNodeMap = new Map<string, any>(baseNodes.map(n => [n.id, n]));
        let centerNode = baseNodes.find(n => {
            const nPath = (n as any).path || (n.type === 'file' ? n.id : undefined);
            if (selectedSymbol) {
                return nPath === selectedFile && (n as any).name === selectedSymbol.name && n.type === selectedSymbol.type;
            }
            return nPath === selectedFile || n.id === selectedFile || (n.type === 'file' && (n as any).name === selectedFile);
        });
        if (!centerNode) {
            centerNode = baseNodes.find(n => {
                const nPath = (n as any).path || (n.type === 'file' ? n.id : undefined);
                return nPath === selectedFile || n.id === selectedFile;
            });
        }

        if (!centerNode) {
            const sorted = [...baseNodes].sort((a, b) => (connectionCounts.get(b.id) || 0) - (connectionCounts.get(a.id) || 0));
            const total = sorted.length;
            const displayed = showAllNodes ? sorted : sorted.slice(0, defaultCap);
            return { displayNodes: displayed, totalCandidateCount: total, totalImportersCount: 0 };
        }

        // Direct neighbors (depth 1)
        const directImportsSet = new Set<string>();
        const directImportedBySet = new Set<string>();
        const depth1Set = new Set<string>();

        for (const e of graph.edges) {
            if (e.from === centerNode.id && baseNodeMap.has(e.to)) {
                depth1Set.add(e.to);
                directImportsSet.add(e.to);
            }
            if (e.to === centerNode.id && baseNodeMap.has(e.from)) {
                depth1Set.add(e.from);
                directImportedBySet.add(e.from);
            }
        }
        depth1Set.delete(centerNode.id);
        directImportsSet.delete(centerNode.id);
        directImportedBySet.delete(centerNode.id);

        // Depth 2 neighbors if requested (focusDepth === 2 for Indirect)
        const depth2Set = new Set<string>();
        if (focusDepth === 2) {
            for (const e of graph.edges) {
                if (depth1Set.has(e.from) && baseNodeMap.has(e.to) && !depth1Set.has(e.to) && e.to !== centerNode.id) {
                    depth2Set.add(e.to);
                }
                if (depth1Set.has(e.to) && baseNodeMap.has(e.from) && !depth1Set.has(e.from) && e.from !== centerNode.id) {
                    depth2Set.add(e.from);
                }
            }
        }

        const importsNodes = Array.from(directImportsSet)
            .map(id => baseNodeMap.get(id))
            .filter(Boolean)
            .sort((a, b) => (connectionCounts.get(b.id) || 0) - (connectionCounts.get(a.id) || 0));

        const importedByNodes = Array.from(directImportedBySet)
            .map(id => baseNodeMap.get(id))
            .filter(Boolean)
            .sort((a, b) => (connectionCounts.get(b.id) || 0) - (connectionCounts.get(a.id) || 0));

        const indirectNodes = Array.from(depth2Set)
            .map(id => baseNodeMap.get(id))
            .filter(Boolean)
            .sort((a, b) => (connectionCounts.get(b.id) || 0) - (connectionCounts.get(a.id) || 0));

        const totalCandidateCount = 1 + importsNodes.length + importedByNodes.length + indirectNodes.length;
        const totalImportersCount = importedByNodes.length;

        let displayed: any[] = [];
        if (viewMode === '2D') {
            if (showAllNodes) {
                displayed = [centerNode, ...importsNodes, ...importedByNodes, ...indirectNodes];
            } else {
                displayed = [
                    centerNode,
                    ...importsNodes.slice(0, 12),
                    ...importedByNodes.slice(0, 12),
                    ...indirectNodes.slice(0, 12)
                ];
            }
        } else {
            const all3D = [centerNode, ...importsNodes, ...importedByNodes, ...indirectNodes];
            displayed = showAllNodes ? all3D : all3D.slice(0, 30);
        }

        return {
            displayNodes: displayed,
            totalCandidateCount,
            totalImportersCount
        };
    }, [baseNodes, selectedFile, selectedSymbol, focusDepth, showAllNodes, defaultCap, connectionCounts, graph, viewMode]);

    // Active subgraph with visible nodes & edges
    const displayGraph = useMemo(() => {
        const nodeIds = new Set(displayNodes.map(n => n.id));
        const edges = graph.edges.filter(e => {
            if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) return false;
            if (!showCalls && e.type === 'calls') return false;
            if (simplify) return e.type === 'imports';
            return true;
        });
        return {
            nodes: displayNodes,
            edges
        };
    }, [displayNodes, graph, simplify, showCalls]);

    const neighborInfo = useMemo(() => {
        return getNeighborInfo(displayGraph, selectedFile, selectedSymbol);
    }, [displayGraph, selectedFile, selectedSymbol]);

    const hoveredNeighbors = useMemo(() => {
        const ids = new Set<string>();
        if (!hoveredGraphNode) return ids;
        const hNode = displayGraph.nodes.find((n: any) => n.path === hoveredGraphNode || n.id === hoveredGraphNode);
        if (!hNode) return ids;
        displayGraph.edges.forEach((e: any) => {
            if (e.from === hNode.id) ids.add(e.to);
            if (e.to === hNode.id) ids.add(e.from);
        });
        return ids;
    }, [displayGraph, hoveredGraphNode]);

    const legendData = useMemo(() => {
        const edges = displayGraph?.edges || [];
        let hasImports = false;
        let hasImportedBy = false;
        let hasIndirect = false;
        let hasCalls = false;

        if (selectedFile) {
            let centerId: string | null = null;
            for (const n of displayGraph.nodes) {
                const nPath = (n as any).path || (n.type === 'file' ? n.id : undefined);
                if (nPath === selectedFile || n.id === selectedFile || (n.type === 'file' && (n as any).name === selectedFile)) {
                    centerId = n.id;
                    break;
                }
            }
            if (centerId) {
                for (const e of edges) {
                    if (e.type === 'calls') {
                        hasCalls = true;
                    } else if (e.from === centerId) {
                        hasImports = true;
                    } else if (e.to === centerId) {
                        hasImportedBy = true;
                    } else {
                        hasIndirect = true;
                    }
                }
            }
        } else {
            hasImports = edges.some(e => e.type === 'imports' || !e.type);
            hasCalls = edges.some(e => e.type === 'calls');
        }

        return {
            hasImports,
            hasImportedBy,
            hasIndirect,
            hasCalls
        };
    }, [displayGraph, selectedFile]);

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

    // Escape key exits fullscreen and clears selected node
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (isExpanded) {
                    setIsExpanded(false);
                }
                if (selectedFile) {
                    setSelectedFile(null);
                    setSelectedSymbol(null);
                    setResetTrigger(prev => prev + 1);
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isExpanded, selectedFile, setSelectedFile, setSelectedSymbol]);

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

    // On expanded toggle: resize and fit to view (2D via FlowFitViewHandler, 3D via fitCameraToVisibleNodes)
    useEffect(() => {
        const timer = setTimeout(() => {
            if (containerRef.current) {
                setDimensions({
                    width: containerRef.current.clientWidth,
                    height: containerRef.current.clientHeight
                });
            }
            if (viewMode === '3D' && fgInstanceRef.current) {
                fitCameraToVisibleNodes(graphData.nodes, 0.4);
            }
        }, 100);
        return () => clearTimeout(timer);
    }, [isExpanded, viewMode, graphData.nodes]);

    // Node click selects node and refits view to neighborhood
    const handleSelectNode = useCallback(async (node: any) => {
        if (!node) {
            setSelectedFile(null);
            setSelectedSymbol(null);
            setResetTrigger(prev => prev + 1);
            return;
        }
        const nodePath = node.path || (node.type === 'file' ? node.id : undefined);
        if (!nodePath) return;

        if (selectedFile && selectedFile !== nodePath) {
            setVisitedHistory(prev => {
                const next = [...prev, selectedFile];
                return next.slice(-10);
            });
            lastNavigatedFileRef.current = nodePath;
        }

        if (node.type === 'file') {
            setSelectedFile(nodePath);
            setSelectedSymbol(null);
        } else if (node.type === 'class' || node.type === 'function' || node.type === 'method') {
            setSelectedFile(nodePath);
            setSelectedSymbol({ name: node.name, type: node.type, path: nodePath });
        }

        setResetTrigger(prev => prev + 1);

        if (viewMode === '3D' && fgInstanceRef.current) {
            setTimeout(() => {
                fitCameraToVisibleNodes(graphData.nodes, 0.4);
            }, 100);
        }
    }, [selectedFile, setSelectedFile, setSelectedSymbol, viewMode, graphData.nodes]);

    const handleDoubleClickNode = useCallback(async (node: any) => {
        if (!node) return;
        const nodePath = node.path || (node.type === 'file' ? node.id : undefined);
        if (nodePath) {
            setActiveTab('Graph');
            await selectFile(nodePath);
        }
    }, [setActiveTab, selectFile]);

    // Single click handler for 3D
    const handleNodeClick3D = useCallback((node: any) => {
        handleSelectNode(node);
    }, [handleSelectNode]);

    const fitCameraToVisibleNodes = useCallback((targetNodes: any[], fillFraction = 0.55) => {
        const fg = fgInstanceRef.current;
        if (!fg || !targetNodes || targetNodes.length === 0) return;
        const camera = typeof fg.camera === 'function' ? fg.camera() : null;
        if (!camera) return;

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        let count = 0;

        for (const n of targetNodes) {
            if (typeof n.x === 'number' && typeof n.y === 'number' && typeof n.z === 'number') {
                minX = Math.min(minX, n.x);
                maxX = Math.max(maxX, n.x);
                minY = Math.min(minY, n.y);
                maxY = Math.max(maxY, n.y);
                minZ = Math.min(minZ, n.z);
                maxZ = Math.max(maxZ, n.z);
                count++;
            }
        }

        if (count === 0) return;

        let centerX = (minX + maxX) / 2;
        let centerY = (minY + maxY) / 2;
        let centerZ = (minZ + maxZ) / 2;

        // When a node is selected, center the camera and viewport directly on it
        if (selectedFile) {
            const selectedNodeObj = targetNodes.find((n: any) =>
                n.path === selectedFile ||
                n.id === selectedFile ||
                (n.type === 'file' && n.name === selectedFile)
            );
            if (selectedNodeObj && typeof selectedNodeObj.x === 'number' && typeof selectedNodeObj.y === 'number' && typeof selectedNodeObj.z === 'number') {
                centerX = selectedNodeObj.x;
                centerY = selectedNodeObj.y;
                centerZ = selectedNodeObj.z;
            }
        }

        const fovRad = ((camera.fov || 45) * Math.PI) / 180;
        const domHeight = (typeof fg.renderer === 'function' && fg.renderer()?.domElement?.clientHeight) || dimensions.height || (typeof window !== 'undefined' ? window.innerHeight : 600);

        let distance: number;

        if (count === 1) {
            const nodeRadiusWorld = 6;
            distance = (nodeRadiusWorld * domHeight) / (16 * Math.tan(fovRad / 2));
        } else {
            // Compute bounding sphere radius from center
            let maxDistSq = 0;
            for (const n of targetNodes) {
                if (typeof n.x === 'number' && typeof n.y === 'number' && typeof n.z === 'number') {
                    const distSq = (n.x - centerX) ** 2 + (n.y - centerY) ** 2 + (n.z - centerZ) ** 2;
                    if (distSq > maxDistSq) maxDistSq = distSq;
                }
            }
            const sphereRadius = Math.max(Math.sqrt(maxDistSq) + 4, 15);
            // Clamp camera distance to a minimum so the bounding sphere fills ~55% (fillFraction) of canvas height:
            const minDistanceForSphere = sphereRadius / (fillFraction * Math.tan(fovRad / 2));

            const sizeX = Math.max(maxX - minX, 20);
            const sizeY = Math.max(maxY - minY, 20);
            const sizeZ = Math.max(maxZ - minZ, 20);
            const maxDim = Math.max(sizeX, sizeY, sizeZ);
            const boxDistance = maxDim / (2 * Math.tan(fovRad / 2) * fillFraction);

            distance = Math.max(boxDistance, minDistanceForSphere);
        }

        const currentPos = camera.position;
        const dir = new THREE.Vector3().subVectors(currentPos, new THREE.Vector3(centerX, centerY, centerZ)).normalize();
        if (dir.lengthSq() < 0.001) {
            dir.set(0, 0, 1);
        }

        const targetPos = {
            x: centerX + dir.x * distance,
            y: centerY + dir.y * distance,
            z: centerZ + dir.z * distance
        };
        const lookAt = { x: centerX, y: centerY, z: centerZ };

        if (typeof fg.cameraPosition === 'function') {
            const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            fg.cameraPosition(targetPos, lookAt, prefersReducedMotion ? 0 : 350);
        }
    }, [dimensions.height, selectedFile]);

    fitCameraToVisibleNodesRef.current = fitCameraToVisibleNodes;

    const fgRef = useCallback((fg: any) => {
        if (fg) {
            fgInstanceRef.current = fg;
            fg.d3Force('charge').strength(-1400);
            fg.d3Force('link').distance(260);
            const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            fg.controls().autoRotate = !prefersReducedMotion;
            fg.controls().autoRotateSpeed = 0.5;
            fg.controls().addEventListener('start', () => { fg.controls().autoRotate = false; });
            setTimeout(() => {
                fitCameraToVisibleNodes(graphData.nodes, 0.55);
            }, 300);
        }
    }, [graphData.nodes, fitCameraToVisibleNodes]);

    // Keep 3D graphData in sync with displayGraph - only visible nodes, no hidden nodes
    useEffect(() => {
        const visible3DNodes = displayGraph.nodes;
        const visibleIdSet = new Set(visible3DNodes.map(n => n.id));

        const nodeConnMap = new Map<string, number>();
        displayGraph.edges.forEach((e: any) => {
            if (visibleIdSet.has(e.from) && visibleIdSet.has(e.to)) {
                nodeConnMap.set(e.from, (nodeConnMap.get(e.from) || 0) + 1);
                nodeConnMap.set(e.to, (nodeConnMap.get(e.to) || 0) + 1);
            }
        });

        const nodes = visible3DNodes.map((n: any) => {
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
            const rawName = n.name || (nodePath ? nodePath.split('/').pop() : n.id);
            const baseName = n.type === 'repository' ? 'repo' : (rawName.includes('/') ? rawName.split('/').pop() : rawName);

            return {
                id: n.id,
                name: baseName,
                path: nodePath,
                color,
                val,
                type: n.type,
                connections: nodeConnMap.get(n.id) || 0,
                neighbors: new Set<string>(),
                links: [] as any[]
            };
        });

        const nodeMap = new Map<string, any>(nodes.map((n: any) => [n.id, n]));

        const links = displayGraph.edges
            .filter((e: any) => visibleIdSet.has(e.from) && visibleIdSet.has(e.to))
            .map((e: any) => {
                const edgeId = e.id || `${e.from}->${e.to}:${e.type}`;
                let color = '#8A918C';
                if (neighborInfo.hasSelection) {
                    if (neighborInfo.incomingEdgeIds.has(edgeId)) color = '#E3A04A';
                    else if (neighborInfo.outgoingEdgeIds.has(edgeId)) color = '#4FD1B5';
                    else if (e.type === 'contains') color = '#8A918C';
                    else color = '#4FD1B5';
                } else {
                    if (e.type === 'contains') color = '#8A918C';
                    else if (e.type === 'imports' || e.type === 'calls') color = '#4FD1B5';
                }

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
    }, [displayGraph, neighborInfo, hoveredGraphNode]);

    // Precompute top 8 highest-degree nodes for 3D label display
    const top8DegreeNodeIds = useMemo(() => {
        if (!graphData.nodes || graphData.nodes.length === 0) return new Set<string>();
        const sorted = [...graphData.nodes].sort((a, b) => (b.connections || 0) - (a.connections || 0));
        return new Set(sorted.slice(0, 8).map(n => n.id));
    }, [graphData.nodes]);

    // Center 3D camera on visible nodes bounding box (~55% of canvas) when selectedFile changes
    useEffect(() => {
        if (viewMode !== '3D' || !fgInstanceRef.current) return;
        fgInstanceRef.current.d3Force('charge')?.strength(-1400);
        fgInstanceRef.current.d3Force('link')?.distance(260);
        const timer = setTimeout(() => {
            fitCameraToVisibleNodes(graphData.nodes, 0.55);
        }, 200);
        return () => clearTimeout(timer);
    }, [selectedFile, viewMode, graphData.nodes, fitCameraToVisibleNodes]);

    // Keep 3D sprite labels constant screen size (fixed 12px font) and hide overlapping ones (priority: selected > hovered > neighbors)
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
                    const screenPositions: Array<{ x: number; y: number; sprite: any; priority: number }> = [];

                    scene.traverse((obj: any) => {
                        if (obj.isSprite && obj.textHeight !== undefined && obj.userData?.priority !== undefined) {
                            const dist = camera.position.distanceTo(obj.getWorldPosition(tmpVec));
                            const fovRad = ((camera.fov || 45) * Math.PI) / 180;
                            const targetHeight = 2 * dist * Math.tan(fovRad / 2) * (12 / Math.max(1, h));
                            obj.textHeight = Math.max(0.1, targetHeight);

                            const screenPos = tmpVec.clone().project(camera);
                            const screenX = (screenPos.x + 1) * w / 2;
                            const screenY = (-screenPos.y + 1) * h / 2;
                            screenPositions.push({
                                x: screenX,
                                y: screenY,
                                sprite: obj,
                                priority: (obj.userData?.priority as number) || 1
                            });
                        }
                    });

                    screenPositions.sort((a, b) => b.priority - a.priority);

                    const drawn: Array<{ x: number; y: number }> = [];
                    for (const item of screenPositions) {
                        const overlaps = drawn.some(d => Math.abs(d.x - item.x) < 75 && Math.abs(d.y - item.y) < 22);
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
                    ? "fixed inset-0 h-[100dvh] w-screen z-50 overflow-hidden flex flex-col"
                    : "w-full h-full rounded-lg border border-zinc-800/50 relative"
            )}
            style={{ cursor: viewMode === '3D' ? 'grab' : 'default' }}
        >
            {/* View Mode & Toolbar */}
            <div className="absolute top-3.5 left-3.5 z-30 glass-surface bg-[rgba(16,20,21,0.85)] backdrop-blur-md rounded-lg p-1.5 flex items-center gap-2 border border-white/10 shadow-lg text-xs font-mono select-none">
                {/* Back button: left chevron icon button with tooltip "Previous node", disabled when no history */}
                {visitedHistory.length > 0 && (
                    <>
                        <button
                            onClick={handleBack}
                            className="p-1.5 rounded transition-colors cursor-pointer flex items-center justify-center text-[#8A918C] hover:text-[#E8EAE6] hover:bg-white/[0.06]"
                            title="Previous node"
                        >
                            <ChevronLeft size={14} />
                        </button>
                        <div className="h-3.5 w-[1px] bg-white/10" />
                    </>
                )}

                {/* Segmented control: 2D | 3D */}
                <div className="flex items-center rounded-md bg-white/[0.04] p-0.5 border border-white/[0.06]">
                    <button
                        onClick={() => handleViewModeChange('2D')}
                        className={cn(
                            "px-2.5 py-1 text-xs rounded transition-colors cursor-pointer font-medium",
                            viewMode === '2D'
                                ? "bg-[#4FD1B5] text-[#04100D]"
                                : "text-[#8A918C] hover:text-[#E8EAE6]"
                        )}
                    >
                        2D
                    </button>
                    <button
                        onClick={() => handleViewModeChange('3D')}
                        className={cn(
                            "px-2.5 py-1 text-xs rounded transition-colors cursor-pointer font-medium",
                            viewMode === '3D'
                                ? "bg-[#4FD1B5] text-[#04100D]"
                                : "text-[#8A918C] hover:text-[#E8EAE6]"
                        )}
                    >
                        3D
                    </button>
                </div>

                {/* Segmented control: Direct | Indirect */}
                <div className="flex items-center rounded-md bg-white/[0.04] p-0.5 border border-white/[0.06]">
                    <button
                        onClick={() => {
                            if (!selectedFile) return;
                            setFocusDepth(1);
                        }}
                        disabled={!selectedFile}
                        className={cn(
                            "px-2.5 py-1 text-[11px] font-mono rounded transition-colors select-none",
                            !selectedFile
                                ? "text-[#8A918C]/40 opacity-40 cursor-not-allowed"
                                : focusDepth === 1
                                ? "bg-[#4FD1B5] text-[#04100D] font-medium cursor-pointer"
                                : "text-[#8A918C] hover:text-[#E8EAE6] cursor-pointer"
                        )}
                        title={!selectedFile ? "Select a node first" : "Direct connections (depth 1)"}
                    >
                        Direct
                    </button>
                    <button
                        onClick={() => {
                            if (!selectedFile) return;
                            setFocusDepth(2);
                        }}
                        disabled={!selectedFile}
                        className={cn(
                            "px-2.5 py-1 text-[11px] font-mono rounded transition-colors select-none",
                            !selectedFile
                                ? "text-[#8A918C]/40 opacity-40 cursor-not-allowed"
                                : focusDepth === 2
                                ? "bg-[#4FD1B5] text-[#04100D] font-medium cursor-pointer"
                                : "text-[#8A918C] hover:text-[#E8EAE6] cursor-pointer"
                        )}
                        title={!selectedFile ? "Select a node first" : "Direct & indirect connections (depth 2)"}
                    >
                        Indirect
                    </button>
                </div>

                <div className="h-3.5 w-[1px] bg-white/10" />

                {/* "Show calls" toggle button */}
                <button
                    onClick={() => setShowCalls(prev => !prev)}
                    className={cn(
                        "px-2.5 py-1 text-xs rounded-md border transition-colors cursor-pointer flex items-center gap-1.5",
                        showCalls
                            ? "bg-[#4FD1B5]/20 border-[#4FD1B5]/50 text-[#4FD1B5] font-medium"
                            : "bg-white/[0.04] border-white/[0.06] text-[#8A918C] hover:text-[#E8EAE6]"
                    )}
                    title="Toggle function-level calls"
                >
                    <span>Show calls</span>
                </button>

                {/* "Reset view" visible button */}
                <button
                    onClick={handleReset}
                    className="px-2.5 py-1 text-xs rounded-md border border-white/[0.06] bg-white/[0.04] text-[#8A918C] hover:text-[#E8EAE6] hover:bg-white/[0.08] transition-colors cursor-pointer flex items-center gap-1.5"
                    title="Reset view"
                >
                    <RefreshCw size={12} />
                    <span>Reset view</span>
                </button>

                <div className="h-3.5 w-[1px] bg-white/10" />

                {/* Fullscreen icon button */}
                <button
                    onClick={toggleExpanded}
                    className={cn(
                        "p-1.5 rounded-md border border-white/[0.06] transition-colors flex items-center justify-center cursor-pointer",
                        isExpanded
                            ? "bg-[#4FD1B5] text-[#04100D]"
                            : "bg-white/[0.04] text-[#8A918C] hover:text-[#E8EAE6] hover:bg-white/[0.08]"
                    )}
                    title={isExpanded ? "Exit fullscreen (Esc)" : "Fullscreen (Esc to exit)"}
                >
                    {isExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                </button>
            </div>

            {/* In expanded mode, floating glass panel */}
            {isExpanded && (
                <div className="absolute top-3.5 right-3.5 z-30 w-72 max-h-[calc(100dvh-2rem)] overflow-y-auto glass-surface bg-[rgba(16,20,21,0.85)] backdrop-blur-md border border-white/10 rounded-xl p-3.5 text-xs shadow-2xl space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-white/10">
                        <span className="font-semibold text-xs text-[#E8EAE6]">Node details</span>
                        <button
                            onClick={() => setIsExpanded(false)}
                            className="text-[11px] font-mono text-[#8A918C] hover:text-[#E8EAE6] cursor-pointer"
                            title="Exit expanded view (Esc)"
                        >
                            Collapse
                        </button>
                    </div>
                    {selectedFile ? (
                        <div className="space-y-3">
                            <div className="space-y-1.5 pb-2.5 border-b border-white/[0.08]">
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
                            <div>
                                <ConnectedFilesList maxHeightClass="max-h-56" />
                            </div>
                        </div>
                    ) : (
                        <div className="text-[11px] text-[#8A918C] py-4 text-center font-sans">
                            Click a node to inspect details and connections
                        </div>
                    )}
                </div>
            )}

            {/* Main Graph View: 2D or 3D */}
            {viewMode === '2D' ? (
                <OverviewGraph2D
                    graph={displayGraph}
                    simplify={simplify}
                    selectedFile={selectedFile}
                    selectedSymbol={selectedSymbol}
                    onSelectNode={handleSelectNode}
                    onDoubleClickNode={handleDoubleClickNode}
                    isExpanded={isExpanded}
                    hoveredGraphNode={hoveredGraphNode}
                    focusDepth={focusDepth}
                    resetTrigger={resetTrigger}
                    showCalls={showCalls}
                />
            ) : (
                <ForceGraph3D
                    ref={fgRef as any}
                    graphData={graphData}
                    width={dimensions.width > 0 ? dimensions.width : undefined}
                    height={dimensions.height > 0 ? dimensions.height : undefined}
                    nodeRelSize={4}
                    nodeVal={(node: any) => node.val}
                    linkDirectionalArrowLength={6}
                    linkDirectionalArrowRelPos={1}
                    linkDirectionalArrowColor={(link: any) => link.color}
                    linkColor={(link: any) => link.color}
                    linkWidth={1}
                    linkOpacity={0.4}
                    linkDirectionalParticles={0}
                    backgroundColor="#07090A"
                    onNodeClick={handleNodeClick3D}
                    onBackgroundClick={() => handleSelectNode(null)}
                    onEngineStop={() => fitCameraToVisibleNodes(graphData.nodes, 0.55)}
                    nodeThreeObject={(node: any) => {
                        const nodePath = node.path || (node.type === 'file' ? node.id : undefined);
                        const isSelected = neighborInfo.selectedNodeIds.has(node.id) || (selectedFile && (nodePath === selectedFile || node.id === selectedFile));
                        const isHovered = hoveredGraphNode ? (nodePath === hoveredGraphNode || node.id === hoveredGraphNode) : false;
                        const isTop8Degree = top8DegreeNodeIds.has(node.id);
                        const isRepo = node.type === 'repository';

                        const baseColor = isRepo ? '#E8EAE6' : node.type === 'file' ? '#4FD1B5' : node.type === 'class' ? '#E3A04A' : '#8A918C';

                        const connCount = Number(node.connections || 0);
                        // Bigger node spheres (radius by degree, min 6px)
                        const baseRadius = Math.max(6, Math.min(18, 6 + Math.sqrt(connCount) * 2));
                        const radius = isSelected ? Math.max(20, baseRadius * 1.5) : baseRadius;

                        // Labels only for selected, hovered and the 8 highest-degree nodes
                        const shouldShowLabel = isSelected || isHovered || isTop8Degree;

                        if (!shouldShowLabel) {
                            const dotGeometry = new THREE.SphereGeometry(radius, 16, 16);
                            const dotMaterial = new THREE.MeshLambertMaterial({
                                color: baseColor,
                                opacity: 0.9,
                                transparent: true
                            });
                            return new THREE.Mesh(dotGeometry, dotMaterial);
                        }

                        // Selected, hovered, or eligible high-degree node: node sphere + pill label
                        const group = new THREE.Group();

                        if (isRepo) {
                            const ringGeo = new THREE.TorusGeometry(radius, radius * 0.25, 16, 32);
                            const ringMat = new THREE.MeshBasicMaterial({ color: 0xE8EAE6 });
                            group.add(new THREE.Mesh(ringGeo, ringMat));
                        } else {
                            // Selected file: brightest node (white fill, teal glow)
                            const material = new THREE.MeshLambertMaterial({
                                color: isSelected ? 0xFFFFFF : baseColor,
                                emissive: isSelected ? 0x4FD1B5 : (isHovered ? baseColor : 0x000000),
                                emissiveIntensity: isSelected ? 0.8 : (isHovered ? 0.4 : 0.1)
                            });
                            group.add(new THREE.Mesh(new THREE.SphereGeometry(radius, 18, 18), material));

                            // Highlight selected node with prominent wireframe halo
                            if (isSelected) {
                                const haloGeo = new THREE.SphereGeometry(radius * 1.3, 16, 16);
                                const haloMat = new THREE.MeshBasicMaterial({
                                    color: 0x4FD1B5,
                                    wireframe: true,
                                    transparent: true,
                                    opacity: 0.6
                                });
                                group.add(new THREE.Mesh(haloGeo, haloMat));
                            }
                        }

                        // Labels: base name only
                        const rawName = node.name || (nodePath ? nodePath.split('/').pop() : node.id);
                        const baseName = isRepo ? 'repo' : (rawName.includes('/') ? rawName.split('/').pop() : rawName);

                        const sprite = new SpriteText(baseName);
                        sprite.fontFace = 'IBM Plex Mono';
                        sprite.textHeight = 3.2;
                        sprite.color = '#E8EAE6';
                        sprite.backgroundColor = 'rgba(16, 20, 21, 0.9)';
                        sprite.borderRadius = 4;
                        sprite.padding = [4, 2];
                        sprite.borderColor = 'rgba(255, 255, 255, 0.1)';
                        sprite.borderWidth = 0.5;
                        sprite.position.y = radius + 5;
                        sprite.renderOrder = 999;
                        sprite.material.depthTest = false;
                        // Priority: selected > hovered > highest degree
                        let priority = connCount;
                        if (isHovered) priority += 500000;
                        if (isSelected) priority += 1000000;
                        (sprite as any).userData = {
                            priority
                        };
                        group.add(sprite);

                        return group;
                    }}
                />
            )}

            {/* Bottom-left: Status pill and Legend */}
            <div className="absolute bottom-3.5 left-3.5 z-20 flex flex-col items-start gap-2 pointer-events-auto select-none">
                {/* Status pill: "Showing 12 of 24 importers" or "Showing 12 of 32 files" plus a "Show all" action */}
                <div className="glass-surface bg-[rgba(16,20,21,0.85)] backdrop-blur-md rounded-md px-2.5 py-1 flex items-center gap-2 border border-white/10 text-xs font-mono shadow-md text-[#8A918C]">
                    {selectedFile && !showAllNodes && totalImportersCount > 12 ? (
                        <span>
                            Showing <span className="text-[#E8EAE6] font-medium">12</span> of <span className="text-[#E8EAE6] font-medium">{totalImportersCount}</span> importers
                        </span>
                    ) : displayNodes.length < totalCandidateCount ? (
                        <span>
                            Showing <span className="text-[#E8EAE6] font-medium">{displayNodes.length}</span> of <span className="text-[#E8EAE6] font-medium">{totalCandidateCount}</span> files
                        </span>
                    ) : (
                        <span>
                            Showing <span className="text-[#E8EAE6] font-medium">{displayNodes.length}</span> files
                        </span>
                    )}
                    {displayNodes.length < totalCandidateCount && (
                        <>
                            <span className="text-white/20">|</span>
                            <button
                                onClick={() => setShowAllNodes(true)}
                                className="text-[#4FD1B5] hover:underline font-medium cursor-pointer"
                            >
                                Show all
                            </button>
                        </>
                    )}
                </div>

                {/* Legend always visible by default (compact, bottom-left, small collapse chevron), filtered to present types */}
                <div className="glass-surface bg-[rgba(16,20,21,0.9)] backdrop-blur-md border border-white/10 rounded-lg p-2.5 text-xs font-mono shadow-xl max-w-xs select-none">
                    <div
                        className="flex items-center justify-between gap-3 border-b border-white/[0.08] pb-1 cursor-pointer"
                        onClick={() => setLegendCollapsed(prev => !prev)}
                    >
                        <span className="font-semibold text-[11px] text-[#E8EAE6]">Legend</span>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setLegendCollapsed(prev => !prev);
                            }}
                            className="text-[#8A918C] hover:text-[#E8EAE6] text-[10px] cursor-pointer p-0.5"
                            title={legendCollapsed ? "Expand legend" : "Collapse legend"}
                        >
                            {legendCollapsed ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </button>
                    </div>
                    {!legendCollapsed && (
                        <div className="pt-2 space-y-2 text-[11px]">
                            {/* Arrow samples: teal Imports, amber Imported by, grey dashed Indirect */}
                            <div className="space-y-1.5">
                                {legendData.hasImports && (
                                    <div className="flex items-center gap-2 text-[#8A918C]">
                                        <svg width="22" height="10" viewBox="0 0 22 10" className="inline-block shrink-0">
                                            <line x1="1" y1="5" x2="17" y2="5" stroke="#4FD1B5" strokeWidth="1.5" />
                                            <polygon points="15,2 21,5 15,8" fill="#4FD1B5" />
                                        </svg>
                                        <span className="text-[#E8EAE6]">Imports</span>
                                    </div>
                                )}
                                {legendData.hasImportedBy && (
                                    <div className="flex items-center gap-2 text-[#8A918C]">
                                        <svg width="22" height="10" viewBox="0 0 22 10" className="inline-block shrink-0">
                                            <line x1="1" y1="5" x2="17" y2="5" stroke="#E3A04A" strokeWidth="1.5" />
                                            <polygon points="15,2 21,5 15,8" fill="#E3A04A" />
                                        </svg>
                                        <span className="text-[#E8EAE6]">Imported by</span>
                                    </div>
                                )}
                                {legendData.hasIndirect && (
                                    <div className="flex items-center gap-2 text-[#8A918C]">
                                        <svg width="22" height="10" viewBox="0 0 22 10" className="inline-block shrink-0">
                                            <line x1="1" y1="5" x2="17" y2="5" stroke="#8A918C" strokeWidth="1.5" strokeDasharray="3 3" />
                                            <polygon points="15,2 21,5 15,8" fill="#8A918C" />
                                        </svg>
                                        <span className="text-[#E8EAE6]">Indirect</span>
                                    </div>
                                )}
                                {showCalls && legendData.hasCalls && (
                                    <div className="flex items-center gap-2 text-[#8A918C]">
                                        <svg width="22" height="10" viewBox="0 0 22 10" className="inline-block shrink-0">
                                            <line x1="1" y1="5" x2="17" y2="5" stroke="#6F8F9A" strokeWidth="1.5" strokeDasharray="1.5 2" />
                                            <polygon points="15,2 21,5 15,8" fill="#6F8F9A" />
                                        </svg>
                                        <span className="text-[#E8EAE6]">Calls</span>
                                    </div>
                                )}
                            </div>

                            {/* One line explanatory note */}
                            <div className="text-[10px] text-[#8A918C] pt-1.5 border-t border-white/[0.06] italic">
                                Arrow points to the file being imported.
                            </div>
                        </div>
                    )}
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
        selectedSymbol, impactResult, setImpactResult, graph, setGraph,
        repoUrl, selectedSha, setCodeHighlightLine, selectFile,
        changeSet, addToChangeSet, removeFromChangeSet, clearChangeSet,
        changeSetResult, setChangeSetResult, changeSetLoading, setChangeSetLoading,
        treeFiles, setTreeFiles, commits, selectedHistoryCommit, setSelectedHistoryCommit,
        setAiCitations, meta
    } = useAppStore();

    const stats = useMemo(() => selectRepoStats({ graph, treeFiles, commits }), [graph, treeFiles, commits]);
    const fileRisk = useMemo(() => selectedFile ? computeRisk(selectedFile, graph, commits) : null, [selectedFile, graph, commits]);
    const connectionsData = useMemo(() => {
        if (!graph || !selectedFile) return null;
        const connected = getConnectedFiles(graph, selectedFile);
        return {
            imports: connected.imports,
            dependents: connected.importedBy,
            importedBy: connected.importedBy
        };
    }, [graph, selectedFile]);

    const analyzedPaths = useMemo(() => {
        const paths = new Set<string>();
        const hasGraphFiles = graph?.nodes && graph.nodes.some(n => n.type === 'file');
        if (hasGraphFiles) {
            for (const node of graph!.nodes) {
                if (node.type === 'file') {
                    const p = (node as any).path || node.id;
                    if (p) {
                        paths.add(p);
                        paths.add(p.replace(/^\.\//, ''));
                    }
                }
            }
        } else if (treeFiles && treeFiles.length > 0) {
            for (const file of treeFiles) {
                paths.add(file);
                paths.add(file.replace(/^\.\//, ''));
            }
        }
        return paths;
    }, [graph, treeFiles]);

    const isHotspotSourceFile = useCallback((pathStr: string) => {
        if (!pathStr) return false;
        const normalized = pathStr.replace(/\\/g, '/');
        const lower = normalized.toLowerCase();
        const parts = lower.split('/');
        const fileName = parts[parts.length - 1];

        // Exclude migrations/**
        if (parts.includes('migrations')) return false;

        // Exclude django entry/framework files
        if (['settings.py', 'urls.py', 'wsgi.py', 'asgi.py', 'manage.py'].includes(fileName)) return false;

        // Exclude README
        if (fileName.includes('readme')) return false;

        // Exclude configs
        if (fileName.includes('.config.') || fileName.includes('config') || fileName.startsWith('.')) return false;
        if (['vite', 'postcss', 'tailwind', 'eslint', 'prettier', 'tsconfig'].some(k => fileName.includes(k))) return false;

        // Exclude non-source extensions (md, yml, json, etc.)
        if (/\.(md|markdown|ya?ml|json|toml|ini|env|txt|rst|lock|xml|properties)$/i.test(fileName)) return false;

        // Must have source code extension
        const sourceExts = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.cc', '.h', '.hpp', '.cs', '.rb', '.php', '.swift', '.kt'];
        return sourceExts.some(ext => fileName.endsWith(ext));
    }, []);

    const isConfigFile = useCallback((pathStr: string) => {
        const lower = pathStr.toLowerCase();
        const base = lower.split('/').pop() || lower;
        return (
            base.includes('eslint') ||
            base.includes('postcss') ||
            base.includes('tailwind') ||
            base.includes('vite') ||
            base.includes('.config.') ||
            base.startsWith('tsconfig') ||
            base.startsWith('.prettier') ||
            base.startsWith('.env')
        );
    }, []);

    const hotspotsList = useMemo(() => {
        if (!graph) return [];
        const fileNodes = graph.nodes.filter(n => n.type === 'file');
        return fileNodes
            .filter(fn => {
                const p = (fn as any).path || fn.id || '';
                return isHotspotSourceFile(p);
            })
            .map(fn => {
                const p = (fn as any).path || fn.id;
                const r = computeRisk(p, graph, commits);
                const name = (fn as any).name || (p ? p.split('/').pop() : fn.id);
                return { id: fn.id, path: p, name, risk: r };
            })
            .filter(item => item.risk && item.risk.score > 0)
            .sort((a, b) => b.risk.score - a.risk.score)
            .slice(0, 7);
    }, [graph, commits, isHotspotSourceFile]);

    const hotspotNameCounts = useMemo(() => {
        const counts = new Map<string, number>();
        hotspotsList.forEach((h: any) => {
            const raw = h.name || (h.path ? h.path.split('/').pop() : 'unknown');
            counts.set(raw, (counts.get(raw) || 0) + 1);
        });
        return counts;
    }, [hotspotsList]);

    const compositionData = useMemo(() => {
        const fileList: string[] = [];
        if (graph?.nodes) {
            for (const n of graph.nodes) {
                if (n.type === 'file') {
                    const p = (n as any).path || n.id;
                    if (p) fileList.push(p);
                }
            }
        } else if (treeFiles && treeFiles.length > 0) {
            fileList.push(...treeFiles);
        }

        if (fileList.length === 0) return [];

        const counts: Record<string, number> = {};
        for (const f of fileList) {
            const lower = f.toLowerCase();
            const fileName = lower.split('/').pop() || '';
            let cat = 'Other';

            if (
                fileName.includes('.config.') ||
                fileName.includes('config') ||
                fileName.startsWith('.') ||
                /\.(json|ya?ml|toml|ini|env|lock|xml|properties|cfg|cnf)$/.test(fileName)
            ) {
                cat = 'Config';
            } else if (lower.endsWith('.py') || lower.endsWith('.pyw')) {
                cat = 'Python';
            } else if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) {
                cat = 'JavaScript';
            } else if (lower.endsWith('.ts') || lower.endsWith('.tsx')) {
                cat = 'TypeScript';
            } else if (lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.rst') || lower.endsWith('.txt')) {
                cat = 'Markdown';
            } else if (lower.endsWith('.css') || lower.endsWith('.scss') || lower.endsWith('.sass') || lower.endsWith('.less')) {
                cat = 'CSS';
            } else if (lower.endsWith('.html') || lower.endsWith('.htm')) {
                cat = 'HTML';
            } else if (lower.endsWith('.go')) {
                cat = 'Go';
            } else if (lower.endsWith('.rs')) {
                cat = 'Rust';
            } else if (lower.endsWith('.java')) {
                cat = 'Java';
            } else if (lower.endsWith('.c') || lower.endsWith('.cpp') || lower.endsWith('.cc') || lower.endsWith('.h') || lower.endsWith('.hpp')) {
                cat = 'C/C++';
            } else if (lower.endsWith('.sh') || lower.endsWith('.bash')) {
                cat = 'Shell';
            } else if (lower.endsWith('.sql')) {
                cat = 'SQL';
            } else {
                const match = fileName.match(/\.([a-z0-9]+)$/);
                if (match && match[1]) {
                    cat = match[1].charAt(0).toUpperCase() + match[1].slice(1);
                } else {
                    cat = 'Other';
                }
            }
            counts[cat] = (counts[cat] || 0) + 1;
        }

        const total = fileList.length;
        if (counts['Other'] && (counts['Other'] / total) > 0.10) {
            const allowed = Math.floor(total * 0.10);
            const excess = counts['Other'] - allowed;
            counts['Other'] = allowed;
            counts['Config'] = (counts['Config'] || 0) + excess;
            if (counts['Other'] === 0) delete counts['Other'];
        }

        const palette = ['#4FD1B5', '#E3A04A', '#38bdf8', '#c084fc', '#facc15', '#a78bfa', '#fb923c', '#8A918C'];

        return Object.entries(counts)
            .filter(([, count]) => count > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([label, count], idx) => ({
                label,
                count,
                percentage: Math.max(1, Math.round((count / total) * 100)),
                color: palette[idx % palette.length]
            }));
    }, [graph, treeFiles]);

    const hotspotPaths = useMemo(() => {
        return new Set(hotspotsList.slice(0, 5).map(h => h.path));
    }, [hotspotsList]);

    const [depth, setDepth] = useState(3);
    const [maxRes, setMaxRes] = useState(50);
    const [analyzing, setAnalyzing] = useState(false);
    const [askQ, setAskQ] = useState('');
    const [aiError, setAiError] = useState<{ message: string; rawCode?: string } | null>(null);
    const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string; followups?: string[]; isThinking?: boolean }>>([]);
    const [historyData, setHistoryData] = useState<any[] | null>(null);
    const [healthData, setHealthData] = useState<import('../api').HealthSummaryResult | null>(null);
    const [healthLoading, setHealthLoading] = useState(false);
    const [openHealthSections, setOpenHealthSections] = useState({ circular: true, unused: true, god: true });
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const [showImpactReasons, setShowImpactReasons] = useState(true);
    const [copiedReport, setCopiedReport] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);
    const abortControllerRef = useRef<AbortController | null>(null);

    const [drawerFile, setDrawerFile] = useState<string | null>(null);
    const [drawerOpen, setDrawerOpen] = useState(false);

    const handleOpenDrawer = useCallback((filePath: string) => {
        setDrawerFile(filePath);
        setDrawerOpen(true);
    }, []);

    // Open drawer on file selection in Overview
    useEffect(() => {
        if (activeTab === 'Overview' && selectedFile) {
            setDrawerFile(selectedFile);
            setDrawerOpen(true);
        }
    }, [activeTab, selectedFile]);

    // Close drawer on Escape key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setDrawerOpen(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

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

    // Keep aiCitations in sync with the latest assistant message
    useEffect(() => {
        const lastAssistant = chatMessages.slice().reverse().find(m => m.role === 'assistant' && !m.isThinking);
        if (lastAssistant && lastAssistant.content) {
            const chips = extractValidEvidence(lastAssistant.content, analyzedPaths);
            setAiCitations(chips);
        } else {
            setAiCitations([]);
        }
    }, [chatMessages, analyzedPaths, setAiCitations]);

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
        setAiCitations([]);
        setAiError(null);
        setAskQ('');
        if (chatStorageKey) {
            try {
                localStorage.removeItem(chatStorageKey);
            } catch {
                // ignore
            }
        }
    }, [chatStorageKey, setAiCitations]);

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
                        lines.push(`- **${o.name}**: ${o.share}% (${o.count} ${o.count === 1 ? 'commit' : 'commits'})`);
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

    const handleDownloadOverviewReport = () => {
        const md = `# Repository Overview: ${meta?.fullName || repoUrl || 'Repository'}

- **Analyzed Files**: ${stats.analyzedFiles} / ${stats.totalFiles}
- **Symbols**: ${stats.symbols}
- **Links**: ${stats.links}
- **Hotspots**: ${stats.hotspots}

## Top Hotspots
${hotspotsList.map(h => `- \`${h.path || h.name}\` (Score: ${Math.round(h.risk?.score || 0)}, Dependents: ${h.risk?.directDependents || 0})`).join('\n')}
`;
        downloadTextFile('repo-overview.md', md);
    };

    const handleCopyOverviewPRComment = async () => {
        const md = `### 📊 Repository Overview: \`${meta?.fullName || repoUrl || 'Repository'}\`
- Files analyzed: **${stats.analyzedFiles} / ${stats.totalFiles}**
- High risk hotspots: **${hotspotsList.slice(0, 5).map(h => h.path?.split('/').pop()).join(', ')}**
`;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(md);
        }
    };

    const handleDownloadChangeSetReport = () => {
        const md = `# Change Set Impact Report

## Input Files
${changeSet.map(f => `- \`${f}\``).join('\n')}

## Combined Impact
- **Total Affected**: ${changeSetResult?.affectedFiles?.length || 0}
- **Average Risk Score**: ${changeSetResult?.combinedRisk ? Math.round(changeSetResult.combinedRisk) : 0}

### Affected Files
${(changeSetResult?.affectedFiles || []).map((f: string) => `- \`${f}\``).join('\n')}
`;
        downloadTextFile('changeset-impact.md', md);
    };

    const handleCopyChangeSetPRComment = async () => {
        const md = `### 💥 Change Set Impact
- Inputs: \`${changeSet.map(f => f.split('/').pop()).join('`, `')}\`
- Affected files: **${changeSetResult?.affectedFiles?.length || 0}**
`;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(md);
        }
    };

    const handleDownloadHealthReport = () => {
        const md = `# Repository Health Report

- **Circular Imports**: ${healthData?.circularImports?.length || 0}
- **God Files**: ${healthData?.godFiles?.length || 0}
- **Unused Files**: ${healthData?.unusedFiles?.length || 0}

## Circular Imports
${(healthData?.circularImports || []).map((c: string[]) => `- ${c.join(' -> ')}`).join('\n')}

## God Files
${(healthData?.godFiles || []).map((g: any) => `- \`${g.file || g.path}\` (${g.dependents || 0} dependents)`).join('\n')}

## Unused Files
${(healthData?.unusedFiles || []).map((u: string) => `- \`${u}\``).join('\n')}
`;
        downloadTextFile('repository-health.md', md);
    };

    const handleCopyHealthPRComment = async () => {
        const md = `### 🩺 Repository Health Check
- Circular dependency cycles: **${healthData?.circularImports?.length || 0}**
- God modules (>15 dependents): **${healthData?.godFiles?.length || 0}**
- Unused files: **${healthData?.unusedFiles?.length || 0}**
`;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(md);
        }
    };

    const handleDownloadConnectionsReport = () => {
        const md = `# Connections for ${selectedFile || 'file'}

## Imports
${(connectionsData?.imports || []).map((f: string) => `- \`${f}\``).join('\n')}

## Imported By
${(connectionsData?.importedBy || []).map((f: string) => `- \`${f}\``).join('\n')}
`;
        downloadTextFile(`connections-${selectedFile?.split('/').pop() || 'file'}.md`, md);
    };

    const handleCopyConnectionsPRComment = async () => {
        const md = `### 🔗 File Connections: \`${selectedFile?.split('/').pop()}\`
- Imports: **${connectionsData?.imports?.length || 0}**
- Imported by: **${connectionsData?.importedBy?.length || 0}**
`;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(md);
        }
    };

    const handleDownloadHistoryReport = () => {
        const md = `# Commit History: ${selectedFile || 'file'}

${(historyData || []).map((c: any) => `- \`${c.sha?.substring(0, 7)}\` **${c.author?.name || 'Author'}**: ${c.commit?.message?.split('\n')[0]}`).join('\n')}
`;
        downloadTextFile(`history-${selectedFile?.split('/').pop() || 'file'}.md`, md);
    };

    const handleCopyHistoryPRComment = async () => {
        const md = `### 📜 History for \`${selectedFile?.split('/').pop()}\`
${(historyData || []).slice(0, 5).map((c: any) => `- \`${c.sha?.substring(0, 7)}\` ${c.commit?.message?.split('\n')[0]}`).join('\n')}
`;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(md);
        }
    };

    const handleDownloadChatReport = () => {
        const md = `# Ask AI Conversation: ${selectedFile || 'file'}

${chatMessages.map(m => `### ${m.role === 'user' ? 'User' : 'AI'}\n${m.content}\n`).join('\n')}
`;
        downloadTextFile(`chat-${selectedFile?.split('/').pop() || 'file'}.md`, md);
    };

    const handleCopyChatPRComment = async () => {
        const lastAssistant = [...chatMessages].reverse().find(m => m.role === 'assistant');
        const md = `### 🤖 Ask AI Summary
${lastAssistant?.content || 'No response recorded.'}
`;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(md);
        }
    };

    const reanalyzeRepo = async () => {
        if (!repoUrl || !selectedSha) return;
        setAnalyzing(true);
        try {
            const treeRes = await api.repositories.getTree(repoUrl, selectedSha);
            setTreeFiles(treeRes.files);
            const state = useAppStore.getState();
            const cached = state.repoCache[repoUrl]?.shaAnalysis?.[selectedSha];
            if (cached) {
                setGraph(cached.graph);
            } else {
                const paths = getPathsToAnalyze(treeRes.files);
                const data = await api.repositories.analyze(repoUrl, selectedSha, paths);
                const stats = selectRepoStats({ graph: data.graph, treeFiles: treeRes.files, commits: state.commits });
                state.cacheShaAnalysis(repoUrl, selectedSha, data.graph, stats);
                setGraph(data.graph);
            }
        } catch (e) {
            console.error('Re-analyze repo failed', e);
        } finally {
            setAnalyzing(false);
        }
    };

    const analyzeChangeSet = async () => {
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
    };

    // Auto-scroll to bottom of chat on new messages or thinking state, and after streaming/chips render
    useEffect(() => {
        if (activeTab === 'AskAI') {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            const timer1 = setTimeout(() => {
                messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }, 50);
            const timer2 = setTimeout(() => {
                messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }, 180);
            return () => {
                clearTimeout(timer1);
                clearTimeout(timer2);
            };
        }
    }, [chatMessages, aiError, isStreaming, activeTab]);

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
        if (!rawAnswer) return { cleanAnswer: '', followups: [] };

        let cleanAnswer = rawAnswer;
        let followups: string[] = [];

        const isPlaceholder = (text: string) => {
            const lower = text.toLowerCase().trim();
            if (lower.length < 5) return true;
            if (/^q\s*\d+$/i.test(lower)) return true;
            if (/^question\s*\d*$/i.test(lower)) return true;
            if (/^<question\s*\d*>$/i.test(lower)) return true;
            if (/^<q\d+>$/i.test(lower)) return true;
            if (/^\[question\s*\d*\]$/i.test(lower)) return true;
            if (lower === 'q1' || lower === 'q2' || lower === 'q3') return true;
            if (lower.includes('(short questions)') || lower.includes('(3 real') || lower.includes('(generate 3')) return true;
            return false;
        };

        const tryExtractJsonArray = (text: string): string[] => {
            const jsonArrayRegex = /\[\s*"[\s\S]*?"\s*\]/;
            const match = text.match(jsonArrayRegex);
            if (match) {
                try {
                    const parsed = JSON.parse(match[0]);
                    if (Array.isArray(parsed)) {
                        return parsed
                            .filter((item): item is string => typeof item === 'string' && item.trim().length > 0 && !isPlaceholder(item))
                            .map(item => item.trim())
                            .slice(0, 3);
                    }
                } catch {
                    // ignore
                }
            }
            return [];
        };

        const delimitedRegex = /<<<FOLLOWUPS>>>([\s\S]*?)(?:<<<END_FOLLOWUPS>>>|$)/i;
        const delimitedMatch = rawAnswer.match(delimitedRegex);

        if (delimitedMatch && delimitedMatch.index !== undefined) {
            cleanAnswer = rawAnswer.slice(0, delimitedMatch.index).trim();
            let rawBlock = (delimitedMatch[1] || '').trim();
            if (rawBlock.startsWith('```')) {
                rawBlock = rawBlock.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
            }
            try {
                const parsed = JSON.parse(rawBlock);
                if (Array.isArray(parsed)) {
                    followups = parsed
                        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0 && !isPlaceholder(item))
                        .map(item => item.trim())
                        .slice(0, 3);
                }
            } catch {
                followups = tryExtractJsonArray(rawBlock);
            }
        } else {
            const legacyRegex = /(?:^|\r?\n)\s*FOLLOWUPS:\s*([\s\S]*)$/i;
            const legacyMatch = rawAnswer.match(legacyRegex);
            if (legacyMatch && legacyMatch.index !== undefined) {
                cleanAnswer = rawAnswer.slice(0, legacyMatch.index).trim();
                const trailing = (legacyMatch[1] || '').trim();
                try {
                    const parsed = JSON.parse(trailing);
                    if (Array.isArray(parsed)) {
                        followups = parsed
                            .filter((item): item is string => typeof item === 'string' && item.trim().length > 0 && !isPlaceholder(item))
                            .map(item => item.trim())
                            .slice(0, 3);
                    }
                } catch {
                    followups = tryExtractJsonArray(trailing);
                }
            }
        }

        // Try extracting from any ```json block if not yet found
        if (followups.length === 0) {
            const jsonFenceRegex = /```[ \t]*json\b\s*([\s\S]*?)```/gi;
            let fenceMatch: RegExpExecArray | null;
            while ((fenceMatch = jsonFenceRegex.exec(rawAnswer)) !== null) {
                const candidates = tryExtractJsonArray(fenceMatch[1]);
                if (candidates.length > 0) {
                    followups = candidates;
                    break;
                }
            }
        }

        // Strip any "Follow-up questions:" / "FOLLOWUPS:" line and trailing question list from the rendered answer
        const followUpHeaderRegex = /(?:^|\r?\n)[ \t]*(?:#+\s*)?(?:follow-?ups?|follow-?up\s*questions?|suggested\s*questions?|recommended\s*questions?|next\s*questions?|followups)[ \t]*[:：]?[ \t]*([\s\S]*)$/i;
        const headerMatch = cleanAnswer.match(followUpHeaderRegex);
        if (headerMatch && headerMatch.index !== undefined) {
            const trailing = (headerMatch[1] || '').trim();
            cleanAnswer = cleanAnswer.slice(0, headerMatch.index).trim();

            if (followups.length === 0 && trailing) {
                const candidates = tryExtractJsonArray(trailing);
                if (candidates.length > 0) {
                    followups = candidates;
                } else {
                    const lines = trailing
                        .split(/\r?\n/)
                        .map(l => l.replace(/^[ \t]*(?:[-*•]|\d+[.)])[ \t]*/, '').trim())
                        .filter(l => l.length > 0 && !isPlaceholder(l));
                    if (lines.length > 0) {
                        followups = lines.slice(0, 3);
                    }
                }
            }
        }

        // Strip any ```json block, "`json`" text and the FOLLOWUPS marker from the rendered answer
        cleanAnswer = cleanAnswer
            .replace(/```[ \t]*json\b[\s\S]*?(?:```|$)/gi, '')
            .replace(/`json`/gi, '')
            .replace(/<<<FOLLOWUPS>>>[\s\S]*?(?:<<<END_FOLLOWUPS>>>|$)/gi, '')
            .replace(/<<<END_FOLLOWUPS>>>/gi, '')
            .replace(/(?:^|\r?\n)[ \t]*(?:#+\s*)?(?:follow-?ups?|follow-?up\s*questions?|followups)[ \t]*[:：]?[\s\S]*$/gim, '')
            .trim();

        return {
            cleanAnswer,
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

        const historyToSend = chatMessages
            .filter(m => !m.isThinking && m.content.trim().length > 0)
            .slice(-4)
            .map(m => ({
                role: m.role,
                content: m.role === 'assistant' && m.content.length > 600 ? m.content.slice(0, 600) : m.content
            }));

        let totalHistoryChars = historyToSend.reduce((acc, m) => acc + m.content.length, 0);
        while (totalHistoryChars > 4000 && historyToSend.length > 0) {
            const first = historyToSend[0];
            const excess = totalHistoryChars - 4000;
            if (first.content.length <= excess) {
                totalHistoryChars -= first.content.length;
                historyToSend.shift();
            } else {
                first.content = first.content.slice(excess);
                totalHistoryChars = 4000;
            }
        }

        const currentRisk = fileRisk || computeRisk(selectedFile, graph, commits);
        const connected = getConnectedFiles(graph, selectedFile);
        const currentDependents = (connectionsData?.dependents && connectionsData.dependents.length > 0)
            ? connectionsData.dependents
            : (connected.importedBy || []);

        let recentCommitsForFile: Array<{ sha: string; message: string; author: string; date: string }> = [];
        if (historyData && historyData.length > 0) {
            recentCommitsForFile = historyData.slice(0, 5).map((c: any) => ({
                sha: c.sha ? c.sha.substring(0, 7) : '',
                message: c.commit?.message?.split('\n')[0] || c.message || '',
                author: c.commit?.author?.name || c.author?.name || (typeof c.author === 'string' ? c.author : 'Author'),
                date: c.commit?.author?.date || c.date || ''
            }));
        } else {
            try {
                const cRes = await api.repositories.getCommits(repoUrl, selectedSha || undefined, selectedFile);
                if (cRes && Array.isArray(cRes.commits)) {
                    recentCommitsForFile = cRes.commits.slice(0, 5).map((c: any) => ({
                        sha: c.sha ? c.sha.substring(0, 7) : '',
                        message: c.commit?.message?.split('\n')[0] || c.message || '',
                        author: c.commit?.author?.name || c.author?.name || (typeof c.author === 'string' ? c.author : 'Author'),
                        date: c.commit?.author?.date || c.date || ''
                    }));
                }
            } catch {
                if (commits && commits.length > 0) {
                    recentCommitsForFile = commits
                        .filter((c: any) => c.files && c.files.some((f: any) => f.filename === selectedFile || f.path === selectedFile))
                        .slice(0, 5)
                        .map((c: any) => ({
                            sha: c.sha ? c.sha.substring(0, 7) : '',
                            message: c.commit?.message?.split('\n')[0] || c.message || '',
                            author: c.commit?.author?.name || c.author?.name || (typeof c.author === 'string' ? c.author : 'Author'),
                            date: c.commit?.author?.date || c.date || ''
                        }));
                }
            }
        }

        let fileOwners: any = null;
        try {
            const oRes = await api.repositories.getOwners(repoUrl, selectedFile, selectedSha || undefined);
            if (oRes && oRes.owners) {
                fileOwners = oRes;
            }
        } catch {
            // ignore
        }

        const extraContext = {
            risk: currentRisk,
            dependents: currentDependents,
            recentCommits: recentCommitsForFile,
            owners: fileOwners
        };

        let accumulatedStreamedText = '';

        try {
            const res = await api.ai.askStream(
                repoUrl,
                selectedSha,
                [selectedFile],
                target as any,
                q,
                historyToSend,
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
                controller.signal,
                extraContext
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
            setTimeout(() => {
                messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }, 50);
            setTimeout(() => {
                messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }, 180);
        }
    };

    const reanalyze = useCallback(async () => {
        if (!graph || !selectedFile) return;
        setAnalyzing(true);
        try {
            const target = selectedSymbol
                ? { type: 'symbol', path: selectedSymbol.path, symbol: selectedSymbol }
                : { type: 'file', path: selectedFile };
            const res = await api.graph.impact(graph, target as any, { maxDepth: 3, maxResults: 50 });
            setImpactResult(res);
        } catch (e) {
            console.error(e);
        } finally {
            setAnalyzing(false);
        }
    }, [graph, selectedFile, selectedSymbol]);

    useEffect(() => {
        if (activeTab === 'Impact' && graph && selectedFile) {
            reanalyze();
        }
    }, [activeTab, graph, selectedFile, selectedSymbol, reanalyze]);

    const fetchHistory = useCallback(async () => {
        if (!repoUrl || !selectedFile) return;
        setHistoryData(null);
        try {
            const res = await api.repositories.getCommits(repoUrl, selectedSha || undefined, selectedFile);
            const commitsList = res.commits || [];
            setHistoryData(commitsList);
            if (commitsList.length > 0) {
                setSelectedHistoryCommit(commitsList[0]);
            } else {
                setSelectedHistoryCommit(null);
            }
        } catch (e) {
            console.error(e);
            setHistoryData([]);
            setSelectedHistoryCommit(null);
        }
    }, [repoUrl, selectedSha, selectedFile, setSelectedHistoryCommit]);

    useEffect(() => {
        if (activeTab === 'History') fetchHistory();
    }, [activeTab, fetchHistory]);

    const directList = useMemo(() => {
        if (!selectedFile) return [];
        const map = new Map<string, { path: string; name: string; folder: string; score: number }>();
        if (impactResult?.directCallers) {
            for (const dc of impactResult.directCallers) {
                const rawPath = dc.symbol.path || (dc.symbol.type === 'file' ? dc.symbol.name : '');
                if (rawPath && rawPath !== selectedFile && !map.has(rawPath)) {
                    const fileName = rawPath.split('/').pop() || rawPath;
                    const folder = rawPath.includes('/') ? rawPath.substring(0, rawPath.lastIndexOf('/')) : '';
                    const score = computeRisk(rawPath, graph, commits).score;
                    map.set(rawPath, { path: rawPath, name: fileName, folder, score });
                }
            }
        }
        if (connectionsData?.importedBy) {
            for (const imp of connectionsData.importedBy) {
                const rawPath = typeof imp === 'string' ? imp : ((imp as any)?.path || (imp as any)?.name || (imp as any)?.id || '');
                if (rawPath && rawPath !== selectedFile && !map.has(rawPath)) {
                    const fileName = rawPath.split('/').pop() || rawPath;
                    const folder = rawPath.includes('/') ? rawPath.substring(0, rawPath.lastIndexOf('/')) : '';
                    const score = computeRisk(rawPath, graph, commits).score;
                    map.set(rawPath, { path: rawPath, name: fileName, folder, score });
                }
            }
        }
        return Array.from(map.values()).sort((a, b) => b.score - a.score);
    }, [impactResult, connectionsData, selectedFile, graph, commits]);

    const indirectList = useMemo(() => {
        if (!selectedFile) return [];
        const directPaths = new Set(directList.map(d => d.path));
        const map = new Map<string, { path: string; name: string; folder: string; score: number }>();
        if (impactResult?.transitiveConsumers) {
            for (const tc of impactResult.transitiveConsumers) {
                let rawPath = tc.symbol.path;
                if (!rawPath && graph?.nodes) {
                    const found = graph.nodes.find(n => n.id === tc.symbol.name || (n as any).name === tc.symbol.name);
                    if (found && (found as any).path) {
                        rawPath = (found as any).path;
                    }
                }
                if (!rawPath) rawPath = tc.symbol.name;
                if (rawPath && rawPath !== selectedFile && !directPaths.has(rawPath) && !map.has(rawPath)) {
                    const fileName = rawPath.split('/').pop() || rawPath;
                    const folder = rawPath.includes('/') ? rawPath.substring(0, rawPath.lastIndexOf('/')) : '';
                    const score = computeRisk(rawPath, graph, commits).score;
                    map.set(rawPath, { path: rawPath, name: fileName, folder, score });
                }
            }
        }
        if (impactResult?.paths) {
            for (const p of impactResult.paths) {
                if (p.nodes) {
                    for (const nodeId of p.nodes) {
                        const node = graph?.nodes.find(n => n.id === nodeId);
                        const rawPath = (node as any)?.path || (node?.type === 'file' ? node.id : null);
                        if (rawPath && rawPath !== selectedFile && !directPaths.has(rawPath) && !map.has(rawPath)) {
                            const fileName = rawPath.split('/').pop() || rawPath;
                            const folder = rawPath.includes('/') ? rawPath.substring(0, rawPath.lastIndexOf('/')) : '';
                            const score = computeRisk(rawPath, graph, commits).score;
                            map.set(rawPath, { path: rawPath, name: fileName, folder, score });
                        }
                    }
                }
            }
        }
        return Array.from(map.values()).sort((a, b) => b.score - a.score);
    }, [impactResult, directList, selectedFile, graph, commits]);

    const fetchConnections = useCallback(() => {
        // Automatically computed from graph and selectedFile
    }, []);

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
        if (activeTab === 'Health' || activeTab === 'Overview') fetchHealth();
    }, [activeTab, fetchHealth]);

    const repoDisplayName = useMemo(() => {
        if (meta?.fullName) return meta.fullName;
        if (meta?.name) return meta.name;
        if (repoUrl) {
            return repoUrl.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
        }
        return 'Repository';
    }, [meta, repoUrl]);

    const overviewMapData = useMemo(() => {
        if (!graph || !graph.nodes || graph.nodes.length === 0) return { nodes: [], edges: [] };
        const fileNodes = graph.nodes.filter(n => n.type === 'file');
        const selectedNodesMap = new Map<string, any>();
        for (const h of hotspotsList) {
            if (selectedNodesMap.size >= 40) break;
            const n = graph.nodes.find(node => node.id === h.id || (node as any).path === h.path);
            if (n) selectedNodesMap.set(n.id, n);
        }
        for (const fn of fileNodes) {
            if (selectedNodesMap.size >= 40) break;
            if (!selectedNodesMap.has(fn.id)) {
                selectedNodesMap.set(fn.id, fn);
            }
        }
        if (selectedNodesMap.size === 0) {
            for (const n of graph.nodes) {
                if (selectedNodesMap.size >= 40) break;
                selectedNodesMap.set(n.id, n);
            }
        }
        const nodesList = Array.from(selectedNodesMap.values());
        const nodeIds = new Set(nodesList.map(n => n.id));

        const count = nodesList.length;
        const positions: Record<string, { x: number; y: number }> = {};
        if (count === 1) {
            positions[nodesList[0].id] = { x: 200, y: 75 };
        } else {
            const width = 400;
            const height = 150;
            const cx = width / 2;
            const cy = height / 2;
            nodesList.forEach((node, i) => {
                const angle = i * 2.3999632;
                const radiusFrac = Math.sqrt((i + 1) / (count + 1));
                const rx = radiusFrac * (width * 0.42);
                const ry = radiusFrac * (height * 0.38);
                const x = Math.round(cx + rx * Math.cos(angle));
                const y = Math.round(cy + ry * Math.sin(angle));
                positions[node.id] = { x, y };
            });
        }

        const filteredEdges = graph.edges
            .filter(e => nodeIds.has(e.from) && nodeIds.has(e.to) && e.from !== e.to)
            .slice(0, 60);

        const riskySet = new Set(hotspotsList.slice(0, 7).map(h => h.id));

        return {
            nodes: nodesList.map(n => ({
                id: n.id,
                x: positions[n.id]?.x ?? 200,
                y: positions[n.id]?.y ?? 75,
                isRisky: riskySet.has(n.id)
            })),
            edges: filteredEdges.map(e => ({
                x1: positions[e.from]?.x ?? 200,
                y1: positions[e.from]?.y ?? 75,
                x2: positions[e.to]?.x ?? 200,
                y2: positions[e.to]?.y ?? 75
            }))
        };
    }, [graph, hotspotsList]);

    const drawerRisk = useMemo(() => {
        if (!drawerFile || !graph) return null;
        return computeRisk(drawerFile, graph, commits);
    }, [drawerFile, graph, commits]);

    const drawerImportedBy = useMemo(() => {
        if (!drawerFile || !graph) return [];
        const directSet = new Set<string>();
        const fileNode = graph.nodes.find((n: any) => n.type === 'file' && (n.path === drawerFile || n.id === drawerFile));
        const fileId = fileNode ? fileNode.id : drawerFile;
        for (const edge of graph.edges) {
            if (edge.to === fileId && (edge.type === 'imports' || edge.type === 'calls')) {
                const fromNode = graph.nodes.find((n: any) => n.id === edge.from);
                const p = (fromNode as any)?.path || (fromNode?.type === 'file' ? fromNode.id : null);
                if (p && p !== drawerFile) {
                    directSet.add(p);
                }
            }
        }
        return Array.from(directSet);
    }, [drawerFile, graph]);

    const drawerCommitInfo = useMemo(() => {
        if (!drawerFile || !commits || commits.length === 0) {
            return { countText: 'None recorded', author: '—' };
        }
        const touching = commits.filter((c: any) =>
            c.files && c.files.some((f: any) => f.filename === drawerFile || (f as any).path === drawerFile)
        );
        const count = touching.length;
        const authorCounts: Record<string, number> = {};
        for (const c of touching) {
            if (c.authorName) {
                authorCounts[c.authorName] = (authorCounts[c.authorName] || 0) + 1;
            }
        }
        let topAuthor = '—';
        let max = 0;
        for (const [author, cnt] of Object.entries(authorCounts)) {
            if (cnt > max) {
                max = cnt;
                topAuthor = author;
            }
        }
        return {
            countText: count > 0 ? `${count} commit${count === 1 ? '' : 's'}` : 'None recorded',
            author: topAuthor
        };
    }, [drawerFile, commits]);

    const isCode = selectedFile ? isCodeFile(selectedFile) : false;
    const isRepoLevelTab = activeTab === 'Overview' || activeTab === 'ChangeSet' || activeTab === 'Health';

    return (
        <div className={cn("flex flex-col bg-[#07090A] select-none h-full min-h-0", className)}>
            {/* Header / Breadcrumb & File-level Segmented Tabs (shown only when a file is selected and not in repo-level views) */}
            {!isRepoLevelTab && selectedFile && (
                <div className="p-3.5 border-b border-white/10 shrink-0 bg-[#07090A] z-10 space-y-3">
                    <div>
                        <div className="flex items-center gap-1.5 text-xs font-mono text-[#8A918C] mb-2 min-h-[16px]">
                            {selectedFile.split('/').map((part, i, arr) => (
                                <span key={i} className="flex items-center gap-1.5">
                                    <span className="hover:text-[#E8EAE6] cursor-pointer">{part}</span>
                                    {i < arr.length - 1 && <span className="opacity-40">/</span>}
                                </span>
                            ))}
                        </div>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-7 h-7 rounded-lg glass-surface border-white/10 flex items-center justify-center text-[#4FD1B5]">
                                    {isCode ? <FileCode size={14} /> : <FileText size={14} />}
                                </div>
                                <div>
                                    <h2 className="text-base font-semibold text-[#E8EAE6] font-mono tracking-tight">
                                        {selectedSymbol ? `${selectedSymbol.name}()` : selectedFile.split('/').pop()}
                                    </h2>
                                    <div className="flex gap-2 items-center mt-0.5">
                                        {selectedSymbol && <Badge variant="default">{selectedSymbol.type}</Badge>}
                                        <span className="text-[11px] text-[#8A918C] font-mono">{selectedFile}</span>
                                    </div>
                                </div>
                            </div>
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
                                    title={changeSet.includes(selectedFile) ? "Already in plan" : "Add to plan"}
                                >
                                    <Plus size={13} />
                                    <span>{changeSet.includes(selectedFile) ? "In plan" : "Add to plan"}</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Content */}
            <div className={cn("flex-1 p-4 overflow-y-auto scrollbar-custom text-[#E8EAE6] min-h-0", (activeTab === 'Overview' || activeTab === 'Graph' || activeTab === 'AskAI' || activeTab === 'Code' || activeTab === 'Impact' || activeTab === 'ChangeSet') && "flex flex-col")}>
                <ErrorBoundary key={activeTab} name={activeTab}>
                    {/* Overview Tab: Editorial Ledger layout & Drawer */}
                    {activeTab === 'Overview' && (
                        <div className="relative flex-1 min-h-0 -m-4 overflow-hidden flex flex-col">
                            {(!graph || stats.analyzedFiles === 0) ? (
                                <div className="h-full flex flex-col items-center justify-center text-center text-[#8A918C] py-24 gap-1.5">
                                    <div className="text-sm font-medium text-[#E8EAE6]">No files have been analyzed yet.</div>
                                    <div className="text-xs">Pick a file or re-analyze the repository to explore risk and dependencies.</div>
                                </div>
                            ) : (
                                <div
                                    className="flex-1 overflow-y-auto scrollbar-custom p-[30px_36px_34px] transition-[padding] duration-300"
                                    style={{
                                        paddingRight: drawerOpen ? 'calc(36px + 330px)' : '36px'
                                    }}
                                >
                                    <div className="text-xs font-mono text-[#8A918C] mb-2">{repoDisplayName}</div>

                                    {hotspotsList.length > 0 ? (
                                        <h1 className="text-[36px] leading-[1.08] tracking-[-0.03em] font-semibold my-2.5 max-w-[640px] text-[#E8EAE6]">
                                            {hotspotsList.length} {hotspotsList.length === 1 ? 'file carries' : 'files carry'} most of the risk. Start with{" "}
                                            <u style={{ textDecoration: 'none', boxShadow: 'inset 0 -.18em 0 rgba(227,160,74,.45)' }}>
                                                {hotspotsList[0].path ? hotspotsList[0].path.split('/').pop() : (hotspotsList[0].name ? hotspotsList[0].name.split('/').pop() : '')}
                                            </u>
                                            .
                                        </h1>
                                    ) : (
                                        <h1 className="text-[36px] leading-[1.08] tracking-[-0.03em] font-semibold my-2.5 max-w-[640px] text-[#E8EAE6]">
                                            No risky files found in the analyzed set.
                                        </h1>
                                    )}

                                    <p className="text-xs text-[#8A918C] max-w-[560px] mb-1">
                                        {stats.analyzedFiles} of {stats.totalFiles} files analyzed.
                                    </p>

                                    <div className="overview-st">
                                        <div>
                                            <b>{stats.analyzedFiles}</b>
                                            <span>files analyzed</span>
                                        </div>
                                        <div>
                                            <b>{stats.symbols}</b>
                                            <span>symbols mapped</span>
                                        </div>
                                        <div>
                                            <b>{stats.links}</b>
                                            <span>links between them</span>
                                        </div>
                                    </div>

                                    <div className="overview-two">
                                        <div>
                                            <h3 className="text-xs font-medium text-[#8A918C] mb-1.5">Where a change is riskiest</h3>
                                            {hotspotsList.length === 0 ? (
                                                <div className="text-xs text-[#8A918C] py-3">No risky files found in the analyzed set.</div>
                                            ) : (
                                                hotspotsList.map((h, i) => {
                                                    const rawFileName = h.name || (h.path ? h.path.split('/').pop() : 'unknown');
                                                    const hasDuplicate = (hotspotNameCounts.get(rawFileName) || 0) > 1;
                                                    let line1FileName = rawFileName;
                                                    let line2Folder = '';

                                                    if (h.path) {
                                                        const segments = h.path.split('/').filter(Boolean);
                                                        if (hasDuplicate && segments.length >= 2) {
                                                            line1FileName = segments.slice(-2).join('/');
                                                            line2Folder = segments.length > 2 ? segments.slice(0, -2).join('/') : '';
                                                        } else {
                                                            line1FileName = rawFileName;
                                                            line2Folder = segments.length > 1 ? segments.slice(0, -1).join('/') : '';
                                                        }
                                                    }

                                                    const reach = (h.risk?.directDependents || 0) + (h.risk?.transitiveDependents || 0);
                                                    const reasonText = (h.risk?.directDependents || 0) > 0
                                                        ? `Imported by ${h.risk.directDependents} file${h.risk.directDependents === 1 ? '' : 's'}, reaches ${reach}`
                                                        : (reach > 0 ? `Reaches ${reach} file${reach === 1 ? '' : 's'}` : `Isolated file`);
                                                    const isSelected = drawerOpen && drawerFile === h.path;

                                                    return (
                                                        <div
                                                            key={h.id || h.path || i}
                                                            onClick={() => handleOpenDrawer(h.path)}
                                                            className={cn("overview-rw", isSelected && "active")}
                                                        >
                                                            <span className="font-mono text-xs text-[#8A918C]">
                                                                {String(i + 1).padStart(2, '0')}
                                                            </span>
                                                            <div className="min-w-0 pr-2">
                                                                <div className="font-mono font-bold text-sm text-[#E8EAE6] break-words">
                                                                    {line1FileName}
                                                                </div>
                                                                <div className="text-xs text-[#8A918C] leading-relaxed break-words mt-0.5">
                                                                    {line2Folder ? `${line2Folder} · ${reasonText}` : reasonText}
                                                                </div>
                                                            </div>
                                                            <span className="overview-bar">
                                                                <i style={{ width: `${Math.min(100, Math.max(0, h.risk?.score || 0))}%` }} />
                                                            </span>
                                                            <b className="font-mono text-xs text-right font-medium text-[#E8EAE6]">
                                                                {Math.round(h.risk?.score || 0)}
                                                            </b>
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>

                                        <div>
                                            <h3 className="text-xs font-medium text-[#8A918C] mb-1.5">How to use this</h3>
                                            <div className="grid gap-0">
                                                <div className="overview-stp">
                                                    <i className="not-italic text-[26px] font-semibold text-[#4FD1B5] leading-none tracking-[-0.04em]">1</i>
                                                    <div>
                                                        <b className="block font-medium text-xs text-[#E8EAE6]">Pick a file</b>
                                                        <span className="text-xs text-[#8A918C]">Press Ctrl K or choose one from the list.</span>
                                                    </div>
                                                </div>
                                                <div className="overview-stp">
                                                    <i className="not-italic text-[26px] font-semibold text-[#4FD1B5] leading-none tracking-[-0.04em]">2</i>
                                                    <div>
                                                        <b className="block font-medium text-xs text-[#E8EAE6]">See what depends on it</b>
                                                        <span className="text-xs text-[#8A918C]">Impact shows every file a change can reach.</span>
                                                    </div>
                                                </div>
                                                <div className="overview-stp">
                                                    <i className="not-italic text-[26px] font-semibold text-[#4FD1B5] leading-none tracking-[-0.04em]">3</i>
                                                    <div>
                                                        <b className="block font-medium text-xs text-[#E8EAE6]">Ask why</b>
                                                        <span className="text-xs text-[#8A918C]">Ask AI answers with the files as proof.</span>
                                                    </div>
                                                </div>
                                            </div>

                                            <h3 className="text-xs font-medium text-[#8A918C] mt-[22px] mb-1.5">Repository map</h3>
                                            <svg className="w-full h-[150px] mt-1.5" viewBox="0 0 400 150" role="img">
                                                <title>Repository map</title>
                                                <g stroke="rgba(255,255,255,0.14)" strokeWidth="1">
                                                    {overviewMapData.edges.map((e, idx) => (
                                                        <line key={idx} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} />
                                                    ))}
                                                </g>
                                                {overviewMapData.nodes.map(n => (
                                                    <circle
                                                        key={n.id}
                                                        cx={n.x}
                                                        cy={n.y}
                                                        r={n.isRisky ? 5.5 : 3.5}
                                                        fill={n.isRisky ? "#E3A04A" : "#4FD1B5"}
                                                        opacity={n.isRisky ? 1 : 0.7}
                                                    />
                                                ))}
                                            </svg>

                                            <div className={cn("overview-hl", (healthData?.circularImports?.length || 0) > 0 && "w")}>
                                                <i />
                                                <span><b>{healthData?.circularImports?.length || 0}</b> circular imports</span>
                                            </div>
                                            <div className={cn("overview-hl", (healthData?.unusedFiles?.length || 0) > 0 && "w")}>
                                                <i />
                                                <span><b>{healthData?.unusedFiles?.length || 0}</b> files nothing imports</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Overview Drawer */}
                            <aside
                                className={cn("overview-drawer scrollbar-custom", drawerOpen && "open")}
                                aria-label="File risk details"
                            >
                                {drawerFile ? (
                                    <>
                                        <button
                                            onClick={() => setDrawerOpen(false)}
                                            className="absolute right-3.5 top-3.5 text-xs text-[#E8EAE6] hover:border-[#8A918C] border border-white/10 rounded-lg px-2.5 py-1 bg-transparent cursor-pointer transition-colors"
                                        >
                                            Close
                                        </button>
                                        <h4 className="font-mono text-[17px] font-semibold text-[#E8EAE6] break-all pr-14">
                                            {drawerFile.split('/').pop() || drawerFile}
                                        </h4>
                                        <div className="font-mono text-xs text-[#8A918C] mt-0.5 mb-3.5 break-all">
                                            {drawerFile}
                                        </div>
                                        <div className="text-[44px] font-semibold tracking-[-0.05em] leading-none text-[#E3A04A]">
                                            {drawerRisk ? Math.round(drawerRisk.score) : 0}
                                            <small className="text-sm font-normal text-[#8A918C] tracking-normal ml-1"> / 100 risk</small>
                                        </div>
                                        <p className="text-xs text-[#8A918C] my-3">
                                            {drawerRisk && drawerRisk.directDependents > 0
                                                ? `Imported by ${drawerRisk.directDependents} file${drawerRisk.directDependents === 1 ? '' : 's'}, reaches ${drawerRisk.directDependents + drawerRisk.transitiveDependents}.`
                                                : (drawerRisk && (drawerRisk.directDependents + drawerRisk.transitiveDependents) > 0
                                                    ? `Reaches ${drawerRisk.transitiveDependents} file${drawerRisk.transitiveDependents === 1 ? '' : 's'}.`
                                                    : 'Isolated file with no dependents.')}
                                        </p>

                                        <h3 className="text-xs font-medium text-[#8A918C] mb-1.5">Imported by</h3>
                                        <div className="space-y-0 max-h-48 overflow-y-auto scrollbar-custom border-t border-white/[0.08]">
                                            {drawerImportedBy.length === 0 ? (
                                                <div className="py-2 text-xs text-[#8A918C]">No importing files</div>
                                            ) : (
                                                drawerImportedBy.map((imp, idx) => (
                                                    <div key={idx} className="flex justify-between py-1.5 border-b border-white/[0.08] text-xs text-[#8A918C]">
                                                        <span className="font-mono text-[#E8EAE6] truncate" title={imp}>
                                                            {imp.split('/').pop()}
                                                        </span>
                                                    </div>
                                                ))
                                            )}
                                        </div>

                                        {drawerCommitInfo.author && drawerCommitInfo.author !== '—' && (
                                            <div className="flex justify-between py-2 border-b border-white/[0.08] text-xs text-[#8A918C] mt-3">
                                                <span>Main author</span>
                                                <b className="font-medium text-[#E8EAE6]">{drawerCommitInfo.author}</b>
                                            </div>
                                        )}
                                        {drawerCommitInfo.countText && drawerCommitInfo.countText !== 'None recorded' && (
                                            <div className="flex justify-between py-2 border-b border-white/[0.08] text-xs text-[#8A918C]">
                                                <span>History</span>
                                                <b className="font-medium text-[#E8EAE6]">{drawerCommitInfo.countText}</b>
                                            </div>
                                        )}

                                        <div className="flex gap-2 mt-4">
                                            <button
                                                onClick={() => {
                                                    selectFile(drawerFile);
                                                    setActiveTab('Impact');
                                                }}
                                                className="text-xs font-medium px-3.5 py-1.5 rounded-lg bg-[#4FD1B5] text-[#04100D] hover:brightness-110 cursor-pointer transition-all"
                                            >
                                                Open impact
                                            </button>
                                            <button
                                                onClick={() => {
                                                    selectFile(drawerFile);
                                                    setActiveTab('AskAI');
                                                }}
                                                className="text-xs border border-white/10 text-[#E8EAE6] hover:border-[#8A918C] rounded-lg px-3 py-1.5 bg-transparent cursor-pointer transition-colors"
                                            >
                                                Ask AI
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    <div className="h-full flex flex-col items-center justify-center text-center text-[#8A918C] text-xs gap-1.5">
                                        <b className="text-[#E8EAE6] font-medium">No file selected</b>
                                        <span>Choose a file from the list to see what a change would touch.</span>
                                    </div>
                                )}
                            </aside>
                        </div>
                    )}

                    {/* Dedicated Graph Tab: full-height canvas, fit-to-view on load */}
                    {activeTab === 'Graph' && (
                        <div className="w-full h-full min-h-[500px] flex-1 rounded-xl overflow-hidden border border-white/10 relative">
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
                        !selectedFile ? (
                            <div className="glass-surface p-12 rounded-xl border-white/10 text-center flex flex-col items-center justify-center gap-2 flex-1">
                                <Activity size={24} className="text-[#8A918C]/40 mb-1" />
                                <div className="text-xs text-[#8A918C]">Select a file from the sidebar to calculate its blast radius and impact.</div>
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col space-y-4 min-h-0">
                                <ComponentToolbar
                                    title={
                                        <span>
                                            Impact: <span className="font-mono text-[#4FD1B5] font-normal">{selectedSymbol?.name || selectedFile.split('/').pop()}</span>
                                        </span>
                                    }
                                    onDownloadReport={handleDownloadReport}
                                    onCopyPRComment={handleCopyReport}
                                    onReanalyze={reanalyze}
                                    reanalyzeLabel="Refresh"
                                    onExport={() => downloadTextFile('impact-result.json', JSON.stringify(impactResult, null, 2), 'application/json')}
                                />

                            {analyzing ? (
                                <div className="flex-1 text-[#8A918C] py-20 flex flex-col items-center justify-center gap-3">
                                    <Loader2 size={24} className="animate-spin text-[#4FD1B5]" />
                                    <span className="text-xs font-mono">Calculating impact paths...</span>
                                </div>
                            ) : (
                                <div className="flex-1 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4 min-h-[460px]">
                                    {/* Concentric blast-radius rings SVG */}
                                    <div className="glass-surface p-4 rounded-xl border-white/10 flex flex-col items-center justify-center relative overflow-hidden h-full min-h-0">
                                        <svg viewBox="0 0 440 440" preserveAspectRatio="xMidYMid meet" className="w-full max-w-[420px] h-auto max-h-[380px]" role="img">
                                            <title>Blast radius rings</title>
                                            {/* Ring 1 guide */}
                                            <circle
                                                cx="220"
                                                cy="220"
                                                r="80"
                                                fill="none"
                                                stroke="rgba(255, 255, 255, 0.08)"
                                                strokeDasharray="3 5"
                                            />
                                            <text x="220" y={220 - 80 - 4} fontSize="8.5" fill="#8A918C" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace">
                                                Ring 1 · Direct
                                            </text>

                                            {/* Ring 2 guide */}
                                            <circle
                                                cx="220"
                                                cy="220"
                                                r="160"
                                                fill="none"
                                                stroke="rgba(255, 255, 255, 0.08)"
                                                strokeDasharray="3 5"
                                            />
                                            <text x="220" y={220 - 160 - 4} fontSize="8.5" fill="#8A918C" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace">
                                                Ring 2 · Indirect
                                            </text>

                                            {/* Center Target Node */}
                                            <circle cx="220" cy="220" r="10" fill="#E8EAE6" />
                                            <text
                                                x="220"
                                                y="246"
                                                fontSize="11"
                                                fill="#E8EAE6"
                                                textAnchor="middle"
                                                fontFamily="'IBM Plex Mono', monospace"
                                            >
                                                {selectedSymbol?.name || (selectedFile ? selectedFile.split('/').pop() : 'target')}
                                            </text>

                                            {/* Ring 1 nodes: max 12 nodes per ring plus "+N more" */}
                                            {(() => {
                                                const maxNodes = 12;
                                                const visible = directList.slice(0, maxNodes);
                                                const remaining = directList.length - maxNodes;
                                                const totalSlots = visible.length + (remaining > 0 ? 1 : 0);
                                                return (
                                                    <>
                                                        {visible.map((node, i) => {
                                                            const angle = (i / Math.max(1, totalSlots)) * 2 * Math.PI - Math.PI / 2;
                                                            const px = 220 + Math.cos(angle) * 80;
                                                            const py = 220 + Math.sin(angle) * 80;
                                                            const shortName = node.name.length > 10 ? node.name.slice(0, 8) + '…' : node.name;
                                                            return (
                                                                <g key={`direct-${node.path}-${i}`} onClick={() => selectFile(node.path)} className="cursor-pointer group">
                                                                    <line x1="220" y1="220" x2={px} y2={py} stroke="#E3A04A" strokeOpacity="0.25" strokeWidth="1" />
                                                                    <circle cx={px} cy={py} r="5" fill="#E3A04A" />
                                                                    <text x={px} y={py + 13} fontSize="9" fill="#E8EAE6" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace">
                                                                        {shortName}
                                                                    </text>
                                                                </g>
                                                            );
                                                        })}
                                                        {remaining > 0 && (() => {
                                                            const angle = (visible.length / totalSlots) * 2 * Math.PI - Math.PI / 2;
                                                            const px = 220 + Math.cos(angle) * 80;
                                                            const py = 220 + Math.sin(angle) * 80;
                                                            return (
                                                                <g key="direct-more">
                                                                    <line x1="220" y1="220" x2={px} y2={py} stroke="#E3A04A" strokeOpacity="0.25" strokeWidth="1" strokeDasharray="2 2" />
                                                                    <rect x={px - 20} y={py - 7} width="40" height="14" rx="7" fill="#1C2122" stroke="#E3A04A" strokeWidth="0.8" />
                                                                    <text x={px} y={py + 3.5} fontSize="8" fill="#E3A04A" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace">
                                                                        +{remaining} more
                                                                    </text>
                                                                </g>
                                                            );
                                                        })()}
                                                    </>
                                                );
                                            })()}

                                            {/* Ring 2 nodes: max 12 nodes per ring plus "+N more" */}
                                            {(() => {
                                                const maxNodes = 12;
                                                const visible = indirectList.slice(0, maxNodes);
                                                const remaining = indirectList.length - maxNodes;
                                                const totalSlots = visible.length + (remaining > 0 ? 1 : 0);
                                                return (
                                                    <>
                                                        {visible.map((node, i) => {
                                                            const angle = (i / Math.max(1, totalSlots)) * 2 * Math.PI - Math.PI / 2 + 0.25;
                                                            const px = 220 + Math.cos(angle) * 160;
                                                            const py = 220 + Math.sin(angle) * 160;
                                                            const shortName = node.name.length > 10 ? node.name.slice(0, 8) + '…' : node.name;
                                                            return (
                                                                <g key={`indirect-${node.path}-${i}`} onClick={() => selectFile(node.path)} className="cursor-pointer group">
                                                                    <line x1="220" y1="220" x2={px} y2={py} stroke="#4FD1B5" strokeOpacity="0.2" strokeWidth="1" />
                                                                    <circle cx={px} cy={py} r="4" fill="#4FD1B5" />
                                                                    <text x={px} y={py + 12} fontSize="8.5" fill="#8A918C" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace">
                                                                        {shortName}
                                                                    </text>
                                                                </g>
                                                            );
                                                        })}
                                                        {remaining > 0 && (() => {
                                                            const angle = (visible.length / totalSlots) * 2 * Math.PI - Math.PI / 2 + 0.25;
                                                            const px = 220 + Math.cos(angle) * 160;
                                                            const py = 220 + Math.sin(angle) * 160;
                                                            return (
                                                                <g key="indirect-more">
                                                                    <line x1="220" y1="220" x2={px} y2={py} stroke="#4FD1B5" strokeOpacity="0.2" strokeWidth="1" strokeDasharray="2 2" />
                                                                    <rect x={px - 20} y={py - 7} width="40" height="14" rx="7" fill="#15302A" stroke="#4FD1B5" strokeWidth="0.8" />
                                                                    <text x={px} y={py + 3.5} fontSize="8" fill="#4FD1B5" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace">
                                                                        +{remaining} more
                                                                    </text>
                                                                </g>
                                                            );
                                                        })()}
                                                    </>
                                                );
                                            })()}
                                        </svg>
                                    </div>

                                    {/* Direct (N) and Indirect (M) Lists */}
                                    <div className="glass-surface p-4 rounded-xl border-white/10 flex flex-col justify-between h-full min-h-0 overflow-hidden">
                                        <div className="flex-1 flex flex-col min-h-0">
                                            <div className="flex items-center justify-between mb-3 pb-2.5 border-b border-white/[0.06] shrink-0">
                                                <div>
                                                    <span className="text-[11px] font-semibold text-[#8A918C]">Risk score</span>
                                                    <div className="flex items-baseline gap-1.5 mt-0.5">
                                                        <span className="text-2xl font-bold font-mono text-[#E8EAE6]">
                                                            {fileRisk ? fileRisk.score : (impactResult?.score ?? 0)}
                                                        </span>
                                                        <span className="text-xs font-mono text-[#8A918C]">/ 100</span>
                                                    </div>
                                                </div>
                                                <div className="w-24 h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                                                    <div
                                                        className={cn("h-full rounded-full", (fileRisk?.score ?? 0) > 60 ? "bg-red-400" : (fileRisk?.score ?? 0) > 30 ? "bg-[#E3A04A]" : "bg-[#4FD1B5]")}
                                                        style={{ width: `${Math.min(100, Math.max(5, fileRisk ? fileRisk.score : 0))}%` }}
                                                    />
                                                </div>
                                            </div>

                                            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-custom pr-1 space-y-4">
                                                {/* Direct List */}
                                                <div>
                                                    <h4 className="text-xs font-semibold text-[#8A918C] mb-2 sticky top-0 bg-[#07090A]/90 backdrop-blur-sm py-1 z-10 flex items-center justify-between">
                                                        <span>Direct ({directList.length})</span>
                                                    </h4>
                                                    <div className="space-y-1.5">
                                                        {directList.length === 0 ? (
                                                            <div className="text-xs text-[#8A918C] py-2">No direct dependents found.</div>
                                                        ) : (
                                                            directList.map((item, i) => (
                                                                <div
                                                                    key={`direct-item-${item.path}-${i}`}
                                                                    onClick={() => selectFile(item.path)}
                                                                    className="flex items-center justify-between p-2 rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/15 transition-colors cursor-pointer group text-xs"
                                                                >
                                                                    <div className="min-w-0 flex-1 mr-2">
                                                                        <span className="font-mono text-[#E8EAE6] group-hover:text-[#4FD1B5] truncate block">
                                                                            {item.name}
                                                                        </span>
                                                                        {item.folder && (
                                                                            <span className="text-[11px] text-[#8A918C] truncate block">
                                                                                {item.folder}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <div className="flex items-center gap-2 shrink-0">
                                                                        <div className="w-12 h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                                                                            <div
                                                                                className={cn("h-full rounded-full", item.score > 60 ? "bg-red-400" : item.score > 30 ? "bg-[#E3A04A]" : "bg-[#4FD1B5]")}
                                                                                style={{ width: `${item.score}%` }}
                                                                            />
                                                                        </div>
                                                                        <span className="font-mono text-[11px] text-[#8A918C] w-5 text-right">{item.score}</span>
                                                                    </div>
                                                                </div>
                                                            ))
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Indirect List */}
                                                <div>
                                                    <h4 className="text-xs font-semibold text-[#8A918C] mb-2 sticky top-0 bg-[#07090A]/90 backdrop-blur-sm py-1 z-10 flex items-center justify-between">
                                                        <span>Indirect ({indirectList.length})</span>
                                                    </h4>
                                                    <div className="space-y-1.5">
                                                        {indirectList.length === 0 ? (
                                                            <div className="text-xs text-[#8A918C] py-2">No indirect dependents found.</div>
                                                        ) : (
                                                            indirectList.map((item, i) => (
                                                                <div
                                                                    key={`indirect-item-${item.path}-${i}`}
                                                                    onClick={() => selectFile(item.path)}
                                                                    className="flex items-center justify-between p-2 rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/15 transition-colors cursor-pointer group text-xs"
                                                                >
                                                                    <div className="min-w-0 flex-1 mr-2">
                                                                        <span className="font-mono text-[#E8EAE6] group-hover:text-[#4FD1B5] truncate block">
                                                                            {item.name}
                                                                        </span>
                                                                        {item.folder && (
                                                                            <span className="text-[11px] text-[#8A918C] truncate block">
                                                                                {item.folder}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <div className="flex items-center gap-2 shrink-0">
                                                                        <div className="w-12 h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                                                                            <div
                                                                                className={cn("h-full rounded-full", item.score > 60 ? "bg-red-400" : item.score > 30 ? "bg-[#E3A04A]" : "bg-[#4FD1B5]")}
                                                                                style={{ width: `${item.score}%` }}
                                                                            />
                                                                        </div>
                                                                        <span className="font-mono text-[11px] text-[#8A918C] w-5 text-right">{item.score}</span>
                                                                    </div>
                                                                </div>
                                                            ))
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="pt-3 border-t border-white/[0.08] mt-3">
                                            <button
                                                onClick={() => setShowImpactReasons(!showImpactReasons)}
                                                className="flex items-center justify-between w-full py-1 text-[11px] text-[#8A918C] hover:text-[#E8EAE6] transition-colors cursor-pointer"
                                                title="Formula: min(100, 4*directDependents + 2*transitiveDependents + 0.25*churnPercent + (hasNoTests ? 10 : 0))"
                                            >
                                                <span className="font-medium flex items-center gap-1.5">
                                                    Why this score
                                                    <span
                                                        className="text-[10px] text-[#8A918C] px-1 rounded border border-white/10 cursor-help"
                                                        title="Formula: min(100, 4*directDependents + 2*transitiveDependents + 0.25*churnPercent + (hasNoTests ? 10 : 0))"
                                                    >
                                                        ?
                                                    </span>
                                                </span>
                                                {showImpactReasons ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                            </button>
                                            {showImpactReasons && (
                                                <div className="space-y-1.5 mt-2">
                                                    <div
                                                        className="text-[10px] font-mono text-[#8A918C] px-2 py-1 bg-white/[0.02] border border-white/[0.06] rounded truncate"
                                                        title="score = min(100, 4*directDependents + 2*transitiveDependents + 0.25*churnPercent + (hasNoTests ? 10 : 0))"
                                                    >
                                                        score = min(100, 4×direct + 2×transitive + 0.25×churn% + tests)
                                                    </div>
                                                    {(fileRisk ? fileRisk.reasons : (impactResult?.reasons || [])).map((r, i) => (
                                                        <div key={i} className="glass-surface p-2 rounded-lg border-white/[0.06] text-xs flex items-center justify-between">
                                                            <span className="text-[#8A918C] text-[11px]">{r.label}</span>
                                                            <span className="text-[#E8EAE6] font-mono text-[11px]">{r.value}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        {/* Tests to run */}
                                        <div className="pt-3 border-t border-white/[0.08] mt-3">
                                            <div className="text-[11px] text-[#8A918C] mb-2 font-medium">Tests to run</div>
                                            {(() => {
                                                const tests = (impactResult?.tests || [])
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

                                        <div className="text-[11px] text-[#8A918C] pt-3 border-t border-white/[0.08] mt-3" title="score = min(100, 4*directDependents + 2*transitiveDependents + 0.25*churnPercent + (hasNoTests ? 10 : 0))">
                                            Formula: min(100, 4×direct + 2×transitive + 0.25×churn% + tests)
                                        </div>
                                    </div>
                                </div>
                            )}
                            </div>
                        )
                    )}

                    {activeTab === 'AskAI' && (
                        !selectedFile ? (
                            <div className="glass-surface p-12 rounded-xl border-white/10 text-center flex flex-col items-center justify-center gap-2 flex-1">
                                <MessageSquare size={24} className="text-[#8A918C]/40 mb-1" />
                                <div className="text-xs text-[#8A918C]">Select a file from the sidebar to ask questions about it.</div>
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col min-h-0 glass-surface border-white/10 rounded-xl overflow-hidden">
                                <div className="p-3 bg-white/[0.02] border-b border-white/10 shrink-0">
                                    <ComponentToolbar
                                        title={
                                            <div className="flex items-center gap-2 font-mono">
                                                <FileCode size={13} className="text-[#4FD1B5]" />
                                                <span className="text-[#E8EAE6] truncate max-w-[280px]">
                                                    {selectedSymbol?.name ? `${selectedSymbol.name}()` : selectedFile.split('/').pop()}
                                                </span>
                                            </div>
                                        }
                                        primaryAction={
                                            <button
                                                onClick={handleNewChat}
                                                className="px-2.5 py-1 rounded-md text-[11px] font-medium text-[#8A918C] hover:text-[#E8EAE6] hover:bg-white/[0.04] transition-colors cursor-pointer flex items-center gap-1 border border-white/10"
                                                title="Clear conversation"
                                            >
                                                <Plus size={12} />
                                                <span>New chat</span>
                                            </button>
                                        }
                                        onDownloadReport={handleDownloadChatReport}
                                        onCopyPRComment={handleCopyChatPRComment}
                                        onExport={() => downloadTextFile('chat-history.json', JSON.stringify(chatMessages, null, 2), 'application/json')}
                                    />
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
                                                            <MarkdownRenderer content={cleanAnswerMarkers(msg.content)} />

                                                            {/* Evidence chips: only real repo references */}
                                                            {(() => {
                                                                const citations = extractValidEvidence(msg.content, analyzedPaths);
                                                                if (citations.length === 0) return null;
                                                                return (
                                                                    <div className="pt-2 border-t border-white/[0.06] flex items-center gap-1.5 flex-wrap">
                                                                        <span className="text-[10px] text-[#8A918C]">Evidence:</span>
                                                                        {citations.map((c, cIdx) => {
                                                                            const lastColon = c.lastIndexOf(':');
                                                                            const hasColon = lastColon !== -1;
                                                                            const linePart = hasColon ? c.substring(lastColon + 1) : '';
                                                                            const hasLine = /^\d+(?:-\d+)?$/.test(linePart);
                                                                            const filePath = hasLine ? c.substring(0, lastColon) : c;
                                                                            const lineRange = hasLine ? linePart : '';
                                                                            const fileName = filePath.split('/').pop() || filePath;
                                                                            const label = lineRange ? `${fileName}:${lineRange}` : fileName;
                                                                            const startLine = lineRange ? parseInt(lineRange.split('-')[0], 10) : NaN;

                                                                            return (
                                                                                <button
                                                                                    key={cIdx}
                                                                                    onClick={() => {
                                                                                        if (filePath) setSelectedFile(filePath);
                                                                                        if (!isNaN(startLine)) setCodeHighlightLine(startLine);
                                                                                        setActiveTab('Code');
                                                                                    }}
                                                                                    className="font-mono text-[10px] px-2 py-0.5 rounded-md border border-white/10 bg-white/[0.03] text-[#4FD1B5] hover:bg-[#4FD1B5]/10 hover:border-[#4FD1B5]/30 cursor-pointer transition-colors"
                                                                                    title={"Open " + c + " in Code viewer"}
                                                                                >
                                                                                    {label}
                                                                                </button>
                                                                            );
                                                                        })}
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
                                {(() => {
                                    const userMessages = chatMessages.filter(m => m.role === 'user');
                                    const lastUserText = userMessages.length > 0 ? userMessages[userMessages.length - 1].content : askQ;
                                    const isHinglish = /\b(kya|kaise|kaisa|kyu|kyun|kaun|kab|kahan|hai|hain|ho|hoga|kare|karo|kar|krta|krna|karta|karna|ye|yeh|yaha|wo|woh|ka|ki|ke|ko|me|mein|se|par|pe|nahi|nhi|aur|ya|batao|samjhao|dikhao|bhai|tha|thi|iska|iski|iske|unka|unki|unke|kuch|kuchh|kaunsa|kaunsi|kaha|apna|apni|apne|bhi|isko|tum|aap)\b/i.test(lastUserText);

                                    const suggestions = isHinglish
                                        ? (selectedFile
                                            ? ['Is file ko samjhao', 'Isko kaun call karta hai?', 'Changes ka summary do']
                                            : ['Kaunsi files sabse risky hain?', 'Repo ka structure kaisa hai?', 'Kahan se padhna shuru karein?'])
                                        : (selectedFile
                                            ? ['Explain this file', 'Who calls this?', 'Summarize changes']
                                            : ['Which files are riskiest?', 'How is this repo structured?', 'Where should I start reading?']);

                                    return suggestions.map((suggestion, sIdx) => (
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
                                    ));
                                })()}
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
                        )
                    )}

                    {activeTab === 'History' && (
                        !selectedFile ? (
                            <div className="glass-surface p-12 rounded-xl border-white/10 text-center flex flex-col items-center justify-center gap-2 flex-1">
                                <Clock size={24} className="text-[#8A918C]/40 mb-1" />
                                <div className="text-xs text-[#8A918C]">Select a file from the sidebar to inspect its commit timeline.</div>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <ComponentToolbar
                                    title="Commit history"
                                    subtitle={
                                        <span>
                                            Showing changes for <span className="font-mono text-[#E8EAE6]">{selectedFile?.split('/').pop() || 'current selection'}</span>. Switch commits in sidebar to inspect history.
                                        </span>
                                    }
                                    badge={
                                        <span className="font-mono text-[11px] px-2 py-0.5 rounded-full border border-white/10 text-[#4FD1B5] bg-[#4FD1B5]/10">
                                            {selectedSha?.substring(0, 7) || 'HEAD'}
                                        </span>
                                    }
                                    primaryAction={
                                        <Button onClick={fetchHistory} className="px-3 py-1 text-xs shrink-0 whitespace-nowrap" disabled={!historyData}>
                                            Re-fetch
                                        </Button>
                                    }
                                    onDownloadReport={handleDownloadHistoryReport}
                                    onCopyPRComment={handleCopyHistoryPRComment}
                                    onReanalyze={fetchHistory}
                                    onExport={() => downloadTextFile('commit-history.json', JSON.stringify(historyData || [], null, 2), 'application/json')}
                                />

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
                                            No commits found for this file. Try inspecting another file from the sidebar.
                                        </div>
                                    </div>
                                ) : (
                                    <div className="relative pl-6 space-y-3 before:content-[''] before:absolute before:left-2 before:top-3 before:bottom-3 before:w-[1px] before:bg-white/10">
                                        {historyData.map((commit: any, i) => {
                                            const commitFiles = (commit.files || []).map((f: any) => f.filename || f.path || f);
                                            const isHotspot = Boolean(
                                                commitFiles.some((cf: string) => hotspotPaths.has(cf)) ||
                                                (selectedFile && hotspotPaths.has(selectedFile)) ||
                                                (commit.changes && commit.changes > 50) ||
                                                (commit.files && commit.files.some((f: any) => (f.changes || 0) > 40 || (f.additions || 0) + (f.deletions || 0) > 40))
                                            );
                                            const isSelected = selectedHistoryCommit?.sha === commit.sha;

                                            return (
                                                <div
                                                    key={commit.sha || i}
                                                    onClick={() => setSelectedHistoryCommit(commit)}
                                                    className={cn(
                                                        "relative glass-surface p-3.5 rounded-xl border transition-colors cursor-pointer text-xs",
                                                        isSelected ? "border-[#4FD1B5] bg-white/[0.04]" : "border-white/10 hover:border-white/20 hover:bg-white/[0.02]"
                                                    )}
                                                >
                                                    {/* Dot on hairline connector line: amber for hotspots, accent for standard */}
                                                    <span
                                                        className={cn(
                                                            "absolute -left-[22px] top-4 w-2.5 h-2.5 rounded-full border-2 bg-[#07090A]",
                                                            isHotspot ? "border-[#E3A04A]" : "border-[#4FD1B5]"
                                                        )}
                                                        title={isHotspot ? "Touched hotspot file" : "Commit"}
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
                        )
                    )}

                    {activeTab === 'Health' && (
                        <div className="space-y-4">
                            <ComponentToolbar
                                title="Repository health"
                                subtitle="Architectural smells and dependency diagnostics computed from the repository graph."
                                badge={
                                    stats.analyzedFiles < stats.totalFiles ? (
                                        <span className="text-[11px] font-mono px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400">
                                            Based on {stats.analyzedFiles} of {stats.totalFiles} files
                                        </span>
                                    ) : undefined
                                }
                                primaryAction={
                                    <Button onClick={fetchHealth} className="px-3 py-1 text-xs shrink-0 whitespace-nowrap" disabled={healthLoading || !graph}>
                                        {healthLoading ? <Loader2 size={12} className="animate-spin" /> : 'Re-check'}
                                    </Button>
                                }
                                onDownloadReport={handleDownloadHealthReport}
                                onCopyPRComment={handleCopyHealthPRComment}
                                onReanalyze={fetchHealth}
                                onExport={() => downloadTextFile('repository-health.json', JSON.stringify(healthData || {}, null, 2), 'application/json')}
                            />

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
                                                    {healthData.circularImports?.length || 0}
                                                </span>
                                            </div>
                                            {openHealthSections.circular ? <ChevronUp size={14} className="text-[#8A918C]" /> : <ChevronDown size={14} className="text-[#8A918C]" />}
                                        </button>

                                        {openHealthSections.circular && (
                                            <div className="pt-2 border-t border-white/[0.06] space-y-2">
                                                {(!healthData.circularImports || healthData.circularImports.length === 0) ? (
                                                    <div className="text-xs text-[#8A918C] py-1">None found</div>
                                                ) : (
                                                    <div className="space-y-2 max-h-60 overflow-y-auto scrollbar-custom pr-1">
                                                        {(healthData.circularImports || []).map((cycle, i) => (
                                                            <div key={i} className="p-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] text-xs space-y-1.5">
                                                                <div className="text-[10px] text-[#8A918C] font-mono">Cycle #{i + 1} ({cycle?.length || 0} files)</div>
                                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                                    {(cycle || []).map((filePath, fIdx) => (
                                                                        <div key={fIdx} className="inline-flex items-center gap-1.5">
                                                                            <button
                                                                                onClick={() => filePath && selectFile(filePath)}
                                                                                className="font-mono text-xs text-[#E8EAE6] hover:text-[#4FD1B5] transition-colors cursor-pointer underline-offset-2 hover:underline"
                                                                                title={filePath}
                                                                            >
                                                                                {filePath ? filePath.split('/').pop() : ''}
                                                                            </button>
                                                                            {fIdx < (cycle?.length || 0) - 1 && (
                                                                                <span className="text-[#8A918C]/60 text-[10px] font-mono">→</span>
                                                                            )}
                                                                        </div>
                                                                    ))}
                                                                    {cycle && cycle.length > 0 && cycle[0] && (
                                                                        <>
                                                                            <span className="text-[#8A918C]/60 text-[10px] font-mono">→</span>
                                                                            <button
                                                                                onClick={() => selectFile(cycle[0])}
                                                                                className="font-mono text-xs text-[#8A918C] hover:text-[#4FD1B5] transition-colors cursor-pointer"
                                                                                title={cycle[0]}
                                                                            >
                                                                                {cycle[0].split('/').pop()}
                                                                            </button>
                                                                        </>
                                                                    )}
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
                                                    {healthData.unusedFiles?.length || 0}
                                                </span>
                                            </div>
                                            {openHealthSections.unused ? <ChevronUp size={14} className="text-[#8A918C]" /> : <ChevronDown size={14} className="text-[#8A918C]" />}
                                        </button>
                                        <p className="text-[11px] text-[#8A918C]">Entry and config files are excluded</p>

                                        {openHealthSections.unused && (
                                            <div className="pt-2 border-t border-white/[0.06] space-y-2">
                                                {(!healthData.unusedFiles || healthData.unusedFiles.length === 0) ? (
                                                    <div className="text-xs text-[#8A918C] py-1">None found</div>
                                                ) : (
                                                    <div className="space-y-1.5 max-h-60 overflow-y-auto scrollbar-custom pr-1">
                                                        {(healthData.unusedFiles || []).map((filePath, i) => (
                                                            <div key={i} className="flex items-center justify-between p-2 rounded-lg border border-white/[0.06] bg-white/[0.02] text-xs">
                                                                <button
                                                                    onClick={() => filePath && selectFile(filePath)}
                                                                    className="font-mono text-[#E8EAE6] hover:text-[#4FD1B5] transition-colors cursor-pointer truncate text-left"
                                                                    title={filePath}
                                                                >
                                                                    {filePath ? filePath.split('/').pop() : ''}
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
                                                    {healthData.godFiles?.length || 0}
                                                </span>
                                            </div>
                                            {openHealthSections.god ? <ChevronUp size={14} className="text-[#8A918C]" /> : <ChevronDown size={14} className="text-[#8A918C]" />}
                                        </button>

                                        {openHealthSections.god && (
                                            <div className="pt-2 border-t border-white/[0.06] space-y-2">
                                                {(!healthData.godFiles || healthData.godFiles.length === 0) ? (
                                                    <div className="text-xs text-[#8A918C] py-1">None found</div>
                                                ) : (
                                                    <div className="space-y-1.5 max-h-60 overflow-y-auto scrollbar-custom pr-1">
                                                        {(healthData.godFiles || []).map((gf, i) => (
                                                            <div key={i} className="flex items-center justify-between p-2 rounded-lg border border-white/[0.06] bg-white/[0.02] text-xs">
                                                                <button
                                                                    onClick={() => gf?.path && selectFile(gf.path)}
                                                                    className="font-mono text-[#E8EAE6] hover:text-[#4FD1B5] transition-colors cursor-pointer truncate text-left"
                                                                    title={gf?.path}
                                                                >
                                                                    {gf?.path ? gf.path.split('/').pop() : ''}
                                                                </button>
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-[10px] font-mono text-[#8A918C]/60 truncate max-w-[140px] hidden sm:inline" title={gf?.path}>
                                                                        {gf?.path}
                                                                    </span>
                                                                    <Badge variant="amber">{gf?.importCount || 0} imports</Badge>
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
                        !selectedFile ? (
                            <div className="glass-surface p-12 rounded-xl border-white/10 text-center flex flex-col items-center justify-center gap-2 flex-1">
                                <Network size={24} className="text-[#8A918C]/40 mb-1" />
                                <div className="text-xs text-[#8A918C]">Select a file from the sidebar to inspect its connections.</div>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <ComponentToolbar
                                    title="File connections"
                                    subtitle={
                                        <span>
                                            Incoming and outgoing file dependencies for <span className="font-mono text-[#E8EAE6]">{selectedFile.split('/').pop()}</span>.
                                        </span>
                                    }
                                    primaryAction={
                                        <Button onClick={fetchConnections} className="px-3 py-1 text-xs shrink-0 whitespace-nowrap" disabled={!graph}>
                                            Re-analyze
                                        </Button>
                                    }
                                    onDownloadReport={handleDownloadConnectionsReport}
                                    onCopyPRComment={handleCopyConnectionsPRComment}
                                    onReanalyze={fetchConnections}
                                    onExport={() => downloadTextFile('file-connections.json', JSON.stringify(connectionsData || {}, null, 2), 'application/json')}
                                />
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
                        )
                    )}

                    {activeTab === 'Code' && (
                        <CodeViewer />
                    )}

                    {activeTab === 'ChangeSet' && (
                        <div className="flex-1 flex flex-col space-y-4 min-h-0">
                            <ComponentToolbar
                                title="Planning to edit more than one file?"
                                subtitle="Add the files you plan to edit. You get one combined risk, every file that could break, and the tests to run."
                                badge={
                                    <span className="text-xs font-mono font-normal text-[#8A918C]">
                                        ({changeSet.length} {changeSet.length === 1 ? 'file' : 'files'})
                                    </span>
                                }
                                primaryAction={
                                    <Button
                                        onClick={analyzeChangeSet}
                                        disabled={changeSetLoading || changeSet.length === 0 || !graph}
                                        className="px-3 py-1 text-xs shrink-0 whitespace-nowrap"
                                    >
                                        {changeSetLoading ? (
                                            <>
                                                <Loader2 size={12} className="animate-spin mr-1.5" />
                                                Analyzing...
                                            </>
                                        ) : (
                                            'Analyze plan'
                                        )}
                                    </Button>
                                }
                                onDownloadReport={handleDownloadChangeSetReport}
                                onCopyPRComment={handleCopyChangeSetPRComment}
                                onReanalyze={analyzeChangeSet}
                                onExport={() => downloadTextFile('plan-impact.json', JSON.stringify(changeSetResult || {}, null, 2), 'application/json')}
                                extraMenuItems={changeSet.length > 0 ? [{ label: 'Clear all files', onClick: clearChangeSet }] : []}
                            />

                            {/* Empty, building plan, or loading states */}
                            {changeSetLoading ? (
                                <div className="py-20 flex flex-col items-center justify-center gap-3 text-[#8A918C]">
                                    <Loader2 size={24} className="animate-spin text-[#4FD1B5]" />
                                    <span className="text-xs font-mono">Analyzing combined impact across {changeSet.length} {changeSet.length === 1 ? 'file' : 'files'}...</span>
                                </div>
                            ) : !changeSetResult ? (
                                <div className="space-y-4">
                                    {/* 3 short steps */}
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                        <div className="p-3.5 rounded-lg bg-white/[0.02] border border-white/[0.06] space-y-1">
                                            <div className="text-[10px] font-mono font-bold text-[#4FD1B5]">01</div>
                                            <div className="text-xs text-[#E8EAE6] font-medium">Open a file</div>
                                            <div className="text-[11px] text-[#8A918C]">Select any file from the sidebar.</div>
                                        </div>
                                        <div className="p-3.5 rounded-lg bg-white/[0.02] border border-white/[0.06] space-y-1">
                                            <div className="text-[10px] font-mono font-bold text-[#4FD1B5]">02</div>
                                            <div className="text-xs text-[#E8EAE6] font-medium">Press Add to plan</div>
                                            <div className="text-[11px] text-[#8A918C]">Add all files you intend to modify.</div>
                                        </div>
                                        <div className="p-3.5 rounded-lg bg-white/[0.02] border border-white/[0.06] space-y-1">
                                            <div className="text-[10px] font-mono font-bold text-[#4FD1B5]">03</div>
                                            <div className="text-xs text-[#E8EAE6] font-medium">Press Analyze plan</div>
                                            <div className="text-[11px] text-[#8A918C]">Get combined risk and breakages.</div>
                                        </div>
                                    </div>

                                    {/* Files in your plan */}
                                    <div className="glass-surface p-4 rounded-xl border border-white/10 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <h3 className="text-xs font-semibold text-[#E8EAE6] flex items-center gap-1.5">
                                                <Layers size={13} className="text-[#4FD1B5]" />
                                                <span>Files in your plan</span>
                                                <span className="text-[10px] font-mono text-[#8A918C] font-normal">
                                                    ({changeSet.length})
                                                </span>
                                            </h3>
                                            {selectedFile && !changeSet.includes(selectedFile) && (
                                                <button
                                                    onClick={() => addToChangeSet(selectedFile)}
                                                    className="text-xs font-mono text-[#4FD1B5] hover:underline flex items-center gap-1 cursor-pointer"
                                                >
                                                    <Plus size={12} />
                                                    Add {selectedFile.split('/').pop()}
                                                </button>
                                            )}
                                        </div>

                                        {changeSet.length === 0 ? (
                                            <div className="py-6 text-center text-xs text-[#8A918C] font-mono border border-dashed border-white/[0.08] rounded-lg">
                                                No files in your plan yet.
                                            </div>
                                        ) : (
                                            <div className="space-y-1.5 max-h-64 overflow-y-auto scrollbar-custom pr-1">
                                                {changeSet.map((path) => {
                                                    const fileName = path.split('/').pop() || path;
                                                    const folder = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '';
                                                    return (
                                                        <div
                                                            key={path}
                                                            className="flex items-center justify-between p-2 rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition-colors group"
                                                        >
                                                            <div className="flex items-center gap-2 min-w-0">
                                                                <FileCode size={13} className="text-[#4FD1B5] shrink-0" />
                                                                <span
                                                                    onClick={() => selectFile(path)}
                                                                    className="font-mono text-xs font-medium text-[#E8EAE6] group-hover:text-[#4FD1B5] cursor-pointer"
                                                                    title={path}
                                                                >
                                                                    {fileName}
                                                                </span>
                                                                {folder && (
                                                                    <span className="text-[11px] text-[#8A918C] truncate" title={folder}>
                                                                        {folder}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <button
                                                                onClick={() => {
                                                                    removeFromChangeSet(path);
                                                                    if (changeSet.length <= 1) {
                                                                        setChangeSetResult(null);
                                                                    }
                                                                }}
                                                                className="text-[#8A918C] hover:text-red-400 p-1 rounded cursor-pointer transition-colors shrink-0"
                                                                title="Remove from plan"
                                                            >
                                                                <X size={13} />
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}

                                        {/* Hint */}
                                        <div className="text-[11px] text-[#8A918C] flex items-center justify-between pt-1 border-t border-white/[0.06]">
                                            <span>Add more files with Ctrl K or the Add to plan button</span>
                                            {changeSet.length > 0 && (
                                                <button
                                                    onClick={() => {
                                                        clearChangeSet();
                                                        setChangeSetResult(null);
                                                    }}
                                                    className="text-[10px] text-[#8A918C] hover:text-red-400 cursor-pointer"
                                                >
                                                    Clear plan
                                                </button>
                                            )}
                                        </div>
                                    </div>
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
                                                <ShieldAlert size={14} className={(changeSetResult?.combinedRisk || 0) > 60 ? "text-red-400" : (changeSetResult?.combinedRisk || 0) > 30 ? "text-[#E3A04A]" : "text-[#4FD1B5]"} />
                                            </div>
                                            <div className="my-2">
                                                <div className="flex items-baseline gap-1.5">
                                                    <span className="text-2xl font-bold font-mono text-[#E8EAE6]">
                                                        {changeSetResult?.combinedRisk ?? 0}
                                                    </span>
                                                    <span className="text-xs text-[#8A918C] font-mono">/ 100</span>
                                                </div>
                                                <div className="w-full bg-white/[0.08] h-1.5 rounded-full overflow-hidden mt-2">
                                                    <div
                                                        className={cn(
                                                            "h-full rounded-full transition-all duration-300",
                                                            (changeSetResult?.combinedRisk || 0) > 60 ? "bg-red-400" : (changeSetResult?.combinedRisk || 0) > 30 ? "bg-[#E3A04A]" : "bg-[#4FD1B5]"
                                                        )}
                                                        style={{ width: `${Math.min(100, Math.max(5, changeSetResult?.combinedRisk || 0))}%` }}
                                                    />
                                                </div>
                                            </div>
                                            <span className="text-[11px] text-[#8A918C]/80">
                                                Based on union of affected files, dependents, and churn
                                            </span>
                                        </div>

                                        {/* Files that could break */}
                                        <div className="glass-surface p-4 rounded-xl border border-white/10 flex flex-col justify-between">
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs text-[#8A918C]">Files that could break</span>
                                                <FileCode size={14} className="text-[#4FD1B5]" />
                                            </div>
                                            <div className="my-2">
                                                <div className="text-2xl font-bold font-mono text-[#E8EAE6]">
                                                    {changeSetResult?.affectedFiles?.length || 0}
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
                                                    {changeSetResult?.tests?.length || 0}
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
                                                    Files that could break ({changeSetResult?.affectedFiles?.length || 0})
                                                </h4>
                                                <span className="text-[10px] text-[#8A918C] font-mono">Ranked by risk</span>
                                            </div>
                                            <div className="space-y-1.5 max-h-[380px] overflow-y-auto scrollbar-custom pr-1">
                                                {(!changeSetResult?.affectedFiles || changeSetResult.affectedFiles.length === 0) ? (
                                                    <div className="p-4 text-center text-xs text-[#8A918C]">
                                                        None found
                                                    </div>
                                                ) : (
                                                    (changeSetResult.affectedFiles || []).map((f, i) => {
                                                        const fileName = f.split('/').pop() || f;
                                                        // Find which input files affect this file
                                                        const sources = Object.entries(changeSetResult?.affectedByInput || {})
                                                            .filter(([_, affected]) => affected?.includes(f))
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
                                                                            from {sources.length} {sources.length === 1 ? 'input' : 'inputs'}
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
                                                    Impact by file in plan
                                                </h4>
                                                <span className="text-[10px] text-[#8A918C] font-mono">{changeSet.length} {changeSet.length === 1 ? 'input' : 'inputs'}</span>
                                            </div>
                                            <div className="space-y-2 max-h-[380px] overflow-y-auto scrollbar-custom pr-1">
                                                {changeSet.map((inputPath) => {
                                                    const affected = (changeSetResult?.affectedByInput && changeSetResult.affectedByInput[inputPath]) || [];
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
                                                                        title="Remove from plan"
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
                                                Tests to run ({changeSetResult?.tests?.length || 0})
                                            </h4>
                                            <span className="text-[10px] text-[#8A918C] font-mono">Suggested test suite</span>
                                        </div>
                                        {(!changeSetResult?.tests || changeSetResult.tests.length === 0) ? (
                                            <div className="flex items-center gap-2 p-3 rounded-lg border border-white/[0.06] bg-white/[0.02] text-xs text-[#8A918C]">
                                                <span className="w-2 h-2 rounded-full bg-[#E3A04A] shrink-0" />
                                                <span>No tests found for the selected files in plan.</span>
                                            </div>
                                        ) : (
                                            <div className="space-y-1.5 max-h-48 overflow-y-auto scrollbar-custom">
                                                {(changeSetResult.tests || []).map((t, idx) => (
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
                </ErrorBoundary>
            </div>
        </div>
    );
}
