import type { AiAnswerRequest, AiAnswerResult, AiAnswerService } from "../ai/answer-service";
import type { RepositoryContextTarget, RepositoryContextLimits } from "../graph/repository-context";
import type { GitHubRepositoryFileClient } from "../github/repository-file-client";
import type { RepositoryAnalysisService } from "./repository-analysis-service";
import { RepositoryContextExpansionService } from "./repository-context-expansion-service";
import { GitHubRepositoryFileError } from "../github/repository-file-client";
import { RepositorySourceEvidenceService } from "./repository-source-evidence-service";
import { QuestionContextPlanner } from "./question-context-planner";
import { ChangeImpactAnalysisService } from "./change-impact-analysis-service";

export interface RepositoryAiOrchestrationRequest {
    owner: string;
    repository: string;
    sha: string;
    paths: string[];
    target: RepositoryContextTarget;
    question: string;
    limits?: Partial<RepositoryContextLimits>;
    allowInsufficientContext?: boolean;
    lang?: "en" | "hinglish";
    history?: Array<{ role: string; content: string }>;
    risk?: any;
    dependents?: string[];
    recentCommits?: Array<{ sha: string; message: string; author?: string; authorName?: string; date?: string; authorDate?: string }>;
    owners?: any;
}

export class RepositoryAiOrchestrationService {
    constructor(
        private readonly fileClient: Pick<GitHubRepositoryFileClient, "loadFiles">,
        private readonly analysisService: Pick<RepositoryAnalysisService, "analyzeFiles">,
        private readonly aiService: Pick<AiAnswerService, "answer"> & { streamAnswer?: AiAnswerService["streamAnswer"] },
        private readonly expansionService: Pick<RepositoryContextExpansionService, "maxAdditionalFiles" | "selectRelatedFiles" | "selectImportCandidates"> = new RepositoryContextExpansionService(),
        private readonly sourceEvidenceService: Pick<RepositorySourceEvidenceService, "select"> = new RepositorySourceEvidenceService(),
        private readonly questionContextPlanner: Pick<QuestionContextPlanner, "plan"> = new QuestionContextPlanner(),
        private readonly changeImpactAnalysisService: Pick<ChangeImpactAnalysisService, "analyze"> = new ChangeImpactAnalysisService()
    ) {}

    private async prepareAiRequest(request: RepositoryAiOrchestrationRequest): Promise<{ aiRequest: AiAnswerRequest } | { earlyResult: AiAnswerResult }> {
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
        const contextPlan = this.questionContextPlanner.plan(request.question, request.target);

        while (additionalFileCount < maxAdditionalFiles) {
            const importCandidatePaths = this.expansionService.selectImportCandidates(
                finalAnalysis.files,
                [...knownPaths, ...relatedPaths, ...attemptedPaths]
            );
            const relatedCandidates = relatedPaths.filter((path) => !knownPaths.has(path) && !attemptedPaths.has(path));
            const candidatePaths = contextPlan.prioritizedContextTypes.flatMap((contextType) =>
                contextType === "related-files"
                    ? relatedCandidates
                    : contextType === "imports"
                        ? importCandidatePaths
                        : []
            );
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
        const targetFilePath = request.target.type === "file"
            ? request.target.path
            : request.target.type === "symbol"
                ? request.target.symbol.path
                : null;
        const targetFile = targetFilePath ? analyzedFiles.find((f) => f.path === targetFilePath) : undefined;

        if (request.target.type === "file" && (!targetFile || typeof targetFile.content !== "string")) {
            return {
                earlyResult: {
                    status: "error",
                    answer: "",
                    citations: [],
                    confidence: "low",
                    error: {
                        code: "bad_request",
                        message: `Could not load file content for ${request.target.path}.`
                    }
                }
            };
        }

        const impactTarget = request.target.type === "symbol" || request.target.type === "file"
            ? request.target
            : null;
        const impact = contextPlan.prioritizedContextTypes.includes("impact") && impactTarget
            ? this.changeImpactAnalysisService.analyze(finalAnalysis.graph, impactTarget, undefined, analyzedFiles)
            : undefined;
        const evidence = impact && impact.sourceEvidence.length > 0
            ? undefined
            : this.sourceEvidenceService.select(request.target, finalAnalysis.graph, analyzedFiles);
        const fileContent = targetFile?.content ?? undefined;
        const aiRequest: AiAnswerRequest = {
            repository: `${request.owner}/${request.repository}`,
            target: request.target,
            question: request.question,
            graph: finalAnalysis.graph,
            limits: request.limits,
            allowInsufficientContext: request.target.type === "file" ? false : request.allowInsufficientContext,
            evidence,
            impact,
            fileContent,
            lang: request.lang,
            history: request.history,
            risk: request.risk,
            dependents: request.dependents,
            recentCommits: request.recentCommits,
            owners: request.owners
        };

        return { aiRequest };
    }

    async answer(request: RepositoryAiOrchestrationRequest): Promise<AiAnswerResult> {
        const prepared = await this.prepareAiRequest(request);
        if ("earlyResult" in prepared) {
            return prepared.earlyResult;
        }
        return this.aiService.answer(prepared.aiRequest);
    }

    async streamAnswer(
        request: RepositoryAiOrchestrationRequest,
        onToken: (token: string) => void
    ): Promise<AiAnswerResult> {
        const prepared = await this.prepareAiRequest(request);
        if ("earlyResult" in prepared) {
            return prepared.earlyResult;
        }
        if (typeof this.aiService.streamAnswer === "function") {
            return this.aiService.streamAnswer(prepared.aiRequest, onToken);
        }
        return this.aiService.answer(prepared.aiRequest);
    }
}
