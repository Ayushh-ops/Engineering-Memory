import { useState, useEffect } from 'react';
import { Network, Search, Command, Activity, Database, KeySquare, Hexagon, ChevronRight } from 'lucide-react';
import { api } from '../api';
import { useAppStore } from '../store';

const QUOTES = [
    { text: "Programs must be written for people to read, and only incidentally for machines to execute.", author: "Harold Abelson" },
    { text: "Any fool can write code that a computer can understand. Good programmers write code that humans can understand.", author: "Martin Fowler" },
    { text: "First, solve the problem. Then, write the code.", author: "John Johnson" },
    { text: "Experience is the name everyone gives to their mistakes.", author: "Oscar Wilde" }
];

export function LandingPage() {
    const [url, setUrl] = useState('');
    const [loading, setLoading] = useState(false);
    const [recent, setRecent] = useState<string[]>([]);
    const [quoteIdx, setQuoteIdx] = useState(Math.floor(Math.random() * QUOTES.length));
    const { setRepoUrl, setMeta, setCommits } = useAppStore();

    useEffect(() => {
        try {
            const stored = localStorage.getItem('engineering_memory_history');
            console.log("LandingPage mount, stored recent:", stored);
            if (stored) {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed)) {
                    setRecent(parsed);
                }
            }
        } catch (e) {
            console.error("Failed parsing history:", e);
        }

        const interval = setInterval(() => {
            setQuoteIdx(prev => (prev + 1) % QUOTES.length);
        }, 8000);
        return () => clearInterval(interval);
    }, []);

    const saveRecent = (newUrl: string) => {
        const updated = [newUrl, ...recent.filter(r => r !== newUrl)].slice(0, 8);
        setRecent(updated);
        try {
            localStorage.setItem('engineering_memory_history', JSON.stringify(updated));
            console.log("Saved recent:", updated);
        } catch (e) {
            console.error("Failed saving history:", e);
        }
    };

    const handleAnalyze = async (repoUrlToAnalyze: string) => {
        if (!repoUrlToAnalyze) return;
        setLoading(true);
        try {
            const state = useAppStore.getState();
            const cache = state.repoCache[repoUrlToAnalyze] || {};

            let meta = cache.meta;
            if (!meta) {
                meta = await api.repositories.getMeta(repoUrlToAnalyze);
                state.repoCache[repoUrlToAnalyze] = { ...state.repoCache[repoUrlToAnalyze], meta };
            }

            let commits = cache.commits;
            if (!commits) {
                const commitData = await api.repositories.getCommits(repoUrlToAnalyze);
                commits = commitData.commits;
                state.repoCache[repoUrlToAnalyze] = { ...state.repoCache[repoUrlToAnalyze], commits };
            }

            let headSha = null;
            let treeFilesResult: string[] = [];
            if (commits && commits.length > 0) {
                headSha = commits[0].sha;
                let cachedTree = cache.trees?.[headSha];
                if (!cachedTree) {
                    const treeRes = await api.repositories.getTree(repoUrlToAnalyze, headSha);
                    cachedTree = treeRes.files;
                    state.repoCache[repoUrlToAnalyze] = { ...state.repoCache[repoUrlToAnalyze], trees: { ...(state.repoCache[repoUrlToAnalyze]?.trees || {}), [headSha]: cachedTree } };
                }
                treeFilesResult = cachedTree;
            }

            // Sync synchronously to state
            saveRecent(repoUrlToAnalyze);
            setMeta(meta!);
            setCommits(commits);
            if (headSha) useAppStore.getState().setSelectedSha(headSha);
            if (treeFilesResult.length > 0) useAppStore.getState().setTreeFiles(treeFilesResult);

            setRepoUrl(repoUrlToAnalyze);
        } catch (e: any) {
            console.error("Failed to fetch repo", e);
        } finally {
            setLoading(false);
        }
    };

    const clearRecent = () => {
        setRecent([]);
        localStorage.removeItem('engineering_memory_history');
    };

    return (
        <div className="flex flex-col lg:flex-row h-screen text-gray-200 bg-[#0a0a0b] relative overflow-hidden">
            {/* Background design elements */}
            <div className="absolute inset-0 z-0 bg-[#0a0a0b]" />
            <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] rounded-full bg-indigo-900/10 blur-[100px] animate-mesh" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-900/10 blur-[80px] animate-mesh" style={{ animationDelay: '-5s' }} />
            <div className="absolute top-[40%] right-[10%] w-[40%] h-[40%] rounded-full bg-blue-900/10 blur-[100px] animate-mesh" style={{ animationDelay: '-10s' }} />
            <svg className="absolute inset-0 z-0 opacity-[0.03] w-full h-full mix-blend-overlay pointer-events-none" xmlns="http://www.w3.org/2000/svg">
                <filter id="noiseFilter">
                    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" stitchTiles="stitch" />
                </filter>
                <rect width="100%" height="100%" filter="url(#noiseFilter)" />
            </svg>

            <div className="relative z-10 flex-1 flex flex-col items-center justify-center p-6 text-center max-w-2xl mx-auto w-full lg:max-w-3xl overflow-y-auto">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-emerald-500 flex items-center justify-center mb-8 shadow-lg shadow-emerald-500/10">
                    <Hexagon size={36} className="text-white" />
                </div>

                <h1 className="text-4xl font-extrabold tracking-tight mb-3">Engineering Memory</h1>
                <p className="text-zinc-400 text-lg mb-12">Analyze semantic blast radius, review history, and chat with your legacy codebase.</p>

                <div className="w-full relative group">
                    <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/20 to-indigo-500/20 blur-xl opacity-50 group-hover:opacity-75 transition duration-500"></div>
                    <div className="relative flex items-center bg-[#121214] border border-zinc-800 rounded-xl overflow-hidden shadow-2xl focus-within:border-zinc-600 focus-within:ring-1 focus-within:ring-indigo-500/50 transition-all">
                        <Search className="absolute left-4 text-zinc-500 group-focus-within:text-emerald-500 transition-colors" size={20} />
                        <input
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleAnalyze(url)}
                            placeholder="https://github.com/owner/repository"
                            className="bg-transparent w-full py-4 pl-12 pr-4 text-base text-gray-100 outline-none placeholder-zinc-600"
                        />
                        <button
                            onClick={() => handleAnalyze(url)}
                            disabled={loading || !url}
                            className="mr-2 px-6 py-2 bg-zinc-900 border border-zinc-700 rounded-lg font-medium text-sm hover:bg-zinc-800 hover:text-white transition-colors disabled:opacity-50"
                        >
                            {loading ? "Analyzing..." : "Analyze"}
                        </button>
                    </div>
                </div>

                <div className="mt-12 w-full h-16 flex items-center justify-center">
                    <p className="text-zinc-500 italic text-sm transition-opacity duration-1000">"{QUOTES[quoteIdx].text}" <br /><span className="text-xs not-italic text-zinc-600 mt-1 block">— {QUOTES[quoteIdx].author}</span></p>
                </div>
            </div>

            {/* RIGHT SIDE (or stacked bottom): Recent Repositories */}
            {recent.length > 0 && (
                <div className="relative z-20 w-full lg:w-[400px] bg-[#0d0d0f]/80 backdrop-blur-md border-t lg:border-t-0 lg:border-l border-zinc-800/80 p-6 flex flex-col shadow-2xl h-auto lg:h-full shrink-0 flex-none overflow-hidden">
                    <div className="flex items-center justify-between mb-6 shrink-0">
                        <div className="flex items-center gap-2">
                            <Activity size={16} className="text-emerald-500" />
                            <h3 className="text-sm font-semibold text-gray-200">Recent Repositories</h3>
                        </div>
                        <button onClick={clearRecent} className="text-[11px] font-medium text-zinc-500 hover:text-zinc-300 transition-colors bg-zinc-800/50 hover:bg-zinc-700 px-2 py-1 rounded">Clear</button>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-3 pb-8 pr-2 custom-scrollbar">
                        {recent.map((r, i) => (
                            <div key={i} onClick={() => handleAnalyze(r)} className="group cursor-pointer flex flex-col p-4 rounded-xl bg-[#121214] border border-zinc-800 hover:border-emerald-500/30 hover:bg-zinc-800/50 transition-all shadow-lg text-left">
                                <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-2 truncate">
                                        <KeySquare size={14} className="text-zinc-500 group-hover:text-emerald-400 transition-colors shrink-0" />
                                        <span className="text-sm font-semibold text-gray-200 truncate group-hover:text-emerald-50 transition-colors">{r.replace('https://github.com/', '')}</span>
                                    </div>
                                    <ChevronRight size={14} className="text-zinc-600 group-hover:text-emerald-400 transition-transform group-hover:translate-x-1 shrink-0" />
                                </div>
                                <div className="text-[11px] text-zinc-500 truncate ml-5">{r}</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
