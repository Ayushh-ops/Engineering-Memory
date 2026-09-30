import assert from "node:assert/strict";
import { analyzeJava, extractJavaDeclarations, javaAnalyzer } from "./java";
import { getAnalyzerForPath, analyzeSource, extractDeclarationsForPath } from "./registry";

// 1. Registry integration check
assert.equal(getAnalyzerForPath("OrderService.java")?.id, "java");
assert.equal(getAnalyzerForPath("src/main/java/App.JAVA")?.id, "java");
assert.equal(javaAnalyzer.supportsSource("Main.java"), true);
assert.equal(javaAnalyzer.supportsSource("Main.py"), false);
assert.equal(javaAnalyzer.supportsSource("Main.ts"), false);

// 2. Class with multiple methods, constructor, both import styles, and same-scope method calls
const javaSource = [
    "package com.example.service;",
    "",
    "import com.example.models.User;",
    "import com.example.utils.*;",
    "",
    "public class OrderService {",
    "    private final String serviceId;",
    "    private int orderCount = 0;",
    "",
    "    public OrderService(String serviceId) {",
    "        this.serviceId = serviceId;",
    "        initLogger();",
    "    }",
    "",
    "    public void initLogger() {",
    "        System.out.println(\"logger init\");",
    "    }",
    "",
    "    public boolean processOrder(String orderId, double amount) {",
    "        if (validateOrder(orderId)) {",
    "            this.orderCount++;",
    "            initLogger();",
    "            return true;",
    "        }",
    "        return false;",
    "    }",
    "",
    "    private boolean validateOrder(String orderId) {",
    "        return orderId != null && !orderId.isEmpty();",
    "    }",
    "}"
].join("\n");

const analysis = analyzeJava(javaSource, "OrderService.java");

// Check imports (single class and wildcard)
assert.deepEqual(analysis.imports, [
    "com.example.models.User",
    "com.example.utils.*"
]);

const importRels = analysis.relationships.filter((r) => r.type === "imports");
assert.equal(importRels.length, 2);
assert.deepEqual(importRels[0], {
    type: "imports",
    from: "file",
    to: "com.example.models.User"
});
assert.deepEqual(importRels[1], {
    type: "imports",
    from: "file",
    to: "com.example.utils.*"
});

// Check classes and methods (including constructor)
assert.equal(analysis.classes.length, 1);
const orderClass = analysis.classes[0];
assert.equal(orderClass.name, "OrderService");

const methodNames = orderClass.methods.map((m) => m.name);
assert.deepEqual(methodNames, ["OrderService", "initLogger", "processOrder", "validateOrder"]);

// Check parameters
const constructorMethod = orderClass.methods.find((m) => m.name === "OrderService");
assert.ok(constructorMethod);
assert.deepEqual(constructorMethod.parameters, ["serviceId"]);

const processMethod = orderClass.methods.find((m) => m.name === "processOrder");
assert.ok(processMethod);
assert.deepEqual(processMethod.parameters, ["orderId", "amount"]);

const validateMethod = orderClass.methods.find((m) => m.name === "validateOrder");
assert.ok(validateMethod);
assert.deepEqual(validateMethod.parameters, ["orderId"]);

// Check same-scope method calls and call sites
const callRels = analysis.relationships.filter((r) => r.type === "calls");

// 1) Constructor calls initLogger()
const ctorCallsInit = callRels.find(
    (r) => r.from === "OrderService.OrderService" && r.to === "OrderService.initLogger"
);
assert.ok(ctorCallsInit, "Constructor should call initLogger");
assert.equal(ctorCallsInit.callSites?.length, 1);
const ctorSite = ctorCallsInit.callSites[0];
assert.equal(ctorSite.file, "OrderService.java");
assert.equal(ctorSite.startLine, 12);
assert.equal(ctorSite.expression, "initLogger()");

// 2) processOrder calls validateOrder()
const processCallsValidate = callRels.find(
    (r) => r.from === "OrderService.processOrder" && r.to === "OrderService.validateOrder"
);
assert.ok(processCallsValidate, "processOrder should call validateOrder");
assert.equal(processCallsValidate.callSites?.length, 1);
const validateSite = processCallsValidate.callSites[0];
assert.equal(validateSite.file, "OrderService.java");
assert.equal(validateSite.startLine, 20);
assert.equal(validateSite.expression, "validateOrder(orderId)");

// 3) processOrder calls initLogger()
const processCallsInit = callRels.find(
    (r) => r.from === "OrderService.processOrder" && r.to === "OrderService.initLogger"
);
assert.ok(processCallsInit, "processOrder should call initLogger");

// Check declaration extraction
const declarations = extractJavaDeclarations(javaSource, "OrderService.java");
assert.equal(declarations.length, 5); // 1 class + 4 methods (including constructor)

const declNames = declarations.map((d) => `${d.type}:${d.name}`);
assert.ok(declNames.includes("class:OrderService"));
assert.ok(declNames.includes("method:OrderService.OrderService"));
assert.ok(declNames.includes("method:OrderService.initLogger"));
assert.ok(declNames.includes("method:OrderService.processOrder"));
assert.ok(declNames.includes("method:OrderService.validateOrder"));

const classDecl = declarations.find((d) => d.name === "OrderService");
assert.equal(classDecl?.type, "class");
assert.ok(classDecl?.source.includes("public class OrderService"));

// 3. Routing via registry helpers
const routedAnalysis = analyzeSource(javaSource, "OrderService.java");
assert.equal(routedAnalysis.classes.length, 1);
assert.equal(routedAnalysis.classes[0].methods.length, 4);

const routedDeclarations = extractDeclarationsForPath(javaSource, "OrderService.java");
assert.equal(routedDeclarations.length, 5);

// 4. Edge Cases: Empty file
const emptyAnalysis = analyzeJava("", "Empty.java");
assert.deepEqual(emptyAnalysis, {
    imports: [],
    classes: [],
    functions: [],
    variables: [],
    relationships: []
});
assert.deepEqual(extractJavaDeclarations("", "Empty.java"), []);

const whitespaceAnalysis = analyzeJava("   \n\n// comment\n   ", "Whitespace.java");
assert.deepEqual(whitespaceAnalysis, {
    imports: [],
    classes: [],
    functions: [],
    variables: [],
    relationships: []
});
assert.deepEqual(extractJavaDeclarations("   \n\n// comment\n   ", "Whitespace.java"), []);

// 5. Edge Cases: Interface-only file
const interfaceSource = [
    "package com.example.repo;",
    "",
    "import java.util.List;",
    "",
    "public interface CrudRepository<T> {",
    "    T findById(String id);",
    "    void save(T item);",
    "    default boolean exists(String id) {",
    "        return findById(id) != null;",
    "    }",
    "}"
].join("\n");

const interfaceAnalysis = analyzeJava(interfaceSource, "CrudRepository.java");
assert.equal(interfaceAnalysis.classes.length, 1);
const iface = interfaceAnalysis.classes[0];
assert.equal(iface.name, "CrudRepository");
assert.deepEqual(
    iface.methods.map((m) => m.name),
    ["findById", "save", "exists"]
);
assert.deepEqual(iface.methods[0].parameters, ["id"]);
assert.deepEqual(iface.methods[1].parameters, ["item"]);
assert.deepEqual(iface.methods[2].parameters, ["id"]);

// Interface default method call to another interface method
const ifaceCalls = interfaceAnalysis.relationships.filter((r) => r.type === "calls");
const existsCallsFind = ifaceCalls.find(
    (r) => r.from === "CrudRepository.exists" && r.to === "CrudRepository.findById"
);
assert.ok(existsCallsFind, "exists default method should call findById");

const ifaceDecls = extractJavaDeclarations(interfaceSource, "CrudRepository.java");
assert.equal(ifaceDecls.length, 4); // 1 interface + 3 methods

// 6. Edge Cases: File with no methods (class with only static constants)
const noMethodsSource = [
    "package com.example.constants;",
    "",
    "public class AppConstants {",
    "    public static final String APP_NAME = \"EngineeringMemory\";",
    "    public static final int MAX_USERS = 500;",
    "}"
].join("\n");

const noMethodsAnalysis = analyzeJava(noMethodsSource, "AppConstants.java");
assert.equal(noMethodsAnalysis.classes.length, 1);
assert.equal(noMethodsAnalysis.classes[0].name, "AppConstants");
assert.deepEqual(noMethodsAnalysis.classes[0].methods, []);
assert.equal(noMethodsAnalysis.relationships.length, 0);

const noMethodsDecls = extractJavaDeclarations(noMethodsSource, "AppConstants.java");
assert.equal(noMethodsDecls.length, 1);
assert.equal(noMethodsDecls[0].name, "AppConstants");
assert.equal(noMethodsDecls[0].type, "class");

console.log("Java analyzer tests passed successfully");
