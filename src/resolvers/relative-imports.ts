import type { TypeScriptAnalysis } from "../analyzers/typescript";

export interface RepositoryFileAnalysis {
    path: string;
    analysis: TypeScriptAnalysis;
}

export interface ResolvedImportRelationship {
    type: "imports";
    from: string;
    to: string;
}

const supportedExtensions = [".ts", ".tsx", ".js", ".jsx"];

function normalizeRepositoryPath(path: string): string {
    const segments: string[] = [];

    for (const segment of path.replace(/\\/g, "/").split("/")) {
        if (!segment || segment === ".") {
            continue;
        }

        if (segment === "..") {
            if (segments.length > 0 && segments[segments.length - 1] !== "..") {
                segments.pop();
            } else {
                segments.push(segment);
            }
            continue;
        }

        segments.push(segment);
    }

    return segments.join("/");
}

function resolveRelativePath(importingPath: string, moduleSpecifier: string): string {
    const pathSegments = normalizeRepositoryPath(importingPath).split("/");
    pathSegments.pop();
    return normalizeRepositoryPath(
        [...pathSegments, ...moduleSpecifier.replace(/\\/g, "/").split("/")].join("/")
    );
}

function getCandidatePaths(importingPath: string, moduleSpecifier: string): string[] {
    const basePath = resolveRelativePath(importingPath, moduleSpecifier);
    const candidates = [basePath, ...supportedExtensions.map((extension) => `${basePath}${extension}`)];

    return [
        ...candidates,
        ...supportedExtensions.map((extension) => `${basePath}/index${extension}`)
    ];
}

/**
 * Resolves only relative import declarations against the explicitly supplied
 * repository paths. This intentionally does not perform TypeScript module resolution.
 */
export function resolveRelativeImportRelationships(
    files: RepositoryFileAnalysis[]
): ResolvedImportRelationship[] {
    const suppliedPaths = new Map<string, string[]>();

    for (const file of files) {
        const normalizedPath = normalizeRepositoryPath(file.path);
        const paths = suppliedPaths.get(normalizedPath) ?? [];
        paths.push(file.path);
        suppliedPaths.set(normalizedPath, paths);
    }

    const relationships: ResolvedImportRelationship[] = [];
    const seen = new Set<string>();

    for (const file of files) {
        for (const relationship of file.analysis.relationships) {
            if (
                relationship.type !== "imports" ||
                (!relationship.to.startsWith("./") && !relationship.to.startsWith("../"))
            ) {
                continue;
            }

            const matches = new Set<string>();
            for (const candidate of getCandidatePaths(file.path, relationship.to)) {
                for (const suppliedPath of suppliedPaths.get(candidate) ?? []) {
                    matches.add(suppliedPath);
                }
            }

            if (matches.size !== 1) {
                continue;
            }

            const resolvedRelationship: ResolvedImportRelationship = {
                type: "imports",
                from: file.path,
                to: [...matches][0]
            };
            const relationshipKey = `${resolvedRelationship.type}\u0000${resolvedRelationship.from}\u0000${resolvedRelationship.to}`;

            if (!seen.has(relationshipKey)) {
                seen.add(relationshipKey);
                relationships.push(resolvedRelationship);
            }
        }
    }

    return relationships;
}
