import assert from "node:assert/strict";
import { RepositoryAnalysisService } from "./repository-analysis-service";
import type { RepositoryGraph } from "../graph/repository-graph";
import { RepositoryContextExpansionService } from "./repository-context-expansion-service";

const analysis = new RepositoryAnalysisService().analyzeFiles(
    { owner: "example", repository: "repository" },
    "abc123",
    [{
        path: "src/auth.ts",
        content: "import { formatUser } from './user'; export function auth() { return formatUser(); }"
    }]
);

assert.deepEqual(
    new RepositoryContextExpansionService(1).selectImportCandidates(
        analysis.files,
        ["src/auth.ts"]
    ),
    ["src/user", "src/user.ts", "src/user.tsx", "src/user.js", "src/user.jsx"]
);
assert.deepEqual(
    new RepositoryContextExpansionService(1).selectImportCandidates(
        analysis.files,
        ["src/auth.ts", "src/user"]
    ),
    ["src/user.ts", "src/user.tsx", "src/user.js", "src/user.jsx"]
);
assert.equal(
    new RepositoryContextExpansionService(0).selectImportCandidates(analysis.files, ["src/auth.ts"]).length,
    0
);
assert.deepEqual(
    new RepositoryContextExpansionService(3).selectImportCandidates(
        new RepositoryAnalysisService().analyzeFiles(
            { owner: "example", repository: "repository" },
            "abc123",
            [{ path: "src/auth.ts", content: "export const auth = true;" }]
        ).files,
        ["src/auth.ts"]
    ),
    []
);

const graph: RepositoryGraph = {
    nodes: [
        { id: "repository:example", type: "repository", name: "example" },
        { id: "file:src%2Fauth.ts", type: "file", name: "src/auth.ts", path: "src/auth.ts" },
        { id: "file:src%2Fuser.ts", type: "file", name: "src/user.ts", path: "src/user.ts" },
        { id: "file:src%2Fsession.ts", type: "file", name: "src/session.ts", path: "src/session.ts" },
        { id: "file:src%2Fformat.ts", type: "file", name: "src/format.ts", path: "src/format.ts" },
        { id: "file:src%2Flogging.ts", type: "file", name: "src/logging.ts", path: "src/logging.ts" }
    ],
    edges: [
        { from: "file:src%2Fauth.ts", to: "file:src%2Fuser.ts", type: "imports" },
        { from: "file:src%2Fauth.ts", to: "file:src%2Fsession.ts", type: "imports" },
        { from: "file:src%2Fuser.ts", to: "file:src%2Fformat.ts", type: "imports" },
        { from: "file:src%2Fuser.ts", to: "file:src%2Flogging.ts", type: "imports" }
    ]
};

assert.deepEqual(
    new RepositoryContextExpansionService(3).selectRelatedFiles(
        graph,
        ["src/auth.ts", "src/user.ts"]
    ),
    ["src/session.ts", "src/format.ts", "src/logging.ts"]
);
assert.deepEqual(
    new RepositoryContextExpansionService(1).selectRelatedFiles(graph, ["src/auth.ts"]),
    ["src/user.ts"]
);
assert.deepEqual(
    new RepositoryContextExpansionService(3).selectRelatedFiles(graph, ["src/auth.ts", "src/user.ts", "src/session.ts"]),
    ["src/format.ts", "src/logging.ts"]
);
assert.deepEqual(
    new RepositoryContextExpansionService(3).selectRelatedFiles(
        { nodes: [], edges: [] },
        ["src/auth.ts"]
    ),
    []
);

console.log("repository context expansion fixtures passed");
