# Engineering Memory — Frontend

The web interface for Engineering Memory provides interactive code graph exploration, change-impact analysis, and context-grounded AI assistance for public GitHub repositories.

## Tech Stack

- **Framework**: React 19 & TypeScript
- **Bundler & Tooling**: Vite 8 & Oxlint
- **Styling**: Tailwind CSS & Lucide Icons
- **Graph Visualizations**:
  - `@xyflow/react` (React Flow) for 2D interactive dependency graphs
  - `three` & `react-force-graph-3d` for 3D repository topology
- **State Management**: Zustand with persistent local repository caching

## Key Features

- **Landing Page**: Real-time canvas network animation, repository input validation (`owner/repo` and full GitHub URLs), recent history, and resilient progress tracking with cancel and timeout handling.
- **Dependency Graph Exploration**: Toggle between 2D and 3D graph representations. Inspect files, classes, functions, calls, and imports with risk highlights.
- **Change Impact Analysis**: Blast-radius exploration identifying downstream dependents, direct callers, transitive consumers, and affected test suites.
- **Ask AI Panel**: Streaming conversational assistant with token-by-token rendering, markdown code citations, image attachment support, and automatic offline detection.
- **Repository Health & Ownership**: Visual indicators for circular dependencies, god files, bus-factor risks, and author commit share.

## Development

Install dependencies:
```bash
npm install
```

Start development server:
```bash
npm run dev
```
The application runs on `http://localhost:5173`. API requests to `/api` are automatically proxied to the backend at `http://localhost:3000`.

Build for production:
```bash
npm run build
```
Type-checks with `tsc -b` and bundles with Vite into `dist/`.

Preview production build:
```bash
npm run preview
```
