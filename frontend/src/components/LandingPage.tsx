import { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import { useAppStore } from '../store';

const LOADING_STEPS = [
    'Cloning repository',
    'Parsing symbols',
    'Linking calls and imports',
    'Building the graph'
];

interface RecentItem {
    url: string;
    timestamp?: number;
}

function formatRecentTime(ts?: number): string {
    if (!ts) return '';
    const diffSec = Math.floor((Date.now() - ts) / 1000);
    if (diffSec < 60) return 'just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    return `${Math.floor(diffDays / 30)}mo ago`;
}

function isValidGitHubUrl(input: string): boolean {
    try {
        const u = new URL(input.trim());
        if (u.hostname !== 'github.com') return false;
        const parts = u.pathname.split('/').filter(Boolean);
        return parts.length >= 2;
    } catch {
        return false;
    }
}

export function LandingPage() {
    const [url, setUrl] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [loadingStep, setLoadingStep] = useState(0);
    const [analyzingTarget, setAnalyzingTarget] = useState('');
    const [recent, setRecent] = useState<RecentItem[]>([]);
    const { setRepoUrl, setMeta, setCommits } = useAppStore();
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        try {
            const stored = localStorage.getItem('engineering_memory_history');
            if (stored) {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed)) {
                    setRecent(
                        parsed.map((item: any) =>
                            typeof item === 'string' ? { url: item } : item
                        )
                    );
                }
            }
        } catch (e) {
            console.error("Failed parsing history:", e);
        }
    }, []);

    // Full-bleed background graph simulation: 75 connected nodes with pulses
    useEffect(() => {
        const cv = canvasRef.current;
        if (!cv) return;
        const ctx = cv.getContext('2d');
        if (!ctx) return;

        let animationFrameId: number;
        let W = 0;
        let H = 0;
        const dp = Math.min(window.devicePixelRatio || 1, 2);
        let s = 19;
        let t = 0;
        let lt = performance.now();
        let mx = 0.5;
        let my = 0.5;
        let isVisible = !document.hidden;

        function R() {
            s = (s * 16807) % 2147483647;
            return s / 2147483647;
        }

        const cnt = 75;
        const N: Array<{ x: number; y: number; p: number; a: number; r: number; k: number }> = [];
        for (let i = 0; i < cnt; i++) {
            N.push({
                x: R(),
                y: R(),
                p: R() * 6.28,
                a: 0.5 + R() * 0.8,
                r: 1.4 + R() * 2.2,
                k: i % 6 === 0 ? 1 : i % 2 === 0 ? 0 : 2 // 0: accent, 1: amber, 2: muted
            });
        }

        // Form a connected network with nearest neighbors
        const E: Array<[number, number]> = [];
        const edgeKeys = new Set<string>();
        N.forEach((a, i) => {
            const d = N.map((b, j) => [j, (a.x - b.x) ** 2 + (a.y - b.y) ** 2] as [number, number])
                .sort((u, v) => u[1] - v[1]);
            for (let step = 1; step <= 3; step++) {
                if (d[step]) {
                    const j = d[step][0];
                    const key = i < j ? `${i}-${j}` : `${j}-${i}`;
                    if (!edgeKeys.has(key)) {
                        edgeKeys.add(key);
                        E.push([i, j]);
                    }
                }
            }
        });

        let P: Array<{ e: [number, number]; u: number }> = [];

        function resize() {
            if (!cv) return;
            W = cv.clientWidth;
            H = cv.clientHeight;
            cv.width = W * dp;
            cv.height = H * dp;
            ctx!.setTransform(dp, 0, 0, dp, 0, 0);
        }
        resize();
        window.addEventListener('resize', resize);

        const onMouseMove = (e: MouseEvent) => {
            if (!cv) return;
            const b = cv.getBoundingClientRect();
            mx = (e.clientX - b.left) / (W || 1);
            my = (e.clientY - b.top) / (H || 1);
        };
        window.addEventListener('mousemove', onMouseMove);

        const onVisibilityChange = () => {
            isVisible = !document.hidden;
        };
        document.addEventListener('visibilitychange', onVisibilityChange);

        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        function pos(n: typeof N[0]) {
            if (prefersReducedMotion) {
                return [(n.x * 0.88 + 0.06) * W, (n.y * 0.84 + 0.08) * H];
            }
            return [
                (n.x * 0.88 + 0.06) * W + Math.cos(t * 0.00025 * n.a + n.p) * 14 + (mx - 0.5) * -26 * n.a,
                (n.y * 0.84 + 0.08) * H + Math.sin(t * 0.00022 * n.a + n.p) * 14 + (my - 0.5) * -26 * n.a
            ];
        }

        const col = ['#4FD1B5', '#E3A04A', '#8A918C'];

        function frame(ts: number) {
            if (!isVisible) {
                animationFrameId = requestAnimationFrame(frame);
                return;
            }
            const dt = ts - lt;
            lt = ts;
            t = ts;

            if (cv!.clientWidth !== W || cv!.clientHeight !== H) resize();
            ctx!.clearRect(0, 0, W, H);

            const ps = N.map(pos);

            // Draw network edges
            ctx!.globalAlpha = 0.12;
            ctx!.strokeStyle = '#8A918C';
            ctx!.lineWidth = 1;
            ctx!.beginPath();
            E.forEach((e) => {
                const a = ps[e[0]];
                const b = ps[e[1]];
                ctx!.moveTo(a[0], a[1]);
                ctx!.lineTo(b[0], b[1]);
            });
            ctx!.stroke();

            // Edge pulses
            if (!prefersReducedMotion && Math.random() < 0.04 && P.length < 8) {
                P.push({ e: E[Math.floor(Math.random() * E.length)], u: 0 });
            }
            P = P.filter((q) => {
                q.u += dt / 1600;
                if (q.u > 1) return false;
                const a = ps[q.e[0]];
                const b = ps[q.e[1]];
                ctx!.globalAlpha = 0.8 * Math.sin(q.u * 3.14159);
                ctx!.fillStyle = '#4FD1B5';
                ctx!.beginPath();
                ctx!.arc(a[0] + (b[0] - a[0]) * q.u, a[1] + (b[1] - a[1]) * q.u, 2, 0, 6.28);
                ctx!.fill();
                return true;
            });

            // Draw nodes
            N.forEach((n, i) => {
                const p = ps[i];
                ctx!.globalAlpha = n.k === 1 ? 0.65 : 0.45;
                ctx!.fillStyle = col[n.k];
                ctx!.beginPath();
                ctx!.arc(p[0], p[1], n.r, 0, 6.28);
                ctx!.fill();
            });

            ctx!.globalAlpha = 1;
            animationFrameId = requestAnimationFrame(frame);
        }

        animationFrameId = requestAnimationFrame(frame);

        return () => {
            window.removeEventListener('resize', resize);
            window.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('visibilitychange', onVisibilityChange);
            cancelAnimationFrame(animationFrameId);
        };
    }, []);

    const saveRecent = (newUrl: string) => {
        const item: RecentItem = { url: newUrl, timestamp: Date.now() };
        const updated = [item, ...recent.filter(r => r.url !== newUrl)].slice(0, 5);
        setRecent(updated);
        try {
            localStorage.setItem('engineering_memory_history', JSON.stringify(updated));
        } catch (e) {
            console.error("Failed saving history:", e);
        }
    };

    const removeRecent = (urlToRemove: string) => {
        const updated = recent.filter(r => r.url !== urlToRemove);
        setRecent(updated);
        try {
            localStorage.setItem('engineering_memory_history', JSON.stringify(updated));
        } catch (e) {
            console.error("Failed saving history:", e);
        }
    };

    const handleAnalyze = async (repoUrlToAnalyze: string) => {
        if (!repoUrlToAnalyze) return;
        setAnalyzingTarget(repoUrlToAnalyze.replace('https://github.com/', ''));
        setLoading(true);
        setLoadingStep(0);

        // Step progression timer for UX feedback
        const stepInterval = setInterval(() => {
            setLoadingStep(prev => (prev < 3 ? prev + 1 : prev));
        }, 600);

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
                    state.repoCache[repoUrlToAnalyze] = {
                        ...(state.repoCache[repoUrlToAnalyze] || {}),
                        trees: { ...(state.repoCache[repoUrlToAnalyze]?.trees || {}), [headSha]: cachedTree }
                    };
                }
                treeFilesResult = cachedTree;
            }

            // Sync synchronously to state
            saveRecent(repoUrlToAnalyze);
            setMeta(meta!);
            setCommits(commits);
            if (headSha) useAppStore.getState().setSelectedSha(headSha);
            if (treeFilesResult.length > 0) useAppStore.getState().setTreeFiles(treeFilesResult);

            clearInterval(stepInterval);
            setLoadingStep(3);

            setTimeout(() => {
                setRepoUrl(repoUrlToAnalyze);
            }, 300);
        } catch (e: any) {
            console.error("Failed to fetch repo", e);
            clearInterval(stepInterval);
            setLoading(false);
        }
    };

    return (
        <div className="relative w-full h-screen overflow-hidden bg-[#07090A] text-[#E8EAE6] flex flex-col justify-between p-6 sm:p-10 select-none">
            {/* Background canvas */}
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
            
            {/* Soft dark vignette behind left text */}
            <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_20%_48%,rgba(7,9,10,0.95)_0%,rgba(7,9,10,0.72)_48%,transparent_80%)]" />
            <div className="vignette pointer-events-none" />
            <div className="noise-overlay pointer-events-none" />

            {/* Navigation: logo and GitHub link icon */}
            <header className="relative z-10 flex items-center justify-between w-full max-w-6xl mx-auto">
                <div className="flex items-center gap-3">
                    <span className="w-5 h-5 border-[1.5px] border-[#4FD1B5] rounded-[5px] rotate-45 relative flex items-center justify-center">
                        <span className="w-2 h-2 bg-[#4FD1B5] rounded-[2px]" />
                    </span>
                    <span className="font-semibold text-sm tracking-tight text-[#E8EAE6]">Engineering Memory</span>
                </div>
                <a
                    href="https://github.com/Ayushh-ops/Engineering-Memory"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#8A918C] hover:text-[#E8EAE6] transition-colors"
                    aria-label="GitHub repository"
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                    </svg>
                </a>
            </header>

            {/* Main Hero & Content or Loading Modal */}
            <main className="relative z-10 w-full max-w-6xl mx-auto my-auto py-8">
                {loading ? (
                    <div className="glass-surface max-w-sm mx-auto p-6 rounded-xl hairline-border shadow-2xl flex flex-col justify-center">
                        <p className="mono text-xs text-[#8A918C] mb-4 truncate">{analyzingTarget || 'Loading repository'}</p>
                        <div className="space-y-2 mb-4">
                            {LOADING_STEPS.map((step, idx) => {
                                const isDone = idx <= loadingStep;
                                return (
                                    <div
                                        key={step}
                                        className={`flex items-center gap-2.5 text-xs transition-colors duration-300 ${
                                            isDone ? 'text-[#E8EAE6]' : 'text-[#8A918C]'
                                        }`}
                                    >
                                        <span
                                            className={`w-2 h-2 rounded-full border transition-all duration-300 ${
                                                isDone ? 'bg-[#4FD1B5] border-[#4FD1B5]' : 'border-[#8A918C]'
                                            }`}
                                        />
                                        <span>{step}</span>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="h-[3px] bg-[rgba(255,255,255,0.08)] rounded-full overflow-hidden">
                            <div
                                className="h-full bg-[#4FD1B5] transition-all duration-500 rounded-full"
                                style={{ width: `${(loadingStep + 1) * 25}%` }}
                            />
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col text-left max-w-2xl">
                        <h1 className="text-4xl sm:text-5xl lg:text-[54px] font-semibold leading-[1.04] tracking-[-0.035em] text-[#E8EAE6] mb-4">
                            Know what breaks before you change it.
                        </h1>
                        <p className="text-[#8A918C] text-sm sm:text-base leading-relaxed max-w-xl mb-7">
                            Paste a GitHub repository. Engineering Memory maps every call, import, and commit, then shows the blast radius of any edit.
                        </p>

                        {/* URL Input Box with focus ring & error line */}
                        <div className="w-full max-w-lg mb-5">
                            <div className={`glass-surface hairline-border rounded-xl p-1.5 flex items-center gap-2 shadow-lg transition-all focus-within:border-[#4FD1B5] focus-within:ring-1 focus-within:ring-[#4FD1B5] ${error ? 'border-red-500/60' : ''}`}>
                                <input
                                    value={url}
                                    onChange={(e) => {
                                        setUrl(e.target.value);
                                        if (error) setError('');
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            if (!isValidGitHubUrl(url)) {
                                                setError('Enter a full GitHub URL, for example https://github.com/owner/repository');
                                                return;
                                            }
                                            handleAnalyze(url.trim());
                                        }
                                    }}
                                    placeholder="https://github.com/owner/repository"
                                    className="mono bg-transparent flex-1 px-3 py-2 text-xs sm:text-sm text-[#E8EAE6] placeholder-[#8A918C] outline-none"
                                />
                                <button
                                    onClick={() => {
                                        if (!isValidGitHubUrl(url)) {
                                            setError('Enter a full GitHub URL, for example https://github.com/owner/repository');
                                            return;
                                        }
                                        handleAnalyze(url.trim());
                                    }}
                                    disabled={loading || !url.trim()}
                                    className="px-4 py-2 text-xs sm:text-sm font-medium bg-[#4FD1B5] text-[#04100D] rounded-lg hover:bg-[#4FD1B5]/90 active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer"
                                >
                                    Analyze
                                </button>
                            </div>
                            {error && (
                                <p className="text-xs text-red-400 mt-2 font-mono">
                                    {error}
                                </p>
                            )}
                        </div>

                        {/* Recent Repositories glass card or Example chips */}
                        {recent.length > 0 ? (
                            <div className="glass-surface hairline-border rounded-xl p-3 max-w-lg text-left">
                                <div className="text-[11px] font-mono text-[#8A918C] uppercase tracking-wider mb-2 px-1">
                                    Recent repositories
                                </div>
                                <div className="space-y-1">
                                    {recent.map((item, idx) => (
                                        <div
                                            key={idx}
                                            onClick={() => {
                                                setUrl(item.url);
                                                setError('');
                                                handleAnalyze(item.url);
                                            }}
                                            className="group flex items-center justify-between py-1.5 px-2.5 rounded-lg border border-transparent hover:border-[#4FD1B5]/20 hover:bg-[#4FD1B5]/[0.04] cursor-pointer transition-all"
                                        >
                                            <span className="mono text-xs text-[#E8EAE6] group-hover:text-[#4FD1B5] truncate transition-colors">
                                                {item.url.replace('https://github.com/', '')}
                                            </span>
                                            <div className="flex items-center gap-2.5 shrink-0 ml-3">
                                                {item.timestamp && (
                                                    <span className="mono text-[10px] text-[#8A918C]">
                                                        {formatRecentTime(item.timestamp)}
                                                    </span>
                                                )}
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        removeRecent(item.url);
                                                    }}
                                                    className="w-4 h-4 rounded flex items-center justify-center text-[#8A918C] hover:text-[#E8EAE6] hover:bg-white/10 transition-colors"
                                                    title="Remove"
                                                >
                                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                        <line x1="18" y1="6" x2="6" y2="18" />
                                                        <line x1="6" y1="6" x2="18" y2="18" />
                                                    </svg>
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 max-w-lg flex-wrap text-left">
                                <span className="text-[11px] text-[#8A918C]">Examples:</span>
                                {['facebook/react', 'vercel/next.js', 'microsoft/vscode'].map((ex) => (
                                    <button
                                        key={ex}
                                        onClick={() => {
                                            const fullUrl = `https://github.com/${ex}`;
                                            setUrl(fullUrl);
                                            setError('');
                                        }}
                                        className="mono text-[11px] px-2.5 py-1 rounded-full border border-white/10 bg-white/[0.02] text-[#8A918C] hover:text-[#4FD1B5] hover:border-[#4FD1B5]/30 hover:bg-[#4FD1B5]/[0.05] transition-all cursor-pointer"
                                    >
                                        {ex}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </main>

            {/* Footer: 3 compact glass cards with icons */}
            <footer className="relative z-10 w-full max-w-6xl mx-auto pt-4 border-t border-[rgba(255,255,255,0.08)]">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-left">
                    <div className="glass-surface hairline-border rounded-xl p-3.5 flex items-start gap-3">
                        <div className="w-7 h-7 rounded-lg bg-[#4FD1B5]/10 border border-[#4FD1B5]/20 flex items-center justify-center shrink-0 text-[#4FD1B5]">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" />
                                <circle cx="12" cy="12" r="6" />
                                <circle cx="12" cy="12" r="2" />
                            </svg>
                        </div>
                        <div>
                            <h4 className="text-xs font-medium text-[#E8EAE6] mb-0.5">Blast radius</h4>
                            <p className="text-[11px] text-[#8A918C] leading-relaxed">See direct and indirect dependents, ranked by risk.</p>
                        </div>
                    </div>

                    <div className="glass-surface hairline-border rounded-xl p-3.5 flex items-start gap-3">
                        <div className="w-7 h-7 rounded-lg bg-[#E3A04A]/10 border border-[#E3A04A]/20 flex items-center justify-center shrink-0 text-[#E3A04A]">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" />
                                <polyline points="12 6 12 12 16 14" />
                            </svg>
                        </div>
                        <div>
                            <h4 className="text-xs font-medium text-[#E8EAE6] mb-0.5">History</h4>
                            <p className="text-[11px] text-[#8A918C] leading-relaxed">Find the commits and owners behind every hotspot.</p>
                        </div>
                    </div>

                    <div className="glass-surface hairline-border rounded-xl p-3.5 flex items-start gap-3">
                        <div className="w-7 h-7 rounded-lg bg-[#4FD1B5]/10 border border-[#4FD1B5]/20 flex items-center justify-center shrink-0 text-[#4FD1B5]">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                            </svg>
                        </div>
                        <div>
                            <h4 className="text-xs font-medium text-[#E8EAE6] mb-0.5">Ask AI</h4>
                            <p className="text-[11px] text-[#8A918C] leading-relaxed">Questions answered with the files that prove them.</p>
                        </div>
                    </div>
                </div>
            </footer>
        </div>
    );
}
