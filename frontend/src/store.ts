import { create } from 'zustand';
import type { RepositoryGraph, RepositoryMetadata, CommitMetadata, ImpactTarget } from './api';

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

    activeTab: 'Overview' | 'Impact' | 'Connections' | 'History' | 'AskAI';
    setActiveTab: (tab: 'Overview' | 'Impact' | 'Connections' | 'History' | 'AskAI') => void;

    // Output from impact analysis
    impactResult: import('./api').ChangeImpactAnalysisResult | null;
    setImpactResult: (r: import('./api').ChangeImpactAnalysisResult | null) => void;

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

    impactResult: null,
    setImpactResult: (r) => set({ impactResult: r }),

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
