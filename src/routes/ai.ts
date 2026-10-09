import { Request, Response, Router } from "express";
import { AiAnswerService } from "../ai/answer-service";
import { createLlmProviderFromEnvironment } from "../ai/provider-factory";
import { type RepositoryContextTarget } from "../graph/repository-context";
import { GitHubRepositoryFileClient, GitHubRepositoryFileError } from "../github/repository-file-client";
import { isRepositoryGraph } from "../graph/repository-query";
import { parseGitHubRepositoryUrl } from "./repositories";
import { RepositoryAiOrchestrationService } from "../services/repository-ai-orchestration-service";
import { RepositoryAnalysisService } from "../services/repository-analysis-service";

function isValidRepositoryTarget(value: unknown): value is RepositoryContextTarget {
    if (!value || typeof value !== "object") {
        return false;
    }

    const candidate = value as Record<string, unknown>;

    if (candidate.type === "file") {
        return typeof candidate.path === "string" && candidate.path.trim().length > 0;
    }

    if (candidate.type === "commit") {
        return typeof candidate.sha === "string" && candidate.sha.trim().length > 0;
    }

    if (candidate.type === "symbol") {
        const symbol = candidate.symbol;
        if (!symbol || typeof symbol !== "object") {
            return false;
        }

        const symbolRecord = symbol as Record<string, unknown>;
        const symbolType = String(symbolRecord.type ?? "");
        const symbolPath = typeof symbolRecord.path === "string" ? symbolRecord.path.trim() : "";
        const symbolName = typeof symbolRecord.name === "string" ? symbolRecord.name.trim() : "";

        return ["class", "function", "method"].includes(symbolType) &&
            symbolPath.length > 0 &&
            symbolName.length > 0;
    }

    return false;
}

function parseAndTrimHistory(history: unknown): Array<{ role: string; content: string }> | undefined {
    if (!Array.isArray(history)) {
        return undefined;
    }
    const valid = history.filter((h) => Boolean(h && typeof h === "object" && typeof h.content === "string"));
    return valid.slice(-4).map((h) => ({
        role: h.role === "assistant" ? "assistant" : "user",
        content: h.role === "assistant" && typeof h.content === "string" && h.content.length > 600
            ? h.content.slice(0, 600)
            : String(h.content ?? "")
    }));
}

export function createAiRouter(
    service: AiAnswerService,
    repositoryService: Pick<RepositoryAiOrchestrationService, "answer"> & { streamAnswer?: RepositoryAiOrchestrationService["streamAnswer"] } = new RepositoryAiOrchestrationService(
        new GitHubRepositoryFileClient(),
        new RepositoryAnalysisService(),
        service
    )
): Router {
    const router = Router();

    router.post("/ai/ask", async (req: Request, res: Response) => {
        if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
            return res.status(400).json({ error: "Malformed request body." });
        }

        const { repository, target, question, graph, limits, history } = req.body as Record<string, unknown>;

        if (typeof repository !== "string" || repository.trim().length === 0) {
            return res.status(400).json({ error: "Repository is required." });
        }

        if (typeof question !== "string" || question.trim().length === 0) {
            return res.status(400).json({ error: "Question is required." });
        }

        if (!isValidRepositoryTarget(target)) {
            return res.status(400).json({ error: "Invalid target." });
        }

        if (graph !== undefined && !isRepositoryGraph(graph)) {
            return res.status(400).json({ error: "A valid repository graph is required." });
        }

        if (graph === undefined) {
            return res.status(400).json({ error: "A repository graph is required." });
        }

        if (limits !== undefined && (typeof limits !== "object" || Array.isArray(limits))) {
            return res.status(400).json({ error: "Invalid limits." });
        }

        const parsedHistory = parseAndTrimHistory(history);

        try {
            const result = await service.answer({
                repository: repository.trim(),
                target: target as RepositoryContextTarget,
                question: question.trim(),
                graph: graph as Parameters<typeof service.answer>[0]["graph"],
                limits: limits as Parameters<typeof service.answer>[0]["limits"],
                allowInsufficientContext: true,
                history: parsedHistory
            });

            return res.status(result.status === "ok" ? 200 : result.status === "insufficient_context" ? 200 : result.error?.code === "bad_request" ? 400 : result.error?.code === "invalid_api_key" ? 401 : (result.error?.code === "rate_limit" || result.error?.code === "rate_limited") ? 429 : result.error?.code === "model_not_found" ? 404 : 502).json({
                status: result.status,
                answer: result.answer,
                citations: result.citations,
                confidence: result.confidence,
                missingData: result.missingData ?? [],
                error: result.error ?? null
            });
        } catch (error) {
            if (error instanceof Error) {
                return res.status(500).json({
                    status: "error",
                    answer: "",
                    citations: [],
                    confidence: "low",
                    missingData: [],
                    error: { code: "provider_unavailable", message: error.message }
                });
            }

            return res.status(500).json({
                status: "error",
                answer: "",
                citations: [],
                confidence: "low",
                missingData: [],
                error: { code: "provider_unavailable", message: "AI service failed." }
            });
        }
    });

    router.post("/ai/ask-repository", async (req: Request, res: Response) => {
        if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
            return res.status(400).json({ error: "Malformed request body." });
        }

        const { url, sha, paths, target, question, limits, history } = req.body as Record<string, unknown>;
        const parsedRepository = parseGitHubRepositoryUrl(url);

        if (!parsedRepository) {
            return res.status(400).json({ error: "A valid GitHub repository URL is required." });
        }

        if (typeof sha !== "string" || sha.trim().length === 0) {
            return res.status(400).json({ error: "A non-empty commit SHA is required." });
        }

        if (!Array.isArray(paths) || paths.length === 0 || paths.length > 20) {
            return res.status(400).json({ error: "Between 1 and 20 file paths are required." });
        }

        if (paths.some((path) => typeof path !== "string" || path.trim().length === 0)) {
            return res.status(400).json({ error: "Every path must be a non-empty string." });
        }

        if (new Set(paths).size !== paths.length) {
            return res.status(400).json({ error: "Every path must be unique." });
        }

        if (typeof question !== "string" || question.trim().length === 0) {
            return res.status(400).json({ error: "Question is required." });
        }

        if (!isValidRepositoryTarget(target)) {
            return res.status(400).json({ error: "Invalid target." });
        }

        if (limits !== undefined && (typeof limits !== "object" || Array.isArray(limits))) {
            return res.status(400).json({ error: "Invalid limits." });
        }

        const parsedHistory = parseAndTrimHistory(history);
        const isSse = req.headers.accept?.includes("text/event-stream");

        if (isSse) {
            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");

            const sendEvent = (event: string, data: any) => {
                res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
            };

            try {
                let streamResult;
                if (typeof repositoryService.streamAnswer === "function") {
                    streamResult = await repositoryService.streamAnswer(
                        {
                            owner: parsedRepository.owner,
                            repository: parsedRepository.repository,
                            sha: sha.trim(),
                            paths: (paths as string[]).map((path) => path.trim()),
                            target: target as RepositoryContextTarget,
                            question: question.trim(),
                            limits: limits as Parameters<typeof service.answer>[0]["limits"],
                            allowInsufficientContext: true,
                            history: parsedHistory
                        },
                        (token: string) => {
                            sendEvent("token", { token });
                        }
                    );
                } else {
                    streamResult = await repositoryService.answer({
                        owner: parsedRepository.owner,
                        repository: parsedRepository.repository,
                        sha: sha.trim(),
                        paths: (paths as string[]).map((path) => path.trim()),
                        target: target as RepositoryContextTarget,
                        question: question.trim(),
                        limits: limits as Parameters<typeof service.answer>[0]["limits"],
                        allowInsufficientContext: true,
                        history: parsedHistory
                    });
                }

                if (streamResult.status === "error" && streamResult.error) {
                    sendEvent("error", {
                        code: streamResult.error.code,
                        message: streamResult.error.message
                    });
                } else {
                    sendEvent("done", {
                        status: streamResult.status,
                        answer: streamResult.answer,
                        citations: streamResult.citations,
                        confidence: streamResult.confidence,
                        missingData: streamResult.missingData ?? [],
                        error: streamResult.error ?? null
                    });
                }
                res.end();
                return;
            } catch (error) {
                const errCode = error instanceof GitHubRepositoryFileError
                    ? (error.code === "not_found" ? "model_not_found" : error.code === "rate_limit" ? "rate_limited" : "provider_unavailable")
                    : "provider_unavailable";
                const errMsg = error instanceof Error ? error.message : "Unable to load and analyze repository.";
                sendEvent("error", {
                    code: errCode,
                    message: errMsg
                });
                res.end();
                return;
            }
        }

        try {
            const result = await repositoryService.answer({
                owner: parsedRepository.owner,
                repository: parsedRepository.repository,
                sha: sha.trim(),
                paths: (paths as string[]).map((path) => path.trim()),
                target: target as RepositoryContextTarget,
                question: question.trim(),
                limits: limits as Parameters<typeof service.answer>[0]["limits"],
                allowInsufficientContext: true,
                history: parsedHistory
            });

            return res.status(result.status === "ok" || result.status === "insufficient_context" ? 200 : result.error?.code === "bad_request" ? 400 : result.error?.code === "invalid_api_key" ? 401 : (result.error?.code === "rate_limit" || result.error?.code === "rate_limited") ? 429 : result.error?.code === "model_not_found" ? 404 : 502).json({
                status: result.status,
                answer: result.answer,
                citations: result.citations,
                confidence: result.confidence,
                missingData: result.missingData ?? [],
                error: result.error ?? null
            });
        } catch (error) {
            if (error instanceof GitHubRepositoryFileError) {
                const status = error.code === "not_found" ? 404 : error.code === "not_file" ? 400 : error.code === "rate_limit" ? 429 : 502;
                return res.status(status).json({ error: error.message });
            }

            return res.status(502).json({ error: "Unable to load and analyze the GitHub repository." });
        }
    });

    return router;
}

const router = createAiRouter(new AiAnswerService(createLlmProviderFromEnvironment()));
export default router;
