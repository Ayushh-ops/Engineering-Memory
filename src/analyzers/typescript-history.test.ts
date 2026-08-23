import assert from "node:assert/strict";
import { analyzeHistoricalTypeScriptChange } from "./typescript-history";

function changes(parent: string | null, current: string | null) {
    const result = analyzeHistoricalTypeScriptChange("src/example.ts", parent, current);
    assert.equal(result.applicable, true);
    return result.changes;
}

assert.deepEqual(changes("", "function added() {}"), [{ type: "added", symbolType: "function", name: "added" }]);
assert.deepEqual(changes("function removed() {}", ""), [{ type: "removed", symbolType: "function", name: "removed" }]);
assert.deepEqual(changes("function changed() { return 1; }", "function changed() { return 2; }"), [{ type: "modified", symbolType: "function", name: "changed" }]);
assert.deepEqual(changes("class Account {}", "class Account { open() {} }"), [
    { type: "modified", symbolType: "class", name: "Account" },
    { type: "added", symbolType: "method", name: "Account.open" }
]);
assert.deepEqual(changes("class Account { close() {} }", "class Account {}"), [
    { type: "modified", symbolType: "class", name: "Account" },
    { type: "removed", symbolType: "method", name: "Account.close" }
]);
assert.deepEqual(changes("class Account { open() { return 1; } }", "class Account { open() { return 2; } }"), [
    { type: "modified", symbolType: "class", name: "Account" },
    { type: "modified", symbolType: "method", name: "Account.open" }
]);
assert.deepEqual(changes("", "class Added {}"), [{ type: "added", symbolType: "class", name: "Added" }]);
assert.deepEqual(changes("class Removed {}", ""), [{ type: "removed", symbolType: "class", name: "Removed" }]);
assert.deepEqual(changes("function unchanged() {}\nconst value = 1;", "function unchanged() {}\nconst value = 2;"), []);
assert.deepEqual(changes(null, "function initial() {}"), [{ type: "added", symbolType: "function", name: "initial" }]);
assert.deepEqual(changes(null, "class AddedFile {}"), [{ type: "added", symbolType: "class", name: "AddedFile" }]);
assert.deepEqual(changes("class RemovedFile {}", null), [{ type: "removed", symbolType: "class", name: "RemovedFile" }]);
assert.deepEqual(changes("function duplicate() {}\nfunction duplicate() {}", "function duplicate() {}"), []);
assert.deepEqual(analyzeHistoricalTypeScriptChange("README.md", null, "# Documentation"), {
    path: "README.md",
    applicable: false,
    changes: [],
    reason: "Structural TypeScript diffing is only available for .ts and .tsx files."
});

console.log("historical TypeScript change fixtures passed");
