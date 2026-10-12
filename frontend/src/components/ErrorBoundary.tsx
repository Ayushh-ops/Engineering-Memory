import { Component, ErrorInfo, ReactNode } from 'react';
import { Button } from '../ui';
import { AlertTriangle, Copy, Check } from 'lucide-react';

interface Props {
    children: ReactNode;
    onReset?: () => void;
    name?: string;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
    copied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
        errorInfo: null,
        copied: false
    };

    public static getDerivedStateFromError(error: Error): Partial<State> {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error(error);
        console.error(errorInfo.componentStack);
        this.setState({ errorInfo });
    }

    public handleRetry = () => {
        this.setState({ hasError: false, error: null, errorInfo: null, copied: false });
        if (this.props.onReset) {
            this.props.onReset();
        }
    };

    public handleCopyDetails = async () => {
        const tabName = this.props.name || 'Unknown tab';
        const message = this.state.error?.message || '';
        const stack = this.state.error?.stack || '';
        const componentStack = this.state.errorInfo?.componentStack || '';

        const text = [
            `Tab: ${tabName}`,
            `Error: ${message}`,
            stack ? `Stack:\n${stack}` : '',
            componentStack ? `Component Stack:\n${componentStack}` : ''
        ].filter(Boolean).join('\n\n');

        try {
            await navigator.clipboard.writeText(text);
            this.setState({ copied: true });
            setTimeout(() => this.setState({ copied: false }), 2000);
        } catch (e) {
            console.warn('Failed to copy error details to clipboard', e);
        }
    };

    public handleClearChatsAndReload = () => {
        try {
            const keysToRemove: string[] = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('em_ask_chats')) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach((k) => localStorage.removeItem(k));
        } catch (e) {
            console.warn('Failed to clear Ask AI chats from localStorage', e);
        }
        try {
            window.location.reload();
        } catch {
            this.handleRetry();
        }
    };

    public render() {
        if (this.state.hasError) {
            const rawMessage = this.state.error?.message || '';
            const errorMessage = rawMessage.length > 200 ? rawMessage.slice(0, 200) + '…' : rawMessage;
            const stackLines = (this.state.errorInfo?.componentStack || '').trim().split('\n');
            const trimmedStack = stackLines.slice(0, 25).join('\n');

            return (
                <div className="glass-surface p-8 rounded-xl border border-white/10 text-center flex flex-col items-center justify-center gap-3 m-4 flex-1">
                    <AlertTriangle size={24} className="text-[#E3A04A]" />
                    <div className="text-sm font-medium text-[#E8EAE6]">Something went wrong in this tab</div>
                    {errorMessage && (
                        <div className="text-[11px] font-mono text-[#8A918C] max-w-lg break-words text-center">
                            {errorMessage}
                        </div>
                    )}
                    {trimmedStack && (
                        <details className="w-full max-w-lg text-left bg-black/40 border border-white/10 rounded-lg p-2.5 my-1">
                            <summary className="text-[11px] font-mono text-[#8A918C] hover:text-[#E8EAE6] cursor-pointer select-none">
                                Details
                            </summary>
                            <pre className="mt-2 text-[10px] font-mono text-[#8A918C]/80 overflow-x-auto whitespace-pre-wrap max-h-48 scrollbar-custom">
                                {trimmedStack}
                            </pre>
                        </details>
                    )}
                    <div className="flex items-center gap-2 flex-wrap justify-center mt-2">
                        <Button onClick={this.handleRetry} className="px-3.5 py-1.5 text-xs font-mono">
                            Reload tab
                        </Button>
                        <Button onClick={this.handleCopyDetails} variant="secondary" className="px-3.5 py-1.5 text-xs font-mono">
                            {this.state.copied ? <Check size={12} className="text-[#4FD1B5]" /> : <Copy size={12} />}
                            <span>{this.state.copied ? 'Copied' : 'Copy details'}</span>
                        </Button>
                        <Button onClick={this.handleClearChatsAndReload} variant="ghost" className="px-3.5 py-1.5 text-xs font-mono text-[#8A918C] hover:text-[#E8EAE6]">
                            Clear saved chats and reload
                        </Button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
