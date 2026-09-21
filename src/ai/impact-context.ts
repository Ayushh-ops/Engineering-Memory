import type { RepositorySourceEvidence } from "../services/repository-source-evidence-service";
import type {
    ChangeImpactAnalysisResult,
    ChangeImpactCallSiteEvidence,
    ChangeImpactPath,
    ChangeImpactPathRelationship
} from "../services/change-impact-analysis-service";

export interface AiImpactCallSite {
    file: string;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    expression: string;
}

export interface AiImpactRelationship {
    id: string;
    type: "calls";
    from: string;
    to: string;
    evidence: "available" | "unavailable";
    callSites: AiImpactCallSite[];
}

export interface AiImpactConsumer {
    id: string;
    type: "class" | "function" | "method";
    path: string;
    name: string;
    depth: number;
    relationship: "direct-caller" | "transitive-consumer";
    test: boolean;
    chain?: number[];
}

export interface AiImpactDependency {
    path: string;
    relationship: "direct-import" | "reverse-import" | "related-file";
    evidence: "imports-edge" | "related-files-query";
}

export interface AiImpactTotals {
    directCallers: number;
    transitiveConsumers: number;
    testConsumers: number;
    paths: number;
    relationships: number;
    callSites: number;
    dependencies: number;
}

export interface AiImpactCompaction {
    budgetChars: number;
    consumersWithDetail: number;
    detailOmittedConsumers: number;
    omittedPaths: number;
    omittedCallSites: number;
    analysisTruncated: boolean;
    reason?: string;
}

export interface AiImpactContext {
    target: { type: "symbol" | "file"; path: string; name?: string };
    targetNodeId?: string;
    status: "ok" | "missing" | "ambiguous";
    bounds: { maxDepth: number; maxResults: number; truncated: boolean };
    totals: AiImpactTotals;
    consumers: AiImpactConsumer[];
    relationships: AiImpactRelationship[];
    dependencies: AiImpactDependency[];
    sourceEvidence: RepositorySourceEvidence[];
    limitations: string[];
    compaction: AiImpactCompaction;
}

export interface AiImpactContextOptions {
    budgetChars: number;
}

/**
 * Reserved for the JSON object wrapper, the compaction counters, and the
 * optional bounded-detail limitation sentence, so the assembled projection
 * always fits the budget it was given.
 */
const AI_IMPACT_OVERHEAD_RESERVE = 256;

const OMITTED_DETAIL_REASON = "impact_detail_omitted_for_context_budget";

interface ConsumerEntry {
    consumer: AiImpactConsumer;
    path: ChangeImpactPath | null;
}

function consumerEntries(impact: ChangeImpactAnalysisResult): ConsumerEntry[] {
    const pathsByTerminal = new Map<string, ChangeImpactPath>();
    for (const path of impact.paths) {
        const terminal = path.nodes[path.nodes.length - 1];
        if (terminal === undefined || pathsByTerminal.has(terminal)) continue;
        pathsByTerminal.set(terminal, path);
    }

    const testIds = new Set(impact.tests.map((test) => test.symbol.id));
    const callers = [...impact.directCallers, ...impact.transitiveConsumers];

    return callers.map((caller) => ({
        consumer: {
            id: caller.symbol.id,
            type: caller.symbol.type,
            path: caller.symbol.path,
            name: caller.symbol.name,
            depth: caller.depth === undefined ? 1 : caller.depth,
            relationship: caller.relationship,
            test: testIds.has(caller.symbol.id)
        },
        path: pathsByTerminal.get(caller.symbol.id) ?? null
    }));
}

function distinctRelationshipCount(impact: ChangeImpactAnalysisResult): number {
    const ids = new Set<string>();
    for (const path of impact.paths) {
        for (const relationship of path.relationships) ids.add(relationship.relationshipId);
    }
    return ids.size;
}

function toCallSites(
    relationship: ChangeImpactPathRelationship,
    evidenceById: Map<string, ChangeImpactCallSiteEvidence>,
    countMissing: () => void
): AiImpactCallSite[] {
    const callSites: AiImpactCallSite[] = [];
    for (const citedId of relationship.callSiteIds) {
        const evidence = evidenceById.get(citedId);
        if (!evidence) {
            countMissing();
            continue;
        }
        callSites.push({
            file: evidence.file,
            startLine: evidence.startLine,
            startColumn: evidence.startColumn,
            endLine: evidence.endLine,
            endColumn: evidence.endColumn,
            expression: evidence.expression
        });
    }
    return callSites;
}

function assembleProjection(
    impact: ChangeImpactAnalysisResult,
    entries: ConsumerEntry[],
    detailFlags: boolean[],
    budgetChars: number
): AiImpactContext {
    const evidenceById = new Map(impact.callSiteEvidence.map((entry) => [entry.id, entry]));
    let omittedCallSites = 0;
    const countMissing = (): void => {
        omittedCallSites += 1;
    };

    const detailed = entries.map((entry, index) => detailFlags[index] === true && entry.path !== null);
    const pooled: AiImpactRelationship[] = [];
    const poolIndex = new Map<string, number>();
    for (let index = 0; index < entries.length; index++) {
        if (!detailed[index]) continue;
        const path = entries[index].path as ChangeImpactPath;
        for (const relationship of path.relationships) {
            if (poolIndex.has(relationship.relationshipId)) continue;
            poolIndex.set(relationship.relationshipId, pooled.length);
            pooled.push({
                id: relationship.relationshipId,
                type: relationship.type,
                from: relationship.from,
                to: relationship.to,
                evidence: relationship.evidence,
                callSites: toCallSites(relationship, evidenceById, countMissing)
            });
        }
    }

    const consumers: AiImpactConsumer[] = entries.map((entry, index) => {
        if (!detailed[index]) return entry.consumer;
        const path = entry.path as ChangeImpactPath;
        const chain = path.relationships.map((relationship) => poolIndex.get(relationship.relationshipId) as number);
        return { ...entry.consumer, chain };
    });

    const consumersWithDetail = detailed.filter(Boolean).length;
    const detailOmittedConsumers = consumers.length - consumersWithDetail;
    const consumersWithPath = entries.filter((entry) => entry.path !== null).length;
    const omittedPaths = consumersWithPath - consumersWithDetail;
    const limitations = detailOmittedConsumers > 0
        ? [...impact.limitations, `Impact detail was bounded for the AI context: ${consumersWithDetail} of ${consumers.length} affected consumers include their path and call-site evidence; ${detailOmittedConsumers} are listed without detail${omittedPaths > 0 ? `, ${omittedPaths} of them because the context budget was reached` : ""}.`]
        : [...impact.limitations];

    return {
        target: impact.target.name === undefined
            ? { type: impact.target.type, path: impact.target.path }
            : { type: impact.target.type, path: impact.target.path, name: impact.target.name },
        ...(impact.targetNodeId === undefined ? {} : { targetNodeId: impact.targetNodeId }),
        status: impact.status,
        bounds: {
            maxDepth: impact.bounds.maxDepth,
            maxResults: impact.bounds.maxResults,
            truncated: impact.bounds.truncated
        },
        totals: {
            directCallers: impact.directCallers.length,
            transitiveConsumers: impact.transitiveConsumers.length,
            testConsumers: impact.tests.length,
            paths: impact.paths.length,
            relationships: distinctRelationshipCount(impact),
            callSites: impact.callSiteEvidence.length,
            dependencies: impact.relatedDependencies.length
        },
        consumers,
        relationships: pooled,
        dependencies: impact.relatedDependencies.map((dependency) => ({
            path: dependency.path,
            relationship: dependency.relationship,
            evidence: dependency.evidence
        })),
        sourceEvidence: impact.sourceEvidence,
        limitations,
        compaction: {
            budgetChars,
            consumersWithDetail,
            detailOmittedConsumers,
            omittedPaths,
            omittedCallSites,
            analysisTruncated: impact.bounds.truncated,
            ...(omittedPaths > 0 ? { reason: OMITTED_DETAIL_REASON } : {})
        }
    };
}

/**
 * Deterministic, bounded projection of a validated change-impact result for the
 * AI context. The full result remains the backend/frontend source of truth; this
 * projection joins against the identifiers it already contains and never derives
 * a relationship, call-site, or path identifier of its own. Whole consumers keep
 * or lose their detail as a unit, and every omission is reported through
 * `compaction` and `limitations`, so no fact is dropped silently.
 */
export function buildAiImpactContext(
    impact: ChangeImpactAnalysisResult,
    { budgetChars }: AiImpactContextOptions
): AiImpactContext {
    const entries = consumerEntries(impact);
    const noDetail = entries.map(() => false);

    if (impact.status !== "ok") return assembleProjection(impact, entries, noDetail, budgetChars);

    const effectiveBudget = Math.max(0, budgetChars - AI_IMPACT_OVERHEAD_RESERVE);
    let detailFlags = [...noDetail];

    for (let index = 0; index < entries.length; index++) {
        if (entries[index].path === null) continue;
        const candidate = [...detailFlags];
        candidate[index] = true;
        if (JSON.stringify(assembleProjection(impact, entries, candidate, budgetChars)).length <= effectiveBudget) {
            detailFlags = candidate;
        }
    }

    let projection = assembleProjection(impact, entries, detailFlags, budgetChars);
    const kept = detailFlags.reduce<number[]>((indexes, flag, index) => {
        if (flag) indexes.push(index);
        return indexes;
    }, []);
    let cursor = kept.length - 1;

    while (JSON.stringify(projection).length > budgetChars && cursor >= 0) {
        detailFlags = [...detailFlags];
        detailFlags[kept[cursor]] = false;
        cursor -= 1;
        projection = assembleProjection(impact, entries, detailFlags, budgetChars);
    }

    return projection;
}
