import { create } from 'zustand';
import type { RepositoryGraph, RepositoryMetadata, CommitMetadata, ImpactTarget } from './api';
import { api } from './api';
import { getPathsToAnalyze, isFileInGraph, isCodeFile } from './analyze-helpers';

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

    codeHighlightLine: number | null;
    setCodeHighlightLine: (line: number | null) => void;

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
    repoCache: Record<string, { meta?: RepositoryMetadata, commits?: CommitMetadata[], trees?: Record<string, string[]>, graphs?: Record<string, RepositoryGraph> }>;

    // Custom History Navigation
    history: { url: string, sha: string | null, file: string | null, tab: string }[];
    historyIndex: number;
    pushHistory: (snap: { url: string, sha: string | null, file: string | null, tab: string }) => void;
    goBack: () => void;
    goForward: () => void;
    canGoBack: () => boolean;
    canGoForward: () => boolean;
    clearHistory: () => void;
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
    setActiveTab: (tab) => set({ activeTab: tab }),

    codeHighlightLine: null,
    setCodeHighlightLine: (line) => set({ codeHighlightLine: line }),

    selectedHistoryCommit: null,
    setSelectedHistoryCommit: (commit) => set({ selectedHistoryCommit: commit }),

    hoveredGraphNode: null,
    setHoveredGraphNode: (idOrPath) => set({ hoveredGraphNode: idOrPath }),

    impactResult: null,
    setImpactResult: (r) => set({ impactResult: r }),

    aiCitations: [],
    setAiCitations: (citations) => set({ aiCitations: citations }),

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
        return get().historyIndex > 0;
    },

    canGoForward: () => {
        return get().historyIndex < get().history.length - 1;
    },

    clearHistory: () => set({ history: [], historyIndex: -1 })
}));
