import assert from "node:assert/strict";
import { analyzeTypeScript } from "../analyzers/typescript";
import { resolveRelativeImportRelationships } from "../resolvers/relative-imports";
import { buildRepositoryGraph } from "../graph/repository-graph";
import { assembleRepositoryContext } from "../graph/repository-context";
import { buildAiContext, MAX_AI_CONTEXT_BYTES } from "./context";
import type { AiImpactContext } from "./impact-context";
import { buildPrompt } from "./prompt-builder";
import { AiAnswerService } from "./answer-service";
import type { LlmProvider, LlmRequest, LlmResponse } from "./provider";
import {
    validateOpenAIConfig,
    createOpenAIConfigFromEnvironment
} from "./config";
import { OpenAIProvider } from "./openai-provider";
import { createLlmProviderFromEnvironment } from "./provider-factory";
import { createAiRouter } from "../routes/ai";
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
        ["repository", "target", "files", "symbols", "imports", "callers", "commits", "symbolChanges"]
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
    const invalidBody = await invalidResponse.json() as { error: string };
    assert.match(invalidBody.error, /question/i);

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
