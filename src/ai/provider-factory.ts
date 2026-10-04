import { createOpenAIConfigFromEnvironment } from "./config";
import { OpenAIProvider } from "./openai-provider";
import type { LlmProvider } from "./provider";

export function createLlmProviderFromEnvironment(
    env: Record<string, string | undefined> = process.env
): LlmProvider {
    const providerName = (env.LLM_PROVIDER ?? "openai").trim().toLowerCase();

    switch (providerName) {
        case "openai":
            return new OpenAIProvider(env !== process.env ? createOpenAIConfigFromEnvironment(env) : undefined);
        default:
            throw new Error(`Unsupported LLM provider: ${providerName}. Supported providers: openai.`);
    }
}
