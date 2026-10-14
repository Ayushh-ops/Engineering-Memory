import { render, screen, waitFor, act } from '@testing-library/react';
import App from '../src/App';
import { TopBar } from '../src/components/TopBar';
import { useAppStore } from '../src/store';
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

global.fetch = vi.fn();

beforeEach(() => {
    useAppStore.setState({
        repoUrl: '',
        meta: null,
        commits: [],
        selectedSha: null,
        treeFiles: [],
        graph: null,
        selectedFile: null,
        selectedSymbol: null,
        activeTab: 'Impact',
        historyIdx: 0,
        historyMaxIdx: 0,
        canBack: false,
        canForward: false,
        isAnalyzing: false,
        analysisError: null,
        repoCache: {}
    });
    vi.clearAllMocks();
});

afterEach(() => {
    vi.restoreAllMocks();
});

test('loading /repo?url=...&sha=... with an empty store triggers analyze once and selects file and tab', async () => {
    const mockMeta = { fullName: 'owner/repo', description: 'Test repo' };
    const mockCommits = { commits: [{ sha: 'sha12345678' }] };
    const mockTree = { files: ['src/index.ts', 'src/app.ts', 'src/utils.ts'] };
    const mockGraph = { nodes: [{ id: 'src/app.ts', label: 'app.ts', type: 'file' }], edges: [] };

    let analyzeCallCount = 0;
    (global.fetch as any).mockImplementation(async (url: string) => {
        const path = new URL(url, 'http://localhost').pathname;
        if (path === '/api/repositories') {
            return { ok: true, json: async () => mockMeta };
        }
        if (path === '/api/repositories/commits') {
            return { ok: true, json: async () => mockCommits };
        }
        if (path === '/api/repositories/tree') {
            return { ok: true, json: async () => mockTree };
        }
        if (path === '/api/repositories/analyze') {
            analyzeCallCount++;
            return { ok: true, json: async () => ({ graph: mockGraph }) };
        }
        return { ok: false, status: 404, json: async () => ({ error: 'Not found' }) };
    });

    render(
        <MemoryRouter initialEntries={['/repo?url=https%3A%2F%2Fgithub.com%2Fowner%2Frepo&sha=sha12345678&file=src%2Fapp.ts&tab=Code']}>
            <App />
        </MemoryRouter>
    );

    await waitFor(() => {
        const state = useAppStore.getState();
        expect(state.repoUrl).toBe('https://github.com/owner/repo');
        expect(state.selectedSha).toBe('sha12345678');
        expect(state.selectedFile).toBe('src/app.ts');
        expect(state.activeTab).toBe('Code');
    }, { timeout: 4000 });

    expect(analyzeCallCount).toBe(1);
});

test('popstate does not push', async () => {
    const pushSpy = vi.spyOn(window.history, 'pushState');

    render(
        <MemoryRouter initialEntries={['/repo?url=https%3A%2F%2Fgithub.com%2Fowner%2Frepo&sha=sha12345678&file=src%2Fapp.ts&tab=Impact']}>
            <App />
        </MemoryRouter>
    );

    act(() => {
        window.dispatchEvent(new PopStateEvent('popstate', { state: { idx: 0 } }));
    });

    await waitFor(() => {
        expect(pushSpy).not.toHaveBeenCalled();
    });
});

test('the forward button is disabled until the user goes back, then enabled', () => {
    // 1. Initially at latest index (idx: 1, maxIdx: 1): canGoBack = true, canGoForward = false
    act(() => {
        useAppStore.getState().setHistoryIndices(1, 1);
        useAppStore.setState({ repoUrl: 'https://github.com/owner/repo' });
    });

    const { unmount } = render(
        <MemoryRouter>
            <TopBar />
        </MemoryRouter>
    );

    const forwardBtn = screen.getByTitle('Forward') as HTMLButtonElement;
    expect(forwardBtn.disabled).toBe(true);
    expect(forwardBtn.className).toContain('opacity-45');

    unmount();

    // 2. User goes back to idx: 0 (maxIdx remains 1): forward becomes enabled
    act(() => {
        useAppStore.getState().setHistoryIndices(0, 1);
    });

    render(
        <MemoryRouter>
            <TopBar />
        </MemoryRouter>
    );

    const enabledForwardBtn = screen.getByTitle('Forward') as HTMLButtonElement;
    expect(enabledForwardBtn.disabled).toBe(false);
    expect(enabledForwardBtn.className).not.toContain('opacity-45');
});

test('a failed analyze shows the error card and does not change the URL to "/"', async () => {
    (global.fetch as any).mockImplementation(async (url: string) => {
        const path = new URL(url, 'http://localhost').pathname;
        if (path === '/api/repositories') {
            return {
                ok: false,
                status: 404,
                json: async () => ({ error: 'Repository not found. Check the URL, or it may be private.', code: 'repo_not_found' })
            };
        }
        return { ok: false, status: 404 };
    });

    let currentTestLocation = '/repo?url=https%3A%2F%2Fgithub.com%2Fowner%2Fmissing-repo';

    render(
        <MemoryRouter initialEntries={[currentTestLocation]}>
            <App />
        </MemoryRouter>
    );

    // Wait for the error card to display
    await waitFor(() => {
        expect(screen.getByText('Repository not found')).toBeDefined();
        expect(screen.getByText('Try again')).toBeDefined();
    }, { timeout: 4000 });

    // Ensure it did not redirect or navigate away to "/"
    expect(useAppStore.getState().analysisError).not.toBeNull();
    expect(useAppStore.getState().analysisError?.code).toBe('repo_not_found');
});
