import ts from "typescript";

export type HistoricalSymbolType = "class" | "function" | "method";

export type SymbolChangeType = "added" | "removed" | "modified";

export interface SymbolChange {
    type: SymbolChangeType;
    symbolType: HistoricalSymbolType;
    name: string;
}

export interface ApplicableFileChangeAnalysis {
    path: string;
    applicable: true;
    changes: SymbolChange[];
}

export interface InapplicableFileChangeAnalysis {
    path: string;
    applicable: false;
    changes: [];
    reason: "Structural TypeScript diffing is only available for .ts and .tsx files.";
}

export type FileChangeAnalysis =
    | ApplicableFileChangeAnalysis
    | InapplicableFileChangeAnalysis;

interface HistoricalSymbol {
    identity: string;
    symbolType: HistoricalSymbolType;
    name: string;
    declarationText: string;
}

function declarationName(
    name: ts.DeclarationName,
    sourceFile: ts.SourceFile
): string {
    return ts.isIdentifier(name) ? name.text : name.getText(sourceFile);
}

function collectSymbols(
    source: string,
    path: string
): Map<string, HistoricalSymbol[]> {
    const sourceFile = ts.createSourceFile(
        path,
        source,
        ts.ScriptTarget.Latest,
        true,
        path.toLowerCase().endsWith(".tsx")
            ? ts.ScriptKind.TSX
            : ts.ScriptKind.TS
    );

    const candidates = new Map<string, HistoricalSymbol[]>();

    const add = (symbol: HistoricalSymbol): void => {
        const existing = candidates.get(symbol.identity) ?? [];
        existing.push(symbol);
        candidates.set(symbol.identity, existing);
    };

    const visit = (node: ts.Node): void => {
        if (ts.isClassDeclaration(node) && node.name) {
            const className = node.name.text;

            add({
                identity: `class:${className}`,
                symbolType: "class",
                name: className,
                declarationText: node.getText(sourceFile)
            });

            for (const member of node.members) {
                if (ts.isMethodDeclaration(member) && member.name) {
                    const methodName = declarationName(
                        member.name,
                        sourceFile
                    );

                    add({
                        identity: `method:${className}.${methodName}`,
                        symbolType: "method",
                        name: `${className}.${methodName}`,
                        declarationText: member.getText(sourceFile)
                    });
                }
            }
        }

        if (ts.isFunctionDeclaration(node) && node.name) {
            const functionName = node.name.text;

            add({
                identity: `function:${functionName}`,
                symbolType: "function",
                name: functionName,
                declarationText: node.getText(sourceFile)
            });
        }

        ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    return candidates;
}

export function isTypeScriptPath(path: string): boolean {
    return /\.tsx?$/i.test(path);
}

export function analyzeHistoricalTypeScriptChange(
    path: string,
    parentSource: string | null,
    currentSource: string | null
): FileChangeAnalysis {
    if (!isTypeScriptPath(path)) {
        return {
            path,
            applicable: false,
            changes: [],
            reason: "Structural TypeScript diffing is only available for .ts and .tsx files."
        };
    }

    const parentSymbols =
        parentSource === null
            ? new Map<string, HistoricalSymbol[]>()
            : collectSymbols(parentSource, path);

    const currentSymbols =
        currentSource === null
            ? new Map<string, HistoricalSymbol[]>()
            : collectSymbols(currentSource, path);

    const identities = [
        ...new Set([
            ...parentSymbols.keys(),
            ...currentSymbols.keys()
        ])
    ].sort();

    const changes: SymbolChange[] = [];

    for (const identity of identities) {
        const parentCandidates = parentSymbols.get(identity) ?? [];
        const currentCandidates = currentSymbols.get(identity) ?? [];

        if (
            parentCandidates.length > 1 ||
            currentCandidates.length > 1
        ) {
            continue;
        }

        const parent = parentCandidates[0];
        const current = currentCandidates[0];

        if (!parent && current) {
            changes.push({
                type: "added",
                symbolType: current.symbolType,
                name: current.name
            });
        } else if (parent && !current) {
            changes.push({
                type: "removed",
                symbolType: parent.symbolType,
                name: parent.name
            });
        } else if (
            parent &&
            current &&
            parent.declarationText !== current.declarationText
        ) {
            changes.push({
                type: "modified",
                symbolType: current.symbolType,
                name: current.name
            });
        }
    }

    return {
        path,
        applicable: true,
        changes
    };
}