import assert from "node:assert/strict";
import {
    getAnalyzerForPath,
    analyzeSource,
    extractDeclarationsForPath,
    registry,
    typescriptAnalyzer,
    LanguageAnalyzerRegistry
} from "./registry";
import type { LanguageAnalyzer } from "./types";

// 1. Analyzer lookup by file path / extension
assert.equal(getAnalyzerForPath("src/index.ts")?.id, "typescript");
assert.equal(getAnalyzerForPath("src/component.tsx")?.id, "typescript");
assert.equal(getAnalyzerForPath("src/utils.js")?.id, "typescript");
assert.equal(getAnalyzerForPath("src/view.jsx")?.id, "typescript");
assert.equal(getAnalyzerForPath("src/config.mjs")?.id, "typescript");
assert.equal(getAnalyzerForPath("src/script.cjs")?.id, "typescript");
assert.equal(getAnalyzerForPath("SRC/UPPERCASE.TS")?.id, "typescript");
assert.equal(getAnalyzerForPath("SRC/UPPERCASE.JSX")?.id, "typescript");

assert.equal(getAnalyzerForPath("main.py")?.id, "python");
assert.equal(getAnalyzerForPath("Main.java")?.id, "java");
assert.equal(getAnalyzerForPath("server.go")?.id, "go");

// Unsupported extensions return undefined
assert.equal(getAnalyzerForPath("script.rb"), undefined);
assert.equal(getAnalyzerForPath("README.md"), undefined);

// 2. Safe fallbacks for unsupported files
const unsupportedAnalysis = analyzeSource("def foo(): pass", "script.rb");
assert.deepEqual(unsupportedAnalysis, {
    imports: [],
    classes: [],
    functions: [],
    variables: [],
    relationships: []
});

const unsupportedDeclarations = extractDeclarationsForPath("def foo(): pass", "script.rb");
assert.deepEqual(unsupportedDeclarations, []);

// 3. TypeScript / JavaScript analysis via registry
const jsSource = [
    "import express from 'express';",
    "const port = 3000;",
    "const calculateTotal = (price, tax) => {",
    "    logOperation('calc');",
    "    return price + tax;",
    "};",
    "const formatName = function(first, last) {",
    "    return first + ' ' + last;",
    "};",
    "function standardFunc(x) {",
    "    calculateTotal(x, 10);",
    "}"
].join("\n");

const jsAnalysis = analyzeSource(jsSource, "app.js");
assert.deepEqual(jsAnalysis.imports, ["express"]);
assert.ok(jsAnalysis.variables.includes("port"));
assert.ok(jsAnalysis.variables.includes("calculateTotal"));
assert.ok(jsAnalysis.variables.includes("formatName"));

// Arrow function and function expression captured in functions
const calcFn = jsAnalysis.functions.find((f) => f.name === "calculateTotal");
assert.ok(calcFn, "calculateTotal should be in functions");
assert.deepEqual(calcFn.parameters, ["price", "tax"]);

const formatFn = jsAnalysis.functions.find((f) => f.name === "formatName");
assert.ok(formatFn, "formatName should be in functions");
assert.deepEqual(formatFn.parameters, ["first", "last"]);

const stdFn = jsAnalysis.functions.find((f) => f.name === "standardFunc");
assert.ok(stdFn, "standardFunc should be in functions");

// Call relationships inside arrow functions have correct containingCallable
const calcCallRel = jsAnalysis.relationships.find(
    (r) => r.type === "calls" && r.from === "calculateTotal" && r.to === "logOperation"
);
assert.ok(calcCallRel, "calculateTotal should call logOperation");
assert.equal(calcCallRel.callSites?.[0]?.file, "app.js");
assert.equal(calcCallRel.callSites?.[0]?.startLine, 4);

// Call relationship inside standard function
const stdCallRel = jsAnalysis.relationships.find(
    (r) => r.type === "calls" && r.from === "standardFunc" && r.to === "calculateTotal"
);
assert.ok(stdCallRel, "standardFunc should call calculateTotal");

// 4. JSX / TSX parsing via registry
const jsxSource = [
    "import React from 'react';",
    "export const Button = ({ label, onClick }) => {",
    "    handleClick();",
    "    return <button onClick={onClick}>{label}</button>;",
    "};"
].join("\n");

const jsxAnalysis = analyzeSource(jsxSource, "components/Button.jsx");
assert.deepEqual(jsxAnalysis.imports, ["react"]);
const buttonFn = jsxAnalysis.functions.find((f) => f.name === "Button");
assert.ok(buttonFn, "Button arrow component should be captured");
const btnCall = jsxAnalysis.relationships.find((r) => r.from === "Button" && r.to === "handleClick");
assert.ok(btnCall, "Button component should record calls");

// 5. Declaration extraction for arrow functions and standard declarations
const declarations = extractDeclarationsForPath(jsSource, "app.js");
const declNames = declarations.map((d) => `${d.type}:${d.name}`);
assert.ok(declNames.includes("function:calculateTotal"));
assert.ok(declNames.includes("function:formatName"));
assert.ok(declNames.includes("function:standardFunc"));

const calcDecl = declarations.find((d) => d.name === "calculateTotal");
assert.equal(calcDecl?.type, "function");
assert.equal(calcDecl?.startLine, 3);
assert.ok(calcDecl?.source.includes("const calculateTotal = (price, tax) =>"));

// 6. Custom analyzer registration and fallback when extractDeclarations is omitted
const customRegistry = new LanguageAnalyzerRegistry();
const mockRubyAnalyzer: LanguageAnalyzer = {
    id: "ruby",
    name: "Ruby",
    supportedExtensions: [".rb"],
    supportsSource(path: string): boolean {
        return path.endsWith(".rb");
    },
    analyze(_source: string, _path: string) {
        return {
            imports: ["json"],
            classes: [],
            functions: [{ name: "run", parameters: [] }],
            variables: [],
            relationships: []
        };
    }
};

customRegistry.register(mockRubyAnalyzer);
assert.equal(customRegistry.getAnalyzerForPath("script.rb")?.id, "ruby");
const rubyAnalysis = customRegistry.analyzeSource("def run; end", "script.rb");
assert.deepEqual(rubyAnalysis.imports, ["json"]);
assert.equal(rubyAnalysis.functions[0]?.name, "run");

// Omitted extractDeclarations returns [] safely
const rubyDecls = customRegistry.extractDeclarationsForPath("def run; end", "script.rb");
assert.deepEqual(rubyDecls, []);

// 7. Express-style route file analysis (CommonJS require + inline callback synthesized symbols)
const expressRouteSource = [
    "const express = require('express');",
    "const router = express.Router();",
    "const complaintsService = require('../services/complaints');",
    "router.get('/complaints', (req, res) => {",
    "    const list = complaintsService.getAll();",
    "    res.json(list);",
    "});",
    "router.post('/complaints', function(req, res) {",
    "    const created = complaintsService.create(req.body);",
    "    res.status(201).json(created);",
    "});",
    "module.exports = router;"
].join("\n");

const expressAnalysis = analyzeSource(expressRouteSource, "routes/complaints.js");

// Assert analysis.imports includes "express" and "../services/complaints"
assert.ok(expressAnalysis.imports.includes("express"), "imports should include 'express'");
assert.ok(expressAnalysis.imports.includes("../services/complaints"), "imports should include '../services/complaints'");

// Assert analysis.functions is non-empty (contains synthesized names for the two route callbacks)
assert.ok(expressAnalysis.functions.length >= 2, "functions should contain synthesized route callbacks");
const getHandler = expressAnalysis.functions.find((f) => f.name === "router.get#1@L4");
assert.ok(getHandler, "router.get#1@L4 should be synthesized for the get callback");
assert.deepEqual(getHandler.parameters, ["req", "res"]);

const postHandler = expressAnalysis.functions.find((f) => f.name === "router.post#1@L8");
assert.ok(postHandler, "router.post#1@L8 should be synthesized for the post callback");
assert.deepEqual(postHandler.parameters, ["req", "res"]);

// Assert analysis.relationships includes at least one "calls" relationship whose from matches synthesized callback name
const getCallRel = expressAnalysis.relationships.find(
    (r) => r.type === "calls" && r.from === "router.get#1@L4" && r.to === "complaintsService.getAll"
);
assert.ok(getCallRel, "router.get#1@L4 should call complaintsService.getAll");
assert.equal(getCallRel.callSites?.[0]?.file, "routes/complaints.js");

const postCallRel = expressAnalysis.relationships.find(
    (r) => r.type === "calls" && r.from === "router.post#1@L8" && r.to === "complaintsService.create"
);
assert.ok(postCallRel, "router.post#1@L8 should call complaintsService.create");

// Also verify declaration extraction for the synthesized callbacks
const expressDecls = extractDeclarationsForPath(expressRouteSource, "routes/complaints.js");
const expressDeclNames = expressDecls.map((d) => `${d.type}:${d.name}`);
assert.ok(expressDeclNames.includes("function:router.get#1@L4"), "declarations should include function:router.get#1@L4");
assert.ok(expressDeclNames.includes("function:router.post#1@L8"), "declarations should include function:router.post#1@L8");

// 8. Disambiguation of multiple callbacks for identical callee in the same file
const multiRouteSource = [
    "router.get('/complaints', (req, res) => {",
    "    complaintsService.getAll();",
    "});",
    "router.get('/complaints/:id', (req, res) => {",
    "    complaintsService.getById(req.params.id);",
    "});"
].join("\n");

const multiRouteAnalysis = analyzeSource(multiRouteSource, "routes/complaints.js");

// Assert both synthesized names are present and DIFFERENT from each other
assert.equal(multiRouteAnalysis.functions.length, 2);
const firstGet = multiRouteAnalysis.functions.find((f) => f.name === "router.get#1@L1");
const secondGet = multiRouteAnalysis.functions.find((f) => f.name === "router.get#1@L4");
assert.ok(firstGet, "router.get#1@L1 should be synthesized for the first router.get");
assert.ok(secondGet, "router.get#1@L4 should be synthesized for the second router.get");
assert.notEqual(firstGet?.name, secondGet?.name, "synthesized names must be different");

// Assert each callback's internal calls are attributed to ITS OWN synthesized name
const firstCall = multiRouteAnalysis.relationships.find(
    (r) => r.type === "calls" && r.from === "router.get#1@L1" && r.to === "complaintsService.getAll"
);
assert.ok(firstCall, "complaintsService.getAll must be attributed to router.get#1@L1");

const secondCall = multiRouteAnalysis.relationships.find(
    (r) => r.type === "calls" && r.from === "router.get#1@L4" && r.to === "complaintsService.getById"
);
assert.ok(secondCall, "complaintsService.getById must be attributed to router.get#1@L4");

// Verify declaration extraction also produces different names
const multiDecls = extractDeclarationsForPath(multiRouteSource, "routes/complaints.js");
const multiDeclNames = multiDecls.map((d) => d.name);
assert.ok(multiDeclNames.includes("router.get#1@L1"));
assert.ok(multiDeclNames.includes("router.get#1@L4"));

console.log("language analyzer registry and arrow-function capture tests passed");
