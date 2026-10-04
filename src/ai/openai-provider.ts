import type { LlmCitation, LlmProvider, LlmRequest, LlmResponse } from "./provider";
import {
    createOpenAIConfigFromEnvironment,
    validateOpenAIConfig,
    getLlmConfig,
    type OpenAIConfig
} from "./config";

export interface OpenAIMessage {
    role: "system" | "user";
    content: string;
}

export interface OpenAIChatCompletionResponse {
    choices?: Array<{ message?: { content?: string; reasoning?: string } }>;
    error?: {
        message?: string;
        code?: string;
    };
}

export class OpenAIProvider implements LlmProvider {
    constructor(private readonly explicitConfig?: Partial<OpenAIConfig>) { }

    private resolveConfig(): OpenAIConfig {
        const base = this.explicitConfig ? this.explicitConfig : getLlmConfig();
        return validateOpenAIConfig(base);
    }

    private buildUrl(baseUrl: string): string {
        const cleaned = baseUrl.replace(/\/+$/, "");
        return `${cleaned}/chat/completions`;
    }

    private isReasoningModel(model: string): boolean {
        const lower = model.toLowerCase();
        return lower.includes("gpt-oss") || lower.includes("o1") || lower.includes("o3");
    }

    private async fetchCompletion(
        config: OpenAIConfig,
        messages: OpenAIMessage[],
        request: LlmRequest
    ): Promise<Response> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
        const url = this.buildUrl(config.baseUrl);

        const isReasoning = this.isReasoningModel(config.model);
        const tokenLimit = request.responseOptions?.maxTokens ?? config.maxTokens;

        const bodyPayload: Record<string, unknown> = {
            model: config.model,
            messages
        };

        if (isReasoning) {
            bodyPayload.max_completion_tokens = tokenLimit;
            bodyPayload.reasoning_effort = "low";
        } else {
            bodyPayload.max_tokens = tokenLimit;
            bodyPayload.temperature = request.responseOptions?.temperature ?? 0.1;
        }

        console.log(`[OpenAIProvider] Sending request: URL=${url}, payload=${JSON.stringify(bodyPayload)}`);

        try {
            return await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${config.apiKey}`
                },
                body: JSON.stringify(bodyPayload),
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeout);
        }
    }

    async answer(request: LlmRequest): Promise<LlmResponse> {
        try {
            const config = this.resolveConfig();

            // Truncate large facts content (evidence, fileContent) to ~12000 chars
            let factsPayload: unknown = request.facts;
            const factsObj = request.facts && typeof request.facts === "object" ? (request.facts as Record<string, unknown>) : null;
            if (factsObj) {
                const evidenceList = Array.isArray(factsObj.evidence) ? factsObj.evidence : [];
                const cappedEvidence = evidenceList.map((item: any) => {
                    if (item && typeof item.code === "string" && item.code.length > 12000) {
                        return { ...item, code: item.code.slice(0, 12000) + "\n...[truncated]" };
                    }
                    return item;
                });
                let cappedFileContent = factsObj.fileContent;
                if (typeof cappedFileContent === "string" && cappedFileContent.length > 12000) {
                    cappedFileContent = cappedFileContent.slice(0, 12000) + "\n...[truncated]";
                }
                factsPayload = {
                    ...factsObj,
                    ...(cappedFileContent !== undefined ? { fileContent: cappedFileContent } : {}),
                    ...(evidenceList.length > 0 ? { evidence: cappedEvidence } : {})
                };
            }

            const messages: OpenAIMessage[] = [
                {
                    role: "system",
                    content: [
                        "You are a repository Q&A assistant.",
                        "Answer only from the supplied repository facts.",
                        "Do not invent repository facts.",
                        "Do not claim information not present in the context.",
                        "If context is insufficient, say so explicitly.",
                        "Cite relevant file paths, symbol names, or commit SHAs when possible.",
                        "Answer in short bullets.",
                        "Do not use markdown tables.",
                        "Mention file:line when possible.",
                        ...(request.instructions ?? [])
                    ].join(" ")
                },
                {
                    role: "user",
                    content: JSON.stringify({
                        repository: request.repository,
                        target: request.target,
                        question: request.question,
                        facts: factsPayload
                    }, null, 2)
                }
            ];

            // 1 retry on transient network errors (not timeout/auth/rate-limit)
            let response: Response;
            try {
                response = await this.fetchCompletion(config, messages, request);
            } catch (firstErr) {
                if (firstErr instanceof Error && firstErr.name === "AbortError") {
                    throw firstErr;
                }
                console.error("[OpenAIProvider] Transient error on first attempt, retrying once:", firstErr instanceof Error ? firstErr.message : String(firstErr));
                response = await this.fetchCompletion(config, messages, request);
            }

            if (!response.ok) {
                const responseText = await response.text().catch(() => "");
                const requestUrl = this.buildUrl(config.baseUrl);
                console.error(`[OpenAIProvider] Request failed: URL=${requestUrl}, model=${config.model}, status=${response.status}, body=${responseText}`);

                if (response.status === 400) {
                    return {
                        status: "error",
                        answer: "",
                        citations: [],
                        confidence: "low",
                        error: {
                            code: "bad_request",
                            message: `The AI provider rejected the request (400): ${responseText}`
                        }
                    };
                }

                if (response.status === 401) {
                    return {
                        status: "error",
                        answer: "",
                        citations: [],
                        confidence: "low",
                        error: {
                            code: "invalid_api_key",
                            message: "The configured API key is invalid."
                        }
                    };
                }

                if (response.status === 429) {
                    return {
                        status: "error",
                        answer: "",
                        citations: [],
                        confidence: "low",
                        error: {
                            code: "rate_limited",
                            message: "The API rate limit was reached."
                        }
                    };
                }

                if (response.status === 404) {
                    const mentionsModel = responseText.toLowerCase().includes("model");
                    if (mentionsModel) {
                        return {
                            status: "error",
                            answer: "",
                            citations: [],
                            confidence: "low",
                            error: {
                                code: "model_not_found",
                                message: "The requested model could not be found."
                            }
                        };
                    }
                    return {
                        status: "error",
                        answer: "",
                        citations: [],
                        confidence: "low",
                        error: {
                            code: "provider_unavailable",
                            message: `The AI provider endpoint was not found (404): ${responseText}`
                        }
                    };
                }

                return {
                    status: "error",
                    answer: "",
                    citations: [],
                    confidence: "low",
                    error: {
                        code: "provider_unavailable",
                        message: `The AI provider request failed with status ${response.status}: ${responseText}`
                    }
                };
            }

            const data = (await response.json()) as OpenAIChatCompletionResponse;
            const messageObj = data.choices?.[0]?.message;
            const content = messageObj?.content?.trim() || messageObj?.reasoning?.trim() || "";

            if (!content) {
                return {
                    status: "error",
                    answer: "",
                    citations: [],
                    confidence: "low",
                    error: {
                        code: "malformed_response",
                        message: "The AI provider returned an empty response."
                    }
                };
            }

            const citationMatches = content.match(/\b(?:[\w./\\-]+):(?:\d+)\b/g);
            const citations: LlmCitation[] = citationMatches
                ? Array.from(new Set(citationMatches)).map((c) => ({
                    type: "file" as const,
                    path: c
                }))
                : [];

            return {
                status: "ok",
                answer: content,
                citations,
                confidence: "medium"
            };
        } catch (error) {
            console.error("[OpenAIProvider] Network or provider error:", error instanceof Error ? error.message : String(error));
            const detailMsg = error instanceof Error ? error.message : String(error);
            return {
                status: "error",
                answer: "",
                citations: [],
                confidence: "low",
                error: {
                    code: "provider_unavailable",
                    message: `The AI provider could not be reached: ${detailMsg}`
                }
            };
        }
    }
}
