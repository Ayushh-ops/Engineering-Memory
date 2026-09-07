import type { RepositoryGraph } from "../graph/repository-graph";
import { queryRepositoryGraph } from "../graph/repository-query";
import { getRelativeImportCandidatePaths, type RepositoryFileAnalysis } from "../resolvers/relative-imports";

export class RepositoryContextExpansionService {
    public readonly maxAdditionalFiles: number;

    constructor(maxAdditionalFiles = 3) {
        this.maxAdditionalFiles = Number.isFinite(maxAdditionalFiles)
            ? Math.max(0, Math.floor(maxAdditionalFiles))
            : 3;
    }

    selectImportCandidates(files: RepositoryFileAnalysis[], existingPaths: string[]): string[] {
        const existing = new Set(existingPaths);
        const candidates = getRelativeImportCandidatePaths(
            files,
            Math.max(this.maxAdditionalFiles * 5, this.maxAdditionalFiles)
        );
        return candidates
            .filter((path) => !existing.has(path))
            .slice(0, Math.max(this.maxAdditionalFiles * 5, this.maxAdditionalFiles));
    }

    selectRelatedFiles(graph: RepositoryGraph, selectedPaths: string[]): string[] {
        const selected = new Set(selectedPaths);
        const relatedPaths: string[] = [];
        const seen = new Set<string>();

        for (const path of selectedPaths) {
            for (const file of queryRepositoryGraph(graph, { type: "related-files", path }).files) {
                if (selected.has(file.path) || seen.has(file.path)) continue;
                seen.add(file.path);
                relatedPaths.push(file.path);
                if (relatedPaths.length >= this.maxAdditionalFiles) return relatedPaths;
            }
        }

        return relatedPaths;
    }
}