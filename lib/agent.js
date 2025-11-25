
import { state, startRunState, finishRunState, appendLog } from './state.js';
import { getEls, setRunning, addMessage, addStep, addPlan } from './ui.js';
import { generatePlan, callGemini } from './planner.js';
import { execTool, normalizeCall, sendToAgent, ensureActiveAndFocused, waitReady } from './tools.js';
import { log, hostFromUrl, extractTargetDomain } from './utils.js';

function callsEqual(a, b) {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

function normalizeArgsForHistory(args) {
    const a = args || {};
    const r = {};
    if (a.id !== undefined) r.id = a.id;
    if (a.selector) r.selector = a.selector;
    if (a.xpath) r.xpath = a.xpath;
    if (a.text) r.text = String(a.text).slice(0, 60);
    if (a.key) r.key = a.key;
    if (a.url) r.url = a.url;
    if (a.to) r.to = a.to;
    if (a.value !== undefined && typeof a.value !== "object") r.value = String(a.value).slice(0, 120);
    if (a.href) r.href = a.href;
    if (a.signature && a.signature.label) r.label = String(a.signature.label).slice(0, 80);
    return r;
}

function recordAction(action, result, preState, postState) {
    const h = {
        t: action.tool || action.action,
        a: normalizeArgsForHistory(action.args || {}),
        ok: !!(result && result.ok),
        u: postState && postState.state && postState.state.url ? postState.state.url : (preState && preState.state && preState.state.url ? preState.state.url : ""),
        ts: Date.now()
    };
    state.currentRunActions.push(h);
    if (state.currentRunActions.length > 50) state.currentRunActions = state.currentRunActions.slice(-50);
    if (!h.ok) {
        try { chrome.runtime.sendMessage({ t: "TASK_RECORD_ERROR", action: action, error: result && result.error ? result.error : "action_failed" }); } catch { }
    }
    try { chrome.runtime.sendMessage({ t: "TASK_MEMORY_RECORD_ACTION", action, result, preState, postState }); } catch { }
}

function buildHistoryForPrompt(maxItems = 20) {
    const items = state.currentRunActions.slice(-maxItems);
    return JSON.stringify(items);
}

async function getInjectableTabId() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    let tab = tabs && tabs[0];
    if (tab && (/^(https?|file):/i.test(tab.url))) return tab.id;
    const all = await chrome.tabs.query({ currentWindow: true });
    for (const t of all) {
        if (/^(https?|file):/i.test(t.url)) return t.id;
    }
    return undefined;
}

async function ensureExistingTab(tabId) {
    try {
        if (tabId && typeof tabId === 'number') {
            const t = await chrome.tabs.get(tabId);
            if (t && (/^(https?|file):/i.test(t.url))) return tabId;
        }
    } catch { }
    let newId = await getInjectableTabId();
    if (!newId) {
        try {
            const nt = await chrome.tabs.create({ url: "about:blank", active: true });
            newId = nt?.id;
        } catch { }
    }
    return newId;
}

async function simplify(tabId, annotate) {
    const r = await sendToAgent(tabId, { t: "simplify", annotate });
    return (r && Array.isArray(r.elements)) ? r.elements : [];
}

async function mapCompact(tabId) {
    const r = await sendToAgent(tabId, { t: "mapCompact" });
    return (r && Array.isArray(r.elements)) ? r.elements : [];
}

async function ensurePlanForInstruction(instruction) {
    const key = state.geminiKey.trim();
    const model = state.geminiModel.trim();
    let plan = [];

    const step = addStep("Generating plan...");

    if (key && model) {
        plan = await generatePlan(instruction, key, model).catch(() => []);
    }

    if (!plan || !plan.length) {
        const text = String(instruction || "").toLowerCase();
        const domain = extractTargetDomain(text);
        const steps = [];
        if (domain) {
            steps.push({ title: `Navigate to ${domain}` });
            steps.push({ title: "Find relevant element(s)" });
            steps.push({ title: "Interact and verify result" });
        } else {
            steps.push({ title: "Open site or perform web search" });
            steps.push({ title: "Click a relevant result" });
            steps.push({ title: "Verify destination page" });
        }
        plan = steps.map(st => ({ title: String(st.title), status: "pending" }));
    }

    step.update("done", "Plan created");

    if (Array.isArray(plan) && plan.length) {
        try { await chrome.runtime.sendMessage({ t: "UPDATE_TASK_CONTEXT", patch: { subtasks: plan } }); } catch { }
        return addPlan(plan);
    }
    return null;
}

function pickNextCall(action) {
    try {
        if (!action) return null;
        if (action.call && (action.call.tool || action.call.action)) {
            return normalizeCall(action.call);
        }
        if (action.calls && Array.isArray(action.calls) && action.calls.length) {
            const first = action.calls.find(c => (c.tool || c.action) && String(c.tool || c.action).toLowerCase() !== "done");
            return first ? normalizeCall(first) : null;
        }
        if (action.tool || action.action) {
            return normalizeCall(action);
        }
        return null;
    } catch {
        return null;
    }
}

function describeCall(call) {
    const t = call.tool;
    const a = call.args || {};
    if (t === "navigate") return `Navigating to ${hostFromUrl(a.url) || a.url || "page"}`;
    if (t === "tap") return `Clicking ${a.text || a.selector || "element"}`;
    if (t === "type") return `Typing "${a.text || a.value}"`;
    if (t === "search") return `Searching for "${a.query}"`;
    if (t === "wait") return `Waiting for ${a.ms ? a.ms + "ms" : "condition"}`;
    return `Executing ${t}`;
}

export async function startAutoRun() {
    const els = getEls();
    state.autoStop = false;
    await setRunning(true);
    let tabId = await getInjectableTabId();
    const key = state.geminiKey.trim();
    const model = state.geminiModel.trim();
    const instruction = els.instruction.value.trim();

    if (!instruction) {
        await setRunning(false);
        return;
    }

    addMessage("user", instruction);
    els.instruction.value = "";
    els.instruction.style.height = "auto";

    if (!key) {
        addMessage("agent", "Please add your Gemini API Key in Settings to continue.");
        await setRunning(false);
        return;
    }

    const planUI = await ensurePlanForInstruction(instruction);

    let step = 0;
    if (tabId) {
        try {
            const t = await chrome.tabs.get(tabId);
            if (t && (/^(https?|file):/i.test(t.url))) {
                await ensureActiveAndFocused(tabId);
                await sendToAgent(tabId, { t: "setMode", experimental: state.experimentalMode });
                await sendToAgent(tabId, { t: "working", on: true });
                await waitReady(tabId);
            }
            try { chrome.runtime.sendMessage({ t: "TASK_ADD_RELEVANT_TAB", tabId }); } catch { }
        } catch { }
    }
    startRunState("auto", instruction);

    while (!state.autoStop && step < 15) {
        if (!tabId) {
            tabId = await getInjectableTabId();
            if (tabId) {
                await sendToAgent(tabId, { t: "setMode", experimental: state.experimentalMode });
                await sendToAgent(tabId, { t: "working", on: true });
            }
        }

        let elements = [];
        if (tabId) {
            try {
                elements = state.experimentalMode ? await mapCompact(tabId) : await simplify(tabId, true);
            } catch (e) {
                // Try to recover
                try {
                    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["content.js"] });
                    await new Promise(resolve => setTimeout(resolve, 500));
                    elements = state.experimentalMode ? await mapCompact(tabId) : await simplify(tabId, true);
                } catch { }
            }
        }

        // Update plan UI based on context
        if (planUI) {
            try {
                const r = await chrome.runtime.sendMessage({ t: "GET_TASK_CONTEXT" });
                const subtasks = r?.taskContext?.subtasks || [];
                subtasks.forEach((st, idx) => {
                    if (st.status === "completed") planUI.update(idx, "completed");
                    else if (st.status === "active") planUI.update(idx, "active");
                });
            } catch { }
        }

        const thinkingStep = addStep("Thinking...");
        const action = await callGemini(elements, instruction, key, model, tabId, buildHistoryForPrompt());
        thinkingStep.update("done", "Thought processed");

        const nc = pickNextCall(action);

        tabId = await ensureExistingTab(tabId);
        const preState = tabId ? await sendToAgent(tabId, { t: "getPageState" }) : null;

        if (!nc) break;
        if (nc.tool === "done") {
            addMessage("agent", "I have completed the task!");
            break;
        }

        // Dedup logic
        const now = Date.now();
        if (state.lastCall && callsEqual(state.lastCall, nc) && (now - state.lastCallAt < 1200)) {
            continue;
        }

        const execStep = addStep(describeCall(nc));

        await ensureActiveAndFocused(tabId);
        const r = await execTool(tabId, nc);

        if (r && r.ok) {
            execStep.update("done");
        } else {
            execStep.update("error", `Failed: ${r?.error || "Unknown error"}`);
        }

        if (r && r.newTabId) {
            tabId = r.newTabId;
            await ensureActiveAndFocused(tabId);
        }
        await ensureActiveAndFocused(tabId);

        try {
            const postState = tabId ? await sendToAgent(tabId, { t: "getPageState" }) : null;
            recordAction(nc, r, preState, postState);
        } catch { }

        state.lastCall = nc;
        state.lastCallAt = now;

        await new Promise(res => setTimeout(res, 1000));
        step++;
    }

    if (tabId) await sendToAgent(tabId, { t: "working", on: false });
    await finishRunState();
    await setRunning(false);
}
