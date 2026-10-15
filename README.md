# Engineering Memory

See what breaks before you change it. Paste a public GitHub repository and Engineering Memory shows how its files connect, which files are risky to touch, and what a change could affect.

## What it does

Before editing code, developers ask the same questions: who depends on this file, what could break, which tests cover it, and who knows this code. Engineering Memory answers them in seconds, with the files and lines as evidence.

## Features

- **Overview:** the riskiest files ranked by score, with a repository map.
- **Plan a change:** add the files you plan to edit and get one combined risk, every file that could break, and the tests to run.
- **Health:** circular imports, unused files and files that do too much.
- **Graph:** a 2D and a 3D dependency graph showing what each file imports and what imports it.
- **Impact:** the blast radius of a change, direct and indirect, with the tests that cover it.
- **Connections:** the imports and dependents of a file in one list.
- **Code:** a code viewer that opens at the exact line an answer refers to.
- **History:** commits and owners for a file.
- **Ask AI:** ask questions about a file or the repository. Answers come with evidence, follow-up suggestions and saved chats. You can attach a screenshot, and it replies in the language you write in.

## How it works

1. The backend fetches the repository from the GitHub API and reads its source files.
2. It parses imports, functions and classes, and builds a dependency graph.
3. From the graph it computes, for every file, who depends on it directly and indirectly, which tests reach it, how often it changed and who changed it.
4. A risk score from 0 to 100 combines those signals. It is a guide for where to look first, not proof.
5. Ask AI sends the question together with the relevant facts and code lines to an AI model, then checks that the cited lines really exist before showing them as evidence.

## How to use

1. Paste a public repository URL, for example `https://github.com/owner/repo`, and press Analyze.
2. When the analysis finishes, start from the Overview to see the riskiest files.
3. Pick a file from the sidebar, or press `Ctrl K` to search for one.
4. Open Impact to see what depends on it, Graph to see the connections, Code to read it, or History to see who changed it.
5. Planning to edit several files? Add them with Add to plan and open Plan a change.
6. Have a question? Open Ask AI and ask in plain language.

## Tech stack

React, Vite, Tailwind CSS and three.js on the frontend. Node.js, Express and TypeScript on the backend. Groq with a Gemini fallback for AI answers.

## Run locally

```bash
npm install
npm --prefix frontend install
cp .env.example .env     # add your keys inside .env
npm run dev              # backend on http://localhost:3000
npm --prefix frontend run dev   # frontend on http://localhost:5173
```

Public repositories only. Very large repositories are analysed partially.
