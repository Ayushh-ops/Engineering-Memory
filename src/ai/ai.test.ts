import assert from "node:assert/strict";
import { analyzeTypeScript } from "../analyzers/typescript";
import { resolveRelativeImportRelationships } from "../resolvers/relative-imports";
import { buildRepositoryGraph } from "../graph/repository-graph";
import { assembleRepositoryContext } from "../graph/repository-context";
import { buildAiContext } from "./context";
import { buildPrompt } from "./prompt-builder";
import { AiAnswerService } from "./answer-service";
import type { LlmProvider, LlmRequest, LlmResponse } from "./provider";
import {
    validateOpenAIConfig,
    createOpenAIConfigFromEnvironment
} from "./config";
import { OpenAIProvider } from "./openai-provider";

class FakeLlmProvider implements LlmProvider {
    public calls: LlmRequest[] = [];

    constructor(private readonly response: LlmResponse) {}

    async answer(request: LlmRequest): Promise<LlmResponse> {
        this.calls.push(request);
        return this.response;
    }
}

async function main(): Promise<void> {
    const files = [
        {
            path: "src/auth.ts",
            analysis: analyzeTypeScript(
                "import { formatUser } from './user'; export function auth() { return formatUser(); } export function validate() { return true; }"
            )
        },
        {
            path: "src/user.ts",
            analysis: analyzeTypeScript(
                "export function formatUser() { return 'user'; }"
            )
        }
    ];

    const graph = buildRepositoryGraph(
        "example/repository",
        files,
        resolveRelativeImportRelationships(files),
        [{
            sha: "abc123",
            message: "Update auth",
            authorName: "Ada Lovelace",
            authorDate: "2026-08-22T00:00:00Z",
            files: [{ filename: "src/auth.ts" }]
        }],
        {
            sha: "abc123",
            files: [{
                path: "src/auth.ts",
                applicable: true,
                changes: [
                    {
                        type: "modified",
                        symbolType: "function",
                        name: "auth"
                    }
                ]
            }]
        }
    );

    const contextResult = assembleRepositoryContext(
        graph,
        {
            target: {
                type: "file",
                path: "src/auth.ts"
            }
        }
    );

    assert.equal(contextResult.status, "ok");

    if (contextResult.status !== "ok") {
        throw new Error("Expected file context");
    }

    const aiContext = buildAiContext(
        contextResult.context,
        "example/repository"
    );

    assert.deepEqual(
        aiContext.target.type,
        "file"
    );

    assert.deepEqual(
        aiContext.files.map((file) => file.path),
        ["src/auth.ts", "src/user.ts"]
    );

    assert.deepEqual(
        aiContext.symbols.map((symbol) => symbol.name),
        ["auth", "validate", "formatUser"]
    );

    assert.deepEqual(
        aiContext.files.find((file) => file.path === "src/user.ts")?.symbols,
        [
            {
                type: "function",
                name: "formatUser"
            }
        ]
    );

    const prompt = buildPrompt({
        repository: "example/repository",
        target: aiContext.target,
        question: "What does auth do?",
        facts: aiContext,
        instructions: [
            "Answer only from the supplied repository facts.",
            "If context is insufficient, say so explicitly."
        ]
    });

    assert.ok(
        prompt.includes(
            "Answer only from the supplied repository facts."
        )
    );

    assert.ok(
        prompt.includes("What does auth do?")
    );

    assert.ok(
        prompt.includes('"repository": "example/repository"')
    );

    assert.ok(
        !prompt.includes("You are a repository expert")
    );

    const fakeProvider = new FakeLlmProvider({
        answer:
            "The auth function calls formatUser and was modified in commit abc123.",
        citations: [
            {
                type: "symbol",
                path: "src/auth.ts",
                name: "auth"
            },
            {
                type: "file",
                path: "src/user.ts"
            },
            {
                type: "commit",
                sha: "abc123"
            }
        ],
        status: "ok",
        confidence: "medium"
    });

    const service = new AiAnswerService(fakeProvider);

    const answer = await service.answer({
        repository: "example/repository",
        target: {
            type: "file",
            path: "src/auth.ts"
        },
        question: "What does auth do?",
        graph,
        limits: {
            maxFiles: 8,
            maxSymbols: 40,
            maxCallers: 20,
            maxCommits: 10,
            maxSymbolChanges: 40
        }
    });

    assert.equal(
        answer.status,
        "ok"
    );

    if (answer.status === "ok") {
        assert.ok(
            answer.answer.includes("auth")
        );

        assert.equal(
            answer.citations.length,
            3
        );
    }

    assert.equal(
        fakeProvider.calls.length,
        1
    );

    const insufficient = await service.answer({
        repository: "example/repository",
        target: {
            type: "file",
            path: "src/auth.ts"
        },
        question: "What is the root cause of the bug in this repo?",
        graph,
        limits: {
            maxFiles: 8,
            maxSymbols: 40,
            maxCallers: 20,
            maxCommits: 10,
            maxSymbolChanges: 40
        },
        allowInsufficientContext: true
    });

    assert.equal(
        insufficient.status,
        "insufficient_context"
    );

    const providerError = new FakeLlmProvider({
        answer: "",
        citations: [],
        status: "error",
        confidence: "low",
        error: {
            code: "provider_unavailable",
            message: "Provider unavailable"
        }
    });

    const serviceWithError = new AiAnswerService(
        providerError
    );

    const result = await serviceWithError.answer({
        repository: "example/repository",
        target: {
            type: "file",
            path: "src/auth.ts"
        },
        question: "Explain the repository.",
        graph,
        limits: {
            maxFiles: 8,
            maxSymbols: 40,
            maxCallers: 20,
            maxCommits: 10,
            maxSymbolChanges: 40
        }
    });

    assert.equal(
        result.status,
        "error"
    );

    if (result.status === "error") {
        assert.equal(
            result.error?.code,
            "provider_unavailable"
        );
    }

    assert.throws(() =>
        validateOpenAIConfig({
            apiKey: "",
            model: "gpt-4o-mini"
        })
    );

    assert.deepEqual(
        createOpenAIConfigFromEnvironment({
            OPENAI_API_KEY: "test-key",
            OPENAI_MODEL: "gpt-4o-mini",
            LLM_TIMEOUT_MS: "2000",
            LLM_MAX_TOKENS: "600"
        }),
        {
            apiKey: "test-key",
            model: "gpt-4o-mini",
            timeoutMs: 2000,
            maxTokens: 600,
            baseUrl: "https://api.openai.com/v1"
        }
    );

    const originalFetch = globalThis.fetch;

    try {
        globalThis.fetch = async () => {
            const error = new Error("timeout");

            (
                error as Error & {
                    name?: string;
                }
            ).name = "AbortError";

            throw error;
        };

        const timeoutResult = await new OpenAIProvider({
            apiKey: "test-key",
            model: "gpt-4o-mini",
            timeoutMs: 1,
            maxTokens: 200,
            baseUrl: "https://api.openai.com/v1"
        }).answer({
            repository: "example/repository",
            target: {
                type: "file",
                path: "src/auth.ts"
            },
            question: "What does auth do?",
            facts: {
                ok: true
            }
        });

        assert.equal(
            timeoutResult.status,
            "error"
        );

        if (timeoutResult.status === "error") {
            assert.equal(
                timeoutResult.error?.code,
                "timeout"
            );
        }
    } finally {
        globalThis.fetch = originalFetch;
    }

    console.log("AI fixtures passed");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});