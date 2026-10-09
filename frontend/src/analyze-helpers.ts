export const ANALYSIS_MAX_FILES = 500;

export const SUPPORTED_CODE_EXTENSIONS = [
    '.ts', '.tsx', '.js', '.jsx', '.py'
];

export function isCodeFile(path: string): boolean {
    const lower = path.toLowerCase();
    return SUPPORTED_CODE_EXTENSIONS.some(ext => lower.endsWith(ext));
}

export function getPathsToAnalyze(treeFiles: string[], targetFile?: string): string[] {
    const maxFiles = ANALYSIS_MAX_FILES;
    const codeFiles = [...treeFiles]
        .filter(f => isCodeFile(f))
        .sort((a, b) => a.localeCompare(b));
    if (targetFile && isCodeFile(targetFile)) {
        const withoutTarget = codeFiles.filter(f => f !== targetFile);
        return [targetFile, ...withoutTarget].slice(0, maxFiles);
    }
    return codeFiles.slice(0, maxFiles);
}

export function isFileInGraph(graph: any, path: string): boolean {
    if (!graph || !graph.nodes) return false;
    return graph.nodes.some((n: any) => n.type === 'file' && n.path === path);
}
