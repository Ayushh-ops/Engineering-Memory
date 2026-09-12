import {
    extractTypeScriptDeclarations,
    type TypeScriptDeclaration,
    type TypeScriptDeclarationType
} from "../analyzers/typescript";
import type { RepositoryContextTarget } from "../graph/repository-context";
import type { GraphNode, RepositoryGraph } from "../graph/repository-graph";
import type { RepositoryFileInput } from "./repository-analysis-service";

export interface RepositorySourceEvidence {
    path: string;
    symbol: {
        type: TypeScriptDeclarationType;
        name: string;
    };
    startLine: number;
    endLine: number;
    code: string;
    truncated: boolean;
}

export interface RepositorySourceEvidenceLimits {
    maxSnippets: number;
    maxBytesPerSnippet: number;
    maxTotalBytes: number;
}

export const defaultRepositorySourceEvidenceLimits: RepositorySourceEvidenceLimits = {
    maxSnippets: 8,
    maxBytesPerSnippet: 2000,
    maxTotalBytes: 8000
};

type GraphSymbolNode = Extract<GraphNode, { type: "class" | "function" | "method" }>;

interface DeclarationMatch {
    path: string;
    declaration: TypeScriptDeclaration;
}

function evidenceKey(path: string, type: TypeScriptDeclarationType, name: string): string {
    return `${path}\u0000${type}\u0000${name}`;
}

function byteLength(value: string): number {
    return Buffer.byteLength(value, "utf8");
}

function truncateUtf8(value: string, maxBytes: number): { value: string; truncated: boolean } {
    if (byteLength(value) <= maxBytes) return { value, truncated: false };

    let end = value.length;
    while (end > 0 && byteLength(value.slice(0, end)) > maxBytes) {
        end--;
    }
    return { value: value.slice(0, end), truncated: true };
}

function graphSymbols(graph: RepositoryGraph): GraphSymbolNode[] {
    return graph.nodes.filter((node): node is GraphSymbolNode =>
        node.type === "class" || node.type === "function" || node.type === "method"
    );
}

/**
 * Selects source snippets from already fetched files only. Graph edges provide
 * all caller/callee eligibility; source text never causes repository discovery.
 */
export class RepositorySourceEvidenceService {
    constructor(private readonly limits: RepositorySourceEvidenceLimits = defaultRepositorySourceEvidenceLimits) {}

    select(
        target: RepositoryContextTarget,
        graph: RepositoryGraph,
        files: RepositoryFileInput[],
        additionalSymbols: GraphSymbolNode[] = []
    ): RepositorySourceEvidence[] {
        const declarations = new Map<string, DeclarationMatch[]>();

        for (const file of files) {
            for (const declaration of extractTypeScriptDeclarations(file.content, file.path)) {
                const match = { path: file.path, declaration };
                const key = evidenceKey(file.path, declaration.type, declaration.name);
                const matches = declarations.get(key) ?? [];
                matches.push(match);
                declarations.set(key, matches);
            }
        }

        const resolve = (node: GraphSymbolNode | null | undefined): DeclarationMatch | null => {
            if (!node) return null;
            const matches = declarations.get(evidenceKey(node.path, node.type, node.name)) ?? [];
            return matches.length === 1 ? matches[0] : null;
        };
        const symbols = graphSymbols(graph);
        const symbolById = new Map(symbols.map((symbol) => [symbol.id, symbol]));
        const selected: DeclarationMatch[] = [];
        const selectedKeys = new Set<string>();
        const add = (match: DeclarationMatch | null): void => {
            if (!match) return;
            const key = evidenceKey(match.path, match.declaration.type, match.declaration.name);
            if (selectedKeys.has(key)) return;
            selectedKeys.add(key);
            selected.push(match);
        };

        let targetSymbol: GraphSymbolNode | null = null;
        const targetPath = target.type === "symbol"
            ? target.symbol.path
            : target.type === "file"
                ? target.path
                : null;

        if (target.type === "symbol") {
            const matches = symbols.filter((symbol) =>
                symbol.type === target.symbol.type &&
                symbol.path === target.symbol.path &&
                symbol.name === target.symbol.name
            );
            targetSymbol = matches.length === 1 ? matches[0] : null;
            add(targetSymbol ? resolve(targetSymbol) : null);
            if (!targetSymbol || selected.length === 0) return [];
        }

        if (targetSymbol) {
            for (const edge of graph.edges) {
                if (edge.type === "calls" && edge.from === targetSymbol.id) {
                    add(resolve(symbolById.get(edge.to)));
                }
            }
            for (const edge of graph.edges) {
                if (edge.type === "calls" && edge.to === targetSymbol.id) {
                    add(resolve(symbolById.get(edge.from)));
                }
            }
        }

        for (const symbol of additionalSymbols) add(resolve(symbol));

        const relatedPaths = new Set<string>();
        if (targetPath) {
            const targetFileIds = new Set(graph.nodes.filter(
                (node) => node.type === "file" && node.path === targetPath
            ).map((node) => node.id));
            for (const edge of graph.edges) {
                if (edge.type !== "imports") continue;
                if (targetFileIds.has(edge.from) || targetFileIds.has(edge.to)) {
                    const otherId = targetFileIds.has(edge.from) ? edge.to : edge.from;
                    const other = graph.nodes.find((node) => node.id === otherId);
                    if (other?.type === "file") relatedPaths.add(other.path);
                }
            }
        }

        for (const symbol of symbols) {
            // A class declaration already contains its methods. Individual
            // methods remain eligible as exact targets or call-edge evidence.
            if (symbol.type === "method") continue;
            if ((target.type === "file" && symbol.path === target.path) || relatedPaths.has(symbol.path)) {
                add(resolve(symbol));
            }
        }

        const evidence: RepositorySourceEvidence[] = [];
        let totalBytes = 0;
        for (const match of selected) {
            if (evidence.length >= this.limits.maxSnippets || totalBytes >= this.limits.maxTotalBytes) break;
            const remainingBytes = this.limits.maxTotalBytes - totalBytes;
            const maximum = Math.min(this.limits.maxBytesPerSnippet, remainingBytes);
            if (maximum < 1) break;
            const clipped = truncateUtf8(match.declaration.source, maximum);
            if (!clipped.value) continue;
            totalBytes += byteLength(clipped.value);
            evidence.push({
                path: match.path,
                symbol: { type: match.declaration.type, name: match.declaration.name },
                startLine: match.declaration.startLine,
                endLine: match.declaration.endLine,
                code: clipped.value,
                truncated: clipped.truncated
            });
        }

        return evidence;
    }
}
