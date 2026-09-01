import { analyzeTypeScript, type TypeScriptAnalysis } from "../analyzers/typescript";
import {
    analyzeHistoricalTypeScriptChange,
    isTypeScriptPath,
    type FileChangeAnalysis
} from "../analyzers/typescript-history";
import {
    buildRepositoryGraph,
    type RepositoryGraph,
    type RepositoryHistoricalChanges,
    type RepositoryHistoryCommit
} from "../graph/repository-graph";
import {
    resolveRelativeImportRelationships,
    type RepositoryFileAnalysis,
    type ResolvedImportRelationship
} from "../resolvers/relative-imports";

export interface RepositoryReference {
    owner: string;
    repository: string;
}

export interface RepositoryFileInput {
    path: string;
    content: string;
}

export interface HistoricalFileComparison {
    path: string;
    parentContent: string | null;
    currentContent: string | null;
}

export interface RepositoryFileAnalysisResult {
    repository: string;
    sha: string;
    path: string;
    analysis: TypeScriptAnalysis;
}

export interface RepositoryFilesAnalysisResult {
    repository: string;
    sha: string;
    files: RepositoryFileAnalysis[];
    resolvedRelationships: ResolvedImportRelationship[];
    graph: RepositoryGraph;
}

export interface RepositoryHistoricalAnalysisResult {
    repository: string;
    sha: string;
    parentSha: string | null;
    files: FileChangeAnalysis[];
    graph: RepositoryGraph;
}

export class RepositoryAnalysisService {
    analyzeFile(
        repository: RepositoryReference,
        sha: string,
        path: string,
        content: string
    ): RepositoryFileAnalysisResult {
        return {
            repository: `${repository.owner}/${repository.repository}`,
            sha,
            path,
            analysis: analyzeTypeScript(content)
        };
    }

    analyzeFiles(
        repository: RepositoryReference,
        sha: string,
        files: RepositoryFileInput[]
    ): RepositoryFilesAnalysisResult {
        const repositoryName = `${repository.owner}/${repository.repository}`;
        const analyzedFiles: RepositoryFileAnalysis[] = files.map((file) => ({
            path: file.path,
            analysis: analyzeTypeScript(file.content)
        }));
        const resolvedRelationships = resolveRelativeImportRelationships(analyzedFiles);

        return {
            repository: repositoryName,
            sha,
            files: analyzedFiles,
            resolvedRelationships,
            graph: buildRepositoryGraph(repositoryName, analyzedFiles, resolvedRelationships)
        };
    }

    analyzeHistoricalFiles(
        repository: RepositoryReference,
        sha: string,
        parentSha: string | null,
        comparisons: HistoricalFileComparison[],
        history: RepositoryHistoryCommit[] = [],
        historicalChanges: RepositoryHistoricalChanges | null = null
    ): RepositoryHistoricalAnalysisResult {
        const repositoryName = `${repository.owner}/${repository.repository}`;

        const files = comparisons.map((comparison) => {
            if (!isTypeScriptPath(comparison.path)) {
                return analyzeHistoricalTypeScriptChange(comparison.path, null, null);
            }

            return analyzeHistoricalTypeScriptChange(
                comparison.path,
                comparison.parentContent,
                comparison.currentContent
            );
        });

        const currentFiles: RepositoryFileAnalysis[] = comparisons.map((comparison) => ({
            path: comparison.path,
            analysis: analyzeTypeScript(comparison.currentContent ?? "")
        }));

        const resolvedRelationships = resolveRelativeImportRelationships(currentFiles);

        return {
            repository: repositoryName,
            sha,
            parentSha,
            files,
            graph: buildRepositoryGraph(
                repositoryName,
                currentFiles,
                resolvedRelationships,
                history,
                historicalChanges
            )
        };
    }
}
