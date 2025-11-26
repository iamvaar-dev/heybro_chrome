
import { log } from './utils.js';

export const state = {
    currentRunId: null,
    currentRunBuffer: [],
    currentRunMeta: null,
    currentRunActions: [],
    autoStop: false,
    lastCall: null,
    lastCallAt: 0,
    lastEnterPressedAt: 0,
    newTabsOpened: 0,
    openedHrefs: new Set(),
    stuckCount: 0,
    semantics: { addToCartAt: 0, onCartPageAt: 0 },
    experimentalMode: false,
    geminiKey: "",
    geminiModel: "gemini-2.5-flash",
    sessions: [],
    activeSessionId: null,
    theme: "dark"
};

export async function loadSettings() {
    const s = await chrome.storage.local.get(["geminiKey", "geminiModel", "experimentalMode", "sessions", "activeSessionId", "theme"]);
    state.geminiKey = s.geminiKey || "";
    state.geminiModel = s.geminiModel || "gemini-2.5-flash";
    state.experimentalMode = (s.experimentalMode !== undefined) ? !!s.experimentalMode : true;
    state.sessions = Array.isArray(s.sessions) ? s.sessions : [];
    state.activeSessionId = s.activeSessionId || null;
    state.theme = s.theme || "dark";

    // Ensure at least one session exists
    if (state.sessions.length === 0) {
        createSession("New Task");
    } else if (!state.activeSessionId || !state.sessions.find(s => s.id === state.activeSessionId)) {
        state.activeSessionId = state.sessions[0].id;
    }

    return state;
}

export async function saveSettings() {
    await chrome.storage.local.set({
        geminiKey: state.geminiKey,
        geminiModel: state.geminiModel,
        experimentalMode: state.experimentalMode,
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
        theme: state.theme
    });
}

export function createSession(title) {
    const id = String(Date.now());
    const newSession = {
        id,
        title: title || "New Task",
        history: [],
        timestamp: Date.now()
    };
    state.sessions.unshift(newSession);
    state.activeSessionId = id;
    saveSettings();
    return newSession;
}

export function switchSession(id) {
    const session = state.sessions.find(s => s.id === id);
    if (session) {
        state.activeSessionId = id;
        saveSettings();
        return session;
    }
    return null;
}

export function deleteSession(id) {
    state.sessions = state.sessions.filter(s => s.id !== id);
    if (state.activeSessionId === id) {
        state.activeSessionId = state.sessions.length ? state.sessions[0].id : null;
        if (!state.activeSessionId) createSession("New Task");
    }
    saveSettings();
}

export function updateSessionHistory(event) {
    let session = state.sessions.find(s => s.id === state.activeSessionId);
    if (!session && state.sessions.length > 0) {
        // Fallback to first session if active is missing (shouldn't happen but safety first)
        session = state.sessions[0];
        state.activeSessionId = session.id;
    }

    if (session) {
        session.history.push(event);

        // Update title logic
        if (event.type === "block" && event.contentType === "user") {
            // Update if title is "New Task" OR it's the first user message
            const isNewTask = session.title === "New Task";
            const userMsgCount = session.history.filter(e => e.type === "block" && e.contentType === "user").length;

            if (isNewTask || userMsgCount === 1) {
                let title = String(event.content).trim();
                // Remove any leading/trailing punctuation or newlines
                title = title.replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '');
                if (title.length > 30) title = title.slice(0, 30) + "...";
                if (title) session.title = title;
            }
        }
        saveSettings();
    } else {
        console.error("No active session found to update history");
    }
}

export function setSessionTitle(title) {
    const session = state.sessions.find(s => s.id === state.activeSessionId);
    if (session) {
        let t = String(title).trim();
        t = t.replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '');
        if (t.length > 30) t = t.slice(0, 30) + "...";
        if (t) session.title = t;
        saveSettings();
    }
}

export function getActiveSession() {
    return state.sessions.find(s => s.id === state.activeSessionId);
}

export function startRunState(type, instruction) {
    state.currentRunId = String(Date.now());
    state.currentRunBuffer = [];
    state.currentRunMeta = { type, instruction, startedAt: Date.now() };
    state.currentRunActions = [];
    state.autoStop = false;
    state.newTabsOpened = 0;
    state.openedHrefs = new Set();

    try {
        chrome.runtime.sendMessage({ t: "SET_TASK_CONTEXT", ctx: { currentGoal: instruction } });
    } catch { }
    try { chrome.runtime.sendMessage({ t: "TASK_MEMORY_RESET" }); } catch { }
}

export function appendLog(x) {
    const s = typeof x === "string" ? x : JSON.stringify(x);
    state.currentRunBuffer.push(s);
    return state.currentRunBuffer.join("\n");
}

export async function finishRunState() {
    if (!state.currentRunId) return;
    const data = {};
    data["run_" + state.currentRunId] = {
        id: state.currentRunId,
        meta: { ...state.currentRunMeta, endedAt: Date.now() },
        logs: state.currentRunBuffer
    };
    await chrome.storage.local.set(data);
    try { await chrome.runtime.sendMessage({ t: "TASK_MEMORY_RESET" }); } catch { }
}

export async function fetchGlobalLogs() {
    try { const r = await chrome.runtime.sendMessage({ t: "GET_LOGS" }); return (r && r.logs) ? r.logs : []; } catch { return []; }
}
