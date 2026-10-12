import { Request, Response, Router } from "express";
import { AiAnswerService, getGreetingOrSmallTalkResponse } from "../ai/answer-service";
import { classifyQuestion } from "../ai/question-class";
import { createLlmProviderFromEnvironment } from "../ai/provider-factory";
import { type RepositoryContextTarget } from "../graph/repository-context";
import { GitHubRepositoryFileClient, GitHubRepositoryFileError } from "../github/repository-file-client";
import { isRepositoryGraph } from "../graph/repository-query";
import { parseGitHubRepositoryUrl } from "./repositories";
import { RepositoryAiOrchestrationService, buildFallbackFactsAnswer } from "../services/repository-ai-orchestration-service";
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

export function validateImages(images: unknown): { valid: true; parsed?: Array<{ mime: "image/jpeg" | "image/png" | "image/webp"; data: string }> } | { valid: false; code: string; message: string } {
    if (images === undefined || images === null) {
        return { valid: true, parsed: undefined };
    }
    if (!Array.isArray(images)) {
        return { valid: false, code: "bad_request", message: "images must be an array." };
    }
    if (images.length > 3) {
        return { valid: false, code: "bad_request", message: "At most 3 images" };
    }
    const ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
    const MAX_BASE64_LENGTH = 3 * 1024 * 1024; // 3 MB of base64 text

    const parsed: Array<{ mime: "image/jpeg" | "image/png" | "image/webp"; data: string }> = [];
    for (let i = 0; i < images.length; i++) {
        const item = images[i];
        if (!item || typeof item !== "object") {
            return { valid: false, code: "bad_request", message: `Image ${i + 1} is invalid.` };
        }
        const { mime, data } = item as { mime?: unknown; data?: unknown };
        if (typeof mime !== "string" || !ALLOWED_MIMES.has(mime)) {
            return { valid: false, code: "bad_request", message: `Unsupported image type. Supported: image/jpeg, image/png, image/webp.` };
        }
        if (typeof data !== "string" || data.trim().length === 0) {
            return { valid: false, code: "bad_request", message: `Image ${i + 1} is missing data.` };
        }
        let cleanData = data;
        if (cleanData.startsWith("data:")) {
            const commaIndex = cleanData.indexOf(",");
            if (commaIndex !== -1) {
                cleanData = cleanData.slice(commaIndex + 1);
            }
        }
        if (cleanData.length > MAX_BASE64_LENGTH) {
            return { valid: false, code: "bad_request", message: "Image too large" };
        }
        parsed.push({ mime: mime as "image/jpeg" | "image/png" | "image/webp", data: cleanData });
    }
    return { valid: true, parsed };
}

function sendError(res: Response, route: string, status: number, code: string, message: string) {
    console.error(`[AI ${route}] status=${status} code=${code} message="${message}"`);
    return res.status(status).json({
        status: "error",
        code,
        message,
        error: message
    });
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
            return sendError(res, "/ai/ask", 400, "bad_request", "Malformed request body.");
        }

        const { repository, target, question, graph, limits, history, risk, dependents, recentCommits, owners, mode, scope, images, repoFacts } = req.body as Record<string, unknown>;

        const imageValidation = validateImages(images);
        if (!imageValidation.valid) {
            return sendError(res, "/ai/ask", 400, imageValidation.code, imageValidation.message);
        }

        if (typeof repository !== "string" || repository.trim().length === 0) {
            return sendError(res, "/ai/ask", 400, "bad_request", "Repository is required.");
        }

        const rawQuestion = typeof question === "string" ? question.trim() : "";
        const hasImages = Boolean(imageValidation.parsed && imageValidation.parsed.length > 0);

        if (!rawQuestion && !hasImages) {
            return sendError(res, "/ai/ask", 400, "bad_request", "A question is required when no image is attached");
        }
        const resolvedQuestion = rawQuestion;

        if (!isValidRepositoryTarget(target)) {
            return sendError(res, "/ai/ask", 400, "bad_request", "Invalid target.");
        }

        if (graph !== undefined && !isRepositoryGraph(graph)) {
            return sendError(res, "/ai/ask", 400, "bad_request", "A valid repository graph is required.");
        }

        if (graph === undefined) {
            return sendError(res, "/ai/ask", 400, "bad_request", "A repository graph is required.");
        }

        if (limits !== undefined && (typeof limits !== "object" || Array.isArray(limits))) {
            return sendError(res, "/ai/ask", 400, "bad_request", "Invalid limits.");
        }

        const parsedHistory = parseAndTrimHistory(history);

        try {
            const result = await service.answer({
                repository: repository.trim(),
                target: target as RepositoryContextTarget,
                question: resolvedQuestion,
                graph: graph as Parameters<typeof service.answer>[0]["graph"],
                limits: limits as Parameters<typeof service.answer>[0]["limits"],
                allowInsufficientContext: true,
                history: parsedHistory,
                risk,
                dependents: Array.isArray(dependents) ? (dependents as string[]) : undefined,
                recentCommits: Array.isArray(recentCommits) ? (recentCommits as any[]) : undefined,
                owners,
                mode: typeof mode === "string" ? (mode as any) : "auto",
                scope: (typeof scope === "string" && ["file", "dependents", "repo", "auto"].includes(scope)) ? (scope as any) : "auto",
                images: imageValidation.parsed,
                repoFacts: repoFacts as any
            });

            if (result.retryAfterSeconds) {
                res.setHeader("Retry-After", String(result.retryAfterSeconds));
            }

            if (result.status === "error") {
                const errCode = result.error?.code || "provider_unavailable";
                const errMsg = result.error?.message || "AI service failed.";
                const statusCode = (errCode === "bad_request" || errCode === "vision_unavailable" || errCode === "invalid_question") ? 400
                    : errCode === "invalid_api_key" ? 401
                    : (errCode === "rate_limit" || errCode === "rate_limited") ? 429
                    : errCode === "model_not_found" ? 404
                    : 502;
                console.error(`[AI /ai/ask] status=${statusCode} code=${errCode} message="${errMsg}"`);
                return res.status(statusCode).json({
                    status: "error",
                    code: errCode,
                    message: errMsg,
                    error: result.error,
                    answer: result.answer || "",
                    citations: result.citations || [],
                    confidence: result.confidence || "low",
                    missingData: result.missingData ?? [],
                    ...(result.retryAfterSeconds !== undefined ? { retryAfterSeconds: result.retryAfterSeconds } : {})
                });
            }

            return res.status(200).json({
                status: result.status,
                answer: result.answer,
                citations: result.citations,
                confidence: result.confidence,
                missingData: result.missingData ?? [],
                error: result.error ?? null,
                ...(result.followUps !== undefined ? { followUps: result.followUps } : {}),
                ...(result.evidence !== undefined ? { evidence: result.evidence } : {}),
                ...(result.usedContext !== undefined ? { usedContext: result.usedContext } : {}),
                ...(result.retryAfterSeconds !== undefined ? { retryAfterSeconds: result.retryAfterSeconds } : {}),
                ...(result.truncated !== undefined ? { truncated: result.truncated } : {})
            });
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : "AI service failed.";
            return sendError(res, "/ai/ask", 500, "provider_unavailable", errMsg);
        }
    });

    router.post("/ai/ask-repository", async (req: Request, res: Response) => {
        if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
            return sendError(res, "/ai/ask-repository", 400, "bad_request", "Malformed request body.");
        }

        const { url, sha, paths, target, question, limits, history, risk, dependents, recentCommits, owners, mode, scope, images, repoFacts } = req.body as Record<string, unknown>;
        const parsedRepository = parseGitHubRepositoryUrl(url);

        if (!parsedRepository) {
            return sendError(res, "/ai/ask-repository", 400, "bad_request", "A valid GitHub repository URL is required.");
        }

        const imageValidation = validateImages(images);
        if (!imageValidation.valid) {
            const isSseEarly = req.headers.accept?.includes("text/event-stream");
            if (isSseEarly) {
                console.error(`[AI /ai/ask-repository] status=400 code=${imageValidation.code} message="${imageValidation.message}"`);
                res.setHeader("Content-Type", "text/event-stream");
                res.setHeader("Cache-Control", "no-cache");
                res.setHeader("Connection", "keep-alive");
                res.write(`event: error\ndata: ${JSON.stringify({ status: "error", code: imageValidation.code, message: imageValidation.message })}\n\n`);
                res.end();
                return;
            }
            return sendError(res, "/ai/ask-repository", 400, imageValidation.code, imageValidation.message);
        }

        if (typeof sha !== "string" || sha.trim().length === 0) {
            return sendError(res, "/ai/ask-repository", 400, "bad_request", "A non-empty commit SHA is required.");
        }

        if (!Array.isArray(paths) || paths.length === 0 || paths.length > 20) {
            return sendError(res, "/ai/ask-repository", 400, "bad_request", "Between 1 and 20 file paths are required.");
        }

        if (paths.some((path) => typeof path !== "string" || path.trim().length === 0)) {
            return sendError(res, "/ai/ask-repository", 400, "bad_request", "Every path must be a non-empty string.");
        }

        if (new Set(paths).size !== paths.length) {
            return sendError(res, "/ai/ask-repository", 400, "bad_request", "Every path must be unique.");
        }

        const rawQuestion = typeof question === "string" ? question.trim() : "";
        const hasImages = Boolean(imageValidation.parsed && imageValidation.parsed.length > 0);

        if (!rawQuestion && !hasImages) {
            const isSseEarly = req.headers.accept?.includes("text/event-stream");
            if (isSseEarly) {
                console.error(`[AI /ai/ask-repository] status=400 code=bad_request message="A question is required when no image is attached"`);
                res.setHeader("Content-Type", "text/event-stream");
                res.setHeader("Cache-Control", "no-cache");
                res.setHeader("Connection", "keep-alive");
                res.write(`event: error\ndata: ${JSON.stringify({ status: "error", code: "bad_request", message: "A question is required when no image is attached" })}\n\n`);
                res.end();
                return;
            }
            return sendError(res, "/ai/ask-repository", 400, "bad_request", "A question is required when no image is attached");
        }
        const resolvedQuestion = rawQuestion;

        if (!isValidRepositoryTarget(target)) {
            return sendError(res, "/ai/ask-repository", 400, "bad_request", "Invalid target.");
        }

        if (limits !== undefined && (typeof limits !== "object" || Array.isArray(limits))) {
            return sendError(res, "/ai/ask-repository", 400, "bad_request", "Invalid limits.");
        }

        const parsedHistory = parseAndTrimHistory(history);
        const parsedDependents = Array.isArray(dependents) ? (dependents as string[]) : undefined;
        const parsedRecentCommits = Array.isArray(recentCommits) ? (recentCommits as any[]) : undefined;
        const parsedMode = typeof mode === "string" ? mode : "auto";
        const parsedScope = (typeof scope === "string" && ["file", "dependents", "repo", "auto"].includes(scope)) ? (scope as any) : "auto";
        const isSse = req.headers.accept?.includes("text/event-stream");

        const greetingReply = rawQuestion ? getGreetingOrSmallTalkResponse(rawQuestion) : null;
        const classification = classifyQuestion(rawQuestion, parsedMode, hasImages);

        if (greetingReply || (classification.isGreetingOrThanks && rawQuestion)) {
            const finalGreeting = greetingReply || "You're welcome! Let me know if you need anything else.";
            if (isSse) {
                res.setHeader("Content-Type", "text/event-stream");
                res.setHeader("Cache-Control", "no-cache");
                res.setHeader("Connection", "keep-alive");
                res.write(`event: token\ndata: ${JSON.stringify({ token: finalGreeting })}\n\n`);
                res.write(`event: done\ndata: ${JSON.stringify({
                    status: "ok",
                    answer: finalGreeting,
                    citations: [],
                    confidence: "high",
                    missingData: [],
                    error: null,
                    followUps: [],
                    evidence: [],
                    usedContext: {
                        files: 0,
                        commits: 0,
                        provider: "internal",
                        model: "deterministic",
                        cached: false,
                        length: "brief",
                        format: "prose",
                        scope: parsedScope
                    }
                })}\n\n`);
                res.end();
                return;
            }
            return res.status(200).json({
                status: "ok",
                answer: finalGreeting,
                citations: [],
                confidence: "high",
                missingData: [],
                error: null,
                followUps: [],
                evidence: [],
                usedContext: {
                    files: 0,
                    commits: 0,
                    provider: "internal",
                    model: "deterministic",
                    cached: false,
                    length: "brief",
                    format: "prose",
                    scope: parsedScope
                }
            });
        }

        if (isSse) {
            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");

            let accumulatedTokens = "";
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
                            question: resolvedQuestion,
                            limits: limits as Parameters<typeof service.answer>[0]["limits"],
                            allowInsufficientContext: true,
                            history: parsedHistory,
                            risk,
                            dependents: parsedDependents,
                            recentCommits: parsedRecentCommits,
                            owners,
                            mode: parsedMode,
                            scope: parsedScope,
                            images: imageValidation.parsed,
                            repoFacts: repoFacts as any
                        } as any,
                        (token: string) => {
                            accumulatedTokens += token;
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
                        question: resolvedQuestion,
                        limits: limits as Parameters<typeof service.answer>[0]["limits"],
                        allowInsufficientContext: true,
                        history: parsedHistory,
                        risk,
                        dependents: parsedDependents,
                        recentCommits: parsedRecentCommits,
                        owners,
                        mode: parsedMode,
                        scope: parsedScope,
                        images: imageValidation.parsed,
                        repoFacts: repoFacts as any
                    } as any);
                }

                if (streamResult.status === "error" && streamResult.error) {
                    console.error(`[AI /ai/ask-repository] status=502 code=${streamResult.error.code} message="${streamResult.error.message}"`);
                    sendEvent("error", {
                        status: "error",
                        code: streamResult.error.code,
                        message: streamResult.error.message,
                        ...(streamResult.retryAfterSeconds !== undefined ? { retryAfterSeconds: streamResult.retryAfterSeconds } : {})
                    });
                } else {
                    sendEvent("done", {
                        status: streamResult.status,
                        answer: streamResult.answer,
                        citations: streamResult.citations,
                        confidence: streamResult.confidence,
                        missingData: streamResult.missingData ?? [],
                        error: streamResult.error ?? null,
                        ...(streamResult.followUps !== undefined ? { followUps: streamResult.followUps } : {}),
                        ...(streamResult.evidence !== undefined ? { evidence: streamResult.evidence } : {}),
                        ...(streamResult.usedContext !== undefined ? { usedContext: streamResult.usedContext } : {}),
                        ...(streamResult.retryAfterSeconds !== undefined ? { retryAfterSeconds: streamResult.retryAfterSeconds } : {}),
                        ...(streamResult.truncated !== undefined ? { truncated: streamResult.truncated } : {})
                    });
                }
                res.end();
                return;
            } catch (error) {
                if (accumulatedTokens.trim().length > 0 && !res.writableEnded) {
                    sendEvent("done", {
                        status: "ok",
                        answer: accumulatedTokens.trim(),
                        citations: [],
                        confidence: "medium",
                        missingData: [],
                        error: null,
                        truncated: true
                    });
                    res.end();
                    return;
                }
                if (target && (target as any).type === "file" && !res.writableEnded) {
                    const fallbackAns = buildFallbackFactsAnswer((target as any).path, {
                        risk,
                        dependents: parsedDependents,
                        owners,
                        recentCommits: parsedRecentCommits
                    });
                    sendEvent("done", {
                        status: "ok",
                        answer: fallbackAns,
                        citations: [],
                        confidence: "medium",
                        missingData: ["file_content_unavailable"],
                        error: null
                    });
                    res.end();
                    return;
                }
                const errCode = error instanceof GitHubRepositoryFileError
                    ? (error.code === "not_found" ? "model_not_found" : error.code === "rate_limit" ? "rate_limited" : "provider_unavailable")
                    : "provider_unavailable";
                const errMsg = error instanceof Error ? error.message : "Unable to load and analyze repository.";
                const status = error instanceof GitHubRepositoryFileError
                    ? (error.code === "not_found" ? 404 : error.code === "not_file" ? 400 : error.code === "rate_limit" ? 429 : 502)
                    : 500;
                console.error(`[AI /ai/ask-repository] status=${status} code=${errCode} message="${errMsg}"`);
                sendEvent("error", {
                    status: "error",
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
                question: resolvedQuestion,
                limits: limits as Parameters<typeof service.answer>[0]["limits"],
                allowInsufficientContext: true,
                history: parsedHistory,
                risk,
                dependents: parsedDependents,
                recentCommits: parsedRecentCommits,
                owners,
                mode: parsedMode,
                scope: parsedScope,
                images: imageValidation.parsed,
                repoFacts: repoFacts as any
            } as any);

            if (result.retryAfterSeconds) {
                res.setHeader("Retry-After", String(result.retryAfterSeconds));
            }

            if (result.status === "error") {
                const errCode = result.error?.code || "provider_unavailable";
                const errMsg = result.error?.message || "AI service failed.";
                const statusCode = (errCode === "bad_request" || errCode === "vision_unavailable" || errCode === "invalid_question") ? 400
                    : errCode === "invalid_api_key" ? 401
                    : (errCode === "rate_limit" || errCode === "rate_limited") ? 429
                    : errCode === "model_not_found" ? 404
                    : 502;
                console.error(`[AI /ai/ask-repository] status=${statusCode} code=${errCode} message="${errMsg}"`);
                return res.status(statusCode).json({
                    status: "error",
                    code: errCode,
                    message: errMsg,
                    error: result.error,
                    answer: result.answer || "",
                    citations: result.citations || [],
                    confidence: result.confidence || "low",
                    missingData: result.missingData ?? [],
                    ...(result.retryAfterSeconds !== undefined ? { retryAfterSeconds: result.retryAfterSeconds } : {})
                });
            }

            return res.status(result.status === "ok" || result.status === "insufficient_context" ? 200 : 502).json({
                status: result.status,
                answer: result.answer,
                citations: result.citations,
                confidence: result.confidence,
                missingData: result.missingData ?? [],
                error: result.error ?? null,
                ...(result.followUps !== undefined ? { followUps: result.followUps } : {}),
                ...(result.evidence !== undefined ? { evidence: result.evidence } : {}),
                ...(result.usedContext !== undefined ? { usedContext: result.usedContext } : {}),
                ...(result.retryAfterSeconds !== undefined ? { retryAfterSeconds: result.retryAfterSeconds } : {}),
                ...(result.truncated !== undefined ? { truncated: result.truncated } : {})
            });
        } catch (error) {
            if (target && (target as any).type === "file") {
                const fallbackAns = buildFallbackFactsAnswer((target as any).path, {
                    risk,
                    dependents: parsedDependents,
                    owners,
                    recentCommits: parsedRecentCommits
                });
                return res.status(200).json({
                    status: "ok",
                    answer: fallbackAns,
                    citations: [],
                    confidence: "medium",
                    missingData: ["file_content_unavailable"],
                    error: null
                });
            }

            if (error instanceof GitHubRepositoryFileError) {
                const status = error.code === "not_found" ? 404 : error.code === "not_file" ? 400 : error.code === "rate_limit" ? 429 : 502;
                const code = error.code === "not_found" ? "model_not_found" : error.code === "rate_limit" ? "rate_limited" : "bad_request";
                return sendError(res, "/ai/ask-repository", status, code, error.message);
            }

            return sendError(res, "/ai/ask-repository", 502, "provider_unavailable", "Unable to load and analyze the GitHub repository.");
        }
    });

    return router;
}

const router = createAiRouter(new AiAnswerService(createLlmProviderFromEnvironment()));
export default router;
