export type LlmCitationType = "file" | "symbol" | "commit";

export interface LlmCitation {
    type: LlmCitationType;
    path?: string;
    name?: string;
    sha?: string;
}

import type { QuestionClassification } from "./question-class";

export type LlmStatus = "ok" | "insufficient_context" | "error";
export type LlmConfidence = "low" | "medium" | "high";
export type LlmMode = "auto" | "short" | "detailed" | "steps" | "simple" | "review";
export type LlmScope = "file" | "dependents" | "repo";

export interface LlmEvidence {
    path: string;
    line?: number;
    endLine?: number;
    snippet?: string;
}

export interface LlmImage {
    mime: "image/jpeg" | "image/png" | "image/webp";
    data: string;
}

export interface LlmUsedContext {
    files: number;
    commits: number;
    provider: string;
    model: string;
    cached: boolean;
    images?: number;
    length?: string;
    format?: string;
    scope?: string;
}

export interface LlmProviderError {
    code: "bad_request" | "missing_api_key" | "invalid_api_key" | "rate_limit" | "rate_limited" | "model_not_found" | "provider_unavailable" | "timeout" | "oversized_context" | "malformed_response" | "invalid_question" | "invalid_graph" | "insufficient_context" | "vision_unavailable" | "image_failed";
    message: string;
}

export interface LlmResponse {
    status: LlmStatus;
    answer: string;
    citations: LlmCitation[];
    confidence: LlmConfidence;
    missingData?: string[];
    error?: LlmProviderError;
    followUps?: string[];
    evidence?: LlmEvidence[];
    usedContext?: LlmUsedContext;
    retryAfterSeconds?: number;
    truncated?: boolean;
}

export interface LlmRequest {
    repository: string;
    target: {
        type: "file" | "symbol" | "commit";
        path?: string;
        symbolType?: "class" | "function" | "method";
        symbolName?: string;
        sha?: string;
    };
    question: string;
    facts: unknown;
    instructions?: string[];
    history?: Array<{ role: string; content: string }>;
    responseOptions?: {
        temperature?: number;
        maxTokens?: number;
    };
    mode?: LlmMode;
    scope?: LlmScope;
    images?: LlmImage[];
    classification?: QuestionClassification;
    repoFacts?: any;
}

export interface LlmProvider {
    answer(request: LlmRequest): Promise<LlmResponse>;
    streamAnswer?(request: LlmRequest, onToken: (token: string) => void): Promise<LlmResponse>;
}
