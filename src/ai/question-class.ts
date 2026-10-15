export type AnswerLength = "brief" | "standard" | "deep";
export type AnswerFormat = "prose" | "list" | "steps";

export interface QuestionClassification {
    length: AnswerLength;
    format: AnswerFormat;
    maxTokens: number;
    reasoningEffort: "low" | "medium";
    isGreetingOrThanks?: boolean;
    isMeta?: boolean;
    questionClass?: "greeting" | "meta" | "file";
}

export function isReasoningModelName(modelName?: string): boolean {
    if (!modelName) return false;
    return /openai\/gpt-oss-|deepseek-r|o1|o3/i.test(modelName);
}

export function isMetaQuestion(question: string): boolean {
    const raw = (question || "").trim();
    if (!raw) return false;
    const q = raw.toLowerCase().replace(/[!.,?]+$/, "").trim();

    // Do not trigger on questions that name a file, symbol or code
    // (e.g. "what can this function do", "explain this file", "help me fix auth.ts")
    const namesCodeOrSymbol =
        /\b(file|files|function|functions|method|methods|class|classes|symbol|symbols|code|variable|variables|component|components|module|modules|interface|interfaces|type|types|endpoint|endpoints|route|routes|service|services|import|imports|export|exports|test|tests|bug|bugs|error|errors|commit|commits)\b/i.test(q) ||
        /\.[a-zA-Z0-9]{1,4}\b/.test(q) ||
        q.includes("`");

    if (namesCodeOrSymbol) {
        return false;
    }

    // Exact single-word or short help triggers
    if (/^(help|help\s+me|madad|madad\s+karo)$/i.test(q)) {
        return true;
    }

    // Word-boundary patterns in English:
    // who are you, what can you do, what do you do, help me, how do you work, how to use
    const englishMeta = /\b(who\s+are\s+you|what\s+can\s+you\s+do|what\s+do\s+you\s+do|help\s+me|how\s+do\s+you\s+work|how\s+to\s+use|how\s+can\s+you\s+help|what\s+are\s+your\s+capabilities)\b/i;

    // Word-boundary patterns in Roman Hindi:
    // kya kr/kar sakte/sakta, kya kaam, kaun ho, kon ho, tum kya
    const hindiMeta = /\b(kya\s+(?:kya\s+)?(?:kr|kar)\s+(?:sakte|sakta|sakti|skte|skta|skti)|(?:kr|kar)\s+(?:sakte|sakta|sakti|skte|skta|skti)\s+ho|kya\s+kaam|(?:kaun|kon)\s+ho|tum\s+(?:kaun|kon)|tum\s+kya|aap\s+kya|aap\s+(?:kaun|kon)|kya\s+karte\s+ho|kya\s+krte\s+ho)\b|(?:\u0924\u0941\u092e|\u0906\u092a)\s*(?:\u0915\u094c\u0928|\u0915\u094d\u092f\u093e)/i;

    return englishMeta.test(q) || hindiMeta.test(q);
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
            isGreetingOrThanks: false,
            isMeta: false,
            questionClass: "file"
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
            isGreetingOrThanks: true,
            isMeta: false,
            questionClass: "greeting"
        };
    }

    // 3. Meta question
    const isMeta = isMetaQuestion(raw);
    if (isMeta && (!mode || mode === "auto")) {
        let maxTokens = 300;
        if (isReasoning) {
            maxTokens = Math.min(3200, maxTokens + 700);
        }
        return {
            length: "brief",
            format: "list",
            maxTokens,
            reasoningEffort: "low",
            isGreetingOrThanks: false,
            isMeta: true,
            questionClass: "meta"
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
        isGreetingOrThanks: isGreetingOrThanks && (!mode || mode === "auto"),
        isMeta: isMeta && (!mode || mode === "auto"),
        questionClass: (isGreetingOrThanks && (!mode || mode === "auto"))
            ? "greeting"
            : (isMeta && (!mode || mode === "auto"))
                ? "meta"
                : "file"
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
