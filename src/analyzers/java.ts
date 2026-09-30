import type {
    AnalyzedClass,
    AnalyzedFunction,
    AnalyzedMethod,
    CallSite,
    CodeRelationship,
    LanguageAnalysisResult,
    LanguageAnalyzer,
    LanguageDeclaration
} from "./types";

const JAVA_CONTROL_KEYWORDS = new Set([
    "if", "for", "while", "switch", "catch", "synchronized", "super",
    "this", "return", "throw", "assert", "new"
]);

function computeLineOffsets(source: string): number[] {
    const offsets: number[] = [0];
    for (let i = 0; i < source.length; i++) {
        if (source[i] === "\n") {
            offsets.push(i + 1);
        }
    }
    return offsets;
}

function getLineAndColumn(lineOffsets: number[], index: number): { line: number; column: number } {
    let low = 0;
    let high = lineOffsets.length - 1;
    let line = 0;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if (lineOffsets[mid] <= index) {
            line = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    const column = index - lineOffsets[line] + 1;
    return { line: line + 1, column };
}

function getJavaCommentAndStringRanges(source: string): [number, number][] {
    const ranges: [number, number][] = [];
    let i = 0;

    while (i < source.length) {
        const ch = source[i];

        if (ch === "/" && source[i + 1] === "/") {
            const start = i;
            i += 2;
            while (i < source.length && source[i] !== "\n") {
                i++;
            }
            ranges.push([start, i]);
            continue;
        }

        if (ch === "/" && source[i + 1] === "*") {
            const start = i;
            i += 2;
            while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
                i++;
            }
            if (i < source.length) i += 2;
            ranges.push([start, i]);
            continue;
        }

        if (source.slice(i, i + 3) === '"""') {
            const start = i;
            i += 3;
            while (i < source.length && source.slice(i, i + 3) !== '"""') {
                if (source[i] === "\\" && i + 1 < source.length) {
                    i += 2;
                } else {
                    i++;
                }
            }
            if (i < source.length) i += 3;
            ranges.push([start, i]);
            continue;
        }

        if (ch === '"') {
            const start = i;
            i++;
            while (i < source.length && source[i] !== '"' && source[i] !== "\n") {
                if (source[i] === "\\" && i + 1 < source.length) {
                    i += 2;
                } else {
                    i++;
                }
            }
            if (i < source.length && source[i] === '"') i++;
            ranges.push([start, i]);
            continue;
        }

        if (ch === "'") {
            const start = i;
            i++;
            while (i < source.length && source[i] !== "'" && source[i] !== "\n") {
                if (source[i] === "\\" && i + 1 < source.length) {
                    i += 2;
                } else {
                    i++;
                }
            }
            if (i < source.length && source[i] === "'") i++;
            ranges.push([start, i]);
            continue;
        }

        i++;
    }

    return ranges;
}

function isInsideRanges(ranges: [number, number][], offset: number): boolean {
    for (const [start, end] of ranges) {
        if (offset >= start && offset < end) {
            return true;
        }
    }
    return false;
}

function findMatchingParen(source: string, ranges: [number, number][], openParenIndex: number): number {
    let depth = 0;
    for (let i = openParenIndex; i < source.length; i++) {
        if (isInsideRanges(ranges, i)) {
            continue;
        }
        const ch = source[i];
        if (ch === "(") {
            depth++;
        } else if (ch === ")") {
            depth--;
            if (depth === 0) {
                return i;
            }
        }
    }
    return -1;
}

function parseJavaParameters(paramStr: string): string[] {
    const trimmed = paramStr.trim();
    if (!trimmed) return [];

    const params: string[] = [];
    let depth = 0;
    let inQuote: string | null = null;
    let current = "";

    for (let i = 0; i < trimmed.length; i++) {
        const ch = trimmed[i];
        if (inQuote) {
            if (ch === inQuote) {
                inQuote = null;
            }
            current += ch;
        } else if (ch === '"' || ch === "'") {
            inQuote = ch;
            current += ch;
        } else if (ch === "(" || ch === "[" || ch === "{" || ch === "<") {
            depth++;
            current += ch;
        } else if (ch === ")" || ch === "]" || ch === "}" || ch === ">") {
            depth--;
            current += ch;
        } else if (ch === "," && depth === 0) {
            params.push(current.trim());
            current = "";
        } else {
            current += ch;
        }
    }
    if (current.trim()) {
        params.push(current.trim());
    }

    const result: string[] = [];
    for (const p of params) {
        const clean = p.replace(/\[\s*\]/g, "").trim();
        const parts = clean.split(/\s+/).filter(Boolean);
        if (parts.length > 0) {
            const lastPart = parts[parts.length - 1];
            const match = lastPart.match(/([a-zA-Z_]\w*)/);
            if (match) {
                result.push(match[1]);
            }
        }
    }

    return result;
}

function parseJavaImports(source: string, ranges: [number, number][]): {
    imports: string[];
    relationships: CodeRelationship[];
} {
    const imports: string[] = [];
    const relationships: CodeRelationship[] = [];
    const importRegex = /\bimport\s+(?:static\s+)?([a-zA-Z_0-9.*]+)\s*;/g;
    let match: RegExpExecArray | null;

    while ((match = importRegex.exec(source)) !== null) {
        if (isInsideRanges(ranges, match.index)) {
            continue;
        }
        const importPath = match[1].trim();
        imports.push(importPath);
        relationships.push({
            type: "imports",
            from: "file",
            to: importPath
        });
    }

    return { imports, relationships };
}

interface JavaMethodInfo {
    name: string;
    className: string;
    parameters: string[];
    startOffset: number;
    endOffset: number;
    bodyStartOffset: number;
    bodyEndOffset: number;
    startLine: number;
    endLine: number;
}

interface JavaClassInfo {
    name: string;
    startOffset: number;
    endOffset: number;
    startLine: number;
    endLine: number;
    methods: JavaMethodInfo[];
}

function parseJavaClassesAndMethods(
    source: string,
    ranges: [number, number][],
    lineOffsets: number[]
): JavaClassInfo[] {
    const classes: JavaClassInfo[] = [];

    let i = 0;
    let braceDepth = 0;
    let currentClass: JavaClassInfo | null = null;
    let tokenBufferStart = 0;

    while (i < source.length) {
        if (isInsideRanges(ranges, i)) {
            i++;
            continue;
        }

        const ch = source[i];

        if (ch === "{") {
            const buffer = source.slice(tokenBufferStart, i).trim();

            if (braceDepth === 0) {
                // Potential class, interface, enum, record declaration
                const classMatch = buffer.match(/\b(class|interface|enum|record)\s+([a-zA-Z_]\w*)/);
                if (classMatch) {
                    const className = classMatch[2];
                    const startLine = getLineAndColumn(lineOffsets, tokenBufferStart).line;
                    currentClass = {
                        name: className,
                        startOffset: tokenBufferStart,
                        endOffset: 0,
                        startLine,
                        endLine: 0,
                        methods: []
                    };
                    classes.push(currentClass);
                }
            } else if (braceDepth === 1 && currentClass) {
                // Potential method or constructor inside class
                const methodMatch = buffer.match(/\b([a-zA-Z_]\w*)\s*\(([\s\S]*?)\)(?:\s*throws\s+[^{]+)?$/);
                if (methodMatch) {
                    const methodName = methodMatch[1];
                    const rawParams = methodMatch[2];

                    if (!JAVA_CONTROL_KEYWORDS.has(methodName)) {
                        const parameters = parseJavaParameters(rawParams);
                        const startLine = getLineAndColumn(lineOffsets, tokenBufferStart).line;
                        const methodInfo: JavaMethodInfo = {
                            name: methodName,
                            className: currentClass.name,
                            parameters,
                            startOffset: tokenBufferStart,
                            endOffset: 0,
                            bodyStartOffset: i + 1,
                            bodyEndOffset: 0,
                            startLine,
                            endLine: 0
                        };
                        currentClass.methods.push(methodInfo);
                    }
                }
            }

            braceDepth++;
            tokenBufferStart = i + 1;
        } else if (ch === "}") {
            braceDepth--;

            if (braceDepth === 1 && currentClass) {
                // A method closed
                const lastMethod = currentClass.methods[currentClass.methods.length - 1];
                if (lastMethod && lastMethod.endOffset === 0) {
                    lastMethod.endOffset = i + 1;
                    lastMethod.bodyEndOffset = i;
                    lastMethod.endLine = getLineAndColumn(lineOffsets, i).line;
                }
            } else if (braceDepth === 0 && currentClass) {
                // Class closed
                currentClass.endOffset = i + 1;
                currentClass.endLine = getLineAndColumn(lineOffsets, i).line;
                currentClass = null;
            }

            tokenBufferStart = i + 1;
        } else if (ch === ";") {
            if (braceDepth === 1 && currentClass) {
                // Abstract or interface method ending with semicolon
                const buffer = source.slice(tokenBufferStart, i).trim();
                const abstractMethodMatch = buffer.match(/\b([a-zA-Z_]\w*)\s*\(([\s\S]*?)\)(?:\s*throws\s+[^;]+)?$/);
                if (abstractMethodMatch) {
                    const methodName = abstractMethodMatch[1];
                    const rawParams = abstractMethodMatch[2];

                    if (!JAVA_CONTROL_KEYWORDS.has(methodName) && !buffer.startsWith("return") && !buffer.includes("=")) {
                        const parameters = parseJavaParameters(rawParams);
                        const startLine = getLineAndColumn(lineOffsets, tokenBufferStart).line;
                        const endLine = getLineAndColumn(lineOffsets, i).line;
                        currentClass.methods.push({
                            name: methodName,
                            className: currentClass.name,
                            parameters,
                            startOffset: tokenBufferStart,
                            endOffset: i + 1,
                            bodyStartOffset: 0,
                            bodyEndOffset: 0,
                            startLine,
                            endLine
                        });
                    }
                }
            }
            tokenBufferStart = i + 1;
        }

        i++;
    }

    return classes;
}

function extractJavaCalls(
    source: string,
    path: string,
    lineOffsets: number[],
    ranges: [number, number][],
    classes: JavaClassInfo[]
): CodeRelationship[] {
    const relationships: CodeRelationship[] = [];

    for (const cls of classes) {
        const methodNames = new Set(cls.methods.map((m) => m.name));

        for (const method of cls.methods) {
            if (method.bodyStartOffset === 0 || method.bodyEndOffset <= method.bodyStartOffset) {
                continue;
            }

            const containingCallable = `${cls.name}.${method.name}`;
            const bodySubstr = source.slice(method.bodyStartOffset, method.bodyEndOffset);
            const callRegex = /\b([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)\s*\(/g;
            let match: RegExpExecArray | null;

            while ((match = callRegex.exec(bodySubstr)) !== null) {
                const matchOffset = method.bodyStartOffset + match.index;
                if (isInsideRanges(ranges, matchOffset)) {
                    continue;
                }

                const calleeExpr = match[1];
                if (JAVA_CONTROL_KEYWORDS.has(calleeExpr)) {
                    continue;
                }

                const openParenOffset = method.bodyStartOffset + match.index + match[0].lastIndexOf("(");
                const closeParenOffset = findMatchingParen(source, ranges, openParenOffset);
                if (closeParenOffset === -1) {
                    continue;
                }

                let target: string | null = null;
                let targetMethodName = calleeExpr;

                if (calleeExpr.startsWith("this.")) {
                    targetMethodName = calleeExpr.slice(5);
                } else if (calleeExpr.startsWith(`${cls.name}.`)) {
                    targetMethodName = calleeExpr.slice(cls.name.length + 1);
                }

                if (methodNames.has(targetMethodName)) {
                    target = `${cls.name}.${targetMethodName}`;
                }

                if (target) {
                    const startPosition = getLineAndColumn(lineOffsets, matchOffset);
                    const endPosition = getLineAndColumn(lineOffsets, closeParenOffset + 1);
                    const expression = source.slice(matchOffset, closeParenOffset + 1);

                    const callSite: CallSite = {
                        file: path,
                        startLine: startPosition.line,
                        startColumn: startPosition.column,
                        endLine: endPosition.line,
                        endColumn: endPosition.column,
                        expression
                    };

                    relationships.push({
                        type: "calls",
                        from: containingCallable,
                        to: target,
                        callSites: [callSite]
                    });
                }
            }
        }
    }

    return relationships;
}

export function analyzeJava(source: string, path = "input.java"): LanguageAnalysisResult {
    const lineOffsets = computeLineOffsets(source);
    const ranges = getJavaCommentAndStringRanges(source);

    const { imports, relationships: importRelationships } = parseJavaImports(source, ranges);
    const classesInfo = parseJavaClassesAndMethods(source, ranges, lineOffsets);
    const callRelationships = extractJavaCalls(source, path, lineOffsets, ranges, classesInfo);

    const classes: AnalyzedClass[] = classesInfo.map((c) => ({
        name: c.name,
        methods: c.methods.map((m) => ({
            name: m.name,
            parameters: m.parameters
        }))
    }));

    return {
        imports,
        classes,
        functions: [],
        variables: [],
        relationships: [...importRelationships, ...callRelationships]
    };
}

export function extractJavaDeclarations(source: string, path = "input.java"): LanguageDeclaration[] {
    const lineOffsets = computeLineOffsets(source);
    const ranges = getJavaCommentAndStringRanges(source);
    const classesInfo = parseJavaClassesAndMethods(source, ranges, lineOffsets);
    const declarations: LanguageDeclaration[] = [];

    for (const cls of classesInfo) {
        declarations.push({
            type: "class",
            name: cls.name,
            startLine: cls.startLine,
            endLine: cls.endLine || cls.startLine,
            source: cls.endOffset > cls.startOffset
                ? source.slice(cls.startOffset, cls.endOffset)
                : source.slice(cls.startOffset)
        });

        for (const method of cls.methods) {
            declarations.push({
                type: "method",
                name: `${cls.name}.${method.name}`,
                startLine: method.startLine,
                endLine: method.endLine || method.startLine,
                source: method.endOffset > method.startOffset
                    ? source.slice(method.startOffset, method.endOffset)
                    : source.slice(method.startOffset)
            });
        }
    }

    return declarations;
}

export const javaAnalyzer: LanguageAnalyzer = {
    id: "java",
    name: "Java",
    supportedExtensions: [".java"],
    supportsSource(path: string): boolean {
        const lower = path.toLowerCase();
        return this.supportedExtensions.some((ext) => lower.endsWith(ext));
    },
    analyze(source: string, path: string): LanguageAnalysisResult {
        return analyzeJava(source, path);
    },
    extractDeclarations(source: string, path: string): LanguageDeclaration[] {
        return extractJavaDeclarations(source, path);
    }
};
