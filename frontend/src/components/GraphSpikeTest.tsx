import { useState } from 'react';
import { analyzeRepository, getRepositoryTree } from '../api/repositories';
import { analyzeImpact } from '../api/impact';
import { useWorkspaceStore } from '../store/useWorkspaceStore';
import { ApiError } from '../api/client';

export function GraphSpikeTest({ owner, name, sha }: { owner: string, name: string, sha: string }) {
    const setGraph = useWorkspaceStore(s => s.setGraph);
    const [status, setStatus] = useState<string>('Ready');
    const [results, setResults] = useState<any[]>([]);
    const [isTruncated, setIsTruncated] = useState<boolean>(false);

    async function runSpike() {
        setStatus('Running...');
        setResults([]);
        setIsTruncated(false);

        const logs: any[] = [];
        const addLog = (msg: string) => {
            logs.push(msg);
            setResults([...logs]);
        };

        try {
            const url = `https://github.com/${owner}/${name}`;
            addLog(`Fetching repository source tree for ${sha.substring(0, 7)}...`);

            const treeResponse = await getRepositoryTree(url, sha);
            const suitableFiles = treeResponse.files;

            if (treeResponse.truncated) {
                setIsTruncated(true);
                addLog("WARNING: Repository tree is truncated.");
                addLog("Measurements are based on a partial repository tree.");
            }

            if (suitableFiles.length === 0) {
                addLog("No suitable TypeScript/JavaScript files found in the source tree.");
                setStatus("Spike Failed");
                return;
            }

            const stages = [1, 5, 10, 20];

            for (const stage of stages) {
                if (stage > suitableFiles.length && stage !== stages[0]) {
                    continue; // Skip if we don't have enough files for this stage
                }

                const pathsToTest = suitableFiles.slice(0, Math.min(stage, suitableFiles.length));

                addLog(`\n--- Testing ${pathsToTest.length} file(s) ---`);

                // Track requested file count and selected files natively
                addLog(`Requested file count: ${pathsToTest.length}`);

                const analyzeRes = await analyzeRepository({ url, sha, paths: pathsToTest });
                const graphJsonStr = JSON.stringify(analyzeRes.graph);
                const graphSizeBytes = new TextEncoder().encode(graphJsonStr).length;

                addLog(`Graph Node Count: ${analyzeRes.graph.nodes.length}`);
                addLog(`Graph JSON Size: ${(graphSizeBytes / 1024).toFixed(2)} KB`);

                const impactReqBody = {
                    graph: analyzeRes.graph,
                    request: {
                        target: { type: 'file' as const, path: pathsToTest[0] },
                        limits: { maxDepth: 2, maxResults: 10 }
                    }
                };

                const impactReqStr = JSON.stringify(impactReqBody);
                const impactReqSizeBytes = new TextEncoder().encode(impactReqStr).length;
                addLog(`Impact Request Size: ${(impactReqSizeBytes / 1024).toFixed(2)} KB`);

                const impactRes = await analyzeImpact(impactReqBody);
                const impactResStr = JSON.stringify(impactRes);
                const impactResSizeBytes = new TextEncoder().encode(impactResStr).length;

                addLog(`Impact Response Size: ${(impactResSizeBytes / 1024).toFixed(2)} KB`);
                addLog(`Impact Path Count: ${impactRes.paths?.length || 0}`);

                setGraph(analyzeRes.graph);
            }

            if (suitableFiles.length < 20) {
                addLog(`\nRepository contains only ${suitableFiles.length} suitable analyzable files entirely.`);
            }

            setStatus('Spike Complete (Success)');

        } catch (e: any) {
            setStatus('Spike Failed');
            if (e instanceof ApiError) {
                addLog(`API Error ${e.status}: ${e.message}`);
                if (e.missingData) {
                    addLog(`Missing Data Codes: ${e.missingData.join(', ')}`);
                }
            } else {
                addLog(`Error: ${e.message}`);
            }
        }
    }

    return (
        <div className="text-left w-full">
            {isTruncated && (
                <div className="mb-4 p-3 bg-amber-900/30 border border-amber-500/50 text-amber-200 rounded-lg text-sm">
                    ⚠️ Repository file list is incomplete; these measurements are based on a partial repository tree.
                </div>
            )}

            <button
                onClick={runSpike}
                disabled={status.includes('Running')}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg text-sm w-full transition-colors disabled:opacity-50"
            >
                Run Graph Round-Trip Spike
            </button>

            <div className="mt-4 p-3 bg-slate-900 rounded-lg border border-slate-700 font-mono text-xs overflow-auto max-h-64">
                <div className="text-slate-400 mb-2">Status: <span className={status.includes('Failed') ? 'text-red-400' : 'text-green-400'}>{status}</span></div>
                {results.map((log, i) => (
                    <div key={i} className="text-slate-300 py-0.5 border-b border-slate-800 last:border-0">
                        {log}
                    </div>
                ))}
            </div>
        </div>
    );
}
