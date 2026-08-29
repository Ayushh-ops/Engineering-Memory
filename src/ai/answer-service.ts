import type { RepositoryGraph } from "../graph/repository-graph";
import { assembleRepositoryContext, type RepositoryContextRequest } from "../graph/repository-context";
import { buildAiContext, type AiRepositoryContext } from "./context";
import { buildPrompt } from "./prompt-builder";
import type { LlmProvider, LlmRequest, LlmResponse } from "./provider";

export interface AiAnswerRequest extends RepositoryContextRequest {
    repository: string;
    question: string;
    graph: RepositoryGraph;
    allowInsufficientContext?: boolean;
}

export interface AiAnswerResult extends LlmResponse {
    status: "ok" | "insufficient_context" | "error";
}

const MAX_AI_CONTEXT_BYTES = 16000;

function isGroundedQuestion(question: string, target: { type: string; path?: string; symbolName?: string; sha?: string }): boolean {
    const normalized = question.toLowerCase();
    const specificTargets = [
        target.path,
        target.symbolName,
        target.sha
    ].filter((value): value is string => typeof value === "string" && value.length > 0);

    const broadPatterns = [
        "root cause",
        "bug in this repo",
        "explain the repository",
        "architecture of the repo",
        "what is the project",
        "what does this repository do",
        "why is this code broken"
    ];

    if (broadPatterns.some((pattern) => normalized.includes(pattern))) {
        return false;
    }

    if (specificTargets.some((value) => normalized.includes(value.toLowerCase()))) {
        return true;
    }

    return normalized.includes("what does") || normalized.includes("which") || normalized.includes("who") || normalized.includes("when") || normalized.includes("why") || normalized.includes("how");
}

export class AiAnswerService {
    constructor(private readonly provider: LlmProvider) {}

    async answer(request: AiAnswerRequest): Promise<AiAnswerResult> {
        if (!request || typeof request.question !== "string" || request.question.trim().length === 0) {
            return {
                status: "error",
                answer: "",
                citations: [],
                confidence: "low",
                error: {
                    code: "invalid_question",
                    message: "A non-empty question is required."
                }
            };
        }

        const result = assembleRepositoryContext(request.graph, { target: request.target, limits: request.limits });
        if (result.status !== "ok") {
            return {
                status: request.allowInsufficientContext ? "insufficient_context" : "error",
                answer: "The supplied repository context does not contain a valid target for this question.",
                citations: [],
                confidence: "low",
                error: {
                    code: "invalid_graph",
                    message: "The requested context target was not found or is ambiguous."
                },
                missingData: [result.status === "missing" ? "target_missing" : "target_ambiguous"]
            };
        }

        const aiContext = buildAiContext(result.context, request.repository);
        const serializedContext = JSON.stringify(aiContext);
        if (serializedContext.length > MAX_AI_CONTEXT_BYTES) {
            return {
                status: "error",
                answer: "",
                citations: [],
                confidence: "low",
                error: {
                    code: "oversized_context",
                    message: "The repository context is too large for the AI provider."
                },
                missingData: ["context_too_large"]
            };
        }

        if (request.allowInsufficientContext && !isGroundedQuestion(request.question, aiContext.target)) {
            return {
                status: "insufficient_context",
                answer: "The supplied repository context is insufficient to answer this question reliably.",
                citations: [],
                confidence: "low",
                missingData: ["question_requires_unavailable_repository_context"]
            };
        }

        const prompt = buildPrompt({
            repository: request.repository,
            target: aiContext.target,
            question: request.question,
            facts: aiContext,
            instructions: [
                "Answer only from the supplied repository facts.",
                "If the supplied facts do not support the question, explicitly say so."
            ]
        });

        const providerRequest: LlmRequest = {
            repository: request.repository,
            target: aiContext.target,
            question: request.question,
            facts: aiContext,
            instructions: [
                "Answer only from the supplied repository facts.",
                "If the context is insufficient, say so explicitly."
            ]
        };

        const providerResponse = await this.provider.answer(providerRequest);

        if (providerResponse.status === "insufficient_context") {
            return {
                status: "insufficient_context",
                answer: providerResponse.answer || "The supplied repository context is insufficient to answer this question reliably.",
                citations: providerResponse.citations ?? [],
                confidence: providerResponse.confidence ?? "low",
                missingData: providerResponse.missingData,
                error: providerResponse.error
            };
        }

        if (providerResponse.status === "error") {
            return {
                status: "error",
                answer: providerResponse.answer || "The AI provider failed to answer the question.",
                citations: providerResponse.citations ?? [],
                confidence: providerResponse.confidence ?? "low",
                error: providerResponse.error,
                missingData: providerResponse.missingData
            };
        }

        return {
            status: "ok",
            answer: providerResponse.answer,
            citations: providerResponse.citations,
            confidence: providerResponse.confidence,
            missingData: providerResponse.missingData
        };
    }
}
