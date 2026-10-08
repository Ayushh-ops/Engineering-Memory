import { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '../store';
import { Badge, cn, Button } from '../ui';
import { Activity, Clock, MessageSquare, Hexagon, ShieldAlert, GitCommit, FileCode, Check, ChevronDown, ChevronUp, Users, AlertTriangle } from 'lucide-react';
import { api, FileOwnersResponse } from '../api';
import { ConnectedFilesList } from './ConnectedFilesList';
import { computeRisk } from '../graph-helpers';

export function RightPanel({ className }: { className?: string }) {
    const { selectedSymbol, impactResult, selectedFile, activeTab, setActiveTab, commits, selectedSha, graph, selectFile, repoUrl, selectedHistoryCommit, aiCitations, setCodeHighlightLine } = useAppStore();
    const [ownersData, setOwnersData] = useState<FileOwnersResponse | null>(null);
    const [ownersLoading, setOwnersLoading] = useState(false);
    const [rateLimited, setRateLimited] = useState(false);

    const hotspotFiles = useMemo(() => {
        if (!graph) return new Set<string>();
        const files = graph.nodes.filter((n: any) => n.type === 'file');
        const scored = files.map((f: any) => ({
            path: f.path || f.id,
            risk: computeRisk(f.path || f.id, graph, commits).score
        })).sort((a: any, b: any) => b.risk - a.risk);
        return new Set<string>(scored.slice(0, 5).map((f: any) => f.path));
    }, [graph, commits]);

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

    // Designed empty state
    const renderEmptyState = (message = "Select a node to see what depends on it") => (
        <div className={cn("p-6 border-l border-white/10 bg-[#07090A] flex flex-col items-center justify-center text-center text-[#8A918C] h-full select-none", className)}>
            <div className="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center mb-3 text-[#4FD1B5] bg-white/[0.02]">
                <Activity size={18} />
            </div>
            <div className="text-xs font-medium text-[#E8EAE6] mb-1">No node selected</div>
            <div className="text-[11px] text-[#8A918C] max-w-[200px] leading-relaxed">{message}</div>
        </div>
    );

    const nodeName = selectedSymbol?.name || (selectedFile ? selectedFile.split('/').pop() : 'Selected node');
    const nodeType = selectedSymbol?.type || 'file';

    // 1. History Tab: selected commit details
    if (activeTab === 'History') {
        const currentCommit = selectedHistoryCommit || commits.find(c => c.sha === selectedSha) || commits[0];
        if (!currentCommit) {
            return renderEmptyState("Select a commit from the sidebar to inspect its details");
        }
        const isHotspot = Boolean(
            (currentCommit.files && currentCommit.files.some((f: any) => hotspotFiles.has(f.filename || f.path))) ||
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
                        {currentCommit.authorDate && (
                            <div className="flex justify-between py-1 text-[#8A918C]">
                                <span>Committed</span>
                                <span className="text-[#E8EAE6] font-mono">{new Date(currentCommit.authorDate).toLocaleDateString()}</span>
                            </div>
                        )}
                    </div>

                    {currentCommit.files && currentCommit.files.length > 0 && (
                        <div className="border-t border-white/[0.08] pt-3">
                            <div className="text-[11px] text-[#8A918C] mb-2 font-normal">Files changed ({currentCommit.files.length})</div>
                            <div className="space-y-1.5 max-h-48 overflow-y-auto scrollbar-custom">
                                {currentCommit.files.map((f: any, idx: number) => {
                                    const fname = f.filename || f.path || '';
                                    const isHot = hotspotFiles.has(fname);
                                    return (
                                        <div key={idx} className="flex items-center justify-between p-2 rounded-lg glass-surface border-white/[0.06] text-xs">
                                            <div className="flex items-center gap-1.5 truncate min-w-0">
                                                {isHot && <span className="w-1.5 h-1.5 rounded-full bg-[#E3A04A] shrink-0" title="Hotspot file" />}
                                                <span className="font-mono text-[#E8EAE6] truncate" title={fname}>{fname.split('/').pop()}</span>
                                            </div>
                                            {(f.additions !== undefined || f.deletions !== undefined) && (
                                                <span className="text-[10px] font-mono text-[#8A918C] shrink-0 ml-2">
                                                    <span className="text-[#4FD1B5]">+{f.additions || 0}</span> <span className="text-red-400">-{f.deletions || 0}</span>
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // 2. Ask AI Tab: evidence list (no blast block)
    if (activeTab === 'AskAI') {
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
                            const filePath = lastColon !== -1 ? c.substring(0, lastColon) : c;
                            const lineNum = lastColon !== -1 ? parseInt(c.substring(lastColon + 1), 10) : NaN;
                            const fileName = filePath.split('/').pop() || filePath;

                            return (
                                <button
                                    key={idx}
                                    onClick={() => {
                                        if (selectFile) {
                                            selectFile(filePath);
                                        }
                                        if (!isNaN(lineNum)) {
                                            setCodeHighlightLine(lineNum);
                                        }
                                        setActiveTab('Code');
                                    }}
                                    className="w-full text-left glass-surface p-2.5 rounded-lg border-white/10 hover:border-[#4FD1B5]/40 hover:bg-white/[0.04] transition-colors cursor-pointer space-y-1 block"
                                    title={`Open ${c} in Code viewer`}
                                >
                                    <div className="flex justify-between items-center font-mono text-[11px] text-[#4FD1B5]">
                                        <span className="truncate">{fileName}</span>
                                        {!isNaN(lineNum) && <span>line {lineNum}</span>}
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

    // 3. Connections Tab: counts only
    if (activeTab === 'Connections') {
        if (!selectedFile) {
            return renderEmptyState("Select a file to inspect its connections counts");
        }
        let incomingCount = 0;
        let outgoingCount = 0;
        if (graph) {
            const idToPath = new Map<string, string>();
            graph.nodes.forEach((n: any) => {
                if (n.type === 'file' && n.path) idToPath.set(n.id, n.path);
            });
            graph.edges.forEach((e: any) => {
                if (e.type === 'imports') {
                    const fromPath = idToPath.get(e.from) || e.from;
                    const toPath = idToPath.get(e.to) || e.to;
                    if (toPath === selectedFile) incomingCount++;
                    if (fromPath === selectedFile) outgoingCount++;
                }
            });
        }
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

    // 4. Impact Tab: blast summary with real numbers
    if (activeTab === 'Impact') {
        if (!selectedSymbol && !selectedFile) {
            return renderEmptyState("Select a file or symbol to view its blast radius summary");
        }
        const hasImpactData = Boolean(impactResult && (impactResult.directCallers.length > 0 || impactResult.transitiveConsumers.length > 0 || (impactResult.paths && impactResult.paths.length > 0)));

        return (
            <div className={cn("flex flex-col bg-[#07090A] border-l border-white/10 select-none text-[#E8EAE6] h-full", className)}>
                <div className="p-3.5 border-b border-white/10">
                    <div className="flex items-center justify-between">
                        <h3 className="font-mono text-xs font-semibold truncate text-[#E8EAE6]" title={nodeName}>
                            {nodeName}{selectedSymbol?.type === 'function' || selectedSymbol?.type === 'method' ? '()' : ''}
                        </h3>
                        <Badge variant={nodeType === 'file' ? 'default' : (nodeType === 'class' ? 'amber' : 'emerald')}>
                            {nodeType}
                        </Badge>
                    </div>
                    <div className="text-[11px] text-[#8A918C] truncate mt-1 font-mono">
                        Blast summary
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto scrollbar-custom p-3.5 space-y-4 text-xs">
                    {hasImpactData && impactResult ? (
                        <>
                            <div>
                                <div className="text-[11px] text-[#8A918C] mb-2 font-normal">Blast radius</div>
                                <div className="glass-surface p-3 rounded-lg flex items-center justify-between border-white/10">
                                    <div className="flex items-center gap-2.5">
                                        <div className="w-6 h-6 rounded-full bg-[#E3A04A]/10 border border-[#E3A04A]/20 flex items-center justify-center text-[#E3A04A]">
                                            <Activity size={12} />
                                        </div>
                                        <span className="text-xs text-[#E8EAE6]">Affected consumers</span>
                                    </div>
                                    <span className="font-mono text-sm font-semibold text-[#4FD1B5]">
                                        {impactResult.directCallers.length + impactResult.transitiveConsumers.length}
                                    </span>
                                </div>
                            </div>

                            <div className="space-y-1.5 pt-2 border-t border-white/[0.08]">
                                <div className="flex justify-between py-1 border-b border-white/[0.06] text-[#8A918C]">
                                    <span>Direct callers</span>
                                    <b className="text-[#E8EAE6] font-mono">{impactResult.directCallers.length}</b>
                                </div>
                                <div className="flex justify-between py-1 border-b border-white/[0.06] text-[#8A918C]">
                                    <span>Transitive consumers</span>
                                    <b className="text-[#E8EAE6] font-mono">{impactResult.transitiveConsumers.length}</b>
                                </div>
                                <div className="flex justify-between py-1 text-[#8A918C]">
                                    <span>Paths mapped</span>
                                    <b className="text-[#E8EAE6] font-mono">{impactResult.paths?.length || 0}</b>
                                </div>
                            </div>

                            {impactResult.directCallers.length > 0 && (
                                <div className="pt-2">
                                    <div className="text-[11px] text-[#8A918C] mb-2 font-normal">Direct callers ({impactResult.directCallers.length})</div>
                                    <div className="space-y-1.5 max-h-48 overflow-y-auto scrollbar-custom">
                                        {impactResult.directCallers.map((dc, i) => (
                                            <div key={i} className="glass-surface p-2 rounded-md border-white/5 flex justify-between items-center text-xs">
                                                <span className="font-mono text-[#E8EAE6] truncate">{dc.symbol.name}</span>
                                                <Badge variant="default">
                                                    {(dc.symbol.type as string) === 'file' ? 'file' : (dc.symbol.type === 'function' || dc.symbol.type === 'method' ? 'function' : dc.symbol.type)}
                                                </Badge>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="space-y-3">
                            <div className="text-[11px] text-[#8A918C] font-normal">Impact analysis</div>
                            <div className="text-[#8A918C] text-xs leading-relaxed">
                                No impact data found for this selection.
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // 5. Default for Overview and Graph tabs: Node Details
    if (!selectedSymbol && !selectedFile) {
        return renderEmptyState();
    }

    return (
        <div className={cn("flex flex-col bg-[#07090A] border-l border-white/10 select-none text-[#E8EAE6] h-full", className)}>
            <div className="p-3.5 border-b border-white/10">
                <div className="flex items-center justify-between">
                    <h3 className="font-mono text-xs font-semibold truncate text-[#E8EAE6]" title={nodeName}>
                        {nodeName}{selectedSymbol?.type === 'function' || selectedSymbol?.type === 'method' ? '()' : ''}
                    </h3>
                    <Badge variant={nodeType === 'file' ? 'default' : (nodeType === 'class' ? 'amber' : 'emerald')}>
                        {nodeType}
                    </Badge>
                </div>
                <div className="text-[11px] text-[#8A918C] truncate mt-1 font-mono" title={selectedFile || ''}>
                    {selectedFile || 'main branch'}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-custom p-3.5 space-y-4 text-xs">
                <div className="space-y-3">
                    <div className="text-[11px] text-[#8A918C] font-normal">Node details</div>
                    <div className="space-y-1.5">
                        <div className="flex justify-between py-1 border-b border-white/[0.06] text-[#8A918C]">
                            <span>Type</span>
                            <b className="text-[#E8EAE6] font-mono">{nodeType}</b>
                        </div>
                        <div className="flex justify-between py-1 text-[#8A918C]">
                            <span>Path</span>
                            <b className="text-[#E8EAE6] font-mono text-[11px] truncate max-w-[170px]" title={selectedFile || ''}>
                                {selectedFile || '-'}
                            </b>
                        </div>
                    </div>
                </div>

                {/* Connected files section */}
                {selectedFile && (
                    <ConnectedFilesList className="pt-3 border-t border-white/[0.08]" />
                )}

                {/* Owners block */}
                {selectedFile && (
                    <div className="space-y-3 pt-3 border-t border-white/[0.08]">
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] text-[#8A918C] font-normal flex items-center gap-1.5">
                                <Users size={12} className="text-[#4FD1B5]" />
                                <span>Owners</span>
                            </span>
                            {ownersData && ownersData.totalCommits > 0 && (
                                <span className="text-[10px] text-[#8A918C] font-mono">
                                    {ownersData.totalCommits} {ownersData.totalCommits === 1 ? 'commit' : 'commits'}
                                </span>
                            )}
                        </div>

                        {rateLimited ? (
                            <div className="text-[11px] text-amber-400/90 leading-relaxed">
                                Rate limited by GitHub API.
                            </div>
                        ) : ownersLoading ? (
                            <div className="text-[11px] text-[#8A918C] animate-pulse">
                                Loading owners...
                            </div>
                        ) : ownersData && ownersData.owners.length > 0 ? (
                            <div className="space-y-2.5">
                                <div className="space-y-2">
                                    {ownersData.owners.map((owner, idx) => (
                                        <div key={idx} className="space-y-1">
                                            <div className="flex items-center justify-between text-xs">
                                                <span className="font-mono text-[#E8EAE6] truncate max-w-[150px]" title={owner.name}>
                                                    {owner.name}
                                                </span>
                                                <span className="text-[11px] font-mono text-[#8A918C]">
                                                    {owner.share}% <span className="text-[10px] text-white/30">({owner.count} {owner.count === 1 ? 'commit' : 'commits'})</span>
                                                </span>
                                            </div>
                                            <div className="w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-[#4FD1B5] rounded-full transition-all duration-300"
                                                    style={{ width: `${Math.min(100, Math.max(0, owner.share))}%` }}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {ownersData.busFactorRisk && (
                                    <div className="glass-surface p-2 rounded-lg border-amber-500/20 bg-amber-500/[0.05] flex items-center gap-2 text-xs text-amber-300">
                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 inline-block" />
                                        <span className="text-[11px] leading-tight">Mostly one person knows this file</span>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="text-[11px] text-[#8A918C]">
                                No ownership data available.
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

