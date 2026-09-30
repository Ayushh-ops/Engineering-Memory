import { useState, useMemo, useEffect } from 'react';
import { useAppStore } from '../store';
import { GitBranch, Search, ChevronDown, ChevronRight, FileCode, FileText, Loader2 } from 'lucide-react';
import { api } from '../api';
import { cn } from '../ui';
import { getPathsToAnalyze, isFileInGraph, isCodeFile } from '../analyze-helpers';

function buildTree(paths: string[]) {
    const root: any = { name: '', children: {}, isDir: true };
    paths.forEach(path => {
        const parts = path.split('/');
        let current = root;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (!current.children[part]) {
                current.children[part] = { name: part, path: parts.slice(0, i + 1).join('/'), isDir: i < parts.length - 1, children: {} };
            }
            current = current.children[part];
        }
    });
    return root;
}

function TreeFolder({ node, onSelect, selectedFile, depth = 0 }: any) {
    const [expanded, setExpanded] = useState(depth === 0);
    const hasChildren = Object.keys(node.children).length > 0;

    if (!node.isDir) {
        const isCode = isCodeFile(node.name);
        return (
            <div
                onClick={() => onSelect(node.path)}
                style={{ paddingLeft: `${depth * 12 + 4}px` }}
                className={cn(
                    "flex items-center gap-1.5 py-1 text-xs cursor-pointer hover:bg-zinc-800/50 rounded mr-2",
                    selectedFile === node.path ? "text-emerald-400 bg-emerald-500/10" : (isCode ? "text-zinc-400" : "text-zinc-600")
                )}
            >
                {isCode ? <FileCode size={13} className="shrink-0" /> : <FileText size={13} className="shrink-0" />}
                <span className={cn("truncate", !isCode && "opacity-60")}>{node.name}</span>
            </div>
        );
    }

    return (
        <div className="select-none">
            {node.name && (
                <div
                    onClick={() => setExpanded(!expanded)}
                    style={{ paddingLeft: `${(depth - 1) * 12 + 4}px` }}
                    className="flex items-center gap-1 py-1 text-xs cursor-pointer text-zinc-300 hover:text-zinc-100 mr-2"
                >
                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span className="truncate">{node.name}</span>
                </div>
            )}
            {expanded && hasChildren && (
                <div>
                    {Object.values(node.children).sort((a: any, b: any) => {
                        if (a.isDir && !b.isDir) return -1;
                        if (!a.isDir && b.isDir) return 1;
                        return a.name.localeCompare(b.name);
                    }).map((child: any) => (
                        <TreeFolder key={child.path} node={child} onSelect={onSelect} selectedFile={selectedFile} depth={depth + 1} />
                    ))}
                </div>
            )}
        </div>
    );
}

function renderTree(paths: string[], onSelect: (path: string) => void, selectedFile: string | null) {
    const root = buildTree(paths);
    return <TreeFolder node={root} onSelect={onSelect} selectedFile={selectedFile} />;
}

export function Sidebar({ className }: { className?: string }) {
    const { repoUrl, meta, commits, selectedSha, setSelectedSha, treeFiles, setTreeFiles, graph, setGraph, selectedFile, setSelectedFile, setSelectedSymbol, setImpactResult } = useAppStore();
    const [search, setSearch] = useState('');
    const [loadingTree, setLoadingTree] = useState(false);
    const [analyzingFile, setAnalyzingFile] = useState(false);

    const handleShaChange = async (newSha: string) => {
        setSelectedSha(newSha);
        if (!repoUrl) return;
        setLoadingTree(true);
        try {
            const treeRes = await api.repositories.getTree(repoUrl, newSha);
            setTreeFiles(treeRes.files);
        } catch (e) {
            console.error(e);
        } finally {
            setLoadingTree(false);
        }
    };

    const handleFileSelect = async (path: string) => {
        if (!repoUrl || !selectedSha) return;
        setSelectedFile(path);

        const isCode = isCodeFile(path);
        setSelectedSymbol(null);
        setImpactResult(null);

        // Only code files trigger graph analysis
        if (!isCode) {
            return;
        }

        // Cache hit?
        if (graph && isFileInGraph(graph, path)) {
            return;
        }

        setAnalyzingFile(true);
        try {
            const paths = getPathsToAnalyze(treeFiles, path);
            const data = await api.repositories.analyze(repoUrl, selectedSha, paths);
            setGraph(data.graph);
        } catch (e) {
            console.error("Analysis failed", e);
        } finally {
            setAnalyzingFile(false);
        }
    };

    const stats = useMemo(() => {
        if (!graph) return { files: '-', functions: '-', classes: '-', links: '-' };
        let f = 0, fn = 0, c = 0;
        for (const n of graph.nodes) {
            if (n.type === 'file') f++;
            if (n.type === 'function' || n.type === 'method') fn++;
            if (n.type === 'class') c++;
        }
        return {
            files: f.toString(),
            functions: fn.toString(),
            classes: c.toString(),
            links: graph.edges.length.toString()
        };
    }, [graph]);

    const filteredTree = useMemo(() => {
        if (!search) return treeFiles;
        return treeFiles.filter(f => f.toLowerCase().includes(search.toLowerCase()));
    }, [treeFiles, search]);

    return (
        <div className={cn("flex flex-col bg-[#0a0a0b]", className)}>
            <div className="p-4 border-b border-zinc-800">
                <div className="text-xs font-semibold text-zinc-500 mb-2 uppercase tracking-wide">Repository</div>
                {meta ? (
                    <div className="flex gap-3">
                        <div className="w-8 h-8 rounded bg-zinc-800 flex items-center justify-center shrink-0">
                            <GitBranch size={18} className="text-zinc-400" />
                        </div>
                        <div className="overflow-hidden">
                            <div className="text-sm font-medium truncate">{meta.fullName}</div>
                            <div className="text-xs text-zinc-500 truncate">{meta.description || 'No description'}</div>
                        </div>
                    </div>
                ) : (
                    <div className="text-xs text-zinc-600">No repository loaded</div>
                )}

                <div className="mt-4 flex gap-2">
                    <select title="Switch branch (view only)" className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-300 cursor-help">
                        <option>main</option>
                    </select>
                    <select
                        title="Select a specific commit to view the repository file structure and graph at that point in time"
                        value={selectedSha || ''}
                        onChange={(e) => handleShaChange(e.target.value)}
                        className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-300 truncate"
                        disabled={!commits.length}
                    >
                        {commits.map(c => <option key={c.sha} value={c.sha}>{c.sha.substring(0, 7)}</option>)}
                        {!commits.length && <option>---</option>}
                    </select>
                </div>

                <div className="grid grid-cols-2 gap-2 mt-4">
                    {[
                        { label: 'Files', val: stats.files },
                        { label: 'Functions', val: stats.functions },
                        { label: 'Classes', val: stats.classes },
                        { label: 'Links', val: stats.links },
                    ].map(s => (
                        <div key={s.label} className="bg-[#121214] border border-zinc-800/50 rounded flex flex-col items-center justify-center py-2">
                            <div className="text-sm font-bold text-gray-200">{analyzingFile ? <Loader2 size={12} className="animate-spin text-zinc-500" /> : s.val}</div>
                            <div className="text-[10px] text-zinc-500 uppercase tracking-wider">{s.label}</div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex-1 flex flex-col p-2 overflow-hidden">
                <div className="relative mb-2 shrink-0">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" size={14} />
                    <input
                        value={search} onChange={e => setSearch(e.target.value)}
                        placeholder="Search files..."
                        className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 pl-8 text-xs text-gray-300 focus:outline-none focus:border-zinc-700"
                    />
                </div>
                <div className="flex-1 overflow-y-auto scrollbar-custom pb-4">
                    {loadingTree ? (
                        <div className="text-xs p-4 text-zinc-500 flex items-center justify-center gap-2">
                            <Loader2 size={16} className="animate-spin text-zinc-500" />
                            Loading tree...
                        </div>
                    ) : (
                        renderTree(filteredTree, handleFileSelect, selectedFile)
                    )}
                </div>
            </div>
        </div>
    );
}
