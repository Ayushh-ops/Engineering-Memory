import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppStore } from '../store';
import { api } from '../api';
import { getPathsToAnalyze, isFileInGraph } from '../analyze-helpers';

export function RouteSync() {
    const { repoUrl, selectedSha, selectedFile, activeTab, setRepoUrl, setSelectedSha, setSelectedFile, setActiveTab } = useAppStore();
    const location = useLocation();
    const navigate = useNavigate();

    const lastUrl = useRef(location.pathname + location.search);
    const lastStore = useRef({ url: repoUrl, sha: selectedSha, file: selectedFile, tab: activeTab });
    const isProgrammaticNav = useRef(false);

    const getExpectedUrl = () => {
        if (!repoUrl) return '/';
        const p = new URLSearchParams();
        p.set('url', repoUrl);
        if (selectedSha) p.set('sha', selectedSha);
        if (selectedFile) {
            p.set('file', selectedFile);
            p.set('tab', activeTab);
        }
        return `/repo?${p.toString()}`;
    };

    // 1. Store -> URL (only triggered when Store values change)
    useEffect(() => {
        const expected = getExpectedUrl();
        const currentUrl = location.pathname + location.search;
        const storeObj = { url: repoUrl, sha: selectedSha, file: selectedFile, tab: activeTab };
        const storeStr = JSON.stringify(storeObj);
        const lastStoreStr = JSON.stringify(lastStore.current);

        if (storeStr !== lastStoreStr) {
            // Direct user action changed the store!
            lastStore.current = storeObj;
            if (expected !== currentUrl) {
                console.log("[RouteSync] Store changed. Pushing URL:", expected);
                isProgrammaticNav.current = true;
                lastUrl.current = expected;
                useAppStore.getState().pushHistory(storeObj);
                navigate(expected); // Push to history
            }
        }
    }, [repoUrl, selectedSha, selectedFile, activeTab, navigate]);

    // 2. URL -> Store (only triggered on native Back/Forward location changes)
    useEffect(() => {
        const currentUrl = location.pathname + location.search;

        if (isProgrammaticNav.current) {
            // If React Router finally updated location to match our programmatic navigate target
            if (currentUrl === lastUrl.current) {
                isProgrammaticNav.current = false;
            }
            return;
        }

        if (currentUrl !== lastUrl.current) {
            console.log("[RouteSync] URL changed natively (Back/Forward). Restoring store to:", currentUrl);
            lastUrl.current = currentUrl;

            const params = new URLSearchParams(location.search);
            const url = params.get('url') || '';
            const sha = params.get('sha') || null;
            const file = params.get('file') || null;
            const tab = (params.get('tab') as any) || 'Impact';

            if (!url) {
                setRepoUrl('');
                setSelectedFile(null);
                lastStore.current = { url: '', sha: null, file: null, tab: 'Impact' };
                return;
            }

            const restore = async () => {
                const storeObjToSave = { url, sha, file, tab };
                lastStore.current = storeObjToSave; // Prevent Store->URL from bouncing this back

                if (repoUrl !== url) {
                    try {
                        const state = useAppStore.getState();
                        const cache = state.repoCache[url] || {};

                        let m = cache.meta;
                        if (!m) {
                            m = await api.repositories.getMeta(url);
                            state.repoCache[url] = { ...state.repoCache[url], meta: m };
                        }
                        useAppStore.getState().setMeta(m!);
                        useAppStore.getState().setRepoUrl(url);

                        let c = cache.commits;
                        if (!c) {
                            const commitData = await api.repositories.getCommits(url);
                            c = commitData.commits;
                            state.repoCache[url] = { ...state.repoCache[url], commits: c };
                        }
                        useAppStore.getState().setCommits(c);

                        const targetSha = sha || (c.length > 0 ? c[0].sha : null);
                        useAppStore.getState().setSelectedSha(targetSha);
                        storeObjToSave.sha = targetSha;
                        lastStore.current = { ...storeObjToSave };

                        if (targetSha) {
                            let cachedTree = cache.trees?.[targetSha];
                            if (!cachedTree) {
                                const treeRes = await api.repositories.getTree(url, targetSha);
                                cachedTree = treeRes.files;
                                state.repoCache[url] = { ...state.repoCache[url], trees: { ...(state.repoCache[url]?.trees || {}), [targetSha]: cachedTree } };
                            }
                            useAppStore.getState().setTreeFiles(cachedTree);
                        }
                    } catch (e) {
                        console.error("Failed to restore repo from URL:", e);
                    }
                } else {
                    if (selectedSha !== sha) useAppStore.getState().setSelectedSha(sha);
                }

                if (useAppStore.getState().selectedFile !== file) {
                    useAppStore.getState().setSelectedFile(file);
                    useAppStore.getState().setSelectedSymbol(null);
                    useAppStore.getState().setImpactResult(null);

                    if (file) {
                        try {
                            const activeSha = useAppStore.getState().selectedSha;
                            if (activeSha) {
                                const activeGraph = useAppStore.getState().graph;
                                if (!isFileInGraph(activeGraph, file)) {
                                    useAppStore.getState().setGraph(null);
                                    const tree = useAppStore.getState().treeFiles;
                                    const paths = getPathsToAnalyze(tree, file);

                                    const cacheKey = paths.sort().join('|');
                                    const state = useAppStore.getState();

                                    let cachedGraph = state.repoCache[url]?.graphs?.[cacheKey];
                                    if (!cachedGraph) {
                                        const data = await api.repositories.analyze(url, activeSha, paths);
                                        cachedGraph = data.graph;
                                        state.repoCache[url] = { ...state.repoCache[url], graphs: { ...(state.repoCache[url]?.graphs || {}), [cacheKey]: cachedGraph } };
                                    }
                                    useAppStore.getState().setGraph(cachedGraph);
                                }
                            }
                        } catch (e) { }
                    } else {
                        useAppStore.getState().setGraph(null);
                    }
                }

                if (file && useAppStore.getState().activeTab !== tab) {
                    useAppStore.getState().setActiveTab(tab);
                }
            };
            restore();
        }
    }, [location.search, location.pathname, repoUrl, selectedSha, selectedFile, activeTab]);

    return null;
}
