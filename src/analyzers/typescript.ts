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

export interface TypeScriptAnalysis {
    imports: string[];
    classes: AnalyzedClass[];
    functions: AnalyzedFunction[];
    variables: string[];
}

function getParameterNames(parameters: ts.NodeArray<ts.ParameterDeclaration>, sourceFile: ts.SourceFile): string[] {
    return parameters.map((parameter) => parameter.name.getText(sourceFile));
}

function getDeclarationName(name: ts.DeclarationName, sourceFile: ts.SourceFile): string {
    return ts.isIdentifier(name) ? name.text : name.getText(sourceFile);
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
        variables: []
    };

    const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            analysis.imports.push(node.moduleSpecifier.text);
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

        ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    return analysis;
}
