import assert from "node:assert/strict";
import { QuestionContextPlanner } from "./question-context-planner";

const planner = new QuestionContextPlanner();
const target = {
    type: "symbol" as const,
    symbol: { type: "function" as const, path: "src/auth.ts", name: "login" }
};

function priorities(question: string): string[] {
    return planner.plan(question, target).prioritizedContextTypes;
}

assert.deepEqual(priorities("Who are the callers of login()?"), ["callers", "source", "related-files", "imports", "callees", "history"]);
assert.deepEqual(priorities("Where is the login function being used?"), ["callers", "source", "related-files", "imports", "callees", "history"]);
assert.deepEqual(priorities("What would break if I remove this?"), ["impact", "callers", "imports", "callees", "source", "related-files", "history"]);
assert.deepEqual(priorities("What does this function call?"), ["callees", "source", "related-files", "imports", "callers", "history"]);
assert.deepEqual(priorities("How does this login code actually work?"), ["source", "related-files", "imports", "callers", "callees", "history"]);
assert.deepEqual(priorities("Where does this database thing come from?"), ["imports", "source", "related-files", "callers", "callees", "history"]);
assert.deepEqual(priorities("Why was this code changed?"), ["history", "source", "related-files", "imports", "callers", "callees"]);
assert.deepEqual(priorities("Which files are related to this?"), ["related-files", "source", "imports", "callers", "callees", "history"]);
assert.deepEqual(priorities("What should I check before refactoring this?"), ["impact", "source", "related-files", "imports", "callers", "callees", "history"]);
assert.deepEqual(priorities("Is it safe to remove this?"), ["impact", "source", "related-files", "imports", "callers", "callees", "history"]);

const ambiguous = planner.plan("Tell me about this login code.", target);
assert.equal(ambiguous.intent, "general");
assert.deepEqual(ambiguous.prioritizedContextTypes, ["source", "related-files", "imports", "callers", "callees", "history"]);
assert.deepEqual(priorities("How does login work and what does it call?"), ["callees", "source", "related-files", "imports", "callers", "history"]);
assert.deepEqual(priorities("WHAT DOES THIS FUNCTION CALL?"), priorities("what does this function call?"));

const empty = planner.plan("  \t", target);
assert.equal(empty.intent, "general");
assert.deepEqual(empty.target, target);
assert.deepEqual(empty.prioritizedContextTypes, ["source", "related-files", "imports", "callers", "callees", "history"]);
assert.equal(typeof planner.plan, "function");

console.log("question context planner fixtures passed");