import type { LlmCitation, LlmProvider, LlmRequest, LlmResponse } from "./provider";
import {
    createOpenAIConfigFromEnvironment,
    validateOpenAIConfig,
    getLlmConfig,
    type OpenAIConfig
} from "./config";
import { detectLang, getLanguageDirective, getSystemInstructions } from "./prompt-builder";

export interface OpenAIMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

export interface OpenAIChatCompletionResponse {
    choices?: Array<{ message?: { content?: string; reasoning?: string }; delta?: { content?: string; reasoning?: string } }>;
    error?: {
        message?: string;
        code?: string;
    };
}

export interface ProviderCandidate {
    provider: string;
    apiKey: string;
    baseUrl: string;
    model: string;
}

export class StreamDelimiterFilter {
    private buffer = "";
    private insideBlock: string | null = null;

    constructor(private readonly onToken: (token: string) => void) {}

    public feed(delta: string): void {
        this.buffer += delta;

        while (this.buffer.length > 0) {
            if (this.insideBlock !== null) {
                const closeIdx = this.buffer.indexOf(this.insideBlock);
                if (closeIdx !== -1) {
                    this.buffer = this.buffer.slice(closeIdx + this.insideBlock.length);
                    this.insideBlock = null;
                } else {
                    const tag = this.insideBlock;
                    let maxPartialMatch = 0;
                    for (let len = 1; len < tag.length; len++) {
                        if (this.buffer.endsWith(tag.slice(0, len))) {
                            maxPartialMatch = len;
                        }
                    }
                    if (maxPartialMatch > 0) {
                        this.buffer = this.buffer.slice(-maxPartialMatch);
                    } else {
                        this.buffer = "";
                    }
                    break;
                }
            } else {
                const openIdx = this.buffer.indexOf("<<<");
                if (openIdx !== -1) {
                    if (openIdx > 0) {
                        this.onToken(this.buffer.slice(0, openIdx));
                        this.buffer = this.buffer.slice(openIdx);
                    }
                    const endBracketIdx = this.buffer.indexOf(">>>");
                    if (endBracketIdx !== -1) {
                        const tag = this.buffer.slice(0, endBracketIdx + 3);
                        this.buffer = this.buffer.slice(endBracketIdx + 3);
                        if (tag === "<<<EVIDENCE>>>") {
                            this.insideBlock = "<<<END_EVIDENCE>>>";
                        } else if (tag === "<<<FOLLOWUPS>>>") {
                            this.insideBlock = "<<<END_FOLLOWUPS>>>";
                        } else {
                            this.insideBlock = `<<<END_${tag.slice(3)}`;
                        }
                    } else {
                        if (this.buffer.length > 40) {
                            this.onToken(this.buffer);
                            this.buffer = "";
                        }
                        break;
                    }
                } else {
                    if (this.buffer.endsWith("<<")) {
                        if (this.buffer.length > 2) {
                            this.onToken(this.buffer.slice(0, -2));
                            this.buffer = "<<";
                        }
                        break;
                    } else if (this.buffer.endsWith("<")) {
                        if (this.buffer.length > 1) {
                            this.onToken(this.buffer.slice(0, -1));
                            this.buffer = "<";
                        }
                        break;
                    } else {
                        this.onToken(this.buffer);
                        this.buffer = "";
                        break;
                    }
                }
            }
        }
    }

    public flush(): void {
        if (this.insideBlock === null && this.buffer.length > 0) {
            this.onToken(this.buffer);
            this.buffer = "";
        }
    }
}

let cachedGeminiModel: { model: string; expiresAt: number } | null = null;

export async function discoverGeminiModel(baseUrl: string, apiKey: string): Promise<string> {
    if (cachedGeminiModel && Date.now() < cachedGeminiModel.expiresAt) {
        return cachedGeminiModel.model;
    }
    try {
        const cleaned = baseUrl.replace(/\/+$/, "");
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(`${cleaned}/models`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: controller.signal
        });
        clearTimeout(timeout);
        if (!res.ok) {
            return "gemini-flash-latest";
        }
        const json = (await res.json()) as { data?: Array<{ id: string }> };
        const items = Array.isArray(json.data) ? json.data : [];
        const excluded = ["lite", "image", "tts", "live", "audio", "embedding", "preview"];
        const matches = items
            .map((m) => m.id)
            .filter((id) => {
                const lower = id.toLowerCase();
                return lower.includes("flash") && !excluded.some((ex) => lower.includes(ex));
            });
        if (matches.length === 0) {
            return "gemini-flash-latest";
        }
        matches.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        const selected = matches[0] || "gemini-flash-latest";
        cachedGeminiModel = { model: selected, expiresAt: Date.now() + 60 * 60 * 1000 };
        return selected;
    } catch {
        return "gemini-flash-latest";
    }
}

function parseRetryAfter(header: string | null): number {
    if (!header) return 60;
    const sec = Number.parseInt(header, 10);
    if (Number.isFinite(sec) && sec > 0) return sec;
    const dateMs = Date.parse(header);
    if (!Number.isNaN(dateMs)) {
        return Math.max(1, Math.ceil((dateMs - Date.now()) / 1000));
    }
    return 60;
}

export class OpenAIProvider implements LlmProvider {
    public static cooldowns: Map<string, number> = new Map();

    public static getCooldown(provider: string, model: string): number {
        const expiresAt = OpenAIProvider.cooldowns.get(`${provider}:${model}`);
        if (!expiresAt) return 0;
        const remainingMs = expiresAt - Date.now();
        if (remainingMs <= 0) {
            OpenAIProvider.cooldowns.delete(`${provider}:${model}`);
            return 0;
        }
        return Math.ceil(remainingMs / 1000);
    }

    public static setCooldown(provider: string, model: string, seconds?: number): void {
        const duration = Math.min(300, Math.max(1, seconds ?? 60));
        OpenAIProvider.cooldowns.set(`${provider}:${model}`, Date.now() + duration * 1000);
    }

    public static clearCooldowns(): void {
        OpenAIProvider.cooldowns.clear();
    }

    constructor(private readonly explicitConfig?: Partial<OpenAIConfig>) {}

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
        return lower.includes("gpt-oss");
    }

    private async getCandidates(config: OpenAIConfig): Promise<ProviderCandidate[]> {
        const chain: ProviderCandidate[] = [];
        const primaryModel = config.model || "openai/gpt-oss-120b";

        chain.push({
            provider: "groq",
            apiKey: config.apiKey,
            baseUrl: config.baseUrl || "https://api.groq.com/openai/v1",
            model: primaryModel
        });

        const secondaryModel = "openai/gpt-oss-20b";
        if (secondaryModel !== primaryModel) {
            chain.push({
                provider: "groq",
                apiKey: config.apiKey,
                baseUrl: config.baseUrl || "https://api.groq.com/openai/v1",
                model: secondaryModel
            });
        }

        if (config.fallbackApiKey) {
            const fallbackBase = config.fallbackBaseUrl || "https://generativelanguage.googleapis.com/v1beta/openai/";
            let fallbackModel = config.fallbackModel;
            if (!fallbackModel) {
                fallbackModel = await discoverGeminiModel(fallbackBase, config.fallbackApiKey);
            }
            chain.push({
                provider: "fallback",
                apiKey: config.fallbackApiKey,
                baseUrl: fallbackBase,
                model: fallbackModel
            });
        }

        return chain;
    }

    private async fetchCompletionCandidate(
        candidate: ProviderCandidate,
        messages: OpenAIMessage[],
        request: LlmRequest,
        stream = false,
        timeoutMs = 20000
    ): Promise<Response> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const url = this.buildUrl(candidate.baseUrl);

        const isReasoning = this.isReasoningModel(candidate.model);
        const tokenLimit = request.responseOptions?.maxTokens ?? 1500;

        const bodyPayload: Record<string, unknown> = {
            model: candidate.model,
            messages
        };

        if (stream) {
            bodyPayload.stream = true;
        }

        if (isReasoning) {
            bodyPayload.max_completion_tokens = tokenLimit;
            bodyPayload.reasoning_effort = "low";
        } else {
            bodyPayload.max_tokens = tokenLimit;
            bodyPayload.temperature = request.responseOptions?.temperature ?? 0.2;
        }

        try {
            return await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${candidate.apiKey}`
                },
                body: JSON.stringify(bodyPayload),
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeout);
        }
    }

    private buildMessages(request: LlmRequest): OpenAIMessage[] {
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

        const instructions = getSystemInstructions(request.mode, request.instructions);

        const messages: OpenAIMessage[] = [
            {
                role: "system",
                content: instructions.join(" ")
            }
        ];

        if (Array.isArray(request.history)) {
            const trimmedHistory = request.history
                .filter((h) => Boolean(h && typeof h.content === "string"))
                .slice(-4);
            for (const h of trimmedHistory) {
                messages.push({
                    role: h.role === "assistant" ? "assistant" : "user",
                    content: h.role === "assistant" && h.content.length > 600
                        ? h.content.slice(0, 600)
                        : h.content
                });
            }
        }

        const lang = detectLang(request.question);
        const directive = getLanguageDirective(lang);

        const userPayload = JSON.stringify({
            repository: request.repository,
            target: request.target,
            question: request.question,
            facts: factsPayload
        }, null, 2);

        const finalUserContent = userPayload.endsWith(directive)
            ? userPayload
            : `${userPayload}\n\n${directive}`;

        messages.push({
            role: "user",
            content: finalUserContent
        });

        return messages;
    }

    async answer(request: LlmRequest): Promise<LlmResponse> {
        let config: OpenAIConfig;
        try {
            config = this.resolveConfig();
        } catch (err) {
            return {
                status: "error",
                answer: "",
                citations: [],
                confidence: "low",
                error: {
                    code: "missing_api_key",
                    message: err instanceof Error ? err.message : "Missing API configuration."
                }
            };
        }

        const messages = this.buildMessages(request);
        const candidates = await this.getCandidates(config);
        const timeoutMs = config.timeoutMs || 20000;

        let hadRateLimit = false;
        const remainingCooldowns: number[] = [];

        for (const candidate of candidates) {
            const cooldown = OpenAIProvider.getCooldown(candidate.provider, candidate.model);
            if (cooldown > 0) {
                hadRateLimit = true;
                remainingCooldowns.push(cooldown);
                continue;
            }

            try {
                const response = await this.fetchCompletionCandidate(candidate, messages, request, false, timeoutMs);

                if (response.ok) {
                    const data = (await response.json()) as OpenAIChatCompletionResponse;
                    const messageObj = data.choices?.[0]?.message;
                    const content = messageObj?.content?.trim() || messageObj?.reasoning?.trim() || "";

                    if (!content) {
                        OpenAIProvider.setCooldown(candidate.provider, candidate.model, 60);
                        continue;
                    }

                    const citationMatches = content.match(/\b(?:[\w./\\-]+):(?:\d+)\b/g);
                    const citations: LlmCitation[] = citationMatches
                        ? Array.from(new Set(citationMatches)).map((c) => ({
                            type: "file" as const,
                            path: c
                        }))
                        : [];

                    const factsObj = request.facts && typeof request.facts === "object" ? (request.facts as any) : null;
                    const filesCount = factsObj && Array.isArray(factsObj.files) ? factsObj.files.length : 1;
                    const commitsCount = factsObj && Array.isArray(factsObj.commits) ? factsObj.commits.length : 0;

                    return {
                        status: "ok",
                        answer: content,
                        citations,
                        confidence: "medium",
                        usedContext: {
                            files: filesCount,
                            commits: commitsCount,
                            provider: candidate.provider,
                            model: candidate.model,
                            cached: false
                        }
                    };
                } else {
                    const retrySec = parseRetryAfter(response.headers.get("retry-after"));
                    if (response.status === 429) {
                        hadRateLimit = true;
                        OpenAIProvider.setCooldown(candidate.provider, candidate.model, retrySec);
                        remainingCooldowns.push(retrySec);
                    } else if (response.status >= 500) {
                        OpenAIProvider.setCooldown(candidate.provider, candidate.model, retrySec);
                    } else {
                        OpenAIProvider.setCooldown(candidate.provider, candidate.model, 180);
                    }
                    continue;
                }
            } catch {
                OpenAIProvider.setCooldown(candidate.provider, candidate.model, 60);
                continue;
            }
        }

        if (hadRateLimit) {
            const minRetry = remainingCooldowns.length > 0 ? Math.min(...remainingCooldowns) : 60;
            return {
                status: "error",
                answer: "",
                citations: [],
                confidence: "low",
                retryAfterSeconds: minRetry,
                error: {
                    code: "rate_limited",
                    message: "All AI providers are currently rate limited."
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
                message: "All AI providers are unavailable."
            }
        };
    }

    async streamAnswer(
        request: LlmRequest,
        onToken: (token: string) => void
    ): Promise<LlmResponse> {
        let config: OpenAIConfig;
        try {
            config = this.resolveConfig();
        } catch (err) {
            return {
                status: "error",
                answer: "",
                citations: [],
                confidence: "low",
                error: {
                    code: "missing_api_key",
                    message: err instanceof Error ? err.message : "Missing API configuration."
                }
            };
        }

        const messages = this.buildMessages(request);
        const candidates = await this.getCandidates(config);
        const timeoutMs = config.timeoutMs || 20000;

        let hadRateLimit = false;
        const remainingCooldowns: number[] = [];

        for (const candidate of candidates) {
            const cooldown = OpenAIProvider.getCooldown(candidate.provider, candidate.model);
            if (cooldown > 0) {
                hadRateLimit = true;
                remainingCooldowns.push(cooldown);
                continue;
            }

            try {
                const response = await this.fetchCompletionCandidate(candidate, messages, request, true, timeoutMs);

                if (!response.ok) {
                    const retrySec = parseRetryAfter(response.headers.get("retry-after"));
                    if (response.status === 429) {
                        hadRateLimit = true;
                        OpenAIProvider.setCooldown(candidate.provider, candidate.model, retrySec);
                        remainingCooldowns.push(retrySec);
                    } else if (response.status >= 500) {
                        OpenAIProvider.setCooldown(candidate.provider, candidate.model, retrySec);
                    } else {
                        OpenAIProvider.setCooldown(candidate.provider, candidate.model, 180);
                    }
                    continue;
                }

                if (!response.body) {
                    continue;
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                const filter = new StreamDelimiterFilter(onToken);
                let buffer = "";
                let accumulatedContent = "";

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split("\n");
                    buffer = lines.pop() ?? "";

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed.startsWith("data:")) continue;
                        const dataStr = trimmed.slice(5).trim();
                        if (dataStr === "[DONE]") continue;

                        try {
                            const parsed = JSON.parse(dataStr) as OpenAIChatCompletionResponse;
                            const delta = parsed.choices?.[0]?.delta;
                            const contentDelta = delta?.content;
                            if (typeof contentDelta === "string" && contentDelta.length > 0) {
                                accumulatedContent += contentDelta;
                                filter.feed(contentDelta);
                            }
                        } catch {
                            // Non-json chunk ignored
                        }
                    }
                }

                filter.flush();

                const trimmedContent = accumulatedContent.trim();
                if (!trimmedContent) {
                    continue;
                }

                const citationMatches = trimmedContent.match(/\b(?:[\w./\\-]+):(?:\d+)\b/g);
                const citations: LlmCitation[] = citationMatches
                    ? Array.from(new Set(citationMatches)).map((c) => ({
                        type: "file" as const,
                        path: c
                    }))
                    : [];

                const factsObj = request.facts && typeof request.facts === "object" ? (request.facts as any) : null;
                const filesCount = factsObj && Array.isArray(factsObj.files) ? factsObj.files.length : 1;
                const commitsCount = factsObj && Array.isArray(factsObj.commits) ? factsObj.commits.length : 0;

                return {
                    status: "ok",
                    answer: trimmedContent,
                    citations,
                    confidence: "medium",
                    usedContext: {
                        files: filesCount,
                        commits: commitsCount,
                        provider: candidate.provider,
                        model: candidate.model,
                        cached: false
                    }
                };
            } catch {
                OpenAIProvider.setCooldown(candidate.provider, candidate.model, 60);
                continue;
            }
        }

        if (hadRateLimit) {
            const minRetry = remainingCooldowns.length > 0 ? Math.min(...remainingCooldowns) : 60;
            return {
                status: "error",
                answer: "",
                citations: [],
                confidence: "low",
                retryAfterSeconds: minRetry,
                error: {
                    code: "rate_limited",
                    message: "All AI providers are currently rate limited."
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
                message: "All AI providers are unavailable."
            }
        };
    }
}
