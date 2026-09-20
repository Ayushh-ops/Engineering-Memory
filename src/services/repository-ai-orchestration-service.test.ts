import assert from "node:assert/strict";
import type { AiAnswerRequest, AiAnswerResult } from "../ai/answer-service";
import type { RepositoryGraph } from "../graph/repository-graph";
import type { RepositoryContextTarget } from "../graph/repository-context";
import { GitHubRepositoryFileError } from "../github/repository-file-client";
import { RepositoryAiOrchestrationService } from "./repository-ai-orchestration-service";
import { RepositoryAnalysisService, type RepositoryFileInput } from "./repository-analysis-service";
import type { ChangeImpactAnalysisResult } from "./change-impact-analysis-service";

const graph = { nodes: [], edges: [] } as RepositoryGraph;
const answerResult: AiAnswerResult = {
    status: "insufficient_context",
    answer: "Not enough context.",
    citations: [],
    confidence: "low",
    missingData: ["question_requires_unavailable_repository_context"]
};

class FakeFileClient {
    public calls: Array<{ owner: string; repository: string; paths: string[]; sha: string }> = [];
    public failure: Error | null = null;

    async loadFiles(owner: string, repository: string, paths: string[], sha: string): Promise<RepositoryFileInput[]> {
        this.calls.push({ owner, repository, paths, sha });
        if (this.failure) throw this.failure;
        return paths.map((path) => ({ path, content: `export const ${path.replace(/\W/g, "_")} = true;` }));
    }
}

class FakeAnalysisService {
    public calls: Array<{ owner: string; repository: string; sha: string; files: RepositoryFileInput[] }> = [];

    analyzeFiles(repository: { owner: string; repository: string }, sha: string, files: RepositoryFileInput[]) {
        this.calls.push({ ...repository, sha, files });
        return {
            repository: `${repository.owner}/${repository.repository}`,
            sha,
            files: [],
            resolvedRelationships: [],
            graph
        };
    }
}

class FakeAiService {
    public calls: AiAnswerRequest[] = [];
    public result: AiAnswerResult = answerResult;

    async answer(request: AiAnswerRequest): Promise<AiAnswerResult> {
        this.calls.push(request);
        return this.result;
    }
}

class FakeChangeImpactAnalysisService {
    public calls: Array<{ graph: RepositoryGraph; target: RepositoryContextTarget; files: RepositoryFileInput[] }> = [];
    public result: ChangeImpactAnalysisResult = {
        target: { type: "symbol", path: "src/auth.ts", name: "auth" },
        status: "ok",
        bounds: { maxDepth: 3, maxResults: 10, truncated: true },
        directCallers: [],
        transitiveConsumers: [],
        tests: [],
        relatedDependencies: [],
        reviewCandidates: [],
        sourceEvidence: [],
        paths: [],
        limitations: ["static-analysis-review-signal"]
    };

    analyze(graph: RepositoryGraph, target: RepositoryContextTarget, _limits: unknown, files: RepositoryFileInput[]): ChangeImpactAnalysisResult {
        this.calls.push({ graph, target, files });
        return this.result;
    }
}

class ImportFileClient {
    public calls: string[][] = [];

    async loadFiles(
        _owner: string,
        _repository: string,
        paths: string[],
        _sha: string
    ): Promise<RepositoryFileInput[]> {
        this.calls.push(paths);
        const path = paths[0];
        if (path === "src/auth.ts") {
            return [{
                path,
                content: "import { formatUser } from './user'; export function auth() { return formatUser(); }"
            }];
        }
        if (path === "src/user.ts") {
            return [{
                path,
                content: "export function formatUser() { return 'user'; }"
            }];
        }
        if (path === "src/shared.ts") {
            return [{ path, content: "export const shared = true;" }];
        }
        throw new GitHubRepositoryFileError("not_found", "File not found.");
    }
}

class RelatedExpansionService {
    public readonly maxAdditionalFiles = 2;

    selectImportCandidates(_files: unknown[], existingPaths: string[]): string[] {
        return existingPaths.includes("src/auth.ts") && !existingPaths.includes("src/user.ts")
            ? ["src/user.ts"]
            : [];
    }

    selectRelatedFiles(_graph: RepositoryGraph, selectedPaths: string[]): string[] {
        return selectedPaths.includes("src/user.ts") ? ["src/shared.ts"] : [];
    }
}

async function main(): Promise<void> {
    const fileClient = new FakeFileClient();
    const analysisService = new FakeAnalysisService();
    const aiService = new FakeAiService();
    const nonImpactService = new FakeChangeImpactAnalysisService();
    const service = new RepositoryAiOrchestrationService(
        fileClient,
        analysisService,
        aiService,
        undefined,
        undefined,
        undefined,
        nonImpactService
    );

    const result = await service.answer({
        owner: "example",
        repository: "repository",
        sha: "abc123",
        paths: ["src/auth.ts", "src/user.ts"],
        target: { type: "file", path: "src/auth.ts" },
        question: "What does auth do?",
        limits: { maxFiles: 4 },
        allowInsufficientContext: true
    });

    assert.strictEqual(result, answerResult);
    assert.deepEqual(fileClient.calls, [{
        owner: "example",
        repository: "repository",
        paths: ["src/auth.ts", "src/user.ts"],
        sha: "abc123"
    }]);
    assert.deepEqual(analysisService.calls[0]?.files.map((file) => file.path), ["src/auth.ts", "src/user.ts"]);
    assert.strictEqual(aiService.calls[0]?.graph, graph);
    assert.equal(aiService.calls[0]?.repository, "example/repository");
    assert.equal(aiService.calls[0]?.question, "What does auth do?");
    assert.equal(nonImpactService.calls.length, 0);

    const impactFileClient = new FakeFileClient();
    const impactAnalysisService = new FakeAnalysisService();
    const impactAiService = new FakeAiService();
    const impactService = new FakeChangeImpactAnalysisService();
    const impactOrchestration = new RepositoryAiOrchestrationService(
        impactFileClient,
        impactAnalysisService,
        impactAiService,
        undefined,
        undefined,
        undefined,
        impactService
    );
    await impactOrchestration.answer({
        owner: "example",
        repository: "repository",
        sha: "abc123",
        paths: ["src/auth.ts"],
        target: { type: "symbol", symbol: { type: "function", path: "src/auth.ts", name: "auth" } },
        question: "What should I check before refactoring this?"
    });
    assert.equal(impactService.calls.length, 1);
    assert.equal(impactService.calls[0]?.target.type, "symbol");
    assert.strictEqual(impactAiService.calls[0]?.impact, impactService.result);
    assert.deepEqual(impactAiService.calls[0]?.evidence, []);

    impactService.result = { ...impactService.result, status: "ambiguous" };
    await impactOrchestration.answer({
        owner: "example",
        repository: "repository",
        sha: "abc123",
        paths: ["src/auth.ts"],
        target: { type: "symbol", symbol: { type: "function", path: "src/auth.ts", name: "auth" } },
        question: "What will be affected if I change this?"
    });
    assert.equal(impactService.calls.length, 2);
    assert.equal(impactAiService.calls[1]?.impact?.status, "ambiguous");

    impactService.result = { ...impactService.result, status: "missing" };
    await impactOrchestration.answer({
        owner: "example",
        repository: "repository",
        sha: "abc123",
        paths: ["src/auth.ts"],
        target: { type: "symbol", symbol: { type: "function", path: "src/auth.ts", name: "auth" } },
        question: "If I remove this function, what could break?"
    });
    assert.equal(impactService.calls.length, 3);
    assert.equal(impactAiService.calls[2]?.impact?.status, "missing");

    const expandingFileClient = new ImportFileClient();
    const expandingAnalysisService = new RepositoryAnalysisService();
    const expandingAiService = new FakeAiService();
    const expandingService = new RepositoryAiOrchestrationService(
        expandingFileClient,
        expandingAnalysisService,
        expandingAiService,
        new RelatedExpansionService()
    );

    await expandingService.answer({
        owner: "example",
        repository: "repository",
        sha: "abc123",
        paths: ["src/auth.ts"],
        target: { type: "file", path: "src/auth.ts" },
        question: "What does auth do?"
    });
    assert.deepEqual(expandingFileClient.calls, [
        ["src/auth.ts"],
        ["src/user.ts"],
        ["src/shared.ts"]
    ]);
    assert.ok(expandingAiService.calls[0]?.graph.nodes.some(
        (node) => node.type === "file" && node.path === "src/shared.ts"
    ));
    assert.ok(expandingAiService.calls[0]?.evidence?.some(
        (evidence) => evidence.path === "src/user.ts" && evidence.symbol.name === "formatUser"
    ));
    assert.equal(expandingFileClient.calls.length, 3);

    const failingFileClient = new FakeFileClient();
    failingFileClient.failure = new GitHubRepositoryFileError("rate_limit", "GitHub API rate limit exceeded.");
    const failingAnalysisService = new FakeAnalysisService();
    const failingAiService = new FakeAiService();
    const failingService = new RepositoryAiOrchestrationService(
        failingFileClient,
        failingAnalysisService,
        failingAiService
    );

    await assert.rejects(
        () => failingService.answer({
            owner: "example",
            repository: "repository",
            sha: "abc123",
            paths: ["src/auth.ts"],
            target: { type: "file", path: "src/auth.ts" },
            question: "What does auth do?"
        }),
        (error: unknown) => error instanceof GitHubRepositoryFileError && error.code === "rate_limit"
    );
    assert.equal(failingAnalysisService.calls.length, 0);
    assert.equal(failingAiService.calls.length, 0);

    console.log("repository AI orchestration fixtures passed");
}

void main();
