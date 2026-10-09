import { useState, useMemo } from 'react';
import { useAppStore } from '../store';
import { Search, ChevronDown, ChevronRight, FileCode, FileText, Loader2, X, Layers, Hexagon, HeartPulse, Network, Activity, Clock, MessageSquare, Code2 } from 'lucide-react';
import { api } from '../api';
import { cn } from '../ui';
import { getPathsToAnalyze, isCodeFile } from '../analyze-helpers';
import { selectRepoStats } from '../graph-helpers';

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
                style={{ paddingLeft: `${depth * 10 + 6}px` }}
                title={!isCode ? "Not analyzed" : node.path}
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
                    style={{ paddingLeft: `${(depth - 1) * 10 + 6}px` }}
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
    const {
        repoUrl, meta, commits, selectedSha, setSelectedSha,
        treeFiles, setTreeFiles, graph, setGraph, selectedFile,
        changeSet, removeFromChangeSet, clearChangeSet,
        setChangeSetResult, changeSetLoading, setChangeSetLoading,
        activeTab, setActiveTab, repoCache, cacheShaAnalysis
    } = useAppStore();
    const [search, setSearch] = useState('');
    const [loadingTree, setLoadingTree] = useState(false);

    const handleAnalyzeChangeSet = async () => {
        if (!graph || changeSet.length === 0) return;
        setChangeSetLoading(true);
        try {
            const res = await api.graph.impactBatch(graph, changeSet);
            setChangeSetResult(res);
            setActiveTab('ChangeSet');
        } catch (e) {
            console.error('Change set analysis failed', e);
        } finally {
            setChangeSetLoading(false);
        }
    };

    const handleShaChange = async (newSha: string) => {
        setSelectedSha(newSha);
        if (!repoUrl) return;
        setLoadingTree(true);
        try {
            const treeRes = await api.repositories.getTree(repoUrl, newSha);
            setTreeFiles(treeRes.files);
            const cached = repoCache[repoUrl]?.shaAnalysis?.[newSha];
            if (cached) {
                setGraph(cached.graph);
            } else {
                const paths = getPathsToAnalyze(treeRes.files);
                const data = await api.repositories.analyze(repoUrl, newSha, paths);
                const newStats = selectRepoStats({ graph: data.graph, treeFiles: treeRes.files, commits });
                cacheShaAnalysis(repoUrl, newSha, data.graph, newStats);
                setGraph(data.graph);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoadingTree(false);
        }
    };

    const handleFileSelect = async (path: string) => {
        try {
            await useAppStore.getState().selectFile(path);
            if (['Overview', 'ChangeSet', 'Health'].includes(useAppStore.getState().activeTab)) {
                useAppStore.getState().setActiveTab('Graph');
            }
        } catch (e) {
            console.error('Failed to select file', e);
        }
    };

    const filteredTree = useMemo(() => {
        if (!search) return treeFiles;
        return treeFiles.filter(f => f.toLowerCase().includes(search.toLowerCase()));
    }, [treeFiles, search]);

    const repoName = meta?.fullName || (repoUrl ? repoUrl.replace(/^https?:\/\/github\.com\//, '') : 'Repository');

    return (
        <div className={cn("w-[210px] min-w-[210px] max-w-[210px] flex flex-col bg-[#07090A] border-r border-white/[0.08] select-none h-full overflow-hidden shrink-0", className)}>
            {/* Top header: Repo name, branch & commit chips */}
            <div className="p-3 border-b border-white/[0.08] shrink-0">
                <div className="text-[13px] font-semibold text-[#E8EAE6] truncate" title={repoName}>
                    {repoName}
                </div>

                <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono text-[11px] px-2 py-0.5 rounded-full border border-white/[0.08] bg-white/[0.03] text-[#8A918C]">
                        main
                    </span>
                    {commits.length > 0 ? (
                        <select
                            title="Select commit"
                            value={selectedSha || ''}
                            onChange={(e) => handleShaChange(e.target.value)}
                            className="bg-white/[0.03] border border-white/[0.08] rounded-full px-2 py-0.5 text-[11px] font-mono text-[#8A918C] cursor-pointer outline-none hover:text-[#E8EAE6] hover:border-white/20 transition-colors"
                        >
                            {commits.map(c => (
                                <option key={c.sha} value={c.sha} className="bg-[#07090A] text-[#E8EAE6]">
                                    {c.sha.substring(0, 7)}
                                </option>
                            ))}
                        </select>
                    ) : (
                        <span className="font-mono text-[11px] px-2 py-0.5 rounded-full border border-white/[0.08] bg-white/[0.03] text-[#8A918C]">
                            {selectedSha ? selectedSha.substring(0, 7) : 'eeda9e2'}
                        </span>
                    )}
                </div>
            </div>

            {/* Navigation groups */}
            <div className="p-2 border-b border-white/[0.08] shrink-0 space-y-3">
                {/* Repository group */}
                <div>
                    <div className="text-[11px] font-medium text-[#8A918C] px-2 pb-1">
                        Repository
                    </div>
                    <div className="space-y-0.5">
                        {[
                            { id: 'Overview', icon: Hexagon, label: 'Overview' },
                            { id: 'ChangeSet', icon: Layers, label: `Change set${changeSet.length > 0 ? ` (${changeSet.length})` : ''}` },
                            { id: 'Health', icon: HeartPulse, label: 'Health' },
                        ].map(item => {
                            const Icon = item.icon;
                            const isActive = activeTab === item.id;
                            return (
                                <button
                                    key={item.id}
                                    onClick={() => setActiveTab(item.id as any)}
                                    className={cn(
                                        "w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer text-left select-none relative",
                                        isActive
                                            ? "text-[#E8EAE6] bg-white/[0.06] font-medium before:content-[''] before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[2px] before:bg-[#4FD1B5] before:rounded-[2px]"
                                            : "text-[#8A918C] hover:text-[#E8EAE6] hover:bg-white/[0.04]"
                                    )}
                                >
                                    <Icon size={14} className={isActive ? "text-[#4FD1B5]" : "opacity-70"} />
                                    <span>{item.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* This file group */}
                <div>
                    <div className="text-[11px] font-medium text-[#8A918C] px-2 pb-1">
                        This file
                    </div>
                    {selectedFile ? (
                        <div className="space-y-0.5">
                            {[
                                { id: 'Graph', icon: Network, label: 'Graph' },
                                { id: 'Impact', icon: Activity, label: 'Impact' },
                                { id: 'Connections', icon: Network, label: 'Connections' },
                                { id: 'Code', icon: Code2, label: 'Code' },
                                { id: 'History', icon: Clock, label: 'History' },
                                { id: 'AskAI', icon: MessageSquare, label: 'Ask AI' },
                            ].map(item => {
                                const Icon = item.icon;
                                const isActive = activeTab === item.id;
                                return (
                                    <button
                                        key={item.id}
                                        onClick={() => setActiveTab(item.id as any)}
                                        className={cn(
                                            "w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer text-left select-none relative",
                                            isActive
                                                ? "text-[#E8EAE6] bg-white/[0.06] font-medium before:content-[''] before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[2px] before:bg-[#4FD1B5] before:rounded-[2px]"
                                                : "text-[#8A918C] hover:text-[#E8EAE6] hover:bg-white/[0.04]"
                                        )}
                                    >
                                        <Icon size={14} className={isActive ? "text-[#4FD1B5]" : "opacity-70"} />
                                        <span>{item.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="space-y-1">
                            <div className="space-y-0.5 opacity-40 pointer-events-none select-none">
                                {[
                                    { id: 'Graph', icon: Network, label: 'Graph' },
                                    { id: 'Impact', icon: Activity, label: 'Impact' },
                                    { id: 'Connections', icon: Network, label: 'Connections' },
                                    { id: 'Code', icon: Code2, label: 'Code' },
                                    { id: 'History', icon: Clock, label: 'History' },
                                    { id: 'AskAI', icon: MessageSquare, label: 'Ask AI' },
                                ].map(item => {
                                    const Icon = item.icon;
                                    return (
                                        <div
                                            key={item.id}
                                            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#8A918C]"
                                        >
                                            <Icon size={14} className="opacity-70" />
                                            <span>{item.label}</span>
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="text-[11px] text-[#8A918C]/80 px-2.5 py-1 italic leading-tight">
                                Pick a file to unlock these.
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Files tree section */}
            <div className="flex-1 flex flex-col p-2.5 min-h-0 overflow-hidden">
                <div className="text-[11px] font-medium text-[#8A918C] px-1 mb-1.5">
                    Files
                </div>
                <div className="relative mb-2 shrink-0">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8A918C]" size={13} />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search files..."
                        className="w-full bg-white/[0.03] border border-white/[0.08] rounded-md py-1 pl-7 pr-2 text-xs font-mono text-[#E8EAE6] placeholder:text-[#8A918C]/60 focus:outline-none focus:border-[#4FD1B5]/50 transition-colors"
                    />
                </div>
                <div className="flex-1 min-h-[220px] overflow-y-auto scrollbar-custom pt-0.5 pb-2">
                    {loadingTree ? (
                        <div className="text-xs p-4 text-[#8A918C] flex items-center justify-center gap-2">
                            <Loader2 size={14} className="animate-spin text-[#4FD1B5]" />
                            <span>Loading tree...</span>
                        </div>
                    ) : (
                        renderTree(filteredTree, handleFileSelect, selectedFile)
                    )}
                </div>

                {/* Change Set Tray */}
                {changeSet.length > 0 && (
                    changeSet.length > 3 ? (
                        <div className="mt-2 pt-2 border-t border-white/[0.08] shrink-0">
                            <div className="flex items-center justify-between gap-1.5 px-2 py-1 rounded bg-white/[0.03] border border-white/[0.06] text-xs font-mono">
                                <span className="text-[11px] text-[#8A918C] flex items-center gap-1.5 truncate">
                                    <Layers size={12} className="text-[#4FD1B5] shrink-0" />
                                    <span className="truncate">Change set ({changeSet.length})</span>
                                </span>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <button
                                        onClick={handleAnalyzeChangeSet}
                                        disabled={changeSetLoading || !graph}
                                        className="px-2 py-0.5 rounded text-[10px] font-medium bg-[#4FD1B5] text-[#04100D] hover:bg-[#3fbfa3] disabled:opacity-50 cursor-pointer transition-colors"
                                    >
                                        {changeSetLoading ? 'Analyzing...' : 'Analyze'}
                                    </button>
                                    <button
                                        onClick={clearChangeSet}
                                        className="text-[#8A918C] hover:text-red-400 p-0.5 cursor-pointer transition-colors"
                                        title="Clear change set"
                                    >
                                        <X size={11} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="mt-2 pt-2 border-t border-white/[0.08] shrink-0 flex flex-col gap-1.5">
                            <div className="flex items-center justify-between px-1">
                                <span className="text-[11px] font-medium text-[#8A918C] flex items-center gap-1.5">
                                    <Layers size={12} className="text-[#4FD1B5]" />
                                    <span>Change set ({changeSet.length})</span>
                                </span>
                                <button
                                    onClick={clearChangeSet}
                                    className="text-[10px] text-[#8A918C] hover:text-[#E8EAE6] cursor-pointer"
                                    title="Clear change set"
                                >
                                    Clear
                                </button>
                            </div>
                            <div className="max-h-24 overflow-y-auto scrollbar-custom space-y-1 pr-1">
                                {changeSet.map((path) => (
                                    <div
                                        key={path}
                                        className="flex items-center justify-between px-2 py-0.5 rounded bg-white/[0.03] border border-white/[0.06] text-[11px] font-mono group"
                                    >
                                        <span
                                            onClick={() => handleFileSelect(path)}
                                            className="truncate text-[#E8EAE6] hover:text-[#4FD1B5] cursor-pointer flex-1"
                                            title={path}
                                        >
                                            {path.split('/').pop()}
                                        </span>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                removeFromChangeSet(path);
                                            }}
                                            className="text-[#8A918C] hover:text-red-400 p-0.5 rounded cursor-pointer transition-colors shrink-0 ml-1"
                                            title="Remove file"
                                        >
                                            <X size={11} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                            <button
                                onClick={handleAnalyzeChangeSet}
                                disabled={changeSetLoading || !graph}
                                className="w-full py-1.5 px-3 rounded-lg text-xs font-medium font-mono bg-[#4FD1B5] text-[#04100D] hover:bg-[#3fbfa3] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 cursor-pointer transition-colors shadow-sm"
                            >
                                {changeSetLoading ? (
                                    <>
                                        <Loader2 size={12} className="animate-spin" />
                                        <span>Analyzing...</span>
                                    </>
                                ) : (
                                    <span>Analyze change set</span>
                                )}
                            </button>
                        </div>
                    )
                )}
            </div>
        </div>
    );
}
