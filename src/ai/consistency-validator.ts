import type { CallSite } from "../analyzers/typescript";
import type { FileGraphNode, GraphEdge, GraphNode, RepositoryGraph } from "../graph/repository-graph";
import type { RepositorySourceEvidence } from "../services/repository-source-evidence-service";
import type {
    ChangeImpactAnalysisResult,
    ChangeImpactCallSiteEvidence,
    ChangeImpactPath,
    ChangeImpactPathRelationship
} from "../services/change-impact-analysis-service";

type GraphSymbolNode = Extract<GraphNode, { type: "class" | "function" | "method" }>;
type PathReferences = {
    citedCallSites: Map<string, CallSite>;
    referencedEdges: GraphEdge[];
};

export interface RepositoryContextConsistencyResult {
    status: "ok" | "invalid";
    missingData?: string[];
}

function relationshipId(edge: { id?: string; type: string; from: string; to: string }): string {
    return edge.id ?? `edge:${encodeURIComponent(edge.type)}:${encodeURIComponent(edge.from)}:${encodeURIComponent(edge.to)}`;
}

function callSiteId(relationship: string, callSite: CallSite): string {
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

function isSymbolNode(node: GraphNode): node is GraphSymbolNode {
    return node.type === "class" || node.type === "function" || node.type === "method";
}

function sameCallSite(site: CallSite, evidence: ChangeImpactCallSiteEvidence): boolean {
    return site.file === evidence.file &&
        site.startLine === evidence.startLine &&
        site.startColumn === evidence.startColumn &&
        site.endLine === evidence.endLine &&
        site.endColumn === evidence.endColumn &&
        site.expression === evidence.expression;
}

/** Call-site evidence IDs derived from the call sites of one referenced graph edge. */
function callSitesOfEdge(edge: GraphEdge): Map<string, CallSite> {
    const callSites = new Map<string, CallSite>();
    for (const site of edge.callSites ?? []) {
        const id = callSiteId(relationshipId(edge), site);
        if (!callSites.has(id)) callSites.set(id, site);
    }
    return callSites;
}

function matchesCallSiteOfAny(edges: GraphEdge[], evidence: ChangeImpactCallSiteEvidence): boolean {
    return edges.some((edge) => (edge.callSites ?? []).some((site) => sameCallSite(site, evidence)));
}

/**
 * Resolves the impact-path chain `relationshipId -> graph edge -> edge.callSites ->
 * derived callSiteId`. Only call sites reached through this chain may support
 * `impact.callSiteEvidence`; a real call site elsewhere in the graph stays
 * unrelated because no impact path relationship references it.
 */
function resolvePathReferences(
    paths: ChangeImpactPath[],
    edgesByRelationshipId: Map<string, GraphEdge>,
    fail: (code: string) => void
): PathReferences {
    const citedCallSites = new Map<string, CallSite>();
    const referencedEdges = new Map<string, GraphEdge>();

    for (const path of paths) {
        for (const relationship of path.relationships) {
            const edge = edgesByRelationshipId.get(relationship.relationshipId);
            if (!edge) {
                fail("path_relationship_missing");
                continue;
            }
            if (edge.type !== relationship.type || edge.from !== relationship.from || edge.to !== relationship.to) {
                fail("relationship_metadata_mismatch");
            }
            const edgeRelationshipId = relationshipId(edge);
            if (!referencedEdges.has(edgeRelationshipId)) referencedEdges.set(edgeRelationshipId, edge);

            const edgeCallSites = callSitesOfEdge(edge);
            for (const citedCallSiteId of relationship.callSiteIds) {
                const site = edgeCallSites.get(citedCallSiteId);
                if (!site) {
                    fail("path_call_site_missing");
                    continue;
                }
                if (!citedCallSites.has(citedCallSiteId)) citedCallSites.set(citedCallSiteId, site);
            }
        }
    }

    return { citedCallSites, referencedEdges: [...referencedEdges.values()] };
}

/**
 * Pure, deterministic consistency check for the facts assembled for an AI request.
 * `RepositoryGraph` stays the source of truth: every impact path, relationship,
 * call-site citation, and source evidence entry must resolve to data that already
 * exists in the supplied graph. Call-site evidence must additionally be reachable
 * through an impact path relationship, so a call site that exists elsewhere in the
 * graph cannot justify an impact citation. Missing and ambiguous impact targets
 * remain existing domain outcomes and are never treated as contradictions. The
 * validator performs no I/O, no mutation, no caching, and no graph indexing.
 */
export function validateRepositoryContextConsistency({
    graph,
    evidence = [],
    impact
}: {
    graph: RepositoryGraph;
    evidence?: RepositorySourceEvidence[];
    impact?: ChangeImpactAnalysisResult;
}): RepositoryContextConsistencyResult {
    const failures = new Set<string>();
    const fail = (code: string): void => {
        failures.add(code);
    };

    const filePaths = new Set(graph.nodes
        .filter((node): node is FileGraphNode => node.type === "file")
        .map((node) => node.path));
    const symbols = graph.nodes.filter(isSymbolNode);
    const sourceEvidence = impact ? [...evidence, ...impact.sourceEvidence] : evidence;
    for (const entry of sourceEvidence) {
        if (!filePaths.has(entry.path)) fail("source_evidence_path_mismatch");
        const symbol = symbols.find((node) =>
            node.path === entry.path && node.type === entry.symbol.type && node.name === entry.symbol.name
        );
        if (!symbol) fail("source_evidence_symbol_mismatch");
    }

    if (impact && impact.status !== "missing" && impact.status !== "ambiguous") {
        const nodeIds = new Set(graph.nodes.map((node) => node.id));
        if (impact.targetNodeId !== undefined && !nodeIds.has(impact.targetNodeId)) {
            fail("impact_target_node_missing");
        }

        const edgesByRelationshipId = new Map<string, GraphEdge>();
        for (const edge of graph.edges) {
            const id = relationshipId(edge);
            if (!edgesByRelationshipId.has(id)) edgesByRelationshipId.set(id, edge);
        }

        for (const path of impact.paths) {
            for (const nodeId of path.nodes) {
                if (!nodeIds.has(nodeId)) fail("path_node_missing");
            }
        }

        const { citedCallSites, referencedEdges } = resolvePathReferences(impact.paths, edgesByRelationshipId, fail);
        for (const entry of impact.callSiteEvidence) {
            const cited = citedCallSites.get(entry.id);
            if (cited && sameCallSite(cited, entry)) continue;
            if (cited || matchesCallSiteOfAny(referencedEdges, entry)) {
                fail("call_site_location_mismatch");
            } else {
                fail("fabricated_call_site_evidence");
            }
        }
    }

    if (failures.size === 0) return { status: "ok" };
    return { status: "invalid", missingData: [...failures] };
}
