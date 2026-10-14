import "./env";
import app from "./app";
import { getLlmConfig } from "./ai/config";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Engineering Memory backend running on http://0.0.0.0:${PORT}`);
    const llmCfg = getLlmConfig();
    const hasKey = Boolean(llmCfg.apiKey);
    console.log(`[LLM Config] baseURL: ${llmCfg.baseUrl}, model: ${llmCfg.model}, timeout: ${llmCfg.timeoutMs}ms, apiKeySet: ${hasKey}`);
});