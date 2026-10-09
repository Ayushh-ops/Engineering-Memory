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
    const [loadingPercent, setLoadingPercent] = useState<number | null>(null);
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
            console.error('Failed parsing history:', e);
        }
    }, []);

    // Canvas graph simulation in hero right column
    useEffect(() => {
        const cv = canvasRef.current;
        if (!cv) return;
        const ctx = cv.getContext('2d');
        if (!ctx) return;

        let animationFrameId: number;
        let W = 0;
        let H = 0;
        const dp = Math.min(window.devicePixelRatio || 1, 2);
        let lt = performance.now();
        let t = 0;
        let mx = 0.5;
        let my = 0.5;
        let isVisible = !document.hidden;

        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        // Decorative network only: 50 nodes organized in soft clusters (teal with a few grey and very few amber)
        const nodesData: Array<{ id: number; x: number; y: number; type: 'teal' | 'grey' | 'amber'; r: number; phase: number; speed: number }> = [
            // Cluster 1 (Top Left)
            { id: 0, x: -110, y: -80, type: 'teal', r: 6.5, phase: 0.2, speed: 0.9 },
            { id: 1, x: -145, y: -95, type: 'teal', r: 5.5, phase: 1.1, speed: 1.1 },
            { id: 2, x: -80, y: -105, type: 'grey', r: 4.5, phase: 2.3, speed: 0.8 },
            { id: 3, x: -130, y: -50, type: 'teal', r: 6.0, phase: 3.4, speed: 1.0 },
            { id: 4, x: -85, y: -60, type: 'amber', r: 6.5, phase: 4.2, speed: 0.9 },
            { id: 5, x: -165, y: -70, type: 'grey', r: 4.0, phase: 0.8, speed: 1.2 },
            { id: 6, x: -150, y: -130, type: 'teal', r: 5.0, phase: 1.9, speed: 0.9 },
            { id: 7, x: -95, y: -135, type: 'teal', r: 5.5, phase: 2.8, speed: 1.0 },
            { id: 8, x: -60, y: -85, type: 'teal', r: 5.0, phase: 3.7, speed: 1.1 },
            { id: 9, x: -120, y: -115, type: 'grey', r: 4.5, phase: 5.1, speed: 0.8 },
            { id: 10, x: -175, y: -105, type: 'teal', r: 4.5, phase: 0.4, speed: 1.0 },
            { id: 11, x: -75, y: -35, type: 'teal', r: 5.0, phase: 1.5, speed: 1.1 },

            // Cluster 2 (Top Right)
            { id: 12, x: 110, y: -70, type: 'teal', r: 6.5, phase: 0.6, speed: 0.9 },
            { id: 13, x: 75, y: -95, type: 'teal', r: 5.5, phase: 1.8, speed: 1.0 },
            { id: 14, x: 145, y: -85, type: 'grey', r: 4.5, phase: 2.7, speed: 1.2 },
            { id: 15, x: 90, y: -45, type: 'amber', r: 6.5, phase: 3.5, speed: 0.8 },
            { id: 16, x: 135, y: -40, type: 'teal', r: 5.5, phase: 4.4, speed: 1.1 },
            { id: 17, x: 60, y: -65, type: 'teal', r: 5.0, phase: 5.2, speed: 0.9 },
            { id: 18, x: 165, y: -65, type: 'teal', r: 5.0, phase: 0.9, speed: 1.0 },
            { id: 19, x: 125, y: -115, type: 'grey', r: 4.5, phase: 2.1, speed: 1.1 },
            { id: 20, x: 80, y: -130, type: 'teal', r: 5.0, phase: 3.2, speed: 0.9 },
            { id: 21, x: 175, y: -100, type: 'grey', r: 4.0, phase: 4.0, speed: 1.2 },
            { id: 22, x: 150, y: -10, type: 'teal', r: 5.0, phase: 5.0, speed: 0.9 },
            { id: 23, x: 105, y: -15, type: 'teal', r: 5.5, phase: 0.3, speed: 1.0 },

            // Cluster 3 (Bottom Left)
            { id: 24, x: -70, y: 90, type: 'teal', r: 6.5, phase: 0.7, speed: 1.0 },
            { id: 25, x: -105, y: 70, type: 'teal', r: 5.5, phase: 1.6, speed: 0.9 },
            { id: 26, x: -40, y: 75, type: 'amber', r: 6.5, phase: 2.5, speed: 1.1 },
            { id: 27, x: -95, y: 115, type: 'grey', r: 4.5, phase: 3.6, speed: 0.8 },
            { id: 28, x: -50, y: 125, type: 'teal', r: 5.5, phase: 4.7, speed: 1.0 },
            { id: 29, x: -135, y: 95, type: 'grey', r: 4.0, phase: 5.5, speed: 1.2 },
            { id: 30, x: -80, y: 150, type: 'teal', r: 5.0, phase: 0.5, speed: 0.9 },
            { id: 31, x: -25, y: 110, type: 'teal', r: 5.0, phase: 1.4, speed: 1.1 },
            { id: 32, x: -115, y: 40, type: 'teal', r: 5.0, phase: 2.6, speed: 0.8 },
            { id: 33, x: -35, y: 45, type: 'grey', r: 4.5, phase: 3.9, speed: 1.0 },
            { id: 34, x: -65, y: 170, type: 'teal', r: 4.5, phase: 4.8, speed: 1.1 },
            { id: 35, x: -120, y: 135, type: 'teal', r: 4.5, phase: 0.2, speed: 0.9 },

            // Cluster 4 (Bottom Right)
            { id: 36, x: 100, y: 95, type: 'teal', r: 6.5, phase: 0.8, speed: 0.9 },
            { id: 37, x: 65, y: 75, type: 'teal', r: 5.5, phase: 1.7, speed: 1.1 },
            { id: 38, x: 135, y: 75, type: 'grey', r: 4.5, phase: 2.9, speed: 0.8 },
            { id: 39, x: 80, y: 125, type: 'amber', r: 6.5, phase: 3.8, speed: 1.0 },
            { id: 40, x: 125, y: 120, type: 'teal', r: 5.5, phase: 4.6, speed: 0.9 },
            { id: 41, x: 45, y: 100, type: 'teal', r: 5.0, phase: 5.4, speed: 1.1 },
            { id: 42, x: 155, y: 105, type: 'grey', r: 4.0, phase: 0.4, speed: 1.2 },
            { id: 43, x: 110, y: 155, type: 'teal', r: 5.0, phase: 1.3, speed: 0.8 },
            { id: 44, x: 70, y: 160, type: 'teal', r: 5.0, phase: 2.4, speed: 1.0 },
            { id: 45, x: 145, y: 45, type: 'teal', r: 5.0, phase: 3.3, speed: 1.1 },
            { id: 46, x: 50, y: 50, type: 'grey', r: 4.5, phase: 4.5, speed: 0.9 },
            { id: 47, x: 165, y: 140, type: 'teal', r: 4.5, phase: 5.1, speed: 1.0 },
            { id: 48, x: 20, y: 15, type: 'teal', r: 5.0, phase: 0.9, speed: 0.9 },
            { id: 49, x: -15, y: -20, type: 'teal', r: 5.0, phase: 2.0, speed: 1.0 }
        ];

        // Amber edges highlighting key dependencies
        const amberEdges: Array<[number, number]> = [
            [0, 4],
            [12, 15],
            [24, 26],
            [36, 39]
        ];

        // Regular intra-cluster and bridge edges
        const regularEdges: Array<[number, number]> = [
            // Cluster 1
            [0, 1], [0, 3], [1, 6], [1, 10], [2, 7], [2, 8], [3, 4], [3, 11], [4, 8], [5, 10], [6, 9], [7, 9], [8, 11],
            // Cluster 2
            [12, 13], [12, 16], [13, 17], [13, 20], [14, 18], [14, 19], [15, 16], [15, 23], [16, 22], [17, 20], [18, 21], [19, 20], [22, 23],
            // Cluster 3
            [24, 25], [24, 28], [25, 29], [25, 32], [26, 28], [26, 31], [27, 30], [27, 35], [28, 30], [28, 31], [29, 35], [30, 34], [32, 33],
            // Cluster 4
            [36, 37], [36, 40], [37, 41], [37, 46], [38, 42], [38, 45], [39, 40], [39, 44], [40, 43], [41, 46], [42, 47], [43, 44], [45, 47],
            // Bridges
            [4, 49], [15, 48], [26, 49], [39, 48], [48, 49], [11, 26], [17, 37]
        ];

        const allEdges = [...amberEdges, ...regularEdges];

        // Moving edge pulse packets
        let pulses: Array<{ u: number; edgeIdx: number; isAmber: boolean }> = [
            { u: 0.1, edgeIdx: 0, isAmber: true },
            { u: 0.5, edgeIdx: 1, isAmber: true },
            { u: 0.3, edgeIdx: 4, isAmber: false },
            { u: 0.7, edgeIdx: 12, isAmber: false }
        ];

        function resize() {
            if (!cv) return;
            W = cv.clientWidth || 560;
            H = cv.clientHeight || 520;
            cv.width = W * dp;
            cv.height = H * dp;
            ctx!.setTransform(dp, 0, 0, dp, 0, 0);
        }
        resize();
        window.addEventListener('resize', resize);

        const onMouseMove = (e: MouseEvent) => {
            if (!cv) return;
            const b = cv.getBoundingClientRect();
            mx = (e.clientX - b.left) / (b.width || 1);
            my = (e.clientY - b.top) / (b.height || 1);
        };
        window.addEventListener('mousemove', onMouseMove);

        const onVisibilityChange = () => {
            isVisible = !document.hidden;
            if (isVisible) {
                lt = performance.now();
            }
        };
        document.addEventListener('visibilitychange', onVisibilityChange);

        function renderFrame(timestamp: number) {
            if (!isVisible) {
                animationFrameId = requestAnimationFrame(renderFrame);
                return;
            }

            const dt = Math.min(timestamp - lt, 100);
            lt = timestamp;
            t = timestamp;

            if (cv!.clientWidth !== W || cv!.clientHeight !== H) {
                resize();
            }

            ctx!.clearRect(0, 0, W, H);

            const cx = W / 2;
            const cy = H / 2;
            const scale = Math.min(W / 560, H / 520);

            // Background ambient radial gradient
            const bgGrad = ctx!.createRadialGradient(cx, cy, 0, cx, cy, 250 * scale);
            bgGrad.addColorStop(0, 'rgba(79, 209, 181, 0.12)');
            bgGrad.addColorStop(1, 'rgba(79, 209, 181, 0)');
            ctx!.fillStyle = bgGrad;
            ctx!.beginPath();
            ctx!.arc(cx, cy, 250 * scale, 0, Math.PI * 2);
            ctx!.fill();

            // Calculate computed positions with slow drift & mouse parallax
            const pX = (mx - 0.5) * 22;
            const pY = (my - 0.5) * 22;

            const pos = nodesData.map((node) => {
                if (prefersReducedMotion) {
                    return {
                        x: cx + node.x * scale,
                        y: cy + node.y * scale
                    };
                }
                const driftX = Math.sin(t * 0.0007 * node.speed + node.phase) * 3.5;
                const driftY = Math.cos(t * 0.0006 * node.speed + node.phase) * 3.5;
                return {
                    x: cx + (node.x + driftX) * scale + pX * 0.7,
                    y: cy + (node.y + driftY) * scale + pY * 0.7
                };
            });

            // Draw regular edges
            ctx!.strokeStyle = 'rgba(232, 234, 230, 0.12)';
            ctx!.lineWidth = 1;
            ctx!.setLineDash([]);
            ctx!.beginPath();
            regularEdges.forEach(([src, dst]) => {
                const a = pos[src];
                const b = pos[dst];
                ctx!.moveTo(a.x, a.y);
                ctx!.lineTo(b.x, b.y);
            });
            ctx!.stroke();

            // Draw amber flowing edges
            ctx!.strokeStyle = '#E3A04A';
            ctx!.lineWidth = 1.2;
            if (!prefersReducedMotion) {
                ctx!.setLineDash([4, 6]);
                ctx!.lineDashOffset = -t * 0.025;
            } else {
                ctx!.setLineDash([]);
            }
            ctx!.beginPath();
            amberEdges.forEach(([src, dst]) => {
                const a = pos[src];
                const b = pos[dst];
                ctx!.moveTo(a.x, a.y);
                ctx!.lineTo(b.x, b.y);
            });
            ctx!.stroke();
            ctx!.setLineDash([]);

            // Edge pulse particles
            if (!prefersReducedMotion) {
                if (Math.random() < 0.03 && pulses.length < 8) {
                    pulses.push({
                        u: 0,
                        edgeIdx: Math.floor(Math.random() * allEdges.length),
                        isAmber: Math.random() < 0.25
                    });
                }

                pulses = pulses.filter((p) => {
                    p.u += dt / 1400;
                    if (p.u > 1) return false;
                    const edge = allEdges[p.edgeIdx];
                    if (!edge) return false;
                    const a = pos[edge[0]];
                    const b = pos[edge[1]];
                    const px = a.x + (b.x - a.x) * p.u;
                    const py = a.y + (b.y - a.y) * p.u;
                    const alpha = Math.sin(p.u * Math.PI) * 0.85;

                    ctx!.fillStyle = p.isAmber ? `rgba(227, 160, 74, ${alpha})` : `rgba(79, 209, 181, ${alpha})`;
                    ctx!.beginPath();
                    ctx!.arc(px, py, 2 * scale, 0, Math.PI * 2);
                    ctx!.fill();
                    return true;
                });
            }

            // Draw leaf grey nodes
            nodesData.forEach((node, idx) => {
                if (node.type !== 'grey') return;
                const p = pos[idx];
                ctx!.fillStyle = '#8A918C';
                ctx!.beginPath();
                ctx!.arc(p.x, p.y, node.r * scale, 0, Math.PI * 2);
                ctx!.fill();
            });

            // Draw normal teal nodes
            nodesData.forEach((node, idx) => {
                if (node.type !== 'teal') return;
                const p = pos[idx];
                ctx!.fillStyle = '#4FD1B5';
                ctx!.beginPath();
                ctx!.arc(p.x, p.y, node.r * scale, 0, Math.PI * 2);
                ctx!.fill();
            });

            // Draw risky amber nodes with soft warm glow
            nodesData.forEach((node, idx) => {
                if (node.type !== 'amber') return;
                const p = pos[idx];
                ctx!.save();
                ctx!.shadowBlur = 10 * scale;
                ctx!.shadowColor = 'rgba(227, 160, 74, 0.45)';
                ctx!.fillStyle = '#E3A04A';
                ctx!.beginPath();
                ctx!.arc(p.x, p.y, node.r * scale, 0, Math.PI * 2);
                ctx!.fill();
                ctx!.restore();
            });

            if (!prefersReducedMotion) {
                animationFrameId = requestAnimationFrame(renderFrame);
            }
        };

        if (prefersReducedMotion) {
            renderFrame(0);
        } else {
            animationFrameId = requestAnimationFrame(renderFrame);
        }

        return () => {
            window.removeEventListener('resize', resize);
            window.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('visibilitychange', onVisibilityChange);
            cancelAnimationFrame(animationFrameId);
        };
    }, []);

    const saveRecent = (newUrl: string) => {
        const item: RecentItem = { url: newUrl, timestamp: Date.now() };
        const updated = [item, ...recent.filter((r) => r.url !== newUrl)].slice(0, 5);
        setRecent(updated);
        try {
            localStorage.setItem('engineering_memory_history', JSON.stringify(updated));
        } catch (e) {
            console.error('Failed saving history:', e);
        }
    };

    const removeRecent = (urlToRemove: string) => {
        const updated = recent.filter((r) => r.url !== urlToRemove);
        setRecent(updated);
        try {
            localStorage.setItem('engineering_memory_history', JSON.stringify(updated));
        } catch (e) {
            console.error('Failed saving history:', e);
        }
    };

    const clearAllRecent = () => {
        setRecent([]);
        try {
            localStorage.removeItem('engineering_memory_history');
        } catch (e) {
            console.error('Failed clearing history:', e);
        }
    };

    const handleAnalyze = async (repoUrlToAnalyze: string) => {
        if (!repoUrlToAnalyze) return;
        setAnalyzingTarget(repoUrlToAnalyze.replace('https://github.com/', ''));
        setLoading(true);
        setLoadingStep(0);
        setLoadingPercent(null);

        let receivedProgress = false;
        const stepInterval = setInterval(() => {
            if (!receivedProgress) {
                setLoadingStep((prev) => (prev < 3 ? prev + 1 : prev));
            }
        }, 600);

        const onProgress = (stage: string, percent: number) => {
            receivedProgress = true;
            setLoadingPercent(percent);
            const stepIdx = LOADING_STEPS.indexOf(stage);
            if (stepIdx !== -1) {
                setLoadingStep(stepIdx);
            }
        };

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

                // Pre-analyze root / top code files using real SSE progress
                const firstCodeFile = treeFilesResult.find((f: string) => {
                    const lower = f.toLowerCase();
                    return ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.cpp'].some((ext) => lower.endsWith(ext));
                });
                if (firstCodeFile) {
                    const { getPathsToAnalyze } = await import('../analyze-helpers');
                    const paths = getPathsToAnalyze(treeFilesResult, firstCodeFile);
                    const cacheKey = paths.slice().sort().join('|');
                    let cachedGraph = state.repoCache[repoUrlToAnalyze]?.graphs?.[cacheKey];
                    if (!cachedGraph) {
                        const data = await api.repositories.analyzeStream(repoUrlToAnalyze, headSha, paths, onProgress);
                        cachedGraph = data.graph;
                        state.repoCache[repoUrlToAnalyze] = {
                            ...(state.repoCache[repoUrlToAnalyze] || {}),
                            graphs: { ...(state.repoCache[repoUrlToAnalyze]?.graphs || {}), [cacheKey]: cachedGraph }
                        };
                    }
                    if (cachedGraph) {
                        useAppStore.getState().setGraph(cachedGraph);
                    }
                }
            }

            // Sync synchronously to state
            saveRecent(repoUrlToAnalyze);
            setMeta(meta!);
            setCommits(commits);
            if (headSha) useAppStore.getState().setSelectedSha(headSha);
            if (treeFilesResult.length > 0) useAppStore.getState().setTreeFiles(treeFilesResult);

            clearInterval(stepInterval);
            setLoadingStep(3);
            setLoadingPercent(100);

            setTimeout(() => {
                setRepoUrl(repoUrlToAnalyze);
            }, 300);
        } catch (e: any) {
            console.error('Failed to fetch repo', e);
            clearInterval(stepInterval);
            setLoading(false);
        }
    };

    const handleCtaClick = () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        const inputEl = document.getElementById('repo');
        if (inputEl) {
            inputEl.focus();
        }
    };

    return (
        <div className="relative min-h-screen w-full bg-[#07090A] text-[#E8EAE6] overflow-x-hidden selection:bg-[#4FD1B5]/20 selection:text-[#E8EAE6]">
            {/* Background faint grid pattern */}
            <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:linear-gradient(#000_0,transparent_900px)] -webkit-[mask-image:linear-gradient(#000_0,transparent_900px)]" />

            {/* Ambient soft glow blobs */}
            <div className="absolute -top-[220px] -right-[160px] w-[760px] h-[760px] rounded-full pointer-events-none bg-[radial-gradient(circle,rgba(79,209,181,0.13),transparent_65%)]" />
            <div className="absolute top-[520px] -left-[240px] w-[620px] h-[620px] rounded-full pointer-events-none bg-[radial-gradient(circle,rgba(227,160,74,0.06),transparent_65%)]" />
            <div className="noise-overlay pointer-events-none" />

            <div className="relative z-10 max-w-[1200px] mx-auto px-6 sm:px-8">
                {/* Navbar */}
                <nav className="flex items-center justify-between h-[84px] gap-6 flex-wrap">
                    <div className="flex items-center gap-2.5 font-semibold text-[17px] tracking-[-0.01em] text-[#E8EAE6]">
                        <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
                            <path d="M13 2l11 11-11 11L2 13z" stroke="#4FD1B5" strokeWidth="1.5" />
                            <circle cx="13" cy="13" r="3.2" fill="#4FD1B5" />
                        </svg>
                        <span>Engineering Memory</span>
                    </div>
                    <div className="flex items-center gap-7 text-[14.5px]">
                        <a href="#how" className="text-[#8A918C] hover:text-[#E8EAE6] transition-colors">
                            How it works
                        </a>
                        <a href="#features" className="text-[#8A918C] hover:text-[#E8EAE6] transition-colors">
                            Features
                        </a>
                        <a
                            href="https://github.com/Ayushh-ops/Engineering-Memory"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#8A918C] hover:text-[#E8EAE6] transition-colors flex items-center"
                            aria-label="GitHub repository"
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 .5a11.5 11.5 0 00-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.17 1.18a11 11 0 015.78 0c2.2-1.49 3.17-1.18 3.17-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.83 1.18 3.09 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0012 .5z" />
                            </svg>
                        </a>
                    </div>
                </nav>

                {/* Hero Section */}
                <section className="flex flex-col lg:flex-row items-center gap-8 py-14 lg:py-24">
                    {/* Left Column */}
                    <div className="flex-1 min-w-[300px] w-full max-w-[560px]">
                        {loading ? (
                            <div className="glass-surface max-w-md p-6 rounded-2xl hairline-border shadow-2xl flex flex-col justify-center">
                                <p className="font-mono text-xs text-[#8A918C] mb-4 truncate">{analyzingTarget || 'Loading repository'}</p>
                                <div className="space-y-2.5 mb-5">
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
                                <div className="flex items-center justify-between font-mono text-[11px] text-[#8A918C] mb-1.5">
                                    <span>Progress</span>
                                    <span>{loadingPercent !== null ? `${loadingPercent}%` : `${(loadingStep + 1) * 25}%`}</span>
                                </div>
                                <div className="h-[3px] bg-[rgba(255,255,255,0.08)] rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-[#4FD1B5] transition-all duration-500 rounded-full"
                                        style={{ width: `${loadingPercent !== null ? loadingPercent : (loadingStep + 1) * 25}%` }}
                                    />
                                </div>
                            </div>
                        ) : (
                            <>
                                <div className="inline-flex items-center gap-2 px-3 py-1.5 border border-white/[0.08] rounded-full text-[13px] text-[#8A918C] bg-[rgba(16,20,21,0.66)]">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[#4FD1B5]" />
                                    <span>Code intelligence for GitHub repositories</span>
                                </div>
                                <h1 className="mt-6 text-5xl sm:text-6xl lg:text-[76px] leading-[1] tracking-[-0.035em] font-semibold text-[#E8EAE6]">
                                    Understand your <span className="text-[#E3A04A]">codebase</span>
                                    <br />
                                    before you
                                    <br />
                                    change it.
                                </h1>
                                <p className="mt-6 text-base sm:text-lg text-[#8A918C] leading-[1.55] max-w-[520px]">
                                    Paste a repository. Explore dependencies, history, owners and health, ask questions with file evidence, and see what a change affects.
                                </p>

                                {/* URL Input with Glass Surface */}
                                <div className="mt-9 landing-field flex items-center gap-2 max-w-[560px] p-[7px] pl-[18px] bg-[rgba(16,20,21,0.66)] border border-white/10 rounded-[14px] shadow-[0_18px_40px_rgba(0,0,0,0.35)] transition-all">
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8A918C" strokeWidth="1.7" strokeLinecap="round" className="shrink-0">
                                        <circle cx="6" cy="6" r="2.5" />
                                        <circle cx="6" cy="18" r="2.5" />
                                        <circle cx="18" cy="8" r="2.5" />
                                        <path d="M6 8.5v7M18 10.5c0 4-12 2-12 5.5" />
                                    </svg>
                                    <label htmlFor="repo" className="sr-only">GitHub repository URL</label>
                                    <input
                                        id="repo"
                                        type="text"
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
                                        className="flex-1 min-w-0 bg-transparent border-0 text-[#E8EAE6] font-mono text-sm sm:text-[15px] py-3 focus:outline-none placeholder-[#8A918C]"
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
                                        className="landing-btn shrink-0 bg-[#4FD1B5] text-[#04100D] border-0 rounded-[10px] px-6 py-3 font-semibold text-sm sm:text-[15px] cursor-pointer disabled:opacity-50"
                                    >
                                        Analyze
                                    </button>
                                </div>
                                {error && (
                                    <p className="text-xs text-red-400 mt-2 font-mono">
                                        {error}
                                    </p>
                                )}

                                {/* Recent Repositories Card - Rendered ONLY when real recents exist */}
                                {recent.length > 0 && (
                                    <div className="mt-4 max-w-[560px] border border-white/[0.08] rounded-[14px] bg-[rgba(16,20,21,0.5)] overflow-hidden">
                                        <div className="flex justify-between items-center px-4 py-3 text-xs sm:text-[13px] text-[#8A918C] border-b border-white/[0.06]">
                                            <span>Recent repositories</span>
                                            <button
                                                onClick={clearAllRecent}
                                                className="text-xs sm:text-[13px] text-[#8A918C] hover:text-[#E8EAE6] transition-colors cursor-pointer"
                                            >
                                                Clear all
                                            </button>
                                        </div>
                                        <div className="divide-y divide-white/[0.05]">
                                            {recent.map((item, idx) => (
                                                <div
                                                    key={idx}
                                                    onClick={() => {
                                                        setUrl(item.url);
                                                        setError('');
                                                        handleAnalyze(item.url);
                                                    }}
                                                    className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.04] cursor-pointer transition-colors group"
                                                >
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4FD1B5" strokeWidth="1.7" className="shrink-0">
                                                        <path d="M4 5h16v14H4zM4 9h16" />
                                                    </svg>
                                                    <span className="flex-1 font-mono text-xs sm:text-sm text-[#E8EAE6] group-hover:text-[#4FD1B5] truncate transition-colors">
                                                        {item.url.replace('https://github.com/', '')}
                                                    </span>
                                                    {item.timestamp && (
                                                        <span className="text-xs text-[#8A918C] shrink-0 font-mono">
                                                            {formatRecentTime(item.timestamp)}
                                                        </span>
                                                    )}
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            removeRecent(item.url);
                                                        }}
                                                        aria-label="Remove"
                                                        className="text-[#8A918C] hover:text-[#E8EAE6] cursor-pointer text-base px-1 leading-none transition-colors"
                                                    >
                                                        ×
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {/* Right Column: Canvas Graph */}
                    <div className="flex-1 min-w-[300px] w-full max-w-[560px] flex items-center justify-center">
                        <canvas
                            ref={canvasRef}
                            className="w-full max-w-[560px] aspect-[560/520] block"
                            role="img"
                            aria-label="Interactive decorative dependency network"
                        />
                    </div>
                </section>

                {/* How It Works Section */}
                <section id="how" className="py-10 pb-24 border-t border-white/[0.06]">
                    <div className="text-sm text-[#4FD1B5] font-medium">How it works</div>
                    <h2 className="mt-3 text-3xl sm:text-4xl lg:text-[44px] font-semibold tracking-[-0.025em] text-[#E8EAE6] max-w-[640px] leading-[1.08]">
                        From a repository URL to a risk you can act on.
                    </h2>
                    <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-5">
                        <div className="landing-card p-7 border border-white/[0.08] rounded-[18px] bg-[rgba(16,20,21,0.66)]">
                            <div className="font-mono font-medium text-[13px] text-[#4FD1B5]">01</div>
                            <h3 className="mt-4 mb-2 text-[22px] font-semibold text-[#E8EAE6]">Paste a repository</h3>
                            <p className="text-[15.5px] leading-relaxed text-[#8A918C]">
                                Any public GitHub repo. We clone it, parse the symbols and link every call and import.
                            </p>
                        </div>
                        <div className="landing-card p-7 border border-white/[0.08] rounded-[18px] bg-[rgba(16,20,21,0.66)]">
                            <div className="font-mono font-medium text-[13px] text-[#4FD1B5]">02</div>
                            <h3 className="mt-4 mb-2 text-[22px] font-semibold text-[#E8EAE6]">Pick a file</h3>
                            <p className="text-[15.5px] leading-relaxed text-[#8A918C]">
                                Search with Ctrl K, or add several files to a change set to see their combined impact.
                            </p>
                        </div>
                        <div className="landing-card p-7 border border-white/[0.08] rounded-[18px] bg-[rgba(16,20,21,0.66)]">
                            <div className="font-mono font-medium text-[13px] text-[#E3A04A]">03</div>
                            <h3 className="mt-4 mb-2 text-[22px] font-semibold text-[#E8EAE6]">See what breaks</h3>
                            <p className="text-[15.5px] leading-relaxed text-[#8A918C]">
                                Affected files ranked by risk, the tests to run, and the owners who know the code.
                            </p>
                        </div>
                    </div>
                </section>

                {/* Features Section */}
                <section id="features" className="pb-24">
                    <div className="text-sm text-[#4FD1B5] font-medium">Features</div>
                    <h2 className="mt-3 text-3xl sm:text-4xl lg:text-[44px] font-semibold tracking-[-0.025em] text-[#E8EAE6] max-w-[640px] leading-[1.08]">
                        Everything you need before you merge.
                    </h2>
                    <div className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                        {/* 1. Graph */}
                        <div className="landing-card p-7 border border-white/[0.08] rounded-[18px] bg-[rgba(16,20,21,0.66)]">
                            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#4FD1B5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="6" cy="6" r="2.5" />
                                <circle cx="18" cy="6" r="2.5" />
                                <circle cx="12" cy="18" r="2.5" />
                                <path d="M7.5 7.5l3 8.5M16.5 7.5l-3 8.5M8.5 6h7" />
                            </svg>
                            <h3 className="mt-4 mb-2 text-xl font-semibold text-[#E8EAE6]">Graph</h3>
                            <p className="text-[15px] leading-relaxed text-[#8A918C]">
                                Explore how files connect and follow any dependency.
                            </p>
                        </div>

                        {/* 2. Change sets */}
                        <div className="landing-card p-7 border border-white/[0.08] rounded-[18px] bg-[rgba(16,20,21,0.66)]">
                            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#4FD1B5" strokeWidth="1.5" strokeLinejoin="round">
                                <path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5" transform="translate(0 -2)" />
                            </svg>
                            <h3 className="mt-4 mb-2 text-xl font-semibold text-[#E8EAE6]">Change sets</h3>
                            <p className="text-[15px] leading-relaxed text-[#8A918C]">
                                Select several files and get one combined risk, affected files and tests to run.
                            </p>
                        </div>

                        {/* 3. Code with evidence */}
                        <div className="landing-card p-7 border border-white/[0.08] rounded-[18px] bg-[rgba(16,20,21,0.66)]">
                            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#4FD1B5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />
                            </svg>
                            <h3 className="mt-4 mb-2 text-xl font-semibold text-[#E8EAE6]">Code with evidence</h3>
                            <p className="text-[15px] leading-relaxed text-[#8A918C]">
                                Read the file in place. Every Ask AI answer links to the exact lines that prove it.
                            </p>
                        </div>

                        {/* 4. History and owners */}
                        <div className="landing-card p-7 border border-white/[0.08] rounded-[18px] bg-[rgba(16,20,21,0.66)]">
                            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#E3A04A" strokeWidth="1.5" strokeLinecap="round">
                                <circle cx="12" cy="12" r="9" />
                                <path d="M12 7v5l3 2" />
                            </svg>
                            <h3 className="mt-4 mb-2 text-xl font-semibold text-[#E8EAE6]">History and owners</h3>
                            <p className="text-[15px] leading-relaxed text-[#8A918C]">
                                The commits behind every file and who knows it best, flagged when only one person does.
                            </p>
                        </div>

                        {/* 5. Repository health */}
                        <div className="landing-card p-7 border border-white/[0.08] rounded-[18px] bg-[rgba(16,20,21,0.66)]">
                            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#E3A04A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 21s-8-5-8-11a4.5 4.5 0 018-2.8A4.5 4.5 0 0120 10c0 6-8 11-8 11z" />
                            </svg>
                            <h3 className="mt-4 mb-2 text-xl font-semibold text-[#E8EAE6]">Repository health</h3>
                            <p className="text-[15px] leading-relaxed text-[#8A918C]">
                                Circular imports, unused files and oversized modules found from the dependency graph.
                            </p>
                        </div>

                        {/* 6. Ask AI */}
                        <div className="landing-card p-7 border border-white/[0.08] rounded-[18px] bg-[rgba(16,20,21,0.66)]">
                            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#4FD1B5" strokeWidth="1.5" strokeLinejoin="round">
                                <path d="M4 5h16v11H9l-5 4z" />
                            </svg>
                            <h3 className="mt-4 mb-2 text-xl font-semibold text-[#E8EAE6]">Ask AI</h3>
                            <p className="text-[15px] leading-relaxed text-[#8A918C]">
                                Ask about your code and get answers with file evidence.
                            </p>
                        </div>
                    </div>
                </section>

                {/* Closing CTA */}
                <section className="mb-20 py-16 px-8 text-center border border-white/[0.08] rounded-[24px] bg-[radial-gradient(circle_at_50%_0,rgba(79,209,181,0.12),rgba(16,20,21,0.66)_60%)]">
                    <h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-[-0.03em] text-[#E8EAE6] max-w-[640px] mx-auto leading-[1.05]">
                        Check the next change before it ships.
                    </h2>
                    <p className="mt-4 text-[#8A918C] text-base sm:text-lg max-w-[480px] mx-auto leading-[1.55]">
                        Paste a repository and see how everything connects in a minute.
                    </p>
                    <button
                        onClick={handleCtaClick}
                        className="landing-btn mt-8 bg-[#4FD1B5] text-[#04100D] border-0 rounded-[12px] px-8 py-3.5 font-semibold text-base cursor-pointer"
                    >
                        Analyze a repository
                    </button>
                </section>

                {/* Footer */}
                <footer className="flex justify-between items-center flex-wrap gap-4 py-7 pb-10 border-t border-white/[0.06] text-sm text-[#8A918C]">
                    <span>Engineering Memory</span>
                    <span>Built to answer one question: what breaks if I change this?</span>
                </footer>
            </div>
        </div>
    );
}
