import type { RepositoryGraph } from "../graph/repository-graph";
import { assembleRepositoryContext, type RepositoryContextRequest } from "../graph/repository-context";
import { buildAiContext, MAX_AI_CONTEXT_BYTES, type AiRepositoryContext } from "./context";
import { validateRepositoryContextConsistency } from "./consistency-validator";
import type { LlmProvider, LlmRequest, LlmResponse } from "./provider";
import type { RepositorySourceEvidence } from "../services/repository-source-evidence-service";
import type { ChangeImpactAnalysisResult } from "../services/change-impact-analysis-service";

export interface AiAnswerRequest extends RepositoryContextRequest {
    repository: string;
    question: string;
    graph: RepositoryGraph;
    allowInsufficientContext?: boolean;
    evidence?: RepositorySourceEvidence[];
    impact?: ChangeImpactAnalysisResult;
    fileContent?: string;
    lang?: "en" | "hinglish";
    history?: Array<{ role: string; content: string }>;
}

export interface AiAnswerResult extends LlmResponse {
    status: "ok" | "insufficient_context" | "error";
}

export function isGroundedQuestion(question: string, target: { type: string; path?: string; symbolName?: string; sha?: string }): boolean {
    const normalized = question.toLowerCase();
    const basename = target.path ? target.path.split(/[/\\]/).pop()?.toLowerCase() : undefined;
    const specificTargets = [
        target.path,
        basename,
        target.symbolName,
        target.sha
    ].filter((value): value is string => typeof value === "string" && value.length > 0);

    // Treat "this", "ye", "yeh", "is file" as the currently selected file
    const filePronouns = [/\bthis\b/, /\bye\b/, /\byeh\b/, /\bis file\b/];
    const hasFilePronoun = filePronouns.some((re) => re.test(normalized));

    if (target.type === "file" && hasFilePronoun) {
        if (!normalized.includes("this repo") && !normalized.includes("this repository")) {
            return true;
        }
    }

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

    if (target.type === "file") {
        return true;
    }

    if (specificTargets.some((value) => normalized.includes(value.toLowerCase()))) {
        return true;
    }

    const questionPatterns = [
        "what does",
        "what is",
        "which",
        "who",
        "when",
        "why",
        "how",
        "explain",
        "describe",
        "summarize",
        "tell me about",
        "show"
    ];

    return questionPatterns.some((pattern) => normalized.includes(pattern));
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

        const consistency = validateRepositoryContextConsistency({
            graph: request.graph,
            evidence: request.evidence,
            impact: request.impact
        });
        if (consistency.status === "invalid") {
            return {
                status: "error",
                answer: "The assembled repository context contradicts the repository graph, so it was not sent to the AI provider.",
                citations: [],
                confidence: "low",
                error: {
                    code: "invalid_graph",
                    message: "Impact paths or source evidence do not match the repository graph."
                },
                missingData: consistency.missingData ?? ["inconsistent_context"]
            };
        }

        let aiContext = buildAiContext(result.context, request.repository, request.evidence, request.impact, request.fileContent);
        let serializedContext = JSON.stringify(aiContext);
        if (serializedContext.length > MAX_AI_CONTEXT_BYTES) {
            // Trim fileContent or evidence to fit within MAX_AI_CONTEXT_BYTES instead of refusing
            if (aiContext.fileContent && aiContext.fileContent.length > 8000) {
                const trimBudget = 8000;
                aiContext = {
                    ...aiContext,
                    fileContent: aiContext.fileContent.slice(0, trimBudget),
                    fileTruncated: true,
                    fileTruncatedLines: aiContext.fileTruncatedLines ?? 150
                };
                serializedContext = JSON.stringify(aiContext);
            }
        }

        const isFileSelected = request.target.type === "file" || aiContext.target.type === "file";
        if (request.allowInsufficientContext && !isGroundedQuestion(request.question, aiContext.target)) {
            return {
                status: "insufficient_context",
                answer: "The supplied repository context is insufficient to answer this question reliably.",
                citations: [],
                confidence: "low",
                missingData: ["question_requires_unavailable_repository_context"]
            };
        }

        const instructions = [
            "Answer only from the supplied repository facts.",
            "If the context is insufficient, say so explicitly.",
            "Reply in the same language and script as the user's latest message. If the user writes Hindi in Roman script (Hinglish), reply in natural Hinglish. If Devanagari, reply in Hindi. If English, reply in English. Keep code, file names, identifiers and technical terms unchanged. Never mention this rule.",
            "End with a line FOLLOWUPS: q1 | q2 | q3 (short questions)"
        ];

        const providerRequest: LlmRequest = {
            repository: request.repository,
            target: aiContext.target,
            question: request.question,
            facts: {
                ...aiContext,
                ...(request.history && request.history.length > 0 ? { history: request.history } : {})
            },
            instructions,
            history: request.history
        };

        const providerResponse = await this.provider.answer(providerRequest);

        if (providerResponse.status === "insufficient_context") {
            if (isFileSelected) {
                return {
                    status: "ok",
                    answer: providerResponse.answer || "Based on the selected file context.",
                    citations: providerResponse.citations ?? (aiContext.target.path ? [{ type: "file", path: aiContext.target.path }] : []),
                    confidence: "medium"
                };
            }
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

        let finalAnswer = providerResponse.answer;
        if (aiContext.fileTruncated) {
            const linesCount = aiContext.fileTruncatedLines ?? 150;
            const truncationNotice = `Based on the outline and first ${linesCount} lines.`;
            if (finalAnswer) {
                finalAnswer = `${finalAnswer}\n\n${truncationNotice}`;
            } else {
                finalAnswer = truncationNotice;
            }
        }

        return {
            status: "ok",
            answer: finalAnswer,
            citations: providerResponse.citations,
            confidence: providerResponse.confidence,
            missingData: providerResponse.missingData
        };
    }

    async streamAnswer(
        request: AiAnswerRequest,
        onToken: (token: string) => void
    ): Promise<AiAnswerResult> {
        if (!this.provider.streamAnswer) {
            return this.answer(request);
        }

        if (typeof request.question !== "string" || request.question.trim().length === 0) {
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

        const consistency = validateRepositoryContextConsistency({
            graph: request.graph,
            evidence: request.evidence,
            impact: request.impact
        });
        if (consistency.status === "invalid") {
            return {
                status: "error",
                answer: "The assembled repository context contradicts the repository graph, so it was not sent to the AI provider.",
                citations: [],
                confidence: "low",
                error: {
                    code: "invalid_graph",
                    message: "Impact paths or source evidence do not match the repository graph."
                },
                missingData: consistency.missingData ?? ["inconsistent_context"]
            };
        }

        let aiContext = buildAiContext(result.context, request.repository, request.evidence, request.impact, request.fileContent);
        let serializedContext = JSON.stringify(aiContext);
        if (serializedContext.length > MAX_AI_CONTEXT_BYTES) {
            if (aiContext.fileContent && aiContext.fileContent.length > 8000) {
                const trimBudget = 8000;
                aiContext = {
                    ...aiContext,
                    fileContent: aiContext.fileContent.slice(0, trimBudget),
                    fileTruncated: true,
                    fileTruncatedLines: aiContext.fileTruncatedLines ?? 150
                };
                serializedContext = JSON.stringify(aiContext);
            }
        }

        const isFileSelected = request.target.type === "file" || aiContext.target.type === "file";
        if (!isFileSelected && request.allowInsufficientContext && !isGroundedQuestion(request.question, aiContext.target)) {
            return {
                status: "insufficient_context",
                answer: "The supplied repository context is insufficient to answer this question reliably.",
                citations: [],
                confidence: "low",
                missingData: ["question_requires_unavailable_repository_context"]
            };
        }

        const instructions = [
            "Answer only from the supplied repository facts.",
            "If the context is insufficient, say so explicitly.",
            "Reply in the same language and script as the user's latest message. If the user writes Hindi in Roman script (Hinglish), reply in natural Hinglish. If Devanagari, reply in Hindi. If English, reply in English. Keep code, file names, identifiers and technical terms unchanged. Never mention this rule.",
            "End with a line FOLLOWUPS: q1 | q2 | q3 (short questions)"
        ];

        const providerRequest: LlmRequest = {
            repository: request.repository,
            target: aiContext.target,
            question: request.question,
            facts: {
                ...aiContext,
                ...(request.history && request.history.length > 0 ? { history: request.history } : {})
            },
            instructions,
            history: request.history
        };

        try {
            const providerResponse = await this.provider.streamAnswer(providerRequest, onToken);

            if (providerResponse.status === "insufficient_context") {
                if (isFileSelected) {
                    return {
                        status: "ok",
                        answer: providerResponse.answer || "Based on the selected file context.",
                        citations: providerResponse.citations ?? (aiContext.target.path ? [{ type: "file", path: aiContext.target.path }] : []),
                        confidence: "medium"
                    };
                }
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

            let finalAnswer = providerResponse.answer;
            if (aiContext.fileTruncated) {
                const linesCount = aiContext.fileTruncatedLines ?? 150;
                const truncationNotice = `Based on the outline and first ${linesCount} lines.`;
                if (finalAnswer) {
                    finalAnswer = `${finalAnswer}\n\n${truncationNotice}`;
                } else {
                    finalAnswer = truncationNotice;
                }
            }

            return {
                status: "ok",
                answer: finalAnswer,
                citations: providerResponse.citations,
                confidence: providerResponse.confidence,
                missingData: providerResponse.missingData
            };
        } catch {
            // Fall back to non-streaming path if streaming fails
            return this.answer(request);
        }
    }
}
