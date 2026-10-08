import { useEffect, useState, useRef, useMemo } from 'react';
import { useAppStore } from '../store';
import { Search, FileCode, FileText } from 'lucide-react';
import { isCodeFile } from '../analyze-helpers';
import { computeRisk } from '../graph-helpers';
import { cn } from '../ui';

export function CommandPalette() {
    const { commandPaletteOpen, setCommandPaletteOpen, treeFiles, selectFile, selectedFile, graph, commits } = useAppStore();
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // Global keyboard shortcut
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setCommandPaletteOpen(!commandPaletteOpen);
            } else if (e.key === 'Escape' && commandPaletteOpen) {
                e.preventDefault();
                setCommandPaletteOpen(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [commandPaletteOpen, setCommandPaletteOpen]);

    // Reset query & focus input when opened
    useEffect(() => {
        if (commandPaletteOpen) {
            setQuery('');
            setSelectedIndex(0);
            setTimeout(() => {
                inputRef.current?.focus();
            }, 10);
        }
    }, [commandPaletteOpen]);

    // Score files by recency in commits and risk score in graph
    const hotspotScores = useMemo(() => {
        const scores = new Map<string, number>();
        if (commits && commits.length > 0) {
            commits.slice(0, 10).forEach((c, idx) => {
                const recencyBoost = (10 - idx) * 3;
                (c.files || []).forEach((f: any) => {
                    const fname = typeof f === 'string' ? f : (f.filename || f.path);
                    if (fname) {
                        scores.set(fname, (scores.get(fname) || 0) + recencyBoost);
                    }
                });
            });
        }
        if (graph) {
            const fileNodes = graph.nodes.filter(n => n.type === 'file');
            fileNodes.forEach(fn => {
                const p = (fn as any).path || fn.id;
                if (p) {
                    const r = computeRisk(p, graph, commits).score;
                    scores.set(p, (scores.get(p) || 0) + r);
                }
            });
        }
        return scores;
    }, [graph, commits]);

    // Filter files: max 8 results, sorted by recent/hotspot first
    const results = useMemo(() => {
        if (!treeFiles || treeFiles.length === 0) return [];
        const q = query.trim().toLowerCase();
        const scoreFile = (f: string) => hotspotScores.get(f) || 0;

        if (!q) {
            return [...treeFiles]
                .sort((a, b) => scoreFile(b) - scoreFile(a))
                .slice(0, 8);
        }

        const matches = treeFiles.filter((file) => file.toLowerCase().includes(q));
        return matches
            .sort((a, b) => {
                const aName = a.split('/').pop()?.toLowerCase() || '';
                const bName = b.split('/').pop()?.toLowerCase() || '';
                const aExact = aName === q;
                const bExact = bName === q;
                if (aExact !== bExact) return aExact ? -1 : 1;
                const aStarts = aName.startsWith(q);
                const bStarts = bName.startsWith(q);
                if (aStarts !== bStarts) return aStarts ? -1 : 1;
                return scoreFile(b) - scoreFile(a);
            })
            .slice(0, 8);
    }, [treeFiles, query, hotspotScores]);

    // Keep selected index in bounds when results change
    useEffect(() => {
        setSelectedIndex(0);
    }, [results]);

    const handleSelect = async (path: string) => {
        setCommandPaletteOpen(false);
        await selectFile(path);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (results.length > 0) {
                setSelectedIndex((prev) => (prev + 1) % results.length);
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (results.length > 0) {
                setSelectedIndex((prev) => (prev - 1 + results.length) % results.length);
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (results.length > 0 && results[selectedIndex]) {
                handleSelect(results[selectedIndex]);
            }
        }
    };

    if (!commandPaletteOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setCommandPaletteOpen(false)}
        >
            <div
                className="w-full max-w-xl glass-surface rounded-xl shadow-2xl overflow-hidden border border-white/10"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
                    <Search size={16} className="text-[#8A918C] shrink-0" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Search files..."
                        className="flex-1 bg-transparent text-sm text-[#E8EAE6] placeholder:text-[#8A918C]/60 focus:outline-none"
                    />
                    <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono text-[#8A918C] bg-white/[0.04] border border-white/10 rounded">
                        Esc
                    </kbd>
                </div>

                <div ref={listRef} className="max-h-80 overflow-y-auto p-2">
                    {results.length === 0 ? (
                        <div className="py-8 text-center text-xs text-[#8A918C]">
                            No files match
                        </div>
                    ) : (
                        results.map((file, index) => {
                            const isCode = isCodeFile(file);
                            const isHighlighted = index === selectedIndex;
                            const isSelected = selectedFile === file;
                            const parts = file.split('/');
                            const fileName = parts.pop() || file;
                            const dirPath = parts.join('/');

                            return (
                                <div
                                    key={file}
                                    onClick={() => handleSelect(file)}
                                    onMouseEnter={() => setSelectedIndex(index)}
                                    className={cn(
                                        "flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-xs cursor-pointer transition-colors font-mono",
                                        isHighlighted
                                            ? "bg-white/[0.08] text-[#E8EAE6]"
                                            : "text-[#8A918C] hover:text-[#E8EAE6] hover:bg-white/[0.04]",
                                        isSelected && "text-[#4FD1B5]"
                                    )}
                                >
                                    <div className="flex items-center gap-2.5 min-w-0">
                                        {isCode ? (
                                            <FileCode size={14} className={cn("shrink-0", isSelected ? "text-[#4FD1B5]" : "text-[#8A918C]")} />
                                        ) : (
                                            <FileText size={14} className="shrink-0 text-[#8A918C]/60" />
                                        )}
                                        <span className={cn("truncate", isSelected && "font-medium")}>
                                            {fileName}
                                        </span>
                                        {dirPath && (
                                            <span className="text-[11px] text-[#8A918C]/50 truncate">
                                                {dirPath}
                                            </span>
                                        )}
                                    </div>
                                    {isHighlighted && (
                                        <span className="text-[10px] text-[#8A918C] shrink-0 font-sans">
                                            Select
                                        </span>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>

                <div className="px-4 py-2 border-t border-white/[0.06] bg-white/[0.02] text-[11px] text-[#8A918C] font-mono flex items-center justify-between">
                    <span>Type to search files</span>
                    <span className="text-[10px] text-[#8A918C]/60">↑↓ to navigate · Enter to select</span>
                </div>
            </div>
        </div>
    );
}
