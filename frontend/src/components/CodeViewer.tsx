import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../store';
import { api } from '../api';
import { Copy, Check, Loader2, FileCode, AlertCircle } from 'lucide-react';
import { cn } from '../ui';

// Tiny safe syntax tokenizer for keywords, strings, comments, numbers, types/builtins
function highlightCodeLine(line: string): React.ReactNode {
    // Regex matches comments (//...), multi-line comment remnants, strings ("..." or '...' or `...`), numbers, keywords, and identifiers
    const tokenRegex = /(\/\/[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b(?:const|let|var|function|return|import|export|from|default|class|extends|interface|type|enum|implements|public|private|protected|readonly|static|async|await|try|catch|finally|throw|if|else|for|while|do|switch|case|break|continue|new|typeof|instanceof|void|yield|def|self|None|True|False|elif|pass|lambda)\b)|(\b\d+(?:\.\d+)?\b)|([a-zA-Z_$][a-zA-Z0-9_$]*)|([^\s\w]+)/g;

    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(line)) !== null) {
        if (match.index > lastIndex) {
            parts.push(line.substring(lastIndex, match.index));
        }

        const [full, comment, str, keyword, num, identifier, symbol] = match;

        if (comment) {
            parts.push(<span key={match.index} className="text-[#8A918C]/70 italic">{comment}</span>);
        } else if (str) {
            parts.push(<span key={match.index} className="text-[#A5D6A7]">{str}</span>);
        } else if (keyword) {
            parts.push(<span key={match.index} className="text-[#FF7B72] font-semibold">{keyword}</span>);
        } else if (num) {
            parts.push(<span key={match.index} className="text-[#79C0FF]">{num}</span>);
        } else if (identifier) {
            if (/^[A-Z][a-zA-Z0-9_$]*$/.test(identifier)) {
                // Class or Type PascalCase
                parts.push(<span key={match.index} className="text-[#FFA657]">{identifier}</span>);
            } else {
                parts.push(<span key={match.index} className="text-[#E8EAE6]">{identifier}</span>);
            }
        } else if (symbol) {
            parts.push(<span key={match.index} className="text-[#8A918C]">{symbol}</span>);
        } else {
            parts.push(full);
        }

        lastIndex = tokenRegex.lastIndex;
    }

    if (lastIndex < line.length) {
        parts.push(line.substring(lastIndex));
    }

    return parts.length > 0 ? parts : ' ';
}

export function CodeViewer() {
    const { repoUrl, selectedSha, selectedFile, codeHighlightLine, setCodeHighlightLine } = useAppStore();
    const [content, setContent] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const lineRefs = useRef<Map<number, HTMLDivElement>>(new Map());

    useEffect(() => {
        if (!repoUrl || !selectedSha || !selectedFile) {
            setContent(null);
            setError(null);
            return;
        }

        let isMounted = true;
        setLoading(true);
        setError(null);

        api.repositories.getFile(repoUrl, selectedSha, selectedFile)
            .then(res => {
                if (isMounted) {
                    setContent(res.content);
                }
            })
            .catch(err => {
                if (isMounted) {
                    setError(err.message || 'Failed to load file content.');
                    setContent(null);
                }
            })
            .finally(() => {
                if (isMounted) setLoading(false);
            });

        return () => {
            isMounted = false;
        };
    }, [repoUrl, selectedSha, selectedFile]);

    // Handle smooth scrolling and temporary line highlighting
    useEffect(() => {
        if (codeHighlightLine && content && !loading) {
            const el = lineRefs.current.get(codeHighlightLine);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            const timer = setTimeout(() => {
                setCodeHighlightLine(null);
            }, 2000);
            return () => clearTimeout(timer);
        }
    }, [codeHighlightLine, content, loading, setCodeHighlightLine]);

    const handleCopy = () => {
        if (!content) return;
        navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (!selectedFile) {
        return (
            <div className="glass-surface p-12 rounded-xl border-white/10 text-center flex flex-col items-center justify-center gap-2 flex-1">
                <FileCode size={24} className="text-[#8A918C]/40 mb-1" />
                <div className="text-xs text-[#8A918C]">Select a file from the sidebar to view its code.</div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="glass-surface p-16 rounded-xl border-white/10 text-center flex flex-col items-center justify-center gap-3 flex-1">
                <Loader2 size={24} className="animate-spin text-[#4FD1B5]" />
                <span className="text-xs font-mono text-[#8A918C]">Loading {selectedFile.split('/').pop()}...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="glass-surface p-12 rounded-xl border-red-500/20 bg-red-500/[0.03] text-center flex flex-col items-center justify-center gap-3 flex-1">
                <AlertCircle size={24} className="text-red-400" />
                <div className="text-xs text-red-200">{error}</div>
            </div>
        );
    }

    const lines = content !== null ? content.split('\n') : [];

    return (
        <div className="flex-1 flex flex-col min-h-0 glass-surface border-white/10 rounded-xl overflow-hidden">
            {/* Header toolbar */}
            <div className="p-3 bg-white/[0.02] border-b border-white/10 flex items-center justify-between shrink-0 select-none">
                <div className="flex items-center gap-2 text-xs">
                    <FileCode size={14} className="text-[#4FD1B5]" />
                    <span className="font-mono text-[#E8EAE6] font-medium">{selectedFile.split('/').pop()}</span>
                    <span className="text-[11px] text-[#8A918C] font-mono">({lines.length} lines)</span>
                </div>
                <button
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-white/[0.04] border border-white/10 text-[#8A918C] hover:text-[#E8EAE6] hover:bg-white/[0.08] text-xs transition-colors cursor-pointer"
                    title="Copy full file content"
                >
                    {copied ? (
                        <>
                            <Check size={12} className="text-[#4FD1B5]" />
                            <span className="text-[#4FD1B5]">Copied</span>
                        </>
                    ) : (
                        <>
                            <Copy size={12} />
                            <span>Copy</span>
                        </>
                    )}
                </button>
            </div>

            {/* Code view area with line numbers and horizontal scroll */}
            <div className="flex-1 overflow-auto scrollbar-custom font-mono text-xs leading-5 bg-[#050708] select-text">
                <div className="min-w-full inline-block py-2">
                    {lines.map((line, index) => {
                        const lineNum = index + 1;
                        const isHighlighted = codeHighlightLine === lineNum;

                        return (
                            <div
                                key={lineNum}
                                ref={(el) => {
                                    if (el) lineRefs.current.set(lineNum, el);
                                    else lineRefs.current.delete(lineNum);
                                }}
                                className={cn(
                                    "flex items-baseline px-4 transition-colors duration-300 hover:bg-white/[0.03]",
                                    isHighlighted && "bg-[#4FD1B5]/20 border-l-2 border-[#4FD1B5]"
                                )}
                            >
                                <span className={cn(
                                    "w-12 shrink-0 select-none text-right pr-4 text-[#8A918C]/40 text-[11px]",
                                    isHighlighted && "text-[#4FD1B5] font-semibold"
                                )}>
                                    {lineNum}
                                </span>
                                <pre className="whitespace-pre overflow-visible text-[#E8EAE6] m-0 font-mono">
                                    {highlightCodeLine(line)}
                                </pre>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
