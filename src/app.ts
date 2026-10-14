import path from "node:path";
import fs from "node:fs";
import express, { Application, Request, Response, NextFunction } from "express";
import { AiAnswerService } from "./ai/answer-service";
import { createLlmProviderFromEnvironment } from "./ai/provider-factory";
import { createAiRouter } from "./routes/ai";
import analysisRouter from "./routes/analysis";
import healthRouter from "./routes/health";
import { createImpactRouter } from "./routes/impact";
import repositoriesRouter from "./routes/repositories";
import { createRateLimiter } from "./middleware/rate-limiter";

const app: Application = express();
app.set("trust proxy", 1);

const aiService = new AiAnswerService(createLlmProviderFromEnvironment());

// Health check endpoint (GET /healthz)
app.get("/healthz", (_req: Request, res: Response) => {
    res.status(200).json({ ok: true });
});

// In-memory rate limiting abuse protection:
// 20 requests/minute on /api/ai/*, 10/minute on analyze routes
const aiRateLimiter = createRateLimiter({ maxRequests: 20, windowMs: 60_000 });
const analyzeRateLimiter = createRateLimiter({ maxRequests: 10, windowMs: 60_000 });

app.use("/api/ai", aiRateLimiter);
app.use((req: Request, res: Response, next: NextFunction) => {
    const pathname = req.originalUrl ? req.originalUrl.split("?")[0] : req.path;
    if (
        pathname === "/api/analyze" ||
        pathname.startsWith("/api/analyze/") ||
        pathname.startsWith("/api/repositories/analyze")
    ) {
        return analyzeRateLimiter(req, res, next);
    }
    next();
});

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

// Return JSON 404 for unhandled /api routes
app.use("/api", (req: Request, res: Response) => {
    res.status(404).json({
        status: "error",
        code: "not_found",
        message: `Endpoint ${req.method} ${req.originalUrl || req.url} not found`
    });
});

// Production static serving & SPA fallback
if (process.env.NODE_ENV === "production") {
    const frontendDist = path.resolve(__dirname, "../frontend/dist");
    app.use(express.static(frontendDist));
    app.use((req: Request, res: Response, next: NextFunction) => {
        if (req.method !== "GET" || req.path.startsWith("/api")) {
            return next();
        }
        const indexHtml = path.join(frontendDist, "index.html");
        if (fs.existsSync(indexHtml)) {
            res.sendFile(indexHtml);
        } else {
            next();
        }
    });
}

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
