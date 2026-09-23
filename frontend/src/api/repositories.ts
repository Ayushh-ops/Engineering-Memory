import { post } from './client';
import type { RepositoryGraph } from '../types/backend';

export interface RepositoryMetadata {
    name: string;
    fullName: string;
    owner: string;
    description: string;
    language: string;
    stars: number;
    forks: number;
    htmlUrl: string;
}

export interface CommitMetadata {
    sha: string;
    message: string;
    authorName: string;
    authorDate: string;
    files: Array<{
        filename: string;
        status: string;
        additions: number;
        deletions: number;
        changes: number;
    }>;
}

export async function getRepositoryMetadata(url: string): Promise<RepositoryMetadata> {
    return post<RepositoryMetadata>('/api/repositories', { url });
}

export async function getRepositoryCommits(url: string): Promise<{ repository: string, commits: CommitMetadata[] }> {
    return post<{ repository: string, commits: CommitMetadata[] }>('/api/repositories/commits', { url });
}

export interface AnalyzeRequest {
    url: string;
    sha: string;
    paths: string[];
}

export interface AnalyzeResponse {
    repository: string;
    sha: string;
    files: any[]; // skipping detailed file types for now
    resolvedRelationships: any[];
    graph: RepositoryGraph;
}

export async function analyzeRepository(request: AnalyzeRequest): Promise<AnalyzeResponse> {
    return post<AnalyzeResponse>('/api/repositories/analyze', request);
}

export interface RepositoryTreeResponse {
    repository: string;
    sha: string;
    files: string[];
    truncated: boolean;
}

export async function getRepositoryTree(url: string, sha: string): Promise<RepositoryTreeResponse> {
    return post<RepositoryTreeResponse>('/api/repositories/tree', { url, sha });
}
