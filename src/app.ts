import express, { Application, Request, Response, NextFunction } from "express";
import { AiAnswerService } from "./ai/answer-service";
import { createLlmProviderFromEnvironment } from "./ai/provider-factory";
import { createAiRouter } from "./routes/ai";
import analysisRouter from "./routes/analysis";
import healthRouter from "./routes/health";
import { createImpactRouter } from "./routes/impact";
import repositoriesRouter from "./routes/repositories";

const app: Application = express();
const aiService = new AiAnswerService(createLlmProviderFromEnvironment());

// Mount specific body parsers before default parser
const graphPaths = [
    "/api/repositories/graph",
    "/api/health/summary",
    "/api/impact",
    "/api/plan"
];
for (const p of graphPaths) {
    app.use(p, express.json({ limit: "30mb" }));
}
app.use("/api/ai", express.json({ limit: "12mb" }));
app.use(express.json());

app.use("/api", analysisRouter);
app.use("/api", healthRouter);
app.use("/api", repositoriesRouter);
app.use("/api", createImpactRouter());
app.use("/api", createAiRouter(aiService));

// Global error handler - ensures all errors are returned as JSON
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
        return next(err);
    }
    const status = typeof err.status === "number" ? err.status : typeof err.statusCode === "number" ? err.statusCode : 500;
    let code = "error";
    if (status === 413 || err.type === "entity.too.large") {
        code = "payload_too_large";
    } else if (typeof err.code === "string") {
        code = err.code;
    } else if (status === 400) {
        code = "bad_request";
    } else if (status === 404) {
        code = "not_found";
    } else if (status >= 500) {
        code = "internal_server_error";
    }
    const message = err.message || (status === 413 ? "Payload too large" : "Internal server error");
    res.status(status).json({
        status: "error",
        code,
        message
    });
});

export default app;

