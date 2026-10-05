import { useState } from 'react';
import { useAppStore } from '../store';
import { api } from '../api';
import { GitBranch, X, Play, Share2, Activity, Clock, MessageSquare, Hexagon, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button, cn } from '../ui';
import { useNavigate } from 'react-router-dom';

export function TopBar() {
    const { repoUrl, setRepoUrl, setMeta, setCommits, activeTab, setActiveTab, setSelectedSha, setSelectedFile, setSelectedSymbol, setImpactResult, setGraph, setTreeFiles } = useAppStore();
    const [inputVal, setInputVal] = useState(repoUrl);
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    const handleHomeClick = () => {
        setRepoUrl('');
        setSelectedSha(null);
        setSelectedFile(null);
        setSelectedSymbol(null);
        setImpactResult(null);
        setGraph(null);
        setTreeFiles([]);
        setMeta(null);
        setCommits([]);
        useAppStore.getState().clearHistory();
        navigate('/')
    };

    const handleAnalyze = async () => {
        if (!inputVal) return;
        setLoading(true);
        try {
            console.log("Analyzing repo:", inputVal);
            const state = useAppStore.getState();
            const cache = state.repoCache[inputVal] || {};

            let meta = cache.meta;
            if (!meta) {
                meta = await api.repositories.getMeta(inputVal);
                state.repoCache[inputVal] = { ...state.repoCache[inputVal], meta };
            }
            console.log("getMeta done, meta:", meta);

            try {
                const stored = localStorage.getItem('engineering_memory_history');
                const recent = stored ? JSON.parse(stored) : [];
                const updated = [inputVal, ...recent.filter((r: string) => r !== inputVal)].slice(0, 8);
                localStorage.setItem('engineering_memory_history', JSON.stringify(updated));
            } catch (e) { }

            let commits = cache.commits;
            if (!commits) {
                const commitData = await api.repositories.getCommits(inputVal);
                commits = commitData.commits;
                state.repoCache[inputVal] = { ...state.repoCache[inputVal], commits };
            }
            console.log("getCommits done, commits:", commits?.length);

            let headSha = null;
            let treeFilesResult: string[] = [];
            if (commits && commits.length > 0) {
                headSha = commits[0].sha;
                console.log("sha resolved:", headSha);

                let cachedTree = cache.trees?.[headSha];
                if (!cachedTree) {
                    console.log("getTree called with sha=", headSha);
                    const treeRes = await api.repositories.getTree(inputVal, headSha);
                    cachedTree = treeRes.files;
                    state.repoCache[inputVal] = { ...state.repoCache[inputVal], trees: { ...(state.repoCache[inputVal]?.trees || {}), [headSha]: cachedTree } };
                }
                console.log("getTree resolved with N files =", cachedTree?.length);
                treeFilesResult = cachedTree;
            } else {
                console.log("No commits found");
            }

            setMeta(meta!);
            setCommits(commits);
            if (headSha) useAppStore.getState().setSelectedSha(headSha);
            if (treeFilesResult.length > 0) useAppStore.getState().setTreeFiles(treeFilesResult);

            setRepoUrl(inputVal);
        } catch (e: any) {
            console.error("Failed to fetch repo", e);
            console.error("Error details:", e.message, e.missingData, e.status);
            // real error handling could go here
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="h-12 border-b border-white/10 flex items-center justify-between px-4 bg-[#07090A] select-none">
            <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 cursor-pointer hover:opacity-85 transition-opacity" onClick={handleHomeClick}>
                    <span className="w-4 h-4 border border-[#4FD1B5] rotate-45 rounded-[3px] relative flex items-center justify-center">
                        <span className="w-1.5 h-1.5 bg-[#4FD1B5] rounded-[1px]" />
                    </span>
                    <span className="font-semibold text-xs tracking-tight text-[#E8EAE6]">Engineering Memory</span>
                </div>

                <div className="flex items-center gap-0.5 border-l border-white/10 pl-2.5 ml-1">
                    <button
                        onClick={() => useAppStore.getState().goBack()}
                        disabled={!useAppStore.getState().canGoBack()}
                        className="p-1 rounded text-[#8A918C] hover:text-[#E8EAE6] hover:bg-white/[0.04] disabled:opacity-20 disabled:hover:bg-transparent transition-colors cursor-pointer"
                        title="Back"
                    >
                        <ChevronLeft size={16} />
                    </button>
                    <button
                        onClick={() => useAppStore.getState().goForward()}
                        disabled={!useAppStore.getState().canGoForward()}
                        className="p-1 rounded text-[#8A918C] hover:text-[#E8EAE6] hover:bg-white/[0.04] disabled:opacity-20 disabled:hover:bg-transparent transition-colors cursor-pointer"
                        title="Forward"
                    >
                        <ChevronRight size={16} />
                    </button>
                </div>
            </div>

            <div className="flex-1 flex justify-center px-4 max-w-xl">
                <div className="flex items-center w-full">
                    <div className="relative flex-1 group">
                        <GitBranch className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8A918C]" size={14} />
                        <input
                            value={inputVal}
                            onChange={(e) => setInputVal(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleAnalyze()}
                            className="w-full bg-white/[0.03] border border-white/10 rounded-l-lg py-1.5 pl-8 pr-7 text-xs font-mono text-[#E8EAE6] focus:outline-none focus:border-[#4FD1B5]/50 transition-colors placeholder:text-[#8A918C]/60"
                            placeholder="https://github.com/owner/repo"
                        />
                        {inputVal && (
                            <button onClick={() => setInputVal('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8A918C] hover:text-[#E8EAE6] cursor-pointer">
                                <X size={13} />
                            </button>
                        )}
                    </div>
                    <Button onClick={handleAnalyze} disabled={loading} className="rounded-l-none text-xs py-1.5 px-3 min-w-[76px]">
                        {loading ? 'Analyzing...' : 'Analyze'}
                    </Button>
                </div>
            </div>

            <div className="flex items-center gap-2 text-xs">
                <button
                    onClick={() => useAppStore.getState().setCommandPaletteOpen(true)}
                    className="flex items-center gap-2 px-2.5 py-1 rounded bg-white/[0.03] border border-white/10 text-[#8A918C] hover:text-[#E8EAE6] hover:bg-white/[0.06] transition-colors cursor-pointer"
                    title="Search files (Ctrl+K)"
                >
                    <span>Search files</span>
                    <kbd className="font-mono text-[10px] text-[#8A918C] bg-white/[0.06] px-1.5 py-0.5 rounded border border-white/10">
                        Ctrl K
                    </kbd>
                </button>
                <button
                    onClick={handleHomeClick}
                    className="text-[#8A918C] hover:text-[#E8EAE6] text-xs transition-colors cursor-pointer px-2 py-1 rounded hover:bg-white/[0.04]"
                >
                    Home
                </button>
            </div>
        </div>
    );
}
