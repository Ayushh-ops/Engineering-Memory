import { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import { useAppStore } from '../store';

const LOADING_STEPS = [
    'Cloning repository',
    'Parsing symbols',
    'Linking calls and imports',
    'Building the graph'
];

export function LandingPage() {
    const [url, setUrl] = useState('');
    const [loading, setLoading] = useState(false);
    const [loadingStep, setLoadingStep] = useState(0);
    const [analyzingTarget, setAnalyzingTarget] = useState('');
    const [recent, setRecent] = useState<string[]>([]);
    const { setRepoUrl, setMeta, setCommits } = useAppStore();
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        try {
            const stored = localStorage.getItem('engineering_memory_history');
            if (stored) {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed)) {
                    setRecent(parsed);
                }
            }
        } catch (e) {
            console.error("Failed parsing history:", e);
        }
    }, []);

    // Full-bleed background graph simulation
    useEffect(() => {
        const cv = canvasRef.current;
        if (!cv) return;
        const ctx = cv.getContext('2d');
        if (!ctx) return;

        let animationFrameId: number;
        let W = 0;
        let H = 0;
        const dp = Math.min(window.devicePixelRatio || 1, 2);
        let s = 17;
        let t = 0;
        let lt = performance.now();
        let mx = 0.5;
        let my = 0.5;
        let isVisible = !document.hidden;

        // Random generator with deterministic seed
        function R() {
            s = (s * 16807) % 2147483647;
            return s/2147483647;
        }

        const cnt = 70;
        const N: Array<{ x: number; y: number; p: number; a: number; r: number; k: number }> = [];
        for (let i = 0; i < cnt; i++) {
            N.push({
                x: R(),
                y: R(),
                p: R() * 6.28,
                a: 0.5 + R(),
                r: 1.4 + R() * 2.4,
                k: i % 3
            });
        }

        const E: Array<[number, number]> = [];
        N.forEach((a, i) => {
            const d = N.map((b, j) => [j, (a.x - b.x) ** 2 + (a.y - b.y) ** 2] as [number, number])
                .sort((u, v) => u[1] - v[1]);
            if (d[1]) E.push([i, d[1][0]]);
            if (d[2]) E.push([i, d[2][0]]);
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
                (n.x * 0.88 + 0.06) * W + Math.cos(t * 0.0003 * n.a + n.p) * 12 + (mx - 0.5) * -24 * n.a,
                (n.y * 0.84 + 0.08) * H + Math.sin(t * 0.00027 * n.a + n.p) * 12 + (my - 0.5) * -24 * n.a
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

            // Draw edges
            E.forEach((e) => {
                const a = ps[e[0]];
                const b = ps[e[1]];
                ctx!.globalAlpha = 0.12;
                ctx!.strokeStyle = '#8A918C';
                ctx!.lineWidth = 1;
                ctx!.beginPath();
                ctx!.moveTo(a[0], a[1]);
                ctx!.lineTo(b[0], b[1]);
                ctx!.stroke();
            });

            // Edge pulses
            if (!prefersReducedMotion && Math.random() < 0.03 && P.length < 6) {
                P.push({ e: E[Math.floor(Math.random() * E.length)], u: 0 });
            }
            P = P.filter((q) => {
                q.u += dt / 1800;
                if (q.u > 1) return false;
                const a = ps[q.e[0]];
                const b = ps[q.e[1]];
                ctx!.globalAlpha = 0.75 * Math.sin(q.u * 3.14159);
                ctx!.fillStyle = '#4FD1B5';
                ctx!.beginPath();
                ctx!.arc(a[0] + (b[0] - a[0]) * q.u, a[1] + (b[1] - a[1]) * q.u, 2, 0, 6.28);
                ctx!.fill();
                return true;
            });

            // Draw nodes
            N.forEach((n, i) => {
                const p = ps[i];
                ctx!.globalAlpha = 0.45;
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
        const updated = [newUrl, ...recent.filter(r => r !== newUrl)].slice(0, 8);
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
            <div className="vignette pointer-events-none" />
            <div className="noise-overlay pointer-events-none" />

            {/* Navigation */}
            <header className="relative z-10 flex items-center justify-between w-full max-w-6xl mx-auto">
                <div className="flex items-center gap-3">
                    <span className="w-5 h-5 border-[1.5px] border-[#4FD1B5] rounded-[5px] rotate-45 relative flex items-center justify-center">
                        <span className="w-2 h-2 bg-[#4FD1B5] rounded-[2px]" />
                    </span>
                    <span className="font-semibold text-sm tracking-tight text-[#E8EAE6]">Engineering Memory</span>
                </div>
                <div className="flex items-center gap-6 text-xs text-[#8A918C]">
                    <span className="hover:text-[#E8EAE6] cursor-pointer transition-colors">Docs</span>
                    <span className="hover:text-[#E8EAE6] cursor-pointer transition-colors">Changelog</span>
                </div>
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
                    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-10 items-center">
                        {/* Left Column */}
                        <div className="flex flex-col text-left">
                            <h1 className="text-4xl sm:text-5xl lg:text-[54px] font-semibold leading-[1.04] tracking-[-0.035em] text-[#E8EAE6] mb-4 max-w-xl">
                                Know what breaks before you change it.
                            </h1>
                            <p className="text-[#8A918C] text-sm sm:text-base leading-relaxed max-w-lg mb-7">
                                Paste a GitHub repository. Engineering Memory maps every call, import, and commit, then shows the blast radius of any edit.
                            </p>

                            {/* URL Input Box */}
                            <div className="glass-surface hairline-border rounded-xl p-1.5 flex items-center gap-2 max-w-lg mb-5 shadow-lg">
                                <input
                                    value={url}
                                    onChange={(e) => setUrl(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleAnalyze(url)}
                                    placeholder="https://github.com/owner/repository"
                                    className="mono bg-transparent flex-1 px-3 py-2 text-xs sm:text-sm text-[#E8EAE6] placeholder-[#8A918C] outline-none"
                                />
                                <button
                                    onClick={() => handleAnalyze(url)}
                                    disabled={loading || !url}
                                    className="px-4 py-2 text-xs sm:text-sm font-medium bg-[#4FD1B5] text-[#04100D] rounded-lg hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50"
                                >
                                    Analyze
                                </button>
                            </div>

                            {/* Recent Repositories */}
                            {recent.length > 0 && (
                                <div className="flex flex-col gap-1 max-w-lg mono text-xs text-[#8A918C]">
                                    {recent.slice(0, 3).map((r, i) => (
                                        <div
                                            key={i}
                                            onClick={() => handleAnalyze(r)}
                                            className="flex items-center justify-between py-1 px-2.5 rounded-lg hover:bg-[rgba(255,255,255,0.04)] hover:text-[#E8EAE6] cursor-pointer transition-colors"
                                        >
                                            <span className="truncate">{r.replace('https://github.com/', '')}</span>
                                            <span className="text-[10px] text-[#8A918C] shrink-0 ml-4">recent</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Right Column: Change Preview Card */}
                        <div className="hidden lg:block glass-surface hairline-border rounded-xl p-5 shadow-xl text-left">
                            <h3 className="text-xs font-medium text-[#8A918C] mb-3">
                                Change preview: test_pipeline.py
                            </h3>
                            <div className="text-3xl font-semibold tracking-[-0.03em] leading-none text-[#E8EAE6] mb-1.5">
                                4 files
                            </div>
                            <p className="text-xs text-[#8A918C] mb-3">
                                would be affected, including 2 tests.
                            </p>
                            <div className="h-[5px] rounded-full bg-[rgba(255,255,255,0.08)] overflow-hidden mb-2">
                                <div className="h-full bg-[#E3A04A] rounded-full" style={{ width: '62%' }} />
                            </div>
                            <p className="mono text-[11px] text-[#8A918C]">
                                risk 62 of 100, medium
                            </p>
                        </div>
                    </div>
                )}
            </main>

            {/* Footer 3 Feature Lines */}
            <footer className="relative z-10 w-full max-w-6xl mx-auto pt-4 border-t border-[rgba(255,255,255,0.08)]">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left text-xs text-[#8A918C]">
                    <div>
                        <b className="block font-medium text-[#E8EAE6] mb-0.5">Blast radius</b>
                        See direct and indirect dependents, ranked by risk.
                    </div>
                    <div>
                        <b className="block font-medium text-[#E8EAE6] mb-0.5">History</b>
                        Find the commits and owners behind every hotspot.
                    </div>
                    <div>
                        <b className="block font-medium text-[#E8EAE6] mb-0.5">Ask the repo</b>
                        Questions answered with the files that prove them.
                    </div>
                </div>
            </footer>
        </div>
    );
}
