import type { AiAnswerRequest, AiAnswerResult, AiAnswerService } from "../ai/answer-service";
import type { RepositoryContextTarget, RepositoryContextLimits } from "../graph/repository-context";
import type { GitHubRepositoryFileClient, GitHubRepositoryFile } from "../github/repository-file-client";
import type { RepositoryAnalysisService } from "./repository-analysis-service";
import { RepositoryContextExpansionService } from "./repository-context-expansion-service";
import { GitHubRepositoryFileError } from "../github/repository-file-client";
import { RepositorySourceEvidenceService } from "./repository-source-evidence-service";
import { QuestionContextPlanner } from "./question-context-planner";
import { ChangeImpactAnalysisService } from "./change-impact-analysis-service";
import { isMetaQuestion } from "../ai/question-class";

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
    mode?: any;
    scope?: any;
    images?: Array<{ mime: "image/jpeg" | "image/png" | "image/webp"; data: string }>;
    repoFacts?: any;
    requestStartTime?: number;
}

export function buildFallbackFactsAnswer(
    targetPath: string,
    facts: {
        risk?: any;
        dependents?: string[];
        owners?: any;
        recentCommits?: any[];
    }
): string {
    const lines: string[] = [
        "The file content could not be loaded from GitHub.",
        `Here is what is known about \`${targetPath}\` from repository analysis:`
    ];

    if (facts.risk !== undefined && facts.risk !== null) {
        const score = typeof facts.risk === "object" ? (facts.risk.score ?? facts.risk.riskScore) : facts.risk;
        const level = typeof facts.risk === "object" ? (facts.risk.level ?? facts.risk.riskLevel) : undefined;
        lines.push(`• **Risk**: Score is ${score}${level ? ` (${level})` : ""}.`);
    }

    if (Array.isArray(facts.dependents)) {
        if (facts.dependents.length === 0) {
            lines.push("• **Dependents**: No direct dependents found.");
        } else {
            const preview = facts.dependents.slice(0, 5).join(", ");
            const extra = facts.dependents.length > 5 ? ` and ${facts.dependents.length - 5} more` : "";
            lines.push(`• **Dependents**: ${facts.dependents.length} file(s) depend on this (${preview}${extra}).`);
        }
    }

    if (facts.owners) {
        const ownerList = Array.isArray(facts.owners) ? facts.owners : (facts.owners.owners || []);
        if (ownerList.length > 0) {
            const names = ownerList.slice(0, 3).map((o: any) => o.name || o.author || String(o)).join(", ");
            lines.push(`• **Contributors**: Primary owners include ${names}.`);
        }
    }

    if (Array.isArray(facts.recentCommits) && facts.recentCommits.length > 0) {
        const latest = facts.recentCommits[0];
        const msg = latest.message || latest.commit?.message || "Recent change";
        lines.push(`• **Recent commits**: ${facts.recentCommits.length} recent commit(s) recorded (latest: "${String(msg).split("\n")[0]}").`);
    }

    return lines.join("\n\n");
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

    private async prepareAiRequest(request: RepositoryAiOrchestrationRequest): Promise<AiAnswerRequest> {
        const fetchStart = request.requestStartTime ?? Date.now();
        const targetFilePath = request.target.type === "file"
            ? request.target.path
            : request.target.type === "symbol"
                ? request.target.symbol.path
                : undefined;

        const dependentPaths = Array.isArray(request.dependents)
            ? request.dependents.filter((p) => p !== targetFilePath)
            : [];

        const pathsToFetch = Array.from(new Set([
            ...request.paths,
            ...(targetFilePath ? [targetFilePath] : []),
            ...dependentPaths.slice(0, 10)
        ]));

        const fetchWithTimeout = <T>(promise: Promise<T>, ms = 6000): Promise<T> => {
            return new Promise<T>((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error("Timeout")), ms);
                promise.then(
                    (val) => { clearTimeout(timer); resolve(val); },
                    (err) => { clearTimeout(timer); reject(err); }
                );
            });
        };

        let files: GitHubRepositoryFile[] = [];
        if (typeof (this.fileClient as any).loadFile === "function") {
            try {
                const fetchedList = await Promise.all(
                    pathsToFetch.map(async (p) => {
                        try {
                            const f = await fetchWithTimeout<GitHubRepositoryFile>(
                                (this.fileClient as any).loadFile(request.owner, request.repository, p, request.sha),
                                6000
                            );
                            if (f && typeof f.content === "string") {
                                if (p !== targetFilePath && typeof (this.fileClient as any).cacheDependent === "function") {
                                    (this.fileClient as any).cacheDependent(request.owner, request.repository, p, request.sha, f.content);
                                }
                                return f;
                            }
                            return null;
                        } catch (err: any) {
                            if (err?.code === "rate_limit" || err?.code === "auth_failed") {
                                throw err;
                            }
                            return null;
                        }
                    })
                );
                files = fetchedList.filter((f): f is GitHubRepositoryFile => f !== null && typeof f.content === "string");
            } catch (err: any) {
                if (err?.code === "rate_limit" || err?.code === "auth_failed") {
                    throw err;
                }
                files = [];
            }
        } else {
            try {
                files = await fetchWithTimeout(
                    this.fileClient.loadFiles(request.owner, request.repository, pathsToFetch, request.sha),
                    6000
                );
            } catch (err: any) {
                if (err?.message === "Timeout") {
                    files = [];
                } else {
                    throw err;
                }
            }
        }
        const fileFetchTime = Date.now() - fetchStart;

        const ctxStart = Date.now();
        const analysis = this.analysisService.analyzeFiles(
            { owner: request.owner, repository: request.repository },
            request.sha,
            files
        );
        let finalAnalysis = analysis;
        let analyzedFiles = files;
        const knownPaths = new Set(files.map(f => f.path));
        const attemptedPaths = new Set(pathsToFetch);
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

        const targetFile = targetFilePath ? analyzedFiles.find((f) => f.path === targetFilePath) : undefined;

        if (request.target.type === "file" && (!targetFile || typeof targetFile.content !== "string")) {
            throw new GitHubRepositoryFileError("not_found", `File "${request.target.path}" was not found.`);
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
        const contextBuildTime = Date.now() - ctxStart;

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
            owners: request.owners,
            mode: request.mode,
            scope: request.scope,
            images: request.images,
            repoFacts: request.repoFacts,
            timings: {
                fileFetch: fileFetchTime,
                contextBuild: contextBuildTime
            },
            requestStartTime: fetchStart
        };

        return aiRequest;
    }

    async answer(request: RepositoryAiOrchestrationRequest): Promise<AiAnswerResult> {
        if (request.question && isMetaQuestion(request.question)) {
            return this.aiService.answer({
                repository: `${request.owner}/${request.repository}`,
                target: request.target,
                question: request.question,
                graph: { nodes: [], edges: [] },
                allowInsufficientContext: true
            });
        }
        try {
            const aiRequest = await this.prepareAiRequest(request);
            return await this.aiService.answer(aiRequest);
        } catch (error) {
            if (request.target.type === "file" && (request.risk || request.dependents || request.owners || request.recentCommits)) {
                const total = Date.now() - (request.requestStartTime ?? Date.now());
                const factsTimings = {
                    fileFetch: 0,
                    contextBuild: 0,
                    firstToken: total,
                    total,
                    model: "facts",
                    hops: 0
                };
                console.log(`[ask] total=${total}ms fetch=0ms ctx=0ms firstToken=${total}ms model=facts hops=0`);
                const fallbackAnswer = buildFallbackFactsAnswer(request.target.path, {
                    risk: request.risk,
                    dependents: request.dependents,
                    owners: request.owners,
                    recentCommits: request.recentCommits
                });
                return {
                    status: "ok",
                    mode: "repo",
                    answer: fallbackAnswer,
                    citations: [],
                    confidence: "medium",
                    missingData: ["file_content_unavailable"],
                    usedContext: {
                        files: 0,
                        commits: Array.isArray(request.recentCommits) ? request.recentCommits.length : 0,
                        provider: "facts",
                        model: "facts",
                        cached: false,
                        timings: factsTimings
                    }
                };
            }
            throw error;
        }
    }

    async streamAnswer(
        request: RepositoryAiOrchestrationRequest,
        onToken: (token: string) => void
    ): Promise<AiAnswerResult> {
        if (request.question && isMetaQuestion(request.question)) {
            const aiReq: AiAnswerRequest = {
                repository: `${request.owner}/${request.repository}`,
                target: request.target,
                question: request.question,
                graph: { nodes: [], edges: [] },
                allowInsufficientContext: true
            };
            if (typeof this.aiService.streamAnswer === "function") {
                return this.aiService.streamAnswer(aiReq, onToken);
            }
            return this.aiService.answer(aiReq);
        }
        try {
            const aiRequest = await this.prepareAiRequest(request);
            if (typeof this.aiService.streamAnswer === "function") {
                return await this.aiService.streamAnswer(aiRequest, onToken);
            }
            return await this.aiService.answer(aiRequest);
        } catch (error) {
            if (request.target.type === "file" && (request.risk || request.dependents || request.owners || request.recentCommits)) {
                const total = Date.now() - (request.requestStartTime ?? Date.now());
                const factsTimings = {
                    fileFetch: 0,
                    contextBuild: 0,
                    firstToken: total,
                    total,
                    model: "facts",
                    hops: 0
                };
                console.log(`[ask] total=${total}ms fetch=0ms ctx=0ms firstToken=${total}ms model=facts hops=0`);
                const fallbackAnswer = buildFallbackFactsAnswer(request.target.path, {
                    risk: request.risk,
                    dependents: request.dependents,
                    owners: request.owners,
                    recentCommits: request.recentCommits
                });
                onToken(fallbackAnswer);
                return {
                    status: "ok",
                    mode: "repo",
                    answer: fallbackAnswer,
                    citations: [],
                    confidence: "medium",
                    missingData: ["file_content_unavailable"],
                    usedContext: {
                        files: 0,
                        commits: Array.isArray(request.recentCommits) ? request.recentCommits.length : 0,
                        provider: "facts",
                        model: "facts",
                        cached: false,
                        timings: factsTimings
                    }
                };
            }
            throw error;
        }
    }
}
