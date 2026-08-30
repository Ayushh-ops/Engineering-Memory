import { Request, Response, Router } from "express";
import { AiAnswerService } from "../ai/answer-service";
import { createLlmProviderFromEnvironment } from "../ai/provider-factory";
import { type RepositoryContextTarget } from "../graph/repository-context";
import { isRepositoryGraph } from "../graph/repository-query";

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

export function createAiRouter(service: AiAnswerService): Router {
    const router = Router();

    router.post("/ai/ask", async (req: Request, res: Response) => {
        if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
            return res.status(400).json({ error: "Malformed request body." });
        }

        const { repository, target, question, graph, limits } = req.body as Record<string, unknown>;

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

        try {
            const result = await service.answer({
                repository: repository.trim(),
                target: target as RepositoryContextTarget,
                question: question.trim(),
                graph: graph as Parameters<typeof service.answer>[0]["graph"],
                limits: limits as Parameters<typeof service.answer>[0]["limits"],
                allowInsufficientContext: true
            });

            return res.status(result.status === "ok" ? 200 : result.status === "insufficient_context" ? 200 : result.error?.code === "invalid_api_key" ? 401 : result.error?.code === "rate_limit" ? 429 : 502).json({
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

    return router;
}

const router = createAiRouter(new AiAnswerService(createLlmProviderFromEnvironment()));
export default router;
