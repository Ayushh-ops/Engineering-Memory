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
        <div className="h-14 border-b border-zinc-800 flex items-center justify-between px-4 bg-zinc-950">
            <div className="flex items-center gap-4 flex-1">
                <div className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity" onClick={handleHomeClick}>
                    <div className="w-6 h-6 rounded bg-gradient-to-br from-indigo-500 to-emerald-500 flex items-center justify-center">
                        <Hexagon size={14} className="text-white" />
                    </div>
                    <span className="font-bold text-gray-200 tracking-tight flex items-center gap-2">Engineering Memory</span>
                </div>

                <div className="flex items-center gap-1 border-l border-zinc-800 pl-4 ml-2">
                    <button
                        onClick={() => useAppStore.getState().goBack()}
                        disabled={!useAppStore.getState().canGoBack()}
                        className="p-1 rounded hover:bg-zinc-800 text-zinc-400 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                    >
                        <ChevronLeft size={18} />
                    </button>
                    <button
                        onClick={() => useAppStore.getState().goForward()}
                        disabled={!useAppStore.getState().canGoForward()}
                        className="p-1 rounded hover:bg-zinc-800 text-zinc-400 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                    >
                        <ChevronRight size={18} />
                    </button>
                </div>
            </div>

            <div className="flex-1 flex justify-center">
                <div className="flex items-center w-full max-w-xl">
                    <div className="relative flex-1 group">
                        <GitBranch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-emerald-500" size={16} />
                        <input
                            value={inputVal}
                            onChange={(e) => setInputVal(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleAnalyze()}
                            className="w-full bg-[#121214] border border-zinc-800 rounded-l-md py-1.5 pl-9 pr-8 text-sm focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all placeholder-zinc-600"
                            placeholder="https://github.com/owner/repo"
                        />
                        {inputVal && (
                            <button onClick={() => setInputVal('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
                                <X size={14} />
                            </button>
                        )}
                    </div>
                    <Button onClick={handleAnalyze} disabled={loading} className="rounded-l-none min-w-[100px]">
                        {loading ? '...' : 'Analyze'}
                    </Button>
                </div>
            </div>

            <div className="flex-1 flex justify-end items-center gap-6">

            </div>
        </div>
    );
}
