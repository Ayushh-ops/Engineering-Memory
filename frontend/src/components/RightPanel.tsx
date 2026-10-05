import { useState } from 'react';
import { useAppStore } from '../store';
import { Badge, cn, Button } from '../ui';
import { Activity, Clock, MessageSquare, Hexagon, ShieldAlert, GitCommit, FileCode, Check, ChevronDown, ChevronUp } from 'lucide-react';

export function RightPanel({ className }: { className?: string }) {
    const { selectedSymbol, impactResult, selectedFile, activeTab, setActiveTab, commits, selectedSha, graph } = useAppStore();
    const [showReasons, setShowReasons] = useState(true);

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
        const currentCommit = commits.find(c => c.sha === selectedSha) || commits[0];
        if (!currentCommit) {
            return renderEmptyState("Select a commit from the sidebar to inspect its details");
        }
        return (
            <div className={cn("flex flex-col bg-[#07090A] border-l border-white/10 select-none text-[#E8EAE6] h-full", className)}>
                <div className="p-3.5 border-b border-white/10">
                    <div className="flex items-center justify-between">
                        <h3 className="text-xs font-semibold text-[#E8EAE6] flex items-center gap-1.5">
                            <Clock size={13} className="text-[#4FD1B5]" />
                            <span>Commit details</span>
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
                            <span className="text-[#E8EAE6] font-mono">{currentCommit.authorName || 'Unknown'}</span>
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
                </div>
            </div>
        );
    }

    // 2. Ask AI Tab: evidence list (no blast block)
    if (activeTab === 'AskAI') {
        const evidence = impactResult?.callSiteEvidence || [];
        return (
            <div className={cn("flex flex-col bg-[#07090A] border-l border-white/10 select-none text-[#E8EAE6] h-full", className)}>
                <div className="p-3.5 border-b border-white/10">
                    <div className="flex items-center justify-between">
                        <h3 className="text-xs font-semibold text-[#E8EAE6] flex items-center gap-1.5">
                            <MessageSquare size={13} className="text-[#4FD1B5]" />
                            <span>Evidence list</span>
                        </h3>
                        <Badge variant="default">{evidence.length} cited</Badge>
                    </div>
                    <div className="text-[11px] text-[#8A918C] font-mono truncate mt-1">
                        {selectedFile ? selectedFile.split('/').pop() : 'Context sources'}
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto scrollbar-custom p-3.5 space-y-3 text-xs">
                    {evidence.length > 0 ? (
                        evidence.map((c: any, idx: number) => (
                            <div key={c.id || idx} className="glass-surface p-2.5 rounded-lg border-white/10 space-y-1.5">
                                <div className="flex justify-between font-mono text-[11px] text-[#4FD1B5]">
                                    <span className="truncate">{c.file ? c.file.split('/').pop() : 'Source'}</span>
                                    {c.startLine && <span>line {c.startLine}</span>}
                                </div>
                                {c.expression && (
                                    <pre className="text-[11px] font-mono bg-black/40 p-2 rounded border border-white/5 text-[#E8EAE6] overflow-x-auto">
                                        <code>{c.expression}</code>
                                    </pre>
                                )}
                            </div>
                        ))
                    ) : (
                        <div className="p-6 text-center text-[#8A918C] space-y-1.5">
                            <div className="text-xs">No active evidence citations</div>
                            <div className="text-[11px] text-[#8A918C]/70">Evidence citations appear when AI answers reference specific lines.</div>
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

                            {/* Why this score collapsible */}
                            {impactResult.reasons && impactResult.reasons.length > 0 && (
                                <div className="pt-2 border-t border-white/[0.08]">
                                    <button
                                        onClick={() => setShowReasons(!showReasons)}
                                        className="flex items-center justify-between w-full py-1 text-[11px] text-[#8A918C] hover:text-[#E8EAE6] transition-colors cursor-pointer"
                                    >
                                        <span className="font-medium">Why this score</span>
                                        {showReasons ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                    </button>
                                    {showReasons && (
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

                            {impactResult.directCallers.length > 0 && (
                                <div className="pt-2">
                                    <div className="text-[11px] text-[#8A918C] mb-2 font-normal">Direct callers ({impactResult.directCallers.length})</div>
                                    <div className="space-y-1.5 max-h-48 overflow-y-auto scrollbar-custom">
                                        {impactResult.directCallers.map((dc, i) => (
                                            <div key={i} className="glass-surface p-2 rounded-md border-white/5 flex justify-between items-center text-xs">
                                                <span className="font-mono text-[#E8EAE6] truncate">{dc.symbol.name}</span>
                                                <Badge variant="default">{dc.symbol.type}</Badge>
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
                        <div className="flex justify-between py-1 border-b border-white/[0.06] text-[#8A918C]">
                            <span>Name</span>
                            <b className="text-[#E8EAE6] font-mono truncate max-w-[160px]">{nodeName}</b>
                        </div>
                        {selectedFile && (
                            <div className="flex justify-between py-1 border-b border-white/[0.06] text-[#8A918C]">
                                <span>File</span>
                                <b className="text-[#E8EAE6] font-mono truncate max-w-[160px]" title={selectedFile}>{selectedFile.split('/').pop()}</b>
                            </div>
                        )}
                        {selectedFile && (
                            <div className="flex justify-between py-1 text-[#8A918C]">
                                <span>Full path</span>
                                <b className="text-[#8A918C] font-mono text-[11px] truncate max-w-[160px]" title={selectedFile}>{selectedFile}</b>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

