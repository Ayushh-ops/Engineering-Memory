import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";

// Enable production mode before loading app so static SPA serving is mounted
process.env.NODE_ENV = "production";

import app from "../app";
import { createRateLimiter } from "../middleware/rate-limiter";

interface HttpResponse {
    status: number;
    headers: Headers;
    body: any;
    text: string;
}

async function request(
    port: number,
    path: string,
    options: {
        method?: string;
        headers?: Record<string, string>;
        body?: unknown;
    } = {}
): Promise<HttpResponse> {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: options.method ?? "GET",
        headers: {
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...options.headers
        },
        body: options.body ? JSON.stringify(options.body) : undefined
    });

    const text = await res.text();
    let body: any = null;
    try {
        body = JSON.parse(text);
    } catch {
        body = text;
    }

    return {
        status: res.status,
        headers: res.headers,
        body,
        text
    };
}

async function run(): Promise<void> {
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const port = (server.address() as { port: number }).port;

    try {
        // -------------------------------------------------------------
        // 1. Healthz endpoint verification
        // -------------------------------------------------------------
        const healthRes = await request(port, "/healthz");
        assert.equal(healthRes.status, 200, "GET /healthz should return 200");
        assert.deepEqual(healthRes.body, { ok: true }, "GET /healthz should return { ok: true }");
        assert.equal(typeof (healthRes.body as any).apiKey, "undefined", "No secrets in healthz");

        // -------------------------------------------------------------
        // 2. Production static serving and SPA fallback
        // -------------------------------------------------------------
        const spaRes = await request(port, "/repo?url=https://github.com/test/repo&sha=abcdef");
        assert.equal(spaRes.status, 200, "SPA fallback route should return 200");
        assert.ok(
            spaRes.text.includes("<!doctype html>") || spaRes.text.includes("<html") || spaRes.text.includes("Engineering Memory"),
            "SPA fallback should serve index.html"
        );

        // Verify /api routes do not trigger SPA fallback and return JSON 404
        const api404Res = await request(port, "/api/nonexistent-endpoint");
        assert.equal(api404Res.status, 404, "Unknown API route should return 404");
        assert.equal(api404Res.body.code, "not_found", "Unknown API route should return code not_found");
        assert.notEqual(api404Res.headers.get("content-type")?.includes("text/html"), true, "API 404 should not return index.html");

        // -------------------------------------------------------------
        // 3. AI Route Rate Limiting (20 req/min per IP)
        // -------------------------------------------------------------
        const aiIp = "192.168.1.100";
        for (let i = 1; i <= 20; i++) {
            const res = await request(port, "/api/ai/invalid-test-path", {
                headers: { "X-Forwarded-For": aiIp }
            });
            assert.notEqual(res.status, 429, `Request ${i} should be allowed by AI rate limiter`);
        }
        const rateLimitedAiRes = await request(port, "/api/ai/invalid-test-path", {
            headers: { "X-Forwarded-For": aiIp }
        });
        assert.equal(rateLimitedAiRes.status, 429, "21st AI request should be 429");
        assert.equal(rateLimitedAiRes.body.error, "rate_limited");
        assert.ok(typeof rateLimitedAiRes.body.retryAfterSeconds === "number" && rateLimitedAiRes.body.retryAfterSeconds > 0);
        assert.ok(rateLimitedAiRes.headers.get("Retry-After"), "Retry-After header should be present");

        // -------------------------------------------------------------
        // 4. Analyze Route Rate Limiting (10 req/min per IP)
        // -------------------------------------------------------------
        const analyzeIp = "192.168.1.101";
        for (let i = 1; i <= 10; i++) {
            const res = await request(port, "/api/repositories/analyze", {
                method: "POST",
                headers: { "X-Forwarded-For": analyzeIp },
                body: { url: "invalid" }
            });
            assert.notEqual(res.status, 429, `Request ${i} should be allowed by analyze rate limiter`);
        }
        const rateLimitedAnalyzeRes = await request(port, "/api/repositories/analyze", {
            method: "POST",
            headers: { "X-Forwarded-For": analyzeIp },
            body: { url: "invalid" }
        });
        assert.equal(rateLimitedAnalyzeRes.status, 429, "11th analyze request should be 429");
        assert.equal(rateLimitedAnalyzeRes.body.error, "rate_limited");
        assert.ok(typeof rateLimitedAnalyzeRes.body.retryAfterSeconds === "number" && rateLimitedAnalyzeRes.body.retryAfterSeconds > 0);

        // -------------------------------------------------------------
        // 5. Unit test for createRateLimiter custom config
        // -------------------------------------------------------------
        const limiter = createRateLimiter({ maxRequests: 2, windowMs: 500 });
        let passed = 0;
        let blocked = 0;
        const mockReq = { ip: "10.0.0.1", socket: {} } as any;
        const mockRes = {
            setHeader: () => {},
            status: () => ({
                json: () => {
                    blocked++;
                }
            })
        } as any;
        const mockNext = () => {
            passed++;
        };

        limiter(mockReq, mockRes, mockNext); // 1
        limiter(mockReq, mockRes, mockNext); // 2
        limiter(mockReq, mockRes, mockNext); // 3 (should block)

        assert.equal(passed, 2, "First 2 requests should pass");
        assert.equal(blocked, 1, "3rd request should be blocked");

        console.log("Production serving, healthz, and rate limiting tests passed.");
    } finally {
        server.close();
    }
}

run().catch((err) => {
    console.error("Production test failed:", err);
    process.exit(1);
});
