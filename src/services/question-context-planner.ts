import type { RepositoryContextTarget } from "../graph/repository-context";

export type QuestionIntent =
    | "source"
    | "callers"
    | "callees"
    | "dependencies"
    | "history"
    | "related-files"
    | "impact"
    | "general";

export type QuestionContextType =
    | "source"
    | "callers"
    | "callees"
    | "imports"
    | "history"
    | "related-files"
    | "impact";

export interface QuestionContextPlan {
    intent: QuestionIntent;
    prioritizedContextTypes: QuestionContextType[];
    target: RepositoryContextTarget;
}

const balancedPriority: QuestionContextType[] = [
    "source",
    "related-files",
    "imports",
    "callers",
    "callees",
    "history"
];

const signals: Array<{
    contexts: QuestionContextType[];
    weight: number;
    patterns: Array<string | RegExp>;
}> = [
    {
        contexts: ["impact"],
        weight: 5,
        patterns: [
            "if i remove this",
            "what will be affected",
            "what could be impacted",
            "what should i check before refactoring",
            "what should i review before changing",
            "is it safe to remove",
            "what could break if i remove",
            "what would break if i remove",
            /what could break if i remove/
        ]
    },
    {
        contexts: ["callers"],
        weight: 3,
        patterns: [
            "who calls",
            "who are the callers",
            "called by",
            "who uses",
            "where is this used",
            "where is this function used",
            /where is .* used/,
            "usages",
            "references",
            "what depends on this",
            "what uses this"
        ]
    },
    {
        contexts: ["callers"],
        weight: 4,
        patterns: ["if i remove this", "if this is removed", "what else could stop working", /what would break if i remove/]
    },
    {
        contexts: ["imports"],
        weight: 3,
        patterns: ["if i remove this", "if this is removed", "what else could stop working", /what would break if i remove/]
    },
    {
        contexts: ["callees"],
        weight: 2,
        patterns: ["if i remove this", "if this is removed", "what else could stop working", /what would break if i remove/]
    },
    {
        contexts: ["source"],
        weight: 1,
        patterns: ["if i remove this", "if this is removed", "what else could stop working", /what would break if i remove/]
    },
    {
        contexts: ["callees"],
        weight: 3,
        patterns: [
            "what does this call",
            "what does this function call",
            "which functions does it invoke",
            "what does this method invoke",
            /what does .* call/
        ]
    },
    {
        contexts: ["callees", "source"],
        weight: 2,
        patterns: ["what happens inside this function", "what happens inside this method"]
    },
    {
        contexts: ["source"],
        weight: 2,
        patterns: [
            "how does this work",
            "how does this function work",
            /how does .* work/,
            "how is this implemented",
            "walk me through this",
            "what does this do",
            "what happens here"
        ]
    },
    {
        contexts: ["imports"],
        weight: 3,
        patterns: [
            "what does this depend on",
            "what does this use",
            "where does this come from",
            /where does .* come from/,
            "which modules are needed",
            "which files does this depend on",
            "imports",
            "dependencies",
            "required modules"
        ]
    },
    {
        contexts: ["history"],
        weight: 3,
        patterns: [
            "why was this changed",
            "when was this changed",
            /why was .* changed/,
            /when was .* changed/,
            /who changed .*/,
            "what changed",
            "who changed this",
            "when was this introduced",
            "previous version",
            "before and after",
            "history",
            "commits",
            "evolution"
        ]
    },
    {
        contexts: ["related-files"],
        weight: 3,
        patterns: [
            "which files are related",
            "what files are around this",
            "where else should i look",
            "repository structure",
            "file structure",
            "related files",
            "surrounding code"
        ]
    }
];

const intentByContext: Record<QuestionContextType, QuestionIntent> = {
    source: "source",
    callers: "callers",
    callees: "callees",
    imports: "dependencies",
    history: "history",
    "related-files": "related-files",
    impact: "impact"
};

function normalizeQuestion(question: string): string {
    return question.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function scoreContexts(question: string): Map<QuestionContextType, number> {
    const scores = new Map<QuestionContextType, number>();
    for (const signal of signals) {
        if (!signal.patterns.some((pattern) => typeof pattern === "string"
            ? question.includes(pattern)
            : pattern.test(question))) continue;
        for (const context of signal.contexts) {
            scores.set(context, (scores.get(context) ?? 0) + signal.weight);
        }
    }
    return scores;
}

function prioritize(scores: Map<QuestionContextType, number>): QuestionContextType[] {
    const priority = balancedPriority
        .map((context, index) => ({ context, index, score: scores.get(context) ?? 0 }))
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .map(({ context }) => context);
    return (scores.get("impact") ?? 0) > 0 ? ["impact", ...priority] : priority;
}

function detectIntent(prioritizedContextTypes: QuestionContextType[], scores: Map<QuestionContextType, number>): QuestionIntent {
    const strongestContext = prioritizedContextTypes[0];
    return strongestContext && (scores.get(strongestContext) ?? 0) > 0
        ? intentByContext[strongestContext]
        : "general";
}

function emptyOrWhitespace(question: string): boolean {
    return question.trim().length === 0;
}

export class QuestionContextPlanner {
    plan(question: string, target: RepositoryContextTarget): QuestionContextPlan {
        const normalizedQuestion = normalizeQuestion(question);
        const scores = emptyOrWhitespace(question) ? new Map() : scoreContexts(normalizedQuestion);
        const prioritizedContextTypes = prioritize(scores);
        return {
            intent: detectIntent(prioritizedContextTypes, scores),
            prioritizedContextTypes,
            target
        };
    }
}