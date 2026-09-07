import type { AiAnswerRequest, AiAnswerResult, AiAnswerService } from "../ai/answer-service";
import type { RepositoryContextTarget, RepositoryContextLimits } from "../graph/repository-context";
import type { GitHubRepositoryFileClient } from "../github/repository-file-client";
import type { RepositoryAnalysisService } from "./repository-analysis-service";
import { RepositoryContextExpansionService } from "./repository-context-expansion-service";
import { GitHubRepositoryFileError } from "../github/repository-file-client";

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
        private readonly aiService: Pick<AiAnswerService, "answer">,
        private readonly expansionService: Pick<RepositoryContextExpansionService, "maxAdditionalFiles" | "selectRelatedFiles" | "selectImportCandidates"> = new RepositoryContextExpansionService()
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
        let finalAnalysis = analysis;
        let analyzedFiles = files;
        const knownPaths = new Set(request.paths);
        const attemptedPaths = new Set(request.paths);
        let additionalFileCount = 0;
        const maxAdditionalFiles = this.expansionService.maxAdditionalFiles;
        let relatedPaths: string[] = [];

        while (additionalFileCount < maxAdditionalFiles) {
            const importCandidatePaths = this.expansionService.selectImportCandidates(
                finalAnalysis.files,
                [...knownPaths, ...relatedPaths, ...attemptedPaths]
            );
            const candidatePaths = [
                ...relatedPaths.filter((path) => !knownPaths.has(path) && !attemptedPaths.has(path)),
                ...importCandidatePaths
            ];
            if (candidatePaths.length === 0) break;

            let expanded = false;
            for (const candidatePath of candidatePaths) {
                if (additionalFileCount >= maxAdditionalFiles) break;
                attemptedPaths.add(candidatePath);
                try {
                    const additionalFiles = await this.fileClient.loadFiles(
                        request.owner,
                        request.repository,
                        [candidatePath],
                        request.sha
                    );
                    analyzedFiles = analyzedFiles.concat(additionalFiles);
                    knownPaths.add(candidatePath);
                    additionalFileCount += additionalFiles.length;
                    finalAnalysis = this.analysisService.analyzeFiles(
                        { owner: request.owner, repository: request.repository },
                        request.sha,
                        analyzedFiles
                    );
                    relatedPaths = this.expansionService.selectRelatedFiles(
                        finalAnalysis.graph,
                        [...knownPaths]
                    );
                    expanded = true;
                    break;
                } catch (error) {
                    if (!(error instanceof GitHubRepositoryFileError) || error.code !== "not_found") {
                        throw error;
                    }
                }
            }

            if (!expanded) break;
        }
        const aiRequest: AiAnswerRequest = {
            repository: `${request.owner}/${request.repository}`,
            target: request.target,
            question: request.question,
            graph: finalAnalysis.graph,
            limits: request.limits,
            allowInsufficientContext: request.allowInsufficientContext
        };

        return this.aiService.answer(aiRequest);
    }
}
