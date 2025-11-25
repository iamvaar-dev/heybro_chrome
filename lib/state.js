
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
    geminiModel: "gemini-2.5-flash"
};

export async function loadSettings() {
    const s = await chrome.storage.local.get(["geminiKey", "geminiModel", "experimentalMode"]);
    state.geminiKey = s.geminiKey || "";
    state.geminiModel = s.geminiModel || "gemini-2.5-flash";
    state.experimentalMode = (s.experimentalMode !== undefined) ? !!s.experimentalMode : true;
    return state;
}

export async function saveSettings() {
    await chrome.storage.local.set({
        geminiKey: state.geminiKey,
        geminiModel: state.geminiModel,
        experimentalMode: state.experimentalMode
    });
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
