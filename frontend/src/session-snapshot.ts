export interface SessionSnapshot {
    url: string;
    sha: string | null;
    selectedFile: string | null;
    tab: string;
    mode: string;
    activeChatIdByFile: Record<string, string>;
    planFileList: string[];
}

const SNAPSHOT_KEY = 'engineering_memory_session_snapshot';
let saveTimer: any = null;

export function saveSessionSnapshot(snapshot: SessionSnapshot | null): void {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    saveTimer = setTimeout(() => {
        try {
            if (typeof window === 'undefined' || !window.sessionStorage) return;
            if (!snapshot || !snapshot.url) {
                sessionStorage.removeItem(SNAPSHOT_KEY);
            } else {
                sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
            }
        } catch (e) {
            console.warn('Failed to save session snapshot', e);
        }
    }, 300);
}

export function loadSessionSnapshot(): SessionSnapshot | null {
    try {
        if (typeof window === 'undefined' || !window.sessionStorage) return null;
        const raw = sessionStorage.getItem(SNAPSHOT_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as SessionSnapshot;
    } catch {
        return null;
    }
}

export function clearSessionSnapshot(): void {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    try {
        if (typeof window !== 'undefined' && window.sessionStorage) {
            sessionStorage.removeItem(SNAPSHOT_KEY);
        }
    } catch {}
}
