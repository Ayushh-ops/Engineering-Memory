import type { AiRepositoryContext } from "./context";

export function detectLang(text: string): "hi" | "hinglish" | "en" {
    if (!text || typeof text !== "string") {
        return "en";
    }
    const trimmed = text.trim();
    if (/^hi+[\s!.,?]*$/i.test(trimmed)) {
        return "en";
    }
    if (/[\u0900-\u097F]/.test(trimmed)) {
        return "hi";
    }
    const HINDI_WORDS_REGEX = /\b(kya|kaise|kaisa|kyu|kyun|kaun|kab|kahan|hai|hain|ho|hoga|kare|karo|kar|krta|krna|karta|karna|ye|yeh|yaha|wo|woh|ka|ki|ke|ko|me|mein|se|par|pe|nahi|nhi|aur|ya|batao|samjhao|dikhao|bhai|tha|thi|iska|iski|iske|unka|unki|unke|kuch|kuchh|kaunsa|kaunsi|kaha|apna|apni|apne|bhi)\b/i;
    if (HINDI_WORDS_REGEX.test(trimmed)) {
        return "hinglish";
    }
    return "en";
}

export function getLanguageDirective(lang: "hi" | "hinglish" | "en"): string {
    let directive = "Reply in English.";
    if (lang === "hinglish") {
        directive = "Reply in Roman-script Hinglish (natural Hindi in English letters), not English and not Devanagari. Ignore the language of earlier answers.";
    } else if (lang === "hi") {
        directive = "Reply in Hindi (Devanagari).";
    }
    return `${directive} Keep file, function and variable names in English. Keep code, file names and identifiers unchanged. Apply the same language to the 3 follow-up questions.`;
}

export interface PromptInput {
    repository: string;
    target: AiRepositoryContext["target"];
    question: string;
    facts: AiRepositoryContext;
    instructions?: string[];
}

export function buildPrompt(input: PromptInput): string {
    const lang = detectLang(input.question);
    const directive = getLanguageDirective(lang);

    const instructions = [
        "Answer only from the supplied repository facts.",
        "Do not invent repository facts.",
        "Do not claim information that is absent from the supplied context.",
        "If the context is insufficient, explicitly say so.",
        "Cite relevant file paths, symbol names, or commit SHAs when possible.",
        "Always reply in the language and script of the user's latest message (Roman Hinglish in means Roman Hinglish out, Devanagari in means Devanagari out, English in means English out). Keep file, function and variable names in English.",
        "For risk questions, explain using the computed risk score and its reasons (dependents count, direct vs transitive, tests found or not, owners/commit count) first.",
        "For greetings or small talk, reply briefly and do not explain the file.",
        "If the user asks what you can do (capabilities), answer with a short capability list (explain files, who calls what, why risk is high, history, find code) and do not explain the file.",
        ...(input.instructions ?? [])
    ];

    const questionWithDirective = input.question.includes(directive)
        ? input.question
        : `${input.question}\n${directive}`;

    return [
        `System instructions: ${instructions.join(" ")}`,
        JSON.stringify({
            repository: input.repository,
            target: input.target,
            question: questionWithDirective,
            facts: input.facts
        }, null, 2)
    ].join("\n\n");
}

