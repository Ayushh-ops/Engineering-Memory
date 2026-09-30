import assert from "node:assert/strict";
import { analyzePython, extractPythonDeclarations, pythonAnalyzer } from "./python";
import { getAnalyzerForPath, analyzeSource, extractDeclarationsForPath } from "./registry";

// 1. Registry integration check
assert.equal(getAnalyzerForPath("server.py")?.id, "python");
assert.equal(getAnalyzerForPath("gui.pyw")?.id, "python");
assert.equal(getAnalyzerForPath("SRC/SCRIPT.PY")?.id, "python");
assert.equal(pythonAnalyzer.supportsSource("test.py"), true);
assert.equal(pythonAnalyzer.supportsSource("test.js"), false);

// 2. Class with methods, top-level functions, both import styles, same-scope calls
const pythonSource = [
    "import os",
    "import sys, json",
    "from math import sqrt",
    "from . import config",
    "from .models import BaseUser",
    "from ..utils import format_name",
    "from .. import database",
    "",
    "DEFAULT_TIMEOUT = 30",
    "MAX_RETRIES: int = 3",
    "",
    "def helper_log(message: str):",
    "    return message",
    "",
    "def calculate_tax(amount, rate=0.05):",
    "    helper_log('calculating tax')",
    "    return amount * rate",
    "",
    "class UserAccount(BaseUser):",
    "    def __init__(self, username: str, balance: float = 0.0):",
    "        self.username = username",
    "        self.balance = balance",
    "",
    "    def deposit(self, amount):",
    "        self.balance += amount",
    "        helper_log('deposited')",
    "        return self.balance",
    "",
    "    def reset(self):",
    "        self.deposit(-self.balance)",
    "        return 0"
].join("\n");

const analysis = analyzePython(pythonSource, "app.py");

// Check imports (both absolute and relative)
assert.deepEqual(analysis.imports, [
    "os",
    "sys",
    "json",
    "math",
    "./config",
    "./models",
    "../utils",
    "../database"
]);

const importRelationships = analysis.relationships.filter((r) => r.type === "imports");
assert.equal(importRelationships.length, 8);
assert.ok(importRelationships.some((r) => r.from === "file" && r.to === "os"));
assert.ok(importRelationships.some((r) => r.from === "file" && r.to === "math"));
assert.ok(importRelationships.some((r) => r.from === "file" && r.to === "./config"));
assert.ok(importRelationships.some((r) => r.from === "file" && r.to === "./models"));
assert.ok(importRelationships.some((r) => r.from === "file" && r.to === "../utils"));
assert.ok(importRelationships.some((r) => r.from === "file" && r.to === "../database"));

// Check variables
assert.ok(analysis.variables.includes("DEFAULT_TIMEOUT"));
assert.ok(analysis.variables.includes("MAX_RETRIES"));

// Check top-level functions
assert.equal(analysis.functions.length, 2);
const helperFn = analysis.functions.find((f) => f.name === "helper_log");
assert.ok(helperFn);
assert.deepEqual(helperFn.parameters, ["message"]);

const calcFn = analysis.functions.find((f) => f.name === "calculate_tax");
assert.ok(calcFn);
assert.deepEqual(calcFn.parameters, ["amount", "rate"]);

// Check classes and methods
assert.equal(analysis.classes.length, 1);
const accountClass = analysis.classes[0];
assert.equal(accountClass.name, "UserAccount");
assert.equal(accountClass.methods.length, 3);
assert.deepEqual(
    accountClass.methods.map((m) => m.name),
    ["__init__", "deposit", "reset"]
);
assert.deepEqual(accountClass.methods[0].parameters, ["self", "username", "balance"]);
assert.deepEqual(accountClass.methods[1].parameters, ["self", "amount"]);
assert.deepEqual(accountClass.methods[2].parameters, ["self"]);

// Check same-scope calls and call sites
const callRelationships = analysis.relationships.filter((r) => r.type === "calls");

// 1) Top-level function calling top-level function
const calcCallsHelper = callRelationships.find(
    (r) => r.from === "calculate_tax" && r.to === "helper_log"
);
assert.ok(calcCallsHelper, "calculate_tax should call helper_log");
assert.equal(calcCallsHelper.callSites?.length, 1);
const calcSite = calcCallsHelper.callSites[0];
assert.equal(calcSite.file, "app.py");
assert.equal(calcSite.startLine, 16);
assert.ok(calcSite.expression.includes("helper_log('calculating tax')"));

// 2) Method calling top-level function
const depositCallsHelper = callRelationships.find(
    (r) => r.from === "UserAccount.deposit" && r.to === "helper_log"
);
assert.ok(depositCallsHelper, "UserAccount.deposit should call helper_log");

// 3) Method calling another method in the same class
const resetCallsDeposit = callRelationships.find(
    (r) => r.from === "UserAccount.reset" && r.to === "UserAccount.deposit"
);
assert.ok(resetCallsDeposit, "UserAccount.reset should call UserAccount.deposit");
assert.equal(resetCallsDeposit.callSites?.length, 1);
assert.ok(resetCallsDeposit.callSites[0].expression.includes("self.deposit("));

// Check declarations extraction
const declarations = extractPythonDeclarations(pythonSource, "app.py");
assert.equal(declarations.length, 6); // 1 class + 3 methods + 2 functions
const declNames = declarations.map((d) => `${d.type}:${d.name}`);
assert.ok(declNames.includes("class:UserAccount"));
assert.ok(declNames.includes("method:UserAccount.__init__"));
assert.ok(declNames.includes("method:UserAccount.deposit"));
assert.ok(declNames.includes("method:UserAccount.reset"));
assert.ok(declNames.includes("function:helper_log"));
assert.ok(declNames.includes("function:calculate_tax"));

const classDecl = declarations.find((d) => d.name === "UserAccount");
assert.equal(classDecl?.type, "class");
assert.equal(classDecl?.startLine, 19);
assert.equal(classDecl?.endLine, 31);
assert.ok(classDecl?.source.startsWith("class UserAccount(BaseUser):"));

// 3. Routing via registry helpers
const routedAnalysis = analyzeSource(pythonSource, "app.py");
assert.equal(routedAnalysis.classes.length, 1);
assert.equal(routedAnalysis.functions.length, 2);

const routedDeclarations = extractDeclarationsForPath(pythonSource, "app.py");
assert.equal(routedDeclarations.length, 6);

// 4. Edge Cases: Empty file
const emptyAnalysis = analyzePython("", "empty.py");
assert.deepEqual(emptyAnalysis, {
    imports: [],
    classes: [],
    functions: [],
    variables: [],
    relationships: []
});
assert.deepEqual(extractPythonDeclarations("", "empty.py"), []);

const whitespaceAnalysis = analyzePython("   \n\n# only comments\n   ", "whitespace.py");
assert.deepEqual(whitespaceAnalysis, {
    imports: [],
    classes: [],
    functions: [],
    variables: [],
    relationships: []
});
assert.deepEqual(extractPythonDeclarations("   \n\n# only comments\n   ", "whitespace.py"), []);

// 5. Edge Cases: File with only imports and comments (no functions/classes)
const onlyImportsSource = [
    "# File header comment",
    "import logging",
    "from pathlib import Path",
    "from .settings import DEBUG",
    "# End of imports"
].join("\n");

const onlyImportsAnalysis = analyzePython(onlyImportsSource, "config.py");
assert.deepEqual(onlyImportsAnalysis.imports, ["logging", "pathlib", "./settings"]);
assert.deepEqual(onlyImportsAnalysis.classes, []);
assert.deepEqual(onlyImportsAnalysis.functions, []);
assert.deepEqual(onlyImportsAnalysis.variables, []);
assert.equal(onlyImportsAnalysis.relationships.length, 3);
assert.deepEqual(extractPythonDeclarations(onlyImportsSource, "config.py"), []);

console.log("Python analyzer tests passed successfully");
