import { useAppStore } from './store';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { MainPanel } from './components/MainPanel';
import { RightPanel } from './components/RightPanel';
import { CommandPalette } from './components/CommandPalette';
import { useEffect } from 'react';
import { api } from './api';
import { LandingPage } from './components/LandingPage';
import { RouteSync } from './components/RouteSync';

export default function App() {
    const { repoUrl, setMeta, setCommits } = useAppStore();

    return (
        <>
            <RouteSync />
            <CommandPalette />
            {!repoUrl ? (
                <LandingPage />
            ) : (
                <div className="flex flex-col h-screen overflow-hidden text-sm bg-[#07090A] text-[#E8EAE6]">
                    <TopBar />
                    <div className="flex flex-1 overflow-hidden">
                        <Sidebar className="w-[210px] flex-shrink-0" />
                        <MainPanel className="flex-1 flex flex-col overflow-hidden" />
                        <RightPanel className="w-80 flex-shrink-0" />
                    </div>
                </div>
            )}
        </>
    );
}
