export interface OpenAIConfig {
    apiKey: string;
    model: string;
    timeoutMs: number;
    maxTokens: number;
    baseUrl: string;
}

export function createOpenAIConfigFromEnvironment(env: Record<string, string | undefined> = process.env): OpenAIConfig {
    const apiKey = (env.OPENAI_API_KEY ?? "").trim();
    const model = (env.OPENAI_MODEL ?? "gpt-4o-mini").trim() || "gpt-4o-mini";
    const timeoutMs = Number.parseInt(env.LLM_TIMEOUT_MS ?? "15000", 10);
    const maxTokens = Number.parseInt(env.LLM_MAX_TOKENS ?? "800", 10);

    return {
        apiKey,
        model,
        timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 15000,
        maxTokens: Number.isFinite(maxTokens) ? maxTokens : 800,
        baseUrl: "https://api.openai.com/v1"
    };
}

export function validateOpenAIConfig(config: Partial<OpenAIConfig>): OpenAIConfig {
    const normalized = createOpenAIConfigFromEnvironment({
        OPENAI_API_KEY: config.apiKey ?? "",
        OPENAI_MODEL: config.model ?? "gpt-4o-mini",
        LLM_TIMEOUT_MS: String(config.timeoutMs ?? 15000),
        LLM_MAX_TOKENS: String(config.maxTokens ?? 800)
    });

    if (!normalized.apiKey) {
        throw new Error("OPENAI_API_KEY is required.");
    }

    if (!normalized.model) {
        throw new Error("OPENAI_MODEL is required.");
    }

    if (!Number.isFinite(normalized.timeoutMs) || normalized.timeoutMs <= 0) {
        throw new Error("LLM_TIMEOUT_MS must be a positive integer.");
    }

    if (!Number.isFinite(normalized.maxTokens) || normalized.maxTokens <= 0) {
        throw new Error("LLM_MAX_TOKENS must be a positive integer.");
    }

    return normalized;
}
