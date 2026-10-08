import { Component, ErrorInfo, ReactNode } from 'react';
import { Button } from '../ui';
import { AlertTriangle } from 'lucide-react';

interface Props {
    children: ReactNode;
    onReset?: () => void;
    name?: string;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error(`ErrorBoundary caught an error${this.props.name ? ` in ${this.props.name}` : ''}:`, error, errorInfo);
    }

    public handleRetry = () => {
        this.setState({ hasError: false, error: null });
        if (this.props.onReset) {
            this.props.onReset();
        }
    };

    public render() {
        if (this.state.hasError) {
            return (
                <div className="glass-surface p-12 rounded-xl border border-white/10 text-center flex flex-col items-center justify-center gap-3 m-4">
                    <AlertTriangle size={24} className="text-[#E3A04A]" />
                    <div className="text-sm font-medium text-[#E8EAE6]">Something went wrong</div>
                    <p className="text-xs text-[#8A918C] max-w-sm">
                        An error occurred while displaying {this.props.name ? `the ${this.props.name} tab` : 'this content'}.
                    </p>
                    <Button onClick={this.handleRetry} className="mt-2 px-4 py-1.5 text-xs font-mono">
                        Retry
                    </Button>
                </div>
            );
        }

        return this.props.children;
    }
}
