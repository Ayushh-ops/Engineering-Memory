import { useState } from 'react';
import { useAppStore } from '../store';
import { Card, Badge, cn, Button } from '../ui';
import { FileCode, AlertTriangle, Send, Activity, Clock, ShieldAlert } from 'lucide-react';
import { api } from '../api';

export function RightPanel({ className }: { className?: string }) {
    const { selectedSymbol, impactResult, repoUrl, selectedSha, treeFiles, graph } = useAppStore();
    const [tab, setTab] = useState<'Details' | 'Evidence'>('Details');

    if (!selectedSymbol || !impactResult) {
        return (
            <div className={cn("p-4 border-l border-zinc-800 bg-[#0a0a0b] flex flex-col items-center justify-center text-zinc-500", className)}>
                Select a symbol in a file to see details.
            </div>
        );
    }

    const { target, bounds, directCallers, transitiveConsumers, callSiteEvidence } = impactResult;



    return (
        <div className={cn("flex flex-col bg-[#0a0a0b] border-l border-zinc-800", className)}>
            <div className="flex px-4 border-b border-zinc-800 gap-4">
                {['Details', 'Evidence'].map(t => (
                    <button
                        key={t} onClick={() => setTab(t as any)}
                        className={cn("py-3 text-xs font-semibold cursor-pointer border-b-2 transition-colors", tab === t ? "border-emerald-500 text-emerald-400" : "border-transparent text-zinc-400 hover:text-zinc-200")}
                    >
                        {t === 'Details' && <Activity size={14} className="inline mr-1" />}
                        {t}
                    </button>
                ))}
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-custom p-4 space-y-4">
                {tab === 'Details' && (
                    <>
                        <div className="mb-4">
                            <h3 className="font-semibold text-gray-200">Blast Radius</h3>
                            <p className="text-xs text-zinc-400 mb-2">Summary of what could be affected by changing this {selectedSymbol.type}.</p>
                            <Card className="flex items-center gap-3 bg-red-500/5 border-red-500/20">
                                <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
                                    <Activity size={16} className="text-red-400" />
                                </div>
                                <span className="text-sm font-medium text-red-100">{target.type === 'file' ? 'File scale change' : `${directCallers.length + transitiveConsumers.length} consumers could be affected`}</span>
                            </Card>
                        </div>

                        <div>
                            <div className="flex justify-between items-center mb-2">
                                <h4 className="text-xs font-semibold text-gray-300">Direct Callers ({directCallers.length})</h4>
                            </div>
                            <div className="space-y-2">
                                {directCallers.map((dc, i) => (
                                    <Card key={i} className="py-2 px-3 flex justify-between items-center group cursor-pointer hover:bg-zinc-800/80">
                                        <div className="overflow-hidden">
                                            <div className="text-xs font-medium text-blue-300 flex items-center gap-1.5"><FileCode size={12} />{dc.symbol.name}</div>
                                            <div className="text-[10px] text-zinc-500 truncate">{dc.symbol.path}</div>
                                        </div>
                                        <Badge variant="blue">{dc.symbol.type}</Badge>
                                    </Card>
                                ))}
                            </div>
                        </div>

                        <div>
                            <div className="flex justify-between items-center mb-2">
                                <h4 className="text-xs font-semibold text-gray-300">Transitive Consumers ({transitiveConsumers.length})</h4>
                            </div>
                            {/* In a real app we'd map transitive too */}
                        </div>

                        <div className="pt-4 border-t border-zinc-800">
                            <h4 className="text-xs font-semibold text-zinc-400 mb-2">Analysis Bounds</h4>
                            {bounds.truncated ? (
                                <Card className="bg-amber-500/5 border-amber-500/20 flex gap-3">
                                    <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
                                    <div>
                                        <div className="text-xs font-semibold text-amber-500 text-sm">Results truncated</div>
                                        <div className="text-[11px] text-amber-500/80 mt-1">The analysis was limited to maxDepth {bounds.maxDepth} and maxResults {bounds.maxResults}.</div>
                                    </div>
                                </Card>
                            ) : (
                                <div className="text-xs text-emerald-400 bg-emerald-500/10 px-3 py-2 rounded">Full results shown</div>
                            )}
                        </div>
                    </>
                )}

                {tab === 'Evidence' && (
                    <div className="space-y-4">
                        <h3 className="font-semibold text-gray-200">Key Evidence</h3>
                        <p className="text-xs text-zinc-400">Exact locations where this symbol is used.</p>
                        {callSiteEvidence.map(c => (
                            <Card key={c.id} className="space-y-2">
                                <div className="flex justify-between text-xs text-blue-300">
                                    <span className="flex items-center gap-1"><FileCode size={12} />{c.file.split('/').pop()}</span>
                                    <span>Line {c.startLine}</span>
                                </div>
                                <div className="text-[10px] text-zinc-500 truncate">{c.file}</div>
                                <pre className="text-[11px] bg-black p-2 rounded text-gray-300 overflow-x-auto">
                                    <code>{c.expression}</code>
                                </pre>
                            </Card>
                        ))}
                    </div>
                )}

            </div>
        </div>
    )
}
