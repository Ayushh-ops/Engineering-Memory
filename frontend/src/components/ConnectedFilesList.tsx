import { useMemo } from 'react';
import { useAppStore } from '../store';
import { getConnectedFiles, ConnectedSymbol } from '../graph-helpers';
import { FileCode, Network, Code2, Hexagon } from 'lucide-react';
import { cn } from '../ui';

export function ConnectedFilesList({
    className,
    maxHeightClass = "max-h-36"
}: {
    className?: string;
    maxHeightClass?: string;
}) {
    const { graph, selectedFile, selectFile, setSelectedSymbol, setActiveTab, setHoveredGraphNode } = useAppStore();

    const connected = useMemo(() => {
        return getConnectedFiles(graph, selectedFile);
    }, [graph, selectedFile]);

    const handleNavigate = async (path: string) => {
        setActiveTab('Graph');
        await selectFile(path);
    };

    const handleNavigateSymbol = (sym: ConnectedSymbol) => {
        if (!selectedFile) return;
        setActiveTab('Graph');
        setSelectedSymbol({ name: sym.name, type: sym.type as any, path: selectedFile });
    };

    const totalCount = connected.imports.length + connected.importedBy.length + connected.calls.length + connected.contains.length;

    if (!selectedFile) {
        return null;
    }

    return (
        <div className={cn("space-y-3", className)}>
            <div className="flex items-center justify-between text-[#8A918C]">
                <span className="text-[11px] font-normal flex items-center gap-1.5">
                    <Network size={12} className="text-[#4FD1B5]" />
                    <span>Connected files ({totalCount})</span>
                </span>
            </div>

            <div className="space-y-3">
                {totalCount === 0 && (
                    <div className="text-[11px] text-[#8A918C]/50 italic">None</div>
                )}

                {/* Imports - hide if 0 items */}
                {connected.imports.length > 0 && (
                    <div className="space-y-1.5">
                        <div className="text-[10px] font-medium text-[#8A918C] flex items-center justify-between">
                            <span>Imports</span>
                            <span className="font-mono text-[10px] text-[#4FD1B5]">
                                ({connected.imports.length})
                            </span>
                        </div>
                        <div className={cn("space-y-1 overflow-y-auto scrollbar-custom pr-1", maxHeightClass)}>
                            {connected.imports.map((f) => (
                                <div
                                    key={f}
                                    onClick={() => handleNavigate(f)}
                                    onMouseEnter={() => setHoveredGraphNode(f)}
                                    onMouseLeave={() => setHoveredGraphNode(null)}
                                    className="px-2 py-1 rounded bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.06] hover:border-[#4FD1B5]/40 cursor-pointer transition-colors flex items-center justify-between group"
                                >
                                    <div className="flex items-center gap-1.5 truncate min-w-0">
                                        <FileCode size={11} className="text-[#4FD1B5] shrink-0" />
                                        <span className="font-mono text-[11px] text-[#E8EAE6] group-hover:text-[#4FD1B5] truncate" title={f}>
                                            {f.split('/').pop()}
                                        </span>
                                    </div>
                                    <span className="font-mono text-[9px] text-[#8A918C]/60 truncate ml-2 max-w-[90px] hidden sm:inline" title={f}>
                                        {f}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Imported by - hide if 0 items */}
                {connected.importedBy.length > 0 && (
                    <div className="space-y-1.5">
                        <div className="text-[10px] font-medium text-[#8A918C] flex items-center justify-between">
                            <span>Imported by</span>
                            <span className="font-mono text-[10px] text-[#E3A04A]">
                                ({connected.importedBy.length})
                            </span>
                        </div>
                        <div className={cn("space-y-1 overflow-y-auto scrollbar-custom pr-1", maxHeightClass)}>
                            {connected.importedBy.map((f) => (
                                <div
                                    key={f}
                                    onClick={() => handleNavigate(f)}
                                    onMouseEnter={() => setHoveredGraphNode(f)}
                                    onMouseLeave={() => setHoveredGraphNode(null)}
                                    className="px-2 py-1 rounded bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.06] hover:border-[#E3A04A]/40 cursor-pointer transition-colors flex items-center justify-between group"
                                >
                                    <div className="flex items-center gap-1.5 truncate min-w-0">
                                        <FileCode size={11} className="text-[#E3A04A] shrink-0" />
                                        <span className="font-mono text-[11px] text-[#E8EAE6] group-hover:text-[#E3A04A] truncate" title={f}>
                                            {f.split('/').pop()}
                                        </span>
                                    </div>
                                    <span className="font-mono text-[9px] text-[#8A918C]/60 truncate ml-2 max-w-[90px] hidden sm:inline" title={f}>
                                        {f}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Calls - hide if 0 items */}
                {connected.calls.length > 0 && (
                    <div className="space-y-1.5">
                        <div className="text-[10px] font-medium text-[#8A918C] flex items-center justify-between">
                            <span>Calls</span>
                            <span className="font-mono text-[10px] text-[#4FD1B5]">
                                ({connected.calls.length})
                            </span>
                        </div>
                        <div className={cn("space-y-1 overflow-y-auto scrollbar-custom pr-1", maxHeightClass)}>
                            {connected.calls.map((f) => (
                                <div
                                    key={f}
                                    onClick={() => handleNavigate(f)}
                                    onMouseEnter={() => setHoveredGraphNode(f)}
                                    onMouseLeave={() => setHoveredGraphNode(null)}
                                    className="px-2 py-1 rounded bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.06] hover:border-[#4FD1B5]/40 cursor-pointer transition-colors flex items-center justify-between group"
                                >
                                    <div className="flex items-center gap-1.5 truncate min-w-0">
                                        <FileCode size={11} className="text-[#4FD1B5] shrink-0" />
                                        <span className="font-mono text-[11px] text-[#E8EAE6] group-hover:text-[#4FD1B5] truncate" title={f}>
                                            {f.split('/').pop()}
                                        </span>
                                    </div>
                                    <span className="font-mono text-[9px] text-[#8A918C]/60 truncate ml-2 max-w-[90px] hidden sm:inline" title={f}>
                                        {f}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Contains - hide if 0 items */}
                {connected.contains.length > 0 && (
                    <div className="space-y-1.5">
                        <div className="text-[10px] font-medium text-[#8A918C] flex items-center justify-between">
                            <span>Contains</span>
                            <span className="font-mono text-[10px] text-[#4FD1B5]">
                                ({connected.contains.length})
                            </span>
                        </div>
                        <div className={cn("space-y-1 overflow-y-auto scrollbar-custom pr-1", maxHeightClass)}>
                            {connected.contains.map((sym) => (
                                <div
                                    key={sym.id}
                                    onClick={() => handleNavigateSymbol(sym)}
                                    onMouseEnter={() => setHoveredGraphNode(sym.id)}
                                    onMouseLeave={() => setHoveredGraphNode(null)}
                                    className="px-2 py-1 rounded bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.06] hover:border-[#4FD1B5]/40 cursor-pointer transition-colors flex items-center justify-between group"
                                >
                                    <div className="flex items-center gap-1.5 truncate min-w-0">
                                        {sym.type === 'class' ? (
                                             <Hexagon size={11} className="text-[#E3A04A] shrink-0" />
                                        ) : (
                                            <Code2 size={11} className="text-[#8A918C] shrink-0" />
                                        )}
                                        <span className="font-mono text-[11px] text-[#E8EAE6] group-hover:text-[#4FD1B5] truncate" title={sym.name}>
                                            {sym.name}{sym.type === 'function' || sym.type === 'method' ? '()' : ''}
                                        </span>
                                    </div>
                                    <span className="font-mono text-[9px] text-[#8A918C]/60 truncate ml-2">
                                        {sym.type}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
