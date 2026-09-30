import ts from "typescript";
import type {
    AnalyzedClass,
    AnalyzedFunction,
    AnalyzedMethod,
    CallSite,
    CodeRelationship,
    LanguageAnalysisResult,
    LanguageDeclaration,
    LanguageDeclarationType,
    TypeScriptAnalysis,
    TypeScriptDeclaration,
    TypeScriptDeclarationType
} from "./types";

export type {
    AnalyzedClass,
    AnalyzedFunction,
    AnalyzedMethod,
    CallSite,
    CodeRelationship,
    LanguageAnalysisResult,
    LanguageDeclaration,
    LanguageDeclarationType,
    TypeScriptAnalysis,
    TypeScriptDeclaration,
    TypeScriptDeclarationType
};

function getScriptKindForPath(path: string): ts.ScriptKind {
    const lower = path.toLowerCase();
    if (lower.endsWith(".tsx")) {
        return ts.ScriptKind.TSX;
    }
    if (lower.endsWith(".jsx")) {
        return ts.ScriptKind.JSX;
    }
    if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) {
        return ts.ScriptKind.JS;
    }
    return ts.ScriptKind.TS;
}

function createTypeScriptSourceFile(source: string, path: string): ts.SourceFile {
    return ts.createSourceFile(
        path,
        source,
        ts.ScriptTarget.Latest,
        true,
        getScriptKindForPath(path)
    );
}

function getParameterNames(parameters: ts.NodeArray<ts.ParameterDeclaration>, sourceFile: ts.SourceFile): string[] {
    return parameters.map((parameter) => parameter.name.getText(sourceFile));
}

function getDeclarationName(name: ts.DeclarationName, sourceFile: ts.SourceFile): string {
    return ts.isIdentifier(name) ? name.text : name.getText(sourceFile);
}

function getCallTarget(expression: ts.Expression, sourceFile: ts.SourceFile): string | null {
    if (ts.isIdentifier(expression)) {
        return expression.text;
    }

    if (ts.isPropertyAccessExpression(expression)) {
        return expression.getText(sourceFile);
    }

    return null;
}

function getFunctionLikeInitializer(initializer: ts.Expression | undefined): ts.ArrowFunction | ts.FunctionExpression | null {
    if (!initializer) return null;
    let current: ts.Expression = initializer;
    while (true) {
        if (ts.isParenthesizedExpression(current)) {
            current = current.expression;
        } else if (ts.isAsExpression(current)) {
            current = current.expression;
        } else if (ts.isTypeAssertionExpression(current)) {
            current = current.expression;
        } else {
            break;
        }
    }
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
        return current;
    }
    return null;
}

export function analyzeTypeScript(source: string, path = "input.ts"): TypeScriptAnalysis {
    const sourceFile = createTypeScriptSourceFile(source, path);

    const analysis: TypeScriptAnalysis = {
        imports: [],
        classes: [],
        functions: [],
        variables: [],
        relationships: []
    };

    const synthesizedNameCounts = new Map<string, number>();
    const getSynthesizedCallbackName = (calleeText: string, argIndex: number, callNode: ts.CallExpression): string => {
        const startPosition = sourceFile.getLineAndCharacterOfPosition(callNode.getStart(sourceFile));
        const startLine = startPosition.line + 1;
        const baseName = `${calleeText}#${argIndex}@L${startLine}`;
        const count = (synthesizedNameCounts.get(baseName) ?? 0) + 1;
        synthesizedNameCounts.set(baseName, count);
        return count === 1 ? baseName : `${baseName}#${count}`;
    };

    const visit = (
        node: ts.Node,
        containingCallable: string | null = null,
        containingClass: string | null = null
    ): void => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            analysis.imports.push(node.moduleSpecifier.text);
            analysis.relationships.push({
                type: "imports",
                from: "file",
                to: node.moduleSpecifier.text
            });
        }

        // CommonJS require extraction: require("module-path") or require('module-path')
        if (
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === "require" &&
            node.arguments.length === 1 &&
            ts.isStringLiteral(node.arguments[0]!)
        ) {
            const modulePath = (node.arguments[0] as ts.StringLiteral).text;
            analysis.imports.push(modulePath);
            analysis.relationships.push({
                type: "imports",
                from: "file",
                to: modulePath
            });
        }

        if (ts.isClassDeclaration(node)) {
            analysis.classes.push({
                name: node.name?.text ?? null,
                methods: node.members
                    .filter(ts.isMethodDeclaration)
                    .map((method) => ({
                        name: getDeclarationName(method.name, sourceFile),
                        parameters: getParameterNames(method.parameters, sourceFile)
                    }))
            });
        }

        if (ts.isFunctionDeclaration(node)) {
            analysis.functions.push({
                name: node.name?.text ?? null,
                parameters: getParameterNames(node.parameters, sourceFile)
            });
        }

        const fnInitializer = ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
            ? getFunctionLikeInitializer(node.initializer)
            : null;

        if (ts.isVariableDeclaration(node)) {
            analysis.variables.push(getDeclarationName(node.name, sourceFile));
            if (fnInitializer && ts.isIdentifier(node.name)) {
                analysis.functions.push({
                    name: node.name.text,
                    parameters: getParameterNames(fnInitializer.parameters, sourceFile)
                });
            }
        }

        // Inline callback arguments for top-level call expressions
        // Synthesizes <calleeText>#<argumentIndex>@L<startLine> using 0-indexed position and line disambiguation
        const argCallables = new Map<ts.Node, string>();
        if (ts.isCallExpression(node) && !containingCallable && !containingClass) {
            const calleeText = getCallTarget(node.expression, sourceFile) || node.expression.getText(sourceFile).trim();
            node.arguments.forEach((arg, index) => {
                const fn = getFunctionLikeInitializer(arg);
                if (fn) {
                    const synthesizedName = getSynthesizedCallbackName(calleeText, index, node);
                    analysis.functions.push({
                        name: synthesizedName,
                        parameters: getParameterNames(fn.parameters, sourceFile)
                    });
                    argCallables.set(arg, synthesizedName);
                    argCallables.set(fn, synthesizedName);
                }
            });
        }

        if (ts.isCallExpression(node) && containingCallable) {
            // Avoid recording require('...') as a call relationship
            const isRequire = ts.isIdentifier(node.expression) &&
                node.expression.text === "require" &&
                node.arguments.length === 1 &&
                ts.isStringLiteral(node.arguments[0]!);

            if (!isRequire) {
                const target = getCallTarget(node.expression, sourceFile);

                if (target) {
                    const start = node.getStart(sourceFile);
                    const end = node.getEnd();
                    const startPosition = sourceFile.getLineAndCharacterOfPosition(start);
                    const endPosition = sourceFile.getLineAndCharacterOfPosition(end);
                    analysis.relationships.push({
                        type: "calls",
                        from: containingCallable,
                        to: target,
                        callSites: [{
                            file: sourceFile.fileName,
                            startLine: startPosition.line + 1,
                            startColumn: startPosition.character + 1,
                            endLine: endPosition.line + 1,
                            endColumn: endPosition.character + 1,
                            expression: node.getText(sourceFile)
                        }]
                    });
                }
            }
        }

        const nextClass = ts.isClassDeclaration(node)
            ? node.name?.text ?? containingClass
            : containingClass;

        let nextCallable = containingCallable;
        if (ts.isFunctionDeclaration(node)) {
            nextCallable = node.name?.text ?? containingCallable;
        } else if (ts.isMethodDeclaration(node)) {
            nextCallable = nextClass
                ? `${nextClass}.${getDeclarationName(node.name, sourceFile)}`
                : getDeclarationName(node.name, sourceFile);
        } else if (ts.isVariableDeclaration(node)) {
            if (fnInitializer && ts.isIdentifier(node.name)) {
                nextCallable = node.name.text;
            }
        } else if (ts.isPropertyAssignment(node)) {
            const propFn = getFunctionLikeInitializer(node.initializer);
            if (propFn) {
                const propName = getDeclarationName(node.name, sourceFile);
                nextCallable = nextClass ? `${nextClass}.${propName}` : propName;
            }
        }

        ts.forEachChild(node, (child) => {
            const childCallable = argCallables.get(child) ?? nextCallable;
            visit(child, childCallable, nextClass);
        });
    };

    visit(sourceFile);

    return analysis;
}

/**
 * Extracts declaration source evidence using the same TypeScript Compiler API
 * as structural analysis. Callers must supply source that has already been
 * fetched; this function never reads files or resolves modules.
 */
export function extractTypeScriptDeclarations(source: string, path: string): TypeScriptDeclaration[] {
    const sourceFile = createTypeScriptSourceFile(source, path);
    const declarations: TypeScriptDeclaration[] = [];

    const synthesizedNameCounts = new Map<string, number>();
    const getSynthesizedCallbackName = (calleeText: string, argIndex: number, callNode: ts.CallExpression): string => {
        const startPosition = sourceFile.getLineAndCharacterOfPosition(callNode.getStart(sourceFile));
        const startLine = startPosition.line + 1;
        const baseName = `${calleeText}#${argIndex}@L${startLine}`;
        const count = (synthesizedNameCounts.get(baseName) ?? 0) + 1;
        synthesizedNameCounts.set(baseName, count);
        return count === 1 ? baseName : `${baseName}#${count}`;
    };

    const add = (type: TypeScriptDeclarationType, name: string, node: ts.Node): void => {
        const start = node.getStart(sourceFile);
        const end = node.getEnd();
        const startLine = sourceFile.getLineAndCharacterOfPosition(start).line + 1;
        const endLine = sourceFile.getLineAndCharacterOfPosition(end).line + 1;
        declarations.push({
            type,
            name,
            startLine,
            endLine,
            source: source.slice(start, end)
        });
    };

    const visit = (node: ts.Node, containingCallable: string | null = null): void => {
        if (ts.isClassDeclaration(node) && node.name) {
            add("class", node.name.text, node);
            for (const member of node.members) {
                if (ts.isMethodDeclaration(member) && member.name) {
                    add("method", `${node.name.text}.${getDeclarationName(member.name, sourceFile)}`, member);
                }
            }
            return;
        }

        if (ts.isFunctionDeclaration(node) && node.name) {
            add("function", node.name.text, node);
        }

        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
            const fn = getFunctionLikeInitializer(node.initializer);
            if (fn) {
                const declNode = (
                    node.parent &&
                    ts.isVariableDeclarationList(node.parent) &&
                    node.parent.declarations.length === 1 &&
                    node.parent.parent &&
                    ts.isVariableStatement(node.parent.parent)
                ) ? node.parent.parent : node;
                add("function", node.name.text, declNode);
            }
        }

        const argCallables = new Map<ts.Node, string>();
        if (ts.isCallExpression(node) && !containingCallable) {
            const calleeText = getCallTarget(node.expression, sourceFile) || node.expression.getText(sourceFile).trim();
            node.arguments.forEach((arg, index) => {
                const fn = getFunctionLikeInitializer(arg);
                if (fn) {
                    const synthesizedName = getSynthesizedCallbackName(calleeText, index, node);
                    add("function", synthesizedName, fn);
                    argCallables.set(arg, synthesizedName);
                    argCallables.set(fn, synthesizedName);
                }
            });
        }

        const nextCallable = ts.isFunctionDeclaration(node)
            ? node.name?.text ?? containingCallable
            : ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && getFunctionLikeInitializer(node.initializer)
                ? node.name.text
                : containingCallable;

        ts.forEachChild(node, (child) => {
            const childCallable = argCallables.get(child) ?? nextCallable;
            visit(child, childCallable);
        });
    };

    visit(sourceFile);
    return declarations;
}
