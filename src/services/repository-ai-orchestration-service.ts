import type { AiAnswerRequest, AiAnswerResult, AiAnswerService } from "../ai/answer-service";
import type { RepositoryContextTarget, RepositoryContextLimits } from "../graph/repository-context";
import type { GitHubRepositoryFileClient } from "../github/repository-file-client";
import type { RepositoryAnalysisService } from "./repository-analysis-service";

export interface RepositoryAiOrchestrationRequest {
    owner: string;
    repository: string;
    sha: string;
    paths: string[];
    target: RepositoryContextTarget;
    question: string;
    limits?: Partial<RepositoryContextLimits>;
    allowInsufficientContext?: boolean;
}

export class RepositoryAiOrchestrationService {
    constructor(
        private readonly fileClient: Pick<GitHubRepositoryFileClient, "loadFiles">,
        private readonly analysisService: Pick<RepositoryAnalysisService, "analyzeFiles">,
        private readonly aiService: Pick<AiAnswerService, "answer">
    ) {}

    async answer(request: RepositoryAiOrchestrationRequest): Promise<AiAnswerResult> {
        const files = await this.fileClient.loadFiles(
            request.owner,
            request.repository,
            request.paths,
            request.sha
        );
        const analysis = this.analysisService.analyzeFiles(
            { owner: request.owner, repository: request.repository },
            request.sha,
            files
        );
        const aiRequest: AiAnswerRequest = {
            repository: `${request.owner}/${request.repository}`,
            target: request.target,
            question: request.question,
            graph: analysis.graph,
            limits: request.limits,
            allowInsufficientContext: request.allowInsufficientContext
        };

        return this.aiService.answer(aiRequest);
    }
}
