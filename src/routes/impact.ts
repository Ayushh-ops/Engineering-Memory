import { Request, Response, Router } from "express";
import { validateRepositoryContextConsistency } from "../ai/consistency-validator";
import { isRepositoryGraph } from "../graph/repository-query";
import {
    ChangeImpactAnalysisService,
    type ChangeImpactAnalysisLimits,
    type ChangeImpactTarget
} from "../services/change-impact-analysis-service";
import type { RepositoryFileInput } from "../services/repository-analysis-service";

/**
 * Transport-level safety limits for requested impact bounds. They are HTTP
 * boundary policy only: `ChangeImpactAnalysisService` accepts any positive
 * `maxDepth` and any non-negative `maxResults` and remains unchanged, so direct
 * callers keep full service capability. The boundary bounds the response that a
 * caller-supplied graph can amplify through paths and impact nodes.
 */
export const maxChangeImpactRequestLimits: ChangeImpactAnalysisLimits = {
    maxDepth: 10,
    maxResults: 500
};

/** Maximum number of caller-supplied files accepted for source evidence. */
export const maxChangeImpactRequestFiles = 20;

type ChangeImpactRequestLimits = Partial<ChangeImpactAnalysisLimits>;

function isChangeImpactTarget(value: unknown): value is ChangeImpactTarget {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }

    const candidate = value as Record<string, unknown>;

    if (candidate.type === "file") {
        return typeof candidate.path === "string" && candidate.path.trim().length > 0;
    }

    if (candidate.type === "symbol") {
        const symbol = candidate.symbol;
        if (!symbol || typeof symbol !== "object" || Array.isArray(symbol)) {
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

/** Returns the validation error for requested limits, or null when they are acceptable. */
function requestedLimitsError(value: unknown): string | null {
    if (value === undefined) return null;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return "Impact limits must be an object with maxDepth and maxResults.";
    }

    const candidate = value as Record<string, unknown>;
    for (const key of Object.keys(candidate)) {
        if (key !== "maxDepth" && key !== "maxResults") {
            return "Impact limits must use maxDepth and maxResults only.";
        }
    }

    if (candidate.maxDepth !== undefined) {
        if (!Number.isInteger(candidate.maxDepth) || (candidate.maxDepth as number) < 1) {
            return "maxDepth must be a positive integer.";
        }
        if ((candidate.maxDepth as number) > maxChangeImpactRequestLimits.maxDepth) {
            return `maxDepth must not exceed the HTTP boundary limit of ${maxChangeImpactRequestLimits.maxDepth}.`;
        }
    }

    if (candidate.maxResults !== undefined) {
        if (!Number.isInteger(candidate.maxResults) || (candidate.maxResults as number) < 0) {
            return "maxResults must be a non-negative integer.";
        }
        if ((candidate.maxResults as number) > maxChangeImpactRequestLimits.maxResults) {
            return `maxResults must not exceed the HTTP boundary limit of ${maxChangeImpactRequestLimits.maxResults}.`;
        }
    }

    return null;
}

/** Returns the validation error for caller-supplied evidence files, or null when they are acceptable. */
function requestFilesError(value: unknown): string | null {
    if (value === undefined) return null;
    if (!Array.isArray(value) || value.length > maxChangeImpactRequestFiles) {
        return `files must be an array of at most ${maxChangeImpactRequestFiles} entries.`;
    }

    const paths = new Set<string>();
    for (const entry of value) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            return "Every file must be an object with a path and string content.";
        }

        const record = entry as Record<string, unknown>;
        const path = typeof record.path === "string" ? record.path.trim() : "";
        if (path.length === 0 || typeof record.content !== "string") {
            return "Every file must include a non-empty path and string content.";
        }
        if (paths.has(path)) {
            return "Every file path must be unique.";
        }
        paths.add(path);
    }

    return null;
}

/**
 * Deterministic change-impact analysis over a caller-supplied graph. The route
 * validates the request, delegates to `ChangeImpactAnalysisService` (the single
 * source of impact semantics), re-validates the result against the graph, and
 * returns the full deterministic result unchanged. No LLM, GitHub request,
 * persistence, or graph exposure is involved.
 */
export function createImpactRouter(
    impactService: Pick<ChangeImpactAnalysisService, "analyze"> = new ChangeImpactAnalysisService()
): Router {
    const router = Router();

    router.post("/repositories/graph/impact", (req: Request, res: Response) => {
        if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
            return res.status(400).json({ error: "Malformed request body." });
        }

        const graph = req.body.graph;
        const request = req.body.request;
        const files = req.body.files;

        if (!isRepositoryGraph(graph) || !request || typeof request !== "object" || Array.isArray(request)) {
            return res.status(400).json({ error: "A valid graph and impact request are required." });
        }

        const requested = request as Record<string, unknown>;
        const target = requested.target;

        if (target && typeof target === "object" && !Array.isArray(target) &&
            (target as Record<string, unknown>).type === "commit") {
            return res.status(400).json({ error: "Commit targets are not supported for change-impact analysis." });
        }

        if (!isChangeImpactTarget(target)) {
            return res.status(400).json({ error: "A valid file or symbol target is required." });
        }

        const limitsFailure = requestedLimitsError(requested.limits);
        if (limitsFailure) {
            return res.status(400).json({ error: limitsFailure });
        }

        const filesFailure = requestFilesError(files);
        if (filesFailure) {
            return res.status(400).json({ error: filesFailure });
        }

        const result = impactService.analyze(
            graph,
            target,
            requested.limits as ChangeImpactRequestLimits | undefined,
            files as RepositoryFileInput[] | undefined
        );

        const consistency = validateRepositoryContextConsistency({ graph, impact: result });
        if (consistency.status === "invalid") {
            return res.status(400).json({
                error: "The supplied inputs do not produce graph-consistent change-impact facts.",
                missingData: consistency.missingData ?? []
            });
        }

        return res.status(200).json(result);
    });

    return router;
}

export default createImpactRouter();
