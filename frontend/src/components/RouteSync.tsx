import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppStore } from '../store';
import { saveSessionSnapshot, loadSessionSnapshot } from '../session-snapshot';

export function RouteSync() {
    const {
        repoUrl,
        selectedSha,
        selectedFile,
        activeTab,
        changeSet,
        setRepoUrl,
        setSelectedSha,
        setSelectedFile,
        setActiveTab,
        setHistoryIndices,
        getAskAiState,
    } = useAppStore();

    const location = useLocation();
    const navigate = useNavigate();

    const historyIdxRef = useRef<number>(0);
    const maxIdxRef = useRef<number>(0);

    const isPopstateRestoring = useRef<boolean>(false);
    const lastPushedUrl = useRef<string>('');
    const hasInitializedOnLoad = useRef<boolean>(false);

    const getCanonicalUrl = (url: string, sha: string | null, file: string | null, tab: string) => {
        if (!url) return '/';
        const p = new URLSearchParams();
        p.set('url', url);
        if (sha) p.set('sha', sha);
        if (file) {
            p.set('file', file);
            p.set('tab', tab || 'Impact');
        }
        return `/repo?${p.toString()}`;
    };

    // 1. Initial Load & Popstate setup
    useEffect(() => {
        const stateIdx = window.history?.state?.idx;
        if (typeof stateIdx === 'number') {
            historyIdxRef.current = stateIdx;
            maxIdxRef.current = Math.max(maxIdxRef.current, stateIdx);
        } else {
            historyIdxRef.current = 0;
            maxIdxRef.current = 0;
            try {
                window.history.replaceState({ ...window.history.state, idx: 0 }, '', window.location.href);
            } catch {}
        }
        setHistoryIndices(historyIdxRef.current, maxIdxRef.current);

        const handlePopState = (e: PopStateEvent) => {
            isPopstateRestoring.current = true;

            const nextIdx = typeof e.state?.idx === 'number' ? e.state.idx : Math.max(0, historyIdxRef.current - 1);
            historyIdxRef.current = nextIdx;
            setHistoryIndices(historyIdxRef.current, maxIdxRef.current);

            const params = new URLSearchParams(window.location.search);
            const url = params.get('url') || '';
            const sha = params.get('sha') || null;
            const file = params.get('file') || null;
            const tab = (params.get('tab') as any) || 'Impact';

            lastPushedUrl.current = window.location.pathname + window.location.search;

            if (!url) {
                setRepoUrl('');
                setSelectedFile(null);
                return;
            }

            const state = useAppStore.getState();
            const hasAnalysis = Boolean(
                (state.repoUrl === url && (!sha || state.selectedSha === sha) && state.graph) ||
                (state.repoCache[url]?.shaAnalysis?.[sha || ''])
            );

            if (!hasAnalysis) {
                state.runAnalyze(url, sha, file, tab);
            } else {
                if (state.repoUrl !== url) state.setRepoUrl(url);
                if (sha && state.selectedSha !== sha) state.setSelectedSha(sha);
                if (state.selectedFile !== file) state.setSelectedFile(file);
                if (tab && state.activeTab !== tab) state.setActiveTab(tab);
            }
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [setHistoryIndices, setRepoUrl, setSelectedFile]);

    // 2. On Load URL restoration / Session Snapshot restoration
    useEffect(() => {
        if (hasInitializedOnLoad.current) return;
        hasInitializedOnLoad.current = true;

        const currentUrl = location.pathname + location.search;
        lastPushedUrl.current = currentUrl;

        const params = new URLSearchParams(location.search);
        const urlParam = params.get('url');

        if (urlParam) {
            const shaParam = params.get('sha') || null;
            const fileParam = params.get('file') || null;
            const tabParam = (params.get('tab') as any) || 'Impact';

            const state = useAppStore.getState();
            const hasAnalysis = Boolean(
                (state.repoUrl === urlParam && (!shaParam || state.selectedSha === shaParam) && state.graph) ||
                (state.repoCache[urlParam]?.shaAnalysis?.[shaParam || ''])
            );

            if (!hasAnalysis) {
                state.runAnalyze(urlParam, shaParam, fileParam, tabParam);
            } else {
                if (state.repoUrl !== urlParam) state.setRepoUrl(urlParam);
                if (shaParam && state.selectedSha !== shaParam) state.setSelectedSha(shaParam);
                if (state.selectedFile !== fileParam) state.setSelectedFile(fileParam);
                if (tabParam && state.activeTab !== tabParam) state.setActiveTab(tabParam);
            }
        } else {
            const snapshot = loadSessionSnapshot();
            if (snapshot && snapshot.url) {
                if (snapshot.planFileList && Array.isArray(snapshot.planFileList) && snapshot.planFileList.length > 0) {
                    useAppStore.setState({ changeSet: snapshot.planFileList });
                }
                const targetUrl = getCanonicalUrl(snapshot.url, snapshot.sha, snapshot.selectedFile, snapshot.tab);
                lastPushedUrl.current = targetUrl;
                navigate(targetUrl, { replace: true, state: { idx: historyIdxRef.current } });
                useAppStore.getState().runAnalyze(snapshot.url, snapshot.sha, snapshot.selectedFile, snapshot.tab);
            }
        }
    }, [location.pathname, location.search, navigate]);

    // 3. Store -> URL Sync & History Push
    useEffect(() => {
        if (isPopstateRestoring.current) {
            isPopstateRestoring.current = false;
            return;
        }

        // An empty store must NEVER cause a redirect to "/"
        if (!repoUrl) {
            return;
        }

        const expected = getCanonicalUrl(repoUrl, selectedSha, selectedFile, activeTab);
        const currentUrl = location.pathname + location.search;

        if (expected !== currentUrl && expected !== lastPushedUrl.current) {
            lastPushedUrl.current = expected;
            const nextIdx = historyIdxRef.current + 1;
            historyIdxRef.current = nextIdx;
            maxIdxRef.current = nextIdx;
            setHistoryIndices(nextIdx, maxIdxRef.current);
            navigate(expected, { state: { idx: nextIdx } });
        }
    }, [repoUrl, selectedSha, selectedFile, activeTab, location.pathname, location.search, navigate, setHistoryIndices]);

    // 4. Save Session Snapshot (debounced) on change
    useEffect(() => {
        if (!repoUrl) {
            saveSessionSnapshot(null);
            return;
        }
        const askAi = getAskAiState(repoUrl, selectedSha);
        saveSessionSnapshot({
            url: repoUrl,
            sha: selectedSha,
            selectedFile,
            tab: activeTab,
            mode: askAi?.askMode || 'code',
            activeChatIdByFile: askAi?.activeChatIdByFile || {},
            planFileList: changeSet || []
        });
    }, [repoUrl, selectedSha, selectedFile, activeTab, changeSet, getAskAiState]);

    return null;
}
