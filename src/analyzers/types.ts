export type LanguageDeclarationType = "class" | "function" | "method";

export interface LanguageDeclaration {
    type: LanguageDeclarationType;
    name: string;
    startLine: number;
    endLine: number;
    source: string;
}

export interface AnalyzedMethod {
    name: string;
    parameters: string[];
}

export interface AnalyzedClass {
    name: string | null;
    methods: AnalyzedMethod[];
}

export interface AnalyzedFunction {
    name: string | null;
    parameters: string[];
}

export interface CallSite {
    file: string;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    expression: string;
}

export interface CodeRelationship {
    type: "imports" | "calls";
    from: string;
    to: string;
    callSites?: CallSite[];
}

export interface LanguageAnalysisResult {
    imports: string[];
    classes: AnalyzedClass[];
    functions: AnalyzedFunction[];
    variables: string[];
    relationships: CodeRelationship[];
    unsupported?: boolean;
    unsupportedReason?: string;
}

export interface LanguageAnalyzer {
    id: string;
    name: string;
    supportedExtensions: string[];
    supportsSource(path: string): boolean;
    analyze(source: string, path: string): LanguageAnalysisResult;
    extractDeclarations?(source: string, path: string): LanguageDeclaration[];
}

// Backward-compatible type aliases for existing TypeScript consumers
export type TypeScriptDeclarationType = LanguageDeclarationType;
export type TypeScriptDeclaration = LanguageDeclaration;
export type TypeScriptAnalysis = LanguageAnalysisResult;
