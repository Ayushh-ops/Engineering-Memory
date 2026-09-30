import { analyzeTypeScript, extractTypeScriptDeclarations } from "./typescript";
import { pythonAnalyzer } from "./python";
import { javaAnalyzer } from "./java";
import { goAnalyzer } from "./go";
import { cppAnalyzer } from "./cpp";
import type {
    LanguageAnalyzer,
    LanguageAnalysisResult,
    LanguageDeclaration
} from "./types";

export const typescriptAnalyzer: LanguageAnalyzer = {
    id: "typescript",
    name: "TypeScript / JavaScript",
    supportedExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
    supportsSource(path: string): boolean {
        const lower = path.toLowerCase();
        return this.supportedExtensions.some((ext) => lower.endsWith(ext));
    },
    analyze(source: string, path: string): LanguageAnalysisResult {
        return analyzeTypeScript(source, path);
    },
    extractDeclarations(source: string, path: string): LanguageDeclaration[] {
        return extractTypeScriptDeclarations(source, path);
    }
};

export { pythonAnalyzer } from "./python";
export { javaAnalyzer } from "./java";
export { goAnalyzer } from "./go";
export { cppAnalyzer } from "./cpp";

export class LanguageAnalyzerRegistry {
    private analyzers: LanguageAnalyzer[] = [];

    constructor() {
        this.register(typescriptAnalyzer);
        this.register(pythonAnalyzer);
        this.register(javaAnalyzer);
        this.register(goAnalyzer);
        this.register(cppAnalyzer);
    }

    register(analyzer: LanguageAnalyzer): void {
        const existingIndex = this.analyzers.findIndex((a) => a.id === analyzer.id);
        if (existingIndex >= 0) {
            this.analyzers[existingIndex] = analyzer;
        } else {
            this.analyzers.push(analyzer);
        }
    }

    getAnalyzerForPath(path: string): LanguageAnalyzer | undefined {
        return this.analyzers.find((analyzer) => analyzer.supportsSource(path));
    }

    getAnalyzers(): readonly LanguageAnalyzer[] {
        return this.analyzers;
    }

    analyzeSource(source: string, path: string): LanguageAnalysisResult {
        const analyzer = this.getAnalyzerForPath(path);
        if (analyzer) {
            return analyzer.analyze(source, path);
        }
        return {
            imports: [],
            classes: [],
            functions: [],
            variables: [],
            relationships: []
        };
    }

    extractDeclarationsForPath(source: string, path: string): LanguageDeclaration[] {
        const analyzer = this.getAnalyzerForPath(path);
        if (analyzer && typeof analyzer.extractDeclarations === "function") {
            return analyzer.extractDeclarations(source, path);
        }
        return [];
    }

    clear(): void {
        this.analyzers = [];
    }

    reset(): void {
        this.analyzers = [typescriptAnalyzer, pythonAnalyzer, javaAnalyzer, goAnalyzer, cppAnalyzer];
    }
}

export const registry = new LanguageAnalyzerRegistry();

export function getAnalyzerForPath(path: string): LanguageAnalyzer | undefined {
    return registry.getAnalyzerForPath(path);
}

export function analyzeSource(source: string, path: string): LanguageAnalysisResult {
    return registry.analyzeSource(source, path);
}

export function extractDeclarationsForPath(source: string, path: string): LanguageDeclaration[] {
    return registry.extractDeclarationsForPath(source, path);
}

export function registerAnalyzer(analyzer: LanguageAnalyzer): void {
    registry.register(analyzer);
}
