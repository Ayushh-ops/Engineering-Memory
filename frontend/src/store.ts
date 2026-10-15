import { create } from 'zustand';
import type { RepositoryGraph, RepositoryMetadata, CommitMetadata, ImpactTarget, AskMode, AskScope, AskEvidenceItem, AskUsedContext } from './api';
import { api } from './api';
import { getPathsToAnalyze, isFileInGraph, isCodeFile } from './analyze-helpers';
import { selectRepoStats, type RepoStats } from './graph-helpers';

export interface AttachedImage {
    id: string;
    file?: File;
    name: string;
    mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
    data: string;
    thumbUrl: string;
    size?: number;
}

export interface AskChatMessage {
    role: 'user' | 'assistant';
    content: string;
    images?: Array<{ mime: string; data?: string; thumbUrl: string; name?: string }>;
    followups?: string[];
    evidence?: AskEvidenceItem[];
    usedContext?: AskUsedContext;
    missingData?: string[];
    status?: string;
    error?: any;
    retryAfterSeconds?: number;
    stopped?: boolean;
    isThinking?: boolean;
    truncated?: boolean;
    mode?: 'repo' | 'chat' | 'dev' | 'offtopic';
}

export interface AskChat {
    id: string;
    title: string;
    file: string;
    createdAt: number;
    updatedAt: number;
    messages: AskChatMessage[];
}

export interface RepoAskAiState {
    chats: AskChat[];
    activeChatIdByFile: Record<string, string>;
    activeChatId: string | null;
    chatMessages: AskChatMessage[];
    draftByChat: Record<string, string>;
    scrollPosByChat: Record<string, number>;
    attachedImages: AttachedImage[];
    askMode: AskMode;
    askScope: AskScope;
    isChatExpanded: boolean;
    selectedAnswerIdx: number | null;
    expandedEvidenceOpen: boolean;
    isStreaming: boolean;
    streamingChatId: string | null;
    abortController: AbortController | null;
    accumulatedStreamedText: string;
    aiError: { message: string; raw?: string; status?: number; code?: string; retryAfterSeconds?: number; backendMessage?: string } | null;
    rateLimitCountdown: number;
    continuationState?: { targetMsgIndex: number; prefixContent: string } | null;
}

export const getRepoKey = (url: string, sha: string | null): string => url ? `${url}:${sha || 'HEAD'}` : '__no_repo__';
export const getStorageKey = (url: string, sha: string | null): string | null => url ? `em_ask_chats:${url}:${sha || 'HEAD'}` : null;

const saveTimers: Record<string, any> = {};

export function debouncedSaveToStorage(storageKey: string | null, chats: AskChat[]) {
    if (!storageKey) return;
    if (saveTimers[storageKey]) {
        clearTimeout(saveTimers[storageKey]);
    }
    saveTimers[storageKey] = setTimeout(() => {
        try {
            const cleanChats = chats.slice(0, 50).map(c => ({
                ...c,
                messages: (c.messages || []).filter(m => !m.isThinking).slice(-30).map(m => {
                    if (m.images && m.images.length > 0) {
                        return {
                            ...m,
                            images: m.images.map(img => ({ mime: img.mime, thumbUrl: img.thumbUrl, name: img.name }))
                        };
                    }
                    return m;
                })
            }));
            localStorage.setItem(storageKey, JSON.stringify(cleanChats));
        } catch (e) {
            console.warn('Failed to persist chats to localStorage (quota exceeded?)', e);
        }
    }, 300);
}

export function generateChatTitle(firstUserMsg: AskChatMessage | undefined, selectedFile: string | null): string {
    const firstUserQ = firstUserMsg?.content.trim() || '';
    const hasFirstUserImages = Boolean(firstUserMsg?.images && firstUserMsg.images.length > 0);
    const fileBaseName = selectedFile ? selectedFile.split(/[/\\]/).pop() || 'file' : 'file';
    return firstUserQ
        ? firstUserQ.slice(0, 40)
        : (hasFirstUserImages ? `Image: ${fileBaseName}` : 'New chat');
}

export const createInitialRepoAskAiState = (): RepoAskAiState => ({
    chats: [],
    activeChatIdByFile: {},
    activeChatId: null,
    chatMessages: [],
    draftByChat: {},
    scrollPosByChat: {},
    attachedImages: [],
    askMode: 'auto',
    askScope: 'auto',
    isChatExpanded: false,
    selectedAnswerIdx: null,
    expandedEvidenceOpen: false,
    isStreaming: false,
    streamingChatId: null,
    abortController: null,
    accumulatedStreamedText: '',
    aiError: null,
    rateLimitCountdown: 0,
    continuationState: null,
});

export interface AppState {
    // Repository Input state
    repoUrl: string;
    setRepoUrl: (url: string) => void;

    // Derived metadata and active selection
    meta: RepositoryMetadata | null;
    setMeta: (meta: RepositoryMetadata | null) => void;

    commits: CommitMetadata[];
    setCommits: (commits: CommitMetadata[]) => void;

    selectedSha: string | null;
    setSelectedSha: (sha: string | null) => void;

    // Analysis + Tree
    treeFiles: string[];
    setTreeFiles: (files: string[]) => void;

    graph: RepositoryGraph | null;
    setGraph: (graph: RepositoryGraph | null) => void;

    // UI state
    selectedFile: string | null;
    setSelectedFile: (file: string | null) => void;

    selectedSymbol: { name: string, type: "class" | "function" | "method", path: string } | null;
    setSelectedSymbol: (symbol: { name: string, type: "class" | "function" | "method", path: string } | null) => void;

    activeTab: 'Overview' | 'Graph' | 'Impact' | 'Connections' | 'Code' | 'History' | 'Health' | 'AskAI' | 'ChangeSet';
    setActiveTab: (tab: 'Overview' | 'Graph' | 'Impact' | 'Connections' | 'Code' | 'History' | 'Health' | 'AskAI' | 'ChangeSet') => void;

    mobileNavOpen: boolean;
    setMobileNavOpen: (open: boolean) => void;
    mobileDetailsOpen: boolean;
    setMobileDetailsOpen: (open: boolean) => void;

    codeHighlightLine: number | null;
    codeHighlightEndLine: number | null;
    setCodeHighlightLine: (line: number | null, endLine?: number | null) => void;

    selectedHistoryCommit: any | null;
    setSelectedHistoryCommit: (commit: any | null) => void;

    hoveredGraphNode: string | null;
    setHoveredGraphNode: (idOrPath: string | null) => void;

    // Output from impact analysis
    impactResult: import('./api').ChangeImpactAnalysisResult | null;
    setImpactResult: (r: import('./api').ChangeImpactAnalysisResult | null) => void;

    // AI Citations (evidence chips)
    aiCitations: string[];
    setAiCitations: (citations: string[]) => void;

    // AI Evidence (from last Ask AI answer)
    aiEvidence: import('./api').AskEvidenceItem[];
    setAiEvidence: (evidence: import('./api').AskEvidenceItem[]) => void;
    aiEvidenceTitle?: string | null;
    setAiEvidenceTitle?: (title: string | null) => void;

    // Change Set (in-memory)
    changeSet: string[];
    addToChangeSet: (path: string) => void;
    removeFromChangeSet: (path: string) => void;
    clearChangeSet: () => void;
    changeSetResult: import('./api').BatchImpactResult | null;
    setChangeSetResult: (r: import('./api').BatchImpactResult | null) => void;
    changeSetLoading: boolean;
    setChangeSetLoading: (loading: boolean) => void;

    // Command palette state
    commandPaletteOpen: boolean;
    setCommandPaletteOpen: (open: boolean) => void;
    selectFile: (path: string) => Promise<void>;

    // Cache to prevent redundant fetching
    repoCache: Record<string, {
        meta?: RepositoryMetadata;
        commits?: CommitMetadata[];
        trees?: Record<string, string[]>;
        graphs?: Record<string, RepositoryGraph>;
        shaAnalysis?: Record<string, { graph: RepositoryGraph; stats: RepoStats }>;
    }>;
    cacheShaAnalysis: (url: string, sha: string, graph: RepositoryGraph, stats: RepoStats) => void;

    // Centralized analyze flow
    isAnalyzing: boolean;
    analyzingTarget: string;
    analyzeStep: number;
    analyzePercent: number | null;
    analysisError: { title: string; message: string; code?: string } | null;
    isTimedOut: boolean;
    lastTargetUrl: string;
    abortController: AbortController | null;
    runAnalyze: (url: string, targetSha?: string | null, targetFile?: string | null, targetTab?: string | null) => Promise<boolean>;
    cancelAnalyze: () => void;
    setAnalysisError: (err: { title: string; message: string; code?: string } | null) => void;

    // Custom History Navigation
    historyIdx: number;
    historyMaxIdx: number;
    canBack: boolean;
    canForward: boolean;
    setHistoryIndices: (idx: number, maxIdx: number) => void;
    history: { url: string, sha: string | null, file: string | null, tab: string }[];
    historyIndex: number;
    pushHistory: (snap: { url: string, sha: string | null, file: string | null, tab: string }) => void;
    goBack: () => void;
    goForward: () => void;
    canGoBack: () => boolean;
    canGoForward: () => boolean;
    clearHistory: () => void;

    // Ask AI state keyed by repoKey
    askAiByRepo: Record<string, RepoAskAiState>;
    getAskAiState: (url?: string, sha?: string | null) => RepoAskAiState;
    loadAskAiChatsFromStorage: (url: string, sha: string | null, selectedFile: string | null) => void;
    switchAskAiFile: (file: string | null) => void;
    setActiveAskAiChat: (chatId: string | null, file?: string | null) => void;
    setAskAiMessages: (messages: AskChatMessage[]) => void;
    saveAskAiMessages: (messages: AskChatMessage[]) => void;
    setAskAiDraft: (chatId: string, text: string) => void;
    setAskAiScrollPos: (chatId: string, pos: number) => void;
    setAskAiAttachedImages: (images: AttachedImage[]) => void;
    setAskAiMode: (mode: AskMode) => void;
    setAskAiScope: (scope: AskScope) => void;
    setAskAiChatExpanded: (expanded: boolean) => void;
    setAskAiSelectedAnswerIdx: (idx: number | null) => void;
    setAskAiExpandedEvidenceOpen: (open: boolean) => void;
    setAskAiError: (error: any) => void;
    setAskAiRateLimitCountdown: (count: number) => void;
    startAskAiStreaming: (chatId: string, controller: AbortController, initialMessages: AskChatMessage[], continuation?: { targetMsgIndex: number; prefixContent: string } | null) => void;
    appendAskAiStreamingToken: (token: string) => void;
    finishAskAiStreaming: (result: { answer?: string; followUps?: string[]; evidence?: any[]; usedContext?: any; missingData?: string[]; status?: string; error?: any; retryAfterSeconds?: number; truncated?: boolean }) => void;
    handleAskAiStreamError: (error: any) => void;
    stopAskAiStreaming: () => void;
    newAskAiChat: (file?: string | null) => string;
    deleteAskAiChat: (chatId: string) => void;
    renameAskAiChat: (chatId: string, title: string) => void;
    clearAskAiMessages: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
    repoUrl: '',
    setRepoUrl: (url) => set({ repoUrl: url }),

    meta: null,
    setMeta: (meta) => set({ meta }),

    commits: [],
    setCommits: (commits) => set({ commits }),

    selectedSha: null,
    setSelectedSha: (sha) => set({ selectedSha: sha }),

    treeFiles: [],
    setTreeFiles: (files) => set({ treeFiles: files }),

    graph: null,
    setGraph: (graph) => set({ graph }),

    selectedFile: null,
    setSelectedFile: (file) => set({ selectedFile: file }),

    selectedSymbol: null,
    setSelectedSymbol: (sym) => set({ selectedSymbol: sym }),

    activeTab: 'Impact',
    setActiveTab: (tab) => set({ activeTab: tab, mobileNavOpen: false }),

    mobileNavOpen: false,
    setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
    mobileDetailsOpen: false,
    setMobileDetailsOpen: (open) => set({ mobileDetailsOpen: open }),

    codeHighlightLine: null,
    codeHighlightEndLine: null,
    setCodeHighlightLine: (line, endLine) => set({
        codeHighlightLine: line,
        codeHighlightEndLine: endLine !== undefined ? endLine : line
    }),

    selectedHistoryCommit: null,
    setSelectedHistoryCommit: (commit) => set({ selectedHistoryCommit: commit }),

    hoveredGraphNode: null,
    setHoveredGraphNode: (idOrPath) => set({ hoveredGraphNode: idOrPath }),

    impactResult: null,
    setImpactResult: (r) => set({ impactResult: r }),

    aiCitations: [],
    setAiCitations: (citations) => set((state) => {
        if (state.aiCitations.length === citations.length && state.aiCitations.every((c, i) => c === citations[i])) {
            return state;
        }
        return { aiCitations: citations };
    }),

    aiEvidence: [],
    setAiEvidence: (evidence) => set((state) => {
        if (state.aiEvidence.length === 0 && evidence.length === 0) return state;
        if (state.aiEvidence.length === evidence.length && state.aiEvidence.every((e, i) => e.path === evidence[i].path && e.line === evidence[i].line && e.endLine === evidence[i].endLine)) {
            return state;
        }
        return { aiEvidence: evidence };
    }),
    aiEvidenceTitle: null,
    setAiEvidenceTitle: (title) => set((state) => {
        if (state.aiEvidenceTitle === title) return state;
        return { aiEvidenceTitle: title };
    }),

    changeSet: [],
    addToChangeSet: (path: string) => set((state) => {
        if (!path || state.changeSet.includes(path) || state.changeSet.length >= 20) {
            return state;
        }
        return { changeSet: [...state.changeSet, path] };
    }),
    removeFromChangeSet: (path: string) => set((state) => ({
        changeSet: state.changeSet.filter((p) => p !== path)
    })),
    clearChangeSet: () => set({ changeSet: [], changeSetResult: null }),
    changeSetResult: null,
    setChangeSetResult: (r) => set({ changeSetResult: r }),
    changeSetLoading: false,
    setChangeSetLoading: (loading) => set({ changeSetLoading: loading }),

    commandPaletteOpen: false,
    setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

    selectFile: async (path: string) => {
        const { repoUrl, selectedSha, treeFiles, graph } = get();
        if (!repoUrl || !selectedSha) return;

        set({
            selectedFile: path,
            selectedSymbol: null,
            impactResult: null,
            mobileNavOpen: false,
            mobileDetailsOpen: false,
        });

        const isCode = isCodeFile(path);
        if (!isCode) return;
        if (graph && isFileInGraph(graph, path)) return;

        try {
            const paths = getPathsToAnalyze(treeFiles, path);
            const data = await api.repositories.analyze(repoUrl, selectedSha, paths);
            set({ graph: data.graph });
        } catch (e) {
            console.error("Analysis failed", e);
        }
    },

    repoCache: {},
    cacheShaAnalysis: (url: string, sha: string, graph: RepositoryGraph, stats: RepoStats) => set((state) => {
        const existing = state.repoCache[url] || {};
        return {
            repoCache: {
                ...state.repoCache,
                [url]: {
                    ...existing,
                    shaAnalysis: {
                        ...(existing.shaAnalysis || {}),
                        [sha]: { graph, stats }
                    }
                }
            }
        };
    }),

    // Centralized analyze flow
    isAnalyzing: false,
    analyzingTarget: '',
    analyzeStep: 0,
    analyzePercent: null,
    analysisError: null,
    isTimedOut: false,
    lastTargetUrl: '',
    abortController: null,

    runAnalyze: async (urlToAnalyze: string, targetSha?: string | null, targetFile?: string | null, targetTab?: string | null) => {
        if (!urlToAnalyze) return false;

        const existingCtrl = get().abortController;
        if (existingCtrl) {
            existingCtrl.abort();
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            set({ isTimedOut: true });
        }, 90000);

        set({
            isAnalyzing: true,
            analyzingTarget: urlToAnalyze.replace('https://github.com/', ''),
            analyzeStep: 0,
            analyzePercent: null,
            analysisError: null,
            isTimedOut: false,
            lastTargetUrl: urlToAnalyze,
            abortController: controller
        });

        let receivedProgress = false;
        const stepInterval = setInterval(() => {
            if (!receivedProgress) {
                set((s) => ({ analyzeStep: s.analyzeStep < 3 ? s.analyzeStep + 1 : s.analyzeStep }));
            }
        }, 600);

        const onProgress = (stage: string, percent: number) => {
            receivedProgress = true;
            const LOADING_STEPS = [
                'Cloning repository',
                'Parsing symbols',
                'Linking calls and imports',
                'Building the graph'
            ];
            const stepIdx = LOADING_STEPS.indexOf(stage);
            set({
                analyzePercent: percent,
                analyzeStep: stepIdx !== -1 ? stepIdx : get().analyzeStep
            });
        };

        try {
            const state = get();
            const cache = state.repoCache[urlToAnalyze] || {};

            let meta = cache.meta;
            if (!meta) {
                meta = await api.repositories.getMeta(urlToAnalyze, controller.signal);
                state.repoCache[urlToAnalyze] = { ...state.repoCache[urlToAnalyze], meta };
            }

            let commits = cache.commits;
            if (!commits) {
                const commitData = await api.repositories.getCommits(urlToAnalyze, targetSha || null, undefined, controller.signal);
                commits = commitData.commits;
                state.repoCache[urlToAnalyze] = { ...state.repoCache[urlToAnalyze], commits };
            }

            let headSha = targetSha || null;
            let treeFilesResult: string[] = [];
            if (commits && commits.length > 0) {
                headSha = targetSha || commits[0].sha;
                let cachedTree = cache.trees?.[headSha];
                if (!cachedTree) {
                    const treeRes = await api.repositories.getTree(urlToAnalyze, headSha, controller.signal);
                    cachedTree = treeRes.files;
                    state.repoCache[urlToAnalyze] = {
                        ...(state.repoCache[urlToAnalyze] || {}),
                        trees: { ...(state.repoCache[urlToAnalyze]?.trees || {}), [headSha]: cachedTree }
                    };
                }
                treeFilesResult = cachedTree;

                let fileToAnalyze = targetFile;
                if (!fileToAnalyze) {
                    fileToAnalyze = treeFilesResult.find((f: string) => {
                        const lower = f.toLowerCase();
                        return ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.cpp'].some((ext) => lower.endsWith(ext));
                    }) || null;
                }

                if (fileToAnalyze) {
                    const { getPathsToAnalyze } = await import('./analyze-helpers');
                    const paths = getPathsToAnalyze(treeFilesResult, fileToAnalyze);
                    const cacheKey = paths.slice().sort().join('|');
                    let cachedGraph = state.repoCache[urlToAnalyze]?.graphs?.[cacheKey];
                    if (!cachedGraph) {
                        const data = await api.repositories.analyzeStream(urlToAnalyze, headSha, paths, onProgress, controller.signal);
                        cachedGraph = data.graph;
                        state.repoCache[urlToAnalyze] = {
                            ...(state.repoCache[urlToAnalyze] || {}),
                            graphs: { ...(state.repoCache[urlToAnalyze]?.graphs || {}), [cacheKey]: cachedGraph }
                        };
                    }
                    if (cachedGraph) {
                        set({ graph: cachedGraph });
                        const stats = selectRepoStats({ graph: cachedGraph, treeFiles: treeFilesResult, commits });
                        get().cacheShaAnalysis(urlToAnalyze, headSha, cachedGraph, stats);
                    }
                }
            }

            try {
                const stored = localStorage.getItem('engineering_memory_history');
                const recent = stored ? JSON.parse(stored) : [];
                const updated = [
                    { url: urlToAnalyze, timestamp: Date.now() },
                    ...recent.filter((r: any) => (typeof r === 'string' ? r : r.url) !== urlToAnalyze)
                ].slice(0, 8);
                localStorage.setItem('engineering_memory_history', JSON.stringify(updated));
            } catch (e) {}

            clearInterval(stepInterval);
            clearTimeout(timeoutId);

            set({
                meta: meta || null,
                commits: commits || [],
                selectedSha: headSha,
                treeFiles: treeFilesResult,
                selectedFile: targetFile || null,
                activeTab: (targetTab as any) || 'Impact',
                repoUrl: urlToAnalyze,
                isAnalyzing: false,
                analyzeStep: 3,
                analyzePercent: 100,
                abortController: null,
                analysisError: null
            });

            return true;
        } catch (e: any) {
            clearInterval(stepInterval);
            clearTimeout(timeoutId);

            if (controller.signal.aborted || e?.name === 'AbortError' || e?.message === 'Analysis was cancelled') {
                set({ isAnalyzing: false, abortController: null });
                return false;
            }

            console.error('Failed to analyze repository:', e);

            let errTitle = 'Repository not found';
            let errMsg = 'Repository not found. Check the URL, or it may be private.';
            let errCode = e?.code || 'repo_not_found';

            if (errCode === 'github_rate_limited' || e?.status === 429) {
                errTitle = 'GitHub rate limit reached';
                errMsg = e?.message || 'GitHub rate limit reached. Try again in a few minutes. Adding a GITHUB_TOKEN to .env raises the limit.';
            } else if (errCode === 'github_auth_failed' || e?.status === 401) {
                errTitle = 'Invalid GitHub token';
                errMsg = 'The GitHub token is invalid. Check GITHUB_TOKEN in .env.';
            } else if (errCode === 'github_unreachable' || e?.message?.includes('fetch failed') || e?.name === 'TypeError') {
                errTitle = 'Cannot reach GitHub';
                errMsg = 'Cannot reach GitHub. Check your internet connection.';
            } else if (errCode === 'repo_empty') {
                errTitle = 'Empty repository';
                errMsg = 'No supported source files found in this repository.';
            } else if (e?.message) {
                errMsg = e.message;
            }

            set({
                isAnalyzing: false,
                abortController: null,
                analysisError: {
                    title: errTitle,
                    message: errMsg,
                    code: errCode
                }
            });
            return false;
        }
    },

    cancelAnalyze: () => {
        const ctrl = get().abortController;
        if (ctrl) {
            ctrl.abort();
        }
        set({
            isAnalyzing: false,
            isTimedOut: false,
            analysisError: null,
            abortController: null
        });
    },

    setAnalysisError: (err) => set({ analysisError: err }),

    // Custom History Navigation
    historyIdx: 0,
    historyMaxIdx: 0,
    canBack: false,
    canForward: false,
    setHistoryIndices: (idx: number, maxIdx: number) => set({
        historyIdx: idx,
        historyMaxIdx: maxIdx,
        canBack: idx > 0,
        canForward: idx < maxIdx
    }),

    history: [],
    historyIndex: -1,

    pushHistory: (snap) => set((state) => {
        // Avoid pushing exact duplicates
        const currentSnap = state.history[state.historyIndex];
        if (currentSnap && currentSnap.url === snap.url && currentSnap.sha === snap.sha && currentSnap.file === snap.file && currentSnap.tab === snap.tab) {
            return state;
        }

        const newHistory = state.history.slice(0, state.historyIndex + 1);
        newHistory.push(snap);
        return { history: newHistory, historyIndex: newHistory.length - 1 };
    }),

    goBack: () => set((state) => {
        if (state.historyIndex > 0) {
            const nextIdx = state.historyIndex - 1;
            const snap = state.history[nextIdx];
            return {
                historyIndex: nextIdx,
                repoUrl: snap.url,
                selectedSha: snap.sha,
                selectedFile: snap.file,
                activeTab: snap.tab as any,
                selectedSymbol: null,
                impactResult: null
            };
        }
        return state;
    }),

    goForward: () => set((state) => {
        if (state.historyIndex < state.history.length - 1) {
            const nextIdx = state.historyIndex + 1;
            const snap = state.history[nextIdx];
            return {
                historyIndex: nextIdx,
                repoUrl: snap.url,
                selectedSha: snap.sha,
                selectedFile: snap.file,
                activeTab: snap.tab as any,
                selectedSymbol: null,
                impactResult: null
            };
        }
        return state;
    }),

    canGoBack: () => {
        return get().historyIdx > 0;
    },

    canGoForward: () => {
        return get().historyIdx < get().historyMaxIdx;
    },

    clearHistory: () => set({ history: [], historyIndex: -1, historyIdx: 0, historyMaxIdx: 0, canBack: false, canForward: false }),

    // Ask AI state & methods
    askAiByRepo: {},

    getAskAiState: (url, sha) => {
        const targetUrl = url !== undefined ? url : get().repoUrl;
        const targetSha = sha !== undefined ? sha : get().selectedSha;
        const repoKey = getRepoKey(targetUrl, targetSha);
        return get().askAiByRepo[repoKey] || createInitialRepoAskAiState();
    },

    loadAskAiChatsFromStorage: (url, sha, selectedFile) => {
        const repoKey = getRepoKey(url, sha);
        const storageKey = getStorageKey(url, sha);
        if (!storageKey) return;

        const currentRepo = get().askAiByRepo[repoKey];
        if (currentRepo && currentRepo.chats.length > 0) {
            if (selectedFile) {
                get().switchAskAiFile(selectedFile);
            }
            return;
        }

        try {
            const raw = localStorage.getItem(storageKey);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    const loadedChats: AskChat[] = parsed.slice(0, 50);
                    const prev = currentRepo || createInitialRepoAskAiState();
                    let activeId: string | null = null;
                    let activeMessages: AskChatMessage[] = [];
                    const activeByFile: Record<string, string> = { ...prev.activeChatIdByFile };

                    if (selectedFile) {
                        const remembered = activeByFile[selectedFile] ? loadedChats.find(c => c.id === activeByFile[selectedFile] && c.file === selectedFile) : null;
                        const match = remembered || loadedChats.find(c => c.file === selectedFile);
                        if (match) {
                            activeId = match.id;
                            activeMessages = match.messages?.slice(-30) || [];
                            activeByFile[selectedFile] = match.id;
                        } else {
                            activeId = 'chat_' + Date.now();
                            activeMessages = [];
                            activeByFile[selectedFile] = activeId;
                        }
                    } else if (loadedChats[0]) {
                        activeId = loadedChats[0].id;
                        activeMessages = loadedChats[0].messages?.slice(-30) || [];
                        if (loadedChats[0].file) {
                            activeByFile[loadedChats[0].file] = activeId;
                        }
                    }

                    set((state) => ({
                        askAiByRepo: {
                            ...state.askAiByRepo,
                            [repoKey]: {
                                ...prev,
                                chats: loadedChats,
                                activeChatId: activeId,
                                activeChatIdByFile: activeByFile,
                                chatMessages: activeMessages
                            }
                        }
                    }));
                    return;
                }
            }
        } catch (e) {
            console.error('Failed to parse chats from localStorage', e);
        }

        const prev = currentRepo || createInitialRepoAskAiState();
        let initialId: string | null = null;
        const initialByFile: Record<string, string> = { ...prev.activeChatIdByFile };
        if (selectedFile) {
            initialId = 'chat_' + Date.now();
            initialByFile[selectedFile] = initialId;
        }
        set((state) => ({
            askAiByRepo: {
                ...state.askAiByRepo,
                [repoKey]: {
                    ...prev,
                    chats: [],
                    activeChatId: initialId,
                    activeChatIdByFile: initialByFile,
                    chatMessages: []
                }
            }
        }));
    },

    switchAskAiFile: (file) => {
        const { repoUrl, selectedSha, askAiByRepo } = get();
        const repoKey = getRepoKey(repoUrl, selectedSha);
        const prev = askAiByRepo[repoKey] || createInitialRepoAskAiState();
        if (!file) return;

        const cur = prev.chats.find(c => c.id === prev.activeChatId);
        if (cur && cur.file === file) return;

        const rememberedId = prev.activeChatIdByFile[file];
        if (rememberedId) {
            const remembered = prev.chats.find(c => c.id === rememberedId && c.file === file);
            if (remembered) {
                set({
                    askAiByRepo: {
                        ...askAiByRepo,
                        [repoKey]: {
                            ...prev,
                            activeChatId: remembered.id,
                            chatMessages: remembered.messages?.slice(-30) || [],
                            aiError: null
                        }
                    }
                });
                return;
            }
        }

        const matching = prev.chats.find(c => c.file === file);
        if (matching) {
            set({
                askAiByRepo: {
                    ...askAiByRepo,
                    [repoKey]: {
                        ...prev,
                        activeChatId: matching.id,
                        activeChatIdByFile: { ...prev.activeChatIdByFile, [file]: matching.id },
                        chatMessages: matching.messages?.slice(-30) || [],
                        aiError: null
                    }
                }
            });
            return;
        }

        const newId = 'chat_' + Date.now();
        set({
            askAiByRepo: {
                ...askAiByRepo,
                [repoKey]: {
                    ...prev,
                    activeChatId: newId,
                    activeChatIdByFile: { ...prev.activeChatIdByFile, [file]: newId },
                    chatMessages: [],
                    aiError: null
                }
            }
        });
    },

    setActiveAskAiChat: (chatId, file) => {
        const { repoUrl, selectedSha, selectedFile, askAiByRepo } = get();
        const repoKey = getRepoKey(repoUrl, selectedSha);
        const prev = askAiByRepo[repoKey] || createInitialRepoAskAiState();
        const targetFile = file !== undefined ? file : selectedFile;

        if (chatId === prev.activeChatId) return;

        let msgs: AskChatMessage[] = [];
        if (chatId) {
            const found = prev.chats.find(c => c.id === chatId);
            if (found) {
                msgs = found.messages?.slice(-30) || [];
            }
        }

        const updatedByFile = { ...prev.activeChatIdByFile };
        if (targetFile && chatId) {
            updatedByFile[targetFile] = chatId;
        }

        set({
            askAiByRepo: {
                ...askAiByRepo,
                [repoKey]: {
                    ...prev,
                    activeChatId: chatId,
                    activeChatIdByFile: updatedByFile,
                    chatMessages: msgs,
                    aiError: null
                }
            }
        });
    },

    setAskAiMessages: (messages) => {
        const { repoUrl, selectedSha, askAiByRepo } = get();
        const repoKey = getRepoKey(repoUrl, selectedSha);
        const prev = askAiByRepo[repoKey] || createInitialRepoAskAiState();

        set({
            askAiByRepo: {
                ...askAiByRepo,
                [repoKey]: {
                    ...prev,
                    chatMessages: messages
                }
            }
        });
    },

    saveAskAiMessages: (messages) => {
        const { repoUrl, selectedSha, selectedFile, askAiByRepo } = get();
        const repoKey = getRepoKey(repoUrl, selectedSha);
        const storageKey = getStorageKey(repoUrl, selectedSha);
        const prev = askAiByRepo[repoKey] || createInitialRepoAskAiState();

        const cleanMsgs = messages.filter(m => !m.isThinking).slice(-30);
        const chatId = prev.activeChatId || ('chat_' + Date.now());
        let updatedChats = [...prev.chats];
        const existingIdx = updatedChats.findIndex(c => c.id === chatId);
        const now = Date.now();

        if (existingIdx !== -1) {
            const existing = updatedChats[existingIdx];
            const firstUserMsg = cleanMsgs.find(m => m.role === 'user');
            const genTitle = generateChatTitle(firstUserMsg, existing.file || selectedFile);
            const title = (existing.title && existing.title !== 'New chat') ? existing.title : genTitle;
            const updatedChat: AskChat = {
                ...existing,
                title,
                updatedAt: now,
                messages: cleanMsgs
            };
            updatedChats = [updatedChat, ...updatedChats.filter((_, i) => i !== existingIdx)];
        } else {
            const firstUserMsg = cleanMsgs.find(m => m.role === 'user');
            const genTitle = generateChatTitle(firstUserMsg, selectedFile);
            const newChat: AskChat = {
                id: chatId,
                title: genTitle,
                file: selectedFile || '',
                createdAt: now,
                updatedAt: now,
                messages: cleanMsgs
            };
            updatedChats = [newChat, ...updatedChats];
        }

        const updatedActiveByFile = { ...prev.activeChatIdByFile };
        if (selectedFile) {
            updatedActiveByFile[selectedFile] = chatId;
        }

        set({
            askAiByRepo: {
                ...askAiByRepo,
                [repoKey]: {
                    ...prev,
                    activeChatId: chatId,
                    activeChatIdByFile: updatedActiveByFile,
                    chatMessages: messages,
                    chats: updatedChats.slice(0, 50)
                }
            }
        });

        debouncedSaveToStorage(storageKey, updatedChats);
    },

    setAskAiDraft: (chatId, text) => {
        const { repoUrl, selectedSha, askAiByRepo } = get();
        const repoKey = getRepoKey(repoUrl, selectedSha);
        const prev = askAiByRepo[repoKey] || createInitialRepoAskAiState();

        set({
            askAiByRepo: {
                ...askAiByRepo,
                [repoKey]: {
                    ...prev,
                    draftByChat: {
                        ...prev.draftByChat,
                        [chatId]: text
                    }
                }
            }
        });
    },

    setAskAiScrollPos: (chatId, pos) => {
        const { repoUrl, selectedSha, askAiByRepo } = get();
        const repoKey = getRepoKey(repoUrl, selectedSha);
        const prev = askAiByRepo[repoKey] || createInitialRepoAskAiState();

        set({
            askAiByRepo: {
                ...askAiByRepo,
                [repoKey]: {
                    ...prev,
                    scrollPosByChat: {
                        ...prev.scrollPosByChat,
                        [chatId]: pos
                    }
                }
            }
        });
    },

    setAskAiAttachedImages: (images) => {
        const { repoUrl, selectedSha, askAiByRepo } = get();
        const repoKey = getRepoKey(repoUrl, selectedSha);
        const prev = askAiByRepo[repoKey] || createInitialRepoAskAiState();

        set({
            askAiByRepo: {
                ...askAiByRepo,
                [repoKey]: {
                    ...prev,
                    attachedImages: images
                }
            }
        });
    },

    setAskAiMode: (mode) => {
        const { repoUrl, selectedSha, askAiByRepo } = get();
        const repoKey = getRepoKey(repoUrl, selectedSha);
        const prev = askAiByRepo[repoKey] || createInitialRepoAskAiState();

        set({
            askAiByRepo: {
                ...askAiByRepo,
                [repoKey]: {
                    ...prev,
                    askMode: mode
                }
            }
        });
    },

    setAskAiScope: (scope) => {
        const { repoUrl, selectedSha, askAiByRepo } = get();
        const repoKey = getRepoKey(repoUrl, selectedSha);
        const prev = askAiByRepo[repoKey] || createInitialRepoAskAiState();

        set({
            askAiByRepo: {
                ...askAiByRepo,
                [repoKey]: {
                    ...prev,
                    askScope: scope
                }
            }
        });
    },

    setAskAiChatExpanded: (expanded) => {
        const { repoUrl, selectedSha, askAiByRepo } = get();
        const repoKey = getRepoKey(repoUrl, selectedSha);
        const prev = askAiByRepo[repoKey] || createInitialRepoAskAiState();

        set({
            askAiByRepo: {
                ...askAiByRepo,
                [repoKey]: {
                    ...prev,
                    isChatExpanded: expanded
                }
            }
        });
    },

    setAskAiSelectedAnswerIdx: (idx) => {
        const { repoUrl, selectedSha, askAiByRepo } = get();
        const repoKey = getRepoKey(repoUrl, selectedSha);
        const prev = askAiByRepo[repoKey] || createInitialRepoAskAiState();

        set({
            askAiByRepo: {
                ...askAiByRepo,
                [repoKey]: {
                    ...prev,
                    selectedAnswerIdx: idx
                }
            }
        });
    },

    setAskAiExpandedEvidenceOpen: (open) => {
        const { repoUrl, selectedSha, askAiByRepo } = get();
        const repoKey = getRepoKey(repoUrl, selectedSha);
        const prev = askAiByRepo[repoKey] || createInitialRepoAskAiState();

        set({
            askAiByRepo: {
                ...askAiByRepo,
                [repoKey]: {
                    ...prev,
                    expandedEvidenceOpen: open
                }
            }
        });
    },

    setAskAiError: (error) => {
        const { repoUrl, selectedSha, askAiByRepo } = get();
        const repoKey = getRepoKey(repoUrl, selectedSha);
        const prev = askAiByRepo[repoKey] || createInitialRepoAskAiState();

        set({
            askAiByRepo: {
                ...askAiByRepo,
                [repoKey]: {
                    ...prev,
                    aiError: error
                }
            }
        });
    },

    setAskAiRateLimitCountdown: (count) => {
        const { repoUrl, selectedSha, askAiByRepo } = get();
        const repoKey = getRepoKey(repoUrl, selectedSha);
        const prev = askAiByRepo[repoKey] || createInitialRepoAskAiState();

        set({
            askAiByRepo: {
                ...askAiByRepo,
                [repoKey]: {
                    ...prev,
                    rateLimitCountdown: count
                }
            }
        });
    },

    startAskAiStreaming: (chatId, controller, initialMessages, continuation) => {
        const { repoUrl, selectedSha, askAiByRepo } = get();
        const repoKey = getRepoKey(repoUrl, selectedSha);
        const prev = askAiByRepo[repoKey] || createInitialRepoAskAiState();

        set({
            askAiByRepo: {
                ...askAiByRepo,
                [repoKey]: {
                    ...prev,
                    isStreaming: true,
                    streamingChatId: chatId,
                    abortController: controller,
                    accumulatedStreamedText: '',
                    chatMessages: initialMessages,
                    continuationState: continuation || null,
                    aiError: null
                }
            }
        });
    },

    appendAskAiStreamingToken: (token) => {
        const { repoUrl, selectedSha, askAiByRepo } = get();
        const repoKey = getRepoKey(repoUrl, selectedSha);
        const prev = askAiByRepo[repoKey];
        if (!prev) return;

        const newAccumulated = prev.accumulatedStreamedText + token;
        const msgs = [...prev.chatMessages];

        if (prev.continuationState) {
            const targetIdx = prev.continuationState.targetMsgIndex;
            if (targetIdx >= 0 && targetIdx < msgs.length) {
                msgs[targetIdx] = {
                    ...msgs[targetIdx],
                    role: 'assistant',
                    content: prev.continuationState.prefixContent + newAccumulated,
                    isThinking: false,
                    truncated: false
                };
            }
        } else {
            const lastIdx = msgs.length - 1;
            if (lastIdx >= 0 && msgs[lastIdx].role === 'assistant') {
                msgs[lastIdx] = {
                    ...msgs[lastIdx],
                    role: 'assistant',
                    content: newAccumulated,
                    isThinking: false
                };
            }
        }

        set({
            askAiByRepo: {
                ...askAiByRepo,
                [repoKey]: {
                    ...prev,
                    accumulatedStreamedText: newAccumulated,
                    chatMessages: msgs
                }
            }
        });
    },

    finishAskAiStreaming: (result) => {
        const { repoUrl, selectedSha, selectedFile, askAiByRepo } = get();
        const repoKey = getRepoKey(repoUrl, selectedSha);
        const storageKey = getStorageKey(repoUrl, selectedSha);
        const prev = askAiByRepo[repoKey];
        if (!prev) return;

        let newMsgs: AskChatMessage[];
        if (prev.continuationState) {
            const targetIdx = prev.continuationState.targetMsgIndex;
            const fullContent = prev.continuationState.prefixContent + (result.answer || prev.accumulatedStreamedText);
            const msgs = [...prev.chatMessages];
            if (targetIdx >= 0 && targetIdx < msgs.length) {
                msgs[targetIdx] = {
                    ...msgs[targetIdx],
                    content: fullContent,
                    followups: result.followUps ?? msgs[targetIdx].followups,
                    evidence: (result.evidence && result.evidence.length > 0) ? result.evidence : msgs[targetIdx].evidence,
                    usedContext: result.usedContext ?? msgs[targetIdx].usedContext,
                    missingData: result.missingData ?? msgs[targetIdx].missingData,
                    status: result.status,
                    error: result.error,
                    retryAfterSeconds: result.retryAfterSeconds,
                    truncated: result.truncated === true,
                    isThinking: false,
                    mode: (result as any).mode || msgs[targetIdx].mode
                };
            }
            newMsgs = msgs;
        } else {
            const msgs = [...prev.chatMessages];
            newMsgs = [
                ...msgs.slice(0, -1),
                {
                    role: 'assistant' as const,
                    content: result.answer || prev.accumulatedStreamedText,
                    followups: result.followUps,
                    evidence: result.evidence,
                    usedContext: result.usedContext,
                    missingData: result.missingData,
                    status: result.status,
                    error: result.error,
                    retryAfterSeconds: result.retryAfterSeconds,
                    truncated: result.truncated === true,
                    mode: (result as any).mode
                }
            ];
        }

        const chatId = prev.streamingChatId || prev.activeChatId;
        let updatedChats = [...prev.chats];
        const existingIdx = updatedChats.findIndex(c => c.id === chatId);
        const now = Date.now();
        const cleanMsgs = newMsgs.filter(m => !m.isThinking).slice(-30);

        if (existingIdx !== -1) {
            const existing = updatedChats[existingIdx];
            const firstUserMsg = cleanMsgs.find(m => m.role === 'user');
            const genTitle = generateChatTitle(firstUserMsg, existing.file || selectedFile);
            const title = (existing.title && existing.title !== 'New chat') ? existing.title : genTitle;
            const updatedChat: AskChat = {
                ...existing,
                title,
                updatedAt: now,
                messages: cleanMsgs
            };
            updatedChats = [updatedChat, ...updatedChats.filter((_, i) => i !== existingIdx)];
        } else if (chatId) {
            const firstUserMsg = cleanMsgs.find(m => m.role === 'user');
            const genTitle = generateChatTitle(firstUserMsg, selectedFile);
            const newChat: AskChat = {
                id: chatId,
                title: genTitle,
                file: selectedFile || '',
                createdAt: now,
                updatedAt: now,
                messages: cleanMsgs
            };
            updatedChats = [newChat, ...updatedChats];
        }

        set({
            askAiByRepo: {
                ...askAiByRepo,
                [repoKey]: {
                    ...prev,
                    isStreaming: false,
                    streamingChatId: null,
                    abortController: null,
                    continuationState: null,
                    chatMessages: newMsgs,
                    chats: updatedChats
                }
            }
        });

        debouncedSaveToStorage(storageKey, updatedChats);
    },

    handleAskAiStreamError: (err) => {
        const { repoUrl, selectedSha, askAiByRepo } = get();
        const repoKey = getRepoKey(repoUrl, selectedSha);
        const storageKey = getStorageKey(repoUrl, selectedSha);
        const prev = askAiByRepo[repoKey];
        if (!prev) return;

        const msgs = prev.chatMessages.filter(m => !m.isThinking);
        const chatId = prev.streamingChatId || prev.activeChatId;
        let updatedChats = [...prev.chats];
        const existingIdx = updatedChats.findIndex(c => c.id === chatId);
        const now = Date.now();

        if (existingIdx !== -1) {
            updatedChats = [
                { ...updatedChats[existingIdx], updatedAt: now, messages: msgs.slice(-30) },
                ...updatedChats.filter((_, i) => i !== existingIdx)
            ];
        }

        set({
            askAiByRepo: {
                ...askAiByRepo,
                [repoKey]: {
                    ...prev,
                    isStreaming: false,
                    streamingChatId: null,
                    abortController: null,
                    continuationState: null,
                    chatMessages: msgs,
                    chats: updatedChats,
                    aiError: err
                }
            }
        });

        debouncedSaveToStorage(storageKey, updatedChats);
    },

    stopAskAiStreaming: () => {
        const { repoUrl, selectedSha, askAiByRepo } = get();
        const repoKey = getRepoKey(repoUrl, selectedSha);
        const storageKey = getStorageKey(repoUrl, selectedSha);
        const prev = askAiByRepo[repoKey];
        if (!prev) return;

        if (prev.abortController) {
            prev.abortController.abort();
        }

        const msgs = [...prev.chatMessages];
        const lastIdx = msgs.length - 1;
        if (lastIdx >= 0 && msgs[lastIdx].role === 'assistant') {
            msgs[lastIdx] = {
                ...msgs[lastIdx],
                isThinking: false,
                stopped: true
            };
        }

        const chatId = prev.streamingChatId || prev.activeChatId;
        let updatedChats = [...prev.chats];
        const existingIdx = updatedChats.findIndex(c => c.id === chatId);
        if (existingIdx !== -1) {
            updatedChats = [
                { ...updatedChats[existingIdx], updatedAt: Date.now(), messages: msgs.filter(m => !m.isThinking).slice(-30) },
                ...updatedChats.filter((_, i) => i !== existingIdx)
            ];
        }

        set({
            askAiByRepo: {
                ...askAiByRepo,
                [repoKey]: {
                    ...prev,
                    isStreaming: false,
                    streamingChatId: null,
                    abortController: null,
                    continuationState: null,
                    chatMessages: msgs,
                    chats: updatedChats
                }
            }
        });

        debouncedSaveToStorage(storageKey, updatedChats);
    },

    newAskAiChat: (file) => {
        const { repoUrl, selectedSha, selectedFile, askAiByRepo } = get();
        const targetFile = file !== undefined ? file : selectedFile;
        const repoKey = getRepoKey(repoUrl, selectedSha);
        const prev = askAiByRepo[repoKey] || createInitialRepoAskAiState();

        if (prev.abortController) {
            prev.abortController.abort();
        }

        const newId = 'chat_' + Date.now();
        set({
            askAiByRepo: {
                ...askAiByRepo,
                [repoKey]: {
                    ...prev,
                    isStreaming: false,
                    streamingChatId: null,
                    abortController: null,
                    activeChatId: newId,
                    activeChatIdByFile: targetFile ? { ...prev.activeChatIdByFile, [targetFile]: newId } : prev.activeChatIdByFile,
                    chatMessages: [],
                    aiError: null,
                    attachedImages: []
                }
            }
        });
        return newId;
    },

    deleteAskAiChat: (chatId) => {
        const { repoUrl, selectedSha, selectedFile, askAiByRepo } = get();
        const repoKey = getRepoKey(repoUrl, selectedSha);
        const storageKey = getStorageKey(repoUrl, selectedSha);
        const prev = askAiByRepo[repoKey];
        if (!prev) return;

        if (prev.streamingChatId === chatId && prev.abortController) {
            prev.abortController.abort();
        }

        const remainingChats = prev.chats.filter(c => c.id !== chatId);
        let newActiveId = prev.activeChatId;
        let newMessages = prev.chatMessages;

        if (prev.activeChatId === chatId) {
            const nextForFile = selectedFile ? remainingChats.find(c => c.file === selectedFile) : remainingChats[0];
            if (nextForFile) {
                newActiveId = nextForFile.id;
                newMessages = nextForFile.messages || [];
            } else {
                newActiveId = 'chat_' + Date.now();
                newMessages = [];
            }
        }

        const updatedActiveByFile = { ...prev.activeChatIdByFile };
        if (selectedFile && newActiveId) {
            updatedActiveByFile[selectedFile] = newActiveId;
        }

        set({
            askAiByRepo: {
                ...askAiByRepo,
                [repoKey]: {
                    ...prev,
                    chats: remainingChats,
                    activeChatId: newActiveId,
                    activeChatIdByFile: updatedActiveByFile,
                    chatMessages: newMessages,
                    isStreaming: prev.streamingChatId === chatId ? false : prev.isStreaming,
                    streamingChatId: prev.streamingChatId === chatId ? null : prev.streamingChatId,
                    abortController: prev.streamingChatId === chatId ? null : prev.abortController
                }
            }
        });

        debouncedSaveToStorage(storageKey, remainingChats);
    },

    renameAskAiChat: (chatId, title) => {
        const { repoUrl, selectedSha, askAiByRepo } = get();
        const repoKey = getRepoKey(repoUrl, selectedSha);
        const storageKey = getStorageKey(repoUrl, selectedSha);
        const prev = askAiByRepo[repoKey];
        if (!prev) return;

        const trimmed = title.trim().slice(0, 40);
        if (!trimmed) return;

        const updatedChats = prev.chats.map(c => c.id === chatId ? { ...c, title: trimmed, updatedAt: Date.now() } : c);
        set({
            askAiByRepo: {
                ...askAiByRepo,
                [repoKey]: {
                    ...prev,
                    chats: updatedChats
                }
            }
        });

        debouncedSaveToStorage(storageKey, updatedChats);
    },

    clearAskAiMessages: () => {
        const { repoUrl, selectedSha, askAiByRepo } = get();
        const repoKey = getRepoKey(repoUrl, selectedSha);
        const storageKey = getStorageKey(repoUrl, selectedSha);
        const prev = askAiByRepo[repoKey];
        if (!prev) return;

        const currentId = prev.activeChatId;
        let updatedChats = prev.chats;
        if (currentId) {
            updatedChats = prev.chats.map(c => c.id === currentId ? { ...c, messages: [], updatedAt: Date.now() } : c);
        }

        set({
            askAiByRepo: {
                ...askAiByRepo,
                [repoKey]: {
                    ...prev,
                    chatMessages: [],
                    chats: updatedChats,
                    aiError: null
                }
            }
        });

        debouncedSaveToStorage(storageKey, updatedChats);
    }
}));
