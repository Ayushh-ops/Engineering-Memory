import crypto from "node:crypto";
import type { RepositoryGraph } from "../graph/repository-graph";
import { assembleRepositoryContext, type RepositoryContextRequest } from "../graph/repository-context";
import { buildAiContext, MAX_AI_CONTEXT_BYTES, type AiRepositoryContext, type RepoFacts } from "./context";
import { validateRepositoryContextConsistency } from "./consistency-validator";
import type { AskTimings, LlmCitation, LlmEvidence, LlmMode, LlmProvider, LlmRequest, LlmResponse, LlmScope, LlmUsedContext } from "./provider";
import type { RepositorySourceEvidence } from "../services/repository-source-evidence-service";
import type { ChangeImpactAnalysisResult } from "../services/change-impact-analysis-service";
import { detectLang, getLanguageDirective, getSystemInstructions } from "./prompt-builder";
import { classifyQuestion, classifyScope, isMetaQuestion, routeQuestion, type QuestionClassification, type QuestionMode } from "./question-class";

export { detectLang, getLanguageDirective };

export function cleanGreetingAnswer(answer: string): string {
    const lines = answer.split(/\r?\n/).filter((line) => {
        const trimmed = line.trim();
        return !trimmed.startsWith("Based on the outline") && !trimmed.startsWith("Based on the first");
    });
    let cleaned = lines.join(" ").trim();
    cleaned = cleaned.replace(/\bBased on (?:the )?(?:outline|first)[^.!?\n]*[.!?]?/gi, "").trim();
    return cleaned || "Hello! How can I help you explore this codebase today?";
}

export function sanitizeHistory(history?: Array<{ role: string; content: string; images?: unknown }>): Array<{ role: string; content: string }> | undefined {
    if (!Array.isArray(history)) return undefined;
    const valid = history.filter((h) => Boolean(h && typeof h === "object" && typeof h.content === "string"));
    return valid.slice(-4).map((h) => {
        const item = h as { role?: string; content?: string; images?: unknown };
        let contentStr = String(item.content ?? "");
        const hadImages = Boolean(Array.isArray(item.images) && item.images.length > 0) || (item as any).hasImages === true;
        if (/data:image\/[a-zA-Z0-9+.-]+;base64,[a-zA-Z0-9+/=]+/i.test(contentStr)) {
            contentStr = contentStr.replace(/data:image\/[a-zA-Z0-9+.-]+;base64,[a-zA-Z0-9+/=]+/gi, "[image attached]");
        }
        if (hadImages && !contentStr.includes("[image attached]")) {
            contentStr = contentStr.trim() ? `${contentStr}\n[image attached]` : "[image attached]";
        }
        return {
            role: item.role === "assistant" ? "assistant" : "user",
            content: item.role === "assistant" && contentStr.length > 600
                ? contentStr.slice(0, 600)
                : contentStr
        };
    });
}

export interface AiAnswerRequest extends RepositoryContextRequest {
    repository: string;
    question: string;
    graph: RepositoryGraph;
    allowInsufficientContext?: boolean;
    evidence?: RepositorySourceEvidence[];
    impact?: ChangeImpactAnalysisResult;
    fileContent?: string;
    lang?: "en" | "hinglish";
    history?: Array<{ role: string; content: string }>;
    risk?: any;
    dependents?: string[];
    recentCommits?: Array<{ sha: string; message: string; author?: string; authorName?: string; date?: string; authorDate?: string }>;
    owners?: any;
    mode?: LlmMode;
    scope?: LlmScope;
    dependentFiles?: Array<{ path: string; content: string }>;
    repoSha?: string;
    images?: Array<{ mime: "image/jpeg" | "image/png" | "image/webp"; data: string }>;
    repoFacts?: RepoFacts;
    timings?: {
        fileFetch: number;
        contextBuild: number;
    };
    requestStartTime?: number;
}

export interface AiAnswerResult extends LlmResponse {
    status: "ok" | "insufficient_context" | "error";
}

export function isGroundedQuestion(question: string, target: { type: string; path?: string; symbolName?: string; sha?: string }): boolean {
    const normalized = question.toLowerCase();
    const basename = target.path ? target.path.split(/[/\\]/).pop()?.toLowerCase() : undefined;
    const specificTargets = [
        target.path,
        basename,
        target.symbolName,
        target.sha
    ].filter((value): value is string => typeof value === "string" && value.length > 0);

    const filePronouns = [/\bthis\b/, /\bye\b/, /\byeh\b/, /\bis file\b/];
    const hasFilePronoun = filePronouns.some((re) => re.test(normalized));

    if (target.type === "file" && hasFilePronoun) {
        if (!normalized.includes("this repo") && !normalized.includes("this repository")) {
            return true;
        }
    }

    const broadPatterns = [
        "root cause",
        "bug in this repo",
        "explain the repository",
        "architecture of the repo",
        "what is the project",
        "what does this repository do",
        "why is this code broken"
    ];

    if (broadPatterns.some((pattern) => normalized.includes(pattern))) {
        return false;
    }

    if (target.type === "file") {
        return true;
    }

    if (specificTargets.some((value) => normalized.includes(value.toLowerCase()))) {
        return true;
    }

    const questionPatterns = [
        "what does",
        "what is",
        "which",
        "who",
        "when",
        "why",
        "how",
        "explain",
        "describe",
        "summarize",
        "tell me about",
        "show"
    ];

    return questionPatterns.some((pattern) => normalized.includes(pattern));
}

export function getGreetingOrSmallTalkResponse(question: string): string | null {
    const q = question.trim().toLowerCase().replace(/[!.,?]+$/, "").trim();

    if (/^(hi+|hello+|hey+|howdy|greetings|good\s+(morning|afternoon|evening|day))$/.test(q)) {
        return "Hello! How can I help you explore this codebase today?";
    }
    if (/^(namaste|namaskar|kya\s+haal(\s+hai)?|kaise\s+ho(\s+bhai)?|kya\s+chal\s+raha\s+hai|(hello|hi)\s+bhai)$/.test(q)) {
        return "Namaste! Main is codebase ko samajhne me aapki kya madad kar sakta hoon?";
    }
    if (/^(नमस्ते|नमस्कार|हेलो|हाय)$/.test(q)) {
        return "नमस्ते! मैं इस कोडबेस को समझने में आपकी क्या मदद कर सकता हूँ?";
    }
    if (/^(thanks?|thank\s+you|thx|ty|many\s+thanks|thanks\s+a\s+lot)$/.test(q)) {
        return "You're welcome! Let me know if you need anything else.";
    }
    if (/^(dhanyawad|dhanyavaad|shukriya|bahut\s+shukriya|shukriyaa)$/.test(q)) {
        return "Aapka swagat hai! Agar kuch aur puchhna ho toh zaroor batayein.";
    }
    if (/^(धन्यवाद|शुक्रिया)$/.test(q)) {
        return "आपका स्वागत है! यदि आपको कुछ और जानना हो तो बताएं।";
    }
    if (/^(ok|okay)$/.test(q)) {
        return "Got it! Let me know if you have any questions about this codebase.";
    }

    return null;
}

export interface MetaResponse {
    answer: string;
    followUps: string[];
}

export function getMetaResponse(question: string): MetaResponse {
    const lang = detectLang(question);

    if (lang === "hinglish") {
        return {
            answer: [
                "Main code ke dependencies aur imports explain karne me madad karta hoon.",
                "Kisi change se kya toot sakta hai (impact aur risk) uska breakdown deta hoon.",
                "File kisne banayi ya change ki hai uski commit history dikhata hoon.",
                "Multiple files me changes plan karne aur selected file par line evidence ke sath sawal solve karta hoon.",
                "Aap screenshots, diagrams ya error images bhi attach kar sakte hain."
            ].join("\n"),
            followUps: [
                "Ye file explain karo",
                "Is par kaun depend karta hai?",
                "Agar ise change karu toh kya tootega?"
            ]
        };
    }

    if (lang === "hi") {
        return {
            answer: [
                "मैं कोड की डिपेंडेंसीज और इम्पोर्ट्स को समझाने में मदद करता हूँ।",
                "किसी बदलाव से क्या टूट सकता है (इम्पैक्ट और रिस्क) उसका विवरण देता हूँ।",
                "फाइल किसने बदली या बनाई है उसकी कमिट हिस्ट्री दिखाता हूँ।",
                "कई फाइल्स में बदलाव प्लान करने और लाइन एविडेंस के साथ सवालों के जवाब देता हूँ।",
                "आप स्क्रीनशॉट, डायग्राम या एरर की इमेज भी अटैच कर सकते हैं।"
            ].join("\n"),
            followUps: [
                "यह फाइल समझाइए",
                "इस पर कौन निर्भर करता है?",
                "बदलने पर क्या टूट सकता है?"
            ]
        };
    }

    return {
        answer: [
            "I explain code dependencies and imports across the repository.",
            "I show what a change can break through impact and risk analysis.",
            "I inspect who owns or changed a file over time through commit history.",
            "I help plan changes across multiple files and answer questions about the selected file with line evidence.",
            "You can also attach screenshots, diagrams, or error images for visual context."
        ].join("\n"),
        followUps: [
            "Explain this file",
            "Who depends on it?",
            "What breaks if I change it?"
        ]
    };
}

export function getCapabilityResponse(question: string): string | null {
    if (isMetaQuestion(question)) {
        return getMetaResponse(question).answer;
    }
    return null;
}

export function getJokeResponse(question: string): { answer: string; followUps: string[] } {
    const lang = detectLang(question);

    if (lang === "hinglish") {
        return {
            answer: "Programmer ne biwi se kaha: 'Bazaar jao, 1 bread lao, agar ande mile toh 10 le aana.' Biwi 10 bread le aayi kyunki ande mil gaye the!\n\nAb chalo, kis file ko dekhna hai?",
            followUps: []
        };
    }

    if (lang === "hi") {
        return {
            answer: "प्रोग्रामर ने कहा: दुनिया में 10 तरह के लोग होते हैं, एक जो बाइनरी समझते हैं और दूसरे जो नहीं!\n\nअब चलिए, किस फ़ाइल को देखना है?",
            followUps: []
        };
    }

    return {
        answer: "Why do programmers prefer dark mode? Because light attracts bugs!\n\nNow, which file should we look at?",
        followUps: []
    };
}

export function getOfftopicResponse(question: string, selectedFile?: string): { answer: string; followUps: string[] } {
    const lang = detectLang(question);

    if (lang === "hinglish") {
        return {
            answer: "Main ek code aur repository assistant hoon jo software engineering, repositories aur developer tools me madad karta hoon.",
            followUps: [
                selectedFile ? `Selected file ${selectedFile.split(/[/\\]/).pop()} ko samjhao` : "Ye file explain karo",
                "Risk score aur dependents dikhao"
            ]
        };
    }

    if (lang === "hi") {
        return {
            answer: "मैं एक कोड और रिपॉजिटरी सहायक हूँ जो सॉफ्टवेयर, कोडबेस और डेवलपर टूल्स में सहायता करता हूँ।",
            followUps: [
                "यह फ़ाइल समझाइए",
                "रिस्क और डिपेंडेंट दिखाएं"
            ]
        };
    }

    return {
        answer: "I am a code and repository assistant focused on software engineering, codebases, and developer tools.",
        followUps: [
            selectedFile ? `Explain ${selectedFile.split(/[/\\]/).pop()}` : "Explain this file",
            "Show risk score and dependents"
        ]
    };
}

export interface DevResponse {
    answer: string;
    followUps: string[];
    needsRepo?: boolean;
}

export function getDevResponse(question: string, history?: Array<{ role: string; content: string }>): DevResponse {
    const raw = (question || "").trim();
    const q = raw.toLowerCase();
    const lang = detectLang(raw);

    // Escape hatch: check if the question refers to repo files or current repository
    const needsRepoCheck = /\b(this\s+repo|this\s+repository|is\s+repo|is\s+repository|in\s+our\s+repo|our\s+codebase|this\s+project|is\s+project)\b/i;
    if (needsRepoCheck.test(q)) {
        return {
            answer: "",
            followUps: [],
            needsRepo: true
        };
    }

    if (/\bdependency\s+graph\b/i.test(q)) {
        if (lang === "hinglish") {
            return {
                answer: [
                    "Dependency graph ek directed graph hota hai jisme nodes software modules, files ya packages ko represent karte hain, aur edges unke beech ke dependencies ko.",
                    "Build systems aur package managers iska use sahi compilation order decide karne, circular dependencies detect karne aur kisi change ka blast radius evaluate karne ke liye karte hain."
                ].join("\n\n"),
                followUps: [
                    "Circular dependencies kaise detect karein?",
                    "Topological sorting algorithm kya hai?",
                    "Package management me dependency graph"
                ]
            };
        }
        return {
            answer: [
                "A dependency graph is a directed graph where nodes represent software modules, files, or packages, and directed edges represent the dependencies between them.",
                "Build tools and package managers use dependency graphs to determine valid build orders (via topological sorting), identify circular dependencies, and compute the blast radius of changes across a system."
            ].join("\n\n"),
            followUps: [
                "How to detect circular dependencies",
                "Topological sorting algorithm",
                "Package manager resolution algorithms"
            ]
        };
    }

    if (/\b(list\s+(?:vs\.?|versus)\s+tuple|tuple\s+(?:vs\.?|versus)\s+list|list\s+vs\s+tuple)\b/i.test(q) || (/\blist\b/i.test(q) && /\btuple\b/i.test(q))) {
        if (lang === "hinglish") {
            return {
                answer: [
                    "Python me `list` mutable hota hai (elements modify, append ya delete kiye ja sakte hain, syntax: `[1, 2, 3]`), jabki `tuple` immutable hota hai (create hone ke baad elements change nahi hote, syntax: `(1, 2, 3)`).",
                    "Tuples memory-efficient hote hain aur fixed structure ke liye use hote hain. Kyunki tuples immutable hote hain, isliye inhe dictionary keys ke roop me use kiya ja sakta hai agar unke andar ke elements bhi hashable hon."
                ].join("\n\n"),
                followUps: [
                    "Python tuple unpacking",
                    "Immutable data structures ke fayde",
                    "Dictionary keys me tuple ka use"
                ]
            };
        }
        return {
            answer: [
                "In Python, a `list` is mutable (items can be added, removed, or modified in place, syntax: `[1, 2, 3]`), while a `tuple` is immutable (cannot be altered after creation, syntax: `(1, 2, 3)`).",
                "Tuples have lower memory overhead and slightly faster iteration. Because tuples are immutable, they are hashable (if their elements are hashable) and can be used as keys in dictionaries, whereas lists cannot."
            ].join("\n\n"),
            followUps: [
                "Tuple unpacking in Python",
                "When to choose tuples over lists",
                "Hashable types in Python"
            ]
        };
    }

    if (/\b(git\s+rebase|rebase)\b/i.test(q)) {
        if (lang === "hinglish") {
            return {
                answer: [
                    "Git rebase ek branch ke commits ko doosre base commit ke upar move ya re-apply karta hai, jisse repository ki history clean aur linear banti hai.",
                    "Merge commit create karne ke bajaye, rebase naye commits generate karta hai. Iska use features ko main branch ke latest changes se update karne ke liye kiya jata hai."
                ].join("\n\n"),
                followUps: [
                    "Git rebase vs git merge",
                    "Interactive rebase (git rebase -i)",
                    "Rebase conflicts kaise resolve karein"
                ]
            };
        }
        return {
            answer: [
                "Git rebase reapplies commits on top of another base tip, producing a clean, linear commit history without merge commits.",
                "Instead of creating a merge commit, it rewrites project history by creating brand new commits for each commit in the original branch."
            ].join("\n\n"),
            followUps: [
                "Git rebase vs git merge",
                "Interactive rebase (git rebase -i)",
                "Resolving conflicts during rebase"
            ]
        };
    }

    if (/\brecursion\b/i.test(q)) {
        if (lang === "hinglish") {
            return {
                answer: [
                    "Recursion ek aisi programming technique hai jisme ek function apne aap ko call karta hai kisi bade problem ko smaller sub-problems me divide karne ke liye.",
                    "Har recursive function me do mukhya cheezein hoti hain:\n1. **Base Case**: Jo recursion ko stop karta hai taaki infinite stack overflow na ho.\n2. **Recursive Step**: Jo problem ko chota karke function ko dobara call karta hai."
                ].join("\n\n"),
                followUps: [
                    "Base case in recursion",
                    "Recursion vs iteration",
                    "Tail call optimization kya hai"
                ]
            };
        }
        return {
            answer: [
                "Recursion is a programming technique where a function calls itself directly or indirectly to solve smaller instances of the same problem.",
                "Every recursive function requires:\n1. **Base Case**: The stopping condition that returns a value directly without further recursive calls, preventing stack overflow.\n2. **Recursive Step**: The operation that reduces the problem size and calls the function again toward the base case."
            ].join("\n\n"),
            followUps: [
                "Base case in recursion",
                "Recursion vs iteration",
                "Tail call optimization"
            ]
        };
    }

    // General technical fallback
    if (lang === "hinglish") {
        return {
            answer: "Yeh ek general software engineering sawal hai. Is concept ko samajhne ke liye modular design, clean code practices aur standard algorithms ka dhyan rakhna chahiye.",
            followUps: [
                "Code example dikhao",
                "Best practices kya hain?"
            ]
        };
    }

    return {
        answer: "This is a general software engineering concept. Clean code practices, well-defined abstractions, and solid unit testing are the recommended industry approaches for this topic.",
        followUps: [
            "Show a code example",
            "What are common best practices?"
        ]
    };
}


export function parseAndValidateEvidenceAndFollowUps(
    rawAnswer: string,
    contextFiles: Array<{ path: string }>,
    targetPath?: string,
    fileLinesMap?: Map<string, string[]>
): {
    cleanAnswer: string;
    evidence: LlmEvidence[];
    followUps: string[];
    citations: LlmCitation[];
    missingData?: string[];
} {
    let parsedEvidenceRaw: any[] = [];
    let parsedFollowUpsRaw: any[] = [];

    const evidenceMatch = rawAnswer.match(/<<<EVIDENCE>>>([\s\S]*?)<<<END_EVIDENCE>>>/);
    if (evidenceMatch && evidenceMatch[1]) {
        try {
            const json = JSON.parse(evidenceMatch[1].trim());
            if (Array.isArray(json)) parsedEvidenceRaw = json;
        } catch {
            // Malformed evidence JSON ignored
        }
    }

    const followUpsMatch = rawAnswer.match(/<<<FOLLOWUPS>>>([\s\S]*?)<<<END_FOLLOWUPS>>>/);
    if (followUpsMatch && followUpsMatch[1]) {
        try {
            const json = JSON.parse(followUpsMatch[1].trim());
            if (Array.isArray(json)) parsedFollowUpsRaw = json;
        } catch {
            // Malformed followups JSON ignored
        }
    }

    const textWithoutDelimiters = rawAnswer
        .replace(/<<<EVIDENCE>>>[\s\S]*?<<<END_EVIDENCE>>>/g, "")
        .replace(/<<<FOLLOWUPS>>>[\s\S]*?<<<END_FOLLOWUPS>>>/g, "")
        .replace(/<<<[\s\S]*?>>>/g, "");

    const tailStartRegex = /(?:^|\r?\n)[ \t]*(?:#+\s*|\*{1,2}|_{1,2})?(?:missing\s*data|missingdata|evidence|follow-ups|followups|follow\s+ups)(?:\*{1,2}|_{1,2})?[ \t]*[:\-]/i;
    const tailMatch = textWithoutDelimiters.match(tailStartRegex);

    let cleanAnswer = textWithoutDelimiters;
    let tailText = "";

    if (tailMatch && tailMatch.index !== undefined) {
        const newlineOffset = tailMatch[0].startsWith("\r\n") ? 2 : tailMatch[0].startsWith("\n") ? 1 : 0;
        const splitIndex = tailMatch.index + newlineOffset;
        cleanAnswer = textWithoutDelimiters.slice(0, splitIndex);
        tailText = textWithoutDelimiters.slice(splitIndex);
    }

    // Strip standalone label lines remaining mid-answer and stray delimiters
    cleanAnswer = cleanAnswer
        .replace(/(?:^|\r?\n)[ \t]*(?:#+\s*|\*{1,2}|_{1,2})?(?:missing\s*data|missingdata|evidence|follow-ups|followups|follow\s+ups)(?:\*{1,2}|_{1,2})?[ \t]*[:\-]?[ \t]*(?=\r?\n|$)/gi, "")
        .replace(/<<<|>>>/g, "")
        .trim();

    let parsedMissingData: string[] | undefined = undefined;

    if (tailText) {
        // Missing data extraction
        const missingDataMatch = tailText.match(/(?:^|\r?\n)[ \t]*(?:#+\s*|\*{1,2}|_{1,2})?(?:missing\s*data|missingdata)(?:\*{1,2}|_{1,2})?[ \t]*[:\-][ \t]*([\s\S]*?)(?=(?:^|\r?\n)[ \t]*(?:#+\s*|\*{1,2}|_{1,2})?(?:evidence|follow-ups|followups|follow\s+ups)|$)/i);
        if (missingDataMatch) {
            const rawVal = missingDataMatch[1].trim();
            let isJson = false;
            try {
                const parsed = JSON.parse(rawVal);
                if (Array.isArray(parsed)) {
                    isJson = true;
                    parsedMissingData = parsed.map(s => String(s).trim()).filter(Boolean);
                }
            } catch {}

            if (!isJson) {
                const cleanedVal = rawVal.replace(/[.\s]+$/, "").trim().toLowerCase();
                if (/^(none|nothing|koi nahin|n\/a|nil|null|no|not applicable|\[\])$/i.test(cleanedVal)) {
                    parsedMissingData = [];
                } else if (rawVal) {
                    const lines = rawVal
                        .split(/\r?\n/)
                        .map(l => l.replace(/^[ \t]*[-*•]\s*/, "").trim())
                        .filter(Boolean);
                    if (lines.length > 0) {
                        parsedMissingData = lines;
                    } else {
                        parsedMissingData = [rawVal];
                    }
                }
            }
        }

        // Follow-ups extraction from tail if blocks were missing
        if (parsedFollowUpsRaw.length === 0) {
            const followUpsSectionMatch = tailText.match(/(?:^|\r?\n)[ \t]*(?:#+\s*|\*{1,2}|_{1,2})?(?:follow-ups|followups|follow\s+ups)(?:\*{1,2}|_{1,2})?[ \t]*[:\-][ \t]*([\s\S]*?)(?=(?:^|\r?\n)[ \t]*(?:#+\s*|\*{1,2}|_{1,2})?(?:evidence|missing\s*data|missingdata)|$)/i);
            if (followUpsSectionMatch) {
                const sectionBody = followUpsSectionMatch[1].trim();
                let parsedAsJson = false;
                const jsonMatch = sectionBody.match(/\[[\s\S]*?\]/);
                if (jsonMatch) {
                    try {
                        const arr = JSON.parse(jsonMatch[0]);
                        if (Array.isArray(arr)) {
                            parsedAsJson = true;
                            for (const item of arr) {
                                if (typeof item === "string" && item.trim()) {
                                    parsedFollowUpsRaw.push(item.trim().slice(0, 80));
                                }
                            }
                        }
                    } catch {}
                }

                if (!parsedAsJson) {
                    const lines = sectionBody.split(/\r?\n/);
                    for (const line of lines) {
                        const trimmed = line.replace(/^[ \t]*(?:[-*•]|\d+[.)])[ \t]*/, "").trim();
                        if (trimmed) {
                            parsedFollowUpsRaw.push(trimmed.slice(0, 80));
                            if (parsedFollowUpsRaw.length >= 3) break;
                        }
                    }
                }
            }
        }

        // Evidence extraction from tail if blocks were missing
        if (parsedEvidenceRaw.length === 0) {
            const evidenceSectionMatch = tailText.match(/(?:^|\r?\n)[ \t]*(?:#+\s*|\*{1,2}|_{1,2})?(?:evidence)(?:\*{1,2}|_{1,2})?[ \t]*[:\-][ \t]*([\s\S]*?)(?=(?:^|\r?\n)[ \t]*(?:#+\s*|\*{1,2}|_{1,2})?(?:follow-ups|followups|follow\s+ups|missing\s*data|missingdata)|$)/i);
            const evidenceText = evidenceSectionMatch ? evidenceSectionMatch[1].trim() : tailText;

            let parsedAsJsonArray = false;
            const jsonArrMatch = evidenceText.match(/\[[\s\S]*?\]/);
            if (jsonArrMatch) {
                try {
                    const arr = JSON.parse(jsonArrMatch[0]);
                    if (Array.isArray(arr) && arr.length > 0) {
                        parsedAsJsonArray = true;
                        parsedEvidenceRaw.push(...arr);
                    }
                } catch {}
            }

            if (!parsedAsJsonArray) {
                const jsonPairRegex = /\{[^{}]*"path"\s*:\s*"([^"]+)"[^{}]*\}/g;
                let mPair: RegExpExecArray | null;
                let foundPairs = false;
                while ((mPair = jsonPairRegex.exec(evidenceText)) !== null) {
                    foundPairs = true;
                    try {
                        const parsed = JSON.parse(mPair[0]);
                        if (parsed?.path) parsedEvidenceRaw.push(parsed);
                    } catch {
                        const p = mPair[1];
                        const lineM = mPair[0].match(/"line"\s*:\s*(\d+)/);
                        const endLineM = mPair[0].match(/"endLine"\s*:\s*(\d+)/);
                        const snipM = mPair[0].match(/"snippet"\s*:\s*"([^"]*)"/);
                        parsedEvidenceRaw.push({
                            path: p,
                            line: lineM ? parseInt(lineM[1], 10) : undefined,
                            endLine: endLineM ? parseInt(endLineM[1], 10) : undefined,
                            snippet: snipM ? snipM[1] : undefined
                        });
                    }
                }

                if (!foundPairs) {
                    const pathLineRegex = /([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9]+)(?:[ \t]+lines?[ \t]+(\d+)(?:[ \t]*-[ \t]*(\d+))?|:L?(\d+)(?:[ \t]*-[ \t]*(?:L?)(\d+))?)/gi;
                    let mPL: RegExpExecArray | null;
                    while ((mPL = pathLineRegex.exec(evidenceText)) !== null) {
                        const path = mPL[1];
                        const line = mPL[2] ? parseInt(mPL[2], 10) : (mPL[4] ? parseInt(mPL[4], 10) : undefined);
                        const endLine = mPL[3] ? parseInt(mPL[3], 10) : (mPL[5] ? parseInt(mPL[5], 10) : undefined);
                        parsedEvidenceRaw.push({ path, line, endLine });
                    }
                }
            }
        }
    }

    const knownPaths = new Map<string, string>();
    const normalizePath = (p: string) => p.replace(/\\/g, "/").toLowerCase();

    for (const f of contextFiles) {
        if (f.path) knownPaths.set(normalizePath(f.path), f.path);
    }
    if (targetPath) {
        knownPaths.set(normalizePath(targetPath), targetPath);
    }

    const validEvidence: LlmEvidence[] = [];
    const seenEvidence = new Set<string>();

    for (const item of parsedEvidenceRaw) {
        if (!item || typeof item.path !== "string") continue;
        const normItemPath = normalizePath(item.path);
        const canonicalPath = knownPaths.get(normItemPath);
        if (!canonicalPath) continue;

        let lineNum: number | undefined = undefined;
        let endLineNum: number | undefined = typeof item.endLine === "number" && item.endLine > 0 ? Math.floor(item.endLine) : undefined;
        let snippet = typeof item.snippet === "string" ? item.snippet.trim().slice(0, 160) : undefined;

        if (typeof item.line === "number" && item.line > 0) {
            lineNum = Math.floor(item.line);
            const lines = fileLinesMap?.get(normItemPath);
            if (lines) {
                if (lineNum > lines.length) {
                    lineNum = undefined;
                    endLineNum = undefined;
                } else {
                    if (endLineNum !== undefined && endLineNum > lines.length) {
                        endLineNum = lines.length;
                    }
                    if (!snippet) {
                        const lineText = lines[lineNum - 1] ?? "";
                        snippet = lineText.trim().slice(0, 160);
                    }
                }
            }
        }

        const dedupKey = `${canonicalPath}:${lineNum ?? 0}:${endLineNum ?? 0}`;
        if (seenEvidence.has(dedupKey)) continue;
        seenEvidence.add(dedupKey);

        validEvidence.push({
            path: canonicalPath,
            ...(lineNum !== undefined ? { line: lineNum } : {}),
            ...(endLineNum !== undefined ? { endLine: endLineNum } : {}),
            ...(snippet ? { snippet } : {})
        });

        if (validEvidence.length >= 8) break;
    }

    // Fallback evidence: extract line references directly from cleanAnswer if still empty
    if (validEvidence.length === 0) {
        interface RawLineRef {
            index: number;
            endIndex: number;
            path: string;
            startLine: number;
            endLine: number;
        }

        const rawRefs: RawLineRef[] = [];
        const matchedSpans: Array<[number, number]> = [];
        const targetCanonical = targetPath ? knownPaths.get(normalizePath(targetPath)) : undefined;

        // 1. Path-qualified references in cleanAnswer: e.g. <path>:14-29, <path> lines 14-29, <path>:L12, <path>:14
        const pathRefRegex = /([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9]+)(?:[ \t]+lines?[ \t]+(\d+)(?:[ \t]*-[ \t]*(\d+))?|:L?(\d+)(?:[ \t]*-[ \t]*(?:L?)(\d+))?)/gi;
        let mPathRef: RegExpExecArray | null;
        while ((mPathRef = pathRefRegex.exec(cleanAnswer)) !== null) {
            const rawPath = mPathRef[1];
            const canonical = knownPaths.get(normalizePath(rawPath));
            const startIdx = mPathRef.index;
            const endIdx = mPathRef.index + mPathRef[0].length;
            matchedSpans.push([startIdx, endIdx]);

            if (!canonical) continue;
            const start = mPathRef[2] ? parseInt(mPathRef[2], 10) : (mPathRef[4] ? parseInt(mPathRef[4], 10) : undefined);
            const end = mPathRef[3] ? parseInt(mPathRef[3], 10) : (mPathRef[5] ? parseInt(mPathRef[5], 10) : undefined);
            if (start && start > 0) {
                const startLine = Math.min(start, end ?? start);
                const endLine = Math.max(start, end ?? start);
                rawRefs.push({ index: startIdx, endIndex: endIdx, path: canonical, startLine, endLine });
            }
        }

        const isInsideMatchedSpan = (idx: number, end: number) => {
            return matchedSpans.some(([s, e]) => idx >= s && end <= e);
        };

        // 2. Bare L-numbers against target file (e.g. (L14-L29), L48, L31-L46, L14)
        if (targetCanonical) {
            const lNumRegex = /(?:\(L(\d+)(?:[ \t]*-[ \t]*L?(\d+))?\)|(?<![a-zA-Z0-9_./\\-])L(\d+)(?:[ \t]*-[ \t]*L?(\d+))?)/g;
            let mLNum: RegExpExecArray | null;
            while ((mLNum = lNumRegex.exec(cleanAnswer)) !== null) {
                const startIdx = mLNum.index;
                const endIdx = mLNum.index + mLNum[0].length;
                if (isInsideMatchedSpan(startIdx, endIdx)) continue;
                matchedSpans.push([startIdx, endIdx]);

                const startStr = mLNum[1] || mLNum[3];
                const endStr = mLNum[2] || mLNum[4];
                if (startStr) {
                    const start = parseInt(startStr, 10);
                    const end = endStr ? parseInt(endStr, 10) : undefined;
                    if (start > 0) {
                        const startLine = Math.min(start, end ?? start);
                        const endLine = Math.max(start, end ?? start);
                        rawRefs.push({ index: startIdx, endIndex: endIdx, path: targetCanonical, startLine, endLine });
                    }
                }
            }

            // 3. Bare "lines X-Y" or "line X" against target file
            const linesRegex = /(?<![a-zA-Z0-9_./\\-])lines?[ \t]+(\d+)(?:[ \t]*-[ \t]*(\d+))?/gi;
            let mLines: RegExpExecArray | null;
            while ((mLines = linesRegex.exec(cleanAnswer)) !== null) {
                const startIdx = mLines.index;
                const endIdx = mLines.index + mLines[0].length;
                if (isInsideMatchedSpan(startIdx, endIdx)) continue;
                matchedSpans.push([startIdx, endIdx]);

                const start = parseInt(mLines[1], 10);
                const end = mLines[2] ? parseInt(mLines[2], 10) : undefined;
                if (start > 0) {
                    const startLine = Math.min(start, end ?? start);
                    const endLine = Math.max(start, end ?? start);
                    rawRefs.push({ index: startIdx, endIndex: endIdx, path: targetCanonical, startLine, endLine });
                }
            }
        }

        // Build ranges in order of FIRST APPEARANCE in the answer (not sorted by line)
        rawRefs.sort((a, b) => a.index - b.index);

        interface MergedRange {
            path: string;
            startLine: number;
            endLine: number;
            firstAppearanceIndex: number;
        }

        const canMerge = (r1: MergedRange, r2: MergedRange): boolean => {
            if (r1.path !== r2.path) return false;
            const minStart = Math.min(r1.startLine, r2.startLine);
            const minEnd = r1.startLine <= r2.startLine ? r1.endLine : r2.endLine;
            const maxStart = Math.max(r1.startLine, r2.startLine);
            // Overlapping or adjacent (gap <= 1 line): maxStart <= minEnd + 2
            return maxStart <= minEnd + 2;
        };

        const mergedRanges: MergedRange[] = [];
        for (const ref of rawRefs) {
            let merged = false;
            for (let i = 0; i < mergedRanges.length; i++) {
                const existing = mergedRanges[i];
                if (canMerge(existing, { path: ref.path, startLine: ref.startLine, endLine: ref.endLine, firstAppearanceIndex: ref.index })) {
                    mergedRanges[i] = {
                        path: existing.path,
                        startLine: Math.min(existing.startLine, ref.startLine),
                        endLine: Math.max(existing.endLine, ref.endLine),
                        firstAppearanceIndex: Math.min(existing.firstAppearanceIndex, ref.index)
                    };
                    merged = true;
                    // Merge any subsequent ranges that now connect
                    for (let j = mergedRanges.length - 1; j > i; j--) {
                        if (canMerge(mergedRanges[i], mergedRanges[j])) {
                            mergedRanges[i] = {
                                path: mergedRanges[i].path,
                                startLine: Math.min(mergedRanges[i].startLine, mergedRanges[j].startLine),
                                endLine: Math.max(mergedRanges[i].endLine, mergedRanges[j].endLine),
                                firstAppearanceIndex: Math.min(mergedRanges[i].firstAppearanceIndex, mergedRanges[j].firstAppearanceIndex)
                            };
                            mergedRanges.splice(j, 1);
                        }
                    }
                    break;
                }
            }
            if (!merged) {
                mergedRanges.push({
                    path: ref.path,
                    startLine: ref.startLine,
                    endLine: ref.endLine,
                    firstAppearanceIndex: ref.index
                });
            }
        }

        mergedRanges.sort((a, b) => a.firstAppearanceIndex - b.firstAppearanceIndex);

        for (const r of mergedRanges) {
            const normP = normalizePath(r.path);
            const lines = fileLinesMap?.get(normP);
            let lineNum = r.startLine;
            let endLineNum = r.endLine;
            let snippet: string | undefined = undefined;

            if (lines) {
                if (lineNum > lines.length) {
                    continue;
                }
                if (endLineNum > lines.length) {
                    endLineNum = lines.length;
                }
                // Snippet = first line of the range (max 160 chars)
                const lineText = lines[lineNum - 1] ?? "";
                snippet = lineText.trim().slice(0, 160);
            }

            const dedupKey = `${r.path}:${lineNum}:${endLineNum}`;
            if (seenEvidence.has(dedupKey)) continue;
            seenEvidence.add(dedupKey);

            validEvidence.push({
                path: r.path,
                line: lineNum,
                endLine: endLineNum,
                ...(snippet ? { snippet } : {})
            });

            if (validEvidence.length >= 8) break;
        }
    }

    const followUps: string[] = [];
    for (const q of parsedFollowUpsRaw) {
        if (typeof q !== "string") continue;
        const trimmed = q.trim();
        if (!trimmed) continue;
        followUps.push(trimmed.slice(0, 80));
        if (followUps.length >= 3) break;
    }

    const citations: LlmCitation[] = Array.from(new Set(validEvidence.map((e) => e.path))).map((p) => ({
        type: "file" as const,
        path: p
    }));

    return {
        cleanAnswer,
        evidence: validEvidence,
        followUps,
        citations,
        ...(parsedMissingData !== undefined ? { missingData: parsedMissingData } : {})
    };
}

export function normalizeQuestionForComparison(q: string): string {
    return q.toLowerCase().trim().replace(/[^\w\s]/g, "").replace(/\s+/g, " ");
}

export function getFollowUpCandidatesByFileType(targetPath: string | undefined, isHinglish: boolean): string[] {
    const pathStr = (targetPath || "").toLowerCase();
    const fileName = pathStr.split(/[/\\]/).pop() || "";

    const isTest = /\.(test|spec)\.[a-z0-9]+$/i.test(fileName) || /tests?[/\\]|__tests?__[/\\]/i.test(pathStr);
    const isConfig = /\.(json|ya?ml|toml|ini|env|xml|config|rc|properties)$/i.test(fileName) || /config|\.config\./i.test(fileName);
    const isApiClient = /api|client|endpoint|router|service|controller|route/i.test(pathStr);

    if (isTest) {
        return isHinglish
            ? ["Is test mein kya check hota hai?", "Is test ko kaise run karein?", "Isme kya mock kiya gaya hai?"]
            : ["What does this test cover?", "How do I run this test?", "What is mocked in this test?"];
    }
    if (isConfig) {
        return isHinglish
            ? ["Configuration samjhao", "Environment dependencies kya hain?", "Kuch deprecated hai kya?"]
            : ["Explain this configuration", "What are the environment dependencies?", "Is anything deprecated?"];
    }
    if (isApiClient) {
        return isHinglish
            ? ["Isko kaun call karta hai?", "Exposed endpoints samjhao", "Error handling patterns"]
            : ["Who calls this?", "Explain endpoints exposed", "Error handling patterns"];
    }
    return isHinglish
        ? ["Is file ke tests kaun se hain?", "Risk score kyun high hai?", "Recent changes ka summary do"]
        : ["Which tests cover this file?", "Why is the risk score high?", "Summarize recent changes"];
}

export function generateFallbackFollowUps(
    targetPath: string | undefined,
    question: string,
    history?: Array<{ role: string; content: string }>,
    lang?: "hi" | "hinglish" | "en"
): string[] {
    const isHinglish = lang === "hinglish" || lang === "hi";
    const candidates = getFollowUpCandidatesByFileType(targetPath, isHinglish);

    const askedSet = new Set<string>();
    if (question) {
        askedSet.add(normalizeQuestionForComparison(question));
    }
    if (history) {
        for (const h of history) {
            if (h && typeof h.content === "string") {
                askedSet.add(normalizeQuestionForComparison(h.content));
            }
        }
    }

    return candidates.filter(c => !askedSet.has(normalizeQuestionForComparison(c))).slice(0, 3);
}

export function extractBackendChosenEvidence(
    answer: string,
    question: string,
    targetPath: string,
    fileContent: string,
    existingEvidence: LlmEvidence[] = []
): LlmEvidence[] {
    const lines = fileContent.split("\n");
    const totalLines = lines.length;
    if (totalLines === 0) return existingEvidence;

    // (a) Identifiers in backticks in the answer
    const backtickMatches = answer.matchAll(/`([^`\r\n]+)`/g);
    const identifiers: string[] = [];
    for (const m of backtickMatches) {
        const id = m[1].trim();
        if (/^[a-zA-Z_$][a-zA-Z0-9_$:-]*$/.test(id) && id.length >= 2) {
            identifiers.push(id.toLowerCase());
        }
    }

    // (b) Words from the question (>=4 chars, not stopwords)
    const questionTokens = question.match(/[a-zA-Z_$][a-zA-Z0-9_$]{3,}/g) || [];
    const stopWords = new Set([
        "what", "does", "this", "file", "with", "from", "that", "have", "here",
        "explain", "describe", "show", "tell", "which", "when", "where", "about",
        "code", "karta", "karti", "samjhao", "kaise", "karein", "please", "help",
        "there", "their", "them", "then", "than", "will", "would", "should", "could"
    ]);
    const questionWords = questionTokens
        .map((t) => t.toLowerCase())
        .filter((t) => t.length >= 4 && !stopWords.has(t));

    const searchTerms = Array.from(new Set([...identifiers, ...questionWords]));
    if (searchTerms.length === 0) return existingEvidence;

    // Find matching lines
    const matchedLineIndices: number[] = [];
    for (let i = 0; i < totalLines; i++) {
        const lineText = lines[i].toLowerCase();
        for (const term of searchTerms) {
            if (lineText.includes(term)) {
                matchedLineIndices.push(i + 1); // 1-indexed
                break;
            }
        }
    }

    if (matchedLineIndices.length === 0) return existingEvidence;

    interface Range {
        start: number;
        end: number;
        firstMatch: number;
    }

    const rawRanges: Range[] = matchedLineIndices.map((lineNum) => ({
        start: Math.max(1, lineNum - 2),
        end: Math.min(totalLines, lineNum + 2),
        firstMatch: lineNum
    }));

    // Merge overlapping or adjacent ranges
    const merged: Range[] = [];
    for (const r of rawRanges) {
        const last = merged[merged.length - 1];
        if (last && r.start <= last.end + 1) {
            last.end = Math.max(last.end, r.end);
        } else {
            merged.push({ ...r });
        }
    }

    // Order by first match, pick up to 4 ranges
    const chosenRanges = merged.slice(0, 4);

    const result: LlmEvidence[] = [...existingEvidence];
    const seen = new Set(result.map((e) => `${e.path}:${e.line}:${e.endLine}`));

    for (const r of chosenRanges) {
        const dedupKey = `${targetPath}:${r.start}:${r.end}`;
        if (!seen.has(dedupKey)) {
            seen.add(dedupKey);
            const lineText = lines[r.start - 1] ?? "";
            result.push({
                path: targetPath,
                line: r.start,
                endLine: r.end,
                snippet: lineText.trim().slice(0, 160)
            });
        }
        if (result.length >= 4) break;
    }

    return result;
}

export function extractRepoScopeEvidence(
    answer: string,
    repoFacts?: RepoFacts
): LlmEvidence[] {
    if (!repoFacts || !Array.isArray(repoFacts.topRisk) || repoFacts.topRisk.length === 0) {
        return [];
    }

    const answerLower = answer.toLowerCase();
    const mentioned: Array<{ path: string; score: number; dependents: number }> = [];
    const notMentioned: Array<{ path: string; score: number; dependents: number }> = [];

    for (const item of repoFacts.topRisk) {
        const fileName = item.path.split(/[/\\]/).pop()?.toLowerCase();
        const fullPath = item.path.toLowerCase();
        if (answerLower.includes(fullPath) || (fileName && answerLower.includes(fileName))) {
            mentioned.push(item);
        } else {
            notMentioned.push(item);
        }
    }

    const selected = [...mentioned, ...notMentioned].slice(0, 3);

    return selected.map((item) => ({
        path: item.path,
        snippet: `risk ${item.score}, ${item.dependents} dependents`
    }));
}

export class LruAnswerCache {
    private cache = new Map<string, { result: AiAnswerResult; expiresAt: number }>();
    private readonly maxSize = 200;
    private readonly ttlMs = 10 * 60 * 1000;

    public get(key: string): AiAnswerResult | null {
        const entry = this.cache.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return null;
        }
        this.cache.delete(key);
        this.cache.set(key, entry);

        const cloned: AiAnswerResult = JSON.parse(JSON.stringify(entry.result));
        if (cloned.usedContext) {
            cloned.usedContext.cached = true;
        }
        return cloned;
    }

    public set(key: string, result: AiAnswerResult): void {
        if (this.cache.size >= this.maxSize) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey) this.cache.delete(oldestKey);
        }
        this.cache.set(key, {
            result: JSON.parse(JSON.stringify(result)),
            expiresAt: Date.now() + this.ttlMs
        });
    }

    public clear(): void {
        this.cache.clear();
    }
}

export class AiAnswerService {
    public readonly cache = new LruAnswerCache();

    constructor(private readonly provider: LlmProvider) {}

    private buildCacheKey(
        request: AiAnswerRequest,
        targetPath?: string,
        classification?: QuestionClassification,
        effectiveScope?: string,
        effectiveQuestion?: string
    ): string {
        const mode = request.mode || "auto";
        const scope = effectiveScope || request.scope || "file";
        const q = effectiveQuestion !== undefined ? effectiveQuestion : (request.question || "");
        const lang = detectLang(q);
        const directive = getLanguageDirective(lang);
        const normQ = q.trim().toLowerCase();
        const repo = request.repoSha || request.repository;
        const len = classification?.length || "standard";
        const fmt = classification?.format || "prose";
        const hasImages = Boolean(request.images && request.images.length > 0);
        return crypto
            .createHash("sha256")
            .update([repo, targetPath || "", normQ, mode, scope, directive, len, fmt, hasImages ? "img1" : "img0"].join("|"))
            .digest("hex");
    }

    async answer(request: AiAnswerRequest): Promise<AiAnswerResult> {
        const requestStart = request.requestStartTime ?? Date.now();
        const fileFetch = request.timings?.fileFetch ?? 0;
        const contextBuild = request.timings?.contextBuild ?? 0;
        const rawQ = (request && typeof request.question === "string") ? request.question.trim() : "";
        const hasImages = Boolean(request.images && request.images.length > 0);

        if (!rawQ && !hasImages) {
            return {
                status: "error",
                answer: "",
                citations: [],
                confidence: "low",
                error: {
                    code: "bad_request",
                    message: "A question is required when no image is attached"
                }
            };
        }

        const effectiveMode = request.mode || "auto";

        const targetPath = request.target?.type === "file"
            ? request.target.path
            : request.target?.type === "symbol"
                ? request.target.symbol.path
                : undefined;

        const targetDisplayName = targetPath || (request.target?.type === "file" ? request.target.path : "the selected file");
        const cleanHistory = sanitizeHistory(request.history);

        let questionForLLM = rawQ;
        let detectedLang: "hi" | "hinglish" | "en" = "en";

        if (!rawQ && hasImages) {
            const internalInstruction = `Explain what the attached image(s) show and relate them to ${targetDisplayName} and the repository context`;
            const lastUserMsg = cleanHistory?.filter(h => h.role === "user" && h.content?.trim()).slice(-1)[0];
            detectedLang = lastUserMsg ? detectLang(lastUserMsg.content) : "en";
            questionForLLM = internalInstruction;
        } else {
            detectedLang = detectLang(rawQ);
        }

        const isExplicitScope = request.scope === "file" || request.scope === "dependents" || request.scope === "repo";
        const effectiveScope: LlmScope = isExplicitScope
            ? request.scope!
            : (!rawQ && hasImages
                ? "file"
                : classifyScope(rawQ, Boolean(request.repoFacts)));

        const classification = (!rawQ && hasImages)
            ? {
                length: "standard" as const,
                format: "prose" as const,
                maxTokens: 1600,
                reasoningEffort: "low" as const,
                isGreetingOrThanks: false,
                isMeta: false,
                questionClass: "file" as const
            }
            : classifyQuestion(rawQ, effectiveMode, hasImages);

        const repoFilesFromGraph = request.graph && typeof (request.graph.nodes?.values) === "function"
            ? Array.from(request.graph.nodes.values()).filter(n => n.type === "file").map(n => (n as any).path)
            : undefined;
        const symbolsFromGraph = request.graph && typeof (request.graph.nodes?.values) === "function"
            ? Array.from(request.graph.nodes.values()).filter(n => n.type === "function" || n.type === "class" || n.type === "method").map(n => (n as any).name)
            : undefined;

        const routeResult = (!rawQ && hasImages)
            ? { mode: "repo" as const, reason: "repo_image_only" }
            : routeQuestion({
                question: rawQ,
                selectedFile: targetPath,
                repoFiles: repoFilesFromGraph,
                symbols: symbolsFromGraph,
                history: cleanHistory
            });

        if (routeResult.mode === "chat") {
            if (routeResult.reason === "chat_joke") {
                const joke = getJokeResponse(rawQ);
                return {
                    status: "ok",
                    mode: "chat",
                    answer: joke.answer,
                    citations: [],
                    confidence: "high",
                    followUps: joke.followUps,
                    evidence: [],
                    usedContext: false
                };
            }
            if (routeResult.reason === "chat_meta" || (rawQ && isMetaQuestion(rawQ))) {
                const meta = getMetaResponse(rawQ);
                return {
                    status: "ok",
                    mode: "chat",
                    answer: meta.answer,
                    citations: [],
                    confidence: "high",
                    followUps: meta.followUps,
                    evidence: [],
                    usedContext: false
                };
            }
            const greetingReply = rawQ ? getGreetingOrSmallTalkResponse(rawQ) : null;
            const finalGreeting = greetingReply || "You're welcome! Let me know if you need anything else.";
            return {
                status: "ok",
                mode: "chat",
                answer: finalGreeting,
                citations: [],
                confidence: "high",
                followUps: [],
                evidence: [],
                usedContext: false
            };
        }

        if (routeResult.mode === "offtopic") {
            const offtopic = getOfftopicResponse(rawQ, targetPath);
            return {
                status: "ok",
                mode: "offtopic",
                answer: offtopic.answer,
                citations: [],
                confidence: "high",
                followUps: offtopic.followUps,
                evidence: [],
                usedContext: false
            };
        }

        if (routeResult.mode === "dev") {
            const devRes = getDevResponse(rawQ, cleanHistory);
            if (!devRes.needsRepo) {
                return {
                    status: "ok",
                    mode: "dev",
                    answer: devRes.answer,
                    citations: [],
                    confidence: "high",
                    followUps: devRes.followUps,
                    evidence: [],
                    usedContext: false
                };
            }
        }

        const isHistoryEmpty = !cleanHistory || cleanHistory.length === 0;
        const cacheKey = this.buildCacheKey(request, targetPath, classification, effectiveScope, questionForLLM);

        if (isHistoryEmpty && !hasImages) {
            const cached = this.cache.get(cacheKey);
            if (cached) {
                const total = Date.now() - requestStart;
                const askTimings: AskTimings = {
                    fileFetch,
                    contextBuild,
                    firstToken: total,
                    total,
                    model: cached.usedContext?.model || "cached",
                    hops: 0
                };
                console.log(`[ask] total=${total}ms fetch=${fileFetch}ms ctx=${contextBuild}ms firstToken=${total}ms model=${askTimings.model} hops=0`);
                return {
                    ...cached,
                    usedContext: cached.usedContext && typeof cached.usedContext === "object"
                        ? { ...cached.usedContext, cached: true, timings: askTimings }
                        : { files: 0, commits: 0, provider: "cache", model: "cached", cached: true, timings: askTimings }
                };
            }
        }

        const result = assembleRepositoryContext(request.graph, { target: request.target, limits: request.limits });
        let context: any;
        if (result.status === "ok") {
            context = result.context;
        } else if (effectiveScope === "repo") {
            const dummyTarget = request.target || { type: "file", path: "" };
            context = {
                target: {
                    request: dummyTarget,
                    node: { id: "repo:root", type: "file", path: "" } as any
                },
                files: [],
                symbols: [],
                imports: [],
                callers: [],
                commits: [],
                symbolChanges: []
            };
        } else {
            return {
                status: request.allowInsufficientContext ? "insufficient_context" : "error",
                answer: "The supplied repository context does not contain a valid target for this question.",
                citations: [],
                confidence: "low",
                error: {
                    code: "invalid_graph",
                    message: "The requested context target was not found or is ambiguous."
                },
                missingData: [result.status === "missing" ? "target_missing" : "target_ambiguous"],
                followUps: [],
                evidence: []
            };
        }

        if (effectiveScope !== "repo") {
            const consistency = validateRepositoryContextConsistency({
                graph: request.graph,
                evidence: request.evidence,
                impact: request.impact
            });
            if (consistency.status === "invalid") {
                return {
                    status: "error",
                    answer: "The assembled repository context contradicts the repository graph, so it was not sent to the AI provider.",
                    citations: [],
                    confidence: "low",
                    error: {
                        code: "invalid_graph",
                        message: "Impact paths or source evidence do not match the repository graph."
                    },
                    missingData: consistency.missingData ?? ["inconsistent_context"],
                    followUps: [],
                    evidence: []
                };
            }
        }

        let aiContext = buildAiContext(
            context,
            request.repository,
            request.evidence,
            request.impact,
            effectiveScope === "repo" ? undefined : request.fileContent,
            request.graph,
            request.risk,
            request.dependents,
            request.recentCommits,
            request.owners,
            {
                question: questionForLLM,
                scope: effectiveScope,
                dependentFiles: request.dependentFiles,
                repoFacts: request.repoFacts
            }
        );

        let serializedContext = JSON.stringify(aiContext);
        if (serializedContext.length > MAX_AI_CONTEXT_BYTES) {
            if (aiContext.fileContent && aiContext.fileContent.length > 6000) {
                const trimBudget = 6000;
                aiContext = {
                    ...aiContext,
                    fileContent: aiContext.fileContent.slice(0, trimBudget),
                    fileTruncated: true,
                    fileTruncatedLines: aiContext.fileTruncatedLines ?? 150
                };
                serializedContext = JSON.stringify(aiContext);
            }
        }

        const isFileSelected = request.target?.type === "file" || aiContext.target.type === "file";
        if (rawQ && effectiveScope !== "repo" && request.allowInsufficientContext && !isGroundedQuestion(rawQ, aiContext.target)) {
            return {
                status: "insufficient_context",
                answer: "The supplied repository context is insufficient to answer this question reliably.",
                citations: [],
                confidence: "low",
                missingData: ["question_requires_unavailable_repository_context"],
                followUps: [],
                evidence: []
            };
        }

        const directive = getLanguageDirective(detectedLang);
        const promptQuestion = questionForLLM.includes(directive)
            ? questionForLLM
            : `${questionForLLM}\n${directive}`;

        const instructions = getSystemInstructions(
            effectiveMode,
            [directive],
            hasImages,
            classification,
            effectiveScope
        );

        const providerRequest: LlmRequest = {
            repository: request.repository,
            target: aiContext.target,
            question: promptQuestion,
            facts: {
                ...aiContext,
                ...(cleanHistory && cleanHistory.length > 0 ? { history: cleanHistory } : {})
            },
            instructions,
            history: cleanHistory,
            mode: effectiveMode as LlmMode,
            scope: effectiveScope,
            images: request.images,
            classification,
            repoFacts: request.repoFacts
        };

        const providerResponse = await this.provider.answer(providerRequest);

        if (providerResponse.status === "insufficient_context") {
            if (isFileSelected || effectiveScope === "repo") {
                return {
                    status: "ok",
                    answer: providerResponse.answer || "Based on the available context.",
                    citations: providerResponse.citations ?? (aiContext.target.path ? [{ type: "file", path: aiContext.target.path }] : []),
                    confidence: "medium",
                    followUps: [],
                    evidence: [],
                    usedContext: {
                        files: aiContext.files.length,
                        commits: aiContext.commits.length,
                        provider: "internal",
                        model: "fallback",
                        cached: false,
                        length: classification.length,
                        format: classification.format,
                        scope: effectiveScope
                    }
                };
            }
            return {
                status: "insufficient_context",
                answer: providerResponse.answer || "The supplied repository context is insufficient to answer this question reliably.",
                citations: providerResponse.citations ?? [],
                confidence: providerResponse.confidence ?? "low",
                missingData: providerResponse.missingData,
                error: providerResponse.error,
                followUps: [],
                evidence: []
            };
        }

        if (providerResponse.status === "error") {
            return {
                status: "error",
                answer: providerResponse.answer || "The AI provider failed to answer the question.",
                citations: providerResponse.citations ?? [],
                confidence: providerResponse.confidence ?? "low",
                error: providerResponse.error,
                missingData: providerResponse.missingData,
                retryAfterSeconds: providerResponse.retryAfterSeconds,
                followUps: [],
                evidence: []
            };
        }

        const fileLinesMap = new Map<string, string[]>();
        const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();
        if (request.fileContent && targetPath) {
            fileLinesMap.set(norm(targetPath), request.fileContent.split("\n"));
        }
        if (request.dependentFiles) {
            for (const dep of request.dependentFiles) {
                if (dep.path && dep.content) {
                    fileLinesMap.set(norm(dep.path), dep.content.split("\n"));
                }
            }
        }

        const parsed = parseAndValidateEvidenceAndFollowUps(
            providerResponse.answer,
            aiContext.files,
            targetPath,
            fileLinesMap
        );

        const isGreeting = classification.isGreetingOrThanks || classification.questionClass === "greeting";
        let finalAnswer = parsed.cleanAnswer;
        if (isGreeting) {
            finalAnswer = cleanGreetingAnswer(finalAnswer);
        } else if (aiContext.fileTruncated) {
            const linesCount = aiContext.fileTruncatedLines ?? 150;
            const truncationNotice = `Based on the outline and first ${linesCount} lines.`;
            if (finalAnswer) {
                finalAnswer = `${finalAnswer}\n\n${truncationNotice}`;
            } else {
                finalAnswer = truncationNotice;
            }
        }

        let finalEvidence: LlmEvidence[] = [];
        if (isGreeting) {
            finalEvidence = [];
        } else if (hasImages) {
            finalEvidence = parsed.evidence.filter((item) => {
                const normPath = item.path.replace(/\\/g, "/").toLowerCase();
                const baseName = normPath.split("/").pop() || "";
                const answerLower = finalAnswer.toLowerCase();
                return answerLower.includes(normPath) || (baseName.length > 3 && answerLower.includes(baseName));
            });
        } else if (effectiveScope === "repo") {
            finalEvidence = extractRepoScopeEvidence(finalAnswer, request.repoFacts);
        } else if (finalEvidence.length < 2 && request.fileContent && targetPath) {
            finalEvidence = extractBackendChosenEvidence(
                finalAnswer,
                rawQ || questionForLLM,
                targetPath,
                request.fileContent,
                parsed.evidence
            );
        } else {
            finalEvidence = parsed.evidence;
        }

        const finalCitations = isGreeting ? [] : (finalEvidence.length > 0
            ? Array.from(new Set(finalEvidence.map((e) => e.path))).map((p) => ({ type: "file" as const, path: p }))
            : (hasImages
                ? []
                : (parsed.citations.length > 0
                    ? parsed.citations
                    : (providerResponse.citations ?? (aiContext.target.path ? [{ type: "file" as const, path: aiContext.target.path }] : [])))));

        const askedSet = new Set<string>();
        if (request.question) askedSet.add(normalizeQuestionForComparison(request.question));
        if (cleanHistory) {
            for (const h of cleanHistory) {
                if (h && typeof h.content === "string") askedSet.add(normalizeQuestionForComparison(h.content));
            }
        }

        let finalFollowUps = isGreeting ? [] : parsed.followUps.filter(q => !askedSet.has(normalizeQuestionForComparison(q)));
        if (!isGreeting && finalFollowUps.length === 0) {
            finalFollowUps = generateFallbackFollowUps(
                targetPath,
                request.question,
                cleanHistory,
                detectedLang
            );
        }

        const total = Date.now() - requestStart;
        const firstToken = total;
        const model = providerResponse.usedContext?.model || "openai/gpt-oss-120b";
        const hops = providerResponse.usedContext?.hops ?? 0;
        const askTimings: AskTimings = {
            fileFetch,
            contextBuild,
            firstToken,
            total,
            model,
            hops
        };
        console.log(`[ask] total=${total}ms fetch=${fileFetch}ms ctx=${contextBuild}ms firstToken=${firstToken}ms model=${model} hops=${hops}`);

        const finalResult: AiAnswerResult = {
            status: "ok",
            mode: "repo",
            answer: finalAnswer,
            citations: finalCitations,
            confidence: providerResponse.confidence,
            missingData: parsed.missingData !== undefined ? parsed.missingData : providerResponse.missingData,
            followUps: finalFollowUps,
            evidence: finalEvidence,
            ...(providerResponse.truncated ? { truncated: true } : {}),
            usedContext: {
                ...(providerResponse.usedContext ?? {
                    files: aiContext.files.length,
                    commits: aiContext.commits.length,
                    provider: "groq",
                    model: "openai/gpt-oss-120b",
                    images: request.images ? request.images.length : 0
                }),
                cached: false,
                length: classification.length,
                format: classification.format,
                scope: effectiveScope,
                timings: askTimings
            }
        };

        if (isHistoryEmpty && !hasImages) {
            this.cache.set(cacheKey, finalResult);
        }

        return finalResult;
    }

    async streamAnswer(
        request: AiAnswerRequest,
        onToken: (token: string) => void
    ): Promise<AiAnswerResult> {
        if (!this.provider.streamAnswer) {
            return this.answer(request);
        }

        const requestStart = request.requestStartTime ?? Date.now();
        const fileFetch = request.timings?.fileFetch ?? 0;
        const contextBuild = request.timings?.contextBuild ?? 0;
        const rawQ = (request && typeof request.question === "string") ? request.question.trim() : "";
        const hasImages = Boolean(request.images && request.images.length > 0);

        if (!rawQ && !hasImages) {
            return {
                status: "error",
                answer: "",
                citations: [],
                confidence: "low",
                error: {
                    code: "bad_request",
                    message: "A question is required when no image is attached"
                }
            };
        }

        const effectiveMode = request.mode || "auto";

        const targetPath = request.target?.type === "file"
            ? request.target.path
            : request.target?.type === "symbol"
                ? request.target.symbol.path
                : undefined;

        const targetDisplayName = targetPath || (request.target?.type === "file" ? request.target.path : "the selected file");
        const cleanHistory = sanitizeHistory(request.history);

        let questionForLLM = rawQ;
        let detectedLang: "hi" | "hinglish" | "en" = "en";

        if (!rawQ && hasImages) {
            const internalInstruction = `Explain what the attached image(s) show and relate them to ${targetDisplayName} and the repository context`;
            const lastUserMsg = cleanHistory?.filter(h => h.role === "user" && h.content?.trim()).slice(-1)[0];
            detectedLang = lastUserMsg ? detectLang(lastUserMsg.content) : "en";
            questionForLLM = internalInstruction;
        } else {
            detectedLang = detectLang(rawQ);
        }

        const isExplicitScope = request.scope === "file" || request.scope === "dependents" || request.scope === "repo";
        const effectiveScope: LlmScope = isExplicitScope
            ? request.scope!
            : (!rawQ && hasImages
                ? "file"
                : classifyScope(rawQ, Boolean(request.repoFacts)));

        const classification = (!rawQ && hasImages)
            ? {
                length: "standard" as const,
                format: "prose" as const,
                maxTokens: 1600,
                reasoningEffort: "low" as const,
                isGreetingOrThanks: false,
                isMeta: false,
                questionClass: "file" as const
            }
            : classifyQuestion(rawQ, effectiveMode, hasImages);

        const greetingReply = rawQ ? getGreetingOrSmallTalkResponse(rawQ) : null;
        if (greetingReply || (classification.isGreetingOrThanks && rawQ)) {
            const finalGreeting = greetingReply || "You're welcome! Let me know if you need anything else.";
            onToken(finalGreeting);
            return {
                status: "ok",
                answer: finalGreeting,
                citations: [],
                confidence: "high",
                followUps: [],
                evidence: [],
                usedContext: {
                    files: 0,
                    commits: 0,
                    provider: "internal",
                    model: "deterministic",
                    cached: false,
                    length: "brief",
                    format: "prose",
                    scope: effectiveScope
                }
            };
        }

        const isMeta = Boolean(rawQ && (classification.isMeta || isMetaQuestion(rawQ)));
        if (isMeta) {
            const meta = getMetaResponse(rawQ);
            onToken(meta.answer);
            return {
                status: "ok",
                answer: meta.answer,
                citations: [],
                confidence: "high",
                followUps: meta.followUps,
                evidence: [],
                usedContext: false
            };
        }

        const isHistoryEmpty = !cleanHistory || cleanHistory.length === 0;
        const cacheKey = this.buildCacheKey(request, targetPath, classification, effectiveScope, questionForLLM);

        if (isHistoryEmpty && !hasImages) {
            const cached = this.cache.get(cacheKey);
            if (cached) {
                onToken(cached.answer);
                const total = Date.now() - requestStart;
                const askTimings: AskTimings = {
                    fileFetch,
                    contextBuild,
                    firstToken: total,
                    total,
                    model: cached.usedContext?.model || "cached",
                    hops: 0
                };
                console.log(`[ask] total=${total}ms fetch=${fileFetch}ms ctx=${contextBuild}ms firstToken=${total}ms model=${askTimings.model} hops=0`);
                return {
                    ...cached,
                    usedContext: cached.usedContext && typeof cached.usedContext === "object"
                        ? { ...cached.usedContext, cached: true, timings: askTimings }
                        : { files: 0, commits: 0, provider: "cache", model: "cached", cached: true, timings: askTimings }
                };
            }
        }

        const result = assembleRepositoryContext(request.graph, { target: request.target, limits: request.limits });
        let context: any;
        if (result.status === "ok") {
            context = result.context;
        } else if (effectiveScope === "repo") {
            const dummyTarget = request.target || { type: "file", path: "" };
            context = {
                target: {
                    request: dummyTarget,
                    node: { id: "repo:root", type: "file", path: "" } as any
                },
                files: [],
                symbols: [],
                imports: [],
                callers: [],
                commits: [],
                symbolChanges: []
            };
        } else {
            return {
                status: request.allowInsufficientContext ? "insufficient_context" : "error",
                answer: "The supplied repository context does not contain a valid target for this question.",
                citations: [],
                confidence: "low",
                error: {
                    code: "invalid_graph",
                    message: "The requested context target was not found or is ambiguous."
                },
                missingData: [result.status === "missing" ? "target_missing" : "target_ambiguous"],
                followUps: [],
                evidence: []
            };
        }

        if (effectiveScope !== "repo") {
            const consistency = validateRepositoryContextConsistency({
                graph: request.graph,
                evidence: request.evidence,
                impact: request.impact
            });
            if (consistency.status === "invalid") {
                return {
                    status: "error",
                    answer: "The assembled repository context contradicts the repository graph, so it was not sent to the AI provider.",
                    citations: [],
                    confidence: "low",
                    error: {
                        code: "invalid_graph",
                        message: "Impact paths or source evidence do not match the repository graph."
                    },
                    missingData: consistency.missingData ?? ["inconsistent_context"],
                    followUps: [],
                    evidence: []
                };
            }
        }

        let aiContext = buildAiContext(
            context,
            request.repository,
            request.evidence,
            request.impact,
            effectiveScope === "repo" ? undefined : request.fileContent,
            request.graph,
            request.risk,
            request.dependents,
            request.recentCommits,
            request.owners,
            {
                question: questionForLLM,
                scope: effectiveScope,
                dependentFiles: request.dependentFiles,
                repoFacts: request.repoFacts
            }
        );

        let serializedContext = JSON.stringify(aiContext);
        if (serializedContext.length > MAX_AI_CONTEXT_BYTES) {
            if (aiContext.fileContent && aiContext.fileContent.length > 6000) {
                const trimBudget = 6000;
                aiContext = {
                    ...aiContext,
                    fileContent: aiContext.fileContent.slice(0, trimBudget),
                    fileTruncated: true,
                    fileTruncatedLines: aiContext.fileTruncatedLines ?? 150
                };
                serializedContext = JSON.stringify(aiContext);
            }
        }

        const isFileSelected = request.target?.type === "file" || aiContext.target.type === "file";
        if (rawQ && effectiveScope !== "repo" && !isFileSelected && request.allowInsufficientContext && !hasImages && !isGroundedQuestion(rawQ, aiContext.target)) {
            return {
                status: "insufficient_context",
                answer: "The supplied repository context is insufficient to answer this question reliably.",
                citations: [],
                confidence: "low",
                missingData: ["question_requires_unavailable_repository_context"],
                followUps: [],
                evidence: []
            };
        }

        const directive = getLanguageDirective(detectedLang);
        const promptQuestion = questionForLLM.includes(directive)
            ? questionForLLM
            : `${questionForLLM}\n${directive}`;

        const instructions = getSystemInstructions(
            effectiveMode,
            [directive],
            hasImages,
            classification,
            effectiveScope
        );

        const providerRequest: LlmRequest = {
            repository: request.repository,
            target: aiContext.target,
            question: promptQuestion,
            facts: {
                ...aiContext,
                ...(cleanHistory && cleanHistory.length > 0 ? { history: cleanHistory } : {})
            },
            instructions,
            history: cleanHistory,
            mode: effectiveMode as LlmMode,
            scope: effectiveScope,
            images: request.images,
            classification,
            repoFacts: request.repoFacts
        };

        let firstTokenTime: number | null = null;
        const trackingOnToken = (token: string) => {
            if (firstTokenTime === null) {
                firstTokenTime = Date.now();
            }
            onToken(token);
        };

        try {
            const providerResponse = await this.provider.streamAnswer(providerRequest, trackingOnToken);

            if (providerResponse.status === "insufficient_context") {
                if (isFileSelected || effectiveScope === "repo") {
                    return {
                        status: "ok",
                        answer: providerResponse.answer || "Based on the available context.",
                        citations: providerResponse.citations ?? (aiContext.target.path ? [{ type: "file", path: aiContext.target.path }] : []),
                        confidence: "medium",
                        followUps: [],
                        evidence: [],
                        usedContext: {
                            files: aiContext.files.length,
                            commits: aiContext.commits.length,
                            provider: "internal",
                            model: "fallback",
                            cached: false,
                            length: classification.length,
                            format: classification.format,
                            scope: effectiveScope
                        }
                    };
                }
                return {
                    status: "insufficient_context",
                    answer: providerResponse.answer || "The supplied repository context is insufficient to answer this question reliably.",
                    citations: providerResponse.citations ?? [],
                    confidence: providerResponse.confidence ?? "low",
                    missingData: providerResponse.missingData,
                    error: providerResponse.error,
                    followUps: [],
                    evidence: []
                };
            }

            if (providerResponse.status === "error") {
                return {
                    status: "error",
                    answer: providerResponse.answer || "The AI provider failed to answer the question.",
                    citations: providerResponse.citations ?? [],
                    confidence: providerResponse.confidence ?? "low",
                    error: providerResponse.error,
                    missingData: providerResponse.missingData,
                    retryAfterSeconds: providerResponse.retryAfterSeconds,
                    followUps: [],
                    evidence: []
                };
            }

            const fileLinesMap = new Map<string, string[]>();
            const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();
            if (request.fileContent && targetPath) {
                fileLinesMap.set(norm(targetPath), request.fileContent.split("\n"));
            }
            if (request.dependentFiles) {
                for (const dep of request.dependentFiles) {
                    if (dep.path && dep.content) {
                        fileLinesMap.set(norm(dep.path), dep.content.split("\n"));
                    }
                }
            }

            const parsed = parseAndValidateEvidenceAndFollowUps(
                providerResponse.answer,
                aiContext.files,
                targetPath,
                fileLinesMap
            );

            const isGreeting = classification.isGreetingOrThanks || classification.questionClass === "greeting";
            let finalAnswer = parsed.cleanAnswer;
            if (isGreeting) {
                finalAnswer = cleanGreetingAnswer(finalAnswer);
            } else if (aiContext.fileTruncated) {
                const linesCount = aiContext.fileTruncatedLines ?? 150;
                const truncationNotice = `Based on the outline and first ${linesCount} lines.`;
                if (finalAnswer) {
                    finalAnswer = `${finalAnswer}\n\n${truncationNotice}`;
                } else {
                    finalAnswer = truncationNotice;
                }
            }

            let finalEvidence: LlmEvidence[] = [];
            if (isGreeting) {
                finalEvidence = [];
            } else if (hasImages) {
                finalEvidence = parsed.evidence.filter((item) => {
                    const normPath = item.path.replace(/\\/g, "/").toLowerCase();
                    const baseName = normPath.split("/").pop() || "";
                    const answerLower = finalAnswer.toLowerCase();
                    return answerLower.includes(normPath) || (baseName.length > 3 && answerLower.includes(baseName));
                });
            } else if (effectiveScope === "repo") {
                finalEvidence = extractRepoScopeEvidence(finalAnswer, request.repoFacts);
            } else if (finalEvidence.length < 2 && request.fileContent && targetPath) {
                finalEvidence = extractBackendChosenEvidence(
                    finalAnswer,
                    rawQ || questionForLLM,
                    targetPath,
                    request.fileContent,
                    parsed.evidence
                );
            } else {
                finalEvidence = parsed.evidence;
            }

            const finalCitations = isGreeting ? [] : (finalEvidence.length > 0
                ? Array.from(new Set(finalEvidence.map((e) => e.path))).map((p) => ({ type: "file" as const, path: p }))
                : (hasImages
                    ? []
                    : (parsed.citations.length > 0
                        ? parsed.citations
                        : (providerResponse.citations ?? (aiContext.target.path ? [{ type: "file" as const, path: aiContext.target.path }] : [])))));

            const askedSet = new Set<string>();
            if (request.question) askedSet.add(normalizeQuestionForComparison(request.question));
            if (cleanHistory) {
                for (const h of cleanHistory) {
                    if (h && typeof h.content === "string") askedSet.add(normalizeQuestionForComparison(h.content));
                }
            }

            let finalFollowUps = isGreeting ? [] : parsed.followUps.filter(q => !askedSet.has(normalizeQuestionForComparison(q)));
            if (!isGreeting && finalFollowUps.length === 0) {
                finalFollowUps = generateFallbackFollowUps(
                    targetPath,
                    request.question,
                    cleanHistory,
                    detectedLang
                );
            }

            const total = Date.now() - requestStart;
            const firstToken = firstTokenTime !== null ? (firstTokenTime - requestStart) : total;
            const model = providerResponse.usedContext?.model || "openai/gpt-oss-120b";
            const hops = providerResponse.usedContext?.hops ?? 0;
            const askTimings: AskTimings = {
                fileFetch,
                contextBuild,
                firstToken,
                total,
                model,
                hops
            };
            console.log(`[ask] total=${total}ms fetch=${fileFetch}ms ctx=${contextBuild}ms firstToken=${firstToken}ms model=${model} hops=${hops}`);

            const finalResult: AiAnswerResult = {
                status: "ok",
                answer: finalAnswer,
                citations: finalCitations,
                confidence: providerResponse.confidence,
                missingData: parsed.missingData !== undefined ? parsed.missingData : providerResponse.missingData,
                followUps: finalFollowUps,
                evidence: finalEvidence,
                ...(providerResponse.truncated ? { truncated: true } : {}),
                usedContext: {
                    ...(providerResponse.usedContext ?? {
                        files: aiContext.files.length,
                        commits: aiContext.commits.length,
                        provider: "groq",
                        model: "openai/gpt-oss-120b",
                        images: request.images ? request.images.length : 0
                    }),
                    cached: false,
                    length: classification.length,
                    format: classification.format,
                    scope: effectiveScope,
                    timings: askTimings
                }
            };

            if (isHistoryEmpty && !hasImages) {
                this.cache.set(cacheKey, finalResult);
            }

            return finalResult;
        } catch {
            return this.answer(request);
        }
    }
}
