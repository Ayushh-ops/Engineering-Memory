import type { RepositoryGraph } from "../graph/repository-graph";
import { assembleRepositoryContext, type RepositoryContextRequest } from "../graph/repository-context";
import { buildAiContext, MAX_AI_CONTEXT_BYTES, type AiRepositoryContext } from "./context";
import { validateRepositoryContextConsistency } from "./consistency-validator";
import type { LlmProvider, LlmRequest, LlmResponse } from "./provider";
import type { RepositorySourceEvidence } from "../services/repository-source-evidence-service";
import type { ChangeImpactAnalysisResult } from "../services/change-impact-analysis-service";
import { detectLang, getLanguageDirective } from "./prompt-builder";

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

    // Treat "this", "ye", "yeh", "is file" as the currently selected file
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

    // English greetings
    if (/^(hi+|hello+|hey+|howdy|greetings|good\s+(morning|afternoon|evening|day))$/.test(q)) {
        return "Hello! How can I help you explore this codebase today?";
    }
    // Hinglish greetings
    if (/^(namaste|namaskar|kya\s+haal(\s+hai)?|kaise\s+ho(\s+bhai)?|kya\s+chal\s+raha\s+hai|(hello|hi)\s+bhai)$/.test(q)) {
        return "Namaste! Main is codebase ko samajhne me aapki kya madad kar sakta hoon?";
    }
    // Devanagari greetings
    if (/^(नमस्ते|नमस्कार|हेलो|हाय)$/.test(q)) {
        return "नमस्ते! मैं इस कोडबेस को समझने में आपकी क्या मदद कर सकता हूँ?";
    }
    // English thanks
    if (/^(thanks?|thank\s+you|thx|ty|many\s+thanks|thanks\s+a\s+lot)$/.test(q)) {
        return "You're welcome! Let me know if you need anything else.";
    }
    // Hinglish thanks
    if (/^(dhanyawad|dhanyavaad|shukriya|bahut\s+shukriya|shukriyaa)$/.test(q)) {
        return "Aapka swagat hai! Agar kuch aur puchhna ho toh zaroor batayein.";
    }
    // Devanagari thanks
    if (/^(धन्यवाद|शुक्रिया)$/.test(q)) {
        return "आपका स्वागत है! यदि आपको कुछ और जानना हो तो बताएं।";
    }

    return null;
}

export function getCapabilityResponse(question: string): string | null {
    const q = question.trim().toLowerCase().replace(/[!.,?]+$/, "").trim();

    // Hinglish capability questions: "tum kya kya kar sakte ho", "tum kya kar sakte ho", "aap kya kar sakte ho", etc.
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

    // Devanagari capability questions
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

    // English capability questions: "what can you do", "what are your capabilities", "how can you help"
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

export class AiAnswerService {
    constructor(private readonly provider: LlmProvider) {}

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
                confidence: "high"
            };
        }

        const capabilityReply = getCapabilityResponse(request.question);
        if (capabilityReply) {
            return {
                status: "ok",
                answer: capabilityReply,
                citations: [],
                confidence: "high"
            };
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
                missingData: [result.status === "missing" ? "target_missing" : "target_ambiguous"]
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
                missingData: consistency.missingData ?? ["inconsistent_context"]
            };
        }

        let aiContext = buildAiContext(result.context, request.repository, request.evidence, request.impact, request.fileContent, request.graph);
        let serializedContext = JSON.stringify(aiContext);
        if (serializedContext.length > MAX_AI_CONTEXT_BYTES) {
            // Trim fileContent or evidence to fit within MAX_AI_CONTEXT_BYTES instead of refusing
            if (aiContext.fileContent && aiContext.fileContent.length > 8000) {
                const trimBudget = 8000;
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
                missingData: ["question_requires_unavailable_repository_context"]
            };
        }

        const cleanHistory = sanitizeHistory(request.history);
        const lang = detectLang(request.question);
        const directive = getLanguageDirective(lang);
        const promptQuestion = request.question.includes(directive)
            ? request.question
            : `${request.question}\n${directive}`;

        const instructions = [
            "Answer only from the supplied repository facts.",
            "If the context is insufficient, say so explicitly.",
            "Match the script of the user's latest message. Always reply in the language and script of the user's latest message (Roman Hinglish in means Roman Hinglish out, Devanagari in means Devanagari out, English in means English out). Keep file, function and variable names in English. Keep code, file names and identifiers unchanged.",
            "For risk questions, explain using the computed risk score and its reasons (dependents count, direct vs transitive, tests found or not, owners/commit count) first.",
            "If the user message is a greeting or small talk (e.g. 'hi', 'hii', 'hello', 'thanks', 'namaste', 'kaise ho'), reply briefly and do not explain the file, with no code explanation, no citations, and no follow-ups.",
            'At the very end of your answer, provide exactly 3 short follow-up questions (maximum 6 words each) in the user\'s language as a JSON array of strings in a delimited block: <<<FOLLOWUPS>>>["question 1", "question 2", "question 3"]<<<END_FOLLOWUPS>>>. Never output placeholders. If the user message is a greeting or small talk, do not output this block.',
            directive
        ];

        const providerRequest: LlmRequest = {
            repository: request.repository,
            target: aiContext.target,
            question: promptQuestion,
            facts: {
                ...aiContext,
                ...(cleanHistory && cleanHistory.length > 0 ? { history: cleanHistory } : {})
            },
            instructions,
            history: cleanHistory
        };

        const providerResponse = await this.provider.answer(providerRequest);

        if (providerResponse.status === "insufficient_context") {
            if (isFileSelected) {
                return {
                    status: "ok",
                    answer: providerResponse.answer || "Based on the selected file context.",
                    citations: providerResponse.citations ?? (aiContext.target.path ? [{ type: "file", path: aiContext.target.path }] : []),
                    confidence: "medium"
                };
            }
            return {
                status: "insufficient_context",
                answer: providerResponse.answer || "The supplied repository context is insufficient to answer this question reliably.",
                citations: providerResponse.citations ?? [],
                confidence: providerResponse.confidence ?? "low",
                missingData: providerResponse.missingData,
                error: providerResponse.error
            };
        }

        if (providerResponse.status === "error") {
            return {
                status: "error",
                answer: providerResponse.answer || "The AI provider failed to answer the question.",
                citations: providerResponse.citations ?? [],
                confidence: providerResponse.confidence ?? "low",
                error: providerResponse.error,
                missingData: providerResponse.missingData
            };
        }

        let finalAnswer = providerResponse.answer;
        if (aiContext.fileTruncated) {
            const linesCount = aiContext.fileTruncatedLines ?? 150;
            const truncationNotice = `Based on the outline and first ${linesCount} lines.`;
            if (finalAnswer) {
                finalAnswer = `${finalAnswer}\n\n${truncationNotice}`;
            } else {
                finalAnswer = truncationNotice;
            }
        }

        return {
            status: "ok",
            answer: finalAnswer,
            citations: providerResponse.citations,
            confidence: providerResponse.confidence,
            missingData: providerResponse.missingData
        };
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
                confidence: "high"
            };
        }

        const capabilityReply = getCapabilityResponse(request.question);
        if (capabilityReply) {
            onToken(capabilityReply);
            return {
                status: "ok",
                answer: capabilityReply,
                citations: [],
                confidence: "high"
            };
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
                missingData: [result.status === "missing" ? "target_missing" : "target_ambiguous"]
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
                missingData: consistency.missingData ?? ["inconsistent_context"]
            };
        }

        let aiContext = buildAiContext(result.context, request.repository, request.evidence, request.impact, request.fileContent, request.graph);
        let serializedContext = JSON.stringify(aiContext);
        if (serializedContext.length > MAX_AI_CONTEXT_BYTES) {
            if (aiContext.fileContent && aiContext.fileContent.length > 8000) {
                const trimBudget = 8000;
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
                missingData: ["question_requires_unavailable_repository_context"]
            };
        }

        const cleanHistory = sanitizeHistory(request.history);
        const lang = detectLang(request.question);
        const directive = getLanguageDirective(lang);
        const promptQuestion = request.question.includes(directive)
            ? request.question
            : `${request.question}\n${directive}`;

        const instructions = [
            "Answer only from the supplied repository facts.",
            "If the context is insufficient, say so explicitly.",
            "Match the script of the user's latest message. Always reply in the language and script of the user's latest message (Roman Hinglish in means Roman Hinglish out, Devanagari in means Devanagari out, English in means English out). Keep file, function and variable names in English. Keep code, file names and identifiers unchanged.",
            "For risk questions, explain using the computed risk score and its reasons (dependents count, direct vs transitive, tests found or not, owners/commit count) first.",
            "If the user message is a greeting or small talk (e.g. 'hi', 'hii', 'hello', 'thanks', 'namaste', 'kaise ho'), reply briefly and do not explain the file, with no code explanation, no citations, and no follow-ups.",
            'At the very end of your answer, provide exactly 3 short follow-up questions (maximum 6 words each) in the user\'s language as a JSON array of strings in a delimited block: <<<FOLLOWUPS>>>["question 1", "question 2", "question 3"]<<<END_FOLLOWUPS>>>. Never output placeholders. If the user message is a greeting or small talk, do not output this block.',
            directive
        ];

        const providerRequest: LlmRequest = {
            repository: request.repository,
            target: aiContext.target,
            question: promptQuestion,
            facts: {
                ...aiContext,
                ...(cleanHistory && cleanHistory.length > 0 ? { history: cleanHistory } : {})
            },
            instructions,
            history: cleanHistory
        };

        try {
            const providerResponse = await this.provider.streamAnswer(providerRequest, onToken);

            if (providerResponse.status === "insufficient_context") {
                if (isFileSelected) {
                    return {
                        status: "ok",
                        answer: providerResponse.answer || "Based on the selected file context.",
                        citations: providerResponse.citations ?? (aiContext.target.path ? [{ type: "file", path: aiContext.target.path }] : []),
                        confidence: "medium"
                    };
                }
                return {
                    status: "insufficient_context",
                    answer: providerResponse.answer || "The supplied repository context is insufficient to answer this question reliably.",
                    citations: providerResponse.citations ?? [],
                    confidence: providerResponse.confidence ?? "low",
                    missingData: providerResponse.missingData,
                    error: providerResponse.error
                };
            }

            if (providerResponse.status === "error") {
                return {
                    status: "error",
                    answer: providerResponse.answer || "The AI provider failed to answer the question.",
                    citations: providerResponse.citations ?? [],
                    confidence: providerResponse.confidence ?? "low",
                    error: providerResponse.error,
                    missingData: providerResponse.missingData
                };
            }

            let finalAnswer = providerResponse.answer;
            if (aiContext.fileTruncated) {
                const linesCount = aiContext.fileTruncatedLines ?? 150;
                const truncationNotice = `Based on the outline and first ${linesCount} lines.`;
                if (finalAnswer) {
                    finalAnswer = `${finalAnswer}\n\n${truncationNotice}`;
                } else {
                    finalAnswer = truncationNotice;
                }
            }

            return {
                status: "ok",
                answer: finalAnswer,
                citations: providerResponse.citations,
                confidence: providerResponse.confidence,
                missingData: providerResponse.missingData
            };
        } catch {
            // Fall back to non-streaming path if streaming fails
            return this.answer(request);
        }
    }
}
