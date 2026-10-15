import type { LlmCitation, LlmProvider, LlmRequest, LlmResponse } from "./provider";
import {
    createOpenAIConfigFromEnvironment,
    validateOpenAIConfig,
    getLlmConfig,
    type OpenAIConfig
} from "./config";
import { detectLang, getLanguageDirective, getSystemInstructions } from "./prompt-builder";
import { classifyQuestion, type QuestionClassification } from "./question-class";

export interface OpenAIMessage {
    role: "system" | "user" | "assistant";
    content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
}

export interface OpenAIChatCompletionResponse {
    choices?: Array<{
        message?: { content?: string; reasoning?: string };
        delta?: { content?: string; reasoning?: string };
        finish_reason?: string;
        finishReason?: string;
    }>;
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

export function filterAndSortGeminiModels(modelIds: string[]): string[] {
    const validIdRegex = /^[A-Za-z0-9][A-Za-z0-9._-]{1,80}$/;
    const excludedKeywords = [
        "preview", "exp", "experimental", "omni", "live", "tts", "audio",
        "image", "embedding", "thinking", "robotics", "computer-use", "native"
    ];

    const validModels = modelIds
        .map((id) => id.replace(/^models\//, "").trim())
        .filter((id) => {
            if (!validIdRegex.test(id)) return false;
            const lower = id.toLowerCase();
            if (!lower.startsWith("gemini-") || !lower.includes("flash")) return false;
            return !excludedKeywords.some((ex) => lower.includes(ex));
        });

    function parseVersion(id: string): number[] {
        const match = id.match(/^gemini-(\d+(?:\.\d+)*)/i);
        if (!match) return [];
        return match[1].split(".").map((num) => parseInt(num, 10));
    }

    validModels.sort((a, b) => {
        const vA = parseVersion(a);
        const vB = parseVersion(b);
        const maxLen = Math.max(vA.length, vB.length);
        for (let i = 0; i < maxLen; i++) {
            const numA = vA[i] ?? 0;
            const numB = vB[i] ?? 0;
            if (numA !== numB) return numB - numA; // Descending
        }
        const aIsLite = a.toLowerCase().includes("lite");
        const bIsLite = b.toLowerCase().includes("lite");
        if (!aIsLite && bIsLite) return -1;
        if (aIsLite && !bIsLite) return 1;
        return a.localeCompare(b);
    });

    return validModels;
}

let cachedFallbackCandidates: { candidates: string[]; expiresAt: number } | null = null;
let loggedFallbackCandidates = false;

export function resetGeminiCandidatesCache(): void {
    cachedFallbackCandidates = null;
    loggedFallbackCandidates = false;
}

export async function getGeminiCandidateModels(baseUrl: string, apiKey: string, fallbackModelConfig?: string): Promise<string[]> {
    if (cachedFallbackCandidates && Date.now() < cachedFallbackCandidates.expiresAt) {
        return cachedFallbackCandidates.candidates;
    }

    const staticTail = ["gemini-flash-latest", "gemini-flash-lite-latest"];
    let discovered: string[] = [];

    try {
        const cleaned = baseUrl.replace(/\/+$/, "");
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(`${cleaned}/models`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (res.ok) {
            const json = (await res.json()) as { data?: Array<{ id: string }>; models?: Array<{ name?: string; id?: string }> };
            const rawList: string[] = [];
            if (Array.isArray(json.data)) {
                for (const item of json.data) {
                    if (item && typeof item.id === "string") rawList.push(item.id);
                }
            } else if (Array.isArray(json.models)) {
                for (const item of json.models) {
                    const id = item?.id || item?.name;
                    if (id && typeof id === "string") rawList.push(id);
                }
            }
            discovered = filterAndSortGeminiModels(rawList);
        }
    } catch {
        // Discovery failed, fallback to static tail
    }

    const validIdRegex = /^[A-Za-z0-9][A-Za-z0-9._-]{1,80}$/;
    const validConfigModel = fallbackModelConfig && validIdRegex.test(fallbackModelConfig.trim())
        ? fallbackModelConfig.trim()
        : null;

    const list: string[] = [];
    if (validConfigModel) {
        list.push(validConfigModel);
    }
    list.push(...discovered.slice(0, 4));
    list.push(...staticTail);

    const deduped = Array.from(new Set(list));

    cachedFallbackCandidates = {
        candidates: deduped,
        expiresAt: Date.now() + 60 * 60 * 1000 // 1 hour
    };

    if (!loggedFallbackCandidates) {
        console.log(`[AI Gemini candidates] order: ${deduped.join(", ")}`);
        loggedFallbackCandidates = true;
    }

    return deduped;
}

export async function discoverGeminiModel(baseUrl: string, apiKey: string): Promise<string> {
    const list = await getGeminiCandidateModels(baseUrl, apiKey);
    return list[0] || "gemini-flash-latest";
}

export function parseRetryAfter(header: string | null, body?: string): number {
    if (header) {
        const sec = Number.parseInt(header, 10);
        if (Number.isFinite(sec) && sec > 0) return sec;
        const dateMs = Date.parse(header);
        if (!Number.isNaN(dateMs)) {
            return Math.max(1, Math.ceil((dateMs - Date.now()) / 1000));
        }
    }
    if (body) {
        const match = body.match(/retryDelay["']?\s*:\s*["']?(\d+)/i);
        if (match && match[1]) {
            const sec = Number.parseInt(match[1], 10);
            if (Number.isFinite(sec) && sec > 0) return sec;
        }
    }
    return 60;
}

export class ImageRequestLock {
    private inFlight = false;
    private waitQueue: Array<() => void> = [];

    async acquire(timeoutMs = 5000): Promise<boolean> {
        if (!this.inFlight) {
            this.inFlight = true;
            return true;
        }

        return new Promise<boolean>((resolve) => {
            let timer: NodeJS.Timeout | null = null;
            let resolved = false;

            const onAvailable = () => {
                if (resolved) return;
                resolved = true;
                if (timer) clearTimeout(timer);
                this.inFlight = true;
                resolve(true);
            };

            timer = setTimeout(() => {
                if (resolved) return;
                resolved = true;
                const idx = this.waitQueue.indexOf(onAvailable);
                if (idx !== -1) {
                    this.waitQueue.splice(idx, 1);
                }
                resolve(false);
            }, timeoutMs);

            this.waitQueue.push(onAvailable);
        });
    }

    release(): void {
        const next = this.waitQueue.shift();
        if (next) {
            next();
        } else {
            this.inFlight = false;
        }
    }
}

export const imageRequestLock = new ImageRequestLock();

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

    private async getCandidates(
        config: OpenAIConfig,
        hasImages = false,
        classification?: QuestionClassification
    ): Promise<ProviderCandidate[]> {
        if (hasImages) {
            if (!config.fallbackApiKey) {
                return [];
            }
            const fallbackBase = config.fallbackBaseUrl || "https://generativelanguage.googleapis.com/v1beta/openai/";
            const candidateModels = await getGeminiCandidateModels(fallbackBase, config.fallbackApiKey, config.fallbackModel);
            return candidateModels.map((model) => ({
                provider: "fallback",
                apiKey: config.fallbackApiKey!,
                baseUrl: fallbackBase,
                model
            }));
        }

        const isGreetingOrBrief = classification?.isGreetingOrThanks ||
            classification?.questionClass === "greeting" ||
            classification?.length === "brief";
        const isStandard = classification?.length === "standard";

        const primaryModel = (isGreetingOrBrief || isStandard)
            ? "openai/gpt-oss-20b"
            : (config.model || "openai/gpt-oss-120b");

        const chain: ProviderCandidate[] = [];

        chain.push({
            provider: "groq",
            apiKey: config.apiKey,
            baseUrl: config.baseUrl || "https://api.groq.com/openai/v1",
            model: primaryModel
        });

        const fallbackModel = primaryModel === "openai/gpt-oss-20b"
            ? (config.model || "openai/gpt-oss-120b")
            : "openai/gpt-oss-20b";
        if (fallbackModel !== primaryModel) {
            chain.push({
                provider: "groq",
                apiKey: config.apiKey,
                baseUrl: config.baseUrl || "https://api.groq.com/openai/v1",
                model: fallbackModel
            });
        }

        if (config.fallbackApiKey) {
            const fallbackBase = config.fallbackBaseUrl || "https://generativelanguage.googleapis.com/v1beta/openai/";
            const candidateModels = await getGeminiCandidateModels(fallbackBase, config.fallbackApiKey, config.fallbackModel);
            for (const model of candidateModels) {
                chain.push({
                    provider: "fallback",
                    apiKey: config.fallbackApiKey,
                    baseUrl: fallbackBase,
                    model
                });
            }
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
        const isGemini = candidate.model.toLowerCase().includes("gemini") || candidate.provider === "fallback";
        const classification = request.classification || classifyQuestion(
            request.question,
            request.mode,
            Boolean(request.images && request.images.length > 0),
            candidate.model
        );
        const isGreetingOrBrief = classification.isGreetingOrThanks ||
            classification.questionClass === "greeting" ||
            classification.length === "brief";
        const isReview = request.mode === "review";

        let tokenLimit = request.responseOptions?.maxTokens ?? classification.maxTokens;
        const hasImages = Boolean(request.images && request.images.length > 0);
        if (isGreetingOrBrief) {
            tokenLimit = 400;
        } else if (hasImages) {
            tokenLimit = Math.max(tokenLimit, 1600);
        } else if (classification.length === "standard" || !request.responseOptions?.maxTokens) {
            if (classification.length === "standard") {
                tokenLimit = Math.max(tokenLimit, 1200);
            }
        }

        const reasoningEffort = (classification.length === "deep" && isReview)
            ? "medium"
            : "low";

        const bodyPayload: Record<string, unknown> = {
            model: candidate.model,
            messages
        };

        if (stream) {
            bodyPayload.stream = true;
        }

        if (isReasoning) {
            bodyPayload.max_completion_tokens = tokenLimit;
            bodyPayload.reasoning_effort = reasoningEffort;
        } else {
            bodyPayload.max_tokens = tokenLimit;
            bodyPayload.temperature = request.responseOptions?.temperature ?? 0.2;
            if (isGemini) {
                bodyPayload.reasoning_effort = "low";
            }
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

        const hasImages = Boolean(request.images && request.images.length > 0);
        const classification = request.classification || classifyQuestion(request.question, request.mode, hasImages);
        const instructions = getSystemInstructions(request.mode, request.instructions, hasImages, classification, request.scope);

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

        if (hasImages && request.images) {
            const userContentParts: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [
                { type: "text", text: finalUserContent }
            ];
            for (const img of request.images) {
                userContentParts.push({
                    type: "image_url",
                    image_url: {
                        url: `data:${img.mime};base64,${img.data}`
                    }
                });
            }
            messages.push({
                role: "user",
                content: userContentParts
            });
        } else {
            messages.push({
                role: "user",
                content: finalUserContent
            });
        }

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

        const hasImages = Boolean(request.images && request.images.length > 0);
        if (hasImages && !config.fallbackApiKey) {
            return {
                status: "error",
                answer: "",
                citations: [],
                confidence: "low",
                error: {
                    code: "vision_unavailable",
                    message: "Image analysis needs the fallback provider key"
                }
            };
        }

        if (hasImages) {
            const acquired = await imageRequestLock.acquire(5000);
            if (!acquired) {
                return {
                    status: "error",
                    answer: "",
                    citations: [],
                    confidence: "low",
                    retryAfterSeconds: 5,
                    error: {
                        code: "rate_limited",
                        message: "Image analysis is rate limited. Try again in 5s."
                    }
                };
            }
            try {
                return await this.executeAnswer(request, config, true);
            } finally {
                imageRequestLock.release();
            }
        }

        return await this.executeAnswer(request, config, false);
    }

    private async executeAnswer(request: LlmRequest, config: OpenAIConfig, hasImages: boolean): Promise<LlmResponse> {
        const messages = this.buildMessages(request);
        const classification = request.classification || classifyQuestion(
            request.question,
            request.mode,
            hasImages
        );
        const candidates = await this.getCandidates(config, hasImages, classification);
        const timeoutMs = config.timeoutMs || 20000;

        if (hasImages && candidates.length > 0 && candidates.every(c => OpenAIProvider.getCooldown(c.provider, c.model) > 0)) {
            const minCd = Math.min(...candidates.map(c => OpenAIProvider.getCooldown(c.provider, c.model)));
            return {
                status: "error",
                answer: "",
                citations: [],
                confidence: "low",
                retryAfterSeconds: minCd,
                error: {
                    code: "rate_limited",
                    message: `Image analysis is rate limited. Try again in ${minCd}s.`
                }
            };
        }

        let hadRateLimit = false;
        const remainingCooldowns: number[] = [];
        let lastImageError: { status: number; model: string; code?: string; snippet?: string } | null = null;

        for (let hop = 0; hop < candidates.length; hop++) {
            const candidate = candidates[hop];
            const cooldown = OpenAIProvider.getCooldown(candidate.provider, candidate.model);
            if (cooldown > 0) {
                hadRateLimit = true;
                remainingCooldowns.push(cooldown);
                if (hasImages) {
                    lastImageError = {
                        status: 429,
                        model: candidate.model,
                        code: "rate_limited"
                    };
                }
                continue;
            }

            try {
                const response = await this.fetchCompletionCandidate(candidate, messages, request, false, timeoutMs);

                if (response.ok) {
                    const data = (await response.json()) as OpenAIChatCompletionResponse;
                    const messageObj = data.choices?.[0]?.message;
                    const content = messageObj?.content?.trim() || messageObj?.reasoning?.trim() || "";
                    const finishReason = data.choices?.[0]?.finish_reason || (data.choices?.[0] as any)?.finishReason;
                    const isTruncated = finishReason === "length" || finishReason === "MAX_TOKENS" || finishReason === "max_tokens";

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
                        ...(isTruncated ? { truncated: true } : {}),
                        usedContext: {
                            files: filesCount,
                            commits: commitsCount,
                            provider: candidate.provider,
                            model: candidate.model,
                            hops: hop,
                            cached: false,
                            images: request.images ? request.images.length : 0
                        }
                    };
                } else {
                    const errBody = await response.text().catch(() => "");
                    const snippet = errBody.slice(0, 200);
                    const retrySec = Math.min(300, Math.max(1, parseRetryAfter(response.headers.get("retry-after"), errBody)));

                    if (response.status === 429) {
                        hadRateLimit = true;
                        OpenAIProvider.setCooldown(candidate.provider, candidate.model, retrySec);
                        console.log(`[AI fallback hop] model=${candidate.model} status=429 cooldown=${retrySec}s`);
                        remainingCooldowns.push(retrySec);
                        if (hasImages) {
                            lastImageError = {
                                status: 429,
                                model: candidate.model,
                                code: "rate_limited",
                                snippet
                            };
                        }
                        continue;
                    }

                    if (response.status === 400 && hasImages) {
                        const bodyLower = errBody.toLowerCase();
                        const canContinue = bodyLower.includes(candidate.model.toLowerCase()) ||
                            bodyLower.includes("not supported") ||
                            bodyLower.includes("image");
                        if (canContinue) {
                            OpenAIProvider.setCooldown(candidate.provider, candidate.model, retrySec);
                            console.log(`[AI fallback hop] model=${candidate.model} status=400 (unsupported) cooldown=${retrySec}s`);
                            remainingCooldowns.push(retrySec);
                            lastImageError = {
                                status: 400,
                                model: candidate.model,
                                code: "image_failed",
                                snippet
                            };
                            continue;
                        } else {
                            console.log(`[AI fallback hop] model=${candidate.model} status=400 (fatal) cooldown=0s`);
                            return {
                                status: "error",
                                answer: "",
                                citations: [],
                                confidence: "low",
                                error: {
                                    code: "image_failed",
                                    message: `Image analysis failed (status 400). ${snippet.slice(0, 120)}`
                                }
                            };
                        }
                    }

                    OpenAIProvider.setCooldown(candidate.provider, candidate.model, retrySec);
                    console.log(`[AI fallback hop] model=${candidate.model} status=${response.status} cooldown=${retrySec}s`);
                    remainingCooldowns.push(retrySec);
                    if (hasImages) {
                        lastImageError = {
                            status: response.status,
                            model: candidate.model,
                            code: "image_failed",
                            snippet
                        };
                    }
                    continue;
                }
            } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                const snippet = errMsg.slice(0, 200);
                const cooldownSec = 60;
                OpenAIProvider.setCooldown(candidate.provider, candidate.model, cooldownSec);
                console.log(`[AI fallback hop] model=${candidate.model} status=500 cooldown=${cooldownSec}s`);
                remainingCooldowns.push(cooldownSec);
                if (hasImages) {
                    lastImageError = {
                        status: 500,
                        model: candidate.model,
                        code: "image_failed",
                        snippet
                    };
                }
                continue;
            }
        }

        if (hasImages) {
            const allRateLimited = hadRateLimit || lastImageError?.status === 429;
            if (allRateLimited) {
                const minRetry = remainingCooldowns.length > 0 ? Math.min(...remainingCooldowns) : 60;
                return {
                    status: "error",
                    answer: "",
                    citations: [],
                    confidence: "low",
                    retryAfterSeconds: minRetry,
                    error: {
                        code: "rate_limited",
                        message: `Image analysis is rate limited. Try again in ${minRetry}s.`
                    }
                };
            }
            const status = lastImageError?.status ?? 502;
            const snippet = (lastImageError?.snippet ?? "").slice(0, 120);
            return {
                status: "error",
                answer: "",
                citations: [],
                confidence: "low",
                error: {
                    code: "image_failed",
                    message: `Image analysis failed (status ${status}). ${snippet}`
                }
            };
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

        const hasImages = Boolean(request.images && request.images.length > 0);
        if (hasImages && !config.fallbackApiKey) {
            return {
                status: "error",
                answer: "",
                citations: [],
                confidence: "low",
                error: {
                    code: "vision_unavailable",
                    message: "Image analysis needs the fallback provider key"
                }
            };
        }

        if (hasImages) {
            const acquired = await imageRequestLock.acquire(5000);
            if (!acquired) {
                return {
                    status: "error",
                    answer: "",
                    citations: [],
                    confidence: "low",
                    retryAfterSeconds: 5,
                    error: {
                        code: "rate_limited",
                        message: "Image analysis is rate limited. Try again in 5s."
                    }
                };
            }
            try {
                return await this.executeStreamAnswer(request, onToken, config, true);
            } finally {
                imageRequestLock.release();
            }
        }

        return await this.executeStreamAnswer(request, onToken, config, false);
    }

    private async executeStreamAnswer(
        request: LlmRequest,
        onToken: (token: string) => void,
        config: OpenAIConfig,
        hasImages: boolean
    ): Promise<LlmResponse> {
        const messages = this.buildMessages(request);
        const classification = request.classification || classifyQuestion(
            request.question,
            request.mode,
            hasImages
        );
        const candidates = await this.getCandidates(config, hasImages, classification);
        const timeoutMs = config.timeoutMs || 20000;

        if (hasImages && candidates.length > 0 && candidates.every(c => OpenAIProvider.getCooldown(c.provider, c.model) > 0)) {
            const minCd = Math.min(...candidates.map(c => OpenAIProvider.getCooldown(c.provider, c.model)));
            return {
                status: "error",
                answer: "",
                citations: [],
                confidence: "low",
                retryAfterSeconds: minCd,
                error: {
                    code: "rate_limited",
                    message: `Image analysis is rate limited. Try again in ${minCd}s.`
                }
            };
        }

        let hadRateLimit = false;
        const remainingCooldowns: number[] = [];
        let lastImageError: { status: number; model: string; code?: string; snippet?: string } | null = null;

        for (let hop = 0; hop < candidates.length; hop++) {
            const candidate = candidates[hop];
            const cooldown = OpenAIProvider.getCooldown(candidate.provider, candidate.model);
            if (cooldown > 0) {
                hadRateLimit = true;
                remainingCooldowns.push(cooldown);
                if (hasImages) {
                    lastImageError = {
                        status: 429,
                        model: candidate.model,
                        code: "rate_limited"
                    };
                }
                continue;
            }

            try {
                const response = await this.fetchCompletionCandidate(candidate, messages, request, true, timeoutMs);

                if (!response.ok) {
                    const errBody = await response.text().catch(() => "");
                    const snippet = errBody.slice(0, 200);
                    const retrySec = Math.min(300, Math.max(1, parseRetryAfter(response.headers.get("retry-after"), errBody)));

                    if (response.status === 429) {
                        hadRateLimit = true;
                        OpenAIProvider.setCooldown(candidate.provider, candidate.model, retrySec);
                        console.log(`[AI fallback hop] model=${candidate.model} status=429 cooldown=${retrySec}s`);
                        remainingCooldowns.push(retrySec);
                        if (hasImages) {
                            lastImageError = {
                                status: 429,
                                model: candidate.model,
                                code: "rate_limited",
                                snippet
                            };
                        }
                        continue;
                    }

                    if (response.status === 400 && hasImages) {
                        const bodyLower = errBody.toLowerCase();
                        const canContinue = bodyLower.includes(candidate.model.toLowerCase()) ||
                            bodyLower.includes("not supported") ||
                            bodyLower.includes("image");
                        if (canContinue) {
                            OpenAIProvider.setCooldown(candidate.provider, candidate.model, retrySec);
                            console.log(`[AI fallback hop] model=${candidate.model} status=400 (unsupported) cooldown=${retrySec}s`);
                            remainingCooldowns.push(retrySec);
                            lastImageError = {
                                status: 400,
                                model: candidate.model,
                                code: "image_failed",
                                snippet
                            };
                            continue;
                        } else {
                            console.log(`[AI fallback hop] model=${candidate.model} status=400 (fatal) cooldown=0s`);
                            return {
                                status: "error",
                                answer: "",
                                citations: [],
                                confidence: "low",
                                error: {
                                    code: "image_failed",
                                    message: `Image analysis failed (status 400). ${snippet.slice(0, 120)}`
                                }
                            };
                        }
                    }

                    OpenAIProvider.setCooldown(candidate.provider, candidate.model, retrySec);
                    console.log(`[AI fallback hop] model=${candidate.model} status=${response.status} cooldown=${retrySec}s`);
                    remainingCooldowns.push(retrySec);
                    if (hasImages) {
                        lastImageError = {
                            status: response.status,
                            model: candidate.model,
                            code: "image_failed",
                            snippet
                        };
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
                let streamDone = false;
                let lastFinishReason: string | undefined = undefined;

                try {
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
                            if (dataStr === "[DONE]") {
                                streamDone = true;
                                continue;
                            }

                            try {
                                const parsed = JSON.parse(dataStr) as OpenAIChatCompletionResponse;
                                const choice = parsed.choices?.[0];
                                if (choice?.finish_reason) {
                                    lastFinishReason = choice.finish_reason;
                                }
                                const delta = choice?.delta;
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
                } catch {
                    // Stream closed early; proceed with text accumulated so far
                }

                filter.flush();

                const trimmedContent = accumulatedContent.trim();
                if (!trimmedContent) {
                    continue;
                }

                const isTruncated = lastFinishReason === "length" ||
                    lastFinishReason === "MAX_TOKENS" ||
                    lastFinishReason === "max_tokens" ||
                    !streamDone;

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
                    ...(isTruncated ? { truncated: true } : {}),
                    usedContext: {
                        files: filesCount,
                        commits: commitsCount,
                        provider: candidate.provider,
                        model: candidate.model,
                        hops: hop,
                        cached: false,
                        images: request.images ? request.images.length : 0
                    }
                };
            } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                const snippet = errMsg.slice(0, 200);
                const cooldownSec = 60;
                OpenAIProvider.setCooldown(candidate.provider, candidate.model, cooldownSec);
                console.log(`[AI fallback hop] model=${candidate.model} status=500 cooldown=${cooldownSec}s`);
                remainingCooldowns.push(cooldownSec);
                if (hasImages) {
                    lastImageError = {
                        status: 500,
                        model: candidate.model,
                        code: "image_failed",
                        snippet
                    };
                }
                continue;
            }
        }

        if (hasImages) {
            const allRateLimited = hadRateLimit || lastImageError?.status === 429;
            if (allRateLimited) {
                const minRetry = remainingCooldowns.length > 0 ? Math.min(...remainingCooldowns) : 60;
                return {
                    status: "error",
                    answer: "",
                    citations: [],
                    confidence: "low",
                    retryAfterSeconds: minRetry,
                    error: {
                        code: "rate_limited",
                        message: `Image analysis is rate limited. Try again in ${minRetry}s.`
                    }
                };
            }
            const status = lastImageError?.status ?? 502;
            const snippet = (lastImageError?.snippet ?? "").slice(0, 120);
            return {
                status: "error",
                answer: "",
                citations: [],
                confidence: "low",
                error: {
                    code: "image_failed",
                    message: `Image analysis failed (status ${status}). ${snippet}`
                }
            };
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
