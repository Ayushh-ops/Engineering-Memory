import { useAppStore, getRepoKey, type AskChatMessage, type AskChat, type AttachedImage } from '../store';
import { Card, Badge, cn, Button } from '../ui';
import { Network, Activity, Clock, FileCode, FileText, ChevronRight, ChevronLeft, MoreHorizontal, Share2, Play, Send, ShieldAlert, GitCommit, Hexagon, MessageSquare, Loader2, Maximize2, Minimize2, X, Search, Copy, Check, Code2, ChevronDown, ChevronUp, HeartPulse, Download, Plus, Square, Layers, RefreshCw, Trash2, Paperclip, Info, Pencil } from 'lucide-react';
import { useState, useCallback, useEffect, useLayoutEffect, useRef, useMemo, memo, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { ReactFlow, useNodesState, useEdgesState, Background, Controls, useReactFlow, Position, Handle, MarkerType, useViewport } from '@xyflow/react';
import Graph3D, { G3Node } from './Graph3D';
import '@xyflow/react/dist/style.css';
import { api } from '../api';
import { isCodeFile, getPathsToAnalyze } from '../analyze-helpers';
import { CodeViewer } from './CodeViewer';
import { getNeighborInfo, getFocusedGraph, computeRisk, computeChangeSetRisk, selectRepoStats, compute2DLayout, getConnectedFiles, getFileDependents, isTestFile } from '../graph-helpers';
import { ConnectedFilesList } from './ConnectedFilesList';
import { RightPanel } from './RightPanel';
import { ErrorBoundary } from './ErrorBoundary';
import { useResponsive } from '../useMediaQuery';

export type { AttachedImage };

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

export async function processImageFile(file: File): Promise<AttachedImage | null> {
    const validMimes = ['image/jpeg', 'image/png', 'image/webp'];
    const mime = validMimes.includes(file.type) ? (file.type as 'image/jpeg' | 'image/png' | 'image/webp') : 'image/jpeg';

    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                let { width, height } = img;
                const maxDim = 1600;
                if (width > maxDim || height > maxDim) {
                    if (width > height) {
                        height = Math.round((height * maxDim) / width);
                        width = maxDim;
                    } else {
                        width = Math.round((width * maxDim) / height);
                        height = maxDim;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) return resolve(null);
                ctx.drawImage(img, 0, 0, width, height);

                const quality = 0.85;
                let dataUrl = canvas.toDataURL('image/jpeg', quality);
                let base64 = dataUrl.split(',')[1] || '';

                if (base64.length > 2 * 1024 * 1024) {
                    const maxDim2 = 1200;
                    let w2 = width;
                    let h2 = height;
                    if (w2 > maxDim2 || h2 > maxDim2) {
                        if (w2 > h2) {
                            h2 = Math.round((h2 * maxDim2) / w2);
                            w2 = maxDim2;
                        } else {
                            w2 = Math.round((w2 * maxDim2) / h2);
                            h2 = maxDim2;
                        }
                    }
                    const canvas2 = document.createElement('canvas');
                    canvas2.width = w2;
                    canvas2.height = h2;
                    const ctx2 = canvas2.getContext('2d');
                    if (ctx2) {
                        ctx2.drawImage(img, 0, 0, w2, h2);
                        dataUrl = canvas2.toDataURL('image/jpeg', 0.70);
                        base64 = dataUrl.split(',')[1] || '';
                    }
                }

                const thumbMax = 160;
                let tw = width;
                let th = height;
                if (tw > thumbMax || th > thumbMax) {
                    if (tw > th) {
                        th = Math.round((th * thumbMax) / tw);
                        tw = thumbMax;
                    } else {
                        tw = Math.round((tw * thumbMax) / th);
                        th = thumbMax;
                    }
                }
                const thumbCanvas = document.createElement('canvas');
                thumbCanvas.width = tw;
                thumbCanvas.height = th;
                const thumbCtx = thumbCanvas.getContext('2d');
                let thumbUrl = dataUrl;
                if (thumbCtx) {
                    thumbCtx.drawImage(img, 0, 0, tw, th);
                    thumbUrl = thumbCanvas.toDataURL('image/jpeg', 0.65);
                }

                resolve({
                    id: 'img_' + Math.random().toString(36).slice(2, 9),
                    mime,
                    data: base64,
                    thumbUrl,
                    name: file.name
                });
            };
            img.onerror = () => resolve(null);
            img.src = reader.result as string;
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
    });
}

interface PopoverProps {
    isOpen: boolean;
    onClose: () => void;
    triggerRef: React.RefObject<HTMLElement | null>;
    children: React.ReactNode;
    className?: string;
    role?: 'menu' | 'listbox';
    align?: 'start' | 'end';
    width?: number | string;
}

function Popover({
    isOpen,
    onClose,
    triggerRef,
    children,
    className,
    role = 'menu',
    align = 'start',
    width,
}: PopoverProps) {
    const popoverRef = useRef<HTMLDivElement | null>(null);
    const [coords, setCoords] = useState<{ top: number; left: number; maxHeight?: number } | null>(null);

    const updatePosition = useCallback(() => {
        if (!triggerRef.current || !isOpen) return;
        const rect = triggerRef.current.getBoundingClientRect();
        const popEl = popoverRef.current;
        const popWidth = popEl ? popEl.offsetWidth : (typeof width === 'number' ? width : 200);
        const popHeight = popEl ? popEl.offsetHeight : 200;

        const spaceBelow = window.innerHeight - rect.bottom - 8;
        const spaceAbove = rect.top - 8;
        const flipUp = spaceBelow < Math.min(popHeight, 300) && spaceAbove > spaceBelow;

        let top = flipUp ? rect.top - popHeight - 6 : rect.bottom + 6;
        let maxHeight = flipUp ? spaceAbove - 8 : spaceBelow - 8;
        if (maxHeight < 120) maxHeight = 120;

        let left = align === 'end' ? rect.right - popWidth : rect.left;
        const maxLeft = window.innerWidth - popWidth - 8;
        if (left > maxLeft) left = maxLeft;
        if (left < 8) left = 8;
        if (top < 8) top = 8;
        if (top + popHeight > window.innerHeight - 8) {
            top = Math.max(8, window.innerHeight - popHeight - 8);
        }

        setCoords({ top, left, maxHeight });
    }, [triggerRef, isOpen, align, width]);

    useLayoutEffect(() => {
        if (isOpen) {
            updatePosition();
        } else {
            setCoords(null);
        }
    }, [isOpen, updatePosition]);

    useEffect(() => {
        if (!isOpen) return;

        const timer = setTimeout(() => {
            if (popoverRef.current) {
                const searchInput = popoverRef.current.querySelector<HTMLInputElement>('input');
                if (searchInput) {
                    searchInput.focus();
                } else {
                    const firstFocusable = popoverRef.current.querySelector<HTMLElement>(
                        '[role="menuitem"], [role="option"], button, [tabindex="0"]'
                    );
                    firstFocusable?.focus();
                }
            }
        }, 10);

        const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
            const target = e.target as Node;
            if (popoverRef.current && !popoverRef.current.contains(target) &&
                triggerRef.current && !triggerRef.current.contains(target)) {
                onClose();
            }
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                onClose();
                triggerRef.current?.focus();
                return;
            }

            if (popoverRef.current && (role === 'menu' || role === 'listbox')) {
                const focusable = Array.from(
                    popoverRef.current.querySelectorAll<HTMLElement>(
                        'button:not([disabled]), [role="menuitem"], [role="option"], input, [tabindex="0"]'
                    )
                );
                if (focusable.length === 0) return;

                const activeIdx = focusable.indexOf(document.activeElement as HTMLElement);

                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    const nextIdx = activeIdx === -1 ? 0 : (activeIdx + 1) % focusable.length;
                    focusable[nextIdx]?.focus();
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    const prevIdx = activeIdx === -1 ? focusable.length - 1 : (activeIdx - 1 + focusable.length) % focusable.length;
                    focusable[prevIdx]?.focus();
                }
            }
        };

        const handleScrollOrResize = () => {
            onClose();
        };

        window.addEventListener('mousedown', handleOutsideClick);
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('scroll', handleScrollOrResize, true);
        window.addEventListener('resize', handleScrollOrResize);

        return () => {
            clearTimeout(timer);
            window.removeEventListener('mousedown', handleOutsideClick);
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('scroll', handleScrollOrResize, true);
            window.removeEventListener('resize', handleScrollOrResize);
        };
    }, [isOpen, onClose, triggerRef, role]);

    if (!isOpen) return null;

    return createPortal(
        <div
            ref={popoverRef}
            role={role}
            style={{
                position: 'fixed',
                top: coords?.top ?? -9999,
                left: coords?.left ?? -9999,
                zIndex: 1000,
                width: width !== undefined ? width : undefined,
                maxHeight: coords?.maxHeight !== undefined ? coords.maxHeight : undefined,
                visibility: coords ? 'visible' : 'hidden',
            }}
            className={cn(
                "bg-[rgba(14,20,21,0.98)] backdrop-blur-md border border-white/10 rounded-[10px] shadow-2xl text-[13px] text-[#E8EAE6] overflow-y-auto scrollbar-custom outline-none",
                className
            )}
        >
            {children}
        </div>,
        document.body
    );
}

interface ThemedSelectOption<T extends string> {
    value: T;
    label: string;
    description: string;
}

interface ThemedSelectProps<T extends string> {
    value: T;
    onChange: (val: T) => void;
    options: ThemedSelectOption<T>[];
    title?: string;
    triggerClassName?: string;
}

function ThemedSelect<T extends string>({
    value,
    onChange,
    options,
    title,
    triggerClassName,
}: ThemedSelectProps<T>) {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement | null>(null);

    const selectedOption = options.find(o => o.value === value) || options[0];

    return (
        <div className="relative inline-block">
            <button
                ref={triggerRef}
                type="button"
                onClick={() => setOpen(!open)}
                className={cn(
                    "px-2 py-0.5 rounded text-[11px] font-mono border transition-colors flex items-center gap-1 cursor-pointer",
                    open
                        ? "border-[#4FD1B5]/40 bg-[#4FD1B5]/10 text-[#4FD1B5]"
                        : "border-white/10 bg-white/[0.02] text-[#8A918C] hover:text-[#E8EAE6] hover:border-white/20",
                    triggerClassName
                )}
                title={title}
            >
                <span>{selectedOption?.label}</span>
                <ChevronDown size={10} className={cn("transition-transform duration-150", open && "rotate-180")} />
            </button>
            <Popover
                isOpen={open}
                onClose={() => setOpen(false)}
                triggerRef={triggerRef}
                role="listbox"
                width={260}
                className="p-1.5 space-y-0.5"
            >
                {options.map(opt => {
                    const isSelected = opt.value === value;
                    return (
                        <button
                            key={opt.value}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            onClick={() => {
                                onChange(opt.value);
                                setOpen(false);
                                triggerRef.current?.focus();
                            }}
                            className={cn(
                                "w-full text-left px-3 py-2 rounded-lg transition-colors cursor-pointer flex items-center justify-between group",
                                isSelected
                                    ? "bg-[#4FD1B5]/10 text-[#4FD1B5]"
                                    : "text-[#E8EAE6] hover:bg-white/[0.06]"
                            )}
                        >
                            <div className="min-w-0 pr-2">
                                <div className={cn("text-[13px] font-medium leading-snug", isSelected ? "text-[#4FD1B5]" : "text-[#E8EAE6]")}>
                                    {opt.label}
                                </div>
                                <div className="text-[11px] text-[#8A918C] leading-tight mt-0.5 font-normal">
                                    {opt.description}
                                </div>
                            </div>
                            {isSelected && (
                                <Check size={14} className="text-[#4FD1B5] shrink-0 ml-1" />
                            )}
                        </button>
                    );
                })}
            </Popover>
        </div>
    );
}

const ASK_MODE_OPTIONS: ThemedSelectOption<import('../api').AskMode>[] = [
    { value: 'auto', label: 'Auto', description: 'Smart length and format' },
    { value: 'detailed', label: 'Detailed', description: 'Summary plus bullets' },
    { value: 'short', label: 'Short', description: 'At most 4 bullets' },
    { value: 'steps', label: 'Steps', description: 'Numbered walkthrough' },
    { value: 'simple', label: 'Simple', description: 'Plain language' },
    { value: 'review', label: 'Review', description: 'Risks and suggestions' },
];

const ASK_SCOPE_OPTIONS: ThemedSelectOption<import('../api').AskScope>[] = [
    { value: 'file', label: 'File', description: 'Only this file' },
    { value: 'dependents', label: 'File and dependents', description: 'Adds direct dependents' },
    { value: 'repo', label: 'Repository', description: 'Repo-level summary' },
];

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
    customMenu?: (close: () => void) => React.ReactNode;
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
    customMenu,
}: ComponentToolbarProps) {
    const [menuOpen, setMenuOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const menuBtnRef = useRef<HTMLButtonElement | null>(null);

    const handleCopy = () => {
        if (onCopyPRComment) {
            onCopyPRComment();
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
            setMenuOpen(false);
        }
    };

    return (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between shrink-0 gap-2 sm:gap-3 py-1">
            {/* Title Left */}
            <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-xs font-semibold text-[#E8EAE6] whitespace-normal">{title}</h3>
                        {badge}
                    </div>
                    {subtitle && <p className="text-[11px] text-[#8A918C] mt-0.5 whitespace-normal">{subtitle}</p>}
                </div>
            </div>

            {/* Right Controls: Middle (e.g. depth segmented control) + Primary Action + "..." Menu */}
            <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
                {middle}

                {primaryAction}

                {/* "..." menu for secondary actions */}
                <div className="relative">
                    <button
                        ref={menuBtnRef}
                        type="button"
                        onClick={() => setMenuOpen(!menuOpen)}
                        className={cn(
                            "p-1.5 rounded-lg border border-white/10 glass-surface transition-colors cursor-pointer flex items-center justify-center",
                            menuOpen ? "bg-white/[0.08] text-[#E8EAE6]" : "text-[#8A918C] hover:text-[#E8EAE6] hover:border-white/20"
                        )}
                        title="More actions"
                    >
                        <MoreHorizontal size={14} />
                    </button>

                    <Popover
                        isOpen={menuOpen}
                        onClose={() => setMenuOpen(false)}
                        triggerRef={menuBtnRef}
                        align="end"
                        role="menu"
                        width={210}
                        className="p-1.5 text-xs font-mono space-y-0.5"
                    >
                        {customMenu ? (
                            customMenu(() => setMenuOpen(false))
                        ) : (
                            <>
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
                            </>
                        )}
                    </Popover>
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

function computeFitViewport(
    nodes: any[],
    positions: Map<string, { x: number; y: number }>,
    nodeHops: Map<string, number>,
    containerWidth: number,
    containerHeight: number,
    showAllNodes: boolean = false
): { x: number; y: number; zoom: number } {
    if (!containerWidth || !containerHeight || nodes.length === 0) {
        return { x: 0, y: 0, zoom: 1 };
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    nodes.forEach(n => {
        const pos = positions.get(n.id) || { x: 0, y: 0 };
        const hops = nodeHops.get(n.id) || 1;
        const name = n.name || (n.path ? n.path.split('/').pop() : n.id);
        const labelText = name.length > 28 ? name.slice(0, 27) + '…' : name;
        const pillWidth = Math.max(140, Math.min(260, 24 + 14 + labelText.length * 7.5 + (hops >= 2 ? 45 : 0)));
        const halfW = pillWidth / 2;
        const halfH = 17;

        minX = Math.min(minX, pos.x - halfW);
        maxX = Math.max(maxX, pos.x + halfW);
        minY = Math.min(minY, pos.y - halfH);
        maxY = Math.max(maxY, pos.y + halfH);
    });

    if (!isFinite(minX) || !isFinite(maxX)) {
        return { x: containerWidth / 2, y: (containerHeight + 16) / 2, zoom: 1 };
    }

    const boxWidth = Math.max(1, maxX - minX);
    const boxHeight = Math.max(1, maxY - minY);
    const boxCenterX = (minX + maxX) / 2;
    const boxCenterY = (minY + maxY) / 2;

    const freeWidth = containerWidth;
    const freeHeight = Math.max(100, containerHeight - 72 - 56);

    const targetWidth = freeWidth * 0.85;
    const targetHeight = freeHeight * 0.85;

    const scaleX = targetWidth / boxWidth;
    const scaleY = targetHeight / boxHeight;
    let zoom = Math.min(scaleX, scaleY);

    // If not showing all nodes, ensure effective font is at least 12px (zoom >= 1.0)
    if (!showAllNodes) {
        zoom = Math.max(1.0, zoom);
    } else {
        zoom = Math.max(0.2, zoom);
    }
    // Scale UP as well as down, allow up to 3x
    zoom = Math.min(3.0, zoom);

    // Center point in screen coordinates (accounting for top 72px and bottom 56px bands)
    const screenCenterX = containerWidth / 2;
    const screenCenterY = 72 + freeHeight / 2;

    const x = screenCenterX - boxCenterX * zoom;
    const y = screenCenterY - boxCenterY * zoom;

    return { x, y, zoom };
}

function FlowFitViewHandler({
    fitViewport,
    triggerKey
}: {
    fitViewport: { x: number; y: number; zoom: number };
    triggerKey: string;
}) {
    const { setViewport } = useReactFlow();

    useEffect(() => {
        if (!fitViewport || fitViewport.zoom <= 0) return;
        setViewport(fitViewport, { duration: 0 });
    }, [fitViewport, triggerKey, setViewport]);

    return null;
}

function ColumnHeadingsOverlay({
    columnHeaders,
    focusDepth,
    colSpacing = 340,
    baseColOffset = 1
}: {
    columnHeaders: { visible: boolean; imports: number; importedBy: number; indirect: number };
    focusDepth: 1 | 2;
    colSpacing?: number;
    baseColOffset?: number;
}) {
    const { x, zoom } = useViewport();

    if (!columnHeaders.visible) return null;

    const xLeft = -colSpacing;
    const xRight = colSpacing;
    const xIndirect = colSpacing * (baseColOffset + 1);

    const screenXLeft = xLeft * zoom + x;
    const screenXRight = xRight * zoom + x;
    const screenXIndirect = xIndirect * zoom + x;

    return (
        <div className="absolute top-[76px] inset-x-0 pointer-events-none z-20 font-mono text-[13px]">
            {columnHeaders.imports > 0 && (
                <div
                    className="absolute -translate-x-1/2 flex items-center gap-1.5 px-3 py-1 rounded-md bg-[#101415]/90 border border-white/10 backdrop-blur shadow-sm whitespace-nowrap"
                    style={{ left: `${screenXLeft}px` }}
                >
                    <span className="font-semibold text-[#4FD1B5]">Imports</span>
                    <span className="text-[#8A918C]">({columnHeaders.imports})</span>
                </div>
            )}
            <div
                className="absolute -translate-x-1/2 flex items-center gap-1.5 px-3 py-1 rounded-md bg-[#101415]/90 border border-white/10 backdrop-blur shadow-sm whitespace-nowrap"
                style={{ left: `${screenXRight}px` }}
            >
                <span className="font-semibold text-[#E3A04A]">Imported by</span>
                <span className="text-[#8A918C]">({columnHeaders.importedBy})</span>
                {focusDepth !== 1 && columnHeaders.importedBy === 0 && (
                    <span className="text-[11px] text-[#8A918C]/60 italic ml-1">None</span>
                )}
            </div>
            {focusDepth !== 1 && columnHeaders.indirect > 0 && (
                <div
                    className="absolute -translate-x-1/2 flex items-center gap-1.5 px-3 py-1 rounded-md bg-[#101415]/90 border border-white/10 backdrop-blur shadow-sm whitespace-nowrap"
                    style={{ left: `${screenXIndirect}px` }}
                >
                    <span className="font-semibold text-[#8A918C]">Indirect</span>
                    <span className="text-[#8A918C]">({columnHeaders.indirect})</span>
                </div>
            )}
        </div>
    );
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
                <code key={`code-${match.index}`} className="font-mono text-[#4FD1B5] text-[11px]">
                    {codeContent}
                </code>
            );
        } else if (m.startsWith('`') && m.endsWith('`') && m.length >= 2) {
            // Render single-backtick inline code as plain text without interpolation (trailing underscores like `filter_` stay inside code)
            const codeContent = m.slice(1, -1);
            parts.push(
                <code key={`code-${match.index}`} className="font-mono text-[#4FD1B5] text-[11px]">
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

function AskAiThinkingIndicator({ phase }: { phase: 'reading' | 'thinking' }) {
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        if (phase !== 'thinking') {
            setElapsed(0);
            return;
        }
        const start = Date.now();
        const interval = setInterval(() => {
            setElapsed(Math.floor((Date.now() - start) / 1000));
        }, 1000);
        return () => clearInterval(interval);
    }, [phase]);

    let label = 'Reading the file...';
    if (phase === 'thinking') {
        label = elapsed >= 4 ? `Thinking... ${elapsed}s` : 'Thinking...';
    }

    return (
        <div className="space-y-1.5 py-1">
            <div className="flex items-center gap-2.5 text-[#8A918C] text-xs font-mono">
                <span>{label}</span>
                <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#4FD1B5] typing-dot" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-[#4FD1B5] typing-dot" style={{ animationDelay: '200ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-[#4FD1B5] typing-dot" style={{ animationDelay: '400ms' }} />
                </span>
            </div>
            {phase === 'thinking' && elapsed >= 25 && (
                <div className="text-[11px] text-[#8A918C]/80 font-mono">
                    The server may be waking up, this can take up to a minute on the free plan
                </div>
            )}
        </div>
    );
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

const CustomGraphNode = memo(function CustomGraphNode({ data, id }: { data: any; id: string }) {
    return (
        <div
            data-node-id={id}
            data-indirect={data.isIndirect ? "true" : "false"}
            style={data.style}
            className="graph-2d-node relative min-h-[34px] h-[34px] flex items-center cursor-pointer select-none transition-[opacity,box-shadow,border-color] duration-150"
        >
            <Handle
                id="target-left"
                type="target"
                position={Position.Left}
                style={{ opacity: 0, pointerEvents: 'none' as const }}
            />
            <Handle
                id="source-left"
                type="source"
                position={Position.Left}
                style={{ opacity: 0, pointerEvents: 'none' as const }}
            />
            <Handle
                id="target-right"
                type="target"
                position={Position.Right}
                style={{ opacity: 0, pointerEvents: 'none' as const }}
            />
            <Handle
                id="source-right"
                type="source"
                position={Position.Right}
                style={{ opacity: 0, pointerEvents: 'none' as const }}
            />
            {data.label}
        </div>
    );
});

const customNodeTypes = {
    custom: CustomGraphNode
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
    showCalls,
    hasDetailsOffset,
    showAllNodes
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
    hasDetailsOffset?: boolean;
    showAllNodes?: boolean;
}) {
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [pointerPos, setPointerPos] = useState<{ x: number; y: number } | null>(null);
    const unhoverTimeoutRef = useRef<any>(null);

    // Compute static layout only once per (graph, selectedFile, selectedSymbol, focusDepth, simplify, showCalls)
    const {
        visibleNodes,
        validEdges,
        centerId,
        centerName,
        layoutResult,
        top3RiskEdgeIds,
        neighborInfo,
        connectedToSelectedIds,
        columnHeaders
    } = useMemo(() => {
        const vNodes: any[] = (graph?.nodes || []).filter((n: any) => Boolean(n && n.id));
        const vNodeIds = new Set(vNodes.map((n: any) => n.id));
        const vEdges = (graph?.edges || []).filter((e: any) => vNodeIds.has(e.from) && vNodeIds.has(e.to));

        const nInfo = getNeighborInfo(graph, selectedFile, selectedSymbol);

        let cId: string | null = null;
        let cName = '';
        if (selectedFile) {
            for (const n of vNodes) {
                const nPath = (n as any).path || (n.type === 'file' ? n.id : undefined);
                if (nPath === selectedFile || n.id === selectedFile || (n.type === 'file' && (n as any).name === selectedFile)) {
                    if (selectedSymbol) {
                        if ((n as any).name === selectedSymbol.name && n.type === selectedSymbol.type) {
                            cId = n.id;
                            cName = n.name || (nPath ? nPath.split('/').pop() : n.id);
                            break;
                        }
                    } else if (n.type === 'file') {
                        cId = n.id;
                        cName = n.name || (nPath ? nPath.split('/').pop() : n.id);
                        break;
                    }
                }
            }
            if (!cId && nInfo.selectedNodeIds.size > 0) {
                cId = Array.from(nInfo.selectedNodeIds)[0];
                const cNode = vNodes.find(n => n.id === cId);
                cName = cNode?.name || (cNode?.path ? cNode.path.split('/').pop() : cId);
            }
        }

        const lResult = compute2DLayout(vNodes, vEdges, {
            centerId: cId,
            isFocused: Boolean(selectedFile),
            focusDepth,
            graph
        });

        // Top 3 risk edges
        const nodeRiskMap = new Map<string, number>();
        vNodes.forEach(n => {
            const p = n.path || n.id;
            const r = computeRisk(p, graph).score;
            nodeRiskMap.set(n.id, r);
        });
        const scoredEdges = vEdges.map((e: any, idx: number) => {
            const risk = Math.max(nodeRiskMap.get(e.from) || 0, nodeRiskMap.get(e.to) || 0);
            const edgeId = e.id || `${e.from}->${e.to}:${e.type}`;
            return { edgeId, risk, idx };
        });
        scoredEdges.sort((a, b) => b.risk - a.risk || a.idx - b.idx);
        const top3Set = new Set(scoredEdges.slice(0, 3).map(x => x.edgeId));

        // Connected to selected
        const connSet = new Set<string>();
        if (nInfo.hasSelection) {
            nInfo.selectedNodeIds.forEach(id => connSet.add(id));
            let currentLevel = new Set(nInfo.selectedNodeIds);
            const maxDepth = focusDepth || 2;
            for (let d = 0; d < maxDepth; d++) {
                const nextLevel = new Set<string>();
                for (const edge of vEdges) {
                    if (currentLevel.has(edge.from) && !connSet.has(edge.to)) {
                        connSet.add(edge.to);
                        nextLevel.add(edge.to);
                    }
                    if (currentLevel.has(edge.to) && !connSet.has(edge.from)) {
                        connSet.add(edge.from);
                        nextLevel.add(edge.from);
                    }
                }
                currentLevel = nextLevel;
            }
        }

        const colHeaders = {
            imports: lResult.columnCounts.imports,
            importedBy: lResult.columnCounts.importedBy,
            indirect: lResult.columnCounts.indirect,
            visible: Boolean(selectedFile && cId)
        };

        return {
            visibleNodes: vNodes,
            validEdges: vEdges,
            centerId: cId,
            centerName: cName,
            layoutResult: lResult,
            top3RiskEdgeIds: top3Set,
            neighborInfo: nInfo,
            connectedToSelectedIds: connSet,
            columnHeaders: colHeaders
        };
    }, [graph, selectedFile, selectedSymbol, focusDepth, simplify, showCalls]);

    // Active hover path calculation without triggering layout, fitView, or nodes/edges rebuild
    const activeHoverId = hoveredNodeId || hoveredGraphNode;
    const { hoverPathNodeIds, hoverPathEdgeIds, activeHoverSentence } = useMemo(() => {
        let pNodeIds = new Set<string>();
        let pEdgeIds = new Set<string>();
        let hSentence = '';
        let directNbrEdgeIds = new Set<string>();

        if (activeHoverId) {
            const hNode = visibleNodes.find(n => n.id === activeHoverId || n.path === activeHoverId);
            const hId = hNode ? hNode.id : activeHoverId;
            const hName = hNode ? (hNode.name || (hNode.path ? hNode.path.split('/').pop() : hId)) : hId;

            for (const e of validEdges) {
                const eId = e.id || `${e.from}->${e.to}:${e.type}`;
                if (e.from === hId || e.to === hId) {
                    directNbrEdgeIds.add(eId);
                }
            }

            if (centerId) {
                if (hId === centerId) {
                    pNodeIds.add(centerId);
                    hSentence = centerName;
                } else {
                    const dirOutgoing = validEdges.find(e => e.from === centerId && e.to === hId);
                    const dirIncoming = validEdges.find(e => e.from === hId && e.to === centerId);

                    if (dirOutgoing) {
                        pNodeIds.add(centerId);
                        pNodeIds.add(hId);
                        pEdgeIds.add(dirOutgoing.id || `${dirOutgoing.from}->${dirOutgoing.to}:${dirOutgoing.type}`);
                        hSentence = `${centerName} imports ${hName}`;
                    } else if (dirIncoming) {
                        pNodeIds.add(centerId);
                        pNodeIds.add(hId);
                        pEdgeIds.add(dirIncoming.id || `${dirIncoming.from}->${dirIncoming.to}:${dirIncoming.type}`);
                        hSentence = `${hName} imports ${centerName}`;
                    } else {
                        // BFS shortest path
                        const adj = new Map<string, Array<{ neighbor: string; edgeId: string }>>();
                        for (const e of validEdges) {
                            const eId = e.id || `${e.from}->${e.to}:${e.type}`;
                            if (!adj.has(e.from)) adj.set(e.from, []);
                            if (!adj.has(e.to)) adj.set(e.to, []);
                            adj.get(e.from)!.push({ neighbor: e.to, edgeId: eId });
                            adj.get(e.to)!.push({ neighbor: e.from, edgeId: eId });
                        }
                        const visited = new Set<string>([hId]);
                        const queue: Array<{ id: string; pNodes: string[]; pEdges: string[] }> = [{ id: hId, pNodes: [hId], pEdges: [] }];
                        while (queue.length > 0) {
                            const curr = queue.shift()!;
                            if (curr.id === centerId) {
                                pNodeIds = new Set(curr.pNodes);
                                pEdgeIds = new Set(curr.pEdges);
                                const hops = curr.pEdges.length;
                                hSentence = `${hName} reaches ${centerName} (${hops} hops)`;
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
                        if (pNodeIds.size === 0) {
                            pNodeIds.add(hId);
                            hSentence = hName;
                        }
                    }
                }
            } else {
                pNodeIds.add(hId);
                hSentence = hName;
            }

            // Also include all direct incident edges of the hovered node
            for (const eId of directNbrEdgeIds) {
                pEdgeIds.add(eId);
            }
        }

        return {
            hoverPathNodeIds: pNodeIds,
            hoverPathEdgeIds: pEdgeIds,
            activeHoverSentence: hSentence
        };
    }, [activeHoverId, visibleNodes, validEdges, centerId, centerName]);

    // Build memoized ReactFlow nodes: NEVER recomputed on hover!
    const { positions, nodeHops, leftIds, rightIds, indirectIds } = layoutResult;
    const leftIdSet = useMemo(() => new Set(leftIds), [leftIds]);
    const rightIdSet = useMemo(() => new Set(rightIds), [rightIds]);
    const indirectIdSet = useMemo(() => new Set(indirectIds), [indirectIds]);

    const nodes = useMemo(() => {
        const isPhone = typeof window !== 'undefined' && window.innerWidth <= 767;
        const top4RiskyIds = isPhone ? new Set(
            [...visibleNodes]
                .map((n: any) => {
                    const p = n.path || (n.type === 'file' ? n.id : undefined);
                    let score = 0;
                    if (p && graph) {
                        try { score = computeRisk(p, graph).score; } catch {}
                    }
                    return { id: n.id, score };
                })
                .sort((a, b) => b.score - a.score)
                .slice(0, 4)
                .map(x => x.id)
        ) : null;

        return visibleNodes.map((n: any) => {
            const pos = positions.get(n.id) || { x: 0, y: 0 };
            const nodePath = n.path || (n.type === 'file' ? n.id : undefined);
            const isSelected = neighborInfo.selectedNodeIds.has(n.id) || (centerId === n.id);
            const isRepo = n.type === 'repository';
            const isCallable = n.type === 'function' || n.type === 'method';
            const showTextLabel = !isPhone || isSelected || Boolean(top4RiskyIds?.has(n.id));

            const rawName = n.name || (nodePath ? nodePath.split('/').pop() : n.id);
            const displayName = isRepo ? 'repo' : (rawName.includes('/') ? rawName.split('/').pop() : rawName);
            const labelText = isCallable ? `${displayName}()` : displayName;

            // Grow to fit up to 28 characters, then ellipsis with tooltip
            const displayLabel = labelText.length > 28 ? labelText.slice(0, 27) + '…' : labelText;

            const hops = nodeHops.get(n.id) || 1;
            const isIndirect = indirectIdSet.has(n.id) || hops >= 2;

            let bg = '#10161A';
            let border = '1px solid rgba(255, 255, 255, 0.1)';
            let boxShadow = '0 2px 6px rgba(0, 0, 0, 0.45)';
            let textColor = '#E8EAE6';
            let dotColor = '#4FD1B5';

            if (isRepo) {
                bg = '#10161A';
                border = '1.5px solid #E8EAE6';
                dotColor = '#E8EAE6';
            } else if (isSelected) {
                bg = '#FFFFFF';
                border = '2.5px solid #4FD1B5';
                boxShadow = '0 0 16px rgba(79, 209, 181, 0.55)';
                textColor = '#07090A';
                dotColor = '#4FD1B5';
            } else if (leftIdSet.has(n.id)) {
                bg = '#10161A';
                border = '1px solid rgba(79, 209, 181, 0.45)';
                dotColor = '#4FD1B5';
            } else if (rightIdSet.has(n.id)) {
                bg = '#10161A';
                border = '1px solid rgba(227, 160, 74, 0.45)';
                dotColor = '#E3A04A';
            } else if (isIndirect) {
                bg = '#10161A';
                border = '1px solid rgba(138, 145, 140, 0.35)';
                dotColor = '#8A918C';
            } else if (isCallable) {
                bg = '#10161A';
                border = '1px solid rgba(111, 143, 154, 0.4)';
                dotColor = '#6F8F9A';
            }

            let nodeOpacity = isIndirect ? 0.55 : 1;
            if (neighborInfo.hasSelection) {
                nodeOpacity = connectedToSelectedIds.has(n.id) ? (isIndirect ? 0.55 : 1) : 0.25;
            }

            const nodeStyle = {
                background: bg,
                border,
                borderRadius: '9999px',
                height: '34px',
                minHeight: '34px',
                boxSizing: 'border-box' as const,
                display: 'flex',
                alignItems: 'center',
                padding: '0 12px',
                boxShadow,
                opacity: nodeOpacity,
                color: textColor,
                fontSize: '12px',
                cursor: 'pointer',
                position: 'relative' as const,
                zIndex: isSelected ? 10 : 3
            };

            return {
                id: n.id,
                type: 'custom',
                position: pos,
                data: {
                    label: (
                        <div
                            className="flex items-center gap-1.5 font-mono select-none pointer-events-none whitespace-nowrap relative"
                            title={nodePath || labelText}
                        >
                            <span
                                className={cn(
                                    "w-2 h-2 rounded-full inline-block shrink-0",
                                    isRepo && "border border-[#E8EAE6] bg-transparent"
                                )}
                                style={isRepo ? undefined : { backgroundColor: dotColor }}
                            />
                            {showTextLabel && (
                                <span
                                    style={{ fontSize: '12px', color: textColor, fontWeight: isSelected ? '600' : '400' }}
                                    className="text-[12px] leading-none font-mono tracking-tight pointer-events-none"
                                >
                                    {displayLabel}
                                </span>
                            )}
                            {hops >= 2 && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.08] text-[#8A918C] ml-1 font-sans shrink-0 pointer-events-none">
                                    {hops} hops
                                </span>
                            )}
                            {isSelected && leftIds.length === 0 && (
                                <div className="absolute top-[38px] left-1/2 -translate-x-1/2 text-[11px] text-[#8A918C]/80 font-mono italic whitespace-nowrap pointer-events-none">
                                    Imports nothing
                                </div>
                            )}
                        </div>
                    ),
                    style: nodeStyle,
                    rawNode: n,
                    isIndirect
                }
            };
        });
    }, [
        visibleNodes,
        positions,
        neighborInfo,
        centerId,
        nodeHops,
        indirectIdSet,
        leftIdSet,
        rightIdSet,
        connectedToSelectedIds
    ]);

    // Build memoized ReactFlow edges: NEVER recomputed on hover!
    const edges = useMemo(() => {
        return validEdges.map((e: any, idx: number) => {
            const edgeId = e.id || `${e.from}->${e.to}:${e.type}`;
            let stroke = '#4FD1B5';
            let strokeDasharray: string | undefined = undefined;
            let isIndirectEdge = false;

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
                    isIndirectEdge = true;
                }
            } else {
                if (e.type === 'contains') {
                    stroke = '#8A918C';
                    strokeDasharray = '4 4';
                    isIndirectEdge = true;
                } else if (e.type === 'imported_by') {
                    stroke = '#E3A04A';
                } else {
                    stroke = '#4FD1B5';
                }
            }

            const isTop3 = top3RiskEdgeIds.has(edgeId);
            let edgeOpacity = isTop3 ? 0.95 : 0.55;
            let strokeWidth = isTop3 ? 2 : 1.2;

            // Indirect edges are hidden by default
            if (isIndirectEdge) {
                edgeOpacity = 0;
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
                className: cn(
                    'graph-2d-edge',
                    isIndirectEdge && 'edge-indirect',
                    isTop3 && 'edge-top3'
                ),
                markerEnd: {
                    type: MarkerType.ArrowClosed,
                    color: stroke,
                    width: 6,
                    height: 6
                },
                zIndex: isTop3 ? 5 : 1,
                style: {
                    stroke,
                    strokeWidth,
                    strokeDasharray,
                    opacity: edgeOpacity
                }
            };
        });
    }, [
        validEdges,
        neighborInfo,
        centerId,
        top3RiskEdgeIds,
        positions
    ]);

    // Handle mouse enter / leave with small debounce on leave to prevent flicker
    const handleNodeMouseEnter = useCallback((event: any, node: any) => {
        if (unhoverTimeoutRef.current) {
            clearTimeout(unhoverTimeoutRef.current);
            unhoverTimeoutRef.current = null;
        }
        setHoveredNodeId(node.id);
        if (event && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            setPointerPos({
                x: event.clientX - rect.left,
                y: event.clientY - rect.top
            });
        }
    }, []);

    const handleNodeMouseMove = useCallback((event: any) => {
        if (containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            setPointerPos({
                x: event.clientX - rect.left,
                y: event.clientY - rect.top
            });
        }
    }, []);

    const handleNodeMouseLeave = useCallback(() => {
        if (unhoverTimeoutRef.current) {
            clearTimeout(unhoverTimeoutRef.current);
        }
        unhoverTimeoutRef.current = setTimeout(() => {
            setHoveredNodeId(null);
            setPointerPos(null);
        }, 60);
    }, []);

    useEffect(() => {
        return () => {
            if (unhoverTimeoutRef.current) clearTimeout(unhoverTimeoutRef.current);
        };
    }, []);

    // CSS selectors string for highlighted nodes and edges during hover
    const hoverStyles = useMemo(() => {
        if (!activeHoverId) return '';
        const nodeRules: string[] = [];
        hoverPathNodeIds.forEach(id => {
            const escapedId = CSS.escape(id);
            nodeRules.push(`.graph-hover-active .graph-2d-node[data-node-id="${escapedId}"] { opacity: 1 !important; }`);
        });
        const edgeRules: string[] = [];
        hoverPathEdgeIds.forEach(id => {
            const escapedId = CSS.escape(id);
            edgeRules.push(`.graph-hover-active .react-flow__edge[data-id="${escapedId}"] path { stroke-width: 2px !important; opacity: 0.95 !important; }`);
            edgeRules.push(`.graph-hover-active .react-flow__edge[data-id="${escapedId}"].edge-indirect path { stroke-width: 2px !important; opacity: 0.95 !important; stroke: #8A918C !important; stroke-dasharray: 4 4 !important; }`);
        });
        return `${nodeRules.join('\n')}\n${edgeRules.join('\n')}`;
    }, [activeHoverId, hoverPathNodeIds, hoverPathEdgeIds]);

    const containerRef = useRef<HTMLDivElement>(null);
    const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

    useEffect(() => {
        if (!containerRef.current) return;
        const updateSize = () => {
            if (!containerRef.current) return;
            const w = Math.round(containerRef.current.clientWidth);
            const h = Math.round(containerRef.current.clientHeight);
            if (w > 0 && h > 0) {
                setContainerSize(prev => {
                    if (Math.abs(prev.width - w) >= 2 || Math.abs(prev.height - h) >= 2) {
                        return { width: w, height: h };
                    }
                    return prev;
                });
            }
        };
        updateSize();

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const w = Math.round(entry.contentRect.width);
                const h = Math.round(entry.contentRect.height);
                if (w > 0 && h > 0) {
                    setContainerSize(prev => {
                        if (Math.abs(prev.width - w) >= 2 || Math.abs(prev.height - h) >= 2) {
                            return { width: w, height: h };
                        }
                        return prev;
                    });
                }
            }
        });
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, []);

    const fitViewport = useMemo(() => {
        const w = containerSize.width || (containerRef.current ? containerRef.current.clientWidth : 0);
        const h = containerSize.height || (containerRef.current ? containerRef.current.clientHeight : 0);
        return computeFitViewport(
            visibleNodes,
            layoutResult.positions,
            layoutResult.nodeHops,
            w,
            h,
            Boolean(showAllNodes)
        );
    }, [
        visibleNodes,
        layoutResult.positions,
        layoutResult.nodeHops,
        containerSize.width,
        containerSize.height,
        showAllNodes
    ]);

    const fitTriggerKey = `${containerSize.width}x${containerSize.height}:${visibleNodes.length}:${focusDepth}:${resetTrigger}:${isExpanded ? 1 : 0}:${showAllNodes ? 1 : 0}`;

    return (
        <div
            ref={containerRef}
            className={cn(
                "w-full h-full relative [&_.react-flow__edges]:!z-[1] [&_.react-flow__nodes]:!z-[2] [&_.react-flow__edges]:pointer-events-none",
                Boolean(activeHoverId) && "graph-hover-active"
            )}
        >
            <style>{`
                .graph-hover-active .graph-2d-node {
                    opacity: 0.15 !important;
                }
                .graph-hover-active .react-flow__edge path {
                    opacity: 0.15 !important;
                }
                ${hoverStyles}
            `}</style>

            {/* Hover sentence tooltip positioned next to pointer, clamped inside canvas, flipping above near bottom */}
            {activeHoverSentence && (() => {
                const w = containerSize.width || (containerRef.current ? containerRef.current.clientWidth : 800);
                const h = containerSize.height || (containerRef.current ? containerRef.current.clientHeight : 600);
                let left = w / 2 - 120;
                let top: number | undefined = undefined;
                let bottom: number | undefined = 20;

                if (pointerPos) {
                    left = Math.max(12, Math.min(w - 332, pointerPos.x + 16));
                    // If near the bottom band (< 80px from bottom), flip above pointer
                    if (pointerPos.y > h - 80) {
                        bottom = h - pointerPos.y + 12;
                        top = undefined;
                    } else {
                        top = Math.max(76, pointerPos.y - 12);
                        bottom = undefined;
                    }
                }

                return (
                    <div
                        style={{
                            left: `${left}px`,
                            top: top !== undefined ? `${top}px` : undefined,
                            bottom: bottom !== undefined ? `${bottom}px` : undefined
                        }}
                        className="absolute z-30 pointer-events-none max-w-[320px] w-max px-3 py-1.5 rounded-lg bg-[#101415]/95 border border-[#4FD1B5]/30 text-xs font-mono text-[#E8EAE6] shadow-xl backdrop-blur-md flex items-start gap-2 whitespace-normal break-words"
                    >
                        <span className="w-2 h-2 rounded-full bg-[#4FD1B5] shrink-0 animate-pulse mt-1" />
                        <span className="leading-snug">{activeHoverSentence}</span>
                    </div>
                );
            })()}

            <ReactFlow
                style={{ touchAction: 'none' }}
                nodes={nodes}
                edges={edges}
                nodeTypes={customNodeTypes}
                nodeOrigin={[0.5, 0.5]}
                onNodeClick={(_event, node) => onSelectNode(node.data?.rawNode)}
                onNodeDoubleClick={(_event, node) => onDoubleClickNode(node.data?.rawNode)}
                onNodeMouseEnter={handleNodeMouseEnter}
                onNodeMouseMove={handleNodeMouseMove}
                onNodeMouseLeave={handleNodeMouseLeave}
                onPaneClick={() => onSelectNode(null)}
                defaultViewport={fitViewport.zoom > 0 ? fitViewport : undefined}
                minZoom={0.2}
                maxZoom={3.0}
                proOptions={{ hideAttribution: true }}
            >
                <Background color="#27272a" gap={16} size={1} />
                <Controls
                    position="bottom-right"
                    className="!bg-[#10161A] !backdrop-blur-md !border !border-white/10 !rounded-lg !shadow-xl !overflow-hidden [&>button]:!bg-[#10161A] [&>button]:!border-b [&>button]:!border-white/10 last:[&>button]:!border-b-0 [&>button]:!text-[#8A918C] [&>button:hover]:!bg-white/[0.06] [&>button:hover]:!text-[#4FD1B5] [&>button>svg]:!fill-current [&>button]:!w-7 [&>button]:!h-7"
                />
                <ColumnHeadingsOverlay
                    columnHeaders={columnHeaders}
                    focusDepth={focusDepth}
                    colSpacing={layoutResult.colSpacing}
                    baseColOffset={layoutResult.baseColOffset}
                />
                <FlowFitViewHandler
                    fitViewport={fitViewport}
                    triggerKey={fitTriggerKey}
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
    const { isDesktop } = useResponsive();
    const [mobileLegendOpen, setMobileLegendOpen] = useState(false);

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
    const [resetSignal, setResetSignal] = useState(0);

    const [simplify, setSimplify] = useState(false);
    const [showCalls, setShowCalls] = useState(false);
    const [focusDepth, setFocusDepth] = useState<1 | 2>(1);
    const [showAllNodes, setShowAllNodes] = useState(false);
    const [showIndirectListModal, setShowIndirectListModal] = useState(false);
    const [resetTrigger, setResetTrigger] = useState(0);
    const [detailsOpen, setDetailsOpen] = useState(false);

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
        setShowIndirectListModal(false);
    }, [selectedFile, focusDepth, simplify, showCalls, viewMode]);

    const handleBack = useCallback(async () => {
        if (visitedHistory.length === 0) return;
        const prevFile = visitedHistory[visitedHistory.length - 1];
        setVisitedHistory(prev => prev.slice(0, -1));
        lastNavigatedFileRef.current = prevFile;
        setActiveTab('Graph');
        await selectFile(prevFile);
        setResetTrigger(prev => prev + 1);
        setResetSignal(prev => prev + 1);
    }, [visitedHistory, setActiveTab, selectFile]);

    const handleReset = useCallback(() => {
        setFocusDepth(1);
        setSelectedFile(null);
        setSelectedSymbol(null);
        setShowAllNodes(false);
        setResetTrigger(prev => prev + 1);
        setResetSignal(prev => prev + 1);
    }, [setSelectedFile, setSelectedSymbol]);

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
    const { displayNodes, totalCandidateCount, totalImportersCount, totalIndirectCount, allIndirectNodes } = useMemo(() => {
        if (baseNodes.length === 0) {
            return { displayNodes: [], totalCandidateCount: 0, totalImportersCount: 0, totalIndirectCount: 0, allIndirectNodes: [] };
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
                totalImportersCount: 0,
                totalIndirectCount: 0,
                allIndirectNodes: []
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
            return { displayNodes: displayed, totalCandidateCount: total, totalImportersCount: 0, totalIndirectCount: 0, allIndirectNodes: [] };
        }

        // Direct neighbors (depth 1)
        const directImportsSet = new Set<string>();
        const directImportedBySet = new Set<string>();

        for (const e of graph.edges) {
            if (e.from === centerNode.id && baseNodeMap.has(e.to)) {
                directImportsSet.add(e.to);
            }
            if (e.to === centerNode.id && baseNodeMap.has(e.from)) {
                directImportedBySet.add(e.from);
            }
        }
        directImportsSet.delete(centerNode.id);
        directImportedBySet.delete(centerNode.id);

        // Indirect upstream dependents (2+ hops) via getFileDependents
        const centerPath = (centerNode as any).path || (centerNode.type === 'file' ? centerNode.id : undefined) || (centerNode as any).name || '';
        const depResult = getFileDependents(graph, centerPath);
        const indirectNodeIds = new Set<string>();

        if (focusDepth === 2) {
            for (const ind of depResult.indirect) {
                // Find node by path or id in baseNodeMap
                const found = baseNodes.find((n: any) => (n.path && n.path === ind.path) || n.id === ind.path || (n.type === 'file' && n.name === ind.path));
                if (found && found.id !== centerNode.id && !directImportsSet.has(found.id) && !directImportedBySet.has(found.id)) {
                    indirectNodeIds.add(found.id);
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

        const indirectNodes = Array.from(indirectNodeIds)
            .map(id => baseNodeMap.get(id))
            .filter(Boolean)
            .sort((a, b) => {
                const pathA = a.path || a.id;
                const pathB = b.path || b.id;
                const rA = computeRisk(pathA, graph).score;
                const rB = computeRisk(pathB, graph).score;
                return rB - rA || (connectionCounts.get(b.id) || 0) - (connectionCounts.get(a.id) || 0);
            });

        const totalCandidateCount = 1 + importsNodes.length + importedByNodes.length + indirectNodes.length;
        const totalImportersCount = importedByNodes.length;
        const totalIndirectCount = indirectNodes.length;

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
        }

        return {
            displayNodes: displayed,
            totalCandidateCount,
            totalImportersCount,
            totalIndirectCount,
            allIndirectNodes: indirectNodes
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

    const handleViewModeChange = (mode: '2D' | '3D') => {
        setViewMode(mode);
        try {
            localStorage.setItem('graph-view-mode', mode);
        } catch {
            // ignore
        }
    };

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
    }, [selectedFile, setSelectedFile, setSelectedSymbol]);

    const handleDoubleClickNode = useCallback(async (node: any) => {
        if (!node) return;
        const nodePath = node.path || (node.type === 'file' ? node.id : undefined);
        if (nodePath) {
            setActiveTab('Graph');
            await selectFile(nodePath);
        }
    }, [setActiveTab, selectFile]);

    // Single click handler for 3D selection
    const handleSelect3D = useCallback((id: string) => {
        if (!id) return;
        if (selectedFile && selectedFile !== id) {
            setVisitedHistory(prev => {
                const next = [...prev, selectedFile];
                return next.slice(-10);
            });
            lastNavigatedFileRef.current = id;
        }
        setSelectedFile(id);
        setSelectedSymbol(null);
        setResetSignal(prev => prev + 1);
    }, [selectedFile, setSelectedFile, setSelectedSymbol]);

    useEffect(() => {
        setResetSignal(prev => prev + 1);
    }, [selectedFile, isExpanded, focusDepth]);

    // 3D Graph Center and Nodes
    const { g3Center, g3Nodes } = useMemo(() => {
        const targetPath = selectedFile || (baseNodes.length > 0
            ? ([...baseNodes].sort((a, b) => (connectionCounts.get(b.id) || 0) - (connectionCounts.get(a.id) || 0))[0]?.id || '')
            : '');

        const parts = targetPath.replace(/\\/g, '/').split('/').filter(Boolean);
        const centerName = parts.pop() || targetPath || 'root';
        const centerFolder = parts.join('/');
        const center = { id: targetPath, name: centerName, folder: centerFolder };

        if (!targetPath || !graph?.edges) {
            return { g3Center: center, g3Nodes: [] };
        }

        const baseNodeMap = new Map<string, any>(baseNodes.map(n => [n.id, n]));
        let centerNode = baseNodes.find((n: any) => {
            const nPath = n.path || (n.type === 'file' ? n.id : undefined);
            return nPath === targetPath || n.id === targetPath || (n.type === 'file' && n.name === targetPath);
        });
        if (!centerNode) {
            return { g3Center: center, g3Nodes: [] };
        }

        const directImportsSet = new Set<string>();
        const directImportedBySet = new Set<string>();

        for (const e of graph.edges) {
            if (e.from === centerNode.id && baseNodeMap.has(e.to)) {
                directImportsSet.add(e.to);
            }
            if (e.to === centerNode.id && baseNodeMap.has(e.from)) {
                directImportedBySet.add(e.from);
            }
        }
        directImportsSet.delete(centerNode.id);
        directImportedBySet.delete(centerNode.id);

        const depResult = getFileDependents(graph, targetPath);
        const indirectNodeIds = new Set<string>();

        if (focusDepth === 2) {
            for (const ind of depResult.indirect) {
                const found = baseNodes.find((n: any) => (n.path && n.path === ind.path) || n.id === ind.path || (n.type === 'file' && n.name === ind.path));
                if (found && found.id !== centerNode.id && !directImportsSet.has(found.id) && !directImportedBySet.has(found.id)) {
                    indirectNodeIds.add(found.id);
                }
            }
        }

        const toG3 = (n: any, kind: 'imports' | 'importedBy' | 'indirect', via?: string): G3Node => {
            const raw = (n as any).path || (n.type === 'file' ? n.id : '') || n.id || '';
            const p = raw.replace(/\\/g, '/').split('/').filter(Boolean);
            const nm = p.pop() || (n as any).name || raw;
            const fol = p.join('/');
            let risk = 0;
            if (graph) {
                try {
                    risk = computeRisk(raw, graph).score || 0;
                } catch {
                    risk = 0;
                }
            }
            return { id: raw, name: nm, folder: fol, risk, kind, via };
        };

        const imports = Array.from(directImportsSet)
            .map(id => baseNodeMap.get(id))
            .filter(Boolean)
            .sort((a, b) => (connectionCounts.get(b.id) || 0) - (connectionCounts.get(a.id) || 0))
            .map(n => toG3(n, 'imports'));

        const importedByAll = Array.from(directImportedBySet)
            .map(id => baseNodeMap.get(id))
            .filter(Boolean)
            .sort((a, b) => (connectionCounts.get(b.id) || 0) - (connectionCounts.get(a.id) || 0));

        const visibleImportedBy = showAllNodes ? importedByAll : importedByAll.slice(0, 12);
        const importedBy = visibleImportedBy.map(n => toG3(n, 'importedBy'));

        // BFS to find the closest visible direct node for each indirect node
        const adj = new Map<string, string[]>();
        for (const e of graph.edges) {
            if (!adj.has(e.from)) adj.set(e.from, []);
            if (!adj.has(e.to)) adj.set(e.to, []);
            adj.get(e.from)!.push(e.to);
            adj.get(e.to)!.push(e.from);
        }

        const viaMap = new Map<string, string>();
        const bfsQueue: string[] = [];
        const visitedBfs = new Set<string>();

        if (centerNode.id) visitedBfs.add(centerNode.id);
        const centerPath = (centerNode as any).path;
        if (centerPath) visitedBfs.add(centerPath);

        const visibleDirectList = [...imports, ...importedBy];
        const visibleDirectIds = new Set<string>(visibleDirectList.map(v => v.id));

        for (const dirNode of [...Array.from(directImportsSet), ...visibleImportedBy.map(n => n.id)]) {
            const bNode = baseNodeMap.get(dirNode) as any;
            if (!bNode) continue;
            const g3Id = toG3(bNode, 'imports').id;
            if (!visibleDirectIds.has(g3Id)) continue;

            viaMap.set(dirNode, g3Id);
            if (bNode.path) viaMap.set(bNode.path, g3Id);
            visitedBfs.add(dirNode);
            if (bNode.path) visitedBfs.add(bNode.path);
            bfsQueue.push(dirNode);
        }

        let qHead = 0;
        while (qHead < bfsQueue.length) {
            const curr = bfsQueue[qHead++];
            const parentG3Id = viaMap.get(curr)!;
            const neighbors = adj.get(curr) || [];
            for (const nbr of neighbors) {
                if (!visitedBfs.has(nbr)) {
                    visitedBfs.add(nbr);
                    viaMap.set(nbr, parentG3Id);
                    bfsQueue.push(nbr);
                }
            }
        }

        const indirect = Array.from(indirectNodeIds)
            .map(id => baseNodeMap.get(id))
            .filter(Boolean)
            .sort((a: any, b: any) => {
                const pathA = a.path || a.id;
                const pathB = b.path || b.id;
                const rA = computeRisk(pathA, graph).score;
                const rB = computeRisk(pathB, graph).score;
                return rB - rA || (connectionCounts.get(b.id) || 0) - (connectionCounts.get(a.id) || 0);
            })
            .map((n: any) => {
                const via = viaMap.get(n.id) || (n.path ? viaMap.get(n.path) : undefined);
                return toG3(n, 'indirect', via);
            });

        return {
            g3Center: center,
            g3Nodes: [...imports, ...importedBy, ...indirect]
        };
    }, [selectedFile, baseNodes, connectionCounts, graph, focusDepth, showAllNodes]);

    return (
        <div
            ref={containerRef}
            className={cn(
                "bg-[#07090A] overflow-hidden select-none",
                isExpanded
                    ? "fixed inset-0 h-[100dvh] w-screen z-50 overflow-hidden flex flex-col"
                    : "w-full h-full rounded-lg border border-zinc-800/50 relative"
            )}
            style={{ cursor: viewMode === '3D' ? 'grab' : 'default', touchAction: 'none' }}
        >
            {/* View Mode & Toolbar */}
            <div className="absolute top-3.5 left-3.5 z-30 glass-surface bg-[rgba(16,20,21,0.85)] backdrop-blur-md rounded-lg p-1.5 flex items-center gap-2 border border-white/10 shadow-lg text-xs font-mono select-none flex-nowrap overflow-x-auto scrollbar-none max-w-[calc(100%-60px)] sm:max-w-[calc(100%-20px)]">
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

                {viewMode !== '3D' && (
                    <>
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
                    </>
                )}

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

                <div className="h-3.5 w-[1px] bg-white/10" />

                {/* Status pill merged into toolbar row (right side) */}
                <div className="flex items-center gap-1.5 text-xs text-[#8A918C] px-1 font-mono">
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
                                onClick={() => {
                                    if (focusDepth === 2 && totalIndirectCount > 30) {
                                        setShowIndirectListModal(true);
                                    } else {
                                        setShowAllNodes(true);
                                    }
                                }}
                                className="text-[#4FD1B5] hover:underline font-medium cursor-pointer"
                            >
                                Show all
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* In expanded mode, collapsible details button and drawer */}
            {isExpanded && (
                <>
                    <button
                        onClick={() => setDetailsOpen(prev => !prev)}
                        className={cn(
                            "absolute top-3.5 right-3.5 z-30 px-3 py-1.5 rounded-lg border text-xs font-mono transition-all cursor-pointer shadow-lg backdrop-blur-md flex items-center gap-1.5",
                            detailsOpen
                                ? "bg-[#4FD1B5] text-[#04100D] border-[#4FD1B5] font-medium"
                                : "glass-surface bg-[rgba(16,20,21,0.85)] border-white/10 text-[#8A918C] hover:text-[#E8EAE6]"
                        )}
                        title={detailsOpen ? "Close details panel" : "Open details panel"}
                    >
                        <span>Details</span>
                        {detailsOpen ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
                    </button>

                    {detailsOpen && (
                        <div className="absolute top-12 right-3.5 z-30 w-80 max-h-[calc(100dvh-4rem)] overflow-hidden glass-surface bg-[rgba(16,20,21,0.92)] backdrop-blur-md border border-white/10 rounded-xl shadow-2xl flex flex-col">
                            <RightPanel className="border-l-0 h-full max-h-[calc(100dvh-4rem)]" />
                        </div>
                    )}
                </>
            )}

            {/* Main Graph View: 2D or 3D */}
            {viewMode === '2D' ? (
                <div className={cn("w-full h-full transition-all", isExpanded && detailsOpen && "pr-80")}>
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
                        hasDetailsOffset={isExpanded && detailsOpen}
                        showAllNodes={showAllNodes}
                    />
                </div>
            ) : (
                <div className={cn("w-full h-full transition-all relative", isExpanded && detailsOpen && "pr-80")}>
                    <Graph3D
                        center={g3Center}
                        nodes={g3Nodes}
                        onSelect={handleSelect3D}
                        resetSignal={resetSignal}
                    />
                </div>
            )}

            {/* Legend (desktop: compact horizontal strip, mobile: "i" button popover) */}
            {isDesktop ? (
                <div className={cn(
                    "absolute top-[3.75rem] z-20 h-8 px-2.5 glass-surface bg-[rgba(16,22,26,0.92)] backdrop-blur-md rounded-lg border border-white/10 shadow-lg flex items-center gap-3 text-[11px] font-mono text-[#8A918C] select-none pointer-events-auto",
                    isExpanded ? "right-32" : "right-3.5"
                )}>
                    <div className="flex items-center gap-1.5">
                        <svg width="18" height="8" viewBox="0 0 18 8" className="inline-block shrink-0">
                            <line x1="1" y1="4" x2="13" y2="4" stroke="#4FD1B5" strokeWidth="1.5" />
                            <polygon points="12,1.5 17,4 12,6.5" fill="#4FD1B5" />
                        </svg>
                        <span className="text-[#E8EAE6]">Imports</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <svg width="18" height="8" viewBox="0 0 18 8" className="inline-block shrink-0">
                            <line x1="1" y1="4" x2="13" y2="4" stroke="#F0B35F" strokeWidth="1.5" />
                            <polygon points="12,1.5 17,4 12,6.5" fill="#F0B35F" />
                        </svg>
                        <span className="text-[#E8EAE6]">Imported by</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <svg width="18" height="8" viewBox="0 0 18 8" className="inline-block shrink-0">
                            <line x1="1" y1="4" x2="13" y2="4" stroke="#7C8A93" strokeWidth="1.5" strokeDasharray="3 3" />
                            <polygon points="12,1.5 17,4 12,6.5" fill="#7C8A93" />
                        </svg>
                        <span className="text-[#E8EAE6]">Indirect</span>
                    </div>
                    <div className="h-3 w-[1px] bg-white/10" />
                    <span className="text-[#8A918C]">Size = risk</span>
                    {showCalls && viewMode !== '3D' && (
                        <div className="flex items-center gap-1.5">
                            <svg width="18" height="8" viewBox="0 0 18 8" className="inline-block shrink-0">
                                <line x1="1" y1="4" x2="13" y2="4" stroke="#6F8F9A" strokeWidth="1.5" strokeDasharray="1.5 2" />
                                <polygon points="12,1.5 17,4 12,6.5" fill="#6F8F9A" />
                            </svg>
                            <span className="text-[#E8EAE6]">Calls</span>
                        </div>
                    )}
                </div>
            ) : (
                <div className="absolute top-3.5 right-3.5 z-30">
                    <button
                        type="button"
                        onClick={() => setMobileLegendOpen(!mobileLegendOpen)}
                        className="w-8 h-8 rounded-lg glass-surface bg-[rgba(16,22,26,0.92)] backdrop-blur-md border border-white/10 flex items-center justify-center text-[#8A918C] hover:text-[#E8EAE6] cursor-pointer shadow-lg"
                        title="Legend"
                    >
                        <Info size={14} />
                    </button>
                    {mobileLegendOpen && (
                        <div className="absolute right-0 top-10 z-40 p-3 glass-surface bg-[rgba(16,22,26,0.96)] backdrop-blur-md rounded-xl border border-white/10 shadow-2xl flex flex-col gap-2 text-xs font-mono text-[#8A918C] min-w-[160px]">
                            <div className="flex items-center gap-2">
                                <svg width="18" height="8" viewBox="0 0 18 8" className="inline-block shrink-0">
                                    <line x1="1" y1="4" x2="13" y2="4" stroke="#4FD1B5" strokeWidth="1.5" />
                                    <polygon points="12,1.5 17,4 12,6.5" fill="#4FD1B5" />
                                </svg>
                                <span className="text-[#E8EAE6]">Imports</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <svg width="18" height="8" viewBox="0 0 18 8" className="inline-block shrink-0">
                                    <line x1="1" y1="4" x2="13" y2="4" stroke="#F0B35F" strokeWidth="1.5" />
                                    <polygon points="12,1.5 17,4 12,6.5" fill="#F0B35F" />
                                </svg>
                                <span className="text-[#E8EAE6]">Imported by</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <svg width="18" height="8" viewBox="0 0 18 8" className="inline-block shrink-0">
                                    <line x1="1" y1="4" x2="13" y2="4" stroke="#7C8A93" strokeWidth="1.5" strokeDasharray="3 3" />
                                    <polygon points="12,1.5 17,4 12,6.5" fill="#7C8A93" />
                                </svg>
                                <span className="text-[#E8EAE6]">Indirect</span>
                            </div>
                            <div className="text-[10px] text-[#8A918C] border-t border-white/10 pt-1">
                                Size = risk
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Hint text (bottom-centre): non-overlapping controls guide */}
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 px-3.5 py-1.5 glass-surface bg-[rgba(16,22,26,0.85)] backdrop-blur-md rounded-full border border-white/10 text-[11px] font-mono text-[#8A918C] select-none pointer-events-none shadow-md flex items-center gap-2">
                <span>Drag to rotate, scroll to zoom, click a cube to select</span>
            </div>

            {/* Scrollable list modal for Indirect files when M > 30 */}
            {showIndirectListModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                    <div className="bg-[#10161A] border border-white/10 rounded-xl shadow-2xl max-w-lg w-full max-h-[80vh] flex flex-col overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-[#151C22]">
                            <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-[#8A918C]" />
                                <h3 className="text-sm font-semibold text-[#E8EAE6] font-mono">
                                    Indirect Dependents ({allIndirectNodes.length})
                                </h3>
                            </div>
                            <button
                                onClick={() => setShowIndirectListModal(false)}
                                className="text-[#8A918C] hover:text-[#E8EAE6] p-1 rounded hover:bg-white/[0.06] text-xs font-mono"
                            >
                                ✕ Close
                            </button>
                        </div>
                        <div className="p-3 overflow-y-auto divide-y divide-white/5 space-y-1">
                            {allIndirectNodes.map((node: any) => {
                                const path = node.path || node.id;
                                const name = node.name || (path ? path.split('/').pop() : node.id);
                                const risk = computeRisk(path, graph).score;
                                return (
                                    <div
                                        key={node.id}
                                        onClick={() => {
                                            setShowIndirectListModal(false);
                                            handleSelectNode(node);
                                        }}
                                        className="flex items-center justify-between p-2 rounded hover:bg-white/[0.04] cursor-pointer group transition-colors"
                                    >
                                        <div className="flex flex-col min-w-0 pr-2">
                                            <span className="text-xs font-mono text-[#E8EAE6] group-hover:text-[#4FD1B5] truncate">
                                                {name}
                                            </span>
                                            <span className="text-[10px] font-mono text-[#8A918C] truncate">
                                                {path}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] font-mono text-[#8A918C]">
                                                Risk {risk}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
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

function formatChatDate(timestamp: number): string {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function getStarterQuestionsForTarget(file: string | null, attachedImagesCount: number): string[] {
    if (attachedImagesCount > 0) {
        return [
            "What error is shown here?",
            "Where in this file is this UI implemented?",
            "How do I fix what's shown here?"
        ];
    }
    const lowerFile = (file || '').toLowerCase();
    const fileName = lowerFile.split('/').pop() || '';
    const isTest = isTestFile(file || '') || /\.(test|spec)\.[a-z0-9]+$/i.test(fileName) || /tests?\/|__tests?__\//i.test(lowerFile);
    const isConfig = /\.(json|ya?ml|toml|ini|env|xml|config|rc|properties)$/i.test(fileName) || /config|\.config\./i.test(fileName);
    const isApiClient = /api|client|endpoint|router|service|controller|route/i.test(lowerFile);

    if (isTest) {
        return ["What does this test cover?", "How do I run this test?", "What is mocked in this test?"];
    }
    if (isConfig) {
        return ["Explain this configuration", "What are the environment dependencies?", "Is anything deprecated?"];
    }
    if (isApiClient) {
        return ["Who calls this?", "Explain endpoints exposed", "Error handling patterns"];
    }
    return ["Which tests cover this file?", "Why is the risk score high?", "Summarize recent changes"];
}

const healthDataCache = new Map<string, import('../api').HealthSummaryResult>();
const healthInFlightPromises = new Map<string, Promise<import('../api').HealthSummaryResult>>();

export function MainPanel({ className }: { className?: string }) {
    const {
        activeTab, setActiveTab, selectedFile, setSelectedFile,
        selectedSymbol, impactResult, setImpactResult, graph, setGraph,
        repoUrl, selectedSha, setCodeHighlightLine, selectFile,
        changeSet, addToChangeSet, removeFromChangeSet, clearChangeSet,
        changeSetResult, setChangeSetResult, changeSetLoading, setChangeSetLoading,
        treeFiles, setTreeFiles, commits, selectedHistoryCommit, setSelectedHistoryCommit,
        setAiCitations, setAiEvidence, setAiEvidenceTitle, meta,
        getAskAiState, loadAskAiChatsFromStorage, switchAskAiFile,
        setActiveAskAiChat, setAskAiMessages, saveAskAiMessages,
        setAskAiDraft, setAskAiScrollPos, setAskAiAttachedImages,
        setAskAiMode, setAskAiScope, setAskAiChatExpanded,
        setAskAiSelectedAnswerIdx, setAskAiExpandedEvidenceOpen,
        setAskAiError, setAskAiRateLimitCountdown,
        startAskAiStreaming, appendAskAiStreamingToken, finishAskAiStreaming,
        handleAskAiStreamError, stopAskAiStreaming, newAskAiChat,
        deleteAskAiChat, renameAskAiChat, clearAskAiMessages,
        mobileDetailsOpen, setMobileDetailsOpen
    } = useAppStore();
    const { isPhone, isTablet, isDesktop } = useResponsive();

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
    const repoAskAi = getAskAiState(repoUrl, selectedSha);
    const chats = repoAskAi.chats;
    const activeChatId = repoAskAi.activeChatId;
    const chatMessages = repoAskAi.chatMessages;
    const attachedImages = repoAskAi.attachedImages;
    const askMode = repoAskAi.askMode;
    const askScope = repoAskAi.askScope;
    const isChatExpanded = repoAskAi.isChatExpanded;
    const selectedAnswerIdx = repoAskAi.selectedAnswerIdx;
    const expandedEvidenceOpen = repoAskAi.expandedEvidenceOpen;
    const isStreaming = repoAskAi.isStreaming;
    const aiError = repoAskAi.aiError;
    const rateLimitCountdown = repoAskAi.rateLimitCountdown;

    const askQ = (activeChatId && repoAskAi.draftByChat[activeChatId]) ?? '';
    const setAskQ = useCallback((val: string) => {
        if (activeChatId) {
            setAskAiDraft(activeChatId, val);
        }
    }, [activeChatId, setAskAiDraft]);

    const setChatMessages = useCallback((msgsOrUpdater: AskChatMessage[] | ((prev: AskChatMessage[]) => AskChatMessage[])) => {
        const next = typeof msgsOrUpdater === 'function' ? msgsOrUpdater(repoAskAi.chatMessages) : msgsOrUpdater;
        setAskAiMessages(next);
    }, [repoAskAi.chatMessages, setAskAiMessages]);

    const setActiveChatId = useCallback((id: string | null) => {
        setActiveAskAiChat(id, selectedFile);
    }, [selectedFile, setActiveAskAiChat]);

    const setAttachedImages = useCallback((imgsOrUpdater: AttachedImage[] | ((prev: AttachedImage[]) => AttachedImage[])) => {
        const next = typeof imgsOrUpdater === 'function' ? imgsOrUpdater(repoAskAi.attachedImages) : imgsOrUpdater;
        setAskAiAttachedImages(next);
    }, [repoAskAi.attachedImages, setAskAiAttachedImages]);

    const setAskMode = useCallback((mode: import('../api').AskMode) => {
        setAskAiMode(mode);
    }, [setAskAiMode]);

    const setAskScope = useCallback((scope: import('../api').AskScope) => {
        setAskAiScope(scope);
    }, [setAskAiScope]);

    const setIsChatExpanded = useCallback((expandedOrUpdater: boolean | ((prev: boolean) => boolean)) => {
        const next = typeof expandedOrUpdater === 'function' ? expandedOrUpdater(repoAskAi.isChatExpanded) : expandedOrUpdater;
        setAskAiChatExpanded(next);
    }, [repoAskAi.isChatExpanded, setAskAiChatExpanded]);

    const setSelectedAnswerIdx = useCallback((idxOrUpdater: number | null | ((prev: number | null) => number | null)) => {
        const next = typeof idxOrUpdater === 'function' ? idxOrUpdater(repoAskAi.selectedAnswerIdx) : idxOrUpdater;
        setAskAiSelectedAnswerIdx(next);
    }, [repoAskAi.selectedAnswerIdx, setAskAiSelectedAnswerIdx]);

    const setExpandedEvidenceOpen = useCallback((openOrUpdater: boolean | ((prev: boolean) => boolean)) => {
        const next = typeof openOrUpdater === 'function' ? openOrUpdater(repoAskAi.expandedEvidenceOpen) : openOrUpdater;
        setAskAiExpandedEvidenceOpen(next);
    }, [repoAskAi.expandedEvidenceOpen, setAskAiExpandedEvidenceOpen]);

    const setAiError = useCallback((errOrUpdater: any) => {
        const next = typeof errOrUpdater === 'function' ? errOrUpdater(repoAskAi.aiError) : errOrUpdater;
        setAskAiError(next);
    }, [repoAskAi.aiError, setAskAiError]);

    const setRateLimitCountdown = useCallback((countOrUpdater: number | ((prev: number) => number)) => {
        const next = typeof countOrUpdater === 'function' ? countOrUpdater(repoAskAi.rateLimitCountdown) : countOrUpdater;
        setAskAiRateLimitCountdown(next);
    }, [repoAskAi.rateLimitCountdown, setAskAiRateLimitCountdown]);

    const [chatSearchQuery, setChatSearchQuery] = useState('');
    const [normalChatsOpen, setNormalChatsOpen] = useState(false);
    const [copiedMsgIdx, setCopiedMsgIdx] = useState<number | null>(null);
    const [copiedUserMsgIdx, setCopiedUserMsgIdx] = useState<number | null>(null);
    const [editingMessageIdx, setEditingMessageIdx] = useState<number | null>(null);
    const [editingHasMissingImages, setEditingHasMissingImages] = useState(false);
    const [imageWarning, setImageWarning] = useState<string | null>(null);
    const [askWaitingPhase, setAskWaitingPhase] = useState<'reading' | 'thinking'>('reading');
    const [isDraggingOverChat, setIsDraggingOverChat] = useState(false);
    const [lightboxImage, setLightboxImage] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const normalChatsBtnRef = useRef<HTMLButtonElement | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const chatScrollContainerRef = useRef<HTMLDivElement | null>(null);

    const lastAssistantIdx = useMemo(() => {
        for (let i = chatMessages.length - 1; i >= 0; i--) {
            if (chatMessages[i].role === 'assistant' && !chatMessages[i].isThinking) {
                return i;
            }
        }
        return -1;
    }, [chatMessages]);

    const lastUserIdx = useMemo(() => {
        for (let i = chatMessages.length - 1; i >= 0; i--) {
            if (chatMessages[i].role === 'user') {
                return i;
            }
        }
        return -1;
    }, [chatMessages]);

    const activeAssistantIdx = useMemo(() => {
        if (selectedAnswerIdx !== null && selectedAnswerIdx >= 0 && selectedAnswerIdx < chatMessages.length) {
            if (chatMessages[selectedAnswerIdx]?.role === 'assistant') {
                return selectedAnswerIdx;
            }
        }
        return lastAssistantIdx !== -1 ? lastAssistantIdx : null;
    }, [selectedAnswerIdx, chatMessages, lastAssistantIdx]);

    const getAnswerNumber = useCallback((msgIdx: number) => {
        let count = 0;
        for (let i = 0; i <= msgIdx && i < chatMessages.length; i++) {
            if (chatMessages[i].role === 'assistant') count++;
        }
        return count;
    }, [chatMessages]);

    const activeAnswerNumber = activeAssistantIdx !== null ? getAnswerNumber(activeAssistantIdx) : null;
    const activeAssistantMsg = activeAssistantIdx !== null ? chatMessages[activeAssistantIdx] : null;
    const activeEvidence = useMemo(() => activeAssistantMsg?.evidence || [], [activeAssistantMsg]);

    const hasLineCitations = useCallback((text?: string) => {
        if (!text) return false;
        return /\b(lines?\s+\d+(?:-\d+)?|l\d+(?:-l?\d+)?)\b|:\d+(?:-\d+)?\b/i.test(text);
    }, []);

    const getPrecedingUserQuestion = useCallback((msgIdx: number) => {
        for (let i = msgIdx - 1; i >= 0; i--) {
            if (chatMessages[i]?.role === 'user') {
                return chatMessages[i].content;
            }
        }
        return '';
    }, [chatMessages]);

    const getPrecedingUserMessage = useCallback((msgIdx: number) => {
        for (let i = msgIdx - 1; i >= 0; i--) {
            if (chatMessages[i]?.role === 'user') {
                return chatMessages[i];
            }
        }
        return null;
    }, [chatMessages]);

    const isBriefCountAnswerWithoutLineCitation = useCallback((msg: AskChatMessage, prevQuestion?: string) => {
        if (msg.role !== 'assistant') return false;
        const mode = (msg.usedContext as any)?.mode || askMode;
        const isBrief = mode === 'brief';
        const isCount = Boolean(prevQuestion && /\b(how\s+many|kitne)\b/i.test(prevQuestion));
        if (!isBrief && !isCount) return false;
        return !hasLineCitations(msg.content);
    }, [askMode, hasLineCitations]);

    const isActiveBriefCountSuppressed = useMemo(() => {
        if (!activeAssistantMsg || activeAssistantIdx === null) return false;
        const prevQ = getPrecedingUserQuestion(activeAssistantIdx);
        return isBriefCountAnswerWithoutLineCitation(activeAssistantMsg, prevQ);
    }, [activeAssistantMsg, activeAssistantIdx, getPrecedingUserQuestion, isBriefCountAnswerWithoutLineCitation]);

    const activeIsImageQuestion = useMemo(() => {
        if (!activeAssistantMsg || activeAssistantIdx === null) return false;
        const prevUserMsg = getPrecedingUserMessage(activeAssistantIdx);
        return Boolean(prevUserMsg?.images && prevUserMsg.images.length > 0);
    }, [activeAssistantMsg, activeAssistantIdx, getPrecedingUserMessage]);

    const askedQuestions = useMemo(() => {
        return chatMessages
            .filter(m => m.role === 'user')
            .map(m => m.content.toLowerCase().trim());
    }, [chatMessages]);

    const isQuestionAlreadyAsked = useCallback((q: string) => {
        const norm = q.toLowerCase().trim();
        if (!norm) return false;
        return askedQuestions.some(asked => asked.includes(norm) || norm.includes(asked));
    }, [askedQuestions]);

    useEffect(() => {
        if (activeEvidence.length > 0 && !isActiveBriefCountSuppressed) {
            setExpandedEvidenceOpen(true);
        }
    }, [activeEvidence.length, isActiveBriefCountSuppressed]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                if (activeTab === 'AskAI') {
                    e.preventDefault();
                    textareaRef.current?.focus();
                }
            } else if (e.key === '/' && activeTab === 'AskAI') {
                const activeEl = document.activeElement;
                const isInput = activeEl?.tagName === 'INPUT' || activeEl?.tagName === 'TEXTAREA' || (activeEl as HTMLElement)?.isContentEditable;
                if (!isInput) {
                    e.preventDefault();
                    textareaRef.current?.focus();
                }
            } else if (e.key === 'Escape') {
                if (lightboxImage) {
                    setLightboxImage(null);
                } else if (isStreaming) {
                    stopAskAiStreaming();
                } else if (isChatExpanded) {
                    setIsChatExpanded(false);
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isChatExpanded, activeTab, lightboxImage, isStreaming, stopAskAiStreaming]);



    useEffect(() => {
        if (isChatExpanded) {
            const prevOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            return () => {
                document.body.style.overflow = prevOverflow;
            };
        }
    }, [isChatExpanded]);

    useEffect(() => {
        if (aiError?.code === 'rate_limited' && (aiError.retryAfterSeconds ?? 0) > 0) {
            setRateLimitCountdown(aiError.retryAfterSeconds!);
        } else {
            setRateLimitCountdown(0);
        }
    }, [aiError]);

    useEffect(() => {
        if (rateLimitCountdown <= 0) return;
        const interval = setInterval(() => {
            setRateLimitCountdown(prev => {
                if (prev <= 1) {
                    clearInterval(interval);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [rateLimitCountdown]);
    const [historyData, setHistoryData] = useState<any[] | null>(null);
    const [healthData, setHealthData] = useState<import('../api').HealthSummaryResult | null>(null);
    const [healthLoading, setHealthLoading] = useState(false);
    const [healthError, setHealthError] = useState<{ message: string; status?: number; code?: string } | null>(null);
    const [analyzeError, setAnalyzeError] = useState<{ message: string; status?: number; code?: string } | null>(null);
    const [impactError, setImpactError] = useState<{ message: string; status?: number; code?: string } | null>(null);
    const [changeSetError, setChangeSetError] = useState<{ message: string; status?: number; code?: string } | null>(null);
    const [openHealthSections, setOpenHealthSections] = useState({ circular: true, unused: true, god: true });
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const [showImpactReasons, setShowImpactReasons] = useState(true);
    const [hoveredImpactNode, setHoveredImpactNode] = useState<{ path: string; name: string; folder: string; score: number; type: 'direct' | 'indirect'; hops?: number; x: number; y: number } | null>(null);
    const [copiedReport, setCopiedReport] = useState(false);

    const [drawerFile, setDrawerFile] = useState<string | null>(null);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [impactSheetOpen, setImpactSheetOpen] = useState(false);
    const [impactSearchQuery, setImpactSearchQuery] = useState('');

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

    // 1. Initial load effect: loads from localStorage only if store is empty
    useEffect(() => {
        if (repoUrl) {
            loadAskAiChatsFromStorage(repoUrl, selectedSha, selectedFile);
        }
    }, [repoUrl, selectedSha, loadAskAiChatsFromStorage]);

    // 2. Load-chat-on-file-change effect: restores last active chat of file or empty state
    useEffect(() => {
        if (repoUrl && selectedFile) {
            switchAskAiFile(selectedFile);
        }
    }, [repoUrl, selectedSha, selectedFile, switchAskAiFile]);

    // 3. Restore chat scroll position on activeChatId or tab change
    useEffect(() => {
        if (activeTab === 'AskAI' && chatScrollContainerRef.current && activeChatId) {
            const savedPos = repoAskAi.scrollPosByChat[activeChatId] ?? 0;
            chatScrollContainerRef.current.scrollTop = savedPos;
        }
    }, [activeTab, activeChatId]);

    // 4. Keep aiEvidence in sync with the active assistant message
    useEffect(() => {
        if (activeAssistantMsg?.mode && activeAssistantMsg.mode !== 'repo') {
            setAiEvidence([]);
            setAiCitations([]);
            setAiEvidenceTitle?.(null);
            return;
        }
        if (activeAssistantMsg && activeAssistantMsg.evidence && activeAssistantMsg.evidence.length > 0 && !isActiveBriefCountSuppressed) {
            setAiEvidence(activeAssistantMsg.evidence);
            setAiCitations(activeAssistantMsg.evidence.map(e => e.path + (e.line !== undefined ? `:${e.line}` : '')));
        } else {
            setAiEvidence([]);
            setAiCitations([]);
        }
        if (activeAnswerNumber) {
            setAiEvidenceTitle?.(
                (activeIsImageQuestion && activeEvidence.length === 0) || isActiveBriefCountSuppressed
                    ? "No evidence needed for this answer"
                    : `Evidence for answer #${activeAnswerNumber}`
            );
        } else {
            setAiEvidenceTitle?.(null);
        }
    }, [activeAssistantIdx, activeAssistantMsg, activeAnswerNumber, activeEvidence.length, activeIsImageQuestion, isActiveBriefCountSuppressed, setAiEvidence, setAiCitations, setAiEvidenceTitle]);

    const handleAttachFiles = useCallback(async (files: FileList | File[]) => {
        setImageWarning(null);
        const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
        if (imageFiles.length === 0) return;

        if (attachedImages.length + imageFiles.length > 3) {
            setImageWarning("Maximum 3 images can be attached.");
            setTimeout(() => setImageWarning(null), 3000);
        }

        const availableSlots = Math.max(0, 3 - attachedImages.length);
        const toProcess = imageFiles.slice(0, availableSlots);
        const processed: AttachedImage[] = [];
        for (const f of toProcess) {
            const item = await processImageFile(f);
            if (item) processed.push(item);
        }
        if (processed.length > 0) {
            setAttachedImages(prev => [...prev, ...processed].slice(0, 3));
        }
    }, [attachedImages.length, setAttachedImages]);

    const filteredChats = useMemo(() => {
        if (!chatSearchQuery.trim()) return chats;
        const q = chatSearchQuery.toLowerCase();
        return chats.filter(c =>
            c.title.toLowerCase().includes(q) ||
            c.file.toLowerCase().includes(q) ||
            c.messages.some(m => m.content.toLowerCase().includes(q))
        );
    }, [chats, chatSearchQuery]);

    const chatsGroupedByFile = useMemo(() => {
        const groups: Record<string, AskChat[]> = {};
        for (const chat of filteredChats) {
            if (!groups[chat.file]) groups[chat.file] = [];
            groups[chat.file].push(chat);
        }
        return groups;
    }, [filteredChats]);

    useEffect(() => {
        if (!askQ && textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }
    }, [askQ]);

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
            lines.push(`No test covers this file.`);
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

    const handleExportChatMarkdown = () => {
        const curChat = chats.find(c => c.id === activeChatId);
        const title = curChat?.title || selectedFile?.split('/').pop() || 'chat';
        const md = `# Ask AI: ${title}
File: \`${selectedFile || 'unknown'}\`
Date: ${new Date().toLocaleString()}

${chatMessages.map(m => `### ${m.role === 'user' ? 'User' : 'AI'}\n${m.content}\n${m.evidence && m.evidence.length > 0 ? `\n**Evidence:**\n${m.evidence.map(e => `- \`${e.path}${e.line !== undefined ? `:${e.line}${e.endLine && e.endLine !== e.line ? `-${e.endLine}` : ''}` : ''}\``).join('\n')}\n` : ''}`).join('\n')}
`;
        downloadTextFile(`ask-ai-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`, md);
    };

    const handleCopyLastAnswer = async () => {
        const lastAssistant = [...chatMessages].reverse().find(m => m.role === 'assistant' && !m.isThinking);
        if (lastAssistant && navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(lastAssistant.content);
        }
    };

    const handleCopyChatPRComment = async () => {
        const lastAssistant = [...chatMessages].reverse().find(m => m.role === 'assistant' && !m.isThinking);
        if (!lastAssistant) return;
        const evidenceList = lastAssistant.evidence && lastAssistant.evidence.length > 0
            ? `\n\n#### Evidence\n${lastAssistant.evidence.map(e => `- \`${e.path}${e.line !== undefined ? `:${e.line}${e.endLine && e.endLine !== e.line ? `-${e.endLine}` : ''}` : ''}\``).join('\n')}`
            : '';
        const md = `### AI Analysis
${lastAssistant.content}${evidenceList}
`;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(md);
        }
    };

    const handleNewChat = useCallback(() => {
        newAskAiChat(selectedFile);
    }, [newAskAiChat, selectedFile]);

    const handleRenameChat = useCallback((chatId: string, currentTitle: string) => {
        const title = window.prompt('Rename chat:', currentTitle);
        if (title && title.trim()) {
            renameAskAiChat(chatId, title.trim());
        }
    }, [renameAskAiChat]);

    const handleDeleteChat = useCallback((chatId: string) => {
        if (window.confirm('Delete this chat?')) {
            deleteAskAiChat(chatId);
        }
    }, [deleteAskAiChat]);

    const handleClearMessages = useCallback(() => {
        if (window.confirm('Clear all messages in this chat?')) {
            clearAskAiMessages();
        }
    }, [clearAskAiMessages]);

    const reanalyzeRepo = async () => {
        if (!repoUrl || !selectedSha) return;
        setAnalyzing(true);
        setAnalyzeError(null);
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
        } catch (e: any) {
            console.error('Re-analyze repo failed', e);
            setAnalyzeError({
                message: typeof e?.message === 'string' ? e.message : 'Re-analyze repository failed',
                status: e?.status,
                code: e?.code
            });
        } finally {
            setAnalyzing(false);
        }
    };

    const analyzeChangeSet = async () => {
        if (!graph || changeSet.length === 0) return;
        setChangeSetLoading(true);
        setChangeSetError(null);
        try {
            const res = await api.graph.impactBatch(graph, changeSet);
            setChangeSetResult(res);
        } catch (err: any) {
            console.error("Batch impact failed", err);
            setChangeSetError({
                message: typeof err?.message === 'string' ? err?.message : 'Failed to analyze plan',
                status: err?.status,
                code: err?.code
            });
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


    const formatAiError = (err: any): { message: string; backendMessage?: string; status?: number; code?: string; retryAfterSeconds?: number } => {
        const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
        const rawCode = String(err?.code || (err?.data && err.data.code) || '').toLowerCase();
        const rawMsg = typeof err?.message === 'string'
            ? err.message
            : (typeof err?.data?.message === 'string'
                ? err.data.message
                : (err instanceof Error ? err.message : (typeof err === 'object' && err ? (err.message || '') : String(err))));
        const combined = `${rawCode} ${rawMsg}`.toLowerCase();

        if (isOffline || rawCode === 'offline' || combined.includes('failed to fetch') || combined.includes('networkerror') || combined.includes('network error')) {
            return {
                code: 'offline',
                message: "You are offline",
                backendMessage: "Reconnect to the internet and retry.",
                status: 0
            };
        }

        const retryAfter = typeof err?.retryAfterSeconds === 'number'
            ? err.retryAfterSeconds
            : (typeof err?.data?.retryAfterSeconds === 'number' ? err.data.retryAfterSeconds : undefined);

        const status = typeof err?.status === 'number'
            ? err.status
            : (typeof err?.data?.status === 'number' ? err.data.status : undefined);

        const rawBackendMsg = (err?.data?.message || err?.message || (typeof err === 'string' ? err : ''));
        const backendMessage = typeof rawBackendMsg === 'string' && rawBackendMsg.trim() ? rawBackendMsg.slice(0, 160) : undefined;

        let friendly = "An unexpected error occurred while communicating with the AI service.";
        let finalCode = rawCode || 'unknown';

        if (rawCode === 'rate_limited' || rawCode === 'github_rate_limited' || combined.includes('rate_limited') || combined.includes('rate_limit')) {
            const sec = retryAfter && retryAfter > 0 ? retryAfter : 30;
            return {
                code: rawCode === 'github_rate_limited' ? 'github_rate_limited' : 'rate_limited',
                message: `Rate limit reached. You can try again in ${sec}s.`,
                backendMessage: backendMessage && !backendMessage.startsWith('Rate limit reached') ? backendMessage : undefined,
                status,
                retryAfterSeconds: sec
            };
        } else if (rawCode === 'github_unreachable' || combined.includes('github_unreachable')) {
            friendly = "Cannot reach GitHub";
            finalCode = 'github_unreachable';
        } else if (rawCode === 'image_failed' || combined.includes('image_failed')) {
            friendly = "Image analysis failed";
            finalCode = 'image_failed';
        } else if (rawCode === 'provider_unavailable' || combined.includes('provider_unavailable') || combined.includes('timeout')) {
            friendly = "AI service unreachable";
            finalCode = 'provider_unavailable';
        } else if (combined.includes('invalid_api_key') || combined.includes('missing_api_key')) {
            friendly = "API key is missing or invalid. Check your .env file.";
            finalCode = 'invalid_api_key';
        } else if (combined.includes('model_not_found')) {
            friendly = "The configured model is not available. Check LLM_MODEL in .env.";
            finalCode = 'model_not_found';
        } else if (combined.includes('insufficient_context')) {
            friendly = "The supplied repository context is insufficient to answer this question.";
            finalCode = 'insufficient_context';
        } else if (combined.includes('oversized_context')) {
            friendly = "Context is too large for this model. Try asking about a single file.";
            finalCode = 'oversized_context';
        } else if (combined.includes('vision_unavailable')) {
            friendly = "Vision analysis is unavailable (missing fallback key). Remove image or configure LLM_FALLBACK_API_KEY.";
            finalCode = 'vision_unavailable';
        } else if (combined.includes('413') || combined.includes('too large') || combined.includes('payload too large') || combined.includes('limit of 3 mb')) {
            friendly = "Image too large, please attach a smaller file.";
            finalCode = 'bad_request';
        } else if (combined.includes('bad_request') || combined.includes('invalid_question') || combined.includes('invalid_graph')) {
            friendly = "The AI request could not be processed. Check the server logs.";
            finalCode = 'bad_request';
        } else if (rawMsg && !rawMsg.startsWith('{') && !rawMsg.includes('JSON')) {
            friendly = rawMsg;
        }

        return {
            message: friendly,
            backendMessage: backendMessage && backendMessage !== friendly ? backendMessage : undefined,
            status,
            code: finalCode,
            retryAfterSeconds: retryAfter
        };
    };

    const handleStopAi = useCallback(() => {
        stopAskAiStreaming();
    }, [stopAskAiStreaming]);

    const askAI = async (
        questionToAsk?: string,
        requestedMode?: import('../api').AskMode,
        requestedScope?: import('../api').AskScope,
        baseMessages?: AskChatMessage[],
        imagesToPass?: AttachedImage[],
        continuation?: {
            targetMsgIndex: number;
            prefixContent: string;
        }
    ) => {
        const imagesToSend = continuation ? [] : (imagesToPass !== undefined ? imagesToPass : attachedImages);
        const q = continuation ? "Continue from where you stopped" : (typeof questionToAsk === 'string' ? questionToAsk : askQ).trim();
        if ((!q && imagesToSend.length === 0) || !repoUrl || !selectedSha || !graph || !selectedFile || isStreaming) return;

        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            handleAskAiStreamError({
                code: 'offline',
                message: 'You are offline',
                backendMessage: 'Reconnect to the internet and retry.',
                status: 0
            });
            return;
        }

        setAskQ('');
        setAttachedImages([]);
        setImageWarning(null);
        setAiError(null);
        setAskWaitingPhase('reading');

        const currentMode = requestedMode || askMode;
        const currentScope = requestedScope || 'auto';

        const pool = baseMessages !== undefined ? baseMessages : chatMessages;
        let newMessages: AskChatMessage[];
        if (continuation) {
            const msgs = [...pool];
            if (continuation.targetMsgIndex >= 0 && continuation.targetMsgIndex < msgs.length) {
                msgs[continuation.targetMsgIndex] = {
                    ...msgs[continuation.targetMsgIndex],
                    isThinking: true,
                    truncated: false
                };
            }
            newMessages = msgs;
        } else {
            const userMsg: AskChatMessage = {
                role: 'user' as const,
                content: q,
                images: imagesToSend.length > 0
                    ? imagesToSend.map(img => ({ mime: img.mime, data: img.data, thumbUrl: img.thumbUrl, name: img.name }))
                    : undefined
            };
            newMessages = [
                ...pool.filter(m => !m.isThinking),
                userMsg,
                { role: 'assistant' as const, content: '', isThinking: true }
            ];
        }

        const target = selectedSymbol
            ? { type: 'symbol', path: selectedSymbol.path, symbol: selectedSymbol }
            : { type: 'file', path: selectedFile };

        const controller = new AbortController();
        const chatId = activeChatId || ('chat_' + Date.now());
        startAskAiStreaming(chatId, controller, newMessages, continuation);

        let historyToSend: Array<{ role: string; content: string }>;
        if (continuation) {
            const priorPool = pool.slice(0, continuation.targetMsgIndex)
                .filter(m => !m.isThinking && (m.content.trim().length > 0 || (m.images && m.images.length > 0)))
                .slice(-3)
                .map(m => {
                    let text = m.content;
                    if (!text && m.images && m.images.length > 0) {
                        text = '[image attached]';
                    }
                    return {
                        role: m.role,
                        content: m.role === 'assistant' && text.length > 600 ? text.slice(-600) : text
                    };
                });
            const lastAssistantSnippet = continuation.prefixContent.slice(-600);
            historyToSend = [
                ...priorPool,
                { role: 'assistant', content: lastAssistantSnippet }
            ];
        } else {
            historyToSend = pool
                .filter(m => !m.isThinking && (m.content.trim().length > 0 || (m.images && m.images.length > 0)))
                .slice(-4)
                .map(m => {
                    let text = m.content;
                    if (!text && m.images && m.images.length > 0) {
                        text = '[image attached]';
                    }
                    return {
                        role: m.role,
                        content: m.role === 'assistant' && text.length > 600 ? text.slice(0, 600) : text
                    };
                });
        }

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

        const imagesPayload = imagesToSend.map(img => ({ mime: img.mime, data: img.data }));

        const topRiskFiles = (graph ? graph.nodes.filter(n => n.type === 'file') : [])
            .map(fn => {
                const p = (fn as any).path || fn.id || '';
                const r = computeRisk(p, graph, commits);
                const deps = getFileDependents(graph, p);
                return {
                    path: p,
                    score: r.score,
                    dependents: deps.directCount
                };
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, 10);

        const ownerCounts: Record<string, number> = {};
        if (commits && commits.length > 0) {
            for (const c of commits) {
                const authorName = (c as any).commit?.author?.name || (c as any).author?.name || (typeof (c as any).author === 'string' ? (c as any).author : '');
                if (authorName) {
                    ownerCounts[authorName] = (ownerCounts[authorName] || 0) + 1;
                }
            }
        }
        const totalCommitsCount = Math.max(1, commits?.length || 0);
        const topOwners = Object.entries(ownerCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([name, count]) => ({
                name,
                share: Math.round((count / totalCommitsCount) * 100)
            }));

        const repoFacts = {
            analyzedFiles: stats.analyzedFiles,
            totalFiles: stats.totalFiles,
            symbols: stats.symbols,
            links: stats.links,
            topRisk: topRiskFiles,
            health: {
                circular: healthData?.circularImports?.length || 0,
                unused: healthData?.unusedFiles?.length || 0,
                godFiles: healthData?.godFiles?.length || 0
            },
            ...(topOwners.length > 0 ? { owners: topOwners } : {})
        };

        const extraContext = {
            risk: currentRisk,
            dependents: currentDependents,
            recentCommits: recentCommitsForFile,
            owners: fileOwners,
            mode: currentMode,
            scope: currentScope,
            images: imagesPayload.length > 0 ? imagesPayload : undefined,
            repoFacts,
            onFirstByte: () => setAskWaitingPhase('thinking')
        };

        try {
            const res = await api.ai.askStream(
                repoUrl,
                selectedSha,
                [selectedFile],
                target as any,
                q,
                historyToSend,
                (token: string) => {
                    appendAskAiStreamingToken(token);
                },
                controller.signal,
                extraContext,
                currentMode,
                currentScope,
                imagesPayload.length > 0 ? imagesPayload : undefined,
                () => setAskWaitingPhase('thinking')
            );

            if (res.status === 'error' && res.error) {
                handleAskAiStreamError(formatAiError(res.error));
            } else {
                finishAskAiStreaming(res);
            }
        } catch (e: any) {
            if (controller.signal.aborted) {
                // Handled by stopAskAiStreaming
            } else {
                const currentRepoKey = getRepoKey(repoUrl, selectedSha);
                const prevRepoState = useAppStore.getState().askAiByRepo[currentRepoKey];
                if (prevRepoState?.accumulatedStreamedText?.trim()) {
                    finishAskAiStreaming({
                        answer: prevRepoState.accumulatedStreamedText,
                        truncated: true
                    });
                } else {
                    handleAskAiStreamError(formatAiError(e));
                }
            }
        } finally {
            setTimeout(() => {
                messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }, 50);
            setTimeout(() => {
                messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }, 180);
        }
    };

    const handleContinueAnswer = useCallback((msgIdx: number) => {
        if (isStreaming || rateLimitCountdown > 0) return;
        const targetMsg = chatMessages[msgIdx];
        if (!targetMsg || targetMsg.role !== 'assistant') return;
        askAI(
            'Continue from where you stopped',
            askMode,
            askScope,
            chatMessages,
            [],
            {
                targetMsgIndex: msgIdx,
                prefixContent: targetMsg.content
            }
        );
    }, [isStreaming, rateLimitCountdown, chatMessages, askMode, askScope]);

    const handleRetry = useCallback(() => {
        setAiError(null);
        setRateLimitCountdown(0);
        const lastUserIdx = [...chatMessages].map(m => m.role).lastIndexOf('user');
        if (lastUserIdx === -1) return;
        const lastUser = chatMessages[lastUserIdx];
        const baseHistory = chatMessages.slice(0, lastUserIdx);
        const imagesToRetry: AttachedImage[] | undefined = lastUser.images?.map((img, idx) => ({
            id: 'retry_' + idx,
            mime: (img.mime || 'image/jpeg') as any,
            data: img.data || '',
            thumbUrl: img.thumbUrl,
            name: img.name || 'image'
        }));
        askAI(lastUser.content, askMode, askScope, baseHistory, imagesToRetry);
    }, [chatMessages, askMode, askScope]);

    const renderAiErrorCard = useCallback((userMsg?: AskChatMessage) => {
        if (!aiError) return null;
        let title = aiError.message;
        let subtitle = aiError.backendMessage && aiError.backendMessage !== title
            ? aiError.backendMessage.slice(0, 160)
            : null;

        if (aiError.code === 'offline') {
            title = "You are offline";
            subtitle = "Reconnect to the internet and retry.";
        } else if (aiError.code === 'github_unreachable') {
            title = "Cannot reach GitHub";
        } else if (aiError.code === 'rate_limited' || aiError.code === 'github_rate_limited') {
            title = rateLimitCountdown > 0
                ? `Rate limit reached. You can try again in ${rateLimitCountdown}s.`
                : "Rate limit reached. You can now try again.";
        } else if (aiError.code === 'image_failed') {
            title = "Image analysis failed";
        } else if (aiError.code === 'provider_unavailable') {
            title = "AI service unreachable";
        }

        const hasMissingImageData = Boolean(userMsg?.images && userMsg.images.some(img => !img.data));
        const isRateLimited = aiError.code === 'rate_limited' || aiError.code === 'github_rate_limited';
        const retryDisabled = isRateLimited && rateLimitCountdown > 0;
        const secondLine = subtitle;

        return (
            <div className="p-3.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 space-y-2 mt-2">
                <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex items-center gap-2 text-xs font-medium text-red-200">
                            <ShieldAlert size={14} className="text-red-400 shrink-0" />
                            <span>{title}</span>
                        </div>
                        {secondLine && (
                            <div className="text-[11px] text-red-300/80 break-words font-mono pl-5">
                                {secondLine}
                            </div>
                        )}
                        {(aiError.status !== undefined || aiError.code) && (
                            <details className="text-[10px] text-red-400/70 cursor-pointer select-none pl-5">
                                <summary className="hover:text-red-300 transition-colors">Details</summary>
                                <div className="mt-1 font-mono text-[10px] space-y-0.5 text-red-300/80">
                                    {aiError.status !== undefined && <div>Status: {aiError.status}</div>}
                                    {aiError.code && <div>Code: {aiError.code}</div>}
                                </div>
                            </details>
                        )}
                    </div>
                    {hasMissingImageData ? (
                        <span
                            className="text-[11px] px-2.5 py-1 rounded font-medium bg-red-500/10 text-red-300/60 border border-red-500/20 cursor-not-allowed shrink-0 flex items-center gap-1"
                            title="Attach the image again"
                        >
                            <Info size={11} />
                            <span>Attach the image again</span>
                        </span>
                    ) : (
                        <button
                            type="button"
                            disabled={retryDisabled}
                            onClick={handleRetry}
                            title={retryDisabled ? `Wait ${rateLimitCountdown}s` : "Retry"}
                            className={cn(
                                "text-[11px] px-2.5 py-1 rounded font-medium transition-colors shrink-0 flex items-center gap-1",
                                retryDisabled
                                    ? "opacity-50 cursor-not-allowed bg-red-500/10 text-red-400 border border-red-500/20"
                                    : "bg-red-500/20 text-red-200 border border-red-500/30 hover:bg-red-500/30 cursor-pointer"
                            )}
                        >
                            <RefreshCw size={11} />
                            <span>Retry</span>
                        </button>
                    )}
                </div>
            </div>
        );
    }, [aiError, rateLimitCountdown, handleRetry]);

    const handleCopyUserMessage = async (msgIdx: number) => {
        const msg = chatMessages[msgIdx];
        if (!msg || !msg.content.trim()) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(msg.content);
            setCopiedUserMsgIdx(msgIdx);
            setTimeout(() => setCopiedUserMsgIdx(null), 2000);
        }
    };

    const handleResendMessage = (msgIdx: number) => {
        if (isStreaming) return;
        const msg = chatMessages[msgIdx];
        if (!msg || msg.role !== 'user') return;
        const hasMissing = Boolean(msg.images && msg.images.some(img => !img.data));
        if (hasMissing) return;
        const imagesToResend: AttachedImage[] | undefined = msg.images?.map((img, idx) => ({
            id: 'resend_' + idx + '_' + Date.now(),
            mime: (img.mime || 'image/jpeg') as any,
            data: img.data || '',
            thumbUrl: img.thumbUrl,
            name: img.name || 'image'
        }));
        askAI(msg.content, askMode, askScope, chatMessages, imagesToResend);
    };

    const handleEditMessage = (msgIdx: number) => {
        if (isStreaming) return;
        const msg = chatMessages[msgIdx];
        if (!msg || msg.role !== 'user') return;
        setEditingMessageIdx(msgIdx);
        setAskQ(msg.content);
        const hasMissing = Boolean(msg.images && msg.images.some(img => !img.data));
        setEditingHasMissingImages(hasMissing);
        if (msg.images && msg.images.length > 0) {
            const attached: AttachedImage[] = msg.images
                .filter(img => Boolean(img.data))
                .map((img, i) => ({
                    id: 'edit_' + i + '_' + Date.now(),
                    mime: (img.mime || 'image/jpeg') as any,
                    data: img.data!,
                    thumbUrl: img.thumbUrl,
                    name: img.name || 'image'
                }));
            setAttachedImages(attached);
        } else {
            setAttachedImages([]);
        }
        textareaRef.current?.focus();
    };

    const handleCancelEdit = () => {
        setEditingMessageIdx(null);
        setEditingHasMissingImages(false);
        setAskQ('');
        setAttachedImages([]);
    };

    const handleSendMessage = () => {
        if (isStreaming || rateLimitCountdown > 0 || (!askQ.trim() && attachedImages.length === 0)) return;
        if (editingMessageIdx !== null) {
            const editIdx = editingMessageIdx;
            const base = chatMessages.slice(0, editIdx);
            setEditingMessageIdx(null);
            setEditingHasMissingImages(false);
            askAI(askQ, askMode, askScope, base, attachedImages);
        } else {
            askAI();
        }
    };

    const handleRegenerate = useCallback((questionOverride?: string) => {
        if (isStreaming) return;
        const lastUserIdx = [...chatMessages].map(m => m.role).lastIndexOf('user');
        if (lastUserIdx === -1) return;
        const lastUser = chatMessages[lastUserIdx];
        const qToRun = questionOverride || lastUser.content;
        const baseHistory = chatMessages.slice(0, lastUserIdx);
        const imagesToRegen: AttachedImage[] | undefined = lastUser.images?.map((img, idx) => ({
            id: 'regen_' + idx,
            mime: (img.mime || 'image/jpeg') as any,
            data: img.data || '',
            thumbUrl: img.thumbUrl,
            name: img.name || 'image'
        }));
        askAI(qToRun, askMode, askScope, baseHistory, imagesToRegen);
    }, [chatMessages, isStreaming, askMode, askScope]);

    const handleRegenerateTurn = useCallback((msgIndex: number) => {
        if (isStreaming) return;
        let userQ = '';
        let userIdx = -1;
        let userImages: AttachedImage[] | undefined = undefined;
        for (let i = msgIndex - 1; i >= 0; i--) {
            if (chatMessages[i].role === 'user') {
                userQ = chatMessages[i].content;
                userIdx = i;
                if (chatMessages[i].images) {
                    userImages = chatMessages[i].images!.map((img, idx) => ({
                        id: 'regen_' + idx,
                        mime: (img.mime || 'image/jpeg') as any,
                        data: img.data || '',
                        thumbUrl: img.thumbUrl,
                        name: img.name || 'image'
                    }));
                }
                break;
            }
        }
        if (userIdx === -1 || (!userQ && (!userImages || userImages.length === 0))) return;
        const baseHistory = chatMessages.slice(0, userIdx);
        askAI(userQ, askMode, askScope, baseHistory, userImages);
    }, [chatMessages, isStreaming, askMode, askScope]);

    const reanalyze = useCallback(async () => {
        if (!graph || !selectedFile) return;
        setAnalyzing(true);
        setImpactError(null);
        try {
            const target = selectedSymbol
                ? { type: 'symbol', path: selectedSymbol.path, symbol: selectedSymbol }
                : { type: 'file', path: selectedFile };
            const res = await api.graph.impact(graph, target as any, { maxDepth: 3, maxResults: 50 });
            setImpactResult(res);
        } catch (e: any) {
            console.error(e);
            setImpactError({
                message: typeof e?.message === 'string' ? e.message : 'Failed to calculate impact',
                status: e?.status,
                code: e?.code
            });
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

    const dependentsData = useMemo(() => {
        return getFileDependents(graph, selectedFile || '');
    }, [graph, selectedFile]);

    const directList = useMemo(() => {
        if (!selectedFile) return [];
        const map = new Map<string, { path: string; name: string; folder: string; score: number }>();
        for (const rawPath of dependentsData.direct) {
            if (rawPath && rawPath !== selectedFile && !map.has(rawPath)) {
                const fileName = rawPath.split('/').pop() || rawPath;
                const folder = rawPath.includes('/') ? rawPath.substring(0, rawPath.lastIndexOf('/')) : '';
                const score = computeRisk(rawPath, graph, commits).score;
                map.set(rawPath, { path: rawPath, name: fileName, folder, score });
            }
        }
        return Array.from(map.values()).sort((a, b) => b.score - a.score);
    }, [dependentsData.direct, selectedFile, graph, commits]);

    const indirectList = useMemo(() => {
        if (!selectedFile) return [];
        const directPaths = new Set(directList.map(d => d.path));
        const map = new Map<string, { path: string; name: string; folder: string; score: number; hops: number }>();
        for (const ind of dependentsData.indirect) {
            const rawPath = ind.path;
            if (rawPath && rawPath !== selectedFile && !directPaths.has(rawPath) && !map.has(rawPath)) {
                const fileName = rawPath.split('/').pop() || rawPath;
                const folder = rawPath.includes('/') ? rawPath.substring(0, rawPath.lastIndexOf('/')) : '';
                const score = computeRisk(rawPath, graph, commits).score;
                map.set(rawPath, { path: rawPath, name: fileName, folder, score, hops: ind.hops || 2 });
            }
        }
        return Array.from(map.values()).sort((a, b) => b.score - a.score);
    }, [dependentsData.indirect, directList, selectedFile, graph, commits]);

    const fetchConnections = useCallback(() => {
        // Automatically computed from graph and selectedFile
    }, []);

    const fetchHealth = useCallback(async (force = false) => {
        if (!graph) return;
        const cacheKey = (repoUrl || '') + '@' + (selectedSha || '');
        if (force && cacheKey) {
            healthDataCache.delete(cacheKey);
        }
        if (!force && cacheKey && healthDataCache.has(cacheKey)) {
            setHealthData(healthDataCache.get(cacheKey)!);
            setHealthError(null);
            return;
        }
        if (!force && cacheKey && healthInFlightPromises.has(cacheKey)) {
            setHealthLoading(true);
            try {
                const res = await healthInFlightPromises.get(cacheKey)!;
                setHealthData(res);
                setHealthError(null);
            } catch (e: any) {
                // error handled below
            } finally {
                setHealthLoading(false);
            }
            return;
        }

        setHealthLoading(true);
        setHealthError(null);
        try {
            const promise = api.graph.health(graph);
            if (cacheKey) healthInFlightPromises.set(cacheKey, promise);
            const res = await promise;
            if (cacheKey) healthDataCache.set(cacheKey, res);
            setHealthData(res);
        } catch (e: any) {
            console.error(e);
            setHealthError({
                message: typeof e?.message === 'string' ? e.message : 'Failed to analyze repository health',
                status: e?.status,
                code: e?.code
            });
        } finally {
            if (cacheKey) healthInFlightPromises.delete(cacheKey);
            setHealthLoading(false);
        }
    }, [graph, repoUrl, selectedSha]);

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

    const renderChatsList = useCallback((isSidebar: boolean) => (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="p-2.5 border-b border-white/10 shrink-0 space-y-2">
                <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#E8EAE6] flex items-center gap-1.5 font-mono">
                        <MessageSquare size={13} className="text-[#4FD1B5]" />
                        <span>Chats ({chats.length})</span>
                    </span>
                    <button
                        type="button"
                        onClick={() => {
                            handleNewChat();
                            if (!isSidebar) setNormalChatsOpen(false);
                        }}
                        className="px-2 py-1 rounded text-[11px] font-mono border border-white/10 bg-white/[0.03] text-[#8A918C] hover:text-[#E8EAE6] hover:border-white/20 transition-colors cursor-pointer flex items-center gap-1"
                        title="New chat for current file"
                    >
                        <Plus size={11} />
                        <span>New chat</span>
                    </button>
                </div>
                <div className="relative">
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8A918C]" />
                    <input
                        value={chatSearchQuery}
                        onChange={e => setChatSearchQuery(e.target.value)}
                        placeholder="Search chats..."
                        className="w-full bg-black/40 border border-white/10 rounded-md pl-7 pr-2.5 py-1 text-xs text-[#E8EAE6] placeholder:text-[#8A918C]/50 outline-none font-mono"
                    />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-custom p-2 space-y-3">
                {Object.keys(chatsGroupedByFile).length === 0 ? (
                    <div className="p-4 text-center text-xs text-[#8A918C]/60 font-mono">
                        {chatSearchQuery ? "No matching chats" : "No chats yet"}
                    </div>
                ) : (
                    Object.entries(chatsGroupedByFile).map(([filePath, fileChats]) => {
                        const fileName = filePath.split('/').pop() || filePath;
                        return (
                            <div key={filePath} className="space-y-1">
                                <div className="text-[11px] font-mono text-[#8A918C] px-2 py-1 truncate flex items-center gap-1.5" title={filePath}>
                                    <FileCode size={11} className="shrink-0 text-[#4FD1B5]/70" />
                                    <span className="truncate">{fileName}</span>
                                </div>
                                {fileChats.map(chat => {
                                    const isActive = chat.id === activeChatId;
                                    const msgCount = chat.messages?.length || 0;
                                    return (
                                        <div
                                            key={chat.id}
                                            onClick={() => {
                                                setActiveAskAiChat(chat.id, chat.file);
                                                setSelectedAnswerIdx(null);
                                                setAiError(null);
                                                if (chat.file !== selectedFile) {
                                                    selectFile(chat.file);
                                                }
                                                if (!isSidebar) setNormalChatsOpen(false);
                                            }}
                                            className={cn(
                                                "group flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-mono transition-colors cursor-pointer",
                                                isActive
                                                    ? "bg-[#4FD1B5]/15 text-[#4FD1B5] border border-[#4FD1B5]/30 font-semibold"
                                                    : "text-[#8A918C] hover:text-[#E8EAE6] hover:bg-white/[0.04] border border-transparent"
                                            )}
                                        >
                                            <div className="min-w-0 flex-1 pr-2">
                                                <div className="truncate text-[12px] font-sans" title={chat.title}>
                                                    {chat.title || 'Untitled chat'}
                                                </div>
                                                <div className="flex items-center gap-1.5 text-[10px] text-[#8A918C]/80 mt-0.5 font-mono">
                                                    <span>{msgCount} {msgCount === 1 ? 'msg' : 'msgs'}</span>
                                                    <span>•</span>
                                                    <span>{formatChatDate(chat.updatedAt || chat.createdAt)}</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleRenameChat(chat.id, chat.title);
                                                    }}
                                                    className="p-1 rounded text-[#8A918C] hover:text-[#E8EAE6] hover:bg-white/[0.08] cursor-pointer"
                                                    title="Rename chat"
                                                >
                                                    <FileText size={11} />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleDeleteChat(chat.id);
                                                    }}
                                                    className="p-1 rounded text-[#8A918C] hover:text-red-400 hover:bg-red-500/10 cursor-pointer"
                                                    title="Delete chat"
                                                >
                                                    <Trash2 size={11} />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    ), [chats, chatSearchQuery, chatsGroupedByFile, activeChatId, selectedFile, selectFile, handleNewChat, handleRenameChat, handleDeleteChat]);

    const isCode = selectedFile ? isCodeFile(selectedFile) : false;
    const isRepoLevelTab = activeTab === 'Overview' || activeTab === 'ChangeSet' || activeTab === 'Health';

    return (
        <div className={cn("flex flex-col bg-[#07090A] select-none h-full min-h-0", className)}>
            {/* Header / Breadcrumb & File-level Segmented Tabs (shown only when a file is selected and not in repo-level views) */}
            {!isRepoLevelTab && selectedFile && (
                <div className="p-3 sm:p-3.5 border-b border-white/10 shrink-0 bg-[#07090A] z-10 space-y-2.5">
                    <div>
                        <div className="flex items-center gap-1.5 text-xs font-mono text-[#8A918C] mb-2 min-h-[16px] overflow-x-auto scrollbar-none whitespace-nowrap">
                            {selectedFile.split('/').map((part, i, arr) => (
                                <span key={i} className="flex items-center gap-1.5">
                                    <span className="hover:text-[#E8EAE6] cursor-pointer">{part}</span>
                                    {i < arr.length - 1 && <span className="opacity-40">/</span>}
                                </span>
                            ))}
                        </div>
                        <div className="flex items-start sm:items-center justify-between gap-3 flex-wrap">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                                <div className="w-7 h-7 rounded-lg glass-surface border-white/10 flex items-center justify-center text-[#4FD1B5] shrink-0">
                                    {isCode ? <FileCode size={14} /> : <FileText size={14} />}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <h2 className="text-sm sm:text-base font-semibold text-[#E8EAE6] font-mono tracking-tight truncate" title={selectedSymbol ? `${selectedSymbol.name}()` : selectedFile.split('/').pop()}>
                                        {selectedSymbol ? `${selectedSymbol.name}()` : selectedFile.split('/').pop()}
                                    </h2>
                                    <div className="flex gap-2 items-center mt-0.5 min-w-0">
                                        {selectedSymbol && <Badge variant="default">{selectedSymbol.type}</Badge>}
                                        <span className="text-[11px] text-[#8A918C] font-mono truncate" title={selectedFile}>{selectedFile}</span>
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                {!isDesktop && (
                                    <button
                                        type="button"
                                        onClick={() => setMobileDetailsOpen(true)}
                                        className={cn(
                                            "px-2.5 py-1.5 rounded-lg text-xs font-mono flex items-center gap-1.5 transition-colors cursor-pointer border",
                                            mobileDetailsOpen
                                                ? "bg-[#4FD1B5]/15 border-[#4FD1B5]/40 text-[#4FD1B5]"
                                                : "glass-surface border-white/10 text-[#E8EAE6] hover:border-[#4FD1B5]/50 hover:text-[#4FD1B5]"
                                        )}
                                        title="Open details"
                                    >
                                        <Info size={13} />
                                        <span>Details</span>
                                    </button>
                                )}
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

                    {/* On phone: sticky horizontally scrollable chip row for file tabs */}
                    {isPhone && (
                        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-1 -mx-1 px-1 snap-x scroll-smooth border-t border-white/[0.06] pt-2">
                            {[
                                { id: 'Graph', label: 'Graph' },
                                { id: 'Impact', label: 'Impact' },
                                { id: 'Connections', label: 'Connections' },
                                { id: 'Code', label: 'Code' },
                                { id: 'History', label: 'History' },
                                { id: 'AskAI', label: 'Ask AI' },
                            ].map((tab) => {
                                const isActive = activeTab === tab.id;
                                return (
                                    <button
                                        key={tab.id}
                                        type="button"
                                        onClick={() => setActiveTab(tab.id as any)}
                                        className={cn(
                                            "snap-start shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer",
                                            isActive
                                                ? "bg-[#4FD1B5] text-[#04100D] font-semibold"
                                                : "bg-white/[0.05] text-[#8A918C] hover:text-[#E8EAE6] hover:bg-white/[0.08]"
                                        )}
                                    >
                                        {tab.label}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Content */}
            <div className={cn("flex-1 p-4 overflow-y-auto scrollbar-custom text-[#E8EAE6] min-h-0", (activeTab === 'Overview' || activeTab === 'Graph' || activeTab === 'AskAI' || activeTab === 'Code' || activeTab === 'Impact' || activeTab === 'ChangeSet') && "flex flex-col")}>
                <ErrorBoundary key={activeTab} name={activeTab}>
                    {/* Overview Tab: Editorial Ledger layout & Drawer */}
                    {activeTab === 'Overview' && (
                        <div className="relative flex-1 min-h-0 -m-4 overflow-hidden flex flex-col">
                            {analyzing ? (
                                <div className="h-full flex flex-col items-center justify-center text-center text-[#8A918C] py-24 gap-2.5">
                                    <Loader2 size={24} className="animate-spin text-[#4FD1B5]" />
                                    <span className="text-xs font-mono">Analyzing repository...</span>
                                </div>
                            ) : analyzeError ? (
                                <div className="p-6 m-6 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 space-y-3 max-w-lg mx-auto">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-2 text-xs font-medium text-red-200">
                                                <ShieldAlert size={15} className="text-red-400 shrink-0" />
                                                <span>{analyzeError.message}</span>
                                            </div>
                                        </div>
                                        <Button
                                            onClick={reanalyzeRepo}
                                            className="px-3 py-1.5 text-xs bg-red-500/20 text-red-200 border border-red-500/30 hover:bg-red-500/30 flex items-center gap-1.5 shrink-0"
                                        >
                                            <RefreshCw size={12} />
                                            <span>Retry</span>
                                        </Button>
                                    </div>
                                </div>
                            ) : (!graph || stats.analyzedFiles === 0) ? (
                                <div className="h-full flex flex-col items-center justify-center text-center text-[#8A918C] py-24 gap-1.5">
                                    <div className="text-sm font-medium text-[#E8EAE6]">No files have been analyzed yet.</div>
                                    <div className="text-xs">Pick a file or re-analyze the repository to explore risk and dependencies.</div>
                                </div>
                            ) : (
                                <div
                                    className="flex-1 overflow-y-auto scrollbar-custom p-4 sm:p-[30px_36px_34px] transition-[padding] duration-300"
                                    style={{
                                        paddingRight: !isDesktop ? undefined : (drawerOpen ? 'calc(36px + 330px)' : '36px')
                                    }}
                                >
                                    <div className="text-xs font-mono text-[#8A918C] mb-2">{repoDisplayName}</div>

                                    {hotspotsList.length > 0 ? (
                                        <h1 className="text-[28px] sm:text-[36px] leading-[1.1] sm:leading-[1.08] tracking-[-0.03em] font-semibold my-2.5 max-w-[640px] text-[#E8EAE6]">
                                            {hotspotsList.length} {hotspotsList.length === 1 ? 'file carries' : 'files carry'} most of the risk. Start with{" "}
                                            <u style={{ textDecoration: 'none', boxShadow: 'inset 0 -.18em 0 rgba(227,160,74,.45)' }}>
                                                {hotspotsList[0].path ? hotspotsList[0].path.split('/').pop() : (hotspotsList[0].name ? hotspotsList[0].name.split('/').pop() : '')}
                                            </u>
                                            .
                                        </h1>
                                    ) : (
                                        <h1 className="text-[28px] sm:text-[36px] leading-[1.1] sm:leading-[1.08] tracking-[-0.03em] font-semibold my-2.5 max-w-[640px] text-[#E8EAE6]">
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
                                                    const baseFileName = h.path ? h.path.split('/').pop() || h.name || 'unknown' : (h.name || 'unknown');
                                                    let folder = '';
                                                    if (h.path && h.path.includes('/')) {
                                                        folder = h.path.substring(0, h.path.lastIndexOf('/'));
                                                    }
                                                    const directDeps = h.risk?.directDependents || 0;
                                                    const reach = directDeps + (h.risk?.transitiveDependents || 0);
                                                    const reasonText = directDeps > 0
                                                        ? `${directDeps} direct dependent${directDeps === 1 ? '' : 's'}`
                                                        : (reach > 0 ? `reaches ${reach} file${reach === 1 ? '' : 's'}` : `isolated file`);
                                                    const line2Text = folder ? `${folder} · ${reasonText}` : reasonText;
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
                                                            <div className="min-w-0 pr-2 flex-1">
                                                                <div className="font-mono font-bold text-sm text-[#E8EAE6] truncate" title={h.path || baseFileName}>
                                                                    {baseFileName}
                                                                </div>
                                                                <div className="text-xs text-[#8A918C] leading-relaxed truncate mt-0.5" title={line2Text}>
                                                                    {line2Text}
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
                                                <span>
                                                    {healthLoading ? (
                                                        <span className="text-[#8A918C]">Checking circular imports...</span>
                                                    ) : healthError ? (
                                                        <span className="text-amber-400">Health check failed</span>
                                                    ) : healthData ? (
                                                        <><b>{healthData.circularImports?.length || 0}</b> circular imports</>
                                                    ) : (
                                                        <span className="text-[#8A918C]">Circular imports</span>
                                                    )}
                                                </span>
                                            </div>
                                            <div className={cn("overview-hl", (healthData?.unusedFiles?.length || 0) > 0 && "w")}>
                                                <i />
                                                <span>
                                                    {healthLoading ? (
                                                        <span className="text-[#8A918C]">Checking unused files...</span>
                                                    ) : healthError ? (
                                                        <span className="text-amber-400">Health check failed</span>
                                                    ) : healthData ? (
                                                        <><b>{healthData.unusedFiles?.length || 0}</b> files nothing imports</>
                                                    ) : (
                                                        <span className="text-[#8A918C]">Unused files</span>
                                                    )}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Overview Drawer */}
                            {!isDesktop && drawerOpen && (
                                <div
                                    className="fixed inset-0 bg-black/55 z-40 transition-opacity"
                                    onClick={() => setDrawerOpen(false)}
                                    aria-hidden="true"
                                />
                            )}
                            <aside
                                className={cn("overview-drawer scrollbar-custom", drawerOpen && "open")}
                                aria-label="File risk details"
                            >
                                {!isDesktop && (
                                    <div className="w-10 h-1 rounded-full bg-white/20 mx-auto my-2.5 shrink-0" />
                                )}
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
                                                    setDrawerOpen(false);
                                                    selectFile(drawerFile);
                                                    setActiveTab('Impact');
                                                }}
                                                className="text-xs font-medium px-3.5 py-1.5 rounded-lg bg-[#4FD1B5] text-[#04100D] hover:brightness-110 cursor-pointer transition-all"
                                            >
                                                Open impact
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setDrawerOpen(false);
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
                        <div className="w-full h-full min-h-[360px] sm:min-h-[500px] flex-1 rounded-xl overflow-hidden border border-white/10 relative">
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
                            <div className="flex-1 flex flex-col space-y-3 min-h-0 h-full overflow-hidden">
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
                            ) : impactError ? (
                                <div className="p-4 m-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 space-y-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="space-y-1 flex-1 min-w-0">
                                            <div className="flex items-center gap-2 text-xs font-medium text-red-200">
                                                <ShieldAlert size={15} className="text-red-400 shrink-0" />
                                                <span>{impactError.message}</span>
                                            </div>
                                            {(impactError.status !== undefined || impactError.code) && (
                                                <div className="font-mono text-[10px] text-red-400/80 pl-6 space-y-0.5">
                                                    {impactError.status !== undefined && <div>Status: {impactError.status}</div>}
                                                    {impactError.code && <div>Code: {impactError.code}</div>}
                                                </div>
                                            )}
                                        </div>
                                        <Button
                                            onClick={reanalyze}
                                            className="px-3 py-1.5 text-xs bg-red-500/20 text-red-200 border border-red-500/30 hover:bg-red-500/30 flex items-center gap-1.5 shrink-0"
                                        >
                                            <RefreshCw size={12} />
                                            <span>Retry</span>
                                        </Button>
                                    </div>
                                </div>
                            ) : (() => {
                                const directCount = directList.length;
                                const indirectCount = indirectList.length;

                                const testsToRunList: Array<{ path: string; depth: number }> = (() => {
                                    const testMap = new Map<string, { path: string; depth: number }>();

                                    // 1. Tests from impactResult if present
                                    if (impactResult?.tests && Array.isArray(impactResult.tests)) {
                                        for (const t of impactResult.tests as any[]) {
                                            const p = typeof t === 'string' ? t : (t.path || t.symbol?.path || '');
                                            if (!p) continue;
                                            const depth = typeof t === 'object' && typeof t.depth === 'number'
                                                ? t.depth
                                                : (indirectList.some(ind => ind.path === p) ? 2 : 1);
                                            testMap.set(p, { path: p, depth });
                                        }
                                    }

                                    // 2. Direct dependents that are test files
                                    for (const d of dependentsData.direct) {
                                        if (isTestFile(d) && !testMap.has(d)) {
                                            testMap.set(d, { path: d, depth: 1 });
                                        }
                                    }

                                    // 3. Indirect dependents that are test files
                                    for (const ind of dependentsData.indirect) {
                                        if (isTestFile(ind.path)) {
                                            const existing = testMap.get(ind.path);
                                            const depth = existing ? Math.min(existing.depth, ind.hops || 2) : (ind.hops || 2);
                                            testMap.set(ind.path, { path: ind.path, depth });
                                        }
                                    }

                                    // 4. Test files in graph sharing base name
                                    if (graph && selectedFile) {
                                        const baseName = selectedFile.split('/').pop()?.replace(/\.[^.]+$/, '') || '';
                                        for (const n of graph.nodes) {
                                            if (n.type !== 'file') continue;
                                            const p = n.path || n.id;
                                            if (!p || !isTestFile(p)) continue;
                                            const testBase = p.split('/').pop()?.replace(/\.(test|spec)(\.[^.]*|$)/, '').replace(/\.[^.]+$/, '') || '';
                                            if (testBase === baseName || p.includes(baseName)) {
                                                if (!testMap.has(p)) {
                                                    testMap.set(p, { path: p, depth: 1 });
                                                }
                                            }
                                        }
                                    }

                                    return Array.from(testMap.values()).sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));
                                })();

                                const testCount = testsToRunList.length;
                                const directTestCount = testsToRunList.filter(t => t.depth === 1).length;
                                const indirectTestCount = testsToRunList.filter(t => t.depth > 1).length;
                                const targetDisplayName = selectedSymbol?.name || (selectedFile ? selectedFile.split('/').pop() : 'file') || 'file';

                                const isTargetTest = selectedFile ? isTestFile(selectedFile) : false;

                                const verdictTestText = (() => {
                                    if (isTargetTest) return "This is a test file.";
                                    if (testCount === 0) return "No test covers this file.";
                                    if (directTestCount === 0) return `Only indirect tests cover it (${indirectTestCount}).`;
                                    return `Covered by ${testCount} test${testCount === 1 ? '' : 's'}.`;
                                })();

                                // Combine and rank all affected files by score
                                const rankedAll = [
                                    ...directList.map(item => ({ ...item, type: 'direct' as const, hops: 1 })),
                                    ...indirectList.map(item => ({ ...item, type: 'indirect' as const, hops: item.hops || 2 }))
                                ].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

                                const getRiskColor = (score: number) => {
                                    if (score > 60) return '#E3A04A'; // high amber
                                    if (score > 30) return '#4FD1B5'; // medium teal
                                    return '#8A918C'; // low grey
                                };

                                const getRiskRadius = (score: number, isDirect: boolean) => {
                                    const base = isDirect ? 6 : 5;
                                    return base + Math.min(6, Math.max(0, (score / 100) * 6));
                                };

                                const visibleDirect = directList.slice(0, 10);
                                const visibleIndirect = indirectList.slice(0, 6);

                                // Check for duplicate base names across visible nodes on rings
                                const ringBaseNameCounts = new Map<string, number>();
                                [...visibleDirect, ...visibleIndirect].forEach(n => {
                                    ringBaseNameCounts.set(n.name, (ringBaseNameCounts.get(n.name) || 0) + 1);
                                });

                                const modalFiltered = rankedAll.filter(item => {
                                    if (!impactSearchQuery.trim()) return true;
                                    const q = impactSearchQuery.toLowerCase();
                                    return item.name.toLowerCase().includes(q) || item.path.toLowerCase().includes(q) || (item.folder && item.folder.toLowerCase().includes(q));
                                });

                                return (
                                    <div className="flex-1 flex flex-col min-h-0 md:h-full md:overflow-hidden overflow-y-auto space-y-3 relative">
                                        {/* 1. Verdict line at top (22px, editorial, file name highlighted in amber) */}
                                        <div className="glass-surface px-5 py-3.5 rounded-xl border-white/10 shrink-0">
                                            <h2 className="text-[22px] font-normal tracking-tight text-[#E8EAE6] leading-snug">
                                                Changing <span className="font-mono text-[#E3A04A] font-semibold">{targetDisplayName}</span> can break{' '}
                                                <span className="font-mono font-semibold text-[#E8EAE6]">{directCount}</span> file{directCount === 1 ? '' : 's'} directly and{' '}
                                                <span className="font-mono font-semibold text-[#E8EAE6]">{indirectCount}</span> more indirectly.{' '}
                                                <span className={testCount === 0 && !isTargetTest ? "text-[#E3A04A]" : "text-[#8A918C]"}>
                                                    {verdictTestText}
                                                </span>
                                            </h2>
                                        </div>

                                        {/* Two columns: Left ~60% (Blast radius rings), Right ~40% (Ranked list + tests + why score) */}
                                        <div className="flex-1 grid grid-cols-1 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-4 min-h-0 md:h-full md:overflow-hidden">
                                            {/* Left (about 60%): blast radius rings filling whole card */}
                                            <div
                                                className="glass-surface p-4 rounded-xl border-white/10 flex flex-col items-center justify-between relative overflow-hidden h-auto md:h-full min-h-0 select-none"
                                                onMouseLeave={() => setHoveredImpactNode(null)}
                                            >
                                                {/* Legend row above the rings (outside the SVG) */}
                                                <div className="w-full flex items-center justify-between px-2 py-1 mb-1 text-xs border-b border-white/[0.06] shrink-0">
                                                    <div className="flex items-center gap-4">
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="w-2.5 h-2.5 rounded-full bg-[#E3A04A] inline-block shrink-0" />
                                                            <span className="font-medium text-[#E8EAE6]">Direct ({directCount})</span>
                                                        </div>
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="w-2.5 h-2.5 rounded-full bg-[#8A918C] inline-block shrink-0" />
                                                            <span className="font-medium text-[#8A918C]">Indirect ({indirectCount})</span>
                                                        </div>
                                                    </div>
                                                    <div className="text-[11px] text-[#8A918C] font-mono">
                                                        Size indicates risk
                                                    </div>
                                                </div>

                                                <svg
                                                    viewBox="0 0 540 500"
                                                    preserveAspectRatio="xMidYMid meet"
                                                    className="w-full flex-1 min-h-0 max-h-[460px] max-w-[500px] overflow-visible"
                                                    role="img"
                                                >
                                                    <title>Blast radius rings</title>

                                                    {/* Animated ripple wave on rings (off for reduced motion via CSS .blast-ripple) */}
                                                    <circle
                                                        cx="270"
                                                        cy="235"
                                                        r="95"
                                                        fill="none"
                                                        stroke="rgba(227, 160, 74, 0.25)"
                                                        strokeWidth="1.5"
                                                        className="rpl blast-ripple"
                                                    />
                                                    <circle
                                                        cx="270"
                                                        cy="235"
                                                        r="180"
                                                        fill="none"
                                                        stroke="rgba(138, 145, 140, 0.2)"
                                                        strokeWidth="1.5"
                                                        className="rpl blast-ripple"
                                                        style={{ animationDelay: '2.25s' }}
                                                    />

                                                    {/* Static Ring 1 guide (Direct) */}
                                                    <circle
                                                        cx="270"
                                                        cy="235"
                                                        r="95"
                                                        fill="none"
                                                        stroke="rgba(255, 255, 255, 0.08)"
                                                        strokeDasharray="4 6"
                                                    />

                                                    {/* Static Ring 2 guide (Indirect) */}
                                                    <circle
                                                        cx="270"
                                                        cy="235"
                                                        r="180"
                                                        fill="none"
                                                        stroke="rgba(255, 255, 255, 0.08)"
                                                        strokeDasharray="4 6"
                                                    />

                                                    {/* Highlighted path connecting to hovered node */}
                                                    {hoveredImpactNode && (
                                                        <line
                                                            x1="270"
                                                            y1="235"
                                                            x2={hoveredImpactNode.x}
                                                            y2={hoveredImpactNode.y}
                                                            stroke={hoveredImpactNode.type === 'direct' ? "#E3A04A" : "#8A918C"}
                                                            strokeWidth="2.5"
                                                            strokeDasharray={hoveredImpactNode.type === 'indirect' ? "5 4" : undefined}
                                                            opacity="0.9"
                                                        />
                                                    )}

                                                    {/* Center Target Node (near-white with teal ring) */}
                                                    <g className="cursor-default">
                                                        <circle cx="270" cy="235" r="16" fill="#07090A" stroke="#4FD1B5" strokeWidth="2.5" />
                                                        <circle cx="270" cy="235" r="9" fill="#FAFAFA" />
                                                        <text
                                                            x="270"
                                                            y="266"
                                                            fontSize="12"
                                                            fontWeight="700"
                                                            fill="#E8EAE6"
                                                            textAnchor="middle"
                                                            fontFamily="'IBM Plex Mono', monospace"
                                                        >
                                                            <title>{selectedFile}</title>
                                                            {targetDisplayName.length > 24 ? `${targetDisplayName.slice(0, 23)}…` : targetDisplayName}
                                                        </text>
                                                    </g>

                                                    {/* Ring 1 (Direct) nodes - Amber #E3A04A, size by risk, max 10 */}
                                                    {(() => {
                                                        const r = 95;
                                                        const wouldCollide = visibleDirect.length > 4;

                                                        return (
                                                            <>
                                                                {visibleDirect.map((node, i) => {
                                                                    const angle = (i / Math.max(1, visibleDirect.length)) * 2 * Math.PI - Math.PI / 2;
                                                                    const px = 270 + Math.cos(angle) * r;
                                                                    const py = 235 + Math.sin(angle) * r;
                                                                    const nodeRadius = getRiskRadius(node.score, true);
                                                                    const isHovered = hoveredImpactNode?.path === node.path;
                                                                    const displayName = node.name.length > 24 ? `${node.name.slice(0, 23)}…` : node.name;
                                                                    const parentFolder = node.folder ? (node.folder.length > 22 ? `${node.folder.slice(0, 21)}…` : node.folder) : '';
                                                                    const isDuplicateName = (ringBaseNameCounts.get(node.name) || 0) > 1;
                                                                    const showFolder = isDuplicateName || isHovered || !wouldCollide;

                                                                    // Measure available space and flip label if it would leave canvas or overlap center
                                                                    const cosA = Math.cos(angle);
                                                                    const sinA = Math.sin(angle);
                                                                    const labelOffset = nodeRadius + 8;
                                                                    let lx = px + cosA * labelOffset;
                                                                    let ly = py + sinA * labelOffset + 4;
                                                                    let anchor: 'start' | 'end' | 'middle' = cosA > 0.2 ? 'start' : cosA < -0.2 ? 'end' : 'middle';

                                                                    if (lx > 480) {
                                                                        lx = px - labelOffset;
                                                                        anchor = 'end';
                                                                    } else if (lx < 60) {
                                                                        lx = px + labelOffset;
                                                                        anchor = 'start';
                                                                    }

                                                                    return (
                                                                        <g
                                                                            key={`ring1-${node.path}-${i}`}
                                                                            onClick={() => setImpactSheetOpen(true)}
                                                                            onMouseEnter={() => setHoveredImpactNode({ ...node, type: 'direct', x: px, y: py })}
                                                                            className="cursor-pointer group"
                                                                        >
                                                                            <line
                                                                                x1="270"
                                                                                y1="235"
                                                                                x2={px}
                                                                                y2={py}
                                                                                stroke="#E3A04A"
                                                                                strokeOpacity={isHovered ? "0.8" : "0.2"}
                                                                                strokeWidth={isHovered ? "2" : "1"}
                                                                            />
                                                                            <circle
                                                                                cx={px}
                                                                                cy={py}
                                                                                r={nodeRadius}
                                                                                fill="#E3A04A"
                                                                                stroke="#07090A"
                                                                                strokeWidth={isHovered ? "2.5" : "1.5"}
                                                                            />
                                                                            <text
                                                                                x={lx}
                                                                                y={ly}
                                                                                textAnchor={anchor}
                                                                                fontFamily="'IBM Plex Mono', monospace"
                                                                                className="pointer-events-none select-none"
                                                                            >
                                                                                <title>{node.path}</title>
                                                                                <tspan
                                                                                    x={lx}
                                                                                    dy="0"
                                                                                    fontSize="12"
                                                                                    fontWeight="700"
                                                                                    fill={isHovered ? "#FFFFFF" : "#E8EAE6"}
                                                                                >
                                                                                    {displayName}
                                                                                </tspan>
                                                                                {showFolder && parentFolder && (
                                                                                    <tspan
                                                                                        x={lx}
                                                                                        dy="13"
                                                                                        fontSize="10.5"
                                                                                        fontWeight="400"
                                                                                        fill="#8A918C"
                                                                                    >
                                                                                        {parentFolder}
                                                                                    </tspan>
                                                                                )}
                                                                            </text>
                                                                        </g>
                                                                    );
                                                                })}
                                                            </>
                                                        );
                                                    })()}

                                                    {/* Ring 2 (Indirect) nodes - Grey #8A918C, size by risk, max 6 */}
                                                    {(() => {
                                                        const r = 180;
                                                        const wouldCollide = visibleIndirect.length > 6;

                                                        return (
                                                            <>
                                                                {visibleIndirect.map((node, i) => {
                                                                    const angle = (i / Math.max(1, visibleIndirect.length)) * 2 * Math.PI - Math.PI / 2 + 0.22;
                                                                    const px = 270 + Math.cos(angle) * r;
                                                                    const py = 235 + Math.sin(angle) * r;
                                                                    const nodeRadius = getRiskRadius(node.score, false);
                                                                    const isHovered = hoveredImpactNode?.path === node.path;
                                                                    const displayName = node.name.length > 24 ? `${node.name.slice(0, 23)}…` : node.name;
                                                                    const parentFolder = node.folder ? (node.folder.length > 22 ? `${node.folder.slice(0, 21)}…` : node.folder) : '';
                                                                    const isDuplicateName = (ringBaseNameCounts.get(node.name) || 0) > 1;
                                                                    const showFolder = isDuplicateName || isHovered || !wouldCollide;

                                                                    // Measure available space and flip label if it would leave canvas
                                                                    const cosA = Math.cos(angle);
                                                                    const sinA = Math.sin(angle);
                                                                    const labelOffset = nodeRadius + 8;
                                                                    let lx = px + cosA * labelOffset;
                                                                    let ly = py + sinA * labelOffset + 4;
                                                                    let anchor: 'start' | 'end' | 'middle' = cosA > 0.2 ? 'start' : cosA < -0.2 ? 'end' : 'middle';

                                                                    if (lx > 480) {
                                                                        lx = px - labelOffset;
                                                                        anchor = 'end';
                                                                    } else if (lx < 60) {
                                                                        lx = px + labelOffset;
                                                                        anchor = 'start';
                                                                    }

                                                                    return (
                                                                        <g
                                                                            key={`ring2-${node.path}-${i}`}
                                                                            onClick={() => setImpactSheetOpen(true)}
                                                                            onMouseEnter={() => setHoveredImpactNode({ ...node, type: 'indirect', x: px, y: py })}
                                                                            className="cursor-pointer group"
                                                                        >
                                                                            <line
                                                                                x1="270"
                                                                                y1="235"
                                                                                x2={px}
                                                                                y2={py}
                                                                                stroke="#8A918C"
                                                                                strokeOpacity={isHovered ? "0.8" : "0.15"}
                                                                                strokeWidth={isHovered ? "2" : "1"}
                                                                                strokeDasharray="4 4"
                                                                            />
                                                                            <circle
                                                                                cx={px}
                                                                                cy={py}
                                                                                r={nodeRadius}
                                                                                fill="#8A918C"
                                                                                stroke="#07090A"
                                                                                strokeWidth={isHovered ? "2.5" : "1.5"}
                                                                            />
                                                                            <text
                                                                                x={lx}
                                                                                y={ly}
                                                                                textAnchor={anchor}
                                                                                fontFamily="'IBM Plex Mono', monospace"
                                                                                className="pointer-events-none select-none"
                                                                            >
                                                                                <title>{node.path}</title>
                                                                                <tspan
                                                                                    x={lx}
                                                                                    dy="0"
                                                                                    fontSize="12"
                                                                                    fontWeight="700"
                                                                                    fill={isHovered ? "#FFFFFF" : "#8A918C"}
                                                                                >
                                                                                    {displayName}
                                                                                </tspan>
                                                                                {showFolder && parentFolder && (
                                                                                    <tspan
                                                                                        x={lx}
                                                                                        dy="13"
                                                                                        fontSize="10.5"
                                                                                        fontWeight="400"
                                                                                        fill="#8A918C"
                                                                                    >
                                                                                        {parentFolder}
                                                                                    </tspan>
                                                                                )}
                                                                            </text>
                                                                        </g>
                                                                    );
                                                                })}
                                                            </>
                                                        );
                                                    })()}
                                                </svg>

                                                {/* If 0 dependents: message under empty ring */}
                                                {directCount === 0 && indirectCount === 0 && (
                                                    <div className="w-full flex items-center justify-center py-2 shrink-0 text-center">
                                                        <span className="text-xs font-mono text-[#4FD1B5] bg-[#4FD1B5]/10 border border-[#4FD1B5]/30 px-3.5 py-1 rounded-full">
                                                            Nothing depends on this file. Safe to change.
                                                        </span>
                                                    </div>
                                                )}

                                                {/* Bottom pill row for +N more placed outside the outer ring at the bottom */}
                                                {(directCount > 10 || indirectCount > 6) && (
                                                    <div className="w-full flex items-center justify-center gap-3 py-1.5 shrink-0">
                                                        {directCount > 10 && (
                                                            <button
                                                                onClick={() => setImpactSheetOpen(true)}
                                                                className="px-3 py-1 rounded-full bg-[#10161A] border border-[#E3A04A]/40 text-[#E3A04A] font-mono text-[11px] shadow-sm hover:bg-[#E3A04A]/10 hover:border-[#E3A04A]/70 transition-colors cursor-pointer"
                                                            >
                                                                +{directCount - 10} more direct
                                                            </button>
                                                        )}
                                                        {indirectCount > 6 && (
                                                            <button
                                                                onClick={() => setImpactSheetOpen(true)}
                                                                className="px-3 py-1 rounded-full bg-[#10161A] border border-[#8A918C]/40 text-[#8A918C] font-mono text-[11px] shadow-sm hover:bg-white/[0.08] hover:border-[#8A918C]/70 transition-colors cursor-pointer"
                                                            >
                                                                +{indirectCount - 6} more indirect
                                                            </button>
                                                        )}
                                                    </div>
                                                )}

                                                {/* Tooltip on node hover */}
                                                {hoveredImpactNode && (
                                                    <div className="absolute bottom-4 left-4 z-20 pointer-events-none bg-[#10161A] border border-white/15 px-3.5 py-2.5 rounded-lg shadow-xl max-w-[320px]">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <span
                                                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                                                style={{ backgroundColor: hoveredImpactNode.type === 'direct' ? '#E3A04A' : '#8A918C' }}
                                                            />
                                                            <span className="font-mono text-xs font-semibold text-[#E8EAE6] truncate">
                                                                {hoveredImpactNode.name}
                                                            </span>
                                                            <span className="font-mono text-[10px] text-[#8A918C] ml-auto shrink-0">
                                                                {hoveredImpactNode.score} / 100 risk
                                                            </span>
                                                        </div>
                                                        <div className="font-mono text-[11px] text-[#8A918C] truncate mb-1">
                                                            {hoveredImpactNode.path}
                                                        </div>
                                                        <div className="text-[11px] text-[#E8EAE6]">
                                                            {hoveredImpactNode.type === 'direct'
                                                                ? 'Direct dependent: directly imports selected file'
                                                                : `Indirect dependent (${hoveredImpactNode.hops || 2} hops from selected file)`}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Right (about 40%): ranked list "Files that could break" + Tests + Why score */}
                                            <div className="glass-surface p-4 rounded-xl border-white/10 flex flex-col h-auto md:h-full min-h-0 md:overflow-hidden">
                                                <div className="flex-1 flex flex-col min-h-0">
                                                    {/* Sticky Header: Files that could break */}
                                                    <div className="sticky top-0 z-10 flex items-center justify-between mb-3 pb-2.5 border-b border-white/[0.06] bg-[#07090A]/95 backdrop-blur-sm shrink-0">
                                                        <div>
                                                            <h3 className="text-xs font-semibold text-[#8A918C]">Files that could break</h3>
                                                            <div className="text-[11px] text-[#8A918C] mt-0.5">
                                                                Ranked by risk score ({rankedAll.length} total)
                                                            </div>
                                                        </div>
                                                        <div className="flex items-baseline gap-1.5 shrink-0">
                                                            <span className="text-xl font-bold font-mono text-[#E3A04A]">
                                                                {fileRisk ? fileRisk.score : (impactResult?.score ?? 0)}
                                                            </span>
                                                            <span className="text-xs font-mono text-[#8A918C]">/ 100 risk</span>
                                                        </div>
                                                    </div>

                                                    {/* Scrollable Ranked list (shows at least 6 rows) */}
                                                    <div className="flex-1 min-h-0 md:overflow-y-auto scrollbar-custom pr-1 pt-1.5 space-y-1.5">
                                                        {rankedAll.length === 0 ? (
                                                            <div className="text-xs text-[#8A918C] py-4 text-center">
                                                                No dependents found.
                                                            </div>
                                                        ) : (
                                                            rankedAll.map((item, idx) => (
                                                                <div
                                                                    key={`ranked-${item.path}-${idx}`}
                                                                    onClick={() => selectFile(item.path)}
                                                                    onMouseEnter={() => setHoveredImpactNode({
                                                                        path: item.path,
                                                                        name: item.name,
                                                                        folder: item.folder,
                                                                        score: item.score,
                                                                        type: item.type,
                                                                        hops: item.hops,
                                                                        x: 270,
                                                                        y: 235
                                                                    })}
                                                                    onMouseLeave={() => setHoveredImpactNode(null)}
                                                                    className="flex items-center justify-between p-2 rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/15 transition-colors cursor-pointer group text-xs"
                                                                >
                                                                    {/* Rank index */}
                                                                    <span className="font-mono text-[11px] text-[#8A918C] w-5 shrink-0">
                                                                        {idx + 1}
                                                                    </span>

                                                                    {/* File name & folder */}
                                                                    <div className="min-w-0 flex-1 mr-2">
                                                                        <div className="flex items-center gap-1.5">
                                                                            <span className="font-mono text-[#E8EAE6] group-hover:text-[#4FD1B5] truncate" title={item.path}>
                                                                                {item.name}
                                                                            </span>
                                                                            {/* Direct or 2 hops tag */}
                                                                            <span className={cn(
                                                                                "font-sans text-[10px] px-1.5 py-0.2 rounded border shrink-0",
                                                                                item.type === 'direct'
                                                                                    ? "border-[#E3A04A]/30 text-[#E3A04A] bg-[#E3A04A]/10"
                                                                                    : "border-white/15 text-[#8A918C] bg-white/[0.03]"
                                                                            )}>
                                                                                {item.type === 'direct' ? 'Direct' : `${item.hops || 2} hops`}
                                                                            </span>
                                                                        </div>
                                                                        {item.folder && (
                                                                            <span className="text-[11px] text-[#8A918C] truncate block" title={item.folder}>
                                                                                {item.folder}
                                                                            </span>
                                                                        )}
                                                                    </div>

                                                                    {/* Risk bar and score */}
                                                                    <div className="flex items-center gap-2 shrink-0">
                                                                        <div className="w-12 h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                                                                            <div
                                                                                className="h-full rounded-full"
                                                                                style={{
                                                                                    width: `${item.score}%`,
                                                                                    backgroundColor: item.type === 'direct' ? '#E3A04A' : '#8A918C'
                                                                                }}
                                                                            />
                                                                        </div>
                                                                        <span className="font-mono text-[11px] text-[#8A918C] w-5 text-right">
                                                                            {item.score}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            ))
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Footer: Tests to run & Why this score */}
                                                <div className="pt-2 border-t border-white/[0.08] mt-2 shrink-0 space-y-2">
                                                    {/* Tests to run block: fixed max-height with own scroll on desktop/tablet */}
                                                    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 text-xs md:max-h-40 flex flex-col shrink-0">
                                                        <div className="flex items-center justify-between mb-1.5 shrink-0">
                                                            <span className="font-medium text-[#8A918C]">Tests to run ({testCount})</span>
                                                        </div>
                                                        {testCount === 0 ? (
                                                            <div className="p-2.5 rounded border border-[#E3A04A]/30 bg-[#E3A04A]/10 text-[11px] text-[#E3A04A] leading-relaxed shrink-0">
                                                                {isTargetTest
                                                                    ? "This is a test file."
                                                                    : "No test covers this file. Add a unit test covering this module before modifying it."}
                                                            </div>
                                                        ) : (
                                                            <div className="space-y-1 md:max-h-28 md:overflow-y-auto scrollbar-custom pr-0.5">
                                                                {testsToRunList.map((testItem, i) => {
                                                                    const testPath = testItem.path;
                                                                    const testTag = testItem.depth > 1 ? `${testItem.depth} hops` : 'Direct';
                                                                    return (
                                                                        <button
                                                                            key={i}
                                                                            onClick={() => selectFile(testPath)}
                                                                            className="w-full flex items-center justify-between p-1.5 rounded glass-surface border-white/[0.06] hover:border-[#4FD1B5]/30 hover:bg-white/[0.04] transition-colors cursor-pointer group text-left"
                                                                            title={testPath}
                                                                        >
                                                                            <span className="font-mono text-[11px] text-[#E8EAE6] group-hover:text-[#4FD1B5] truncate flex-1 mr-2">
                                                                                {testPath.split('/').pop()}
                                                                            </span>
                                                                            <span className={cn(
                                                                                "font-sans text-[10px] px-1.5 py-0.2 rounded border shrink-0",
                                                                                testTag === 'Direct'
                                                                                    ? "border-[#E3A04A]/30 text-[#E3A04A] bg-[#E3A04A]/10"
                                                                                    : "border-white/15 text-[#8A918C] bg-white/[0.03]"
                                                                            )}>
                                                                                {testTag}
                                                                            </span>
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Why this score stays collapsed */}
                                                    <details className="group/why text-xs rounded-lg border border-white/[0.06] bg-white/[0.02]">
                                                        <summary className="p-2 cursor-pointer font-medium text-[#8A918C] flex items-center justify-between select-none hover:text-[#E8EAE6]">
                                                             <span>Why this score</span>
                                                            <span className="text-[10px] font-mono opacity-60 group-open/why:rotate-180 transition-transform">▼</span>
                                                        </summary>
                                                        <div className="p-2.5 pt-0 space-y-1 text-[11px] text-[#8A918C]">
                                                            <div className="flex items-center justify-between">
                                                                <span>Direct importers</span>
                                                                <span className="font-mono text-[#E8EAE6]">{directCount} file{directCount === 1 ? '' : 's'}</span>
                                                            </div>
                                                            <div className="flex items-center justify-between">
                                                                <span>Indirect reach</span>
                                                                <span className="font-mono text-[#E8EAE6]">{indirectCount} file{indirectCount === 1 ? '' : 's'}</span>
                                                            </div>
                                                            <div className="flex items-center justify-between">
                                                                <span>Test coverage</span>
                                                                <span className="font-mono text-[#E8EAE6]">
                                                                    {isTargetTest
                                                                        ? "This is a test file"
                                                                        : testCount === 0
                                                                            ? "No test covers this file"
                                                                            : directTestCount === 0
                                                                                ? `Only indirect tests cover it (${indirectTestCount})`
                                                                                : `Covered by ${testCount} test${testCount === 1 ? '' : 's'}`}
                                                                </span>
                                                            </div>
                                                            <div className="flex items-center justify-between">
                                                                <span>Commit churn</span>
                                                                <span className="font-mono text-[#E8EAE6]">
                                                                    {fileRisk?.churnPercent ?? 0}%
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </details>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Side sheet / modal with full ranked list of all affected files */}
                                        {impactSheetOpen && (
                                            <div
                                                className="absolute inset-0 z-40 bg-[#07090A]/80 backdrop-blur-sm flex justify-end animate-in fade-in duration-150"
                                                onClick={() => setImpactSheetOpen(false)}
                                            >
                                                <div
                                                    className="w-full max-w-lg h-full bg-[#10161A] border-l border-white/10 shadow-2xl flex flex-col p-5 overflow-hidden"
                                                    onClick={e => e.stopPropagation()}
                                                >
                                                    {/* Header */}
                                                    <div className="flex items-center justify-between pb-3 border-b border-white/[0.08] shrink-0">
                                                        <div>
                                                            <h3 className="text-sm font-semibold text-[#E8EAE6]">All Affected Files</h3>
                                                            <p className="text-xs text-[#8A918C]">
                                                                {rankedAll.length} total ({directCount} direct, {indirectCount} indirect)
                                                            </p>
                                                        </div>
                                                        <button
                                                            onClick={() => setImpactSheetOpen(false)}
                                                            className="p-1.5 rounded-lg text-[#8A918C] hover:text-[#E8EAE6] hover:bg-white/[0.06] transition-colors"
                                                            title="Close"
                                                        >
                                                            <X size={18} />
                                                        </button>
                                                    </div>

                                                    {/* Search box */}
                                                    <div className="py-3 shrink-0">
                                                        <div className="relative">
                                                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8A918C]" />
                                                            <input
                                                                type="text"
                                                                value={impactSearchQuery}
                                                                onChange={e => setImpactSearchQuery(e.target.value)}
                                                                placeholder="Search affected files..."
                                                                className="w-full pl-9 pr-3 py-1.5 text-xs bg-white/[0.04] border border-white/10 rounded-lg text-[#E8EAE6] placeholder-[#8A918C]/60 focus:outline-none focus:border-[#4FD1B5]/50 font-mono"
                                                                autoFocus
                                                            />
                                                        </div>
                                                    </div>

                                                    {/* Scrollable list */}
                                                    <div className="flex-1 min-h-0 overflow-y-auto scrollbar-custom space-y-1.5 pr-1">
                                                        {modalFiltered.length === 0 ? (
                                                            <div className="text-xs text-[#8A918C] text-center py-8">
                                                                No files matching "{impactSearchQuery}"
                                                            </div>
                                                        ) : (
                                                            modalFiltered.map((item, idx) => (
                                                                <div
                                                                    key={`sheet-${item.path}-${idx}`}
                                                                    onClick={() => {
                                                                        selectFile(item.path);
                                                                        setImpactSheetOpen(false);
                                                                    }}
                                                                    className="flex items-center justify-between p-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/15 transition-colors cursor-pointer group text-xs"
                                                                >
                                                                    {/* Rank */}
                                                                    <span className="font-mono text-[11px] text-[#8A918C] w-6 shrink-0">
                                                                        {idx + 1}
                                                                    </span>

                                                                    {/* Name & Folder */}
                                                                    <div className="min-w-0 flex-1 mr-3">
                                                                        <div className="flex items-center gap-1.5">
                                                                            <span className="font-mono text-[#E8EAE6] group-hover:text-[#4FD1B5] font-semibold truncate" title={item.path}>
                                                                                {item.name}
                                                                            </span>
                                                                            <span className={cn(
                                                                                "font-sans text-[10px] px-1.5 py-0.2 rounded border shrink-0",
                                                                                item.type === 'direct'
                                                                                    ? "border-[#E3A04A]/30 text-[#E3A04A] bg-[#E3A04A]/10"
                                                                                    : "border-white/15 text-[#8A918C] bg-white/[0.03]"
                                                                            )}>
                                                                                {item.type === 'direct' ? 'Direct' : `${item.hops || 2} hops`}
                                                                            </span>
                                                                        </div>
                                                                        {item.folder && (
                                                                            <span className="font-mono text-[10.5px] text-[#8A918C] truncate block mt-0.5" title={item.folder}>
                                                                                {item.folder}
                                                                            </span>
                                                                        )}
                                                                    </div>

                                                                    {/* Risk bar and score */}
                                                                    <div className="flex items-center gap-2 shrink-0">
                                                                        <div className="w-14 h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                                                                            <div
                                                                                className="h-full rounded-full"
                                                                                style={{
                                                                                    width: `${item.score}%`,
                                                                                    backgroundColor: item.type === 'direct' ? '#E3A04A' : '#8A918C'
                                                                                }}
                                                                            />
                                                                        </div>
                                                                        <span className="font-mono text-[11px] text-[#8A918C] w-6 text-right">
                                                                            {item.score}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            ))
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}
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
                            <div className={cn(
                                "flex flex-col overflow-hidden",
                                isChatExpanded
                                    ? "fixed inset-0 z-50 bg-[#07090A] motion-reduce:transition-none"
                                    : "flex-1 flex min-h-0 glass-surface border-white/10 rounded-xl"
                            )}>
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
                                                middle={
                                                    <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap">
                                                        <ThemedSelect
                                                            value={askMode}
                                                            onChange={setAskMode}
                                                            options={ASK_MODE_OPTIONS}
                                                            title="Answer mode"
                                                        />
                                                        {!isChatExpanded && (
                                                            <div className="relative">
                                                                <button
                                                                    ref={normalChatsBtnRef}
                                                                    type="button"
                                                                    onClick={() => setNormalChatsOpen(!normalChatsOpen)}
                                                                    className={cn(
                                                                        "px-2 py-0.5 rounded text-[11px] font-mono border transition-colors flex items-center gap-1 cursor-pointer",
                                                                        normalChatsOpen
                                                                            ? "border-[#4FD1B5]/40 bg-[#4FD1B5]/10 text-[#4FD1B5]"
                                                                            : "border-white/10 bg-white/[0.02] text-[#8A918C] hover:text-[#E8EAE6] hover:border-white/20"
                                                                    )}
                                                                    title={`Chats (${chats.length})`}
                                                                >
                                                                    <MessageSquare size={11} />
                                                                    <span className="hidden min-[480px]:inline">Chats ({chats.length})</span>
                                                                    <ChevronDown size={10} className={cn("transition-transform duration-150", normalChatsOpen && "rotate-180")} />
                                                                </button>
                                                                {isDesktop && (
                                                                    <Popover
                                                                        isOpen={normalChatsOpen}
                                                                        onClose={() => setNormalChatsOpen(false)}
                                                                        triggerRef={normalChatsBtnRef}
                                                                        width={340}
                                                                        align="start"
                                                                        role="menu"
                                                                        className="w-[340px] max-h-[60vh] flex flex-col overflow-hidden"
                                                                    >
                                                                        {renderChatsList(false)}
                                                                    </Popover>
                                                                )}
                                                                {!isDesktop && normalChatsOpen && (
                                                                    <div
                                                                        className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-xs motion-reduce:transition-none"
                                                                        onClick={() => setNormalChatsOpen(false)}
                                                                        role="dialog"
                                                                        aria-modal="true"
                                                                        aria-label="Chats"
                                                                    >
                                                                        <div
                                                                            className="w-full max-h-[75dvh] bg-[#0C0F12] border-t border-white/10 rounded-t-[16px] flex flex-col overflow-hidden shadow-2xl animate-in slide-in-from-bottom duration-200"
                                                                            onClick={e => e.stopPropagation()}
                                                                        >
                                                                            <div className="w-full flex items-center justify-center pt-2.5 pb-1 shrink-0">
                                                                                <div className="w-10 h-1 bg-white/20 rounded-full" />
                                                                            </div>
                                                                            <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 shrink-0">
                                                                                <span className="text-xs font-semibold text-[#E8EAE6]">Chats ({chats.length})</span>
                                                                                <button
                                                                                    onClick={() => setNormalChatsOpen(false)}
                                                                                    className="p-1 rounded-lg text-[#8A918C] hover:text-[#E8EAE6] hover:bg-white/[0.06] transition-colors"
                                                                                    title="Close"
                                                                                >
                                                                                    <X size={16} />
                                                                                </button>
                                                                            </div>
                                                                            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-custom p-2">
                                                                                {renderChatsList(false)}
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                        {isChatExpanded && (
                                                            <button
                                                                type="button"
                                                                onClick={() => setExpandedEvidenceOpen(!expandedEvidenceOpen)}
                                                                className={cn(
                                                                    "px-2 py-0.5 rounded text-[11px] font-mono border transition-colors flex items-center gap-1 cursor-pointer",
                                                                    expandedEvidenceOpen
                                                                        ? "border-[#4FD1B5]/40 bg-[#4FD1B5]/10 text-[#4FD1B5]"
                                                                        : "border-white/10 bg-white/[0.02] text-[#8A918C] hover:text-[#E8EAE6]"
                                                                )}
                                                                title="Toggle evidence panel"
                                                            >
                                                                <span className="hidden min-[480px]:inline">Evidence </span>
                                                                <span>({isActiveBriefCountSuppressed ? 0 : activeEvidence.length})</span>
                                                            </button>
                                                        )}
                                                    </div>
                                                }
                                                primaryAction={
                                                    <div className="flex items-center gap-1.5">
                                                        <button
                                                            onClick={() => setIsChatExpanded(!isChatExpanded)}
                                                            className="p-1 rounded-md text-[11px] font-medium text-[#8A918C] hover:text-[#E8EAE6] hover:bg-white/[0.04] transition-colors cursor-pointer flex items-center justify-center border border-white/10 w-7 h-7"
                                                            title={isChatExpanded ? "Collapse chat (Esc)" : "Expand chat"}
                                                        >
                                                            {isChatExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                                                        </button>
                                                        <button
                                                            onClick={handleNewChat}
                                                            className="px-2.5 py-1 rounded-md text-[11px] font-medium text-[#8A918C] hover:text-[#E8EAE6] hover:bg-white/[0.04] transition-colors cursor-pointer flex items-center gap-1 border border-white/10"
                                                            title="Start a new chat"
                                                        >
                                                            <Plus size={12} />
                                                            <span className="hidden min-[480px]:inline">New chat</span>
                                                        </button>
                                                    </div>
                                                }
                                                customMenu={(close) => (
                                                    <div className="space-y-0.5">
                                                        <button
                                                            onClick={() => {
                                                                handleCopyLastAnswer();
                                                                close();
                                                            }}
                                                            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left hover:bg-white/[0.06] transition-colors cursor-pointer text-[#E8EAE6]"
                                                        >
                                                            <Copy size={13} className="text-[#4FD1B5]" />
                                                            <span>Copy last answer</span>
                                                        </button>

                                                        <button
                                                            onClick={() => {
                                                                handleCopyChatPRComment();
                                                                close();
                                                            }}
                                                            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left hover:bg-white/[0.06] transition-colors cursor-pointer text-[#E8EAE6]"
                                                        >
                                                            <Share2 size={13} className="text-[#4FD1B5]" />
                                                            <span>Copy as PR comment</span>
                                                        </button>

                                                        <button
                                                            onClick={() => {
                                                                handleExportChatMarkdown();
                                                                close();
                                                            }}
                                                            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left hover:bg-white/[0.06] transition-colors cursor-pointer text-[#E8EAE6]"
                                                        >
                                                            <Download size={13} className="text-[#4FD1B5]" />
                                                            <span>Export chat as Markdown</span>
                                                        </button>

                                                        <button
                                                            onClick={() => {
                                                                if (activeChatId) {
                                                                    const cur = chats.find(c => c.id === activeChatId);
                                                                    handleRenameChat(activeChatId, cur?.title || 'New chat');
                                                                }
                                                                close();
                                                            }}
                                                            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left hover:bg-white/[0.06] transition-colors cursor-pointer text-[#E8EAE6]"
                                                        >
                                                            <FileText size={13} className="text-[#4FD1B5]" />
                                                            <span>Rename chat</span>
                                                        </button>

                                                        <button
                                                            onClick={() => {
                                                                handleClearMessages();
                                                                close();
                                                            }}
                                                            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left hover:bg-white/[0.06] transition-colors cursor-pointer text-[#E8EAE6]"
                                                        >
                                                            <RefreshCw size={13} className="text-[#4FD1B5]" />
                                                            <span>Clear messages</span>
                                                        </button>

                                                        <button
                                                            onClick={() => {
                                                                if (activeChatId) {
                                                                    handleDeleteChat(activeChatId);
                                                                }
                                                                close();
                                                            }}
                                                            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left hover:bg-red-500/10 text-red-400 transition-colors cursor-pointer border-t border-white/[0.06] pt-1.5 mt-1"
                                                        >
                                                            <Trash2 size={13} />
                                                            <span>Delete chat</span>
                                                        </button>
                                                    </div>
                                                )}
                                            />
                                        </div>

                                <div className="flex-1 min-h-0 flex overflow-hidden">
                                    {isChatExpanded && isDesktop && (
                                        <div className="w-[260px] shrink-0 border-r border-white/10 flex flex-col bg-[#0B0E10] overflow-hidden">
                                            {renderChatsList(true)}
                                        </div>
                                    )}
                                    <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
                                        {/* Chat Messages */}
                                        <div
                                            ref={chatScrollContainerRef}
                                            onScroll={e => {
                                                if (activeChatId) {
                                                    setAskAiScrollPos(activeChatId, (e.target as HTMLElement).scrollTop);
                                                }
                                            }}
                                            className="flex-1 p-4 overflow-y-auto scrollbar-custom min-h-0 relative"
                                            onDragOver={e => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                setIsDraggingOverChat(true);
                                            }}
                                            onDragEnter={e => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                setIsDraggingOverChat(true);
                                            }}
                                            onDragLeave={e => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                if (e.currentTarget === e.target) {
                                                    setIsDraggingOverChat(false);
                                                }
                                            }}
                                            onDrop={e => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                setIsDraggingOverChat(false);
                                                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                                                    handleAttachFiles(e.dataTransfer.files);
                                                }
                                            }}
                                        >
                                            {isDraggingOverChat && (
                                                <div className="absolute inset-0 bg-[#07090A]/90 border-2 border-dashed border-[#4FD1B5] rounded-xl z-30 flex flex-col items-center justify-center pointer-events-none gap-2 text-[#4FD1B5]">
                                                    <Paperclip size={28} className="animate-bounce" />
                                                    <span className="text-xs font-mono font-medium">Drop images here (up to 3)</span>
                                                </div>
                                            )}
                                            <div className={cn("space-y-3", isChatExpanded && "max-w-[920px] mx-auto w-full")}>
                                                {chatMessages.length === 0 && !aiError ? (
                                                    <div className="h-full flex flex-col items-center justify-center text-center py-16 px-4">
                                                        <div className="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center mb-3 text-[#8A918C]">
                                                            <MessageSquare size={18} />
                                                        </div>
                                                        <div className="text-xs font-medium text-[#E8EAE6] mb-1">
                                                            Ask about {selectedSymbol?.name || (selectedFile ? selectedFile.split('/').pop() : 'this repository')}
                                                        </div>
                                                        <div className="text-[11px] text-[#8A918C] max-w-[280px] mb-4">
                                                            Questions are answered with the symbols and files that prove them. Type a prompt below or pick a suggestion.
                                                        </div>
                                                        <div className="flex flex-wrap items-center justify-center gap-2 max-w-[420px]">
                                                            {getStarterQuestionsForTarget(selectedFile, attachedImages.length).map((starter, sIdx) => (
                                                                <button
                                                                    key={sIdx}
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setAskQ('');
                                                                        askAI(starter);
                                                                    }}
                                                                    className="text-[11px] font-mono px-3 py-1.5 rounded-full border border-white/10 bg-white/[0.02] text-[#8A918C] hover:text-[#E8EAE6] hover:border-[#4FD1B5]/40 hover:bg-[#4FD1B5]/[0.05] transition-colors cursor-pointer text-left"
                                                                >
                                                                    {starter}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <>
                                                        {chatMessages.length === 0 && aiError && renderAiErrorCard()}
                                                        {chatMessages.map((msg, idx) => (
                                                            <Fragment key={idx}>
                                                                <div className={cn("group flex gap-1.5", msg.role === 'user' ? "flex-col sm:flex-row items-end sm:items-center justify-end" : "items-center justify-start")}>
                                                            {msg.role === 'user' ? (
                                                                <>
                                                                    <div className={cn(
                                                                        "flex items-center gap-1 transition-opacity shrink-0 order-2 sm:order-1",
                                                                        "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100"
                                                                    )}>
                                                                        {/* Copy */}
                                                                        <button
                                                                            type="button"
                                                                            disabled={isStreaming || !msg.content.trim()}
                                                                            onClick={() => handleCopyUserMessage(idx)}
                                                                            aria-label="Copy message"
                                                                            title={!msg.content.trim() ? "Cannot copy image-only message" : (copiedUserMsgIdx === idx ? "Copied" : "Copy")}
                                                                            className={cn(
                                                                                "p-1 rounded text-[#8A918C] hover:text-[#E8EAE6] hover:bg-white/[0.08] transition-colors focus:opacity-100",
                                                                                (isStreaming || !msg.content.trim()) ? "opacity-30 cursor-not-allowed" : "cursor-pointer"
                                                                            )}
                                                                        >
                                                                            {copiedUserMsgIdx === idx ? <Check size={12} className="text-[#4FD1B5]" /> : <Copy size={12} />}
                                                                        </button>

                                                                        {/* Resend */}
                                                                        {(() => {
                                                                            const hasMissingImageData = Boolean(msg.images && msg.images.some(img => !img.data));
                                                                            const resendDisabled = isStreaming || hasMissingImageData;
                                                                            return (
                                                                                <button
                                                                                    type="button"
                                                                                    disabled={resendDisabled}
                                                                                    onClick={() => handleResendMessage(idx)}
                                                                                    aria-label="Resend message"
                                                                                    title={hasMissingImageData ? "Attach the image again" : "Resend"}
                                                                                    className={cn(
                                                                                        "p-1 rounded text-[#8A918C] hover:text-[#E8EAE6] hover:bg-white/[0.08] transition-colors focus:opacity-100",
                                                                                        resendDisabled ? "opacity-30 cursor-not-allowed" : "cursor-pointer"
                                                                                    )}
                                                                                >
                                                                                    <RefreshCw size={12} />
                                                                                </button>
                                                                            );
                                                                        })()}

                                                                        {/* Edit */}
                                                                        <button
                                                                            type="button"
                                                                            disabled={isStreaming}
                                                                            onClick={() => handleEditMessage(idx)}
                                                                            aria-label="Edit message"
                                                                            title="Edit message"
                                                                            className={cn(
                                                                                "p-1 rounded text-[#8A918C] hover:text-[#E8EAE6] hover:bg-white/[0.08] transition-colors focus:opacity-100",
                                                                                isStreaming ? "opacity-30 cursor-not-allowed" : "cursor-pointer"
                                                                            )}
                                                                        >
                                                                            <Pencil size={12} />
                                                                        </button>
                                                                    </div>

                                                                    <div className="max-w-[94%] sm:max-w-[70%] px-3.5 py-2.5 rounded-xl bg-white/[0.07] border border-white/10 text-xs text-[#E8EAE6] leading-relaxed space-y-2 order-1 sm:order-2">
                                                                        {msg.images && msg.images.length > 0 && (
                                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                                {msg.images.map((img, imgIdx) => {
                                                                                    const src = img.thumbUrl || (img.data ? `data:${img.mime};base64,${img.data}` : undefined);
                                                                                    if (!src) return null;
                                                                                    const fullSrc = img.data ? `data:${img.mime};base64,${img.data}` : (img.thumbUrl || src);
                                                                                    return (
                                                                                        <button
                                                                                            key={imgIdx}
                                                                                            type="button"
                                                                                            onClick={() => setLightboxImage(fullSrc)}
                                                                                            className="group relative rounded-lg border border-white/15 overflow-hidden hover:border-[#4FD1B5]/60 transition-colors cursor-pointer bg-black/40"
                                                                                            title="Click to zoom image"
                                                                                        >
                                                                                            <img
                                                                                                src={src}
                                                                                                alt={img.name || `Attachment ${imgIdx + 1}`}
                                                                                                className="max-h-[120px] object-contain rounded-lg"
                                                                                            />
                                                                                        </button>
                                                                                    );
                                                                                })}
                                                                            </div>
                                                                        )}
                                                                        {msg.content ? <div>{msg.content}</div> : null}
                                                                    </div>
                                                                </>
                                                            ) : (
                                                                <div className="max-w-[94%] sm:max-w-[85%] px-3.5 py-3 rounded-xl bg-white/[0.02] border border-white/10 text-xs text-[#E8EAE6] leading-relaxed space-y-2">
                                                                    {msg.isThinking ? (
                                                                        <AskAiThinkingIndicator phase={askWaitingPhase} />
                                                                    ) : (
                                                                        <>
                                                                            <MarkdownRenderer content={msg.content} />

                                                                            {msg.stopped && (
                                                                                <div className="pt-1 text-[11px] text-[#E3A04A] font-mono flex items-center gap-1">
                                                                                    <span>Stopped</span>
                                                                                </div>
                                                                            )}

                                                                            {msg.truncated && (
                                                                                <div className="pt-2 flex items-center justify-between gap-2 border-t border-white/[0.06] mt-2">
                                                                                    <span className="text-[11px] text-[#E3A04A] font-mono">Answer was cut off</span>
                                                                                    <button
                                                                                        type="button"
                                                                                        disabled={isStreaming}
                                                                                        onClick={() => handleContinueAnswer(idx)}
                                                                                        className={cn(
                                                                                            "text-[11px] font-mono px-2.5 py-1 rounded border border-[#E3A04A]/40 bg-[#E3A04A]/10 text-[#E3A04A] hover:bg-[#E3A04A]/20 transition-colors flex items-center gap-1",
                                                                                            isStreaming ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
                                                                                        )}
                                                                                    >
                                                                                        Continue
                                                                                    </button>
                                                                                </div>
                                                                            )}

                                                                            {/* Evidence chips: mono, path:line, base name bold, folder muted */}
                                                                            {(!msg.mode || msg.mode === 'repo') && msg.evidence && msg.evidence.length > 0 && !isBriefCountAnswerWithoutLineCitation(msg, getPrecedingUserQuestion(idx)) && (
                                                                                <div className="pt-2 border-t border-white/[0.06] flex items-center gap-1.5 flex-wrap">
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={() => {
                                                                                            setSelectedAnswerIdx(idx);
                                                                                            if (!isDesktop) {
                                                                                                setMobileDetailsOpen(true);
                                                                                            } else if (isChatExpanded) {
                                                                                                setExpandedEvidenceOpen(true);
                                                                                            }
                                                                                        }}
                                                                                        className={cn(
                                                                                            "text-[10px] font-mono px-1.5 py-0.5 rounded border transition-colors cursor-pointer flex items-center gap-1",
                                                                                            activeAssistantIdx === idx
                                                                                                ? "border-[#4FD1B5]/40 bg-[#4FD1B5]/10 text-[#4FD1B5] font-semibold"
                                                                                                : "border-white/10 bg-white/[0.02] text-[#8A918C] hover:text-[#E8EAE6] hover:bg-white/[0.05]"
                                                                                        )}
                                                                                        title={`Select answer #${getAnswerNumber(idx)} evidence`}
                                                                                    >
                                                                                        <span>Evidence ({msg.evidence.length})</span>
                                                                                    </button>
                                                                                    {msg.evidence.map((item, eIdx) => {
                                                                                        const fullPath = item.path;
                                                                                        const lastSlash = fullPath.lastIndexOf('/');
                                                                                        const folder = lastSlash !== -1 ? fullPath.slice(0, lastSlash + 1) : '';
                                                                                        const baseName = lastSlash !== -1 ? fullPath.slice(lastSlash + 1) : fullPath;
                                                                                        const linePart = item.line !== undefined
                                                                                            ? (item.endLine && item.endLine !== item.line ? `:${item.line}-${item.endLine}` : `:${item.line}`)
                                                                                            : '';

                                                                                        const isAnalyzed = analyzedPaths.has(fullPath) ||
                                                                                            analyzedPaths.has(fullPath.replace(/^\.\//, '')) ||
                                                                                            Array.from(analyzedPaths).some(p => p.endsWith('/' + fullPath) || fullPath.endsWith('/' + p));

                                                                                        const tooltip = isAnalyzed
                                                                                            ? `${fullPath}${linePart}${item.snippet ? `\n\n${item.snippet}` : ''}`
                                                                                            : 'Not analyzed';

                                                                                        return (
                                                                                            <button
                                                                                                key={eIdx}
                                                                                                disabled={!isAnalyzed}
                                                                                                onClick={() => {
                                                                                                    setSelectedAnswerIdx(idx);
                                                                                                    if (isChatExpanded) setExpandedEvidenceOpen(true);
                                                                                                    if (!isAnalyzed) return;
                                                                                                    selectFile(fullPath);
                                                                                                    if (item.line !== undefined) {
                                                                                                        setCodeHighlightLine(item.line, item.endLine);
                                                                                                    } else {
                                                                                                        setCodeHighlightLine(null);
                                                                                                    }
                                                                                                    setActiveTab('Code');
                                                                                                }}
                                                                                                className={cn(
                                                                                                    "font-mono text-[10px] px-2 py-0.5 rounded-md border transition-colors inline-flex items-center",
                                                                                                    isAnalyzed
                                                                                                        ? "border-white/10 bg-white/[0.03] text-[#4FD1B5] hover:bg-[#4FD1B5]/10 hover:border-[#4FD1B5]/30 cursor-pointer"
                                                                                                        : "border-white/5 bg-white/[0.01] text-[#8A918C]/40 cursor-not-allowed opacity-60"
                                                                                                )}
                                                                                                title={tooltip}
                                                                                            >
                                                                                                {folder && <span className="text-[#8A918C] font-normal">{folder}</span>}
                                                                                                <span className="font-semibold">{baseName}</span>
                                                                                                {linePart && <span className="font-normal">{linePart}</span>}
                                                                                            </button>
                                                                                        );
                                                                                    })}
                                                                                </div>
                                                                            )}

                                                                            {/* Collapsible disclosure "What I could not see" if missingData is non-empty */}
                                                                            {msg.missingData && msg.missingData.length > 0 && (
                                                                                <details className="pt-1.5 text-[11px] text-[#8A918C] group cursor-pointer font-sans">
                                                                                    <summary className="hover:text-[#E8EAE6] transition-colors select-none list-none flex items-center gap-1 font-mono">
                                                                                        <span className="group-open:rotate-90 transition-transform inline-block">›</span>
                                                                                        <span>What I could not see</span>
                                                                                    </summary>
                                                                                    <ul className="mt-1 pl-4 list-disc space-y-0.5 text-[11px] text-[#8A918C]/80">
                                                                                        {msg.missingData.map((item, mIdx) => (
                                                                                            <li key={mIdx}>{item}</li>
                                                                                        ))}
                                                                                    </ul>
                                                                                </details>
                                                                            )}

                                                                            {/* Follow-up chips: only under last assistant answer, never while streaming */}
                                                                            {idx === lastAssistantIdx && !isStreaming && msg.followups && msg.followups.length > 0 && (() => {
                                                                                const visibleFollowups = msg.followups.filter(f => !isQuestionAlreadyAsked(f));
                                                                                if (visibleFollowups.length === 0) return null;
                                                                                return (
                                                                                    <div className="pt-2.5 border-t border-white/[0.06] flex items-center gap-1.5 flex-wrap">
                                                                                        {visibleFollowups.map((followup, fIdx) => (
                                                                                            <button
                                                                                                key={fIdx}
                                                                                                onClick={() => askAI(followup)}
                                                                                                className="text-[11px] font-mono px-2.5 py-1 rounded-full border border-[#4FD1B5]/30 bg-[#4FD1B5]/[0.05] text-[#4FD1B5] hover:bg-[#4FD1B5]/15 hover:border-[#4FD1B5]/50 transition-colors cursor-pointer text-left"
                                                                                            >
                                                                                                {followup}
                                                                                            </button>
                                                                                        ))}
                                                                                    </div>
                                                                                );
                                                                            })()}

                                                                            {/* Per-answer actions row */}
                                                                            <div className="pt-2 flex items-center justify-between gap-2 border-t border-white/[0.04]">
                                                                                <div className="flex items-center gap-1.5">
                                                                                    <button
                                                                                        onClick={() => {
                                                                                            navigator.clipboard.writeText(msg.content);
                                                                                            setCopiedMsgIdx(idx);
                                                                                            setTimeout(() => setCopiedMsgIdx(null), 1500);
                                                                                        }}
                                                                                        className="p-1 rounded text-[#8A918C] hover:text-[#E8EAE6] hover:bg-white/[0.06] transition-colors cursor-pointer"
                                                                                        title="Copy answer"
                                                                                    >
                                                                                        {copiedMsgIdx === idx ? <Check size={12} className="text-[#4FD1B5]" /> : <Copy size={12} />}
                                                                                    </button>

                                                                                    <button
                                                                                        onClick={() => handleRegenerateTurn(idx)}
                                                                                        disabled={isStreaming}
                                                                                        className={cn(
                                                                                            "p-1 rounded transition-colors",
                                                                                            isStreaming ? "text-[#8A918C]/40 cursor-not-allowed" : "text-[#8A918C] hover:text-[#E8EAE6] hover:bg-white/[0.06] cursor-pointer"
                                                                                        )}
                                                                                        title="Regenerate this answer"
                                                                                    >
                                                                                        <RefreshCw size={12} />
                                                                                    </button>
                                                                                </div>

                                                                                <div className="flex items-center gap-2">
                                                                                    {(() => {
                                                                                        const citedFiles = Array.from(new Set([
                                                                                            ...(msg.evidence?.map(e => e.path) || []),
                                                                                            ...(selectedFile ? [selectedFile] : [])
                                                                                        ])).filter(Boolean);
                                                                                        if (citedFiles.length === 0) return null;
                                                                                        const allInPlan = citedFiles.every(f => changeSet.includes(f));

                                                                                        return (
                                                                                            <button
                                                                                                onClick={() => {
                                                                                                    if (allInPlan) {
                                                                                                        citedFiles.forEach(f => removeFromChangeSet(f));
                                                                                                    } else {
                                                                                                        citedFiles.forEach(f => addToChangeSet(f));
                                                                                                    }
                                                                                                }}
                                                                                                className={cn(
                                                                                                    "text-[10px] font-mono px-2 py-0.5 rounded border transition-colors flex items-center gap-1 cursor-pointer",
                                                                                                    allInPlan
                                                                                                        ? "border-[#4FD1B5]/40 bg-[#4FD1B5]/10 text-[#4FD1B5]"
                                                                                                        : "border-white/10 bg-white/[0.02] text-[#8A918C] hover:text-[#E8EAE6] hover:bg-white/[0.05]"
                                                                                                )}
                                                                                                title={allInPlan ? "Remove cited files from plan" : "Add cited files to change set plan"}
                                                                                            >
                                                                                                {allInPlan ? <Check size={10} className="text-[#4FD1B5]" /> : <Plus size={10} />}
                                                                                                <span>{allInPlan ? 'In plan' : 'Add to plan'}</span>
                                                                                            </button>
                                                                                        );
                                                                                    })()}

                                                                                    {(!msg.mode || msg.mode === 'repo') && msg.usedContext && msg.usedContext.provider !== 'greeting' && (
                                                                                        <span
                                                                                            className="p-1 text-[#8A918C] hover:text-[#E8EAE6] transition-colors cursor-help inline-flex items-center"
                                                                                            title={`Context: ${msg.usedContext.scope === 'repo' ? 'repository summary' : (selectedFile || 'file')}, ${msg.usedContext.commits} ${msg.usedContext.commits === 1 ? 'commit' : 'commits'}, ${[msg.usedContext.provider, msg.usedContext.model].filter(Boolean).join(' ') || 'AI'}${msg.usedContext.timings ? `, total: ${msg.usedContext.timings.total}ms, first token: ${msg.usedContext.timings.firstToken}ms` : ''}`}
                                                                                        >
                                                                                            <Info size={12} />
                                                                                        </span>
                                                                                    )}
                                                                                </div>
                                                                            </div>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                        {msg.role === 'user' && idx === lastUserIdx && aiError && renderAiErrorCard(msg)}
                                                    </Fragment>
                                                ))}
                                            </>
                                        )}
                                                <div ref={messagesEndRef} />
                                            </div>
                                        </div>


                                        {/* Composer - pinned at bottom with safe-area padding */}
                                        <div className="p-3 pb-[max(12px,env(safe-area-inset-bottom))] border-t border-white/10 bg-[#07090A]/95 backdrop-blur-xs shrink-0 sticky bottom-0 z-20">
                                            <div className={cn(isChatExpanded && "max-w-[920px] mx-auto w-full")}>
                                                {attachedImages.length > 0 && (
                                                    <div className="mb-2 flex items-center gap-2 flex-wrap">
                                                        {attachedImages.map((img, idx) => (
                                                            <div
                                                                key={img.id || idx}
                                                                className="relative group w-14 h-14 rounded-lg border border-white/20 bg-black/40 overflow-hidden flex items-center justify-center shrink-0"
                                                            >
                                                                <img
                                                                    src={img.thumbUrl}
                                                                    alt={img.name || `Image ${idx + 1}`}
                                                                    className="w-full h-full object-cover"
                                                                />
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setAttachedImages(prev => prev.filter((_, i) => i !== idx));
                                                                        setImageWarning(null);
                                                                    }}
                                                                    className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-black/70 hover:bg-red-500/80 text-white transition-colors cursor-pointer"
                                                                    title="Remove image"
                                                                >
                                                                    <X size={10} />
                                                                </button>
                                                            </div>
                                                        ))}
                                                        <span className="text-[10px] text-[#8A918C] font-mono">
                                                            {attachedImages.length}/3 attached
                                                        </span>
                                                    </div>
                                                )}
                                                {imageWarning && (
                                                    <div className="mb-2 text-[11px] text-amber-300 font-mono flex items-center gap-1.5">
                                                        <ShieldAlert size={12} className="shrink-0" />
                                                        <span>{imageWarning}</span>
                                                    </div>
                                                )}
                                                {editingMessageIdx !== null && (
                                                    <div className="mb-2 px-2.5 py-1.5 rounded-md bg-white/[0.04] border border-[#4FD1B5]/30 flex items-center justify-between text-xs text-[#E8EAE6]">
                                                        <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#4FD1B5]">
                                                            <Pencil size={12} />
                                                            <span>Editing message</span>
                                                            {editingHasMissingImages && (
                                                                <span className="text-amber-300 font-normal">· Re-attach the image to include it</span>
                                                            )}
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={handleCancelEdit}
                                                            className="text-[10px] text-[#8A918C] hover:text-[#E8EAE6] px-1.5 py-0.5 rounded hover:bg-white/[0.06] transition-colors cursor-pointer"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </div>
                                                )}
                                                <div className="flex items-end gap-2 glass-surface p-1.5 rounded-lg border-white/10 focus-within:border-[#4FD1B5]/60 focus-within:ring-1 focus-within:ring-[#4FD1B5]/40 transition-colors">
                                                    <input
                                                        ref={fileInputRef}
                                                        type="file"
                                                        accept="image/png,image/jpeg,image/webp"
                                                        multiple
                                                        className="hidden"
                                                        onChange={e => {
                                                            if (e.target.files) {
                                                                handleAttachFiles(e.target.files);
                                                                e.target.value = '';
                                                            }
                                                        }}
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => fileInputRef.current?.click()}
                                                        className={cn(
                                                            "w-11 h-11 sm:w-auto sm:h-auto sm:p-1.5 rounded-lg sm:rounded text-[#8A918C] hover:text-[#E8EAE6] hover:bg-white/[0.06] transition-colors cursor-pointer shrink-0 mb-0.5 flex items-center justify-center",
                                                            attachedImages.length >= 3 && "opacity-40 cursor-not-allowed"
                                                        )}
                                                        disabled={attachedImages.length >= 3}
                                                        title="Attach image"
                                                    >
                                                        <Paperclip size={16} />
                                                    </button>
                                                    <textarea
                                                        ref={textareaRef}
                                                        rows={1}
                                                        value={askQ}
                                                        onPaste={e => {
                                                            const items = e.clipboardData?.items;
                                                            if (items) {
                                                                const imageFiles: File[] = [];
                                                                for (let i = 0; i < items.length; i++) {
                                                                    const item = items[i];
                                                                    if (item.type.startsWith('image/')) {
                                                                        const file = item.getAsFile();
                                                                        if (file) imageFiles.push(file);
                                                                    }
                                                                }
                                                                if (imageFiles.length > 0) {
                                                                    e.preventDefault();
                                                                    handleAttachFiles(imageFiles);
                                                                }
                                                            }
                                                        }}
                                                        onChange={e => {
                                                            setAskQ(e.target.value);
                                                            e.target.style.height = 'auto';
                                                            e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                                                        }}
                                                        onKeyDown={e => {
                                                            if (e.key === 'Enter') {
                                                                if (e.shiftKey) {
                                                                    return;
                                                                }
                                                                e.preventDefault();
                                                                if (!isStreaming && rateLimitCountdown === 0 && (askQ.trim() || attachedImages.length > 0)) {
                                                                    handleSendMessage();
                                                                }
                                                            } else if (e.key === 'Escape') {
                                                                e.preventDefault();
                                                                if (isStreaming) {
                                                                    handleStopAi();
                                                                } else if (isChatExpanded) {
                                                                    setIsChatExpanded(false);
                                                                }
                                                            }
                                                        }}
                                                        placeholder={
                                                            attachedImages.length > 0
                                                                ? "Ask about attached image(s) (press Enter for default analysis)..."
                                                                : `Ask about ${selectedSymbol?.name || (selectedFile ? selectedFile.split('/').pop() : 'the repository')}...`
                                                        }
                                                        className="flex-1 bg-transparent px-2 py-1 text-base sm:text-xs text-[#E8EAE6] placeholder:text-[#8A918C]/60 outline-none font-sans resize-none max-h-[120px] scrollbar-custom leading-relaxed"
                                                    />
                                                    {isStreaming ? (
                                                        <button
                                                            type="button"
                                                            onClick={handleStopAi}
                                                            className="min-h-[44px] sm:min-h-0 px-3.5 py-1.5 text-xs shrink-0 rounded-lg sm:rounded font-mono flex items-center gap-1.5 bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 cursor-pointer transition-colors mb-0.5 justify-center"
                                                            title="Stop generating"
                                                        >
                                                            <Square size={12} className="fill-current" />
                                                            <span>Stop</span>
                                                        </button>
                                                    ) : (
                                                        <Button
                                                            onClick={handleSendMessage}
                                                            className="min-h-[44px] sm:min-h-0 px-3.5 py-1.5 text-xs shrink-0 mb-0.5 flex items-center justify-center"
                                                            disabled={(!askQ.trim() && attachedImages.length === 0) || isStreaming || rateLimitCountdown > 0}
                                                            title={rateLimitCountdown > 0 ? `Wait ${rateLimitCountdown}s` : undefined}
                                                        >
                                                            {rateLimitCountdown > 0 ? `Wait ${rateLimitCountdown}s` : 'Send'}
                                                        </Button>
                                                    )}
                                                </div>
                                                <div className="text-center text-[10px] text-[#8A918C]/70 mt-2 font-mono flex items-center justify-center gap-1">
                                                    <ShieldAlert size={11} /> AI-generated · verify critical paths against code and tests
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Right panel inside expanded chat: collapsible 320px column showing the Evidence list for active answer */}
                                    {isChatExpanded && expandedEvidenceOpen && isDesktop && (!activeAssistantMsg?.mode || activeAssistantMsg.mode === 'repo') && (
                                        <div className="w-[320px] shrink-0 border-l border-white/10 flex flex-col bg-[#07090A] overflow-hidden">
                                            <div className="p-3 border-b border-white/10 flex items-center justify-between shrink-0">
                                                <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-[#E8EAE6]">
                                                    <MessageSquare size={13} className="text-[#4FD1B5]" />
                                                    <span>{activeAnswerNumber ? `Evidence for answer #${activeAnswerNumber}` : "Evidence"}</span>
                                                    {!isActiveBriefCountSuppressed && activeEvidence.length > 0 && (
                                                        <span className="text-[10px] text-[#4FD1B5] px-1.5 py-0.2 rounded border border-[#4FD1B5]/30 bg-[#4FD1B5]/10">
                                                            {activeEvidence.length} cited
                                                        </span>
                                                    )}
                                                </div>
                                                <button
                                                    onClick={() => setExpandedEvidenceOpen(false)}
                                                    className="p-1 rounded text-[#8A918C] hover:text-[#E8EAE6] hover:bg-white/[0.05] transition-colors cursor-pointer"
                                                    title="Collapse evidence panel"
                                                >
                                                    <X size={14} />
                                                </button>
                                            </div>
                                            <div className="flex-1 overflow-y-auto scrollbar-custom p-3 space-y-2">
                                                {activeEvidence.length === 0 || isActiveBriefCountSuppressed ? (
                                                    <div className="text-center py-8 text-xs text-[#8A918C] font-mono">
                                                        {(isActiveBriefCountSuppressed || activeIsImageQuestion)
                                                            ? "No evidence needed for this answer"
                                                            : "No evidence for this answer"}
                                                    </div>
                                                ) : (
                                                    activeEvidence.map((item, idx) => {
                                                        const filePath = item.path;
                                                        const fileName = filePath?.split('/').pop() || filePath;
                                                        const rangeLabel = item.line !== undefined
                                                            ? (item.endLine && item.endLine !== item.line ? `L${item.line}-L${item.endLine}` : `L${item.line}`)
                                                            : '';
                                                        const isAnalyzed = analyzedPaths.has(filePath) ||
                                                            analyzedPaths.has(filePath.replace(/^\.\//, '')) ||
                                                            Array.from(analyzedPaths).some(p => p.endsWith('/' + filePath) || filePath.endsWith('/' + p));

                                                        return (
                                                            <button
                                                                key={idx}
                                                                onClick={() => {
                                                                    selectFile(filePath);
                                                                    if (item.line !== undefined) {
                                                                        setCodeHighlightLine(item.line, item.endLine);
                                                                    } else {
                                                                        setCodeHighlightLine(null);
                                                                    }
                                                                    setIsChatExpanded(false);
                                                                    setActiveTab('Code');
                                                                }}
                                                                className={cn(
                                                                    "w-full text-left p-2.5 rounded-lg border transition-colors cursor-pointer space-y-1 block",
                                                                    isAnalyzed
                                                                        ? "border-white/10 bg-white/[0.02] hover:border-[#4FD1B5]/40 hover:bg-white/[0.05]"
                                                                        : "border-white/5 bg-white/[0.01] opacity-70"
                                                                )}
                                                                title={`Open ${filePath}${rangeLabel ? `:${rangeLabel}` : ''} in Code viewer`}
                                                            >
                                                                <div className="flex justify-between items-center font-mono text-[11px] text-[#4FD1B5]">
                                                                    <span className="font-semibold truncate">{fileName}</span>
                                                                    {rangeLabel && <span className="text-[10px] text-[#8A918C] font-normal">{rangeLabel}</span>}
                                                                </div>
                                                                <div className="text-[10px] text-[#8A918C] font-mono truncate">
                                                                    {filePath}
                                                                </div>
                                                                {item.snippet && (
                                                                    <div className="text-[10px] text-[#8A918C]/80 font-mono line-clamp-3 bg-white/[0.02] p-1.5 rounded border border-white/[0.05]">
                                                                        {item.snippet}
                                                                    </div>
                                                                )}
                                                            </button>
                                                        );
                                                    })
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                                {lightboxImage && (
                                    <div
                                        className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm cursor-pointer"
                                        onClick={() => setLightboxImage(null)}
                                    >
                                        <div
                                            className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center"
                                            onClick={e => e.stopPropagation()}
                                        >
                                            <button
                                                onClick={() => setLightboxImage(null)}
                                                className="absolute -top-10 right-0 p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-[#E8EAE6] transition-colors cursor-pointer"
                                                title="Close (Esc)"
                                            >
                                                <X size={18} />
                                            </button>
                                            <img
                                                src={lightboxImage}
                                                alt="Enlarged preview"
                                                className="max-w-full max-h-[85vh] object-contain rounded-lg border border-white/20 shadow-2xl"
                                            />
                                        </div>
                                    </div>
                                )}
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
                                                    onClick={() => {
                                                        setSelectedHistoryCommit(commit);
                                                        if (!isDesktop) setMobileDetailsOpen(true);
                                                    }}
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
                                    <Button onClick={() => fetchHealth(true)} className="px-3 py-1 text-xs shrink-0 whitespace-nowrap" disabled={healthLoading || !graph}>
                                        {healthLoading ? <Loader2 size={12} className="animate-spin" /> : 'Re-check'}
                                    </Button>
                                }
                                onDownloadReport={handleDownloadHealthReport}
                                onCopyPRComment={handleCopyHealthPRComment}
                                onReanalyze={() => fetchHealth(true)}
                                onExport={() => downloadTextFile('repository-health.json', JSON.stringify(healthData || {}, null, 2), 'application/json')}
                            />

                            {healthLoading ? (
                                <div className="text-[#8A918C] py-16 flex flex-col items-center justify-center gap-2.5">
                                    <Loader2 size={20} className="animate-spin text-[#4FD1B5]" />
                                    <span className="text-xs font-mono">Analyzing repository health...</span>
                                </div>
                            ) : healthError ? (
                                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 space-y-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="space-y-1.5 flex-1 min-w-0">
                                            <div className="flex items-center gap-2 text-xs font-medium text-red-200">
                                                <ShieldAlert size={15} className="text-red-400 shrink-0" />
                                                <span>{healthError.message}</span>
                                            </div>
                                            {(healthError.status !== undefined || healthError.code) && (
                                                <div className="font-mono text-[10px] text-red-400/80 pl-6 space-y-0.5">
                                                    {healthError.status !== undefined && <div>Status: {healthError.status}</div>}
                                                    {healthError.code && <div>Code: {healthError.code}</div>}
                                                </div>
                                            )}
                                        </div>
                                        <Button
                                            onClick={() => fetchHealth(true)}
                                            className="px-3 py-1.5 text-xs bg-red-500/20 text-red-200 border border-red-500/30 hover:bg-red-500/30 flex items-center gap-1.5 shrink-0"
                                        >
                                            <RefreshCw size={12} />
                                            <span>Retry</span>
                                        </Button>
                                    </div>
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
                                                                <div className="flex items-center gap-1.5 overflow-x-auto whitespace-nowrap scrollbar-custom py-0.5">
                                                                    {(cycle || []).map((filePath, fIdx) => {
                                                                        const baseName = filePath ? filePath.split('/').pop() : '';
                                                                        const folder = filePath && filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : (filePath || '');
                                                                        return (
                                                                            <div key={fIdx} className="inline-flex items-center gap-1.5 shrink-0">
                                                                                <button
                                                                                    onClick={() => filePath && selectFile(filePath)}
                                                                                    className="font-mono text-xs text-[#E8EAE6] hover:text-[#4FD1B5] transition-colors cursor-pointer underline-offset-2 hover:underline"
                                                                                    title={folder}
                                                                                >
                                                                                    {baseName}
                                                                                </button>
                                                                                {fIdx < (cycle?.length || 0) - 1 && (
                                                                                    <span className="text-[#4FD1B5]/70 text-[10px] font-mono select-none">→</span>
                                                                                )}
                                                                            </div>
                                                                        );
                                                                    })}
                                                                    {cycle && cycle.length > 0 && cycle[0] && (() => {
                                                                        const baseName = cycle[0].split('/').pop();
                                                                        const folder = cycle[0].includes('/') ? cycle[0].slice(0, cycle[0].lastIndexOf('/')) : cycle[0];
                                                                        return (
                                                                            <>
                                                                                <span className="text-[#4FD1B5]/70 text-[10px] font-mono select-none">→</span>
                                                                                <button
                                                                                    onClick={() => selectFile(cycle[0])}
                                                                                    className="font-mono text-xs text-[#8A918C] hover:text-[#4FD1B5] transition-colors cursor-pointer shrink-0"
                                                                                    title={folder}
                                                                                >
                                                                                    {baseName}
                                                                                </button>
                                                                            </>
                                                                        );
                                                                    })()}
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
                                        <p className="text-[11px] text-[#8A918C]">Entry and config files are excluded. Scripts, tests and tooling folders are excluded.</p>

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
                            ) : changeSetError ? (
                                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 space-y-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="space-y-1.5 flex-1 min-w-0">
                                            <div className="flex items-center gap-2 text-xs font-medium text-red-200">
                                                <ShieldAlert size={15} className="text-red-400 shrink-0" />
                                                <span>{changeSetError.message}</span>
                                            </div>
                                            {(changeSetError.status !== undefined || changeSetError.code) && (
                                                <div className="font-mono text-[10px] text-red-400/80 pl-6 space-y-0.5">
                                                    {changeSetError.status !== undefined && <div>Status: {changeSetError.status}</div>}
                                                    {changeSetError.code && <div>Code: {changeSetError.code}</div>}
                                                </div>
                                            )}
                                        </div>
                                        <Button
                                            onClick={analyzeChangeSet}
                                            className="px-3 py-1.5 text-xs bg-red-500/20 text-red-200 border border-red-500/30 hover:bg-red-500/30 flex items-center gap-1.5 shrink-0"
                                        >
                                            <RefreshCw size={12} />
                                            <span>Retry</span>
                                        </Button>
                                    </div>
                                </div>
                            ) : !changeSetResult ? (
                                <div className="space-y-4">
                                    {/* 3 short steps */}
                                    <div className="flex flex-col sm:grid sm:grid-cols-3 gap-2 sm:gap-3">
                                        <div className="p-2.5 sm:p-3.5 rounded-lg bg-white/[0.02] border border-white/[0.06] flex items-center sm:block gap-3 sm:space-y-1">
                                            <div className="text-[10px] font-mono font-bold text-[#4FD1B5] shrink-0">01</div>
                                            <div>
                                                <div className="text-xs text-[#E8EAE6] font-medium">Open a file</div>
                                                <div className="text-[11px] text-[#8A918C]">Select any file from the sidebar.</div>
                                            </div>
                                        </div>
                                        <div className="p-2.5 sm:p-3.5 rounded-lg bg-white/[0.02] border border-white/[0.06] flex items-center sm:block gap-3 sm:space-y-1">
                                            <div className="text-[10px] font-mono font-bold text-[#4FD1B5] shrink-0">02</div>
                                            <div>
                                                <div className="text-xs text-[#E8EAE6] font-medium">Press Add to plan</div>
                                                <div className="text-[11px] text-[#8A918C]">Add all files you intend to modify.</div>
                                            </div>
                                        </div>
                                        <div className="p-2.5 sm:p-3.5 rounded-lg bg-white/[0.02] border border-white/[0.06] flex items-center sm:block gap-3 sm:space-y-1">
                                            <div className="text-[10px] font-mono font-bold text-[#4FD1B5] shrink-0">03</div>
                                            <div>
                                                <div className="text-xs text-[#E8EAE6] font-medium">Press Analyze plan</div>
                                                <div className="text-[11px] text-[#8A918C]">Get combined risk and breakages.</div>
                                            </div>
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

                                    {/* Mobile full-width buttons below Files in your plan */}
                                    <div className="sm:hidden flex flex-col gap-2 pt-1">
                                        {selectedFile && !changeSet.includes(selectedFile) && (
                                            <Button
                                                onClick={() => addToChangeSet(selectedFile)}
                                                variant="secondary"
                                                className="w-full min-h-[44px] text-xs justify-center flex items-center gap-1.5"
                                            >
                                                <Plus size={14} />
                                                <span>Add {selectedFile.split('/').pop()}</span>
                                            </Button>
                                        )}
                                        <Button
                                            onClick={analyzeChangeSet}
                                            disabled={changeSetLoading || changeSet.length === 0 || !graph}
                                            className="w-full min-h-[44px] text-xs justify-center flex items-center gap-1.5"
                                        >
                                            {changeSetLoading ? (
                                                <>
                                                    <Loader2 size={13} className="animate-spin mr-1.5" />
                                                    <span>Analyzing...</span>
                                                </>
                                            ) : (
                                                <span>Analyze plan</span>
                                            )}
                                        </Button>
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
