import assert from "node:assert/strict";
import { analyzeTypeScript } from "../analyzers/typescript";
import { buildRepositoryGraph } from "../graph/repository-graph";
import { resolveRelativeImportRelationships } from "../resolvers/relative-imports";
import { RepositorySourceEvidenceService } from "./repository-source-evidence-service";

const files = [
    {
        path: "src/auth.ts",
        content: [
            "import { helper } from './helper';",
            "export function caller() { return target(); }",
            "export function target() { return callee(); }",
            "export function callee() { return helper(); }",
            "export function notCalled() { return false; }",
            "export class UserService { save() { return callee(); } }"
        ].join("\n")
    },
    {
        path: "src/helper.ts",
        content: "export function helper() { return 'help'; }"
    },
    {
        path: "src/ambiguous.ts",
        content: [
            "export function duplicate(value: string): string;",
            "export function duplicate(value: number): number;",
            "export function duplicate(value: string | number) { return value; }"
        ].join("\n")
    }
];

const analyzedFiles = files.map((file) => ({
    path: file.path,
    analysis: analyzeTypeScript(file.content)
}));
const graph = buildRepositoryGraph(
    "example/repository",
    analyzedFiles,
    resolveRelativeImportRelationships(analyzedFiles)
);
const service = new RepositorySourceEvidenceService();

const targetEvidence = service.select({
    type: "symbol",
    symbol: { type: "function", path: "src/auth.ts", name: "target" }
}, graph, files);

assert.deepEqual(
    targetEvidence.map((evidence) => `${evidence.path}:${evidence.symbol.name}`),
    [
        "src/auth.ts:target",
        "src/auth.ts:callee",
        "src/auth.ts:caller",
        "src/helper.ts:helper"
    ]
);
assert.ok(targetEvidence[0]?.code.includes("function target()"));
assert.ok(targetEvidence[1]?.code.includes("function callee()"));
assert.ok(targetEvidence[2]?.code.includes("function caller()"));
assert.ok(!targetEvidence.some((evidence) => evidence.symbol.name === "notCalled"));

const methodEvidence = service.select({
    type: "symbol",
    symbol: { type: "method", path: "src/auth.ts", name: "UserService.save" }
}, graph, files);
assert.equal(methodEvidence[0]?.symbol.name, "UserService.save");
assert.ok(methodEvidence[0]?.code.includes("save()"));

const classEvidence = service.select({
    type: "symbol",
    symbol: { type: "class", path: "src/auth.ts", name: "UserService" }
}, graph, files);
assert.equal(classEvidence[0]?.symbol.name, "UserService");
assert.ok(classEvidence[0]?.code.includes("class UserService"));

const ambiguousEvidence = service.select({
    type: "symbol",
    symbol: { type: "function", path: "src/ambiguous.ts", name: "duplicate" }
}, graph, files);
assert.equal(ambiguousEvidence.length, 0);

const unresolvedEvidence = service.select({
    type: "symbol",
    symbol: { type: "function", path: "src/auth.ts", name: "missing" }
}, graph, files);
assert.equal(unresolvedEvidence.length, 0);

const limitedEvidence = new RepositorySourceEvidenceService({
    maxSnippets: 8,
    maxBytesPerSnippet: 30,
    maxTotalBytes: 45
}).select({
    type: "symbol",
    symbol: { type: "function", path: "src/auth.ts", name: "target" }
}, graph, files);
assert.equal(limitedEvidence[0]?.symbol.name, "target");
assert.ok(limitedEvidence.every((evidence) => Buffer.byteLength(evidence.code, "utf8") <= 30));
assert.ok(limitedEvidence.reduce((total, evidence) => total + Buffer.byteLength(evidence.code, "utf8"), 0) <= 45);
assert.ok(limitedEvidence.some((evidence) => evidence.truncated));

console.log("repository source evidence fixtures passed");
