import type { RepositoryContextTarget } from "../graph/repository-context";
import type { RepositoryGraph } from "../graph/repository-graph";
import type { GraphSymbolNode } from "../graph/repository-query";
import { queryRepositoryGraph } from "../graph/repository-query";
import {
    RepositorySourceEvidenceService,
    type RepositorySourceEvidence
} from "./repository-source-evidence-service";
import type { RepositoryFileInput } from "./repository-analysis-service";
import type { CallSite } from "../analyzers/typescript";

export interface ChangeImpactPathRelationship {
    relationshipId: string;
    from: string;
    to: string;
    callSiteIds: string[];
}

export interface ChangeImpactCallSiteEvidence {
    id: string;
    file: string;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    expression: string;
}

export interface ChangeImpactPath {
    id: string;
    target: string;
    nodes: string[];
    relationships: ChangeImpactPathRelationship[];
    depth: number;
    classification: "direct-caller" | "transitive-consumer";
}

export interface ChangeImpactAnalysisLimits {
    maxDepth: number;
    maxResults: number;
}

export const defaultChangeImpactAnalysisLimits: ChangeImpactAnalysisLimits = {
    maxDepth: 3,
    maxResults: 50
};

export interface ChangeImpactSymbolResult {
    symbol: GraphSymbolNode;
    depth?: number;
    relationship: "direct-caller" | "transitive-consumer";
    evidence: "calls-edge";
}

export interface ChangeImpactTestResult {
    symbol: GraphSymbolNode;
    depth?: number;
    relationship: "test-consumer";
    classification: "path-convention";
}

export interface ChangeImpactDependencyResult {
    path: string;
    relationship: "direct-import" | "reverse-import" | "related-file";
    evidence: "imports-edge" | "related-files-query";
}

export interface ChangeImpactReviewCandidate {
    path: string;
    symbol?: GraphSymbolNode;
    depth?: number;
    relationship: "direct-caller" | "transitive-consumer" | "test-consumer" | "direct-import" | "reverse-import" | "related-file";
    reason: "should-be-reviewed" | "validation-candidate" | "dependency-candidate" | "contextual-review";
    evidence: "calls-edge" | "path-convention" | "imports-edge" | "related-files-query";
}

export interface ChangeImpactAnalysisResult {
    target: {
        type: "symbol" | "file";
        path: string;
        name?: string;
    };
    status: "ok" | "missing" | "ambiguous";
    bounds: ChangeImpactAnalysisLimits & { truncated: boolean };
    directCallers: ChangeImpactSymbolResult[];
    transitiveConsumers: ChangeImpactSymbolResult[];
    tests: ChangeImpactTestResult[];
    relatedDependencies: ChangeImpactDependencyResult[];
    reviewCandidates: ChangeImpactReviewCandidate[];
    sourceEvidence: RepositorySourceEvidence[];
    paths: ChangeImpactPath[];
    callSiteEvidence: ChangeImpactCallSiteEvidence[];
    limitations: string[];
}

export type ChangeImpactTarget =
    | Extract<RepositoryContextTarget, { type: "symbol" }>
    | Extract<RepositoryContextTarget, { type: "file" }>;

function matchingTargetNodes(
    graph: RepositoryGraph,
    target: Extract<RepositoryContextTarget, { type: "symbol" }>
): GraphSymbolNode[] {
    return graph.nodes.filter((node): node is GraphSymbolNode =>
        (node.type === "class" || node.type === "function" || node.type === "method") &&
        node.type === target.symbol.type &&
        node.path === target.symbol.path &&
        node.name === target.symbol.name
    );
}

function normalizeLimits(limits: Partial<ChangeImpactAnalysisLimits> | undefined): ChangeImpactAnalysisLimits {
    const result = { ...defaultChangeImpactAnalysisLimits, ...limits };
    if (!Number.isInteger(result.maxDepth) || result.maxDepth < 1) {
        throw new Error("maxDepth must be a positive integer.");
    }
    if (!Number.isInteger(result.maxResults) || result.maxResults < 0) {
        throw new Error("maxResults must be a non-negative integer.");
    }
    return result;
}

function isTestPath(path: string): boolean {
    const normalized = path.toLowerCase().replace(/\\/g, "/");
    return normalized.includes("test") || normalized.includes("__tests__") ||
        /\.(test|spec)\.tsx?$/.test(normalized);
}

function emptyResults(): Pick<ChangeImpactAnalysisResult, "directCallers" | "transitiveConsumers"> {
    return { directCallers: [], transitiveConsumers: [] };
}

function relationshipId(edge: { id?: string; type: string; from: string; to: string }): string {
    return edge.id ?? `edge:${encodeURIComponent(edge.type)}:${encodeURIComponent(edge.from)}:${encodeURIComponent(edge.to)}`;
}

function callSiteId(
    relationship: string,
    callSite: CallSite
): string {
    return [
        relationship,
        callSite.file,
        callSite.startLine,
        callSite.startColumn,
        callSite.endLine,
        callSite.endColumn,
        callSite.expression
    ].map((value) => encodeURIComponent(String(value))).join(":");
}

function pathId(target: string, terminal: string): string {
    return `impact-path:${encodeURIComponent(target)}:${encodeURIComponent(terminal)}`;
}

function toCallSiteEvidence(id: string, callSite: CallSite): ChangeImpactCallSiteEvidence {
    return { id, ...callSite };
}

/** Performs bounded, deterministic traversal of incoming symbol call edges. */
export class ChangeImpactAnalysisService {
    constructor(private readonly sourceEvidenceService = new RepositorySourceEvidenceService()) {}

    analyze(
        graph: RepositoryGraph,
        target: ChangeImpactTarget,
        requestedLimits?: Partial<ChangeImpactAnalysisLimits>,
        files: RepositoryFileInput[] = []
    ): ChangeImpactAnalysisResult {
        const limits = normalizeLimits(requestedLimits);
        const targetResult = target.type === "symbol"
            ? { type: "symbol" as const, path: target.symbol.path, name: target.symbol.name }
            : { type: "file" as const, path: target.path };
        const base = {
            target: targetResult,
            bounds: { ...limits, truncated: false },
            ...emptyResults(),
            tests: [] as ChangeImpactTestResult[],
            relatedDependencies: [] as ChangeImpactDependencyResult[],
            reviewCandidates: [] as ChangeImpactReviewCandidate[],
            sourceEvidence: [] as RepositorySourceEvidence[],
            paths: [] as ChangeImpactPath[],
            callSiteEvidence: [] as ChangeImpactCallSiteEvidence[],
            limitations: [
                "Results describe statically observed calls in the supplied graph.",
                "A result is a potential impact or review candidate, not a claim that a change will break it.",
                "Cross-file semantic call resolution is unavailable.",
                "The graph contains only supplied files; runtime behavior is not analyzed."
            ]
        };
        const targets = target.type === "symbol"
            ? matchingTargetNodes(graph, target)
            : graph.nodes.filter((node) => node.type === "file" && node.path === target.path);

        if (targets.length === 0) return { ...base, status: "missing" };
        if (targets.length > 1) return { ...base, status: "ambiguous" };

        if (target.type === "file") {
            const directImports = queryRepositoryGraph(graph, { type: "file-imports", path: target.path }).files;
            const reverseImports = queryRepositoryGraph(graph, { type: "file-dependents", path: target.path }).files;
            const relatedFiles = queryRepositoryGraph(graph, { type: "related-files", path: target.path }).files;
            const directIds = new Set(directImports.map((file) => file.id));
            const reverseIds = new Set(reverseImports.map((file) => file.id));
            const dependencies: ChangeImpactDependencyResult[] = [
                ...directImports.map((file) => ({
                    path: file.path,
                    relationship: "direct-import" as const,
                    evidence: "imports-edge" as const
                })),
                ...reverseImports.map((file) => ({
                    path: file.path,
                    relationship: "reverse-import" as const,
                    evidence: "imports-edge" as const
                })),
                ...relatedFiles
                    .filter((file) => !directIds.has(file.id) && !reverseIds.has(file.id))
                    .map((file) => ({
                        path: file.path,
                        relationship: "related-file" as const,
                        evidence: "related-files-query" as const
                    }))
            ];
            if (dependencies.length > limits.maxResults) base.bounds.truncated = true;
            base.relatedDependencies.push(...dependencies.slice(0, limits.maxResults));
            base.reviewCandidates.push(...base.relatedDependencies.map((dependency) => ({
                path: dependency.path,
                relationship: dependency.relationship,
                reason: dependency.relationship === "related-file" ? "contextual-review" as const : "dependency-candidate" as const,
                evidence: dependency.evidence
            })));
            base.sourceEvidence = files.length > 0
                ? this.sourceEvidenceService.select(target, graph, files)
                : [];
            if (files.length === 0) base.limitations.push("Source evidence was not requested because no fetched files were supplied.");
            return { ...base, status: "ok" };
        }

        const targetNode = targets[0];
        const directCallers = queryRepositoryGraph(graph, {
            type: "symbol-callers",
            symbol: target.symbol
        }).symbols;
        const symbolsById = new Map(
            graph.nodes
                .filter((node): node is GraphSymbolNode =>
                    node.type === "class" || node.type === "function" || node.type === "method"
                )
                .map((node) => [node.id, node])
        );
        const directCallerIds = new Set(directCallers.map((caller) => caller.id));
        const visited = new Set<string>([targetNode.id]);
        const queue: Array<{ id: string; depth: number }> = [{ id: targetNode.id, depth: 0 }];
        const predecessors = new Map<string, { nodeId: string; edge: typeof graph.edges[number] }>();
        const result = { ...base, status: "ok" as const };
        let truncated = false;
        let missingRelationshipEvidence = false;
        const callSiteEvidence = new Map<string, ChangeImpactCallSiteEvidence>();

        const incomingEdges = (nodeId: string): typeof graph.edges => graph.edges
            .filter((edge) => edge.type === "calls" && edge.to === nodeId)
            .sort((left, right) => {
                const leftKey = `${relationshipId(left)}\u0000${left.from}\u0000${left.to}`;
                const rightKey = `${relationshipId(right)}\u0000${right.from}\u0000${right.to}`;
                return leftKey.localeCompare(rightKey);
            });

        const reconstructPath = (terminalId: string, depth: number): ChangeImpactPath => {
            const nodes = [terminalId];
            const edges: Array<typeof graph.edges[number]> = [];
            let currentId = terminalId;
            while (currentId !== targetNode.id) {
                const predecessor = predecessors.get(currentId);
                if (!predecessor) break;
                nodes.push(predecessor.nodeId);
                edges.push(predecessor.edge);
                currentId = predecessor.nodeId;
            }
            nodes.reverse();
            edges.reverse();
            return {
                id: pathId(targetNode.id, terminalId),
                target: targetNode.id,
                nodes,
                relationships: edges.map((edge) => {
                    const id = relationshipId(edge);
                    return {
                        relationshipId: id,
                        from: edge.from,
                        to: edge.to,
                        callSiteIds: edge.type === "calls"
                            ? (edge.callSites ?? []).map((site) => {
                                const evidenceId = callSiteId(id, site);
                                callSiteEvidence.set(evidenceId, toCallSiteEvidence(evidenceId, site));
                                return evidenceId;
                            })
                            : []
                    };
                }),
                depth,
                classification: depth === 1 ? "direct-caller" : "transitive-consumer"
            };
        };

        while (queue.length > 0) {
            const current = queue.shift();
            if (!current) break;

            for (const edge of incomingEdges(current.id)) {
                const caller = symbolsById.get(edge.from);
                if (!caller || visited.has(caller.id)) continue;
                if (current.depth + 1 > limits.maxDepth || result.directCallers.length + result.transitiveConsumers.length >= limits.maxResults) {
                    truncated = true;
                    continue;
                }

                visited.add(caller.id);
                const depth = current.depth + 1;
                predecessors.set(caller.id, { nodeId: current.id, edge });
                if (!edge.callSites || edge.callSites.length === 0) missingRelationshipEvidence = true;
                const relationship: ChangeImpactSymbolResult = directCallerIds.has(caller.id)
                    ? { symbol: caller, relationship: "direct-caller", evidence: "calls-edge" }
                    : { symbol: caller, depth, relationship: "transitive-consumer", evidence: "calls-edge" };
                if (depth === 1) {
                    result.directCallers.push(relationship);
                } else {
                    result.transitiveConsumers.push(relationship);
                }
                result.paths.push(reconstructPath(caller.id, depth));
                queue.push({ id: caller.id, depth });
            }
        }

        result.bounds.truncated = truncated;
        result.paths.sort((left, right) =>
            left.depth - right.depth ||
            left.nodes[left.nodes.length - 1].localeCompare(right.nodes[right.nodes.length - 1]) ||
            left.relationships.map((relationship) => relationship.relationshipId).join("\u0000")
                .localeCompare(right.relationships.map((relationship) => relationship.relationshipId).join("\u0000"))
        );
            result.callSiteEvidence = [...callSiteEvidence.values()].sort((left, right) => left.id.localeCompare(right.id));
        if (missingRelationshipEvidence) {
            result.limitations.push("Some impact relationships do not include call-site evidence.");
        }
        const allCallers = [...result.directCallers, ...result.transitiveConsumers];
        result.tests = allCallers
            .filter((caller) => isTestPath(caller.symbol.path))
            .map((caller) => ({
                symbol: caller.symbol,
                ...(caller.depth === undefined ? {} : { depth: caller.depth }),
                relationship: "test-consumer" as const,
                classification: "path-convention" as const
            }));
        result.reviewCandidates = allCallers.map((caller) => ({
            path: caller.symbol.path,
            symbol: caller.symbol,
            ...(caller.depth === undefined ? {} : { depth: caller.depth }),
            relationship: caller.relationship,
            reason: isTestPath(caller.symbol.path) ? "validation-candidate" as const : "should-be-reviewed" as const,
            evidence: isTestPath(caller.symbol.path) ? "path-convention" as const : "calls-edge" as const
        }));
        if (result.tests.length > 0) {
            result.limitations.push("Test consumers are classified heuristically from their paths and may not exercise the target.");
        }
        result.sourceEvidence = files.length > 0
            ? this.sourceEvidenceService.select(
                target,
                graph,
                files,
                result.transitiveConsumers.map((consumer) => consumer.symbol)
            )
            : [];
        if (files.length === 0) {
            result.limitations.push("Source evidence was not requested because no fetched files were supplied.");
        }
        return result;
    }
}
