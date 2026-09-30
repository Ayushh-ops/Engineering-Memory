import type {
    CodeRelationship,
    LanguageAnalysisResult,
    LanguageAnalyzer,
    LanguageDeclaration
} from "./types";

export function analyzeCpp(source: string, _path = "input.cpp"): LanguageAnalysisResult {
    const lines = source.split(/\r?\n/);
    const imports: string[] = [];
    const relationships: CodeRelationship[] = [];

    for (const line of lines) {
        const match = line.match(/^\s*#\s*include\s+([<"][^>"]+[>"])/);
        if (match) {
            const specifier = match[1];
            imports.push(specifier);
            relationships.push({
                type: "imports",
                from: "file",
                to: specifier
            });
        }
    }

    return {
        imports,
        classes: [],
        functions: [],
        variables: [],
        relationships,
        unsupported: true,
        unsupportedReason: "C++ structural analysis is currently a stub; full AST parsing is not yet implemented."
    };
}

export function extractCppDeclarations(_source: string, _path = "input.cpp"): LanguageDeclaration[] {
    return [];
}

export const cppAnalyzer: LanguageAnalyzer = {
    id: "cpp",
    name: "C++",
    supportedExtensions: [".cpp", ".cc", ".cxx", ".h", ".hpp"],
    supportsSource(path: string): boolean {
        const lower = path.toLowerCase();
        return this.supportedExtensions.some((ext) => lower.endsWith(ext));
    },
    analyze(source: string, path: string): LanguageAnalysisResult {
        return analyzeCpp(source, path);
    },
    extractDeclarations(source: string, path: string): LanguageDeclaration[] {
        return extractCppDeclarations(source, path);
    }
};
