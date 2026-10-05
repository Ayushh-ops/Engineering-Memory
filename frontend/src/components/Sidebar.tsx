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
        const isSelected = selectedFile === node.path;
        return (
            <div
                onClick={() => onSelect(node.path)}
                style={{ paddingLeft: `${depth * 12 + 6}px` }}
                title={!isCode ? "Not analyzed" : undefined}
                className={cn(
                    "flex items-center gap-1.5 py-1 text-xs cursor-pointer rounded-md mr-1 font-mono transition-colors",
                    isSelected
                        ? "text-[#4FD1B5] bg-[#4FD1B5]/10 font-medium"
                        : (isCode ? "text-[#8A918C] hover:text-[#E8EAE6] hover:bg-white/[0.04]" : "text-[#8A918C]/60 hover:text-[#8A918C]")
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
                    style={{ paddingLeft: `${(depth - 1) * 12 + 6}px` }}
                    className="flex items-center gap-1.5 py-1 text-xs cursor-pointer text-[#8A918C] hover:text-[#E8EAE6] mr-1 rounded-md transition-colors"
                >
                    {expanded ? <ChevronDown size={13} className="shrink-0 opacity-70" /> : <ChevronRight size={13} className="shrink-0 opacity-70" />}
                    <span className="truncate font-mono">{node.name}</span>
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
        setAnalyzingFile(true);
        try {
            await useAppStore.getState().selectFile(path);
        } finally {
            setAnalyzingFile(false);
        }
    };

    const stats = useMemo(() => {
        const fileCount = treeFiles && treeFiles.length > 0 ? treeFiles.length : (graph ? graph.nodes.filter(n => n.type === 'file').length : 0);
        if (!graph && fileCount === 0) return { files: '-', functions: '-', classes: '-', links: '-' };
        let fn = 0, c = 0;
        if (graph) {
            for (const n of graph.nodes) {
                if (n.type === 'function' || n.type === 'method') fn++;
                if (n.type === 'class') c++;
            }
        }
        return {
            files: fileCount.toString(),
            functions: fn.toString(),
            classes: c.toString(),
            links: (graph ? graph.edges.length : 0).toString()
        };
    }, [graph, treeFiles]);

    const filteredTree = useMemo(() => {
        if (!search) return treeFiles;
        return treeFiles.filter(f => f.toLowerCase().includes(search.toLowerCase()));
    }, [treeFiles, search]);

    const repoName = meta?.fullName || (repoUrl ? repoUrl.replace(/^https?:\/\/github\.com\//, '') : 'Repository');

    return (
        <div className={cn("flex flex-col bg-[#07090A] border-r border-white/10 select-none", className)}>
            <div className="p-3.5 border-b border-white/10">
                <div className="text-[13px] font-semibold text-[#E8EAE6] truncate" title={repoName}>
                    {repoName}
                </div>

                <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono text-[11px] px-2 py-0.5 rounded-full border border-white/10 bg-white/[0.03] text-[#8A918C]">
                        main
                    </span>
                    {commits.length > 0 ? (
                        <select
                            title="Select commit"
                            value={selectedSha || ''}
                            onChange={(e) => handleShaChange(e.target.value)}
                            className="bg-white/[0.03] border border-white/10 rounded-full px-2 py-0.5 text-[11px] font-mono text-[#8A918C] cursor-pointer outline-none hover:text-[#E8EAE6] hover:border-white/20 transition-colors"
                        >
                            {commits.map(c => (
                                <option key={c.sha} value={c.sha} className="bg-[#07090A] text-[#E8EAE6]">
                                    {c.sha.substring(0, 7)}
                                </option>
                            ))}
                        </select>
                    ) : (
                        <span className="font-mono text-[11px] px-2 py-0.5 rounded-full border border-white/10 bg-white/[0.03] text-[#8A918C]">
                            {selectedSha ? selectedSha.substring(0, 7) : 'eeda9e2'}
                        </span>
                    )}
                </div>

                {/* Quick stats in sidebar */}
                <div className="grid grid-cols-2 gap-1.5 mt-3 pt-3 border-t border-white/[0.08]">
                    {[
                        { label: 'Files', val: stats.files },
                        { label: 'Symbols', val: stats.functions !== '-' ? (Number(stats.functions) + Number(stats.classes)).toString() : '-' },
                        { label: 'Links', val: stats.links },
                        { label: 'Hotspots', val: stats.files !== '-' ? Math.min(5, Number(stats.files)).toString() : '-' }
                    ].map(s => (
                        <div key={s.label} className="bg-white/[0.02] border border-white/[0.06] rounded-md px-2 py-1.5 flex flex-col">
                            <span className="text-[10px] text-[#8A918C] font-normal">{s.label}</span>
                            <span className="text-xs font-semibold text-[#E8EAE6] font-mono mt-0.5 min-h-[16px] flex items-center">
                                {analyzingFile || (loadingTree && s.val === '-') ? (
                                    <span className="inline-block w-8 h-3 rounded bg-white/[0.08] animate-pulse" />
                                ) : s.val === '-' ? (
                                    <span className="inline-block w-8 h-3 rounded bg-white/[0.08] animate-pulse" />
                                ) : (
                                    s.val
                                )}
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex-1 flex flex-col p-2.5 overflow-hidden">
                <div className="text-[11px] font-medium text-[#8A918C] px-1 mb-1.5">
                    Files
                </div>
                <div className="relative mb-2 shrink-0">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8A918C]" size={13} />
                    <input
                        value={search} onChange={e => setSearch(e.target.value)}
                        placeholder="Search files..."
                        className="w-full bg-white/[0.03] border border-white/10 rounded-md py-1 pl-7 pr-2 text-xs font-mono text-[#E8EAE6] placeholder:text-[#8A918C]/60 focus:outline-none focus:border-[#4FD1B5]/50 transition-colors"
                    />
                </div>
                <div className="flex-1 overflow-y-auto scrollbar-custom pt-1 pb-4">
                    {loadingTree ? (
                        <div className="text-xs p-4 text-[#8A918C] flex items-center justify-center gap-2">
                            <Loader2 size={14} className="animate-spin text-[#4FD1B5]" />
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
