import express, { Application } from "express";
import { AiAnswerService } from "./ai/answer-service";
import { createLlmProviderFromEnvironment } from "./ai/provider-factory";
import { createAiRouter } from "./routes/ai";
import analysisRouter from "./routes/analysis";
import healthRouter from "./routes/health";
import repositoriesRouter from "./routes/repositories";

const app: Application = express();
const aiService = new AiAnswerService(createLlmProviderFromEnvironment());

app.use(express.json());
app.use("/api", analysisRouter);
app.use("/api", healthRouter);
app.use("/api", repositoriesRouter);
app.use("/api", createAiRouter(aiService));

export default app;
