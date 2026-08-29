import type { AiRepositoryContext } from "./context";

export interface PromptInput {
    repository: string;
    target: AiRepositoryContext["target"];
    question: string;
    facts: AiRepositoryContext;
    instructions?: string[];
}

export function buildPrompt(input: PromptInput): string {
    const instructions = [
        "Answer only from the supplied repository facts.",
        "Do not invent repository facts.",
        "Do not claim information that is absent from the supplied context.",
        "If the context is insufficient, explicitly say so.",
        "Cite relevant file paths, symbol names, or commit SHAs when possible.",
        ...(input.instructions ?? [])
    ];

    return [
        `System instructions: ${instructions.join(" ")}`,
        JSON.stringify({
            repository: input.repository,
            target: input.target,
            question: input.question,
            facts: input.facts
        }, null, 2)
    ].join("\n\n");
}
