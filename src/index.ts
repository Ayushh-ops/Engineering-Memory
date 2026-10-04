import "./env";
import app from "./app";
import { getLlmConfig } from "./ai/config";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

app.listen(PORT, () => {
    console.log(`Engineering Memory backend running on http://localhost:${PORT}`);
    const llmCfg = getLlmConfig();
    const hasKey = Boolean(llmCfg.apiKey);
    const keyPrefix = hasKey ? `${llmCfg.apiKey.slice(0, 4)}...` : "none";
    console.log(`[LLM Config] baseURL: ${llmCfg.baseUrl}, model: ${llmCfg.model}, timeout: ${llmCfg.timeoutMs}ms, apiKeySet: ${hasKey} (${keyPrefix})`);
});