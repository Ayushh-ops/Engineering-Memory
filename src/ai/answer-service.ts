import crypto from "node:crypto";
import type { RepositoryGraph } from "../graph/repository-graph";
import { assembleRepositoryContext, type RepositoryContextRequest } from "../graph/repository-context";
import { buildAiContext, MAX_AI_CONTEXT_BYTES, type AiRepositoryContext } from "./context";
import { validateRepositoryContextConsistency } from "./consistency-validator";
import type { LlmCitation, LlmEvidence, LlmMode, LlmProvider, LlmRequest, LlmResponse, LlmScope, LlmUsedContext } from "./provider";
import type { RepositorySourceEvidence } from "../services/repository-source-evidence-service";
import type { ChangeImpactAnalysisResult } from "../services/change-impact-analysis-service";
import { detectLang, getLanguageDirective, getSystemInstructions } from "./prompt-builder";

export { detectLang, getLanguageDirective };

export function sanitizeHistory(history?: Array<{ role: string; content: string }>): Array<{ role: string; content: string }> | undefined {
    if (!Array.isArray(history)) return undefined;
    const valid = history.filter((h) => Boolean(h && typeof h === "object" && typeof h.content === "string"));
    return valid.slice(-4).map((h) => ({
        role: h.role === "assistant" ? "assistant" : "user",
        content: h.role === "assistant" && typeof h.content === "string" && h.content.length > 600
            ? h.content.slice(0, 600)
            : String(h.content ?? "")
    }));
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

    return null;
}

export function getCapabilityResponse(question: string): string | null {
    const q = question.trim().toLowerCase().replace(/[!.,?]+$/, "").trim();

    const isHinglishCap =
        /\b(tum|aap)?\s*(kya\s+kya|kya)\s*(kar\s+sakte\s+ho|kar\s+sakti\s+ho|kar\s+sakte\s+hain|kr\s+sakte\s+ho|kar\s+skte\s+ho|krskte\s+ho)\b/i.test(q) ||
        /\b(tum|aap)\s+(kya\s+karega|kya\s+karte\s+ho|kya\s+kar\s+rahe\s+ho)\b/i.test(q) ||
        /\b(tumhari|aapki)\s+(capabilities|taqat|features)\s+(kya|kya\s+kya)\s+(hai|hain)\b/i.test(q);

    if (isHinglishCap) {
        return [
            "Main is repository ko explore karne me aapki madad kar sakta hoon:",
            "• Files aur architecture explain karna",
            "• Kaun kisko call karta hai (imports aur dependents) batana",
            "• File ka risk score kyu high hai uska breakdown dena",
            "• Commit history aur recent changes dekhna",
            "• Code aur symbols dhoondhna"
        ].join("\n");
    }

    const isDevanagariCap =
        /(\u0924\u0941\u092e|\u0906\u092a)?\s*(\u0915\u094d\u094f\u092f\u093e\s+\u0915\u094d\u094f\u092f\u093e|\u0915\u094d\u094f\u092f\u093e)\s*(\u0915\u0930\s+\u0938\u0915\u0924\u0947\s+\u0939\u094b|\u0915\u0930\s+\u0938\u0915\u0924\u0947\s+\u0939\u0948\u0902|\u0915\u0930\s+\u0938\u0915\u0924\u0940\s+\u0939\u094b)/i.test(q);

    if (isDevanagariCap) {
        return [
            "मैं इस रिपॉजिटरी को समझने में आपकी मदद कर सकता हूँ:",
            "• फाइल्स और आर्किटेक्चर को समझाना",
            "• कौन किसको कॉल करता है (इम्पोर्ट्स और डिपेंडेंट्स) बताना",
            "• रिस्क स्कोर क्यों हाई है इसका विवरण देना",
            "• कमिट हिस्ट्री और हाल के बदलाव देखना",
            "• कोड और सिंबल्स ढूँढना"
        ].join("\n");
    }

    const isEnglishCap =
        /^(what\s+can\s+you\s+do|what\s+are\s+your\s+capabilities|what\s+can\s+this\s+assistant\s+do|how\s+can\s+you\s+help(\s+me)?|what\s+are\s+you\s+able\s+to\s+do)\b/i.test(q) ||
        /\bwhat\s+(can\s+you\s+do|are\s+your\s+capabilities)\b/i.test(q);

    if (isEnglishCap) {
        return [
            "Here is what I can help you with in this repository:",
            "• Explain files and system architecture",
            "• Show who calls what (incoming dependents and outgoing imports)",
            "• Explain why risk scores are high and what could break",
            "• Inspect commit history and author changes",
            "• Find code and symbol definitions"
        ].join("\n");
    }

    return null;
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

    private buildCacheKey(request: AiAnswerRequest, targetPath?: string): string {
        const mode = request.mode || "detailed";
        const scope = request.scope || "file";
        const lang = detectLang(request.question);
        const directive = getLanguageDirective(lang);
        const normQ = request.question.trim().toLowerCase();
        const repo = request.repoSha || request.repository;
        return crypto
            .createHash("sha256")
            .update([repo, targetPath || "", normQ, mode, scope, directive].join("|"))
            .digest("hex");
    }

    async answer(request: AiAnswerRequest): Promise<AiAnswerResult> {
        if (!request || typeof request.question !== "string" || request.question.trim().length === 0) {
            return {
                status: "error",
                answer: "",
                citations: [],
                confidence: "low",
                error: {
                    code: "invalid_question",
                    message: "A non-empty question is required."
                }
            };
        }

        const greetingReply = getGreetingOrSmallTalkResponse(request.question);
        if (greetingReply) {
            return {
                status: "ok",
                answer: greetingReply,
                citations: [],
                confidence: "high",
                followUps: [],
                evidence: []
            };
        }

        const capabilityReply = getCapabilityResponse(request.question);
        if (capabilityReply) {
            return {
                status: "ok",
                answer: capabilityReply,
                citations: [],
                confidence: "high",
                followUps: [],
                evidence: []
            };
        }

        const targetPath = request.target.type === "file"
            ? request.target.path
            : request.target.type === "symbol"
                ? request.target.symbol.path
                : undefined;

        const cleanHistory = sanitizeHistory(request.history);
        const isHistoryEmpty = !cleanHistory || cleanHistory.length === 0;
        const cacheKey = this.buildCacheKey(request, targetPath);

        if (isHistoryEmpty) {
            const cached = this.cache.get(cacheKey);
            if (cached) {
                return cached;
            }
        }

        const result = assembleRepositoryContext(request.graph, { target: request.target, limits: request.limits });
        if (result.status !== "ok") {
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

        let aiContext = buildAiContext(
            result.context,
            request.repository,
            request.evidence,
            request.impact,
            request.fileContent,
            request.graph,
            request.risk,
            request.dependents,
            request.recentCommits,
            request.owners,
            {
                question: request.question,
                scope: request.scope,
                dependentFiles: request.dependentFiles
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

        const isFileSelected = request.target.type === "file" || aiContext.target.type === "file";
        if (request.allowInsufficientContext && !isGroundedQuestion(request.question, aiContext.target)) {
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

        const lang = detectLang(request.question);
        const directive = getLanguageDirective(lang);
        const promptQuestion = request.question.includes(directive)
            ? request.question
            : `${request.question}\n${directive}`;

        const instructions = getSystemInstructions(request.mode, [
            directive
        ]);

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
            mode: request.mode,
            scope: request.scope
        };

        const providerResponse = await this.provider.answer(providerRequest);

        if (providerResponse.status === "insufficient_context") {
            if (isFileSelected) {
                return {
                    status: "ok",
                    answer: providerResponse.answer || "Based on the selected file context.",
                    citations: providerResponse.citations ?? (aiContext.target.path ? [{ type: "file", path: aiContext.target.path }] : []),
                    confidence: "medium",
                    followUps: [],
                    evidence: []
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

        let finalAnswer = parsed.cleanAnswer;
        if (aiContext.fileTruncated) {
            const linesCount = aiContext.fileTruncatedLines ?? 150;
            const truncationNotice = `Based on the outline and first ${linesCount} lines.`;
            if (finalAnswer) {
                finalAnswer = `${finalAnswer}\n\n${truncationNotice}`;
            } else {
                finalAnswer = truncationNotice;
            }
        }

        const finalCitations = parsed.citations.length > 0
            ? parsed.citations
            : (providerResponse.citations ?? (aiContext.target.path ? [{ type: "file" as const, path: aiContext.target.path }] : []));

        const finalResult: AiAnswerResult = {
            status: "ok",
            answer: finalAnswer,
            citations: finalCitations,
            confidence: providerResponse.confidence,
            missingData: parsed.missingData !== undefined ? parsed.missingData : providerResponse.missingData,
            followUps: parsed.followUps,
            evidence: parsed.evidence,
            usedContext: providerResponse.usedContext ?? {
                files: aiContext.files.length,
                commits: aiContext.commits.length,
                provider: "groq",
                model: "openai/gpt-oss-120b",
                cached: false
            }
        };

        if (isHistoryEmpty) {
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

        if (typeof request.question !== "string" || request.question.trim().length === 0) {
            return {
                status: "error",
                answer: "",
                citations: [],
                confidence: "low",
                error: {
                    code: "invalid_question",
                    message: "A non-empty question is required."
                }
            };
        }

        const greetingReply = getGreetingOrSmallTalkResponse(request.question);
        if (greetingReply) {
            onToken(greetingReply);
            return {
                status: "ok",
                answer: greetingReply,
                citations: [],
                confidence: "high",
                followUps: [],
                evidence: []
            };
        }

        const capabilityReply = getCapabilityResponse(request.question);
        if (capabilityReply) {
            onToken(capabilityReply);
            return {
                status: "ok",
                answer: capabilityReply,
                citations: [],
                confidence: "high",
                followUps: [],
                evidence: []
            };
        }

        const targetPath = request.target.type === "file"
            ? request.target.path
            : request.target.type === "symbol"
                ? request.target.symbol.path
                : undefined;

        const cleanHistory = sanitizeHistory(request.history);
        const isHistoryEmpty = !cleanHistory || cleanHistory.length === 0;
        const cacheKey = this.buildCacheKey(request, targetPath);

        if (isHistoryEmpty) {
            const cached = this.cache.get(cacheKey);
            if (cached) {
                onToken(cached.answer);
                return cached;
            }
        }

        const result = assembleRepositoryContext(request.graph, { target: request.target, limits: request.limits });
        if (result.status !== "ok") {
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

        let aiContext = buildAiContext(
            result.context,
            request.repository,
            request.evidence,
            request.impact,
            request.fileContent,
            request.graph,
            request.risk,
            request.dependents,
            request.recentCommits,
            request.owners,
            {
                question: request.question,
                scope: request.scope,
                dependentFiles: request.dependentFiles
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

        const isFileSelected = request.target.type === "file" || aiContext.target.type === "file";
        if (!isFileSelected && request.allowInsufficientContext && !isGroundedQuestion(request.question, aiContext.target)) {
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

        const lang = detectLang(request.question);
        const directive = getLanguageDirective(lang);
        const promptQuestion = request.question.includes(directive)
            ? request.question
            : `${request.question}\n${directive}`;

        const instructions = getSystemInstructions(request.mode, [
            directive
        ]);

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
            mode: request.mode,
            scope: request.scope
        };

        try {
            const providerResponse = await this.provider.streamAnswer(providerRequest, onToken);

            if (providerResponse.status === "insufficient_context") {
                if (isFileSelected) {
                    return {
                        status: "ok",
                        answer: providerResponse.answer || "Based on the selected file context.",
                        citations: providerResponse.citations ?? (aiContext.target.path ? [{ type: "file", path: aiContext.target.path }] : []),
                        confidence: "medium",
                        followUps: [],
                        evidence: []
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

            let finalAnswer = parsed.cleanAnswer;
            if (aiContext.fileTruncated) {
                const linesCount = aiContext.fileTruncatedLines ?? 150;
                const truncationNotice = `Based on the outline and first ${linesCount} lines.`;
                if (finalAnswer) {
                    finalAnswer = `${finalAnswer}\n\n${truncationNotice}`;
                } else {
                    finalAnswer = truncationNotice;
                }
            }

            const finalCitations = parsed.citations.length > 0
                ? parsed.citations
                : (providerResponse.citations ?? (aiContext.target.path ? [{ type: "file" as const, path: aiContext.target.path }] : []));

            const finalResult: AiAnswerResult = {
                status: "ok",
                answer: finalAnswer,
                citations: finalCitations,
                confidence: providerResponse.confidence,
                missingData: parsed.missingData !== undefined ? parsed.missingData : providerResponse.missingData,
                followUps: parsed.followUps,
                evidence: parsed.evidence,
                usedContext: providerResponse.usedContext ?? {
                    files: aiContext.files.length,
                    commits: aiContext.commits.length,
                    provider: "groq",
                    model: "openai/gpt-oss-120b",
                    cached: false
                }
            };

            if (isHistoryEmpty) {
                this.cache.set(cacheKey, finalResult);
            }

            return finalResult;
        } catch {
            return this.answer(request);
        }
    }
}
