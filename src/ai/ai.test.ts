import assert from "node:assert/strict";
import { analyzeTypeScript } from "../analyzers/typescript";
import { resolveRelativeImportRelationships } from "../resolvers/relative-imports";
import { buildRepositoryGraph } from "../graph/repository-graph";
import { assembleRepositoryContext } from "../graph/repository-context";
import { buildAiContext, MAX_AI_CONTEXT_BYTES } from "./context";
import type { AiImpactContext } from "./impact-context";
import { buildPrompt, detectLang, getLanguageDirective, getModeInstruction, getSystemInstructions } from "./prompt-builder";
import { AiAnswerService, isGroundedQuestion, parseAndValidateEvidenceAndFollowUps, generateFallbackFollowUps, normalizeQuestionForComparison, extractBackendChosenEvidence, extractRepoScopeEvidence } from "./answer-service";
import { classifyQuestion, classifyScope } from "./question-class";
import type { LlmProvider, LlmRequest, LlmResponse } from "./provider";
import {
    validateOpenAIConfig,
    createOpenAIConfigFromEnvironment,
    cleanEnvVal
} from "./config";
import {
    OpenAIProvider,
    StreamDelimiterFilter,
    filterAndSortGeminiModels,
    getGeminiCandidateModels,
    resetGeminiCandidatesCache
} from "./openai-provider";
import { createLlmProviderFromEnvironment } from "./provider-factory";
import { createAiRouter, validateImages } from "../routes/ai";
import type { RepositoryAiOrchestrationRequest } from "../services/repository-ai-orchestration-service";
import type { AiAnswerResult } from "./answer-service";
import {
    ChangeImpactAnalysisService,
    type ChangeImpactAnalysisResult
} from "../services/change-impact-analysis-service";

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

    // The impact fixture below cites a caller that is not part of the two
    // analyzed files, so the graph is extended with the deterministic call edge
    // the fixture references. This keeps the fixture consistent with the graph
    // that the answer service validates before it contacts the LLM.
    graph.nodes.push({
        id: "function:src%2Fcaller.ts:caller",
        type: "function",
        name: "caller",
        path: "src/caller.ts"
    });
    graph.edges.push({
        id: "edge:calls:caller:auth",
        from: "function:src%2Fcaller.ts:caller",
        to: "function:src%2Fauth.ts:auth",
        type: "calls",
        callSites: [{
            file: "src/caller.ts",
            startLine: 1,
            startColumn: 1,
            endLine: 1,
            endColumn: 7,
            expression: "auth()"
        }]
    });

    const impact: ChangeImpactAnalysisResult = {
        target: { type: "symbol", path: "src/auth.ts", name: "auth" },
        targetNodeId: "function:src%2Fauth.ts:auth",
        status: "ok",
        bounds: { maxDepth: 3, maxResults: 10, truncated: true },
        directCallers: [{
            symbol: { type: "function", name: "caller", path: "src/caller.ts", id: "function:src%2Fcaller.ts:caller" },
            relationship: "direct-caller",
            evidence: "calls-edge"
        }],
        transitiveConsumers: [{
            symbol: { type: "function", name: "root", path: "src/root.ts", id: "function:src%2Froot.ts:root" },
            depth: 2,
            relationship: "transitive-consumer",
            evidence: "calls-edge"
        }],
        tests: [{
            symbol: { type: "function", name: "authTest", path: "tests/auth.test.ts", id: "function:tests%2Fauth.test.ts:authTest" },
            relationship: "test-consumer",
            classification: "path-convention"
        }],
        relatedDependencies: [
            { path: "src/user.ts", relationship: "direct-import", evidence: "imports-edge" },
            { path: "src/consumer.ts", relationship: "reverse-import", evidence: "imports-edge" }
        ],
        reviewCandidates: [{
            path: "src/caller.ts",
            relationship: "direct-caller",
            reason: "should-be-reviewed",
            evidence: "calls-edge"
        }],
        sourceEvidence: [],
        paths: [{
            id: "impact-path:target:caller",
            target: "function:src%2Fauth.ts:auth",
            nodes: ["function:src%2Fauth.ts:auth", "function:src%2Fcaller.ts:caller"],
            relationships: [{
                relationshipId: "edge:calls:caller:auth",
                from: "function:src%2Fcaller.ts:caller",
                to: "function:src%2Fauth.ts:auth",
                callSiteIds: ["edge%3Acalls%3Acaller%3Aauth:src%2Fcaller.ts:1:1:1:7:auth()"],
                type: "calls",
                evidence: "available"
            }],
            depth: 1,
            classification: "direct-caller"
        }],
        impactNodes: [
            { id: "function:src%2Fauth.ts:auth", type: "function", path: "src/auth.ts", name: "auth" },
            { id: "function:src%2Fcaller.ts:caller", type: "function", path: "src/caller.ts", name: "caller" }
        ],
        callSiteEvidence: [{
            id: "edge%3Acalls%3Acaller%3Aauth:src%2Fcaller.ts:1:1:1:7:auth()",
            file: "src/caller.ts",
            startLine: 1,
            startColumn: 1,
            endLine: 1,
            endColumn: 7,
            expression: "auth()"
        }],
        limitations: ["static-analysis-review-signal"]
    };
    const impactContext = buildAiContext(contextResult.context, "example/repository", [], impact);
    const compactImpact = impactContext.impact;
    assert.ok(compactImpact);
    assert.equal(compactImpact.status, "ok");
    assert.equal(compactImpact.targetNodeId, impact.targetNodeId);
    assert.deepEqual(compactImpact.bounds, impact.bounds);
    assert.deepEqual(compactImpact.sourceEvidence, impact.sourceEvidence);
    assert.deepEqual(compactImpact.dependencies, impact.relatedDependencies);
    assert.deepEqual(compactImpact.totals, {
        directCallers: impact.directCallers.length,
        transitiveConsumers: impact.transitiveConsumers.length,
        testConsumers: impact.tests.length,
        paths: impact.paths.length,
        relationships: impact.paths.reduce((total, path) => total + path.relationships.length, 0),
        callSites: impact.callSiteEvidence.length,
        dependencies: impact.relatedDependencies.length
    });
    assert.deepEqual(compactImpact.consumers.map((consumer) => ({
        id: consumer.id,
        depth: consumer.depth,
        relationship: consumer.relationship
    })), [
        { id: "function:src%2Fcaller.ts:caller", depth: 1, relationship: "direct-caller" },
        { id: "function:src%2Froot.ts:root", depth: 2, relationship: "transitive-consumer" }
    ]);
    assert.deepEqual(compactImpact.consumers[0].chain, [0]);
    assert.deepEqual(compactImpact.relationships, [{
        id: "edge:calls:caller:auth",
        type: "calls",
        from: "function:src%2Fcaller.ts:caller",
        to: "function:src%2Fauth.ts:auth",
        evidence: "available",
        callSites: [{
            file: "src/caller.ts",
            startLine: 1,
            startColumn: 1,
            endLine: 1,
            endColumn: 7,
            expression: "auth()"
        }]
    }]);
    assert.equal(compactImpact.compaction.analysisTruncated, true);
    assert.equal(compactImpact.compaction.omittedCallSites, 0);
    assert.equal(compactImpact.compaction.omittedPaths, 0);
    assert.equal(compactImpact.compaction.reason, undefined);
    // The fixture lists a transitive consumer without a matching path, so its
    // detail is reported as unavailable rather than fabricated.
    assert.equal(compactImpact.compaction.detailOmittedConsumers, 1);
    assert.equal(compactImpact.limitations[0], "static-analysis-review-signal");
    assert.ok(compactImpact.limitations.some((limitation) => limitation.includes("bounded")));


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

    const factoryProvider = createLlmProviderFromEnvironment({
        LLM_PROVIDER: "openai",
        OPENAI_API_KEY: "test-key",
        OPENAI_MODEL: "gpt-4o-mini",
        LLM_TIMEOUT_MS: "2000",
        LLM_MAX_TOKENS: "200"
    });

    assert.equal(
        factoryProvider instanceof OpenAIProvider,
        true
    );

    assert.throws(
        () => createLlmProviderFromEnvironment({ LLM_PROVIDER: "gemini" }),
        /Unsupported LLM provider/
    );

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
        },
        impact
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
    assert.equal(
        (fakeProvider.calls[0]?.facts as { impact?: AiImpactContext }).impact?.bounds.truncated,
        true
    );
    assert.equal(
        "evidence" in (fakeProvider.calls[0]?.facts as Record<string, unknown>),
        false
    );

    // M26.1: the compact AI impact context is bounded, so impact questions stay
    // answerable at every caller count instead of becoming oversized_context.
    const fanoutFixture = (callerCount: number) => {
        const lines = ["export function targetFn() { return 1; }"];
        for (let index = 0; index < callerCount; index++) {
            lines.push(`export function direct${index}() { return targetFn(); }`);
        }
        const fanoutGraph = buildRepositoryGraph(
            "example/repository",
            [{ path: "src/fanout.ts", analysis: analyzeTypeScript(lines.join(" "), "src/fanout.ts") }],
            []
        );
        const fanoutTarget = {
            type: "symbol" as const,
            symbol: { type: "function" as const, path: "src/fanout.ts", name: "targetFn" }
        };
        return {
            graph: fanoutGraph,
            impact: new ChangeImpactAnalysisService().analyze(fanoutGraph, fanoutTarget)
        };
    };

    for (const callerCount of [8, 9, 20, 50]) {
        const fixture = fanoutFixture(callerCount);
        const fanoutProvider = new FakeLlmProvider({
            status: "ok",
            answer: "Fan-out answer",
            citations: [],
            confidence: "medium"
        });
        const fanoutAnswer = await new AiAnswerService(fanoutProvider).answer({
            repository: "example/repository",
            target: {
                type: "symbol",
                symbol: { type: "function", path: "src/fanout.ts", name: "targetFn" }
            },
            question: "What breaks if I remove targetFn?",
            graph: fixture.graph,
            impact: fixture.impact,
            allowInsufficientContext: true
        });

        assert.equal(fanoutAnswer.status, "ok", `expected an answer for ${callerCount} callers`);
        assert.equal(fanoutProvider.calls.length, 1, `expected one provider call for ${callerCount} callers`);
        const serializedFacts = JSON.stringify(fanoutProvider.calls[0]?.facts);
        assert.ok(
            serializedFacts.length <= MAX_AI_CONTEXT_BYTES,
            `expected ${callerCount} callers to fit the AI context, got ${serializedFacts.length}`
        );

        const fanoutFacts = fanoutProvider.calls[0]?.facts as { impact?: AiImpactContext };
        const compaction = fanoutFacts.impact?.compaction;
        assert.equal(fanoutFacts.impact?.consumers.length, callerCount);
        assert.equal(
            (compaction?.consumersWithDetail ?? 0) + (compaction?.detailOmittedConsumers ?? 0),
            callerCount
        );
        if ((compaction?.detailOmittedConsumers ?? 0) > 0) {
            assert.ok(fanoutFacts.impact?.limitations.some((limitation) => limitation.includes("bounded")));
        }
    }

    const nonImpactFacts = JSON.parse(
        JSON.stringify(buildAiContext(contextResult.context, "example/repository"))
    ) as Record<string, unknown>;
    assert.deepEqual(
        Object.keys(nonImpactFacts),
        ["factsBlock", "repository", "target", "files", "symbols", "imports", "callers", "commits", "symbolChanges", "risk", "directDependentsLabel", "owners", "directImportsLabel"]
    );
    const inconsistentProvider = new FakeLlmProvider({
        status: "ok",
        answer: "This answer must never be produced.",
        citations: [],
        confidence: "low"
    });
    const inconsistentAnswer = await new AiAnswerService(inconsistentProvider).answer({
        repository: "example/repository",
        target: {
            type: "file",
            path: "src/auth.ts"
        },
        question: "What does auth do?",
        graph,
        impact: {
            ...impact,
            targetNodeId: "function:src%2Fghost.ts:ghost"
        }
    });
    assert.equal(inconsistentAnswer.status, "error");
    assert.equal(inconsistentProvider.calls.length, 0);

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
            LLM_MAX_TOKENS: "600",
            OPENAI_BASE_URL: "https://api.openai.com/v1"
        }),
        {
            apiKey: "test-key",
            model: "gpt-4o-mini",
            timeoutMs: 2000,
            maxTokens: 600,
            baseUrl: "https://api.openai.com/v1"
        }
    );

    const routeAiService = new AiAnswerService(
        new FakeLlmProvider({
            status: "ok",
            answer: "This file defines auth.",
            citations: [{ type: "file", path: "src/auth.ts" }],
            confidence: "medium"
        })
    );
    const repositoryAnswer: AiAnswerResult = {
        status: "ok",
        answer: "Repository answer",
        citations: [{ type: "file", path: "src/auth.ts" }],
        confidence: "high"
    };
    const aiRouter = createAiRouter(
        routeAiService,
        {
            answer: async (_request: RepositoryAiOrchestrationRequest): Promise<AiAnswerResult> => repositoryAnswer
        }
    );

    const app = (await import("express")).default();
    app.use((await import("express")).json());
    app.use("/api", aiRouter);

    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const port = (server.address() as { port: number }).port;

    const validResponse = await fetch(`http://127.0.0.1:${port}/api/ai/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            repository: "example/repository",
            target: { type: "file", path: "src/auth.ts" },
            question: "What does this file do?",
            graph
        })
    });

    assert.equal(validResponse.status, 200);
    const validBody = await validResponse.json() as {
        status: string;
        answer: string;
        citations: Array<{ path?: string }>;
    };
    assert.equal(validBody.status, "ok");
    assert.equal(validBody.answer, "This file defines auth.");
    assert.equal(validBody.citations.length, 1);

    const repositoryResponse = await fetch(`http://127.0.0.1:${port}/api/ai/ask-repository`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            url: "https://github.com/example/repository",
            sha: "abc123",
            paths: ["src/auth.ts"],
            target: { type: "file", path: "src/auth.ts" },
            question: "What does auth do?"
        })
    });

    assert.equal(repositoryResponse.status, 200);
    const repositoryBody = await repositoryResponse.json() as {
        status: string;
        answer: string;
        citations: Array<{ path?: string }>;
        confidence: string;
        missingData: string[];
        error: unknown;
    };
    assert.deepEqual(repositoryBody, {
        status: "ok",
        answer: "Repository answer",
        citations: [{ type: "file", path: "src/auth.ts" }],
        confidence: "high",
        missingData: [],
        error: null
    });

    const invalidResponse = await fetch(`http://127.0.0.1:${port}/api/ai/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            repository: "example/repository",
            target: { type: "file", path: "src/auth.ts" }
        })
    });

    assert.equal(invalidResponse.status, 400);
    const invalidBody = await invalidResponse.json() as { status: string; code: string; message: string; error: string };
    assert.equal(invalidBody.status, "error");
    assert.equal(invalidBody.message, "A question is required when no image is attached");

    const imageOnlyRouteResponse = await fetch(`http://127.0.0.1:${port}/api/ai/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            repository: "example/repository",
            target: { type: "file", path: "src/auth.ts" },
            question: "",
            images: [{
                id: "img-test",
                mime: "image/png",
                data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
            }],
            graph
        })
    });
    assert.equal(imageOnlyRouteResponse.status, 200);

    const overImagesResponse = await fetch(`http://127.0.0.1:${port}/api/ai/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            repository: "example/repository",
            target: { type: "file", path: "src/auth.ts" },
            question: "explain",
            images: [
                { mime: "image/png", data: "dGVzdDE=" },
                { mime: "image/png", data: "dGVzdDI=" },
                { mime: "image/png", data: "dGVzdDM=" },
                { mime: "image/png", data: "dGVzdDQ=" }
            ],
            graph
        })
    });
    assert.equal(overImagesResponse.status, 400);
    const overImagesBody = await overImagesResponse.json() as { status: string; code: string; message: string };
    assert.equal(overImagesBody.status, "error");
    assert.equal(overImagesBody.message, "At most 3 images");

    server.close();

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
                "provider_unavailable"
            );
        }
    } finally {
        globalThis.fetch = originalFetch;
    }

    // Test large file context building and outline/truncation behavior
    const largeFileLines: string[] = [];
    largeFileLines.push("import { something } from './somewhere';");
    for (let i = 2; i <= 300; i++) {
        largeFileLines.push(`export function func${i}() { return ${i}; }`);
    }
    const largeContent = largeFileLines.join("\n");
    const largeContext = buildAiContext(contextResult.context, "example/repository", [], undefined, largeContent);
    assert.ok(largeContext.fileContent, "Expected fileContent to be built");
    assert.ok(largeContext.fileContent.length <= 8000, `Expected <= 8000 chars, got ${largeContext.fileContent.length}`);
    assert.ok(largeContext.fileContent.includes("Outline:"), "Expected outline in fileContent");
    assert.ok(largeContext.fileContent.includes("L1: import { something } from './somewhere';"), "Expected line number in outline");
    assert.ok(largeContext.fileContent.includes("First 150 lines:"), "Expected snippet section");
    assert.equal(largeContext.fileTruncated, true, "Expected fileTruncated flag");

    const largeProvider = new FakeLlmProvider({
        status: "ok",
        answer: "Here is an explanation of func.",
        citations: [],
        confidence: "medium"
    });
    const largeAnswerResult = await new AiAnswerService(largeProvider).answer({
        repository: "example/repository",
        target: {
            type: "file",
            path: "src/auth.ts"
        },
        question: "Explain this file",
        graph,
        fileContent: largeContent,
        allowInsufficientContext: true
    });
    assert.equal(largeAnswerResult.status, "ok", "Expected ok response, not refused for size");
    assert.ok(
        largeAnswerResult.answer.includes("Based on the outline and first 150 lines."),
        `Expected truncation notice in answer, got: ${largeAnswerResult.answer}`
    );

    // Test Automatic Language instruction addition
    const autoLangProvider = new FakeLlmProvider({
        status: "ok",
        answer: "Auth file user authentication handle karta hai.",
        citations: [],
        confidence: "medium"
    });
    const autoLangResult = await new AiAnswerService(autoLangProvider).answer({
        repository: "example/repository",
        target: {
            type: "file",
            path: "src/auth.ts"
        },
        question: "ye file kya karti hai?",
        graph,
        allowInsufficientContext: true
    });
    assert.equal(autoLangResult.status, "ok");
    const lastInstructions = autoLangProvider.calls[0]?.instructions;
    assert.ok(
        lastInstructions?.some((inst) => inst.includes("Match the script of the user's latest message")),
        "Expected automatic language instruction in provider call"
    );
    assert.ok(
        lastInstructions?.some((inst) => inst.includes("<<<FOLLOWUPS>>>") || inst.includes("FOLLOWUPS")),
        "Expected FOLLOWUPS instruction in provider call"
    );

    // Test greeting and small talk intercept
    const greetingResult = await new AiAnswerService(autoLangProvider).answer({
        repository: "example/repository",
        target: { type: "file", path: "src/auth.ts" },
        question: "hi",
        graph,
        allowInsufficientContext: true
    });
    assert.equal(greetingResult.status, "ok");
    assert.ok(greetingResult.answer.toLowerCase().includes("hello") || greetingResult.answer.toLowerCase().includes("how can i help"));
    assert.deepEqual(greetingResult.citations, []);

    // Test capability questions
    const capabilityResult = await new AiAnswerService(autoLangProvider).answer({
        repository: "example/repository",
        target: { type: "file", path: "src/auth.ts" },
        question: "tum kya kya kar sakte ho",
        graph,
        allowInsufficientContext: true
    });
    assert.equal(capabilityResult.status, "ok");
    assert.ok(capabilityResult.answer.toLowerCase().includes("files") || capabilityResult.answer.includes("explain"));
    assert.deepEqual(capabilityResult.citations, []);

    // Test detectLang
    assert.equal(detectLang("hi"), "en");
    assert.equal(detectLang("hii"), "en");
    assert.equal(detectLang("hiii!"), "en");
    assert.equal(detectLang("ye kya krta hai"), "hinglish");
    assert.equal(detectLang("auth function kya karta hai?"), "hinglish");
    assert.equal(detectLang("यह कोड क्या करता है"), "hi");
    assert.equal(detectLang("What does this function do?"), "en");
    assert.equal(detectLang("bhai ye code samjhao"), "hinglish");

    // Test getLanguageDirective
    assert.ok(getLanguageDirective("hinglish").includes("Reply in Roman-script Hinglish (natural Hindi in English letters), not English and not Devanagari. Ignore the language of earlier answers."));
    assert.ok(getLanguageDirective("hinglish").includes("Keep code, file names and identifiers unchanged. Apply the same language to the 3 follow-up questions."));
    assert.ok(getLanguageDirective("hi").includes("Reply in Hindi (Devanagari)."));
    assert.ok(getLanguageDirective("hi").includes("Keep code, file names and identifiers unchanged. Apply the same language to the 3 follow-up questions."));
    assert.ok(getLanguageDirective("en").includes("Reply in English."));
    assert.ok(getLanguageDirective("en").includes("Keep code, file names and identifiers unchanged. Apply the same language to the 3 follow-up questions."));

    // Test history capping to 4 messages and trimming assistant message to 600 chars
    const historyProvider = new FakeLlmProvider({
        status: "ok",
        answer: "OK",
        citations: [],
        confidence: "medium"
    });
    const longAssistantAnswer = "a".repeat(1000);
    await new AiAnswerService(historyProvider).answer({
        repository: "example/repository",
        target: { type: "file", path: "src/auth.ts" },
        question: "Explain this file",
        graph,
        allowInsufficientContext: true,
        history: [
            { role: "user", content: "msg1" },
            { role: "assistant", content: "msg2" },
            { role: "user", content: "msg3" },
            { role: "assistant", content: longAssistantAnswer },
            { role: "user", content: "msg5" },
            { role: "assistant", content: "msg6" }
        ]
    });
    const passedHistory = historyProvider.calls[0]?.history;
    assert.equal(passedHistory?.length, 4);
    assert.equal(passedHistory?.[1]?.content.length, 600); // the assistant answer trimmed to 600
    assert.equal(passedHistory?.[2]?.content, "msg5");
    assert.equal(passedHistory?.[3]?.content, "msg6");

    // Test pronoun grounding: "this", "ye", "yeh", "is file"
    assert.equal(isGroundedQuestion("explain this file", { type: "file", path: "src/auth.ts" }), true);
    assert.equal(isGroundedQuestion("ye kya karta hai", { type: "file", path: "src/auth.ts" }), true);
    assert.equal(isGroundedQuestion("yeh code explain karo", { type: "file", path: "src/auth.ts" }), true);
    assert.equal(isGroundedQuestion("is file me kya functions hai", { type: "file", path: "src/auth.ts" }), true);

    // Test risk score inclusion in context and instructions
    const factsWithRisk = historyProvider.calls[0]?.facts as any;
    assert.ok(factsWithRisk?.risk !== undefined, "Expected risk in facts context");
    assert.equal(typeof factsWithRisk?.risk?.score, "number");
    assert.ok(Array.isArray(factsWithRisk?.risk?.reasons));
    assert.equal(typeof factsWithRisk?.risk?.directDependents, "number");
    assert.equal(typeof factsWithRisk?.risk?.transitiveDependents, "number");
    assert.equal(typeof factsWithRisk?.risk?.hasTests, "boolean");

    const riskInstructions = historyProvider.calls[0]?.instructions;
    assert.ok(
        riskInstructions?.some((inst) => inst.includes("For risk questions, explain using the computed risk score")),
        "Expected risk instruction in provider call"
    );

    // 1. Evidence & follow-up parsing and validation
    const rawAiAnswer = [
        "The auth function validates credentials.",
        '<<<EVIDENCE>>>[{"path":"src/auth.ts","line":1,"snippet":"export function auth()"},{"path":"src/unknown.ts","line":99}]<<<END_EVIDENCE>>>',
        '<<<FOLLOWUPS>>>["How to test auth?","Where is formatUser defined?","What is validate?","Extra question to drop"]<<<END_FOLLOWUPS>>>'
    ].join("\n");

    const parsedEvidenceAndFollowUps = parseAndValidateEvidenceAndFollowUps(
        rawAiAnswer,
        [{ path: "src/auth.ts" }],
        "src/auth.ts",
        new Map([["src/auth.ts", ["import { formatUser } from './user';", "export function auth() { return formatUser(); }"]]])
    );

    assert.equal(parsedEvidenceAndFollowUps.cleanAnswer, "The auth function validates credentials.");
    assert.equal(parsedEvidenceAndFollowUps.evidence.length, 1);
    assert.equal(parsedEvidenceAndFollowUps.evidence[0].path, "src/auth.ts");
    assert.equal(parsedEvidenceAndFollowUps.evidence[0].line, 1);
    assert.equal(parsedEvidenceAndFollowUps.followUps.length, 3);
    assert.equal(parsedEvidenceAndFollowUps.followUps[0], "How to test auth?");
    assert.equal(parsedEvidenceAndFollowUps.citations.length, 1);
    assert.equal(parsedEvidenceAndFollowUps.citations[0].path, "src/auth.ts");

    // 1b. Tolerant tail parser - Sample 1 (plain text headings and lines)
    const mockFacadeLines = Array.from({ length: 60 }, (_, i) => `// Line ${i + 1} content of facade`);
    mockFacadeLines[13] = "export function runFacade() {";
    mockFacadeLines[51] = "} // end runFacade";
    mockFacadeLines[5] = "export const VERSION = 1;";
    mockFacadeLines[11] = "export const DEBUG = false;";
    mockFacadeLines[47] = "function helper() { return true; }";

    const tailSample1 = [
        "This file provides facade build utilities.",
        "Missing data: none.",
        "Evidence: build/lib/gulp/facade.ts lines 14-52.",
        "Follow-ups:",
        "- Why is risk score so high?",
        "- How many tests cover this file?"
    ].join("\n");

    const parsedTail1 = parseAndValidateEvidenceAndFollowUps(
        tailSample1,
        [{ path: "build/lib/gulp/facade.ts" }],
        "build/lib/gulp/facade.ts",
        new Map([["build/lib/gulp/facade.ts", mockFacadeLines]])
    );

    assert.equal(parsedTail1.cleanAnswer, "This file provides facade build utilities.");
    assert.deepEqual(parsedTail1.missingData, []);
    assert.equal(parsedTail1.evidence.length, 1);
    assert.equal(parsedTail1.evidence[0].path, "build/lib/gulp/facade.ts");
    assert.equal(parsedTail1.evidence[0].line, 14);
    assert.equal(parsedTail1.evidence[0].endLine, 52);
    assert.equal(parsedTail1.evidence[0].snippet, "export function runFacade() {");
    assert.equal(parsedTail1.followUps.length, 2);
    assert.equal(parsedTail1.followUps[0], "Why is risk score so high?");
    assert.equal(parsedTail1.followUps[1], "How many tests cover this file?");

    // 1c. Tolerant tail parser - Sample 2 (Hinglish, JSON arrays in tail)
    const tailSample2 = [
        "Yeh file build system ka part hai.",
        "missingData: koi nahin.",
        'EVIDENCE: [{"path":"build/lib/gulp/facade.ts","line":6},{"path":"build/lib/gulp/facade.ts","line":12}]',
        'FOLLOWUPS: ["Is koi test file iske liye hai?","Is file ka koi owner hai?"]'
    ].join("\n");

    const parsedTail2 = parseAndValidateEvidenceAndFollowUps(
        tailSample2,
        [{ path: "build/lib/gulp/facade.ts" }],
        "build/lib/gulp/facade.ts",
        new Map([["build/lib/gulp/facade.ts", mockFacadeLines]])
    );

    assert.equal(parsedTail2.cleanAnswer, "Yeh file build system ka part hai.");
    assert.deepEqual(parsedTail2.missingData, []);
    assert.equal(parsedTail2.evidence.length, 2);
    assert.equal(parsedTail2.evidence[0].path, "build/lib/gulp/facade.ts");
    assert.equal(parsedTail2.evidence[0].line, 6);
    assert.equal(parsedTail2.evidence[0].snippet, "export const VERSION = 1;");
    assert.equal(parsedTail2.evidence[1].line, 12);
    assert.equal(parsedTail2.evidence[1].snippet, "export const DEBUG = false;");
    assert.equal(parsedTail2.followUps.length, 2);
    assert.equal(parsedTail2.followUps[0], "Is koi test file iske liye hai?");
    assert.equal(parsedTail2.followUps[1], "Is file ka koi owner hai?");

    // 1d. Fallback line references directly from cleanAnswer
    const fallbackAnswer = "The facade implementation (L14-L29) wraps the gulp pipeline. Helper defined at L48.";
    const parsedFallback = parseAndValidateEvidenceAndFollowUps(
        fallbackAnswer,
        [{ path: "build/lib/gulp/facade.ts" }],
        "build/lib/gulp/facade.ts",
        new Map([["build/lib/gulp/facade.ts", mockFacadeLines]])
    );

    assert.equal(parsedFallback.cleanAnswer, fallbackAnswer);
    assert.equal(parsedFallback.evidence.length, 2);
    assert.equal(parsedFallback.evidence[0].line, 14);
    assert.equal(parsedFallback.evidence[0].endLine, 29);
    assert.equal(parsedFallback.evidence[0].snippet, "export function runFacade() {");
    assert.equal(parsedFallback.evidence[1].line, 48);
    assert.equal(parsedFallback.evidence[1].snippet, "function helper() { return true; }");

    // 1e. First appearance ordering (L48 appears before L14-L29)
    const reversedOrderAnswer = "Helper defined at L48. The facade implementation (L14-L29) wraps the gulp pipeline.";
    const parsedReversed = parseAndValidateEvidenceAndFollowUps(
        reversedOrderAnswer,
        [{ path: "build/lib/gulp/facade.ts" }],
        "build/lib/gulp/facade.ts",
        new Map([["build/lib/gulp/facade.ts", mockFacadeLines]])
    );
    assert.equal(parsedReversed.evidence.length, 2);
    assert.equal(parsedReversed.evidence[0].line, 48);
    assert.equal(parsedReversed.evidence[1].line, 14);
    assert.equal(parsedReversed.evidence[1].endLine, 29);

    // 1f. Overlapping & adjacent range merging (gap <= 1 line)
    mockFacadeLines[9] = "export function partOne() {";
    const mergedRangeAnswer = "Implementation parts: lines 10-15 and (L16-L20) and lines 22-25. Also helper at L48.";
    const parsedMerged = parseAndValidateEvidenceAndFollowUps(
        mergedRangeAnswer,
        [{ path: "build/lib/gulp/facade.ts" }],
        "build/lib/gulp/facade.ts",
        new Map([["build/lib/gulp/facade.ts", mockFacadeLines]])
    );
    assert.equal(parsedMerged.evidence.length, 2);
    assert.equal(parsedMerged.evidence[0].line, 10);
    assert.equal(parsedMerged.evidence[0].endLine, 25);
    assert.equal(parsedMerged.evidence[0].snippet, "export function partOne() {");
    assert.equal(parsedMerged.evidence[1].line, 48);
    assert.equal(parsedMerged.evidence[1].endLine, 48);

    // 2. Stream delimiter withholding
    const streamedTokens: string[] = [];
    const filter = new StreamDelimiterFilter((token) => streamedTokens.push(token));
    const chunks = [
        "Auth ",
        "service",
        "<",
        "<",
        "<",
        "EVIDENCE",
        ">>>",
        '[{"path":"src/auth.ts","line":1}]',
        "<",
        "<<END_EVIDENCE>>>",
        " ready."
    ];
    for (const chunk of chunks) {
        filter.feed(chunk);
    }
    filter.flush();
    const emittedText = streamedTokens.join("");
    assert.equal(emittedText, "Auth service ready.");
    assert.ok(!emittedText.includes("<<<"));
    assert.ok(!emittedText.includes("EVIDENCE"));

    // 3. Provider fallback chain on 429
    const originalFetchForFallback = globalThis.fetch;
    const fetchCalls: string[] = [];
    try {
        globalThis.fetch = async (url: any, init: any) => {
            const body = JSON.parse(init?.body || "{}");
            fetchCalls.push(body.model);
            if (body.model === "openai/gpt-oss-120b") {
                return new Response(JSON.stringify({ error: { message: "Rate limit reached" } }), {
                    status: 429,
                    headers: { "retry-after": "5", "content-type": "application/json" }
                });
            }
            if (body.model === "openai/gpt-oss-20b") {
                return new Response(JSON.stringify({
                    choices: [{ message: { content: "Fallback model answer." } }]
                }), {
                    status: 200,
                    headers: { "content-type": "application/json" }
                });
            }
            return new Response("Not found", { status: 404 });
        };

        OpenAIProvider.clearCooldowns();
        const fallbackProvider = new OpenAIProvider({
            apiKey: "test-groq-key",
            model: "openai/gpt-oss-120b",
            baseUrl: "https://api.groq.com/openai/v1"
        });
        const fallbackRes = await fallbackProvider.answer({
            repository: "example/repository",
            target: { type: "file", path: "src/auth.ts" },
            question: "What does auth do?",
            facts: { files: [{ path: "src/auth.ts" }], commits: [] }
        });

        assert.equal(fallbackRes.status, "ok");
        assert.equal(fallbackRes.answer, "Fallback model answer.");
        assert.equal(fallbackRes.usedContext?.model, "openai/gpt-oss-20b");
        assert.deepEqual(fetchCalls, ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]);
    } finally {
        globalThis.fetch = originalFetchForFallback;
        OpenAIProvider.clearCooldowns();
    }

    // 4. Cache hit
    const cachingProvider = new FakeLlmProvider({
        status: "ok",
        answer: "Cached response text.",
        citations: [{ type: "file", path: "src/auth.ts" }],
        confidence: "high"
    });
    const cachingService = new AiAnswerService(cachingProvider);
    const req1 = {
        repository: "example/repository",
        target: { type: "file" as const, path: "src/auth.ts" },
        question: "How does caching work?",
        graph,
        allowInsufficientContext: true
    };
    const res1 = await cachingService.answer(req1);
    assert.equal(res1.status, "ok");
    assert.equal(res1.usedContext?.cached, false);
    assert.equal(cachingProvider.calls.length, 1);

    const res2 = await cachingService.answer(req1);
    assert.equal(res2.status, "ok");
    assert.equal(res2.usedContext?.cached, true);
    assert.equal(cachingProvider.calls.length, 1);

    // 5. Mode prompt inclusion
    assert.ok(getModeInstruction("short").includes("Answer in 1 to 3 sentences"));
    assert.ok(getModeInstruction("detailed").includes("roughly 200 to 400 words"));
    assert.ok(getModeInstruction("steps").includes("numbered list, one action per step"));
    assert.ok(getModeInstruction("simple").includes("Answer in 1 to 2 short paragraphs"));
    assert.ok(getModeInstruction("review").includes("Answer in 1 to 2 short paragraphs"));

    const shortProvider = new FakeLlmProvider({
        status: "ok",
        answer: "Short answer bullets.",
        citations: [],
        confidence: "medium"
    });
    const shortService = new AiAnswerService(shortProvider);
    await shortService.answer({
        repository: "example/repository",
        target: { type: "file" as const, path: "src/auth.ts" },
        question: "Explain in short",
        graph,
        mode: "short",
        allowInsufficientContext: true
    });
    const shortInstructions = shortProvider.calls[0]?.instructions;
    assert.ok(
        shortInstructions?.some((inst) => inst.includes("Answer in 1 to 3 sentences")),
        "Expected mode instruction for 'short' mode"
    );

    // 6. Image attachment tests
    // 6a. Validation: >3 images rejected, oversize rejected
    const validFourImages = [
        { mime: "image/png", data: "aGVsbG8=" },
        { mime: "image/png", data: "aGVsbG8=" },
        { mime: "image/png", data: "aGVsbG8=" },
        { mime: "image/png", data: "aGVsbG8=" }
    ];
    const validationOverCount = validateImages(validFourImages);
    assert.equal(validationOverCount.valid, false);
    assert.equal(validationOverCount.message, "At most 3 images");

    const oversizeImage = [
        { mime: "image/png", data: "a".repeat(3 * 1024 * 1024 + 10) }
    ];
    const validationOversize = validateImages(oversizeImage);
    assert.equal(validationOversize.valid, false);
    assert.equal(validationOversize.message, "Image too large");

    // 6b. Vision unavailable without fallback key
    const noFallbackConfig = {
        apiKey: "primary-key",
        baseUrl: "https://api.groq.com/openai/v1",
        model: "llama-3.3-70b-versatile",
        fallbackApiKey: "",
        fallbackBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        fallbackModel: "gemini-2.5-flash"
    };
    const noFallbackProvider = new OpenAIProvider(noFallbackConfig);
    const visionUnavailableRes = await noFallbackProvider.answer({
        repository: "example/repository",
        target: { type: "file", path: "src/auth.ts" },
        question: "Analyze this image",
        facts: { files: [{ path: "src/auth.ts" }], commits: [] },
        images: [{ mime: "image/png", data: "aGVsbG8=" }]
    });
    assert.equal(visionUnavailableRes.status, "error");
    assert.equal(visionUnavailableRes.error?.code, "vision_unavailable");

    // 6c. Vision routing: with images, only fallback provider is called and body has image_url parts
    const originalFetchForVision = globalThis.fetch;
    const visionFetchCalls: Array<{ url: string; body: any }> = [];
    try {
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            const bodyStr = init?.body ? String(init.body) : "{}";
            const parsedBody = JSON.parse(bodyStr);
            visionFetchCalls.push({ url: String(input), body: parsedBody });
            return new Response(JSON.stringify({
                choices: [{
                    message: {
                        content: "Vision analysis successful."
                    }
                }],
                model: "gemini-2.5-flash"
            }), { status: 200, headers: { "Content-Type": "application/json" } });
        }) as typeof fetch;

        const visionConfig = {
            apiKey: "primary-key",
            baseUrl: "https://api.groq.com/openai/v1",
            model: "llama-3.3-70b-versatile",
            fallbackApiKey: "fallback-gemini-key",
            fallbackBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
            fallbackModel: "gemini-2.5-flash"
        };
        const visionProvider = new OpenAIProvider(visionConfig);
        const visionRes = await visionProvider.answer({
            repository: "example/repository",
            target: { type: "file", path: "src/auth.ts" },
            question: "Look at this screenshot",
            facts: { files: [{ path: "src/auth.ts" }], commits: [] },
            images: [{ mime: "image/png", data: "aGVsbG8=" }]
        });

        assert.equal(visionRes.status, "ok");
        assert.equal(visionRes.answer, "Vision analysis successful.");
        assert.equal(visionRes.usedContext?.model, "gemini-2.5-flash");
        assert.equal(visionRes.usedContext?.images, 1);
        const completionCall = visionFetchCalls.find(c => c.url.includes("/chat/completions")) || visionFetchCalls[visionFetchCalls.length - 1];
        assert.ok(completionCall.url.includes("generativelanguage.googleapis.com"));
        const userMsg = completionCall.body.messages.find((m: any) => m.role === "user");
        assert.ok(Array.isArray(userMsg.content), "User message content should be an array");
        const imgPart = userMsg.content.find((p: any) => p.type === "image_url");
        assert.ok(imgPart, "Expected image_url part in user content");
        assert.equal(imgPart.image_url.url, "data:image/png;base64,aGVsbG8=");
    } finally {
        globalThis.fetch = originalFetchForVision;
    }

    // 6c-2. Vision fallback error handling returns structured message
    try {
        globalThis.fetch = (async () => {
            return new Response(JSON.stringify({ error: { message: "Resource exhausted" } }), {
                status: 429,
                headers: { "Content-Type": "application/json", "retry-after": "45" }
            });
        }) as typeof fetch;

        const visionFailConfig = {
            apiKey: "primary-key",
            baseUrl: "https://api.groq.com/openai/v1",
            model: "llama-3.3-70b-versatile",
            fallbackApiKey: "fallback-gemini-key",
            fallbackBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
            fallbackModel: "gemini-2.5-flash"
        };
        const failProvider = new OpenAIProvider(visionFailConfig);
        const failRes = await failProvider.answer({
            repository: "example/repository",
            target: { type: "file", path: "src/auth.ts" },
            question: "Look at this screenshot",
            facts: { files: [{ path: "src/auth.ts" }], commits: [] },
            images: [{ mime: "image/png", data: "aGVsbG8=" }]
        });
        assert.equal(failRes.status, "error");
        assert.equal(failRes.error?.code, "rate_limited");
        assert.equal(failRes.retryAfterSeconds, 45);
        assert.equal(failRes.error?.message, "Image analysis is rate limited. Try again in 45s.");
    } finally {
        globalThis.fetch = originalFetchForVision;
        OpenAIProvider.setCooldown("fallback", "gemini-2.5-flash", 0);
    }

    // 6d. No caching for image requests
    const imageCachingProvider = new FakeLlmProvider({
        status: "ok",
        answer: "Image response.",
        citations: [],
        confidence: "high"
    });
    const imageAnswerService = new AiAnswerService(imageCachingProvider);
    const imgReq = {
        repository: "example/repository",
        target: { type: "file" as const, path: "src/auth.ts" },
        question: "Explain this diagram",
        graph,
        allowInsufficientContext: true,
        images: [{ mime: "image/png" as const, data: "aGVsbG8=" }]
    };
    const imgRes1 = await imageAnswerService.answer(imgReq);
    assert.equal(imgRes1.status, "ok");
    assert.equal(imgRes1.usedContext?.cached, false);
    assert.equal(imageCachingProvider.calls.length, 1);

    const imgRes2 = await imageAnswerService.answer(imgReq);
    assert.equal(imgRes2.status, "ok");
    assert.equal(imgRes2.usedContext?.cached, false);
    assert.equal(imageCachingProvider.calls.length, 2);

    // 6e. Base64 never appears in stored history / history sent to provider
    const imgHistoryReq = {
        repository: "example/repository",
        target: { type: "file" as const, path: "src/auth.ts" },
        question: "Follow-up question",
        graph,
        allowInsufficientContext: true,
        history: [
            { role: "user" as const, content: "Look at data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" },
            { role: "assistant" as const, content: "Got the image" }
        ]
    };
    await imageAnswerService.answer(imgHistoryReq);
    const lastCall = imageCachingProvider.calls[imageCachingProvider.calls.length - 1];
    const sanitizedHistory = lastCall.history;
    assert.ok(sanitizedHistory, "Expected history in call");
    for (const h of sanitizedHistory) {
        assert.ok(!h.content.includes(";base64,"), "Base64 data should be sanitized from history");
        if (h.role === "user") {
            assert.ok(h.content.includes("[image attached]"), "Marker [image attached] should replace image data");
        }
    }

    // 7. Follow-up fallback and exclusion tests
    const testFallbackEn = generateFallbackFollowUps("tests/auth.test.ts", "Explain this test", undefined, "en");
    assert.ok(testFallbackEn.length > 0 && testFallbackEn.length <= 3);
    assert.equal(testFallbackEn[0], "What does this test cover?");

    const testFallbackHi = generateFallbackFollowUps("tests/auth.test.ts", "Yeh test samjhao", undefined, "hinglish");
    assert.equal(testFallbackHi[0], "Is test mein kya check hota hai?");

    const configFallbackEn = generateFallbackFollowUps("tsconfig.json", "What is this?", undefined, "en");
    assert.equal(configFallbackEn[0], "Explain this configuration");

    const apiFallbackEn = generateFallbackFollowUps("src/api/client.ts", "What does this do?", undefined, "en");
    assert.equal(apiFallbackEn[0], "Who calls this?");

    const generalFallbackEn = generateFallbackFollowUps("src/utils.ts", "What is this?", undefined, "en");
    assert.equal(generalFallbackEn[0], "Which tests cover this file?");

    // Exclusion of current question and history questions
    const excludedFallback = generateFallbackFollowUps(
        "tests/auth.test.ts",
        "What does this test cover?", // exactly equal to candidate 1
        [{ role: "user", content: "How do I run this test?" }], // exactly equal to candidate 2
        "en"
    );
    assert.ok(!excludedFallback.includes("What does this test cover?"));
    assert.ok(!excludedFallback.includes("How do I run this test?"));
    assert.ok(excludedFallback.includes("What is mocked in this test?"));

    // End-to-end fallback when provider response has no followUps
    const noFollowUpsProvider = new FakeLlmProvider({
        status: "ok",
        answer: "This is auth file without follow-up block.",
        citations: [],
        confidence: "high"
    });
    const fallbackService = new AiAnswerService(noFollowUpsProvider);
    const fallbackAnswerRes = await fallbackService.answer({
        repository: "example/repository",
        target: { type: "file" as const, path: "src/auth.ts" },
        question: "Explain what auth does",
        graph
    });
    assert.equal(fallbackAnswerRes.status, "ok");
    assert.ok(fallbackAnswerRes.followUps && fallbackAnswerRes.followUps.length > 0);
    assert.equal(fallbackAnswerRes.followUps[0], "Which tests cover this file?");

    // 8. Phase 6 Question Classification Tests
    const cGreeting = classifyQuestion("hi", "auto");
    assert.equal(cGreeting.length, "brief");
    assert.equal(cGreeting.format, "prose");
    assert.equal(cGreeting.maxTokens, 200);
    assert.equal(cGreeting.isGreetingOrThanks, true);

    const cThanks = classifyQuestion("shukriya", "auto");
    assert.equal(cThanks.length, "brief");
    assert.equal(cThanks.format, "prose");
    assert.equal(cThanks.maxTokens, 200);
    assert.equal(cThanks.isGreetingOrThanks, true);

    const cBrief = classifyQuestion("who calls this function?", "auto");
    assert.equal(cBrief.length, "brief");
    assert.equal(cBrief.format, "prose");
    assert.equal(cBrief.maxTokens, 400);

    const cBriefHinglish = classifyQuestion("kaun call karta hai?", "auto");
    assert.equal(cBriefHinglish.length, "brief");

    const cDeep = classifyQuestion("explain the architecture and flow in detail", "auto");
    assert.equal(cDeep.length, "deep");
    assert.equal(cDeep.maxTokens, 2400);
    assert.equal(cDeep.reasoningEffort, "medium");

    const cDeepHinglish = classifyQuestion("poora flow detail mein samjhao", "auto");
    assert.equal(cDeepHinglish.length, "deep");

    const cSteps = classifyQuestion("how do I deploy this step by step?", "auto");
    assert.equal(cSteps.format, "steps");

    const cList = classifyQuestion("list which files import auth", "auto");
    assert.equal(cList.format, "list");

    const cReasoning = classifyQuestion("explain the architecture", "auto", false, "openai/gpt-oss-120b");
    assert.equal(cReasoning.maxTokens, 3100); // 2400 + 700

    const cOverrideShort = classifyQuestion("explain the architecture in detail", "short");
    assert.equal(cOverrideShort.length, "brief");

    const cOverrideDetailed = classifyQuestion("who calls this?", "detailed");
    assert.equal(cOverrideDetailed.length, "deep");

    // 9. Prompt Builder Instruction Tests
    const instructionsBrief = getSystemInstructions("auto", [], false, cBrief, "file");
    assert.ok(instructionsBrief.some((i) => i.includes("Answer in 1 to 3 sentences")));
    assert.ok(!instructionsBrief.some((i) => i.includes("Answer in short bullets")));
    assert.ok(!instructionsBrief.some((i) => i.includes("Never enumerate more than 8")));

    const instructionsDeep = getSystemInstructions("auto", [], false, cDeep, "file");
    assert.ok(instructionsDeep.some((i) => i.includes("roughly 200 to 400 words")));

    const instructionsRepo = getSystemInstructions("auto", [], false, cBrief, "repo");
    assert.ok(instructionsRepo.some((i) => i.includes("Answer at repository level using these facts and relate the selected file to them.")));

    // 10. Context Tests with Repo Scope and RepoFacts
    const mockRepoFacts = {
        analyzedFiles: 10,
        totalFiles: 20,
        symbols: 45,
        links: 30,
        topRisk: [
            { path: "src/auth.ts", score: 85, dependents: 5 },
            { path: "src/api.ts", score: 65, dependents: 3 }
        ],
        health: { circular: 0, unused: 1, godFiles: 0 },
        owners: [{ name: "Alice", share: 80 }]
    };

    const repoContextResult = assembleRepositoryContext(graph, { target: { type: "file", path: "src/auth.ts" } });
    assert.equal(repoContextResult.status, "ok");
    const aiRepoContext = buildAiContext(
        repoContextResult.context,
        "example/repository",
        [],
        undefined,
        "export function auth() {}",
        graph,
        undefined,
        undefined,
        undefined,
        undefined,
        {
            question: "repo level summary",
            scope: "repo",
            repoFacts: mockRepoFacts
        }
    );
    assert.equal(aiRepoContext.fileContent, undefined, "fileContent must be omitted in repo scope");
    assert.ok(aiRepoContext.repoFacts, "repoFacts must be present");
    assert.equal(aiRepoContext.repoFacts.totalFiles, 20);
    assert.ok(aiRepoContext.fileRiskBreakdown, "fileRiskBreakdown must be present in repo scope");

    // 11. Backend-chosen evidence extraction
    const sampleCode = [
        "import { helper } from './helper';",
        "export function validateUser(token: string) {",
        "    if (!token) throw new Error('missing token');",
        "    return token === 'secret';",
        "}",
        "export function logout() {",
        "    return true;",
        "}"
    ].join("\n");

    const answerWithBackticks = "We call `validateUser` to check token credentials.";
    const backendEvidence = extractBackendChosenEvidence(
        answerWithBackticks,
        "how does validation work?",
        "src/auth.ts",
        sampleCode,
        []
    );
    assert.ok(backendEvidence.length > 0);
    assert.equal(backendEvidence[0].path, "src/auth.ts");
    assert.ok(backendEvidence[0].line !== undefined);
    assert.ok(backendEvidence[0].snippet !== undefined);

    // Repo scope evidence extraction from topRisk
    const repoAnswer = "src/auth.ts is the highest risk component.";
    const repoEvidence = extractRepoScopeEvidence(repoAnswer, mockRepoFacts);
    assert.ok(repoEvidence.length > 0);
    assert.equal(repoEvidence[0].path, "src/auth.ts");
    assert.ok(repoEvidence[0].snippet?.includes("risk 85, 5 dependents"));

    // 12. End-to-end AiAnswerService with Auto Mode & Repo Facts
    const autoProvider = new FakeLlmProvider({
        status: "ok",
        answer: "This is a brief summary of the repo.",
        citations: [],
        confidence: "high"
    });
    const autoService = new AiAnswerService(autoProvider);

    // (a) Greeting early return
    const greetingRes = await autoService.answer({
        repository: "example/repository",
        target: { type: "file", path: "src/auth.ts" },
        question: "hi",
        graph
    });
    assert.equal(greetingRes.status, "ok");
    assert.equal(greetingRes.usedContext?.length, "brief");
    assert.equal(greetingRes.usedContext?.format, "prose");
    assert.equal(greetingRes.evidence?.length, 0);

    // (b) Repo-level question auto promotion & repo scope evidence
    const repoQuestionRes = await autoService.answer({
        repository: "example/repository",
        target: { type: "file", path: "src/auth.ts" },
        question: "Explain the whole repo architecture",
        graph,
        repoFacts: mockRepoFacts
    });
    assert.equal(repoQuestionRes.status, "ok");
    assert.equal(repoQuestionRes.usedContext?.scope, "repo");
    assert.equal(repoQuestionRes.usedContext?.length, "deep");
    assert.ok(repoQuestionRes.evidence && repoQuestionRes.evidence.length > 0);
    assert.equal(autoProvider.calls.length, 1);
    assert.equal(autoProvider.calls[0].scope, "repo");
    assert.ok(autoProvider.calls[0].classification);

    // 13. Phase 7: Scope classification table test (English & Hinglish)
    const scopeTestCases: Array<{ question: string; hasRepoFacts?: boolean; expected: 'file' | 'dependents' | 'repo' }> = [
        { question: "Explain the repository architecture", hasRepoFacts: true, expected: "repo" },
        { question: "poore project ka structure samjhao", hasRepoFacts: true, expected: "repo" },
        { question: "What are the most risky files in the repo?", hasRepoFacts: true, expected: "repo" },
        { question: "Show project level health and hotspot", hasRepoFacts: true, expected: "repo" },
        { question: "Repo level summary do", hasRepoFacts: true, expected: "repo" },
        { question: "Who calls this function?", expected: "dependents" },
        { question: "Isko kaun call karta hai?", expected: "dependents" },
        { question: "How many files depend on this?", expected: "dependents" },
        { question: "What breaks if I change this file?", expected: "dependents" },
        { question: "Is par depend karne wale kaun use karte hain?", expected: "dependents" },
        { question: "What does this file do?", expected: "file" },
        { question: "Is file ka main purpose kya hai?", expected: "file" },
        { question: "Explain the repository architecture", hasRepoFacts: false, expected: "file" }
    ];

    for (const tc of scopeTestCases) {
        const actual = classifyScope(tc.question, tc.hasRepoFacts);
        assert.equal(actual, tc.expected, `Failed classifyScope for "${tc.question}"`);
    }

    // 14. Phase 7: FactsBlock with exact totals & "showing N of TOTAL" labels
    const contextWithFacts = buildAiContext(
        contextResult.context,
        "example/repository",
        [],
        undefined,
        "export function auth() { return true; }",
        graph,
        undefined,
        undefined,
        undefined,
        undefined,
        {
            question: "How many files depend on this and compare with user.ts?",
            scope: "dependents",
            dependentFiles: [
                { path: "src/user.ts", content: "export const user = 'Ada';" }
            ]
        }
    );
    assert.ok(contextWithFacts.factsBlock, "factsBlock should be defined");
    assert.equal(contextWithFacts.factsBlock.selectedFilePath, "src/auth.ts");
    assert.equal(typeof contextWithFacts.factsBlock.riskScore, "number");
    assert.equal(typeof contextWithFacts.factsBlock.directDependentsTotal, "number");
    assert.equal(typeof contextWithFacts.factsBlock.transitiveDependentsTotal, "number");
    assert.equal(typeof contextWithFacts.factsBlock.importsTotal, "number");
    assert.equal(typeof contextWithFacts.factsBlock.testsCount.total, "number");
    assert.equal(typeof contextWithFacts.factsBlock.testsCount.direct, "number");
    assert.equal(typeof contextWithFacts.factsBlock.testsCount.indirect, "number");
    assert.equal(typeof contextWithFacts.factsBlock.commitsTotal, "number");
    assert.ok(Array.isArray(contextWithFacts.factsBlock.owners));
    assert.ok(contextWithFacts.directDependentsLabel?.startsWith("showing "), "directDependentsLabel should show N of TOTAL");
    assert.ok(contextWithFacts.directImportsLabel?.startsWith("showing "), "directImportsLabel should show N of TOTAL");

    // Named files reference test (up to 2 files, first 40 numbered lines)
    assert.ok(contextWithFacts.namedFiles, "namedFiles should be extracted when mentioned in question");
    assert.ok(contextWithFacts.namedFiles.some(nf => nf.path === "src/user.ts"));
    assert.ok(contextWithFacts.namedFiles.some(nf => nf.snippet.includes("L1: export const user = 'Ada';")));

    // 15. Phase 7: Image-only messages & language adherence from history
    const imageProvider = new FakeLlmProvider({
        status: "ok",
        answer: "This diagram shows auth and user interaction.",
        citations: [],
        confidence: "high"
    });
    const imageService = new AiAnswerService(imageProvider);

    // Empty question with images uses internal instruction with target file
    const imageOnlyResult = await imageService.answer({
        repository: "example/repository",
        target: { type: "file", path: "src/auth.ts" },
        question: "",
        images: [{
            mime: "image/png",
            data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
        }],
        graph
    });
    assert.equal(imageOnlyResult.status, "ok");
    assert.ok(imageProvider.calls.length > 0);
    const imgLastCall = imageProvider.calls[imageProvider.calls.length - 1];
    assert.ok(imgLastCall.question.includes("Explain what the attached image(s) show and relate them to src/auth.ts"));
    assert.ok(imgLastCall.instructions?.some(i => i.includes("English")));

    // Image-only question adheres to last user message language in history
    await imageService.answer({
        repository: "example/repository",
        target: { type: "file", path: "src/auth.ts" },
        question: "   ",
        images: [{
            mime: "image/png",
            data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
        }],
        history: [
            { role: "user", content: "Is diagram mein components kaise connect ho rahe hain?" },
            { role: "assistant", content: "Auth aur user models connected hain." }
        ],
        graph
    });
    const hinglishCall = imageProvider.calls[imageProvider.calls.length - 1];
    assert.ok(hinglishCall.instructions?.some(i => i.toLowerCase().includes("hinglish") || i.toLowerCase().includes("hindi")));

    // 16. Phase 7: Explicit scope override
    await imageService.answer({
        repository: "example/repository",
        target: { type: "file", path: "src/auth.ts" },
        question: "Explain the whole repository architecture", // auto would be 'repo'
        scope: "file", // explicit override
        graph,
        repoFacts: mockRepoFacts
    });
    const explicitCall = imageProvider.calls[imageProvider.calls.length - 1];
    assert.equal(explicitCall.scope, "file");

    // 17. Reliable image path: model filtering, sorting, fallback loop, cooldowns, env stripping
    // 17a. cleanEnvVal inline comment stripping
    assert.equal(cleanEnvVal("https://api.groq.com/openai/v1 # default base"), "https://api.groq.com/openai/v1");
    assert.equal(cleanEnvVal("  gemini-2.5-flash  "), "gemini-2.5-flash");
    assert.equal(cleanEnvVal("key123 # secret key"), "key123");
    assert.equal(cleanEnvVal(""), "");
    assert.equal(cleanEnvVal(undefined), "");

    // 17b. filterAndSortGeminiModels
    const rawModelList = [
        "models/gemini-1.5-flash",
        "models/gemini-2.0-flash",
        "models/gemini-2.0-flash-lite",
        "models/gemini-2.5-flash",
        "models/gemini-2.5-flash-preview", // preview excluded
        "models/gemini-2.0-flash-exp",     // exp excluded
        "models/gemini-1.5-pro",           // pro (not flash) excluded
        "models/gemini-omni-flash",        // omni excluded
        "models/gemini-live-flash",        // live excluded
        "models/gemini-thinking-flash",    // thinking excluded
        "models/embedding-001",            // embedding excluded
        "invalid model name with spaces!"  // invalid regex
    ];
    const filtered = filterAndSortGeminiModels(rawModelList);
    assert.deepEqual(filtered, [
        "gemini-2.5-flash",
        "gemini-2.0-flash",
        "gemini-2.0-flash-lite",
        "gemini-1.5-flash"
    ]);

    // 17c. getGeminiCandidateModels with discovery
    resetGeminiCandidatesCache();
    const mockOriginalFetch = globalThis.fetch;
    try {
        globalThis.fetch = (async (url: any) => {
            if (String(url).endsWith("/models")) {
                return new Response(JSON.stringify({
                    models: [
                        { name: "models/gemini-1.5-flash" },
                        { name: "models/gemini-2.5-flash" },
                        { name: "models/gemini-2.0-flash" }
                    ]
                }), { status: 200, headers: { "Content-Type": "application/json" } });
            }
            return new Response("Not found", { status: 404 });
        }) as typeof fetch;

        const candidatesWithConfig = await getGeminiCandidateModels("https://generativelanguage.googleapis.com/v1beta/openai", "test-key", "gemini-custom-flash");
        assert.deepEqual(candidatesWithConfig, [
            "gemini-custom-flash",
            "gemini-2.5-flash",
            "gemini-2.0-flash",
            "gemini-1.5-flash",
            "gemini-flash-latest",
            "gemini-flash-lite-latest"
        ]);
    } finally {
        globalThis.fetch = mockOriginalFetch;
        resetGeminiCandidatesCache();
    }

    // 17d. Fallback loop: 429 hop -> 400 continue -> 200 success
    resetGeminiCandidatesCache();
    const fetchHops: string[] = [];
    try {
        globalThis.fetch = (async (url: any, init: any) => {
            const urlStr = String(url);
            if (urlStr.endsWith("/models")) {
                return new Response(JSON.stringify({
                    models: [
                        { name: "models/gemini-hop2-flash" },
                        { name: "models/gemini-hop3-flash" }
                    ]
                }), { status: 200, headers: { "Content-Type": "application/json" } });
            }

            const bodyStr = typeof init?.body === "string" ? init.body : "";
            const parsedBody = bodyStr ? JSON.parse(bodyStr) : {};
            const modelUsed = parsedBody.model || "unknown";
            fetchHops.push(modelUsed);

            if (modelUsed === "gemini-hop1-flash") {
                // Return 429 with Retry-After 60
                return new Response(JSON.stringify({ error: { message: "Quota exceeded" } }), {
                    status: 429,
                    headers: { "Content-Type": "application/json", "retry-after": "60" }
                });
            }
            if (modelUsed === "gemini-hop2-flash") {
                // Return 400 not supported -> should continue
                return new Response(JSON.stringify({ error: { message: "The model is not supported for images" } }), {
                    status: 400,
                    headers: { "Content-Type": "application/json" }
                });
            }
            if (modelUsed === "gemini-hop3-flash") {
                // Return 200 success
                return new Response(JSON.stringify({
                    choices: [{ message: { content: "Analyzed successfully via hop 3" } }]
                }), { status: 200, headers: { "Content-Type": "application/json" } });
            }
            return new Response("Not found", { status: 404 });
        }) as typeof fetch;

        const testCandidateConfig = {
            apiKey: "primary-key",
            baseUrl: "https://api.groq.com/openai/v1",
            model: "llama-3.3-70b-versatile",
            fallbackApiKey: "fallback-gemini-key",
            fallbackBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
            fallbackModel: "gemini-hop1-flash"
        };
        const loopProvider = new OpenAIProvider(testCandidateConfig);

        const loopRes = await loopProvider.answer({
            repository: "example/repository",
            target: { type: "file", path: "src/auth.ts" },
            question: "Analyze image hop loop",
            facts: { files: [{ path: "src/auth.ts" }], commits: [] },
            images: [{ mime: "image/png", data: "aGVsbG8=" }]
        });

        assert.equal(loopRes.status, "ok");
        assert.equal(loopRes.answer, "Analyzed successfully via hop 3");
        assert.deepEqual(fetchHops, ["gemini-hop1-flash", "gemini-hop2-flash", "gemini-hop3-flash"]);
    } finally {
        globalThis.fetch = mockOriginalFetch;
        resetGeminiCandidatesCache();
    }

    // 17e. 400 fatal (other reason): stops immediately and returns image_failed
    resetGeminiCandidatesCache();
    const fatalHops: string[] = [];
    try {
        globalThis.fetch = (async (url: any, init: any) => {
            const urlStr = String(url);
            if (urlStr.endsWith("/models")) {
                return new Response(JSON.stringify({
                    models: [
                        { name: "models/gemini-fatal-flash" },
                        { name: "models/gemini-should-not-reach-flash" }
                    ]
                }), { status: 200, headers: { "Content-Type": "application/json" } });
            }

            const bodyStr = typeof init?.body === "string" ? init.body : "";
            const parsedBody = bodyStr ? JSON.parse(bodyStr) : {};
            const modelUsed = parsedBody.model || "unknown";
            fatalHops.push(modelUsed);

            return new Response(JSON.stringify({ error: { message: "Invalid argument: bad parameter foo" } }), {
                status: 400,
                headers: { "Content-Type": "application/json" }
            });
        }) as typeof fetch;

        const fatalConfig = {
            apiKey: "primary-key",
            baseUrl: "https://api.groq.com/openai/v1",
            model: "llama-3.3-70b-versatile",
            fallbackApiKey: "fallback-gemini-key",
            fallbackBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
            fallbackModel: "gemini-fatal-flash"
        };
        const fatalProvider = new OpenAIProvider(fatalConfig);

        const fatalRes = await fatalProvider.answer({
            repository: "example/repository",
            target: { type: "file", path: "src/auth.ts" },
            question: "Analyze fatal 400",
            facts: { files: [{ path: "src/auth.ts" }], commits: [] },
            images: [{ mime: "image/png", data: "aGVsbG8=" }]
        });

        assert.equal(fatalRes.status, "error");
        assert.equal(fatalRes.error?.code, "image_failed");
        assert.ok(fatalRes.error?.message?.includes("Image analysis failed (status 400)"));
        assert.deepEqual(fatalHops, ["gemini-fatal-flash"]);
    } finally {
        globalThis.fetch = mockOriginalFetch;
        resetGeminiCandidatesCache();
    }

    console.log("AI fixtures passed");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
