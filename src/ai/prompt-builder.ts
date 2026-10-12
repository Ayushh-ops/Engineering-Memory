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
        directive = "Reply in Roman-script Hinglish (natural Hindi in English letters), not English and not Devanagari. Ignore the language of earlier answers. For Hinglish use only Roman script and the ASCII full stop, never the Devanagari danda.";
    } else if (lang === "hi") {
        directive = "Reply in Hindi (Devanagari).";
    }
    return `${directive} Keep file, function and variable names in English. Keep code, file names and identifiers unchanged. Apply the same language to the 3 follow-up questions.`;
}

import { classifyQuestion, type QuestionClassification } from "./question-class";

export type LlmMode = "auto" | "short" | "detailed" | "steps" | "simple" | "review";

export function getLengthAndFormatInstructions(classification?: QuestionClassification): string[] {
    const length = classification?.length || "standard";
    const format = classification?.format || "prose";

    const instructions: string[] = [];

    if (length === "brief") {
        instructions.push("Answer in 1 to 3 sentences. No headings. Bullets only if the answer is a list.");
    } else if (length === "deep") {
        instructions.push(
            "Give a thorough explanation of roughly 200 to 400 words, organised in short sections with a bold lead-in on each (for example **Purpose**, **How it works**, **Why it matters**, **What to watch out for**), written mainly as paragraphs. Use bullets only for genuine lists (enumerations, steps, comparisons)."
        );
    } else {
        instructions.push("Answer in 1 to 2 short paragraphs. Use at most 6 bullets, only for list-like content.");
    }

    instructions.push(
        "Match the depth to what the question needs. Explanations of why or how are written as connected prose, not as a bullet per sentence. Never turn every sentence into a bullet. If more than 8 similar items exist, summarise the rest as 'and N more'."
    );

    if (format === "steps") {
        instructions.push("Format: numbered list, one action per step.");
    }

    return instructions;
}

export function getModeInstruction(mode?: string, classification?: QuestionClassification): string {
    const c = classification || classifyQuestion("", mode);
    return getLengthAndFormatInstructions(c).join(" ");
}

export function getSystemInstructions(
    mode?: string,
    additionalInstructions?: string[],
    hasImages = false,
    classification?: QuestionClassification,
    scope?: string
): string[] {
    const resolvedClassification = classification || classifyQuestion("", mode, hasImages);
    const lengthFormatBlock = getLengthAndFormatInstructions(resolvedClassification);

    const instructions = [
        "You are a repository Q&A assistant.",
        "Answer only from the supplied repository facts.",
        "Do not invent repository facts.",
        "Do not claim information that is absent from the supplied context.",
        "Answer as much as the context allows and list missing facts under missingData.",
        ...lengthFormatBlock,
        "Do not use markdown tables.",
        "The answer text must cite files and lines (format path:line) ONLY for lines shown in context, and NEVER cite lines that are not in the context.",
        'At the end of your answer, output evidence as a delimited block: <<<EVIDENCE>>>[{"path":"filepath","line":12}]<<<END_EVIDENCE>>> with only files and lines that support your answer.',
        'Then output follow-up questions as a delimited block: <<<FOLLOWUPS>>>["question 1","question 2","question 3"]<<<END_FOLLOWUPS>>> (maximum 3 short questions, max 8 words each).',
        "Never write the words Evidence, Follow-ups or Missing data as headings or lines inside the answer; put them only inside the two delimited blocks at the very end. Example: <<<EVIDENCE>>>[{\"path\":\"file.ts\",\"line\":1}]<<<END_EVIDENCE>>> <<<FOLLOWUPS>>>[\"Question?\"]<<<END_FOLLOWUPS>>>",
        "The answer text must NEVER contain <<< delimiters or delimiter blocks.",
        "Match the script of the user's latest message. Always reply in the language and script of the user's latest message (Roman Hinglish in means Roman Hinglish out, Devanagari in means Devanagari out, English in means English out). For Hinglish use only Roman script and the ASCII full stop, never the Devanagari danda. Keep file, function and variable names in English. Keep code, file names and identifiers unchanged. Apply the same language to the 3 follow-up questions.",
        "Use inline code only for file names and at most 8 key symbols per answer, list other identifiers as plain text separated by commas.",
        "For any how-many question use the TOTAL numbers from the facts, never count the items in a truncated list. If a list is truncated say so (for example '24 files, for example ...').",
        "For risk questions, explain using the computed risk score and its reasons (dependents count, direct vs transitive, tests found or not, owners/commit count) first. Risk wording must strictly correspond to the score: 0-39 is low, 40-69 is medium, 70-100 is high. Never call a low score high.",
        "For greetings or small talk, reply briefly and do not explain the file, with no code explanation, no citations, and no follow-ups.",
        "If the user asks what you can do (capabilities), answer with a short capability list (explain files, who calls what, why risk is high, history, find code) and do not explain the file."
    ];

    if (scope === "repo") {
        instructions.push("Answer at repository level using these facts and relate the selected file to them.");
    }

    if (hasImages) {
        instructions.push(
            "The user attached image(s) (screenshot, error message, diagram or UI). Read them carefully, quote any visible text that matters, and relate them to the selected file and the repository context. If the image is unclear or unrelated, say so briefly. Do not invent details that are not visible."
        );
    }

    if (additionalInstructions) {
        instructions.push(...additionalInstructions);
    }

    return instructions;
}

export interface PromptInput {
    repository: string;
    target: AiRepositoryContext["target"];
    question: string;
    facts: AiRepositoryContext;
    instructions?: string[];
    mode?: LlmMode;
}

export function buildPrompt(input: PromptInput): string {
    const lang = detectLang(input.question);
    const directive = getLanguageDirective(lang);

    const classification = classifyQuestion(input.question, input.mode);
    const instructions = getSystemInstructions(input.mode, input.instructions, false, classification);

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

