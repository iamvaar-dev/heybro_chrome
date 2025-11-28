
import { state, startRunState, finishRunState, appendLog, setSessionTitle } from './state.js';
import { getEls, setRunning, appendBlock, streamText, showAnswer, collapseLogs, setTask, setLiveTask, removeLiveTask, logCompletedTask, updatePlanItem, toContinuous } from './ui.js';
import { generatePlan, callGemini } from './planner.js';
import { execTool, normalizeCall, sendToAgent, ensureActiveAndFocused, waitReady, isIgnoredUrl } from './tools.js';
import { log, hostFromUrl, extractTargetDomain } from './utils.js';
import { Logger } from './logger.js';

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

function normalizeResultForHistory(result) {
    if (!result) return undefined;
    const r = {};
    if (result.text) r.text = String(result.text).slice(0, 1000); // Capture up to 1000 chars of text content
    if (result.newTabId) r.newTabId = result.newTabId;
    if (result.url) r.url = result.url;
    if (result.error) r.error = result.error;
    if (result.searchUrl) r.searchUrl = result.searchUrl;
    if (result.mutationCount !== undefined) r.m = result.mutationCount;
    return r;
}

function recordAction(action, result, preState, postState) {
    const h = {
        t: action.tool || action.action,
        a: normalizeArgsForHistory(action.args || {}),
        ok: !!(result && result.ok),
        r: normalizeResultForHistory(result),
        u: postState && postState.state && postState.state.url ? postState.state.url : (preState && preState.state && preState.state.url ? preState.state.url : ""),
        ts: Date.now(),
        v: postState && postState.state && postState.state.lastInteraction ? postState.state.lastInteraction : null,
        m: postState && postState.state ? postState.state.mutationCount : 0
    };
    state.currentRunActions.push(h);
    if (state.currentRunActions.length > 50) state.currentRunActions = state.currentRunActions.slice(-50);
    if (!h.ok) {
        try { chrome.runtime.sendMessage({ t: "TASK_RECORD_ERROR", action: action, error: result && result.error ? result.error : "action_failed" }); } catch { }
    }
    try { chrome.runtime.sendMessage({ t: "TASK_MEMORY_RECORD_ACTION", action, result, preState, postState }); } catch { }
}

function buildHistoryForPrompt(maxItems = 20) {
    const rawItems = state.currentRunActions.slice(-maxItems);
    const items = JSON.parse(JSON.stringify(rawItems));

    // Aggressive pruning
    for (let i = 0; i < items.length; i++) {
        const isRecent = i >= items.length - 5;

        // Truncate text content heavily
        if (items[i].r && items[i].r.text) {
            items[i].r.text = isRecent ? items[i].r.text.slice(0, 100) + "..." : "<text_hidden>";
        }

        // For older items, remove args and result details to save tokens
        if (!isRecent) {
            if (items[i].a) delete items[i].a;
            if (items[i].r) delete items[i].r;
            // Keep only tool name and status
        }
    }
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

async function ensurePlanForInstruction(instruction, context = {}) {
    const key = state.geminiKey.trim();
    const model = state.geminiModel.trim();
    let plan = [];

    streamText("Preparing to assist you...\n");

    if (key && model) {
        plan = await generatePlan(instruction, key, model, context).catch(() => []);
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

    if (Array.isArray(plan) && plan.length) {
        try { await chrome.runtime.sendMessage({ t: "UPDATE_TASK_CONTEXT", patch: { subtasks: plan } }); } catch { }
        streamText("I have created a plan. Let's get started.\n");
        // Restore initial plan dump
        appendBlock(plan, "plan");
        return plan;
    }
    return [];
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
    state.runAttemptId++;
    const myRunId = state.runAttemptId;
    await setRunning(true);
    if (state.runAttemptId !== myRunId) return;

    let tabId = await getInjectableTabId();
    const key = state.geminiKey.trim();
    const model = state.geminiModel.trim();
    const instruction = els.instruction.value.trim();

    if (!instruction) {
        await setRunning(false);
        return;
    }

    setTask(instruction, true);
    setSessionTitle(instruction);
    appendBlock(instruction, "user");
    els.instruction.value = "";
    els.instruction.style.height = "auto";

    if (!key) {
        streamText("Please add your Gemini API Key in Settings to continue.");
        await setRunning(false);
        return;
    }

    if (state.runAttemptId !== myRunId) return;

    startRunState("auto", instruction);

    let currentPlan = [];

    // Initial context build for planning
    let initialTabId = await getInjectableTabId();
    let initialContext = {};
    if (initialTabId) {
        try {
            const pageState = await sendToAgent(initialTabId, { t: "getPageState" });
            if (pageState && pageState.state) {
                initialContext.page = pageState.state;
            }
        } catch { }
    }

    currentPlan = await ensurePlanForInstruction(instruction, initialContext);

    // Initialize memory if not present
    if (!state.memory) state.memory = {};

    if (state.runAttemptId !== myRunId) return;

    // Initialize Live Task immediately
    if (currentPlan.length > 0) {
        setLiveTask(toContinuous(currentPlan[0].title));
    }

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
    if (state.runAttemptId !== myRunId) return;



    const recentActions = [];

    while (!state.autoStop && step < 500) {
        if (state.runAttemptId !== myRunId) return;
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
                elements = state.experimentalMode ? await mapCompact(tabId) : await simplify(tabId, state.showIDs);
                // Fallback: If mapCompact returns 0 elements (likely due to message size limit), try simplify
                if (state.experimentalMode && elements.length === 0) {
                    elements = await simplify(tabId, state.showIDs);
                }
            } catch (e) {
                try {
                    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["content.js"] });
                    await new Promise(resolve => setTimeout(resolve, 500));
                    elements = state.experimentalMode ? await mapCompact(tabId) : await simplify(tabId, state.showIDs);
                    if (state.experimentalMode && elements.length === 0) {
                        elements = await simplify(tabId, state.showIDs);
                    }
                } catch { }
            }
        }

        // Update plan status from context
        try {
            const r = await chrome.runtime.sendMessage({ t: "GET_TASK_CONTEXT" });
            const subtasks = r?.taskContext?.subtasks || [];
            if (subtasks.length) currentPlan = subtasks;
        } catch { }

        if (state.autoStop) break;
        if (state.runAttemptId !== myRunId) return;

        const response = await callGemini(elements, instruction, key, model, tabId, buildHistoryForPrompt());

        if (state.autoStop) break;
        if (state.runAttemptId !== myRunId) return;

        if (!response) {
            streamText("Planner failed to respond. Retrying...\n");
            await new Promise(res => setTimeout(res, 2000));
            continue;
        }

        const thought = response?.thought || "";
        const action = response?.call || response; // Fallback if no thought structure
        const subtaskUpdates = response?.subtask_updates || [];

        if (thought) {
            streamText(thought + "\n");
        }

        // Apply LLM-driven plan updates logic MOVED to after tool execution
        // to implement Zero Point Failure logic.

        // Update Live Task UI
        const activeTaskIdx = currentPlan.findIndex(t => t.status === "active" || t.status === "pending");
        if (activeTaskIdx >= 0) {
            setLiveTask(toContinuous(currentPlan[activeTaskIdx].title));
            updatePlanItem(activeTaskIdx, "active");
        } else if (currentPlan.length > 0 && currentPlan.every(t => t.status === "completed")) {
            setLiveTask("Finishing up...");
        } else {
            setLiveTask("Thinking...");
        }

        const nc = pickNextCall(action);

        // Loop detection
        if (nc) {
            const actionKey = JSON.stringify(nc);
            recentActions.push(actionKey);
            if (recentActions.length > 5) recentActions.shift();

            // Check if we've done this exact action 3 times in the last 5 steps
            const repeats = recentActions.filter(k => k === actionKey).length;
            if (repeats >= 3) {
                streamText("I seem to be stuck in a loop. I will pause to re-evaluate.\n");
                // Force a wait or a different strategy? For now, just break to avoid infinite costs
                // But better: try to scroll or wait
                if (nc.tool !== "wait" && nc.tool !== "scroll") {
                    streamText("Trying to scroll to break the loop...\n");
                    await execTool(tabId, { tool: "scroll", args: { amount: 300 } });
                    // Inject a "stuck" message into the history so the planner knows
                    state.currentRunActions.push({
                        t: "system",
                        a: { message: "Agent detected a loop. The last action was repeated 3 times. Please change strategy." },
                        ok: false,
                        r: { error: "loop_detected" },
                        ts: Date.now()
                    });
                    continue;
                }
            }
        }

        tabId = await ensureExistingTab(tabId);
        const preState = tabId ? await sendToAgent(tabId, { t: "getPageState" }) : null;

        if (!nc) break;
        if (nc.tool === "done") {
            if (!thought) streamText("I have completed the task.\n");
            // Mark all as done and log them
            currentPlan.forEach((t, idx) => {
                if (t.status !== "completed") {
                    t.status = "completed";
                    logCompletedTask(t.title);
                    updatePlanItem(idx, "completed");
                }
            });
            // Removed final plan dump
            // appendBlock(currentPlan, "plan");

            // Show answer if provided
            if (nc.args && nc.args.text) {
                showAnswer(nc.args.text);
            }

            // Collapse logs on completion
            collapseLogs();
            removeLiveTask(); // Clean up live task
            break;
        }

        // Dedup logic
        const now = Date.now();
        const isWait = nc.tool === "wait";
        const isScroll = nc.tool === "scroll";
        // Allow faster repeats for wait/scroll, but enforce longer delay for others if successful
        const dedupTime = (isWait || isScroll) ? 1000 : 5000;

        if (state.lastCall && callsEqual(state.lastCall, nc)) {
            // If last call failed, we might want to retry immediately, so don't block unless it's very fast spam
            if (state.lastCallResult && !state.lastCallResult.ok) {
                if (now - state.lastCallAt < 500) continue;
            } else {
                // If last call succeeded, check if state has changed significantly (mutations)
                const currentMutations = preState && preState.state ? preState.state.mutationCount : 0;
                const lastMutations = state.lastMutations || 0;
                const mutationDiff = currentMutations - lastMutations;

                // If significant mutations occurred (> 2), allow re-execution as it might be a toggle or state change
                if (mutationDiff > 2) {
                    // Allow execution, but maybe log it
                } else {
                    // Enforce the dedup time to prevent accidental double-clicks due to slow state updates
                    if (now - state.lastCallAt < dedupTime) {
                        continue;
                    }
                }
            }
        }

        // Narrative output - only if no thought was provided
        if (!thought) {
            const desc = describeCall(nc);
            streamText(`I will now ${desc.toLowerCase()}.\n`);
        }

        // Show action block - REMOVED for cleaner UI as per user request
        // const desc = describeCall(nc);
        // appendBlock(`> ${desc}`, "action");

        if (state.autoStop) break;

        await ensureActiveAndFocused(tabId);

        // ZERO POINT FAILURE: Inject element details for robust retry
        if ((nc.tool === "tap" || nc.tool === "type") && nc.args && nc.args.id && !nc.args.element && !nc.args.signature) {
            const targetId = Number(nc.args.id);
            const foundEl = elements.find(e => e.i === targetId || e.id === targetId);
            if (foundEl) {
                // Reconstruct the element object expected by tools.js
                nc.args.element = {
                    i: foundEl.i || foundEl.id,
                    t: foundEl.t || foundEl.tag || foundEl.type,
                    x: foundEl.x || foundEl.text,
                    r: foundEl.r || foundEl.role,
                    l: foundEl.l || foundEl.label,
                    h: foundEl.h || foundEl.href,
                    p: foundEl.p || foundEl.placeholder
                };
                Logger.info({ type: "injected_element_details", id: targetId, element: nc.args.element });
            }
        }

        const r = await execTool(tabId, nc);
        if (state.runAttemptId !== myRunId) return;

        if (r && r.ok) {
            // Update plan status based on progress
            const pendingIdx = currentPlan.findIndex(t => t.status === "pending");
            if (pendingIdx >= 0) {
                // We trust the tool execution success now that verification is improved
                if (nc.tool !== "wait" && nc.tool !== "scroll") {
                    // Only mark as active, NEVER auto-complete the previous task here.
                    // We rely strictly on the planner's subtask_updates to mark tasks as completed.
                    if (currentPlan[pendingIdx].status === "pending") {
                        currentPlan[pendingIdx].status = "active";
                        updatePlanItem(pendingIdx, "active");

                        // Persist state immediately
                        try { await chrome.runtime.sendMessage({ t: "UPDATE_TASK_CONTEXT", patch: { subtasks: currentPlan } }); } catch { }
                    }
                }
            }

            // Apply LLM-driven plan updates ONLY if tool execution succeeded (Zero Point Failure)
            if (Array.isArray(subtaskUpdates) && subtaskUpdates.length > 0) {
                let planChanged = false;
                for (const update of subtaskUpdates) {
                    if (update.index !== undefined && update.index >= 0 && update.index < currentPlan.length) {
                        if (currentPlan[update.index].status !== update.status) {
                            currentPlan[update.index].status = update.status;
                            planChanged = true;

                            // Trigger UI updates immediately
                            if (update.status === "completed") {
                                logCompletedTask(currentPlan[update.index].title);
                                updatePlanItem(update.index, "completed");
                            } else if (update.status === "active") {
                                updatePlanItem(update.index, "active");
                            }
                        }
                    }
                }
                if (planChanged) {
                    try { await chrome.runtime.sendMessage({ t: "UPDATE_TASK_CONTEXT", patch: { subtasks: currentPlan } }); } catch { }
                }
            }
        } else {
            streamText(`I encountered an issue: ${r?.error || "Unknown error"}. Retrying...\n`);
        }

        if (r && (r.newTabId || r.activeTabId || r.newActiveTabId)) {
            tabId = r.newTabId || r.activeTabId || r.newActiveTabId;
            await ensureActiveAndFocused(tabId);
        }
        await ensureActiveAndFocused(tabId);
        if (state.runAttemptId !== myRunId) return;

        let postState = null;
        try {
            postState = tabId ? await sendToAgent(tabId, { t: "getPageState" }) : null;
        } catch { }
        recordAction(nc, r, preState, postState);

        state.lastCall = nc;
        state.lastCallAt = now;
        state.lastCallResult = r;
        state.lastMutations = postState && postState.state ? postState.state.mutationCount : 0;

        await new Promise(res => setTimeout(res, 1000));
        if (state.runAttemptId !== myRunId) return;
        step++;
    }

    if (state.runAttemptId !== myRunId) return;

    if (tabId) await sendToAgent(tabId, { t: "working", on: false });
    await finishRunState();
    setRunning(false);
}


// End of agent.js
