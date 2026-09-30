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

const GO_CONTROL_KEYWORDS = new Set([
    "break", "case", "chan", "const", "continue", "default", "defer",
    "else", "fallthrough", "for", "func", "go", "goto", "if", "import",
    "interface", "map", "package", "range", "return", "select", "struct",
    "switch", "type", "var"
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

function getGoCommentAndStringRanges(source: string): [number, number][] {
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

        if (ch === "`") {
            const start = i;
            i++;
            while (i < source.length && source[i] !== "`") {
                i++;
            }
            if (i < source.length) i++;
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

function parseGoParameters(paramStr: string): string[] {
    const trimmed = paramStr.trim();
    if (!trimmed) return [];

    const params: string[] = [];
    let depth = 0;
    let current = "";

    for (let i = 0; i < trimmed.length; i++) {
        const ch = trimmed[i];
        if (ch === "(" || ch === "[" || ch === "{" || ch === "<") {
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
        const parts = p.split(/\s+/).filter(Boolean);
        if (parts.length > 0) {
            const firstPart = parts[0].replace(/^[*&]/, "");
            const match = firstPart.match(/^([a-zA-Z_]\w*)/);
            if (match && match[1] !== "_") {
                result.push(match[1]);
            }
        }
    }

    return result;
}

function parseGoImports(source: string, ranges: [number, number][]): {
    imports: string[];
    relationships: CodeRelationship[];
} {
    const rawItems: { offset: number; path: string }[] = [];

    // Grouped import: import ( ... )
    const groupedRegex = /\bimport\s*\(([\s\S]*?)\)/g;
    let match: RegExpExecArray | null;

    while ((match = groupedRegex.exec(source)) !== null) {
        if (isInsideRanges(ranges, match.index)) {
            continue;
        }

        const inner = match[1];
        const stringRegex = /"([^"\\]*(?:\\.[^"\\]*)*)"/g;
        let strMatch: RegExpExecArray | null;

        while ((strMatch = stringRegex.exec(inner)) !== null) {
            rawItems.push({
                offset: match.index + strMatch.index,
                path: strMatch[1]
            });
        }
    }

    // Single-line import: import "fmt" or import alias "path"
    const singleRegex = /\bimport\s+(?:[a-zA-Z_]\w*\s+)?"([^"\\]*(?:\\.[^"\\]*)*)"/g;
    while ((match = singleRegex.exec(source)) !== null) {
        if (isInsideRanges(ranges, match.index)) {
            continue;
        }
        rawItems.push({
            offset: match.index,
            path: match[1]
        });
    }

    rawItems.sort((a, b) => a.offset - b.offset);

    const imports: string[] = rawItems.map((item) => item.path);
    const relationships: CodeRelationship[] = rawItems.map((item) => ({
        type: "imports",
        from: "file",
        to: item.path
    }));

    return { imports, relationships };
}

interface GoStructInfo {
    name: string;
    startOffset: number;
    endOffset: number;
    startLine: number;
    endLine: number;
}

interface GoFunctionInfo {
    name: string;
    receiverType?: string;
    parameters: string[];
    startOffset: number;
    endOffset: number;
    bodyStartOffset: number;
    bodyEndOffset: number;
    startLine: number;
    endLine: number;
}

function parseGoStructures(
    source: string,
    ranges: [number, number][],
    lineOffsets: number[]
): {
    structs: GoStructInfo[];
    functions: GoFunctionInfo[];
} {
    const structs: GoStructInfo[] = [];
    const functions: GoFunctionInfo[] = [];

    let i = 0;
    let braceDepth = 0;
    let currentStruct: GoStructInfo | null = null;
    let currentFunc: GoFunctionInfo | null = null;
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
                // Check struct or interface declaration: type Foo struct / type Foo interface
                const structMatch = buffer.match(/\btype\s+([a-zA-Z_]\w*)\s+(?:struct|interface)\b/);
                if (structMatch) {
                    const structName = structMatch[1];
                    const startLine = getLineAndColumn(lineOffsets, tokenBufferStart).line;
                    currentStruct = {
                        name: structName,
                        startOffset: tokenBufferStart,
                        endOffset: 0,
                        startLine,
                        endLine: 0
                    };
                    structs.push(currentStruct);
                } else {
                    // Check receiver method: func (r *Account) Deposit(...) or func (Account) Deposit(...)
                    const receiverMethodMatch = buffer.match(
                        /\bfunc\s*\(([\s\S]*?)\)\s*([a-zA-Z_]\w*)\s*\(([\s\S]*?)\)/
                    );
                    if (receiverMethodMatch) {
                        const rawReceiver = receiverMethodMatch[1].trim();
                        const methodName = receiverMethodMatch[2];
                        const rawParams = receiverMethodMatch[3];

                        // Extract receiver type: e.g. "a *Account" -> "Account", "*Account" -> "Account"
                        const receiverParts = rawReceiver.split(/\s+/).filter(Boolean);
                        const lastReceiverToken = receiverParts[receiverParts.length - 1] || "";
                        const receiverType = lastReceiverToken.replace(/^[*&]/, "").split(".")[0];

                        const parameters = parseGoParameters(rawParams);
                        const startLine = getLineAndColumn(lineOffsets, tokenBufferStart).line;

                        currentFunc = {
                            name: methodName,
                            receiverType: receiverType || undefined,
                            parameters,
                            startOffset: tokenBufferStart,
                            endOffset: 0,
                            bodyStartOffset: i + 1,
                            bodyEndOffset: 0,
                            startLine,
                            endLine: 0
                        };
                        functions.push(currentFunc);
                    } else {
                        // Check top-level function: func Process(...)
                        const funcMatch = buffer.match(/\bfunc\s+([a-zA-Z_]\w*)\s*\(([\s\S]*?)\)/);
                        if (funcMatch) {
                            const funcName = funcMatch[1];
                            const rawParams = funcMatch[2];
                            const parameters = parseGoParameters(rawParams);
                            const startLine = getLineAndColumn(lineOffsets, tokenBufferStart).line;

                            currentFunc = {
                                name: funcName,
                                parameters,
                                startOffset: tokenBufferStart,
                                endOffset: 0,
                                bodyStartOffset: i + 1,
                                bodyEndOffset: 0,
                                startLine,
                                endLine: 0
                            };
                            functions.push(currentFunc);
                        }
                    }
                }
            }

            braceDepth++;
            tokenBufferStart = i + 1;
        } else if (ch === "}") {
            braceDepth--;

            if (braceDepth === 0) {
                if (currentStruct) {
                    currentStruct.endOffset = i + 1;
                    currentStruct.endLine = getLineAndColumn(lineOffsets, i).line;
                    currentStruct = null;
                }
                if (currentFunc) {
                    currentFunc.endOffset = i + 1;
                    currentFunc.bodyEndOffset = i;
                    currentFunc.endLine = getLineAndColumn(lineOffsets, i).line;
                    currentFunc = null;
                }
            }

            tokenBufferStart = i + 1;
        }

        i++;
    }

    return { structs, functions };
}

function extractGoCalls(
    source: string,
    path: string,
    lineOffsets: number[],
    ranges: [number, number][],
    functions: GoFunctionInfo[]
): CodeRelationship[] {
    const relationships: CodeRelationship[] = [];

    // Map of top-level functions and receiver methods
    const topLevelFuncNames = new Set(
        functions.filter((f) => !f.receiverType).map((f) => f.name)
    );

    const methodsByReceiver = new Map<string, Set<string>>();
    for (const f of functions) {
        if (f.receiverType) {
            const methods = methodsByReceiver.get(f.receiverType) ?? new Set();
            methods.add(f.name);
            methodsByReceiver.set(f.receiverType, methods);
        }
    }

    for (const func of functions) {
        if (func.bodyStartOffset === 0 || func.bodyEndOffset <= func.bodyStartOffset) {
            continue;
        }

        const containingCallable = func.receiverType
            ? `${func.receiverType}.${func.name}`
            : func.name;

        const bodySubstr = source.slice(func.bodyStartOffset, func.bodyEndOffset);
        const callRegex = /\b([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)\s*\(/g;
        let match: RegExpExecArray | null;

        while ((match = callRegex.exec(bodySubstr)) !== null) {
            const matchOffset = func.bodyStartOffset + match.index;
            if (isInsideRanges(ranges, matchOffset)) {
                continue;
            }

            const calleeExpr = match[1];
            if (GO_CONTROL_KEYWORDS.has(calleeExpr)) {
                continue;
            }

            const openParenOffset = func.bodyStartOffset + match.index + match[0].lastIndexOf("(");
            const closeParenOffset = findMatchingParen(source, ranges, openParenOffset);
            if (closeParenOffset === -1) {
                continue;
            }

            let target: string | null = null;

            if (calleeExpr.includes(".")) {
                const parts = calleeExpr.split(".");
                if (parts.length === 2) {
                    const [recvOrPkg, methodName] = parts;
                    // Check if receiver type matches current receiver
                    if (func.receiverType && methodsByReceiver.get(func.receiverType)?.has(methodName)) {
                        target = `${func.receiverType}.${methodName}`;
                    } else {
                        // Check if any defined struct has this method
                        for (const [recvType, methodSet] of methodsByReceiver.entries()) {
                            if (recvOrPkg === recvType || methodSet.has(methodName)) {
                                target = `${recvType}.${methodName}`;
                                break;
                            }
                        }
                    }
                }
            } else if (func.receiverType && methodsByReceiver.get(func.receiverType)?.has(calleeExpr)) {
                target = `${func.receiverType}.${calleeExpr}`;
            } else if (topLevelFuncNames.has(calleeExpr)) {
                target = calleeExpr;
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

    return relationships;
}

export function analyzeGo(source: string, path = "input.go"): LanguageAnalysisResult {
    const lineOffsets = computeLineOffsets(source);
    const ranges = getGoCommentAndStringRanges(source);

    const { imports, relationships: importRelationships } = parseGoImports(source, ranges);
    const { structs, functions } = parseGoStructures(source, ranges, lineOffsets);
    const callRelationships = extractGoCalls(source, path, lineOffsets, ranges, functions);

    // Group methods by receiver type for AnalyzedClass representation
    const classMap = new Map<string, AnalyzedMethod[]>();

    for (const s of structs) {
        if (!classMap.has(s.name)) {
            classMap.set(s.name, []);
        }
    }

    const analyzedFunctions: AnalyzedFunction[] = [];

    for (const f of functions) {
        if (f.receiverType) {
            const methods = classMap.get(f.receiverType) ?? [];
            methods.push({
                name: f.name,
                parameters: f.parameters
            });
            classMap.set(f.receiverType, methods);
        } else {
            analyzedFunctions.push({
                name: f.name,
                parameters: f.parameters
            });
        }
    }

    const classes: AnalyzedClass[] = Array.from(classMap.entries()).map(([name, methods]) => ({
        name,
        methods
    }));

    return {
        imports,
        classes,
        functions: analyzedFunctions,
        variables: [],
        relationships: [...importRelationships, ...callRelationships]
    };
}

export function extractGoDeclarations(source: string, path = "input.go"): LanguageDeclaration[] {
    const lineOffsets = computeLineOffsets(source);
    const ranges = getGoCommentAndStringRanges(source);
    const { structs, functions } = parseGoStructures(source, ranges, lineOffsets);
    const declarations: LanguageDeclaration[] = [];

    for (const s of structs) {
        declarations.push({
            type: "class",
            name: s.name,
            startLine: s.startLine,
            endLine: s.endLine || s.startLine,
            source: s.endOffset > s.startOffset
                ? source.slice(s.startOffset, s.endOffset)
                : source.slice(s.startOffset)
        });
    }

    for (const f of functions) {
        if (f.receiverType) {
            declarations.push({
                type: "method",
                name: `${f.receiverType}.${f.name}`,
                startLine: f.startLine,
                endLine: f.endLine || f.startLine,
                source: f.endOffset > f.startOffset
                    ? source.slice(f.startOffset, f.endOffset)
                    : source.slice(f.startOffset)
            });
        } else {
            declarations.push({
                type: "function",
                name: f.name,
                startLine: f.startLine,
                endLine: f.endLine || f.startLine,
                source: f.endOffset > f.startOffset
                    ? source.slice(f.startOffset, f.endOffset)
                    : source.slice(f.startOffset)
            });
        }
    }

    return declarations;
}

export const goAnalyzer: LanguageAnalyzer = {
    id: "go",
    name: "Go",
    supportedExtensions: [".go"],
    supportsSource(path: string): boolean {
        const lower = path.toLowerCase();
        return this.supportedExtensions.some((ext) => lower.endsWith(ext));
    },
    analyze(source: string, path: string): LanguageAnalysisResult {
        return analyzeGo(source, path);
    },
    extractDeclarations(source: string, path: string): LanguageDeclaration[] {
        return extractGoDeclarations(source, path);
    }
};
