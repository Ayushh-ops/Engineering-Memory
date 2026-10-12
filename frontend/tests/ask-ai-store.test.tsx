import { render, screen, act } from '@testing-library/react';
import { useAppStore } from '../src/store';
import { test, expect, beforeEach } from 'vitest';
import React from 'react';

function AskAiConsumer() {
    const askAiByRepo = useAppStore(state => state.askAiByRepo);
    const repoUrl = useAppStore(state => state.repoUrl);
    const selectedSha = useAppStore(state => state.selectedSha);
    const repoAskAi = useAppStore.getState().getAskAiState(repoUrl, selectedSha);
    return (
        <div>
            <div data-testid="chat-count">{repoAskAi.chatMessages.length}</div>
            {repoAskAi.chatMessages.map((m, i) => (
                <div key={i} data-testid={`msg-${i}`}>{m.content}</div>
            ))}
        </div>
    );
}

beforeEach(() => {
    useAppStore.setState({
        repoUrl: 'https://github.com/owner/repo',
        selectedSha: 'abc1234',
        selectedFile: 'src/main.ts',
        askAiByRepo: {}
    });
});

test('messages survive component unmount/mount and streaming message grows while unmounted', () => {
    // 1. Mount component and add a message to store
    const { unmount } = render(<AskAiConsumer />);
    act(() => {
        useAppStore.getState().setAskAiMessages([{ role: 'user', content: 'Hello test message' }]);
    });
    expect(screen.getByTestId('msg-0').textContent).toBe('Hello test message');

    // 2. Simulate unmount and remount: message is still there
    unmount();
    const { unmount: unmount2 } = render(<AskAiConsumer />);
    expect(screen.getByTestId('msg-0').textContent).toBe('Hello test message');

    // 3. Start streaming, unmount, and simulate tokens arriving while unmounted
    act(() => {
        const controller = new AbortController();
        useAppStore.getState().startAskAiStreaming('chat_test', controller, [
            { role: 'user', content: 'Explain code' },
            { role: 'assistant', content: '', isThinking: true }
        ]);
    });
    unmount2();

    // Stream keeps growing while unmounted
    act(() => {
        useAppStore.getState().appendAskAiStreamingToken('TokenA');
        useAppStore.getState().appendAskAiStreamingToken(' TokenB');
        useAppStore.getState().appendAskAiStreamingToken(' TokenC');
    });

    const stateMsgs = useAppStore.getState().getAskAiState().chatMessages;
    expect(stateMsgs[1].content).toBe('TokenA TokenB TokenC');

    // 4. Mount again, verify accumulated streaming message is rendered
    render(<AskAiConsumer />);
    expect(screen.getByTestId('msg-1').textContent).toBe('TokenA TokenB TokenC');
});
