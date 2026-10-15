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

export type QuestionMode = "repo" | "chat" | "dev" | "offtopic";

export interface RouteQuestionInput {
    question: string;
    selectedFile?: string;
    repoFiles?: string[];
    symbols?: string[];
    history?: Array<{ role: string; content: string; mode?: QuestionMode }>;
}

export interface RouteQuestionResult {
    mode: QuestionMode;
    reason: string;
}

export function routeQuestion(input: RouteQuestionInput): RouteQuestionResult {
    const raw = (input.question || "").trim();
    const q = raw.toLowerCase();
    const cleanQ = q.replace(/[!.,?]+$/, "").trim();

    // Check if greeting or thanks (resets sticky history)
    const greetingThanksRegex = /^(hi+|hello+|hey+|howdy|greetings|good\s+(morning|afternoon|evening|day)|thanks?(\s+(a\s+lot|so\s+much|very\s+much))?|thank\s+you(\s+(so\s+much|very\s+much))?|many\s+thanks|(?:bahut\s+)?shukriyaa?|ok|okay|thx|ty|(?:bahut\s+)?dhanyawa?d|(?:bahut\s+)?dhanyava?d|namaste|namaskar|kya\s+haal|kaise\s+ho|kya\s+chal\s+raha\s+hai)$/i;
    const isGreetingOrThanks = greetingThanksRegex.test(cleanQ);

    // 1. REPO MODE
    // Condition 1a: Names an analyzed file path or basename (with or without extension)
    if (input.repoFiles && input.repoFiles.length > 0) {
        for (const filePath of input.repoFiles) {
            const fullPath = filePath.toLowerCase();
            const baseName = filePath.split(/[/\\]/).pop()?.toLowerCase();
            const baseNameNoExt = baseName ? baseName.replace(/\.[a-zA-Z0-9]+$/, "") : undefined;
            if (fullPath && q.includes(fullPath)) {
                return { mode: "repo", reason: "repo_named_file" };
            }
            if (baseName && baseName.length > 2) {
                const escaped = baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                const regex = new RegExp(`\\b${escaped}\\b`, "i");
                if (regex.test(q)) {
                    return { mode: "repo", reason: "repo_named_file" };
                }
            }
            if (baseNameNoExt && baseNameNoExt.length > 2) {
                const escaped = baseNameNoExt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                const regex = new RegExp(`\\b${escaped}\\b`, "i");
                if (regex.test(q)) {
                    return { mode: "repo", reason: "repo_named_file" };
                }
            }
        }
    }
    if (input.selectedFile) {
        const fullPath = input.selectedFile.toLowerCase();
        const baseName = input.selectedFile.split(/[/\\]/).pop()?.toLowerCase();
        const baseNameNoExt = baseName ? baseName.replace(/\.[a-zA-Z0-9]+$/, "") : undefined;
        if (fullPath && q.includes(fullPath)) {
            return { mode: "repo", reason: "repo_named_file" };
        }
        if (baseName && baseName.length > 2) {
            const escaped = baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const regex = new RegExp(`\\b${escaped}\\b`, "i");
            if (regex.test(q)) {
                return { mode: "repo", reason: "repo_named_file" };
            }
        }
        if (baseNameNoExt && baseNameNoExt.length > 2) {
            const escaped = baseNameNoExt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const regex = new RegExp(`\\b${escaped}\\b`, "i");
            if (regex.test(q)) {
                return { mode: "repo", reason: "repo_named_file" };
            }
        }
    }

    if (input.symbols && input.symbols.length > 0) {
        for (const sym of input.symbols) {
            if (sym && sym.length > 2) {
                const escaped = sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                const regex = new RegExp(`\\b${escaped}\\b`, "i");
                if (regex.test(q)) {
                    return { mode: "repo", reason: "repo_symbol" };
                }
            }
        }
    }

    // Condition 1b: Backticked symbol that exists in the repo
    const backtickMatches = q.match(/`([^`]+)`/g);
    if (backtickMatches && backtickMatches.length > 0) {
        const backtickedSymbols = backtickMatches.map(s => s.slice(1, -1).trim().toLowerCase());
        if (input.symbols && input.symbols.length > 0) {
            const symbolSet = new Set(input.symbols.map(s => s.toLowerCase()));
            if (backtickedSymbols.some(s => symbolSet.has(s))) {
                return { mode: "repo", reason: "repo_symbol" };
            }
        } else {
            return { mode: "repo", reason: "repo_symbol" };
        }
    }

    // Condition 1c: Deictic reference while a file is selected
    if (input.selectedFile) {
        const deicticTargetRegex = /\b(this|ye|yeh|is|iss|isko|iska|isme|isse|us)\s+(file|code|function|class|module|script|component)\b/i;
        const deicticVerbRegex1 = /\b(this|ye|yeh|is|iss|isko|iska|isme|isse|us)\b.*\b(kya\s+(?:krta|karta|krte|karte)|what\s+does|explain|samjhao|samjha|why|kyu|kyun)\b/i;
        const deicticVerbRegex2 = /\b(kya\s+(?:krta|karta|krte|karte)|what\s+does|explain|samjhao|samjha|why|kyu|kyun)\b.*\b(this|ye|yeh|is|iss|isko|iska|isme|isse|us)\b/i;
        const directExplainThis = /\b(explain\s+this|what\s+does\s+this\s+do|why\s+this|is\s+par\s+kya|isko\s+batao|is\s+file\s+ko\s+samjhao|ye\s+kya\s+(?:krta|karta))\b/i;

        const codeGeneralOnCurrentFile = /\b(why\s+is\s+this\s+slow|how\s+do\s+i\s+run\s+tests|run\s+(?:the\s+)?tests?|test\s+kaise\s+run\s+karein|slow\s+kyu\s+hai)\b/i;

        if (deicticTargetRegex.test(q) || deicticVerbRegex1.test(q) || deicticVerbRegex2.test(q) || directExplainThis.test(q) || codeGeneralOnCurrentFile.test(q)) {
            return { mode: "repo", reason: "repo_deictic" };
        }
    }

    // Condition 1d: Repo-analysis vocabulary (excluding "dependency graph", which belongs to dev)
    const isDependencyGraph = /\bdependency\s+graph\b/i.test(q);
    const isWhatIsRepo = /\bwhat\s+is\s+a\s+(?:git\s+)?repository\b/i.test(q);
    if (!isDependencyGraph && !isWhatIsRepo) {
        const repoVocabRegex = /\b(repo|repository|codebase|poore\s+project|whole\s+project|depend|depends|dependent|dependents|imported\s+by|callers?|blast\s+radius|impact|risk\s+score|hotspots?|bus\s+factor|plan\s+a\s+change|commit\s+history|owners?|circular\s+imports?|unused\s+files?|tests?\s+to\s+run|run\s+(?:the\s+)?tests?|files?\s+use\s+this)\b/i;
        if (repoVocabRegex.test(q)) {
            return { mode: "repo", reason: "repo_vocab" };
        }
    }

    // Condition 1e: Sticky continuation (<= 8 words with aur, phir, iska, uska, and, also, why, kyu, how, example) after repo answer
    if (!isGreetingOrThanks && Array.isArray(input.history) && input.history.length > 0) {
        const lastAssistant = [...input.history].reverse().find(m => m.role === "assistant");
        const lastMode = (lastAssistant as any)?.mode;
        const wasRepo = lastMode === "repo" || (lastMode === undefined && Boolean(input.selectedFile));
        if (wasRepo) {
            const wordCount = raw.split(/\s+/).filter(Boolean).length;
            if (wordCount <= 8) {
                const continuationRegex = /\b(aur|phir|iska|uska|and|also|why|kyu|kyun|how|example)\b/i;
                if (continuationRegex.test(q)) {
                    return { mode: "repo", reason: "repo_sticky" };
                }
            }
        }
    }

    // 2. CHAT MODE
    if (isGreetingOrThanks) {
        return { mode: "chat", reason: /thanks?|shukriya|dhanya/i.test(cleanQ) ? "chat_thanks" : "chat_greeting" };
    }
    if (isMetaQuestion(raw)) {
        return { mode: "chat", reason: "chat_meta" };
    }
    const jokeRegex = /\b(joke|jokes|chutkula|chutkule|mazaak|mazak|joke\s+sunao|tell\s+(?:me\s+)?a\s+joke|make\s+me\s+laugh|funny|kuch\s+funny|kuch\s+mazaak)\b/i;
    if (jokeRegex.test(q)) {
        return { mode: "chat", reason: "chat_joke" };
    }
    const banterRegex = /\b(how\s+are\s+you|how\s+are\s+u|kaise\s+ho|kya\s+haal|good\s+morning|good\s+night|bye|goodbye|alvida|tata)\b/i;
    if (banterRegex.test(q)) {
        return { mode: "chat", reason: "chat_banter" };
    }

    // 3. DEV MODE
    const devTechRegex = /\b(python|javascript|typescript|js|ts|java|c\+\+|cpp|c#|golang|go|rust|ruby|php|swift|kotlin|html|css|sql|bash|shell|git|rebase|merge|branch|commit|cherry-pick|pull\s+request|stash|checkout|npm|pnpm|yarn|pip|cargo|docker|kubernetes|k8s|linux|recursion|algorithm|binary\s+search|sorting|tree|graph|linked\s+list|stack|queue|hash\s*table|hash\s*map|tuple|tuples|list|lists|array|arrays|map|set|promise|async|await|closure|pointer|memory\s+leak|concurrency|multithreading|interface|polymorphism|inheritance|oop|design\s+pattern|dependency\s+graph|regex|regular\s+expression|rest|graphql|api|syntax|compiler|linter|error|bug|debugging)\b/i;

    if (devTechRegex.test(q) || isDependencyGraph || isWhatIsRepo) {
        return { mode: "dev", reason: "dev_question" };
    }

    // 4. OFFTOPIC MODE
    const offtopicRegex = /\b(recipe|recipes|biryani|cake|pizza|burger|pasta|curry|roti|dal|paneer|cooking|cook|ingredients|bake|baking|boil|chai|tea|coffee|movie|movies|film|films|cinema|actor|actress|bollywood|hollywood|song|songs|sing|singer|album|lyrics|plot\s+of|netflix|tv\s+show|series|politic|politics|political|election|elections|vote|voting|bjp|congress|democrat|republican|prime\s+minister|president|parliament|minister|cricket|football|soccer|tennis|badminton|ipl|world\s+cup|match\s+score|score\s+of|messi|ronaldo|virat\s+kohli|rohit\s+sharma|olympics|weather|temperature|monsoon|rain|forecast|horoscope|zodiac|astrology|essay\s+on|essay\s+about|village\s+life|gao|gaon|farming|agriculture|kheti|dating|relationship)\b/i;

    if (offtopicRegex.test(q)) {
        return { mode: "offtopic", reason: "offtopic_detected" };
    }

    // 5. Fallback: when unsure between dev and offtopic, prefer dev.
    return { mode: "dev", reason: "dev_fallback" };
}

