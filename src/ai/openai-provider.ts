import type { LlmProvider, LlmRequest, LlmResponse } from "./provider";
import { createOpenAIConfigFromEnvironment, validateOpenAIConfig } from "./config";

export interface OpenAIMessage {
    role: "system" | "user";
    content: string;
}

export interface OpenAIChatCompletionResponse {
    choices?: Array<{ message?: { content?: string } }>;
    error?: {
        message?: string;
        code?: string;
    };
}

export class OpenAIProvider implements LlmProvider {
    constructor(private readonly config = createOpenAIConfigFromEnvironment()) {}

    async answer(request: LlmRequest): Promise<LlmResponse> {
        try {
            const config = validateOpenAIConfig(this.config);
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
                        ...(request.instructions ?? [])
                    ].join(" ")
                },
                {
                    role: "user",
                    content: JSON.stringify({
                        repository: request.repository,
                        target: request.target,
                        question: request.question,
                        facts: request.facts
                    }, null, 2)
                }
            ];

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

            const response = await fetch(`${config.baseUrl}/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${config.apiKey}`
                },
                body: JSON.stringify({
                    model: config.model,
                    messages,
                    temperature: request.responseOptions?.temperature ?? 0.1,
                    max_tokens: request.responseOptions?.maxTokens ?? config.maxTokens
                }),
                signal: controller.signal
            });

            clearTimeout(timeout);

            if (response.status === 401) {
                return {
                    status: "error",
                    answer: "",
                    citations: [],
                    confidence: "low",
                    error: {
                        code: "invalid_api_key",
                        message: "The configured OpenAI API key is invalid."
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
                        code: "rate_limit",
                        message: "The OpenAI API rate limit was exceeded."
                    }
                };
            }

            if (response.status >= 500) {
                return {
                    status: "error",
                    answer: "",
                    citations: [],
                    confidence: "low",
                    error: {
                        code: "provider_unavailable",
                        message: "The OpenAI provider is unavailable."
                    }
                };
            }

            if (!response.ok) {
                return {
                    status: "error",
                    answer: "",
                    citations: [],
                    confidence: "low",
                    error: {
                        code: "provider_unavailable",
                        message: "The OpenAI request failed."
                    }
                };
            }

            const data = (await response.json()) as OpenAIChatCompletionResponse;
            const content = data.choices?.[0]?.message?.content?.trim() ?? "";

            if (!content) {
                return {
                    status: "error",
                    answer: "",
                    citations: [],
                    confidence: "low",
                    error: {
                        code: "malformed_response",
                        message: "The OpenAI provider returned an empty response."
                    }
                };
            }

            return {
                status: "ok",
                answer: content,
                citations: [],
                confidence: "medium"
            };
        } catch (error) {
            if (error instanceof Error && error.name === "AbortError") {
                return {
                    status: "error",
                    answer: "",
                    citations: [],
                    confidence: "low",
                    error: {
                        code: "timeout",
                        message: "The OpenAI request timed out."
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
                    message: "The OpenAI provider could not be reached."
                }
            };
        }
    }
}
