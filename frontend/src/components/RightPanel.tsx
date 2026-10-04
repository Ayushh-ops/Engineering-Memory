import { useState } from 'react';
import { useAppStore } from '../store';
import { Card, Badge, cn, Button } from '../ui';
import { FileCode, AlertTriangle, Send, Activity, Clock, ShieldAlert } from 'lucide-react';
import { api } from '../api';

export function RightPanel({ className }: { className?: string }) {
    const { selectedSymbol, impactResult, selectedFile, setActiveTab } = useAppStore();
    const [tab, setTab] = useState<'Details' | 'Evidence'>('Details');

    if (!selectedSymbol && !selectedFile) {
        return (
            <div className={cn("p-6 border-l border-white/10 bg-[#07090A] flex flex-col items-center justify-center text-center text-[#8A918C]", className)}>
                <div className="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center mb-3 text-[#8A918C]">
                    <Activity size={18} />
                </div>
                <div className="text-sm font-medium text-[#E8EAE6] mb-1">No node selected</div>
                <div className="text-xs text-[#8A918C] max-w-[200px]">Select a node to see what depends on it</div>
            </div>
        );
    }

    const nodeName = selectedSymbol?.name || (selectedFile ? selectedFile.split('/').pop() : 'Selected node');
    const nodeType = selectedSymbol?.type || 'file';

    return (
        <div className={cn("flex flex-col bg-[#07090A] border-l border-white/10 select-none text-[#E8EAE6]", className)}>
            <div className="p-3.5 border-b border-white/10">
                <div className="flex items-center justify-between">
                    <h3 className="font-mono text-xs font-semibold truncate text-[#E8EAE6]" title={nodeName}>
                        {nodeName}{selectedSymbol?.type === 'function' || selectedSymbol?.type === 'method' ? '()' : ''}
                    </h3>
                    <Badge variant={nodeType === 'file' ? 'blue' : (nodeType === 'class' ? 'amber' : 'emerald')}>
                        {nodeType}
                    </Badge>
                </div>
                <div className="text-[11px] text-[#8A918C] truncate mt-1 font-mono" title={selectedFile || ''}>
                    {selectedFile || 'main branch'}
                </div>
            </div>

            <div className="flex px-3.5 border-b border-white/10 gap-4">
                {['Details', 'Evidence'].map(t => (
                    <button
                        key={t} onClick={() => setTab(t as any)}
                        className={cn("py-2 text-xs font-semibold cursor-pointer border-b-2 transition-colors", tab === t ? "border-[#4FD1B5] text-[#4FD1B5]" : "border-transparent text-[#8A918C] hover:text-[#E8EAE6]")}
                    >
                        {t}
                    </button>
                ))}
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-custom p-3.5 space-y-4 text-xs">
                {tab === 'Details' && (
                    <>
                        {impactResult ? (
                            <>
                                <div>
                                    <div className="text-[11px] font-medium text-[#8A918C] mb-2 uppercase tracking-wide">Blast radius</div>
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

                                <div className="pt-2">
                                    <Button
                                        onClick={() => setActiveTab('Impact')}
                                        variant="secondary"
                                        className="w-full text-xs py-2 justify-center"
                                    >
                                        See blast radius
                                    </Button>
                                </div>

                                {impactResult.directCallers.length > 0 && (
                                    <div className="pt-3">
                                        <div className="text-[11px] font-medium text-[#8A918C] mb-2">Direct callers ({impactResult.directCallers.length})</div>
                                        <div className="space-y-1.5 max-h-48 overflow-y-auto scrollbar-custom">
                                            {impactResult.directCallers.map((dc, i) => (
                                                <div key={i} className="glass-surface p-2 rounded-md border-white/5 flex justify-between items-center text-xs">
                                                    <span className="font-mono text-[#E8EAE6] truncate">{dc.symbol.name}</span>
                                                    <Badge variant="blue">{dc.symbol.type}</Badge>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="space-y-3">
                                <div className="text-[11px] font-medium text-[#8A918C] uppercase tracking-wide">Analysis</div>
                                <div className="text-[#8A918C] text-xs">
                                    Impact analysis not run for this selection yet.
                                </div>
                                <Button
                                    onClick={() => setActiveTab('Impact')}
                                    className="w-full text-xs py-2 justify-center"
                                >
                                    Analyze impact
                                </Button>
                            </div>
                        )}
                    </>
                )}

                {tab === 'Evidence' && (
                    <div className="space-y-3">
                        <div className="text-[11px] font-medium text-[#8A918C] uppercase tracking-wide">Key evidence</div>
                        {impactResult?.callSiteEvidence && impactResult.callSiteEvidence.length > 0 ? (
                            impactResult.callSiteEvidence.map((c: any) => (
                                <div key={c.id} className="glass-surface p-2.5 rounded-lg border-white/10 space-y-1.5">
                                    <div className="flex justify-between font-mono text-[11px] text-[#4FD1B5]">
                                        <span className="truncate">{c.file.split('/').pop()}</span>
                                        <span>line {c.startLine}</span>
                                    </div>
                                    <pre className="text-[11px] font-mono bg-black/40 p-2 rounded border border-white/5 text-[#E8EAE6] overflow-x-auto">
                                        <code>{c.expression}</code>
                                    </pre>
                                </div>
                            ))
                        ) : (
                            <div className="text-[#8A918C] text-xs">No call-site evidence recorded.</div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
