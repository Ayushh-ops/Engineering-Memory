export interface ApiErrorBody {
    error?: string;
    missingData?: string[];
}

export class ApiError extends Error {
    public status: number;
    public missingData?: string[];
    constructor(
        status: number,
        message: string,
        missingData?: string[]
    ) {
        super(message);
        this.status = status;
        this.missingData = missingData;
        this.name = 'ApiError';
    }
}

async function fetchJson<T>(url: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });

    if (!res.ok) {
        let msg = 'An unexpected error occurred';
        let missing = undefined;
        try {
            const text = await res.text();
            try {
                const body = JSON.parse(text) as any;
                if (body.error) {
                    msg = typeof body.error === 'string' ? body.error : JSON.stringify(body.error);
                }
                missing = body.missingData;
            } catch {
                if (text) msg = text;
            }
        } catch (e) {
            msg = 'Failed to read response body';
        }
        throw new ApiError(res.status, msg, missing);
    }
    return res.json() as Promise<T>;
}

export function post<T>(url: string, body: any): Promise<T> {
    return fetchJson<T>(url, { method: 'POST', body: JSON.stringify(body) });
}

export function get<T>(url: string): Promise<T> {
    return fetchJson<T>(url, { method: 'GET' });
}

// ------ DOMAIN TYPES ------ //
export interface FileContentResponse {
    repository: string;
    path: string;
    sha: string;
    content: string;
    truncated?: boolean;
}

export interface RepositoryMetadata {
    name: string; fullName: string; owner: string; description: string;
    language: string; stars: number; forks: number; htmlUrl: string;
}

export interface CommitMetadata {
    sha: string; message: string; authorName: string; authorDate: string;
    files: Array<{ filename: string; status: string; additions: number; deletions: number; changes: number; }>;
}

export type GraphNodeType = "repository" | "file" | "class" | "function" | "method" | "commit" | "symbol-change";
export type GraphEdgeType = "contains" | "imports" | "calls" | "changed" | "in-file" | "affects";

export interface NamedGraphNode { id: string; type: GraphNodeType; name: string; }
export interface RepositoryGraphNode { id: string; type: "repository"; }
export interface FileGraphNode { id: string; type: "file"; path: string; }
export interface ClassGraphNode extends NamedGraphNode { type: "class"; path: string; }
export interface FunctionGraphNode extends NamedGraphNode { type: "function"; path: string; }
export interface MethodGraphNode extends NamedGraphNode { type: "method"; path: string; }
export interface CommitGraphNode { id: string; type: "commit"; sha: string; message: string; authorName: string; authorDate: string; }
export interface SymbolChangeGraphNode { id: string; type: "symbol-change"; path: string; symbolType: string; name: string; changeType: string; }

export type GraphNode = RepositoryGraphNode | FileGraphNode | ClassGraphNode | FunctionGraphNode | MethodGraphNode | CommitGraphNode | SymbolChangeGraphNode;
export type GraphSymbolNode = Extract<GraphNode, { type: "class" | "function" | "method" }>;

export interface CallSite { file: string; startLine: number; startColumn: number; endLine: number; endColumn: number; expression: string; }
export interface GraphEdge { id?: string; from: string; to: string; type: GraphEdgeType; callSites?: CallSite[]; }
export interface RepositoryGraph { nodes: GraphNode[]; edges: GraphEdge[]; }

export interface AnalyzeResponse { repository: string; sha: string; files: any[]; resolvedRelationships: any[]; graph: RepositoryGraph; }
export interface RepositoryTreeResponse { repository: string; sha: string; files: string[]; truncated: boolean; }

export interface ImpactTarget { type: "symbol" | "file"; path?: string; symbol?: { type: "class" | "function" | "method"; path: string; name: string }; }

export interface ChangeImpactPathRelationship { relationshipId: string; from: string; to: string; callSiteIds: string[]; type: "calls"; evidence: "available" | "unavailable"; }
export interface ChangeImpactPath { id: string; target: string; nodes: string[]; relationships: ChangeImpactPathRelationship[]; depth: number; classification: "direct-caller" | "transitive-consumer"; }
export interface ChangeImpactNode { id: string; type: "class" | "function" | "method"; path: string; name: string; }
export interface ChangeImpactSymbolResult { symbol: GraphSymbolNode; depth?: number; relationship: "direct-caller" | "transitive-consumer"; evidence: "calls-edge"; }
export interface ChangeImpactCallSiteEvidence { id: string; file: string; startLine: number; startColumn: number; endLine: number; endColumn: number; expression: string; }
export interface RepositorySourceEvidence { path: string; symbol: { type: "class" | "function" | "method"; name: string }; content: string; }

export interface ChangeImpactAnalysisResult {
    target: { type: "symbol" | "file"; path: string; name?: string; };
    targetNodeId?: string;
    status: "ok" | "missing" | "ambiguous";
    bounds: { maxDepth?: number; maxResults?: number; truncated: boolean; };
    directCallers: ChangeImpactSymbolResult[];
    transitiveConsumers: ChangeImpactSymbolResult[];
    impactNodes: ChangeImpactNode[];
    paths: ChangeImpactPath[];
    callSiteEvidence: ChangeImpactCallSiteEvidence[];
    sourceEvidence: RepositorySourceEvidence[];
    limitations: string[];
    relatedDependencies?: string[];
    reviewCandidates?: string[];
    tests?: Array<{ path?: string; symbol?: { path: string; name: string } } | string>;
    reasons?: Array<{ label: string; value: string }>;
}

export interface HealthSummaryResult {
    circularImports: string[][];
    unusedFiles: string[];
    godFiles: Array<{ path: string; importCount: number }>;
}

export interface AiAnswerResult { status: string; answer: string; citations: any[]; confidence?: string; missingData?: string[]; error?: any; }

// ------ API ENDPOINTS ------ //
export const api = {
    repositories: {
        getMeta(url: string) { return post<RepositoryMetadata>('/api/repositories', { url }); },
        getCommits(url: string, sha?: string | null, path?: string) { return post<{ repository: string, commits: CommitMetadata[] }>('/api/repositories/commits', { url, sha: sha || undefined, path }); },
        getTree(url: string, sha: string) { return post<RepositoryTreeResponse>('/api/repositories/tree', { url, sha }); },
        getFile(url: string, sha: string, path: string) {
            const query = new URLSearchParams({ url, sha, path }).toString();
            return get<FileContentResponse>(`/api/file?${query}`);
        },
        analyze(url: string, sha: string, paths: string[]) { return post<AnalyzeResponse>('/api/repositories/analyze', { url, sha, paths }); },
        async analyzeStream(url: string, sha: string, paths: string[], onProgress?: (stage: string, percent: number) => void): Promise<AnalyzeResponse> {
            try {
                const response = await fetch('/api/repositories/analyze', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'text/event-stream'
                    },
                    body: JSON.stringify({ url, sha, paths })
                });

                if (!response.ok) {
                    const errJson = await response.json().catch(() => ({}));
                    throw new Error(errJson.error || `Request failed with status ${response.status}`);
                }

                if (!response.body) {
                    return response.json();
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                let finalResult: AnalyzeResponse | null = null;

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed.startsWith('data:')) continue;
                        const jsonStr = trimmed.slice(5).trim();
                        if (!jsonStr) continue;
                        try {
                            const data = JSON.parse(jsonStr);
                            if (data.error) throw new Error(data.error);
                            if (data.stage && typeof data.percent === 'number') {
                                onProgress?.(data.stage, data.percent);
                            }
                            if (data.result) {
                                finalResult = data.result;
                            }
                        } catch (err: any) {
                            if (err.message && !err.message.includes('JSON')) throw err;
                        }
                    }
                }

                if (finalResult) return finalResult;
                throw new Error('Analysis completed without result');
            } catch (err) {
                // Fallback to standard analyze endpoint if streaming fails
                return post<AnalyzeResponse>('/api/repositories/analyze', { url, sha, paths });
            }
        },
        analyzeHistory(url: string, sha: string, paths: string[]) { return post<any>('/api/repositories/analyze-history', { url, sha, paths }); },
    },
    graph: {
        impact(graph: RepositoryGraph, target: ImpactTarget, limits?: { maxDepth?: number; maxResults?: number }) {
            return post<ChangeImpactAnalysisResult>('/api/repositories/graph/impact', { graph, request: { target, limits } });
        },
        query(graph: RepositoryGraph, query: any) {
            return post<any>('/api/repositories/graph/query', { graph, query });
        },
        health(graph: RepositoryGraph) {
            return post<HealthSummaryResult>('/api/repositories/graph/health', { graph });
        }
    },
    ai: {
        ask(url: string, sha: string, paths: string[], target: ImpactTarget, question: string, lang?: "en" | "hinglish") {
            return post<AiAnswerResult>('/api/ai/ask-repository', { url, sha, paths, target, question, lang: lang || "en" });
        }
    }
};
