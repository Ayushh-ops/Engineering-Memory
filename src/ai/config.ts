export interface OpenAIConfig {
    apiKey: string;
    model: string;
    timeoutMs: number;
    maxTokens: number;
    baseUrl: string;
    fallbackApiKey?: string;
    fallbackBaseUrl?: string;
    fallbackModel?: string;
}

export function getLlmConfig(): OpenAIConfig {
    return createOpenAIConfigFromEnvironment();
}

export function createOpenAIConfigFromEnvironment(env: Record<string, string | undefined> = process.env): OpenAIConfig {
    const apiKey = (env.LLM_API_KEY ?? env.OPENAI_API_KEY ?? "").trim();
    const model = (env.LLM_MODEL ?? env.OPENAI_MODEL ?? "openai/gpt-oss-120b").trim() || "openai/gpt-oss-120b";
    const timeoutMs = Number.parseInt(env.LLM_TIMEOUT_MS ?? "20000", 10);
    const maxTokens = Number.parseInt(env.LLM_MAX_TOKENS ?? "1500", 10);

    const baseUrl = (env.LLM_BASE_URL ?? env.OPENAI_BASE_URL ?? "https://api.groq.com/openai/v1").trim() || "https://api.groq.com/openai/v1";

    const config: OpenAIConfig = {
        apiKey,
        model,
        timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 20000,
        maxTokens: Number.isFinite(maxTokens) ? maxTokens : 1500,
        baseUrl
    };

    const fallbackApiKey = (env.LLM_FALLBACK_API_KEY ?? "").trim();
    if (fallbackApiKey) {
        config.fallbackApiKey = fallbackApiKey;
        config.fallbackBaseUrl = (env.LLM_FALLBACK_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai/").trim() || "https://generativelanguage.googleapis.com/v1beta/openai/";
        const fallbackModel = (env.LLM_FALLBACK_MODEL ?? "").trim();
        if (fallbackModel) {
            config.fallbackModel = fallbackModel;
        }
    }

    return config;
}

export function validateOpenAIConfig(config: Partial<OpenAIConfig>): OpenAIConfig {
    const normalized = createOpenAIConfigFromEnvironment({
        LLM_API_KEY: config.apiKey ?? "",
        LLM_MODEL: config.model ?? "openai/gpt-oss-120b",
        LLM_TIMEOUT_MS: String(config.timeoutMs ?? 20000),
        LLM_MAX_TOKENS: String(config.maxTokens ?? 1500),
        LLM_BASE_URL: config.baseUrl ?? "https://api.groq.com/openai/v1",
        LLM_FALLBACK_API_KEY: config.fallbackApiKey,
        LLM_FALLBACK_BASE_URL: config.fallbackBaseUrl,
        LLM_FALLBACK_MODEL: config.fallbackModel
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
