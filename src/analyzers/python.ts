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

const PYTHON_KEYWORDS = new Set([
    "and", "as", "assert", "async", "await", "break", "class", "continue",
    "def", "del", "elif", "else", "except", "finally", "for", "from",
    "global", "if", "import", "in", "is", "lambda", "nonlocal", "not",
    "or", "pass", "raise", "return", "try", "while", "with", "yield"
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

function getIndentation(line: string): number {
    let count = 0;
    for (let i = 0; i < line.length; i++) {
        if (line[i] === " ") {
            count++;
        } else if (line[i] === "\t") {
            count += 4;
        } else {
            break;
        }
    }
    return count;
}

function getStringAndCommentRanges(source: string): [number, number][] {
    const ranges: [number, number][] = [];
    let i = 0;

    while (i < source.length) {
        const ch = source[i];

        if (ch === "#") {
            const start = i;
            while (i < source.length && source[i] !== "\n") {
                i++;
            }
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

        if (source.slice(i, i + 3) === "'''") {
            const start = i;
            i += 3;
            while (i < source.length && source.slice(i, i + 3) !== "'''") {
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

        if (ch === '"' || ch === "'") {
            const quote = ch;
            const start = i;
            i++;
            while (i < source.length && source[i] !== quote && source[i] !== "\n") {
                if (source[i] === "\\" && i + 1 < source.length) {
                    i += 2;
                } else {
                    i++;
                }
            }
            if (i < source.length && source[i] === quote) i++;
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

function findMatchingParen(source: string, openParenIndex: number): number {
    let depth = 0;
    let inQuote: string | null = null;
    let isEscaped = false;

    for (let i = openParenIndex; i < source.length; i++) {
        const ch = source[i];

        if (inQuote) {
            if (isEscaped) {
                isEscaped = false;
                continue;
            }
            if (ch === "\\") {
                isEscaped = true;
                continue;
            }
            if (ch === inQuote) {
                if (
                    (inQuote === "'''" || inQuote === '"""') &&
                    source.slice(i, i + 3) === inQuote
                ) {
                    i += 2;
                    inQuote = null;
                } else if (inQuote === "'" || inQuote === '"') {
                    inQuote = null;
                }
            }
            continue;
        }

        if (ch === "'" || ch === '"') {
            if (source.slice(i, i + 3) === "'''") {
                inQuote = "'''";
                i += 2;
            } else if (source.slice(i, i + 3) === '"""') {
                inQuote = '"""';
                i += 2;
            } else {
                inQuote = ch;
            }
            continue;
        }

        if (ch === "#") {
            while (i < source.length && source[i] !== "\n") {
                i++;
            }
            continue;
        }

        if (ch === "(" || ch === "[" || ch === "{") {
            depth++;
        } else if (ch === ")" || ch === "]" || ch === "}") {
            depth--;
            if (depth === 0) {
                return i;
            }
        }
    }
    return -1;
}

function parseParameters(paramStr: string): string[] {
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
        } else if (ch === "'" || ch === '"') {
            inQuote = ch;
            current += ch;
        } else if (ch === "(" || ch === "[" || ch === "{") {
            depth++;
            current += ch;
        } else if (ch === ")" || ch === "]" || ch === "}") {
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
        if (p === "/" || p === "*") continue;
        let clean = p.split("=")[0].trim();
        clean = clean.split(":")[0].trim();
        const match = clean.match(/^(\*{0,2}[a-zA-Z_]\w*)/);
        if (match) {
            result.push(match[1]);
        }
    }

    return result;
}

function parseImports(lines: string[]): { imports: string[]; relationships: CodeRelationship[] } {
    const imports: string[] = [];
    const relationships: CodeRelationship[] = [];

    let i = 0;
    while (i < lines.length) {
        let line = lines[i].trim();

        if (
            (line.startsWith("from ") || line.startsWith("import ")) &&
            line.includes("(") &&
            !line.includes(")")
        ) {
            let combined = line;
            i++;
            while (i < lines.length) {
                combined += " " + lines[i].trim();
                if (lines[i].includes(")")) {
                    break;
                }
                i++;
            }
            line = combined.replace(/\s+/g, " ");
        }

        const hashIdx = line.indexOf("#");
        if (hashIdx >= 0) {
            line = line.slice(0, hashIdx).trim();
        }

        if (line.startsWith("import ")) {
            const afterImport = line.slice("import ".length).trim();
            const parts = afterImport.split(",");
            for (const part of parts) {
                const trimmedPart = part.trim();
                if (!trimmedPart) continue;
                const mod = trimmedPart.split(/\s+as\s+/)[0].trim();
                if (mod) {
                    imports.push(mod);
                    relationships.push({
                        type: "imports",
                        from: "file",
                        to: mod
                    });
                }
            }
        } else if (line.startsWith("from ")) {
            const match = line.match(/^from\s+([^\s]+)\s+import\s+(.+)$/);
            if (match) {
                const fromPart = match[1].trim();
                let importPart = match[2].trim();
                if (importPart.startsWith("(") && importPart.endsWith(")")) {
                    importPart = importPart.slice(1, -1).trim();
                }

                const importedSymbols: string[] = importPart
                    .split(",")
                    .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
                    .filter(Boolean);

                let dotCount = 0;
                while (dotCount < fromPart.length && fromPart[dotCount] === ".") {
                    dotCount++;
                }

                if (dotCount === 0) {
                    imports.push(fromPart);
                    relationships.push({
                        type: "imports",
                        from: "file",
                        to: fromPart
                    });
                } else {
                    const prefix = dotCount === 1 ? "./" : "../".repeat(dotCount - 1);
                    const remainder = fromPart.slice(dotCount).trim();

                    if (remainder.length > 0) {
                        const targetPath = prefix + remainder.replace(/\./g, "/");
                        imports.push(targetPath);
                        relationships.push({
                            type: "imports",
                            from: "file",
                            to: targetPath
                        });
                    } else {
                        for (const sym of importedSymbols) {
                            const targetPath = prefix + sym.replace(/\./g, "/");
                            imports.push(targetPath);
                            relationships.push({
                                type: "imports",
                                from: "file",
                                to: targetPath
                            });
                        }
                    }
                }
            }
        }

        i++;
    }

    return { imports, relationships };
}

function parseTopLevelVariables(lines: string[]): string[] {
    const variables: string[] = [];

    for (const line of lines) {
        if (getIndentation(line) !== 0) continue;
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith('"""') || trimmed.startsWith("'''")) continue;

        const match = trimmed.match(/^([a-zA-Z_]\w*(?:\s*,\s*[a-zA-Z_]\w*)*)(?:\s*:\s*[^=]+)?\s*=/);
        if (match) {
            const names = match[1].split(",").map((n) => n.trim()).filter(Boolean);
            for (const name of names) {
                if (!PYTHON_KEYWORDS.has(name)) {
                    variables.push(name);
                }
            }
        }
    }
    return variables;
}

interface ParsedBlock {
    type: "class" | "function" | "method";
    name: string;
    className?: string;
    parameters?: string[];
    startLine: number;
    headerEndLine: number;
    endLine: number;
    indent: number;
}

function parsePythonStructure(lines: string[]): {
    classes: AnalyzedClass[];
    functions: AnalyzedFunction[];
    declarations: LanguageDeclaration[];
    blocks: ParsedBlock[];
} {
    const blocks: ParsedBlock[] = [];
    const totalLines = lines.length;

    let inDocstring: string | null = null;

    let i = 0;
    while (i < totalLines) {
        const line = lines[i];
        const trimmed = line.trim();
        const indent = getIndentation(line);

        if (inDocstring) {
            if (line.includes(inDocstring)) {
                inDocstring = null;
            }
            i++;
            continue;
        }

        if (trimmed.startsWith('"""')) {
            if (trimmed.slice(3).includes('"""')) {
                i++;
                continue;
            }
            inDocstring = '"""';
            i++;
            continue;
        }
        if (trimmed.startsWith("'''")) {
            if (trimmed.slice(3).includes("'''")) {
                i++;
                continue;
            }
            inDocstring = "'''";
            i++;
            continue;
        }

        if (!trimmed || trimmed.startsWith("#")) {
            i++;
            continue;
        }

        // Check for class declaration
        const classMatch = trimmed.match(/^(?:class)\s+([a-zA-Z_]\w*)(?:\s*\(([\s\S]*?)\))?\s*:/);
        if (classMatch) {
            const className = classMatch[1];
            const startLine = i + 1;
            let headerEndLine = startLine;

            // Handle multiline class header if needed
            let headerText = trimmed;
            let curI = i;
            while (!headerText.includes(":") && curI + 1 < totalLines) {
                curI++;
                headerText += " " + lines[curI].trim();
                headerEndLine = curI + 1;
            }

            // Find end of class body by indentation
            let endLine = headerEndLine;
            for (let j = curI + 1; j < totalLines; j++) {
                const bodyLine = lines[j];
                const bodyTrimmed = bodyLine.trim();
                if (!bodyTrimmed) continue;
                const bodyIndent = getIndentation(bodyLine);
                if (bodyIndent <= indent) {
                    break;
                }
                endLine = j + 1;
            }

            blocks.push({
                type: "class",
                name: className,
                startLine,
                headerEndLine,
                endLine,
                indent
            });

            i = curI + 1;
            continue;
        }

        // Check for function or method declaration
        const defMatch = trimmed.match(/^(?:async\s+)?def\s+([a-zA-Z_]\w*)\s*\(([\s\S]*)/);
        if (defMatch) {
            const funcName = defMatch[1];
            const startLine = i + 1;
            let headerEndLine = startLine;

            let paramText = defMatch[2];
            let curI = i;
            while (!paramText.includes("):") && !paramText.includes(")\s*->") && curI + 1 < totalLines) {
                if (paramText.includes(":") && paramText.includes(")")) break;
                curI++;
                paramText += " " + lines[curI].trim();
                headerEndLine = curI + 1;
            }

            // Extract content between ( and )
            const firstParen = paramText.indexOf("(");
            const parenContent = firstParen >= 0 ? paramText.slice(firstParen + 1) : paramText;
            const lastParen = parenContent.lastIndexOf(")");
            const rawParams = lastParen >= 0 ? parenContent.slice(0, lastParen) : parenContent.split(":")[0];
            const parameters = parseParameters(rawParams);

            let endLine = headerEndLine;
            for (let j = curI + 1; j < totalLines; j++) {
                const bodyLine = lines[j];
                const bodyTrimmed = bodyLine.trim();
                if (!bodyTrimmed) continue;
                const bodyIndent = getIndentation(bodyLine);
                if (bodyIndent <= indent) {
                    break;
                }
                endLine = j + 1;
            }

            // Determine if inside a class block
            let parentClass: ParsedBlock | null = null;
            for (const b of blocks) {
                if (b.type === "class" && startLine > b.startLine && endLine <= b.endLine && indent > b.indent) {
                    parentClass = b;
                }
            }

            if (parentClass) {
                blocks.push({
                    type: "method",
                    name: funcName,
                    className: parentClass.name,
                    parameters,
                    startLine,
                    headerEndLine,
                    endLine,
                    indent
                });
            } else {
                blocks.push({
                    type: "function",
                    name: funcName,
                    parameters,
                    startLine,
                    headerEndLine,
                    endLine,
                    indent
                });
            }

            i = curI + 1;
            continue;
        }

        i++;
    }

    const classes: AnalyzedClass[] = [];
    const functions: AnalyzedFunction[] = [];
    const declarations: LanguageDeclaration[] = [];

    for (const b of blocks) {
        if (b.type === "class") {
            const methods: AnalyzedMethod[] = blocks
                .filter((child) => child.type === "method" && child.className === b.name)
                .map((m) => ({
                    name: m.name,
                    parameters: m.parameters ?? []
                }));

            classes.push({
                name: b.name,
                methods
            });

            declarations.push({
                type: "class",
                name: b.name,
                startLine: b.startLine,
                endLine: b.endLine,
                source: lines.slice(b.startLine - 1, b.endLine).join("\n")
            });
        } else if (b.type === "function") {
            functions.push({
                name: b.name,
                parameters: b.parameters ?? []
            });

            declarations.push({
                type: "function",
                name: b.name,
                startLine: b.startLine,
                endLine: b.endLine,
                source: lines.slice(b.startLine - 1, b.endLine).join("\n")
            });
        } else if (b.type === "method") {
            const qualifiedName = `${b.className}.${b.name}`;
            declarations.push({
                type: "method",
                name: qualifiedName,
                startLine: b.startLine,
                endLine: b.endLine,
                source: lines.slice(b.startLine - 1, b.endLine).join("\n")
            });
        }
    }

    return { classes, functions, declarations, blocks };
}

function extractCallRelationships(
    source: string,
    path: string,
    lineOffsets: number[],
    blocks: ParsedBlock[]
): CodeRelationship[] {
    const relationships: CodeRelationship[] = [];
    const ranges = getStringAndCommentRanges(source);

    const definedFunctions = new Set(
        blocks.filter((b) => b.type === "function").map((b) => b.name)
    );

    const classMethods = new Map<string, Set<string>>();
    for (const b of blocks) {
        if (b.type === "class") {
            classMethods.set(b.name, new Set());
        }
    }
    for (const b of blocks) {
        if (b.type === "method" && b.className && classMethods.has(b.className)) {
            classMethods.get(b.className)!.add(b.name);
        }
    }

    // Process calls inside each callable block (function or method)
    const callables = blocks.filter((b) => b.type === "function" || b.type === "method");

    for (const callable of callables) {
        const containingCallable = callable.type === "method"
            ? `${callable.className}.${callable.name}`
            : callable.name;
        const containingClass = callable.className ?? null;

        // Block start offset is after the header end line
        const startLineIdx = callable.headerEndLine;
        const endLineIdx = callable.endLine;

        if (startLineIdx >= endLineIdx && callable.startLine === callable.endLine) {
            // 1-line function like: def foo(): return bar()
            // search after ':'
            const headerStartOffset = lineOffsets[callable.startLine - 1];
            const headerEndOffset = lineOffsets[callable.endLine] ?? source.length;
            const colonIdx = source.indexOf(":", headerStartOffset);
            if (colonIdx >= 0 && colonIdx < headerEndOffset) {
                scanRangeForCalls(colonIdx + 1, headerEndOffset);
            }
            continue;
        }

        const bodyStartOffset = lineOffsets[startLineIdx] ?? lineOffsets[callable.startLine - 1];
        const bodyEndOffset = callable.endLine < lineOffsets.length
            ? lineOffsets[callable.endLine]
            : source.length;

        scanRangeForCalls(bodyStartOffset, bodyEndOffset);

        function scanRangeForCalls(fromOffset: number, toOffset: number): void {
            const bodySubstr = source.slice(fromOffset, toOffset);
            const callRegex = /\b([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)\s*\(/g;
            let match: RegExpExecArray | null;

            while ((match = callRegex.exec(bodySubstr)) !== null) {
                const matchOffset = fromOffset + match.index;
                if (isInsideRanges(ranges, matchOffset)) {
                    continue;
                }

                const calleeExpr = match[1];
                if (PYTHON_KEYWORDS.has(calleeExpr)) {
                    continue;
                }

                const openParenOffset = fromOffset + match.index + match[0].lastIndexOf("(");
                const closeParenOffset = findMatchingParen(source, openParenOffset);
                if (closeParenOffset === -1) {
                    continue;
                }

                let target: string | null = null;

                if (calleeExpr.startsWith("self.") || calleeExpr.startsWith("cls.")) {
                    const methodName = calleeExpr.slice(calleeExpr.indexOf(".") + 1);
                    if (containingClass && classMethods.get(containingClass)?.has(methodName)) {
                        target = `${containingClass}.${methodName}`;
                    }
                } else if (calleeExpr.includes(".")) {
                    const parts = calleeExpr.split(".");
                    if (parts.length === 2) {
                        const [cName, mName] = parts;
                        if (classMethods.has(cName) && classMethods.get(cName)?.has(mName)) {
                            target = `${cName}.${mName}`;
                        }
                    }
                } else if (definedFunctions.has(calleeExpr)) {
                    target = calleeExpr;
                } else if (containingClass && classMethods.get(containingClass)?.has(calleeExpr)) {
                    target = `${containingClass}.${calleeExpr}`;
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

export function analyzePython(source: string, path = "input.py"): LanguageAnalysisResult {
    const lines = source.split(/\r?\n/);
    const lineOffsets = computeLineOffsets(source);

    const { imports, relationships: importRelationships } = parseImports(lines);
    const variables = parseTopLevelVariables(lines);
    const { classes, functions, blocks } = parsePythonStructure(lines);
    const callRelationships = extractCallRelationships(source, path, lineOffsets, blocks);

    return {
        imports,
        classes,
        functions,
        variables,
        relationships: [...importRelationships, ...callRelationships]
    };
}

export function extractPythonDeclarations(source: string, path = "input.py"): LanguageDeclaration[] {
    const lines = source.split(/\r?\n/);
    const { declarations } = parsePythonStructure(lines);
    return declarations;
}

export const pythonAnalyzer: LanguageAnalyzer = {
    id: "python",
    name: "Python",
    supportedExtensions: [".py", ".pyw"],
    supportsSource(path: string): boolean {
        const lower = path.toLowerCase();
        return this.supportedExtensions.some((ext) => lower.endsWith(ext));
    },
    analyze(source: string, path: string): LanguageAnalysisResult {
        return analyzePython(source, path);
    },
    extractDeclarations(source: string, path: string): LanguageDeclaration[] {
        return extractPythonDeclarations(source, path);
    }
};
