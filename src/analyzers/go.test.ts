import assert from "node:assert/strict";
import { analyzeGo, extractGoDeclarations, goAnalyzer } from "./go";
import { getAnalyzerForPath, analyzeSource, extractDeclarationsForPath } from "./registry";

// 1. Registry integration check
assert.equal(getAnalyzerForPath("main.go")?.id, "go");
assert.equal(getAnalyzerForPath("pkg/server.GO")?.id, "go");
assert.equal(goAnalyzer.supportsSource("server.go"), true);
assert.equal(goAnalyzer.supportsSource("server.java"), false);
assert.equal(goAnalyzer.supportsSource("server.py"), false);
assert.equal(goAnalyzer.supportsSource("server.ts"), false);

// 2. Top-level function, receiver method, both import styles, same-scope call
const goSource = [
    "package main",
    "",
    "import \"fmt\"",
    "import (",
    "    \"os\"",
    "    \"strings\"",
    ")",
    "",
    "type Account struct {",
    "    ID      string",
    "    Balance float64",
    "}",
    "",
    "func initLogger() {",
    "    fmt.Println(\"logger initialized\")",
    "}",
    "",
    "func (a *Account) Deposit(amount float64) bool {",
    "    if a.validate(amount) {",
    "        a.Balance += amount",
    "        initLogger()",
    "        return true",
    "    }",
    "    return false",
    "}",
    "",
    "func (a *Account) validate(amount float64) bool {",
    "    return amount > 0",
    "}",
    "",
    "func ProcessAccount(a *Account, amount float64) bool {",
    "    initLogger()",
    "    return a.Deposit(amount)",
    "}"
].join("\n");

const analysis = analyzeGo(goSource, "main.go");

// Check imports (both single and grouped)
assert.deepEqual(analysis.imports, ["fmt", "os", "strings"]);
const importRels = analysis.relationships.filter((r) => r.type === "imports");
assert.equal(importRels.length, 3);
assert.deepEqual(importRels[0], { type: "imports", from: "file", to: "fmt" });
assert.deepEqual(importRels[1], { type: "imports", from: "file", to: "os" });
assert.deepEqual(importRels[2], { type: "imports", from: "file", to: "strings" });

// Check top-level functions
const funcNames = analysis.functions.map((f) => f.name);
assert.deepEqual(funcNames, ["initLogger", "ProcessAccount"]);
assert.deepEqual(analysis.functions[0].parameters, []);
assert.deepEqual(analysis.functions[1].parameters, ["a", "amount"]);

// Check structs and receiver methods
assert.equal(analysis.classes.length, 1);
const accountClass = analysis.classes[0];
assert.equal(accountClass.name, "Account");
const methodNames = accountClass.methods.map((m) => m.name);
assert.deepEqual(methodNames, ["Deposit", "validate"]);
assert.deepEqual(accountClass.methods[0].parameters, ["amount"]);
assert.deepEqual(accountClass.methods[1].parameters, ["amount"]);

// Check calls and call sites
const callRels = analysis.relationships.filter((r) => r.type === "calls");

// 1) Receiver method calls another receiver method on same struct: a.validate(amount)
const depositCallsValidate = callRels.find(
    (r) => r.from === "Account.Deposit" && r.to === "Account.validate"
);
assert.ok(depositCallsValidate, "Deposit should call Account.validate");
assert.equal(depositCallsValidate.callSites?.length, 1);
const validateSite = depositCallsValidate.callSites[0];
assert.equal(validateSite.file, "main.go");
assert.equal(validateSite.startLine, 19);
assert.equal(validateSite.expression, "a.validate(amount)");

// 2) Receiver method calls top-level function: initLogger()
const depositCallsInit = callRels.find(
    (r) => r.from === "Account.Deposit" && r.to === "initLogger"
);
assert.ok(depositCallsInit, "Deposit should call initLogger");

// 3) Top-level function calls top-level function: initLogger()
const processCallsInit = callRels.find(
    (r) => r.from === "ProcessAccount" && r.to === "initLogger"
);
assert.ok(processCallsInit, "ProcessAccount should call initLogger");

// 4) Top-level function calls receiver method: a.Deposit(amount)
const processCallsDeposit = callRels.find(
    (r) => r.from === "ProcessAccount" && r.to === "Account.Deposit"
);
assert.ok(processCallsDeposit, "ProcessAccount should call Account.Deposit");

// Check declaration extraction
const declarations = extractGoDeclarations(goSource, "main.go");
assert.equal(declarations.length, 5); // 1 struct (class) + 2 functions + 2 methods
const declNames = declarations.map((d) => `${d.type}:${d.name}`);
assert.ok(declNames.includes("class:Account"));
assert.ok(declNames.includes("function:initLogger"));
assert.ok(declNames.includes("method:Account.Deposit"));
assert.ok(declNames.includes("method:Account.validate"));
assert.ok(declNames.includes("function:ProcessAccount"));

const structDecl = declarations.find((d) => d.name === "Account");
assert.equal(structDecl?.type, "class");
assert.ok(structDecl?.source.includes("type Account struct"));

// 3. Routing via registry helpers
const routedAnalysis = analyzeSource(goSource, "main.go");
assert.equal(routedAnalysis.classes.length, 1);
assert.equal(routedAnalysis.functions.length, 2);

const routedDeclarations = extractDeclarationsForPath(goSource, "main.go");
assert.equal(routedDeclarations.length, 5);

// 4. Edge Cases: Empty file
const emptyAnalysis = analyzeGo("", "empty.go");
assert.deepEqual(emptyAnalysis, {
    imports: [],
    classes: [],
    functions: [],
    variables: [],
    relationships: []
});
assert.deepEqual(extractGoDeclarations("", "empty.go"), []);

const whitespaceAnalysis = analyzeGo("   \n\n// comment\n   ", "whitespace.go");
assert.deepEqual(whitespaceAnalysis, {
    imports: [],
    classes: [],
    functions: [],
    variables: [],
    relationships: []
});
assert.deepEqual(extractGoDeclarations("   \n\n// comment\n   ", "whitespace.go"), []);

// 5. Edge Cases: Imports-only file
const importsOnlySource = [
    "package main",
    "",
    "import (",
    "    \"fmt\"",
    "    \"os\"",
    ")"
].join("\n");

const importsOnlyAnalysis = analyzeGo(importsOnlySource, "imports.go");
assert.deepEqual(importsOnlyAnalysis.imports, ["fmt", "os"]);
assert.deepEqual(importsOnlyAnalysis.classes, []);
assert.deepEqual(importsOnlyAnalysis.functions, []);
assert.equal(importsOnlyAnalysis.relationships.length, 2);
assert.deepEqual(extractGoDeclarations(importsOnlySource, "imports.go"), []);

// 6. Edge Cases: File with only a struct and no functions
const structOnlySource = [
    "package models",
    "",
    "type User struct {",
    "    ID    int64",
    "    Email string",
    "}"
].join("\n");

const structOnlyAnalysis = analyzeGo(structOnlySource, "models.go");
assert.equal(structOnlyAnalysis.classes.length, 1);
assert.equal(structOnlyAnalysis.classes[0].name, "User");
assert.deepEqual(structOnlyAnalysis.classes[0].methods, []);
assert.deepEqual(structOnlyAnalysis.functions, []);
assert.equal(structOnlyAnalysis.relationships.length, 0);

const structOnlyDecls = extractGoDeclarations(structOnlySource, "models.go");
assert.equal(structOnlyDecls.length, 1);
assert.equal(structOnlyDecls[0].name, "User");
assert.equal(structOnlyDecls[0].type, "class");

console.log("Go analyzer tests passed successfully");
