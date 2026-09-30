import assert from "node:assert/strict";
import { analyzeCpp, extractCppDeclarations, cppAnalyzer } from "./cpp";
import { getAnalyzerForPath, analyzeSource, extractDeclarationsForPath } from "./registry";
import { buildRepositoryGraph, type FileGraphNode } from "../graph/repository-graph";

// 1. Registry integration check
assert.equal(getAnalyzerForPath("main.cpp")?.id, "cpp");
assert.equal(getAnalyzerForPath("source.cc")?.id, "cpp");
assert.equal(getAnalyzerForPath("source.cxx")?.id, "cpp");
assert.equal(getAnalyzerForPath("header.h")?.id, "cpp");
assert.equal(getAnalyzerForPath("header.hpp")?.id, "cpp");
assert.equal(getAnalyzerForPath("SRC/MAIN.CPP")?.id, "cpp");

assert.equal(cppAnalyzer.supportsSource("main.cpp"), true);
assert.equal(cppAnalyzer.supportsSource("header.hpp"), true);
assert.equal(cppAnalyzer.supportsSource("main.go"), false);
assert.equal(cppAnalyzer.supportsSource("main.rs"), false);

// 2. Expected stub shape: empty arrays, unsupported flag/reason, basic #include extraction
const cppSource = [
    "#include <iostream>",
    "#include <vector>",
    "#include \"custom_header.h\"",
    "",
    "namespace Example {",
    "    class Service {",
    "    public:",
    "        void execute() {",
    "            std::cout << \"running\" << std::endl;",
    "        }",
    "    };",
    "}",
    "",
    "int main() {",
    "    Example::Service s;",
    "    s.execute();",
    "    return 0;",
    "}"
].join("\n");

const analysis = analyzeCpp(cppSource, "src/main.cpp");

// Valid shape matching LanguageAnalysisResult
assert.deepEqual(analysis.classes, []);
assert.deepEqual(analysis.functions, []);
assert.deepEqual(analysis.variables, []);
assert.equal(analysis.unsupported, true);
assert.ok(analysis.unsupportedReason && analysis.unsupportedReason.includes("stub"));

// Basic #include extraction
assert.deepEqual(analysis.imports, [
    "<iostream>",
    "<vector>",
    "\"custom_header.h\""
]);
assert.equal(analysis.relationships.length, 3);
assert.deepEqual(analysis.relationships[0], {
    type: "imports",
    from: "file",
    to: "<iostream>"
});

// extractDeclarations returns empty array for stub
const declarations = extractCppDeclarations(cppSource, "src/main.cpp");
assert.deepEqual(declarations, []);

// 3. Routing via registry helpers
const routedAnalysis = analyzeSource(cppSource, "src/main.cpp");
assert.equal(routedAnalysis.unsupported, true);
assert.deepEqual(routedAnalysis.classes, []);
assert.deepEqual(routedAnalysis.functions, []);

const routedDeclarations = extractDeclarationsForPath(cppSource, "src/main.cpp");
assert.deepEqual(routedDeclarations, []);

// 4. Graph builder compatibility check:
// Verify the graph builder can consume the C++ analysis result and create a valid file node without crashing
const analyzedFiles = [
    {
        path: "src/main.cpp",
        analysis
    }
];

const graph = buildRepositoryGraph("example/cpp-repo", analyzedFiles, []);
assert.ok(graph);
assert.ok(graph.nodes);
assert.ok(graph.edges);

const fileNode = graph.nodes.find((n): n is FileGraphNode => n.type === "file" && n.path === "src/main.cpp");
assert.ok(fileNode, "File node for src/main.cpp should be created in the repository graph");
assert.equal(fileNode.path, "src/main.cpp");

// Since C++ is a stub with no classes/functions, no symbol nodes should be created
const symbolNodes = graph.nodes.filter((n) => n.type === "class" || n.type === "function" || n.type === "method");
assert.equal(symbolNodes.length, 0);

console.log("C++ analyzer stub tests passed successfully");
