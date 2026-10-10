import { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '../store';
import { Badge, cn } from '../ui';
import { Activity, Clock, MessageSquare } from 'lucide-react';
import { api, FileOwnersResponse } from '../api';
import { computeRisk, getConnectedFiles, getFileDependents } from '../graph-helpers';
import { CodeViewer } from './CodeViewer';

function getFileLanguage(filePath: string): string {
    const lower = filePath.toLowerCase();
    const fileName = lower.split('/').pop() || '';
    if (fileName.endsWith('.d.ts')) return 'TypeScript';
    if (fileName.endsWith('.ts') || fileName.endsWith('.tsx')) return 'TypeScript';
    if (fileName.endsWith('.js') || fileName.endsWith('.jsx') || fileName.endsWith('.mjs') || fileName.endsWith('.cjs')) return 'JavaScript';
    if (fileName.endsWith('.py')) return 'Python';
    if (fileName.endsWith('.json')) return 'JSON';
    if (fileName.endsWith('.css') || fileName.endsWith('.scss')) return 'CSS';
    if (fileName.endsWith('.html')) return 'HTML';
    if (fileName.endsWith('.go')) return 'Go';
    if (fileName.endsWith('.rs')) return 'Rust';
    if (fileName.endsWith('.md')) return 'Markdown';
    if (fileName.endsWith('.sh') || fileName.endsWith('.bash')) return 'Shell';
    if (fileName.endsWith('.sql')) return 'SQL';
    const ext = fileName.split('.').pop();
    if (ext && ext !== fileName) {
        return ext.charAt(0).toUpperCase() + ext.slice(1);
    }
    return 'File';
}

function renderEmptyState(message = "Select a node to see what depends on it", className?: string) {
    return (
        <div className={cn("p-6 border-l border-white/10 bg-[#07090A] flex flex-col items-center justify-center text-center text-[#8A918C] h-full select-none", className)}>
            <div className="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center mb-3 text-[#4FD1B5] bg-white/[0.02]">
                <Activity size={18} />
            </div>
            <div className="text-xs font-medium text-[#E8EAE6] mb-1">No node selected</div>
            <div className="text-[11px] text-[#8A918C] max-w-[200px] leading-relaxed">{message}</div>
        </div>
    );
}

function CommitDetails({ className }: { className?: string }) {
    const { selectedHistoryCommit, commits, selectedSha, graph, selectedFile } = useAppStore();

    const hotspotFiles = useMemo(() => {
        if (!graph?.nodes) return new Set<string>();
        const files = graph.nodes.filter((n: any) => n?.type === 'file');
        const scored = files
            .filter((f: any) => {
                const p = (f?.path || f?.id || '').toLowerCase();
                const fn = p.split('/').pop() || '';
                if (fn.includes('eslint') || fn.includes('postcss') || fn.includes('tailwind') || fn.includes('vite') || fn.includes('.config.')) return false;
                return true;
            })
            .map((f: any) => ({
                path: f?.path || f?.id,
                risk: computeRisk(f?.path || f?.id, graph, commits).score
            })).sort((a: any, b: any) => b.risk - a.risk);
        return new Set<string>(scored.slice(0, 5).map((f: any) => f.path));
    }, [graph, commits]);

    const currentCommit = selectedHistoryCommit || commits?.find(c => c?.sha === selectedSha) || commits?.[0];

    if (!currentCommit) {
        return renderEmptyState("Select a commit to inspect its details", className);
    }

    const isHotspot = Boolean(
        (currentCommit.files && currentCommit.files.some((f: any) => hotspotFiles.has(f?.filename || f?.path))) ||
        (selectedFile && hotspotFiles.has(selectedFile))
    );

    return (
        <div className={cn("flex flex-col bg-[#07090A] border-l border-white/10 select-none text-[#E8EAE6] h-full", className)}>
            <div className="p-3.5 border-b border-white/10">
                <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-[#E8EAE6] flex items-center gap-1.5">
                        <Clock size={13} className="text-[#4FD1B5]" />
                        <span>Commit details</span>
                        {isHotspot && (
                            <span className="w-2 h-2 rounded-full bg-[#E3A04A] shrink-0" title="Touched a hotspot file" />
                        )}
                    </h3>
                    <span className="font-mono text-[11px] px-2 py-0.5 rounded-full border border-white/10 bg-white/[0.03] text-[#4FD1B5]">
                        {currentCommit.sha ? currentCommit.sha.substring(0, 7) : 'HEAD'}
                    </span>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-custom p-3.5 space-y-4 text-xs">
                <div>
                    <div className="text-[11px] text-[#8A918C] mb-1 font-normal">Message</div>
                    <div className="glass-surface p-3 rounded-lg border-white/10 text-xs text-[#E8EAE6] leading-relaxed font-sans">
                        {currentCommit.message}
                    </div>
                </div>

                <div className="space-y-2 border-t border-white/[0.08] pt-3">
                    <div className="flex justify-between py-1 border-b border-white/[0.06] text-[#8A918C]">
                        <span>Author</span>
                        <span className="text-[#E8EAE6] font-mono">{currentCommit.authorName || currentCommit.author?.name || 'Unknown'}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-white/[0.06] text-[#8A918C]">
                        <span>Hash</span>
                        <span className="text-[#4FD1B5] font-mono">{currentCommit.sha ? currentCommit.sha.substring(0, 10) : '-'}</span>
                    </div>
                    {(currentCommit.authorDate || currentCommit.commit?.author?.date) && (
                        <div className="flex justify-between py-1 text-[#8A918C]">
                            <span>Committed</span>
                            <span className="text-[#E8EAE6] font-mono">{new Date(currentCommit.authorDate || currentCommit.commit?.author?.date).toLocaleDateString()}</span>
                        </div>
                    )}
                </div>

                <div className="border-t border-white/[0.08] pt-3">
                    <div className="text-[11px] text-[#8A918C] mb-2 font-normal">
                        Files changed ({currentCommit.files?.length || (selectedFile ? 1 : 0)})
                    </div>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto scrollbar-custom">
                        {currentCommit.files && currentCommit.files.length > 0 ? (
                            currentCommit.files.map((f: any, idx: number) => {
                                const fname = f?.filename || f?.path || (typeof f === 'string' ? f : '');
                                const isHot = hotspotFiles.has(fname);
                                return (
                                    <div key={idx} className="flex items-center justify-between p-2 rounded-lg glass-surface border-white/[0.06] text-xs">
                                        <div className="flex items-center gap-1.5 truncate min-w-0">
                                            {isHot && <span className="w-1.5 h-1.5 rounded-full bg-[#E3A04A] shrink-0" title="Hotspot file" />}
                                            <span className="font-mono text-[#E8EAE6] truncate" title={fname}>{fname?.split('/').pop()}</span>
                                        </div>
                                        {(f?.additions !== undefined || f?.deletions !== undefined) && (
                                            <span className="text-[10px] font-mono text-[#8A918C] shrink-0 ml-2">
                                                <span className="text-[#4FD1B5]">+{f?.additions || 0}</span> <span className="text-red-400">-{f?.deletions || 0}</span>
                                            </span>
                                        )}
                                    </div>
                                );
                            })
                        ) : selectedFile ? (
                            <div className="flex items-center justify-between p-2 rounded-lg glass-surface border-white/[0.06] text-xs">
                                <div className="flex items-center gap-1.5 truncate min-w-0">
                                    {hotspotFiles.has(selectedFile) && <span className="w-1.5 h-1.5 rounded-full bg-[#E3A04A] shrink-0" title="Hotspot file" />}
                                    <span className="font-mono text-[#E8EAE6] truncate" title={selectedFile}>{selectedFile.split('/').pop()}</span>
                                </div>
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );
}

function EvidenceList({ className }: { className?: string }) {
    const { selectedFile, aiCitations, selectFile, setCodeHighlightLine, setActiveTab } = useAppStore();

    if (!selectedFile) {
        return (
            <div className={cn("flex flex-col bg-[#07090A] border-l border-white/10 select-none text-[#E8EAE6] h-full", className)}>
                <div className="p-3.5 border-b border-white/10">
                    <div className="flex items-center justify-between">
                        <h3 className="text-xs font-semibold text-[#E8EAE6] flex items-center gap-1.5">
                            <MessageSquare size={13} className="text-[#4FD1B5]" />
                            <span>Evidence list</span>
                        </h3>
                        <Badge variant="default">0 cited</Badge>
                    </div>
                    <div className="text-[11px] text-[#8A918C] font-mono truncate mt-1">
                        No file selected
                    </div>
                </div>
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-[#8A918C]">
                    <div className="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center mb-3 text-[#4FD1B5] bg-white/[0.02]">
                        <MessageSquare size={18} />
                    </div>
                    <div className="text-xs font-medium text-[#E8EAE6] mb-1">No file selected</div>
                    <div className="text-[11px] text-[#8A918C] max-w-[200px] leading-relaxed">
                        Select a file to inspect its cited evidence and sources.
                    </div>
                </div>
            </div>
        );
    }

    const citations = aiCitations || [];
    return (
        <div className={cn("flex flex-col bg-[#07090A] border-l border-white/10 select-none text-[#E8EAE6] h-full", className)}>
            <div className="p-3.5 border-b border-white/10">
                <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-[#E8EAE6] flex items-center gap-1.5">
                        <MessageSquare size={13} className="text-[#4FD1B5]" />
                        <span>Evidence list</span>
                    </h3>
                    <Badge variant="default">{citations.length} cited</Badge>
                </div>
                <div className="text-[11px] text-[#8A918C] font-mono truncate mt-1">
                    {selectedFile ? selectedFile.split('/').pop() : 'Context sources'}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-custom p-3.5 space-y-3 text-xs">
                {citations.length > 0 ? (
                    citations.map((c: string, idx: number) => {
                        const lastColon = c.lastIndexOf(':');
                        const hasColon = lastColon !== -1;
                        const linePart = hasColon ? c.substring(lastColon + 1) : '';
                        const hasLine = /^\d+(?:-\d+)?$/.test(linePart);
                        const filePath = hasLine ? c.substring(0, lastColon) : c;
                        const lineRange = hasLine ? linePart : '';
                        const startLine = lineRange ? parseInt(lineRange.split('-')[0], 10) : NaN;
                        const fileName = filePath?.split('/').pop() || filePath;

                        return (
                            <button
                                key={idx}
                                onClick={() => {
                                    if (selectFile) {
                                        selectFile(filePath);
                                    }
                                    if (!isNaN(startLine)) {
                                        setCodeHighlightLine(startLine);
                                    }
                                    setActiveTab('Code');
                                }}
                                className="w-full text-left glass-surface p-2.5 rounded-lg border-white/10 hover:border-[#4FD1B5]/40 hover:bg-white/[0.04] transition-colors cursor-pointer space-y-1 block"
                                title={`Open ${c} in Code viewer`}
                            >
                                <div className="flex justify-between items-center font-mono text-[11px] text-[#4FD1B5]">
                                    <span className="truncate">{fileName}</span>
                                    {lineRange && <span>{lineRange.includes('-') ? `lines ${lineRange}` : `line ${lineRange}`}</span>}
                                </div>
                                <div className="text-[10px] text-[#8A918C] font-mono truncate">
                                    {filePath}
                                </div>
                            </button>
                        );
                    })
                ) : (
                    <div className="p-6 text-center text-[#8A918C] space-y-1.5">
                        <div className="text-xs">No active evidence citations</div>
                        <div className="text-[11px] text-[#8A918C]/70">Evidence citations appear when AI answers reference specific files or lines.</div>
                    </div>
                )}
            </div>
        </div>
    );
}

function ConnectionsSummary({ className }: { className?: string }) {
    const { graph, selectedFile, selectedSymbol } = useAppStore();

    const connected = useMemo(() => {
        return getConnectedFiles(graph, selectedFile);
    }, [graph, selectedFile]);

    if (!selectedFile) {
        return renderEmptyState("Select a file to inspect its connections counts", className);
    }

    const nodeName = selectedSymbol?.name || (selectedFile ? selectedFile.split('/').pop() : 'Selected node');
    const incomingCount = connected?.importedBy?.length || 0;
    const outgoingCount = connected?.imports?.length || 0;

    return (
        <div className={cn("flex flex-col bg-[#07090A] border-l border-white/10 select-none text-[#E8EAE6] h-full", className)}>
            <div className="p-3.5 border-b border-white/10">
                <div className="flex items-center justify-between">
                    <h3 className="font-mono text-xs font-semibold truncate text-[#E8EAE6]" title={nodeName}>
                        {nodeName}
                    </h3>
                    <Badge variant="default">file</Badge>
                </div>
                <div className="text-[11px] text-[#8A918C] truncate mt-1 font-mono">
                    Connections summary
                </div>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-custom p-3.5 space-y-4 text-xs">
                <div className="space-y-2">
                    <div className="glass-surface p-3 rounded-lg flex items-center justify-between border-white/10">
                        <span className="text-xs text-[#8A918C]">Incoming dependents</span>
                        <b className="font-mono text-sm text-[#4FD1B5]">{incomingCount}</b>
                    </div>
                    <div className="glass-surface p-3 rounded-lg flex items-center justify-between border-white/10">
                        <span className="text-xs text-[#8A918C]">Outgoing imports</span>
                        <b className="font-mono text-sm text-[#E3A04A]">{outgoingCount}</b>
                    </div>
                    <div className="glass-surface p-3 rounded-lg flex items-center justify-between border-white/10">
                        <span className="text-xs text-[#8A918C]">Total connections</span>
                        <b className="font-mono text-sm text-[#E8EAE6]">{incomingCount + outgoingCount}</b>
                    </div>
                </div>
            </div>
        </div>
    );
}

function FileInspector({ className }: { className?: string }) {
    const {
        selectedSymbol,
        selectedFile,
        commits,
        selectedSha,
        graph,
        selectFile,
        repoUrl,
        impactResult,
        setImpactResult,
        activeTab
    } = useAppStore();

    const [inspectorTab, setInspectorTab] = useState<'Overview' | 'Dependencies' | 'Source' | 'Impact'>('Overview');
    const [ownersData, setOwnersData] = useState<FileOwnersResponse | null>(null);
    const [ownersLoading, setOwnersLoading] = useState(false);
    const [rateLimited, setRateLimited] = useState(false);

    useEffect(() => {
        let isMounted = true;
        if (!repoUrl || !selectedFile) {
            setOwnersData(null);
            setRateLimited(false);
            return;
        }

        setOwnersLoading(true);
        setRateLimited(false);
        api.repositories.getOwners(repoUrl, selectedFile, selectedSha)
            .then((data) => {
                if (isMounted) {
                    setOwnersData(data);
                    setRateLimited(false);
                }
            })
            .catch((err: any) => {
                if (isMounted) {
                    if (err?.status === 429 || (err?.message && err.message.toLowerCase().includes('rate limit'))) {
                        setRateLimited(true);
                    }
                    setOwnersData(null);
                }
            })
            .finally(() => {
                if (isMounted) {
                    setOwnersLoading(false);
                }
            });

        return () => {
            isMounted = false;
        };
    }, [repoUrl, selectedFile, selectedSha]);

    const connected = useMemo(() => {
        return getConnectedFiles(graph, selectedFile);
    }, [graph, selectedFile]);

    const dependentsData = useMemo(() => {
        return getFileDependents(graph, selectedFile || '');
    }, [graph, selectedFile]);

    const indirectFiles = useMemo(() => {
        return dependentsData.indirect.map(i => i.path);
    }, [dependentsData]);

    const fileRisk = useMemo(() => {
        if (!selectedFile) return null;
        return computeRisk(selectedFile, graph, commits);
    }, [selectedFile, graph, commits]);

    const reasonSentence = useMemo(() => {
        if (!fileRisk) return '';
        const deps = fileRisk.directDependents || 0;
        const reach = (fileRisk.directDependents || 0) + (fileRisk.transitiveDependents || 0);
        const depStr = deps === 1 ? '1 file depends on it' : `${deps} files depend on it`;
        const reachStr = reach > 0 ? `, and a change can reach ${reach}` : '';
        const testStr = fileRisk.hasNoTests ? '. No test file found.' : '. Tests found.';
        return `${depStr}${reachStr}${testStr}`;
    }, [fileRisk]);

    const fileCommitsCount = useMemo(() => {
        if (ownersData && typeof ownersData.totalCommits === 'number' && ownersData.totalCommits > 0) {
            return ownersData.totalCommits;
        }
        if (!commits || !selectedFile) return 0;
        return commits.filter((c: any) =>
            c?.files && c.files.some((f: any) => (f?.filename || f?.path) === selectedFile)
        ).length;
    }, [commits, selectedFile, ownersData]);

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
        const map = new Map<string, { path: string; name: string; folder: string; score: number; hops?: number }>();
        for (const ind of dependentsData.indirect) {
            const rawPath = ind.path;
            if (rawPath && rawPath !== selectedFile && !directPaths.has(rawPath) && !map.has(rawPath)) {
                const fileName = rawPath.split('/').pop() || rawPath;
                const folder = rawPath.includes('/') ? rawPath.substring(0, rawPath.lastIndexOf('/')) : '';
                const score = computeRisk(rawPath, graph, commits).score;
                map.set(rawPath, { path: rawPath, name: fileName, folder, score, hops: ind.hops });
            }
        }
        return Array.from(map.values()).sort((a, b) => b.score - a.score);
    }, [dependentsData.indirect, directList, selectedFile, graph, commits]);

    const testsList = useMemo(() => {
        if (!selectedFile) return [];
        const tests = (impactResult?.tests || [])
            .map((t: any) => (typeof t === 'string' ? t : (t?.path || t?.symbol?.path)))
            .filter(Boolean) as string[];
        return tests;
    }, [impactResult, selectedFile]);

    useEffect(() => {
        if (inspectorTab === 'Impact' && graph && selectedFile) {
            const currentTarget = (impactResult as any)?.target?.path;
            if (currentTarget !== selectedFile) {
                const target = selectedSymbol
                    ? { type: 'symbol', path: selectedSymbol.path, symbol: selectedSymbol }
                    : { type: 'file', path: selectedFile };
                api.graph.impact(graph, target as any, { maxDepth: 3, maxResults: 50 })
                    .then(res => setImpactResult(res))
                    .catch(() => {});
            }
        }
    }, [inspectorTab, graph, selectedFile, selectedSymbol, impactResult, setImpactResult]);

    // Conditional return happens AFTER all hooks:
    if (!selectedSymbol && !selectedFile) {
        return renderEmptyState("Select a node to see what depends on it", className);
    }

    const nodeName = selectedSymbol?.name || (selectedFile ? selectedFile.split('/').pop() : 'Selected node');

    return (
        <div className={cn("flex flex-col bg-[#07090A] border-l border-white/10 select-none text-[#E8EAE6] h-full overflow-hidden", className)}>
            {/* Header: file name (mono) + a small language pill, full path under it (mono, muted, truncated with title tooltip) */}
            <div className="p-3.5 border-b border-white/10 shrink-0">
                <div className="flex items-center justify-between gap-2">
                    <h3 className="font-mono text-xs font-semibold text-[#E8EAE6] truncate" title={nodeName}>
                        {nodeName}{selectedSymbol?.type === 'function' || selectedSymbol?.type === 'method' ? '()' : ''}
                    </h3>
                    {selectedFile && (
                        <span className="font-sans text-[10px] px-2 py-0.5 rounded-full border border-white/10 bg-white/[0.03] text-[#4FD1B5] shrink-0">
                            {getFileLanguage(selectedFile)}
                        </span>
                    )}
                </div>
                {selectedFile && (
                    <div className="font-mono text-[11px] text-[#8A918C] truncate mt-1" title={selectedFile}>
                        {selectedFile}
                    </div>
                )}
            </div>

            {/* Tabs: Overview, Dependencies, Source, Impact (underline style, accent for active) */}
            <div className="flex items-center border-b border-white/10 px-3.5 gap-4 shrink-0 bg-[#07090A]">
                {(activeTab === 'Impact' ? (['Overview', 'Dependencies', 'Source'] as const) : (['Overview', 'Dependencies', 'Source', 'Impact'] as const)).map(tab => {
                    const isActive = (activeTab === 'Impact' && inspectorTab === 'Impact' ? 'Overview' : inspectorTab) === tab;
                    return (
                        <button
                            key={tab}
                            onClick={() => setInspectorTab(tab as any)}
                            className={cn(
                                "relative py-2 text-xs font-medium transition-colors cursor-pointer",
                                isActive ? "text-[#4FD1B5]" : "text-[#8A918C] hover:text-[#E8EAE6]"
                            )}
                        >
                            {tab}
                            {isActive && (
                                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#4FD1B5]" />
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Tab 1: Overview */}
            {(inspectorTab === 'Overview' || (activeTab === 'Impact' && inspectorTab === 'Impact')) && (
                <div className="flex-1 overflow-y-auto scrollbar-custom p-3.5 space-y-4 text-xs">
                    {/* When activeTab is Impact, hide the duplicated risk number and stats shown on the main page */}
                    {activeTab !== 'Impact' && (
                        <>
                            <div>
                                <div className="flex items-baseline gap-1.5">
                                    <span className="text-3xl font-bold font-mono text-[#E3A04A]">
                                        {fileRisk ? fileRisk.score : 0}
                                    </span>
                                    <span className="text-xs font-mono text-[#8A918C]">
                                        / 100 risk
                                    </span>
                                </div>
                                {reasonSentence && (
                                    <p className="text-[11px] text-[#8A918C] leading-relaxed mt-1.5 font-sans">
                                        {reasonSentence}
                                    </p>
                                )}
                            </div>

                            {/* Three ruled rows: Imports, Imported by, Commits */}
                            <div className="divide-y divide-white/[0.08] border-y border-white/[0.08]">
                                <div className="flex items-center justify-between py-2 text-xs">
                                    <span className="text-[#8A918C]">Imports</span>
                                    <span className="font-mono text-[#E8EAE6]">{connected?.imports?.length || 0}</span>
                                </div>
                                <div className="flex items-center justify-between py-2 text-xs">
                                    <span className="text-[#8A918C]">Imported by</span>
                                    <span className="font-mono text-[#E8EAE6]">{connected?.importedBy?.length || 0}</span>
                                </div>
                                <div className="flex items-center justify-between py-2 text-xs">
                                    <span className="text-[#8A918C]">Commits</span>
                                    <span className="font-mono text-[#E8EAE6]">{fileCommitsCount}</span>
                                </div>
                            </div>

                            {/* "Imported by" list showing 4 rows (file name mono + muted folder) with "View all 24" link */}
                            {(connected?.importedBy?.length || 0) > 0 && (
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="text-[#8A918C]">Imported by</span>
                                        <button
                                            onClick={() => setInspectorTab('Dependencies')}
                                            className="text-[11px] text-[#4FD1B5] hover:underline cursor-pointer"
                                        >
                                            View all {connected?.importedBy?.length || 0}
                                        </button>
                                    </div>
                                    <div className="space-y-1">
                                        {(connected?.importedBy || []).slice(0, 4).map(f => {
                                            const fileName = f?.split('/').pop() || f;
                                            const folder = f?.includes('/') ? f.substring(0, f.lastIndexOf('/')) : '';
                                            return (
                                                <div
                                                    key={f}
                                                    onClick={() => selectFile(f)}
                                                    className="p-2 rounded-lg bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.05] hover:border-white/15 cursor-pointer transition-colors"
                                                >
                                                    <div className="font-mono text-xs text-[#E8EAE6] truncate" title={f}>
                                                        {fileName}
                                                    </div>
                                                    {folder && (
                                                        <div className="text-[11px] text-[#8A918C] truncate" title={folder}>
                                                            {folder}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {/* Owners (name, share bar) max 3. Hide any section with 0 items instead of showing "None". */}
                    {ownersData && ownersData.owners && ownersData.owners.length > 0 && (
                        <div className="space-y-2.5">
                            <div className="text-xs text-[#8A918C]">Owners</div>
                            <div className="space-y-2">
                                {ownersData.owners.slice(0, 3).map((owner, idx) => (
                                    <div key={idx} className="space-y-1">
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="font-mono text-[#E8EAE6] truncate max-w-[140px]" title={owner?.name}>
                                                {owner?.name}
                                            </span>
                                            <span className="font-mono text-[11px] text-[#8A918C]">
                                                {owner?.share}%
                                            </span>
                                        </div>
                                        <div className="w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-[#4FD1B5] rounded-full transition-all duration-300"
                                                style={{ width: `${Math.min(100, Math.max(0, owner?.share || 0))}%` }}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Tab 2: Dependencies */}
            {inspectorTab === 'Dependencies' && (
                <div className="flex-1 overflow-y-auto scrollbar-custom p-3.5 space-y-4 text-xs">
                    {/* Imports (teal dot) */}
                    {(connected?.imports?.length || 0) > 0 && (
                        <div className="space-y-1.5">
                            <div className="flex items-center gap-1.5 text-xs text-[#8A918C]">
                                <span className="w-2 h-2 rounded-full bg-[#4FD1B5] shrink-0" />
                                <span>Imports</span>
                                <span className="font-mono text-[11px] text-[#8A918C]">({connected?.imports?.length || 0})</span>
                            </div>
                            <div className="space-y-1 max-h-48 overflow-y-auto scrollbar-custom pr-1">
                                {(connected?.imports || []).map(f => {
                                    const fileName = f?.split('/').pop() || f;
                                    const folder = f?.includes('/') ? f.substring(0, f.lastIndexOf('/')) : '';
                                    return (
                                        <div
                                            key={f}
                                            onClick={() => selectFile(f)}
                                            className="p-1.5 rounded-lg bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.05] hover:border-[#4FD1B5]/30 cursor-pointer transition-colors"
                                        >
                                            <div className="font-mono text-xs text-[#E8EAE6] truncate" title={f}>{fileName}</div>
                                            {folder && <div className="text-[11px] text-[#8A918C] truncate" title={folder}>{folder}</div>}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Imported by (amber dot) */}
                    {(connected?.importedBy?.length || 0) > 0 && (
                        <div className="space-y-1.5">
                            <div className="flex items-center gap-1.5 text-xs text-[#8A918C]">
                                <span className="w-2 h-2 rounded-full bg-[#E3A04A] shrink-0" />
                                <span>Imported by</span>
                                <span className="font-mono text-[11px] text-[#8A918C]">({connected?.importedBy?.length || 0})</span>
                            </div>
                            <div className="space-y-1 max-h-48 overflow-y-auto scrollbar-custom pr-1">
                                {(connected?.importedBy || []).map(f => {
                                    const fileName = f?.split('/').pop() || f;
                                    const folder = f?.includes('/') ? f.substring(0, f.lastIndexOf('/')) : '';
                                    return (
                                        <div
                                            key={f}
                                            onClick={() => selectFile(f)}
                                            className="p-1.5 rounded-lg bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.05] hover:border-[#E3A04A]/30 cursor-pointer transition-colors"
                                        >
                                            <div className="font-mono text-xs text-[#E8EAE6] truncate" title={f}>{fileName}</div>
                                            {folder && <div className="text-[11px] text-[#8A918C] truncate" title={folder}>{folder}</div>}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Indirect (grey dot) */}
                    {indirectFiles.length > 0 && (
                        <div className="space-y-1.5">
                            <div className="flex items-center gap-1.5 text-xs text-[#8A918C]">
                                <span className="w-2 h-2 rounded-full bg-[#8A918C] shrink-0" />
                                <span>Indirect</span>
                                <span className="font-mono text-[11px] text-[#8A918C]">({indirectFiles.length})</span>
                            </div>
                            <div className="space-y-1 max-h-48 overflow-y-auto scrollbar-custom pr-1">
                                {indirectFiles.map(f => {
                                    const fileName = f?.split('/').pop() || f;
                                    const folder = f?.includes('/') ? f.substring(0, f.lastIndexOf('/')) : '';
                                    return (
                                        <div
                                            key={f}
                                            onClick={() => selectFile(f)}
                                            className="p-1.5 rounded-lg bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.05] hover:border-white/20 cursor-pointer transition-colors"
                                        >
                                            <div className="font-mono text-xs text-[#E8EAE6] truncate" title={f}>{fileName}</div>
                                            {folder && <div className="text-[11px] text-[#8A918C] truncate" title={folder}>{folder}</div>}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Tab 3: Source */}
            {inspectorTab === 'Source' && (
                <div className="flex-1 min-h-0 flex flex-col p-3 overflow-hidden">
                    <CodeViewer />
                </div>
            )}

            {/* Tab 4: Impact */}
            {inspectorTab === 'Impact' && activeTab !== 'Impact' && (
                <div className="flex-1 overflow-y-auto scrollbar-custom p-3.5 space-y-4 text-xs">
                    {/* Direct List */}
                    {directList.length > 0 && (
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs text-[#8A918C]">
                                <span>Direct</span>
                                <span className="font-mono text-[11px]">({directList.length})</span>
                            </div>
                            <div className="space-y-1 max-h-44 overflow-y-auto scrollbar-custom pr-1">
                                {directList.map((item, i) => (
                                    <div
                                        key={`impact-direct-${item.path}-${i}`}
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
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Indirect List */}
                    {indirectList.length > 0 && (
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs text-[#8A918C]">
                                <span>Indirect</span>
                                <span className="font-mono text-[11px]">({indirectList.length})</span>
                            </div>
                            <div className="space-y-1 max-h-44 overflow-y-auto scrollbar-custom pr-1">
                                {indirectList.map((item, i) => (
                                    <div
                                        key={`impact-indirect-${item.path}-${i}`}
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
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Tests to run */}
                    <div className="pt-2 border-t border-white/[0.08] space-y-2">
                        <div className="text-xs text-[#8A918C] font-medium">Tests to run</div>
                        {testsList.length === 0 ? (
                            <div className="flex items-center gap-2 text-xs text-[#8A918C] py-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#E3A04A] shrink-0 inline-block" />
                                <span>No test found for this file</span>
                            </div>
                        ) : (
                            <div className="space-y-1.5 max-h-36 overflow-y-auto scrollbar-custom">
                                {testsList.map((testPath, i) => (
                                    <button
                                        key={i}
                                        onClick={() => selectFile(testPath)}
                                        className="w-full text-left font-mono text-xs text-[#E8EAE6] hover:text-[#4FD1B5] p-1.5 rounded-md glass-surface border-white/[0.06] hover:border-[#4FD1B5]/30 transition-colors truncate block cursor-pointer"
                                        title={testPath}
                                    >
                                        {testPath?.split('/').pop()}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export function RightPanel({ className }: { className?: string }) {
    const { activeTab } = useAppStore();

    // Repo-level tabs must not show Node details
    if (['Overview', 'ChangeSet', 'Health'].includes(activeTab)) {
        return null;
    }

    if (activeTab === 'History') {
        return <CommitDetails className={className} />;
    }

    if (activeTab === 'AskAI') {
        return <EvidenceList className={className} />;
    }

    if (activeTab === 'Connections') {
        return <ConnectionsSummary className={className} />;
    }

    return <FileInspector className={className} />;
}
