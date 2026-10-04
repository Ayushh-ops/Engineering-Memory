export interface OpenAIConfig {
    apiKey: string;
    model: string;
    timeoutMs: number;
    maxTokens: number;
    baseUrl: string;
}

export function getLlmConfig(): OpenAIConfig {
    return createOpenAIConfigFromEnvironment();
}

export function createOpenAIConfigFromEnvironment(env: Record<string, string | undefined> = process.env): OpenAIConfig {
    const apiKey = (env.LLM_API_KEY ?? env.OPENAI_API_KEY ?? "").trim();
    const model = (env.LLM_MODEL ?? env.OPENAI_MODEL ?? "llama-3.3-70b-versatile").trim() || "llama-3.3-70b-versatile";
    const timeoutMs = Number.parseInt(env.LLM_TIMEOUT_MS ?? "30000", 10);
    const maxTokens = Number.parseInt(env.LLM_MAX_TOKENS ?? "800", 10);

    const baseUrl = (env.LLM_BASE_URL ?? env.OPENAI_BASE_URL ?? "https://api.groq.com/openai/v1").trim() || "https://api.groq.com/openai/v1";

    return {
        apiKey,
        model,
        timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 30000,
        maxTokens: Number.isFinite(maxTokens) ? maxTokens : 800,
        baseUrl
    };
}

export function validateOpenAIConfig(config: Partial<OpenAIConfig>): OpenAIConfig {
    const normalized = createOpenAIConfigFromEnvironment({
        LLM_API_KEY: config.apiKey ?? "",
        LLM_MODEL: config.model ?? "llama-3.3-70b-versatile",
        LLM_TIMEOUT_MS: String(config.timeoutMs ?? 30000),
        LLM_MAX_TOKENS: String(config.maxTokens ?? 800),
        LLM_BASE_URL: config.baseUrl ?? "https://api.groq.com/openai/v1"
    });

    if (!normalized.apiKey) {
        throw new Error("LLM_API_KEY is required.");
    }

    if (!normalized.model) {
        throw new Error("LLM_MODEL is required.");
    }

    if (!Number.isFinite(normalized.timeoutMs) || normalized.timeoutMs <= 0) {
        throw new Error("LLM_TIMEOUT_MS must be a positive integer.");
    }

    if (!Number.isFinite(normalized.maxTokens) || normalized.maxTokens <= 0) {
        throw new Error("LLM_MAX_TOKENS must be a positive integer.");
    }

    return normalized;
}
