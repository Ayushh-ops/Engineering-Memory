export interface ApiErrorBody {
    error?: string;
    missingData?: string[];
}

export class ApiError extends Error {
    public status: number;
    public code?: string;
    public missingData?: string[];
    constructor(
        status: number,
        message: string,
        missingData?: string[],
        code?: string
    ) {
        super(message);
        this.status = status;
        this.missingData = missingData;
        this.code = code;
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
        let msg = res.status === 413
            ? 'The repository is too large to check at once. Try again after the analysis finishes.'
            : `Something went wrong (status ${res.status})`;
        let missing = undefined;
        let code = res.status === 413 ? 'payload_too_large' : undefined;
        try {
            const text = await res.text();
            try {
                const body = JSON.parse(text) as any;
                if (body && typeof body === 'object') {
                    if (body.message) {
                        msg = typeof body.message === 'string' ? body.message : JSON.stringify(body.message);
                    } else if (body.error) {
                        msg = typeof body.error === 'string' ? body.error : JSON.stringify(body.error);
                    }
                    if (body.code) {
                        code = body.code;
                    }
                    missing = body.missingData;
                }
            } catch {
                // If the response is not JSON, do not put the body text into the error message;
                // keep the friendly message (413 or "Something went wrong (status N)").
            }
        } catch {
            // Failed to read response body; keep friendly message
        }
        throw new ApiError(res.status, msg, missing, code);
    }
    return res.json() as Promise<T>;
}

export function post<T>(url: string, body: any, options: RequestInit = {}): Promise<T> {
    return fetchJson<T>(url, { ...options, method: 'POST', body: JSON.stringify(body) });
}

export function get<T>(url: string, options: RequestInit = {}): Promise<T> {
    return fetchJson<T>(url, { ...options, method: 'GET' });
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
export interface ImpactSymbol { type: "class" | "function" | "method" | "file"; path?: string; name: string; }

export interface CallSite { file: string; startLine: number; startColumn: number; endLine: number; endColumn: number; expression: string; }
export interface GraphEdge { id?: string; from: string; to: string; type: GraphEdgeType; callSites?: CallSite[]; }
export interface RepositoryGraph { nodes: GraphNode[]; edges: GraphEdge[]; }

export interface AnalyzeResponse { repository: string; sha: string; files: any[]; resolvedRelationships: any[]; graph: RepositoryGraph; }
export interface RepositoryTreeResponse { repository: string; sha: string; files: string[]; truncated: boolean; }

export interface ImpactTarget { type: "symbol" | "file"; path?: string; symbol?: { type: "class" | "function" | "method"; path: string; name: string }; }

export interface ChangeImpactPathRelationship { relationshipId: string; from: string; to: string; callSiteIds: string[]; type: "calls"; evidence: "available" | "unavailable"; }
export interface ChangeImpactPath { id: string; target: string; nodes: string[]; relationships: ChangeImpactPathRelationship[]; depth: number; classification: "direct-caller" | "transitive-consumer"; }
export interface ChangeImpactNode { id: string; type: "class" | "function" | "method" | "file"; path: string; name: string; }
export interface ChangeImpactSymbolResult { symbol: ImpactSymbol; depth?: number; relationship: "direct-caller" | "transitive-consumer"; evidence: "calls-edge"; }
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
    score?: number;
    reasons?: Array<{ label: string; value: string }>;
}

export interface HealthSummaryResult {
    circularImports: string[][];
    unusedFiles: string[];
    godFiles: Array<{ path: string; importCount: number }>;
}

export interface BatchImpactResult {
    combinedRisk: number;
    affectedFiles: string[];
    tests: string[];
    affectedByInput: Record<string, string[]>;
}

export type AskMode = 'auto' | 'short' | 'detailed' | 'steps' | 'simple' | 'review';
export type AskScope = 'auto' | 'file' | 'dependents' | 'repo';

export interface AskEvidenceItem {
    path: string;
    line?: number;
    endLine?: number;
    snippet?: string;
}

export interface AskImage {
    mime: 'image/jpeg' | 'image/png' | 'image/webp' | string;
    data: string;
}

export interface AskRepoFacts {
    analyzedFiles: number;
    totalFiles: number;
    symbols: number;
    links: number;
    topRisk: Array<{ path: string; score: number; dependents: number }>;
    health: { circular: number; unused: number; godFiles: number };
    owners?: Array<{ name: string; share: number }>;
}

export interface AskTimings {
    fileFetch: number;
    contextBuild: number;
    firstToken: number;
    total: number;
    model: string;
    hops: number;
}

export interface AskUsedContext {
    files: number;
    commits: number;
    provider: string;
    model: string;
    cached: boolean;
    images?: number;
    length?: string;
    format?: string;
    scope?: string;
    timings?: AskTimings;
    hops?: number;
}

export interface AskPayload {
    status?: string;
    answer: string;
    citations?: any[];
    confidence?: string;
    missingData?: string[];
    error?: any;
    followUps?: string[];
    evidence?: AskEvidenceItem[];
    usedContext?: AskUsedContext;
    retryAfterSeconds?: number;
    truncated?: boolean;
    mode?: 'repo' | 'chat' | 'dev' | 'offtopic';
}

export type AiAnswerResult = AskPayload;

export interface FileOwner {
    name: string;
    count: number;
    share: number;
}

export interface FileOwnersResponse {
    repository: string;
    path: string;
    totalCommits: number;
    owners: FileOwner[];
    busFactorRisk: boolean;
}

// ------ API ENDPOINTS ------ //
export const api = {
    repositories: {
        getMeta(url: string, signal?: AbortSignal) { return post<RepositoryMetadata>('/api/repositories', { url }, { signal }); },
        getCommits(url: string, sha?: string | null, path?: string, signal?: AbortSignal) { return post<{ repository: string, commits: CommitMetadata[] }>('/api/repositories/commits', { url, sha: sha || undefined, path }, { signal }); },
        getOwners(url: string, path: string, sha?: string | null, signal?: AbortSignal) { return post<FileOwnersResponse>('/api/repositories/owners', { url, path, sha: sha || undefined }, { signal }); },
        getTree(url: string, sha: string, signal?: AbortSignal) { return post<RepositoryTreeResponse>('/api/repositories/tree', { url, sha }, { signal }); },
        getFile(url: string, sha: string, path: string, signal?: AbortSignal) {
            const query = new URLSearchParams({ url, sha, path }).toString();
            return get<FileContentResponse>(`/api/file?${query}`, { signal });
        },
        analyze(url: string, sha: string, paths: string[], signal?: AbortSignal) { return post<AnalyzeResponse>('/api/repositories/analyze', { url, sha, paths }, { signal }); },
        async analyzeStream(url: string, sha: string, paths: string[], onProgress?: (stage: string, percent: number) => void, signal?: AbortSignal): Promise<AnalyzeResponse> {
            try {
                const response = await fetch('/api/repositories/analyze', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'text/event-stream'
                    },
                    body: JSON.stringify({ url, sha, paths }),
                    signal
                });

                if (!response.ok) {
                    const errJson = await response.json().catch(() => ({}));
                    throw new ApiError(response.status, errJson.error || `Request failed with status ${response.status}`, undefined, errJson.code);
                }

                if (!response.body) {
                    return response.json();
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                let finalResult: AnalyzeResponse | null = null;

                while (true) {
                    if (signal?.aborted) {
                        throw new Error('Analysis was cancelled');
                    }
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
                            if (data.error) {
                                throw new ApiError(400, data.error, undefined, data.code);
                            }
                            if (data.stage && typeof data.percent === 'number') {
                                onProgress?.(data.stage, data.percent);
                            }
                            if (data.result) {
                                finalResult = data.result;
                            }
                        } catch (err: any) {
                            if (err instanceof ApiError) throw err;
                            if (err.message && !err.message.includes('JSON')) throw err;
                        }
                    }
                }

                if (finalResult) return finalResult;
                throw new Error('Analysis completed without result');
            } catch (err: any) {
                if (signal?.aborted || err.name === 'AbortError' || err instanceof ApiError) {
                    throw err;
                }
                // Fallback to standard analyze endpoint if streaming fails
                return post<AnalyzeResponse>('/api/repositories/analyze', { url, sha, paths }, { signal });
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
        },
        impactBatch(graph: RepositoryGraph, paths: string[]) {
            return post<BatchImpactResult>('/api/impact/batch', { graph, paths });
        }
    },
    ai: {
        ask(
            url: string,
            sha: string,
            paths: string[],
            target: ImpactTarget,
            question: string,
            history?: Array<{ role: string; content: string }>,
            extraContext?: {
                risk?: any;
                dependents?: string[];
                recentCommits?: Array<{ sha: string; message: string; author: string; date: string }>;
                owners?: any;
                mode?: AskMode;
                scope?: AskScope;
                images?: AskImage[];
                repoFacts?: AskRepoFacts;
            },
            mode: AskMode = 'auto',
            scope: AskScope = 'auto',
            images?: AskImage[]
        ) {
            const effectiveImages = images || extraContext?.images;
            return post<AskPayload>('/api/ai/ask-repository', {
                url,
                sha,
                paths,
                target,
                question,
                history,
                risk: extraContext?.risk,
                dependents: extraContext?.dependents,
                recentCommits: extraContext?.recentCommits,
                owners: extraContext?.owners,
                mode: extraContext?.mode || mode,
                scope: extraContext?.scope || scope,
                ...(effectiveImages && effectiveImages.length > 0 ? { images: effectiveImages } : {}),
                ...(extraContext?.repoFacts ? { repoFacts: extraContext.repoFacts } : {})
            });
        },
        async askStream(
            url: string,
            sha: string,
            paths: string[],
            target: ImpactTarget,
            question: string,
            history: Array<{ role: string; content: string }> | undefined,
            onToken: (token: string) => void,
            signal?: AbortSignal,
            extraContext?: {
                risk?: any;
                dependents?: string[];
                recentCommits?: Array<{ sha: string; message: string; author: string; date: string }>;
                owners?: any;
                mode?: AskMode;
                scope?: AskScope;
                images?: AskImage[];
                repoFacts?: AskRepoFacts;
                onFirstByte?: () => void;
            },
            mode: AskMode = 'auto',
            scope: AskScope = 'auto',
            images?: AskImage[],
            onFirstByte?: () => void
        ): Promise<AskPayload> {
            const effectiveMode = extraContext?.mode || mode;
            const effectiveScope = extraContext?.scope || scope;
            const effectiveImages = images || extraContext?.images;
            const notifyFirstByte = onFirstByte || extraContext?.onFirstByte;
            try {
                const response = await fetch('/api/ai/ask-repository', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'text/event-stream'
                    },
                    body: JSON.stringify({
                        url,
                        sha,
                        paths,
                        target,
                        question,
                        history,
                        risk: extraContext?.risk,
                        dependents: extraContext?.dependents,
                        recentCommits: extraContext?.recentCommits,
                        owners: extraContext?.owners,
                        mode: effectiveMode,
                        scope: effectiveScope,
                        ...(effectiveImages && effectiveImages.length > 0 ? { images: effectiveImages } : {}),
                        ...(extraContext?.repoFacts ? { repoFacts: extraContext.repoFacts } : {})
                    }),
                    signal
                });

                if (!response.ok) {
                    const error = await response.json().catch(() => ({}));
                    const errMsg = error.message || error.error || `HTTP ${response.status}`;
                    const err = new Error(errMsg);
                    (err as any).data = error;
                    (err as any).status = response.status;
                    (err as any).code = error.code;
                    (err as any).retryAfterSeconds = error.retryAfterSeconds;
                    throw err;
                }

                if (notifyFirstByte) {
                    notifyFirstByte();
                }

                if (!response.body) {
                    return post<AskPayload>('/api/ai/ask-repository', {
                        url,
                        sha,
                        paths,
                        target,
                        question,
                        history,
                        risk: extraContext?.risk,
                        dependents: extraContext?.dependents,
                        recentCommits: extraContext?.recentCommits,
                        owners: extraContext?.owners,
                        mode: effectiveMode,
                        scope: effectiveScope,
                        ...(effectiveImages && effectiveImages.length > 0 ? { images: effectiveImages } : {}),
                        ...(extraContext?.repoFacts ? { repoFacts: extraContext.repoFacts } : {})
                    });
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                let finalResult: AskPayload | null = null;
                let currentEvent = 'message';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (trimmed.startsWith(':')) {
                            continue;
                        }
                        if (trimmed === '') {
                            currentEvent = 'message';
                            continue;
                        }
                        if (trimmed.startsWith('event:')) {
                            currentEvent = trimmed.slice(6).trim();
                            continue;
                        }
                        if (trimmed.startsWith('data:')) {
                            const jsonStr = trimmed.slice(5).trim();
                            if (!jsonStr) continue;

                            let data: any;
                            try {
                                data = JSON.parse(jsonStr);
                            } catch {
                                continue;
                            }

                            if (currentEvent === 'token') {
                                if (typeof data.token === 'string') {
                                    onToken(data.token);
                                }
                            } else if (currentEvent === 'done') {
                                finalResult = data as AskPayload;
                            } else if (currentEvent === 'error') {
                                const err = new Error(data.message || data.code || 'AI service error');
                                (err as any).data = data;
                                (err as any).status = data.status || 500;
                                (err as any).code = data.code;
                                (err as any).retryAfterSeconds = data.retryAfterSeconds;
                                throw err;
                            }
                        }
                    }
                }

                if (finalResult) return finalResult;
                return {
                    status: 'ok',
                    answer: '',
                    citations: [],
                    confidence: 'medium',
                    truncated: true
                } as AskPayload;
            } catch (err: any) {
                if (signal?.aborted) {
                    throw err;
                }
                if (err.data || err.code || err.retryAfterSeconds || err.status) {
                    throw err;
                }
                return post<AskPayload>('/api/ai/ask-repository', {
                    url,
                    sha,
                    paths,
                    target,
                    question,
                    history,
                    risk: extraContext?.risk,
                    dependents: extraContext?.dependents,
                    recentCommits: extraContext?.recentCommits,
                    owners: extraContext?.owners,
                    mode: effectiveMode,
                    scope: effectiveScope,
                    ...(effectiveImages && effectiveImages.length > 0 ? { images: effectiveImages } : {}),
                    ...(extraContext?.repoFacts ? { repoFacts: extraContext.repoFacts } : {})
                });
            }
        }
    }
};
