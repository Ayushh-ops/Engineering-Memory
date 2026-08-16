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
    const sourceFile = ts.createSourceFile(
        "input.ts",
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
    );

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
