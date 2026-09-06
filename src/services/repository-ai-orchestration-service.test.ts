import assert from "node:assert/strict";
import type { AiAnswerRequest, AiAnswerResult } from "../ai/answer-service";
import type { RepositoryGraph } from "../graph/repository-graph";
import { GitHubRepositoryFileError } from "../github/repository-file-client";
import { RepositoryAiOrchestrationService } from "./repository-ai-orchestration-service";
import type { RepositoryFileInput } from "./repository-analysis-service";

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

async function main(): Promise<void> {
    const fileClient = new FakeFileClient();
    const analysisService = new FakeAnalysisService();
    const aiService = new FakeAiService();
    const service = new RepositoryAiOrchestrationService(fileClient, analysisService, aiService);

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
