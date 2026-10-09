import { useState } from 'react';
import { useAppStore } from '../store';
import { api } from '../api';
import { GitBranch, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../ui';
import { useNavigate } from 'react-router-dom';

export function TopBar() {
    const {
        repoUrl,
        setRepoUrl,
        setMeta,
        setCommits,
        setSelectedSha,
        setSelectedFile,
        setSelectedSymbol,
        setImpactResult,
        setGraph,
        setTreeFiles,
        history,
        historyIndex,
        goBack,
        goForward,
        setCommandPaletteOpen
    } = useAppStore();
    const [inputVal, setInputVal] = useState(repoUrl);
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    const canBack = historyIndex > 0;
    const canForward = historyIndex < history.length - 1;

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
        navigate('/');
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

            let headSha = null;
            let treeFilesResult: string[] = [];
            if (commits && commits.length > 0) {
                headSha = commits[0].sha;
                let cachedTree = cache.trees?.[headSha];
                if (!cachedTree) {
                    const treeRes = await api.repositories.getTree(inputVal, headSha);
                    cachedTree = treeRes.files;
                    state.repoCache[inputVal] = { ...state.repoCache[inputVal], trees: { ...(state.repoCache[inputVal]?.trees || {}), [headSha]: cachedTree } };
                }
                treeFilesResult = cachedTree;
            }

            setMeta(meta!);
            setCommits(commits);
            if (headSha) useAppStore.getState().setSelectedSha(headSha);
            if (treeFilesResult.length > 0) useAppStore.getState().setTreeFiles(treeFilesResult);

            setRepoUrl(inputVal);
        } catch (e: any) {
            console.error("Failed to fetch repo", e);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="h-12 border-b border-white/[0.08] flex items-center justify-between px-3 bg-[#07090A] select-none relative z-50 gap-3">
            {/* 1. Back and forward 32px filled buttons, then wordmark */}
            <div className="flex items-center gap-3 shrink-0">
                <div className="flex items-center gap-1.5">
                    <button
                        onClick={goBack}
                        disabled={!canBack}
                        className={cn(
                            "w-8 h-8 rounded-lg flex items-center justify-center transition-colors border",
                            canBack
                                ? "bg-[#15302A] border-[#2F6B5E] text-[#4FD1B5] hover:bg-[#1D4038] hover:border-[#4FD1B5] cursor-pointer"
                                : "bg-[#171D1E] border-white/[0.04] text-[#8A918C]/40 cursor-not-allowed"
                        )}
                        title="Back"
                    >
                        <ChevronLeft size={16} />
                    </button>
                    <button
                        onClick={goForward}
                        disabled={!canForward}
                        className={cn(
                            "w-8 h-8 rounded-lg flex items-center justify-center transition-colors border",
                            canForward
                                ? "bg-[#15302A] border-[#2F6B5E] text-[#4FD1B5] hover:bg-[#1D4038] hover:border-[#4FD1B5] cursor-pointer"
                                : "bg-[#171D1E] border-white/[0.04] text-[#8A918C]/40 cursor-not-allowed"
                        )}
                        title="Forward"
                    >
                        <ChevronRight size={16} />
                    </button>
                </div>

                <div
                    className="flex items-center gap-2 cursor-pointer hover:opacity-85 transition-opacity shrink-0"
                    onClick={handleHomeClick}
                >
                    <span className="w-4 h-4 border border-[#4FD1B5] rotate-45 rounded-[3px] relative flex items-center justify-center shrink-0">
                        <span className="w-1.5 h-1.5 bg-[#4FD1B5] rounded-[1px]" />
                    </span>
                    <span className="font-semibold text-xs tracking-tight text-[#E8EAE6] whitespace-nowrap">
                        Engineering Memory
                    </span>
                </div>
            </div>

            {/* 2. URL pill (mono, truncated) + Analyze (accent bg, on-accent text) */}
            <div className="flex-1 flex items-center justify-center max-w-xl mx-2 min-w-0">
                <div className="flex items-center gap-2 w-full">
                    <div className="relative flex-1 flex items-center bg-white/[0.03] border border-white/[0.08] rounded-full px-3 py-1 focus-within:border-[#4FD1B5]/50 transition-colors min-w-0">
                        <GitBranch className="text-[#8A918C] mr-2 shrink-0" size={13} />
                        <input
                            value={inputVal}
                            onChange={(e) => setInputVal(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
                            className="w-full bg-transparent text-xs font-mono text-[#E8EAE6] focus:outline-none placeholder:text-[#8A918C]/60 truncate"
                            placeholder="https://github.com/owner/repo"
                        />
                        {inputVal && (
                            <button
                                onClick={() => setInputVal('')}
                                className="text-[#8A918C] hover:text-[#E8EAE6] cursor-pointer ml-1 shrink-0"
                                title="Clear URL"
                            >
                                <X size={12} />
                            </button>
                        )}
                    </div>
                    <button
                        onClick={handleAnalyze}
                        disabled={loading || !inputVal}
                        className="px-3.5 py-1 text-xs font-medium bg-[#4FD1B5] text-[#04100D] rounded-full hover:brightness-110 active:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer whitespace-nowrap shrink-0 shadow-sm"
                    >
                        {loading ? 'Analyzing...' : 'Analyze'}
                    </button>
                </div>
            </div>

            {/* 3. "Search files" button with "Ctrl K" hint chip, Home */}
            <div className="flex items-center gap-2 text-xs shrink-0">
                <button
                    onClick={() => setCommandPaletteOpen(true)}
                    className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-white/[0.03] border border-white/[0.08] text-[#8A918C] hover:text-[#E8EAE6] hover:bg-white/[0.06] transition-colors cursor-pointer text-xs shrink-0"
                    title="Search files (Ctrl+K)"
                >
                    <span>Search files</span>
                    <kbd className="font-mono text-[10px] text-[#8A918C] bg-white/[0.06] px-1.5 py-0.5 rounded border border-white/[0.08]">
                        Ctrl K
                    </kbd>
                </button>
                <button
                    onClick={handleHomeClick}
                    className="text-[#8A918C] hover:text-[#E8EAE6] text-xs transition-colors cursor-pointer px-2.5 py-1 rounded-lg hover:bg-white/[0.04] shrink-0"
                >
                    Home
                </button>
            </div>
        </div>
    );
}
