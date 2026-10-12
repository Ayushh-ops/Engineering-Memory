export type AnswerLength = "brief" | "standard" | "deep";
export type AnswerFormat = "prose" | "list" | "steps";

export interface QuestionClassification {
    length: AnswerLength;
    format: AnswerFormat;
    maxTokens: number;
    reasoningEffort: "low" | "medium";
    isGreetingOrThanks?: boolean;
}

export function isReasoningModelName(modelName?: string): boolean {
    if (!modelName) return false;
    return /openai\/gpt-oss-|deepseek-r|o1|o3/i.test(modelName);
}

export function classifyQuestion(
    question: string,
    mode?: string,
    hasImages = false,
    modelName?: string
): QuestionClassification {
    const raw = (question || "").trim();
    const q = raw.toLowerCase();
    const cleanQ = q.replace(/[!.,?]+$/, "").trim();

    const isReasoning = isReasoningModelName(modelName);

    // 1. Empty question with images
    if (!raw && hasImages) {
        let maxTokens = 1600;
        if (isReasoning) {
            maxTokens = Math.min(3200, maxTokens + 700);
        }
        return {
            length: "standard",
            format: "prose",
            maxTokens,
            reasoningEffort: "low",
            isGreetingOrThanks: false
        };
    }

    // 2. Greeting or thanks only
    const greetingThanksRegex = /^(hi+|hello+|hey+|howdy|greetings|thanks?|thank\s+you|shukriya|shukriyaa|ok|okay|thx|ty|dhanyawad|dhanyavaad|namaste|namaskar)$/i;
    const isGreetingOrThanks = greetingThanksRegex.test(cleanQ);

    if (isGreetingOrThanks && (!mode || mode === "auto")) {
        let maxTokens = 200;
        if (isReasoning) {
            maxTokens = Math.min(3200, maxTokens + 700);
        }
        return {
            length: "brief",
            format: "prose",
            maxTokens,
            reasoningEffort: "low",
            isGreetingOrThanks: true
        };
    }

    // 2. Format detection
    const stepsRegex = /\b(steps?|how\s+do\s+i|kaise\s+karu|kaise\s+karein|how\s+to)\b/i;
    const listRegex = /\b(list|which\s+files|kaun\s+kaun|all|sab|compare)\b/i;
    const kitneHainRegex = /\bkitne\b.*\bhain?\b/i;

    let format: AnswerFormat = "prose";
    if (stepsRegex.test(q)) {
        format = "steps";
    } else if (listRegex.test(q) || kitneHainRegex.test(q)) {
        format = "list";
    }

    // 3. Deep detection
    const deepWordsRegex = /\b(explain|samjhao|samjha|describe|walk\s+me\s+through|why|kyun|kyu|how\s+does|how\s+do|kaise|compare|difference|versus|vs\.?|architecture|flow|design|review|risk|impact|in\s+detail|detail\s+mein|poora|vistar|step\s+by\s+step)\b/i;
    const questionMarksCount = (q.match(/\?/g) || []).length;
    const hasMultipleAsks = questionMarksCount >= 2 || /\b(and|aur)\b.*\?/i.test(q);

    const isDeep = deepWordsRegex.test(q) || q.length > 160 || hasMultipleAsks;

    // 4. Brief detection
    const briefWordsRegex = /\b(who|which|where|when|how\s+many|kaun|kitne|kitni|kahan|kab|kya\s+hai)\b/i;
    const yesNoRegex = /\b(is|does|can|has)\b/i;
    const kyaHaiRegex = /\bkya\b.*\bhai\b/i;

    const isBriefCandidate = briefWordsRegex.test(q) || yesNoRegex.test(q) || kyaHaiRegex.test(q);
    const isBrief = !isDeep && isBriefCandidate && q.length < 70;

    let length: AnswerLength = "standard";
    if (isDeep) {
        length = "deep";
    } else if (isBrief) {
        length = "brief";
    }

    // 5. Explicit modes override
    if (mode === "short") {
        length = "brief";
    } else if (mode === "detailed") {
        length = "deep";
    } else if (mode === "steps") {
        format = "steps";
        if (length === "brief") length = "standard";
    } else if (mode === "simple") {
        format = "prose";
        if (length === "brief") length = "standard";
    } else if (mode === "review") {
        format = format === "steps" ? "list" : "list";
        if (length === "brief") length = "standard";
    }

    // 6. maxTokens calculation
    let maxTokens = 1200;
    if (length === "brief") {
        maxTokens = 400;
    } else if (length === "deep") {
        maxTokens = 2400;
    }

    if (hasImages) {
        maxTokens = Math.max(maxTokens, 1600);
    }

    if (isReasoning) {
        maxTokens += 700;
    }
    maxTokens = Math.min(3200, maxTokens);

    const reasoningEffort: "low" | "medium" = length === "deep" ? "medium" : "low";

    return {
        length,
        format,
        maxTokens,
        reasoningEffort,
        isGreetingOrThanks: isGreetingOrThanks && (!mode || mode === "auto")
    };
}

export function classifyScope(question: string, hasRepoFacts = true): "file" | "dependents" | "repo" {
    const raw = question || "";

    // Ignore internal image instruction (the sentence containing the word repository is ignored)
    const sentences = raw.split(/(?<=[.!?])\s+|\r?\n+/);
    const filteredSentences = sentences.filter(s => {
        const lower = s.toLowerCase();
        if (lower.includes("attached image") && lower.includes("repository")) {
            return false;
        }
        return true;
    });
    const q = filteredSentences.join(" ").toLowerCase();

    // 1. Repo scope keywords (requires hasRepoFacts)
    const repoRegex = /\b(repo|repository|whole\s+project|poore\s+project|overall|project\s+level|repo\s+level|codebase|architecture|health|hotspot|most\s+risky\s+files|top\s+files)\b/i;
    if (hasRepoFacts && repoRegex.test(q)) {
        return "repo";
    }

    // 2. Dependents scope keywords
    const dependentsRegex = /\b(who\s+calls|who\s+uses|kaun\s+call|kaun\s+use|kitne\s+files|how\s+many\s+files|dependents?|depends?|impact|blast|what\s+breaks|kya\s+tutega|affected|uses\s+this|is\s+par\s+depend)\b/i;
    if (dependentsRegex.test(q)) {
        return "dependents";
    }

    // 3. Otherwise file scope
    return "file";
}
