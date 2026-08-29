import { Request, Response, Router } from "express";
import { isRepositoryGraph } from "../graph/repository-query";
import { isRepositoryContextRequest } from "../graph/repository-context";
import { OpenAIProvider } from "../ai/openai-provider";
import { AiAnswerService } from "../ai/answer-service";
import { createOpenAIConfigFromEnvironment } from "../ai/config";

const router = Router();

router.post("/repositories/ai/answer", async (req: Request, res: Response) => {
    const graph = req.body?.graph;
    const contextRequest = req.body?.request;
    const question = req.body?.question;
    const repository = req.body?.repository;

    if (!isRepositoryGraph(graph) || !isRepositoryContextRequest(contextRequest) || typeof question !== "string" || question.trim().length === 0) {
        return res.status(400).json({ error: "A valid graph, context request, and non-empty question are required." });
    }

    const config = createOpenAIConfigFromEnvironment();
    if (!config.apiKey) {
        return res.status(500).json({ error: "OPENAI_API_KEY is not configured." });
    }

    const service = new AiAnswerService(new OpenAIProvider(config));
    const result = await service.answer({
        repository: typeof repository === "string" && repository.trim().length > 0 ? repository : "unknown",
        target: contextRequest.target,
        question,
        graph,
        limits: contextRequest.limits,
        allowInsufficientContext: true
    });

    if (result.status === "ok") {
        return res.status(200).json({
            status: "ok",
            answer: result.answer,
            citations: result.citations,
            confidence: result.confidence
        });
    }

    if (result.status === "insufficient_context") {
        return res.status(200).json({
            status: "insufficient_context",
            answer: result.answer,
            citations: result.citations,
            confidence: result.confidence,
            missingData: result.missingData
        });
    }

    return res.status(result.error?.code === "invalid_api_key" ? 401 : result.error?.code === "rate_limit" ? 429 : 502).json({
        error: result.error?.message ?? "AI answer generation failed."
    });
});

export default router;
