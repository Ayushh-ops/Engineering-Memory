import express, { Application } from "express";
import analysisRouter from "./routes/analysis";
import healthRouter from "./routes/health";
import repositoriesRouter from "./routes/repositories";

const app: Application = express();

app.use(express.json());
app.use("/api", analysisRouter);
app.use("/api", healthRouter);
app.use("/api", repositoriesRouter);

export default app;
