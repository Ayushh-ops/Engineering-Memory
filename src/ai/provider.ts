export type LlmCitationType = "file" | "symbol" | "commit";

export interface LlmCitation {
    type: LlmCitationType;
    path?: string;
    name?: string;
    sha?: string;
}

export type LlmStatus = "ok" | "insufficient_context" | "error";
export type LlmConfidence = "low" | "medium" | "high";

export interface LlmProviderError {
    code: "missing_api_key" | "invalid_api_key" | "rate_limit" | "provider_unavailable" | "timeout" | "oversized_context" | "malformed_response" | "invalid_question" | "invalid_graph" | "insufficient_context";
    message: string;
}

export interface LlmResponse {
    status: LlmStatus;
    answer: string;
    citations: LlmCitation[];
    confidence: LlmConfidence;
    missingData?: string[];
    error?: LlmProviderError;
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
    responseOptions?: {
        temperature?: number;
        maxTokens?: number;
    };
}

export interface LlmProvider {
    answer(request: LlmRequest): Promise<LlmResponse>;
}
