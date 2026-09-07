import ts from "typescript";

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

export interface CodeRelationship {
    type: "imports" | "calls";
    from: string;
    to: string;
}

export interface TypeScriptAnalysis {
    imports: string[];
    classes: AnalyzedClass[];
    functions: AnalyzedFunction[];
    variables: string[];
    relationships: CodeRelationship[];
}

export type TypeScriptDeclarationType = "class" | "function" | "method";

export interface TypeScriptDeclaration {
    type: TypeScriptDeclarationType;
    name: string;
    startLine: number;
    endLine: number;
    source: string;
}

function createTypeScriptSourceFile(source: string, path: string): ts.SourceFile {
    return ts.createSourceFile(
        path,
        source,
        ts.ScriptTarget.Latest,
        true,
        path.toLowerCase().endsWith(".tsx")
            ? ts.ScriptKind.TSX
            : ts.ScriptKind.TS
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

export function analyzeTypeScript(source: string): TypeScriptAnalysis {
    const sourceFile = createTypeScriptSourceFile(source, "input.ts");

    const analysis: TypeScriptAnalysis = {
        imports: [],
        classes: [],
        functions: [],
        variables: [],
        relationships: []
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

        if (ts.isVariableDeclaration(node)) {
            analysis.variables.push(getDeclarationName(node.name, sourceFile));
        }

        if (ts.isCallExpression(node) && containingCallable) {
            const target = getCallTarget(node.expression, sourceFile);

            if (target) {
                analysis.relationships.push({
                    type: "calls",
                    from: containingCallable,
                    to: target
                });
            }
        }

        const nextClass = ts.isClassDeclaration(node)
            ? node.name?.text ?? containingClass
            : containingClass;
        const nextCallable = ts.isFunctionDeclaration(node)
            ? node.name?.text ?? containingCallable
            : ts.isMethodDeclaration(node)
                ? nextClass
                    ? `${nextClass}.${getDeclarationName(node.name, sourceFile)}`
                    : getDeclarationName(node.name, sourceFile)
                : containingCallable;

        ts.forEachChild(node, (child) => visit(child, nextCallable, nextClass));
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

    const visit = (node: ts.Node): void => {
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

        ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return declarations;
}
