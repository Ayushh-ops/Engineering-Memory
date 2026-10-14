import { useState } from 'react';
import { useAppStore } from '../store';
import { GitBranch, X, ChevronLeft, ChevronRight, Menu, Search, Home } from 'lucide-react';
import { cn } from '../ui';
import { useNavigate } from 'react-router-dom';
import { useResponsive } from '../useMediaQuery';
import { clearSessionSnapshot } from '../session-snapshot';

export function TopBar() {
    const {
        repoUrl,
        setRepoUrl,
        setMeta,
        setCommits,
        setSelectedSha,
        setSelectedFile,
        setSelectedSymbol,
        setImpactResult,
        setGraph,
        setTreeFiles,
        canBack,
        canForward,
        isAnalyzing: loading,
        runAnalyze,
        setCommandPaletteOpen,
        mobileNavOpen,
        setMobileNavOpen
    } = useAppStore();
    const { isPhone, isDesktop } = useResponsive();
    const [inputVal, setInputVal] = useState(repoUrl);
    const navigate = useNavigate();

    const handleHomeClick = () => {
        clearSessionSnapshot();
        setRepoUrl('');
        setSelectedSha(null);
        setSelectedFile(null);
        setSelectedSymbol(null);
        setImpactResult(null);
        setGraph(null);
        setTreeFiles([]);
        setMeta(null);
        setCommits([]);
        useAppStore.getState().clearHistory();
        navigate('/');
    };

    const handleAnalyze = async () => {
        if (!inputVal) return;
        runAnalyze(inputVal);
    };

    return (
        <div className="h-12 border-b border-white/[0.08] flex items-center justify-between px-3 bg-[#07090A] select-none relative z-50 gap-2 sm:gap-3">
            {/* 1. Left section: Hamburger (phone & tablet), Back & Forward (32px), Logo */}
            <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
                {!isDesktop && (
                    <button
                        onClick={() => setMobileNavOpen(true)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-[#8A918C] hover:text-[#E8EAE6] hover:bg-white/[0.04] transition-colors border border-white/[0.08] bg-white/[0.03] cursor-pointer"
                        title="Open menu"
                        aria-label="Open menu"
                    >
                        <Menu size={16} />
                    </button>
                )}

                <div className="flex items-center gap-1 sm:gap-1.5">
                    <button
                        onClick={() => window.history.back()}
                        disabled={!canBack}
                        className={cn(
                            "w-8 h-8 rounded-lg flex items-center justify-center transition-colors border shrink-0",
                            canBack
                                ? "bg-[#15302A] border-[#2F6B5E] text-[#4FD1B5] hover:bg-[#1D4038] hover:border-[#4FD1B5] cursor-pointer"
                                : "bg-[#171D1E] border-white/[0.04] text-[#8A918C]/40 opacity-45 cursor-not-allowed hover:bg-[#171D1E]"
                        )}
                        title="Back"
                        aria-label="Back"
                    >
                        <ChevronLeft size={16} />
                    </button>
                    <button
                        onClick={() => window.history.forward()}
                        disabled={!canForward}
                        className={cn(
                            "w-8 h-8 rounded-lg flex items-center justify-center transition-colors border shrink-0",
                            canForward
                                ? "bg-[#15302A] border-[#2F6B5E] text-[#4FD1B5] hover:bg-[#1D4038] hover:border-[#4FD1B5] cursor-pointer"
                                : "bg-[#171D1E] border-white/[0.04] text-[#8A918C]/40 opacity-45 cursor-not-allowed hover:bg-[#171D1E]"
                        )}
                        title="Forward"
                        aria-label="Forward"
                    >
                        <ChevronRight size={16} />
                    </button>
                </div>

                <div
                    className="flex items-center gap-2 cursor-pointer hover:opacity-85 transition-opacity shrink-0"
                    onClick={handleHomeClick}
                >
                    <span className="w-4 h-4 border border-[#4FD1B5] rotate-45 rounded-[3px] relative flex items-center justify-center shrink-0">
                        <span className="w-1.5 h-1.5 bg-[#4FD1B5] rounded-[1px]" />
                    </span>
                    <span className={cn("font-semibold text-xs tracking-tight text-[#E8EAE6] whitespace-nowrap", isPhone ? "hidden min-[480px]:inline" : "inline")}>
                        Engineering Memory
                    </span>
                </div>
            </div>

            {/* Flexible space on phone */}
            {isPhone && <div className="flex-1 min-w-0" />}

            {/* 2. URL pill (mono, truncated) + Analyze (accent bg, on-accent text) - hidden on phone */}
            {!isPhone && (
                <div className="flex-1 flex items-center justify-center max-w-xl mx-2 min-w-0">
                    <div className="flex items-center gap-2 w-full">
                        <div className="relative flex-1 flex items-center bg-white/[0.03] border border-white/[0.08] rounded-full px-3 py-1 focus-within:border-[#4FD1B5]/50 transition-colors min-w-0">
                            <GitBranch className="text-[#8A918C] mr-2 shrink-0" size={13} />
                            <input
                                value={inputVal}
                                onChange={(e) => setInputVal(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
                                className="w-full bg-transparent text-xs font-mono text-[#E8EAE6] focus:outline-none placeholder:text-[#8A918C]/60 truncate"
                                placeholder="https://github.com/owner/repo"
                            />
                            {inputVal && (
                                <button
                                    onClick={() => setInputVal('')}
                                    className="text-[#8A918C] hover:text-[#E8EAE6] cursor-pointer ml-1 shrink-0"
                                    title="Clear URL"
                                >
                                    <X size={12} />
                                </button>
                            )}
                        </div>
                        <button
                            onClick={handleAnalyze}
                            disabled={loading || !inputVal}
                            className="px-3.5 py-1 text-xs font-medium bg-[#4FD1B5] text-[#04100D] rounded-full hover:brightness-110 active:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer whitespace-nowrap shrink-0 shadow-sm"
                        >
                            {loading ? 'Analyzing...' : 'Analyze'}
                        </button>
                    </div>
                </div>
            )}

            {/* 3. Right section: Search & Home */}
            <div className="flex items-center gap-1.5 sm:gap-2 text-xs shrink-0">
                {isPhone ? (
                    <>
                        <button
                            onClick={() => setCommandPaletteOpen(true)}
                            className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/[0.03] border border-white/[0.08] text-[#8A918C] hover:text-[#E8EAE6] transition-colors cursor-pointer shrink-0"
                            title="Search files"
                            aria-label="Search files"
                        >
                            <Search size={15} />
                        </button>
                        <button
                            onClick={handleHomeClick}
                            className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/[0.03] border border-white/[0.08] text-[#8A918C] hover:text-[#E8EAE6] transition-colors cursor-pointer shrink-0"
                            title="Home"
                            aria-label="Home"
                        >
                            <Home size={15} />
                        </button>
                    </>
                ) : (
                    <>
                        <button
                            onClick={() => setCommandPaletteOpen(true)}
                            className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-white/[0.03] border border-white/[0.08] text-[#8A918C] hover:text-[#E8EAE6] hover:bg-white/[0.06] transition-colors cursor-pointer text-xs shrink-0"
                            title="Search files (Ctrl+K)"
                        >
                            <span>Search files</span>
                            <kbd className="font-mono text-[10px] text-[#8A918C] bg-white/[0.06] px-1.5 py-0.5 rounded border border-white/[0.08]">
                                Ctrl K
                            </kbd>
                        </button>
                        <button
                            onClick={handleHomeClick}
                            className="text-[#8A918C] hover:text-[#E8EAE6] text-xs transition-colors cursor-pointer px-2.5 py-1 rounded-lg hover:bg-white/[0.04] shrink-0"
                        >
                            Home
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}
