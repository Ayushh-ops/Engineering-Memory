export const SUPPORTED_CODE_EXTENSIONS = [
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
    '.py', '.pyw',
    '.java',
    '.go',
    '.cpp', '.cc', '.cxx', '.h', '.hpp'
];

export function isCodeFile(path: string): boolean {
    const lower = path.toLowerCase();
    return SUPPORTED_CODE_EXTENSIONS.some(ext => lower.endsWith(ext));
}

export function getPathsToAnalyze(treeFiles: string[], targetFile: string): string[] {
    const paths = [targetFile];

    // Find siblings (files in the same directory that are code files)
    const targetDir = targetFile.substring(0, targetFile.lastIndexOf('/'));

    for (const file of treeFiles) {
        if (file === targetFile) continue;
        if (!isCodeFile(file)) continue;

        const fileDir = file.substring(0, file.lastIndexOf('/'));
        // If it's a sibling, or if they both are at root (lastIndexOf is -1)
        if (fileDir === targetDir) {
            paths.push(file);
        }

        if (paths.length >= 20) break;
    }

    return paths;
}

export function isFileInGraph(graph: any, path: string): boolean {
    if (!graph || !graph.nodes) return false;
    return graph.nodes.some((n: any) => n.type === 'file' && n.path === path);
}
