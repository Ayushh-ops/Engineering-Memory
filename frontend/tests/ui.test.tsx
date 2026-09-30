import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../src/App';
import { useAppStore } from '../src/store';
import { test, expect, vi, beforeEach } from 'vitest';
import React from 'react';

// Mock fetch
global.fetch = vi.fn();

beforeEach(() => {
    useAppStore.setState({
        repoUrl: '', meta: null, commits: [], selectedSha: null, treeFiles: [], graph: null, selectedFile: null, selectedSymbol: null
    });
    vi.resetAllMocks();
});

test('Analyze button works and renders tree', async () => {
    const mockMeta = { fullName: 'microsoft/vscode', description: 'Test repo' };
    const mockCommits = { commits: [{ sha: '43dd9070f75d527a' }] };
    const mockTree = { files: Array.from({ length: 13000 }, (_, i) => 'src/file' + i + '.ts') };

    (global.fetch as any).mockImplementation(async (url: string, options: any) => {
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
        return { ok: false };
    });

    render(<App />);

    const input = screen.getByPlaceholderText('https://github.com/owner/repo');
    fireEvent.change(input, { target: { value: 'https://github.com/microsoft/vscode' } });

    const analyzeBtn = screen.getByText('Analyze');
    fireEvent.click(analyzeBtn);

    // Wait for the tree to appear
    await waitFor(() => {
        expect(screen.getByText('src')).to.exist;
    }, { timeout: 4000 });

    const srcFolder = screen.getByText('src');
    fireEvent.click(srcFolder);

    await waitFor(() => {
        expect(screen.getByText('file0.ts')).to.exist;
        expect(screen.getByText('file12999.ts')).to.exist;
    }, { timeout: 4000 });

    // Also check if selectedSha is updated
    const state = useAppStore.getState();
    expect(state.selectedSha).toBe('43dd9070f75d527a');
    expect(state.treeFiles.length).toBe(13000);

    console.log("TEST PASSED! Tree successfully rendered from state.");
});
