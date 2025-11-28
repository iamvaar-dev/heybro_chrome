import { extractJson, log } from './utils.js';
import { fetchGlobalLogs } from './state.js';
import { sendToAgent, getBrowserState } from './tools.js';
import { Logger } from './logger.js';

export async function generatePlan(instruction, key, model, context = {}) {
    const url = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(key);

    const pageUrl = context.page ? context.page.url : "";
    const pageTitle = context.page ? context.page.title : "";

    const prompt = `You are a Browser Automation Agent. You can ONLY interact with websites within the Chrome browser. You CANNOT interact with the operating system, desktop applications, or physical hardware.

Task: ${String(instruction || "")}
Current Page: ${pageTitle} (${pageUrl})

Generate a plan of atomic BROWSER actions to achieve the task.
Allowed actions: Navigate to URL, Click element, Type text, Scroll, Read page content, Search on Google/Bing.
FORBIDDEN actions: Open system apps, Click Start Menu, Use desktop search, Physical actions, "Open Browser" (assume browser is open).

Return JSON with {"subtasks":[{"title":string,"status":"pending"|"completed"}]}.
IMPORTANT: Analyze the Current Page. If the user's goal is partially or fully achieved by the current state, mark those steps as "completed".
IMPORTANT: Break down repetitive tasks into individual subtasks. Do not use "Repeat steps" or "Do the same for...". List each iteration explicitly (e.g., "Navigate to Flipkart", "Navigate to Amazon", etc.).
Example: If task is "Search Wikipedia" and Current Page is "Wikipedia", the first step "Navigate to Wikipedia" should be marked "completed".`;

    const body = { contents: [{ role: "user", parts: [{ text: prompt }] }] };
    try {
        const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (!r.ok) return [];
        const j = await r.json();
        const s = j?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        let o = null; try { o = JSON.parse(s); } catch { o = extractJson(s); }
        const list = (o && Array.isArray(o.subtasks)) ? o.subtasks : [];
        return list.map(x => ({
            title: String(x.title || x || ""),
            status: x.status === "completed" ? "completed" : "pending"
        })).filter(st => st.title);
    } catch {
        return [];
    }
}

function elementsToText(elements) {
    return (elements || []).map(e => {
        const i = e.i || e.id || "";
        const t = e.t || "";
        const x = e.x || "";
        const l = e.l || "";
        const r = e.r || "";
        const h = e.h || "";
        const p = e.p || "";
        // Only include non-empty fields to save tokens
        const parts = [i, t];
        if (x) parts.push(x);
        if (l) parts.push(l);
        if (r) parts.push(r);
        if (h) parts.push(h);
        if (p) parts.push(p);
        return parts.map(v => String(v).replace(/\s+/g, " ").slice(0, 100)).join("|");
    }).join("\n");
}

function buildSystemPrompt(context, instruction, history, logsText, subtasks, nextSubtaskTitle) {
    const tabsCount = Array.isArray(context.tabs) ? context.tabs.length + 1 : 1;
    const activeTabId = context.activeTabId || "";
    const pageTitle = (context.page && context.page.title) || "";
    const pageUrl = (context.page && context.page.url) || "";
    const ready = !!(context.page && context.page.ready);
    const elementsCount = Array.isArray(context.elements) ? context.elements.length : 0;
    const sampleTabsArr = (Array.isArray(context.tabs) ? context.tabs.slice(0, 8) : []).map(t => ({ id: t.id, title: t.x, active: !!t.a }));
    const sampleTabs = JSON.stringify(sampleTabsArr);
    const elementsText = elementsToText(Array.isArray(context.elements) ? context.elements.slice(0, 2000) : []);
    const ocrList = Array.isArray(context.elements) ? context.elements.filter(e => e && e.o && String(e.o).trim().length > 0).slice(0, 40) : [];
    const ocrText = ocrList.map(e => [e.i || e.id || "", String(e.o || "").replace(/\s+/g, " ").slice(0, 200), e.b ? JSON.stringify(e.b) : ""].join("|")).join("\n");
    const planText = Array.isArray(subtasks) && subtasks.length ? subtasks.map((st, i) => {
        const t = String(st.title || st.name || "");
        const s = String(st.status || "pending");
        return `${i}. ${t} [${s}]`;
    }).join("\n") : "- (none)";
    const nextLine = nextSubtaskTitle ? `NEXT_SUBTASK:\n- ${nextSubtaskTitle}\n` : "";
    return `You are Heybro, a UI automation agent.
Goal: Help the user perform tasks on the web.

STATE:
- tabs=${tabsCount}, activeTabId=${activeTabId}
- page.title="${pageTitle}", page.url="${pageUrl}", ready=${ready}
- elements=${elementsCount}
- tabsList=${sampleTabs}

TASK:
- ${instruction}

SUBTASKS:
${planText}
${nextLine}

ELEMENTS (id|tag|text|label|role|href|placeholder):
${elementsText}

OCR:
${ocrText}

LOGS:
${logsText || ""}

HISTORY:
${history || "[]"}

MEMORY:
${JSON.stringify(context.memory || {})}

OUTPUT JSON:
{
  "thought": "Concise explanation of the next step.",
  "call": { "tool": "...", "args": { ... } },
  "subtask_updates": [ { "index": number, "status": "completed"|"active"|"pending" } ],
  "memory": { "key": "value" } // Optional: Update memory with new data
}

TOOLS:
- tap(id, element?), type(id, text, element?), scroll(to, amount), navigate(url), new_tab(url), switch_tab(tabId), search(query), wait(ms), read_page()

RULES:
1. Choose ONE next action.
2. Use specific IDs from ELEMENTS. If ID fails, provide 'element' signature (tag, text, role).
3. If task is "Search X" and you are on Google, type into the search box.
4. If you need to read content, use read_page.
5. Do not repeat successful actions.
6. When done, call "done" with a summary.
7. DYNAMIC PLANNING: You may update the plan if the current approach is failing or if new information requires it. Change subtask status to "skipped" or "failed" if needed.
8. PLAN INTEGRITY: Do NOT mark future subtasks as "completed" unless you have verified they are actually done.
9. If you are stuck in a loop, try a different approach (e.g., use a different URL, search engine, or skip the step).
10. MEMORY: Use the "memory" field to store important data (like prices, sellers) that you extract. This data will be available in the next turn.`;
}

// Compress elements using the optimized schema
function compressElements(elements) {
    return elements.map(el => {
        // Minimal compression
        const c = { i: el.i || el.id, t: el.t || el.tag };
        if (el.x || el.text) c.x = (el.x || el.text).slice(0, 50);
        if (el.l || el.label) c.l = (el.l || el.label).slice(0, 50);
        if (el.r || el.role) c.r = el.r || el.role;
        if (el.h || el.href) c.h = el.h || el.href;
        if (el.p || el.placeholder) c.p = el.p || el.placeholder;
        return c;
    });
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

// Build optimized context based on task requirements
async function buildDynamicContext(instruction, tabId) {
    // Guard against invalid tabId
    if (!tabId || typeof tabId !== 'number') {
        return {
            page: { url: "", title: "", ready: false },
            elements: []
        };
    }

    const task = instruction.toLowerCase();

    // Always include basic page info
    let pageState;
    try {
        pageState = await sendToAgent(tabId, { t: "getPageState" });
    } catch (e) {
        log("Failed to get page state: " + e.message);
        // Return minimal context on error
        return {
            page: { url: "", title: "", ready: false },
            elements: []
        };
    }
    const state = pageState?.state || {};

    const context = {
        page: {
            url: state.url || "",
            title: state.title || "",
            ready: state.readyState === "complete"
        },
        elements: [] // Will be populated below
    };

    try {
        const bs = await getBrowserState();
        const tabs = (bs && bs.tabs ? bs.tabs : [])
            .filter(t => t.id !== tabId)
            .slice(0, 8)
            .map(t => ({ id: t.id, x: String(t.title || "").slice(0, 30), a: t.isActive }));
        context.tabs = tabs;
        context.activeTabId = bs && bs.activeTabId ? bs.activeTabId : tabId;
    } catch (e) { }

    // Include scroll info for scrollable content or pagination tasks
    if (/scroll|bottom|more|load|next|previous|page|infinite/i.test(task)) {
        if (state.scroll) {
            const scrollY = state.scroll.y || 0;
            context.scroll = { y: scrollY };
        }
    }

    // Include form values for form-filling tasks
    if (/fill|form|submit|enter|type|login|register|signup|password/i.test(task)) {
        try {
            const forms = await sendToAgent(tabId, { t: "getFormState" });
            if (forms?.state && Object.keys(forms.state).length > 0) {
                context.form = forms.state;
            }
        } catch (e) {
            log("Failed to get form state: " + e.message);
        }
    }

    // Include selected text if any
    if (/select|copy|highlight|text/i.test(task)) {
        if (state.selectedText) {
            context.selectedText = state.selectedText.slice(0, 200);
        }
    }

    // Include active element for input-focused tasks
    if (/type|input|focus|cursor/i.test(task)) {
        if (state.activeElement) {
            context.activeElement = {
                tag: state.activeElement.tag,
                type: state.activeElement.type,
                text: state.activeElement.text?.slice(0, 50)
            };
        }
    }

    return context;
}

export async function callGemini(elements, instruction, key, model, tabId, history, memory) {
    const url = "https://generativelanguage.googleapis.com/v1beta/models/" +
        encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(key);

    // Build dynamic context instead of raw page state
    let context;
    try {
        if (!tabId || typeof tabId !== 'number') {
            const fallbackTab = await getInjectableTabId();
            if (fallbackTab && typeof fallbackTab === 'number') {
                tabId = fallbackTab;
                context = await buildDynamicContext(instruction, tabId);
                context.elements = compressElements(elements);
            } else {
                context = {
                    page: { url: "", title: "", ready: false },
                    elements: compressElements(elements)
                };
            }
        } else {
            context = await buildDynamicContext(instruction, tabId);
            context.elements = compressElements(elements);
            context.memory = memory;
        }
    } catch (e) {
        log("Context building failed, using fallback: " + e.message);
        // Fallback to basic context
        context = {
            page: { url: "", title: "", ready: false },
            elements: compressElements(elements)
        };
    }

    const logs = await fetchGlobalLogs().then(ls => (ls || []).slice(-100).join("\n"));
    let subtasks = [];
    let nextTitle = "";
    try {
        const r = await chrome.runtime.sendMessage({ t: "GET_TASK_CONTEXT" });
        const ctx = r && r.taskContext ? r.taskContext : null;
        if (ctx && Array.isArray(ctx.subtasks)) {
            subtasks = ctx.subtasks;
            const idx = subtasks.findIndex(st => String(st.status || "") !== "completed");
            if (idx >= 0) nextTitle = String(subtasks[idx].title || subtasks[idx].name || "");
        }
    } catch { }
    const body = {
        contents: [{
            role: "user",
            parts: [{
                text: buildSystemPrompt(context, instruction, history, logs, subtasks, nextTitle)
            }]
        }]
    };

    Logger.info({ type: "planner_prompt", prompt: body.contents[0].parts[0].text });

    let j;
    try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 60000);
        const r = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: ctrl.signal
        });
        clearTimeout(to);
        if (!r.ok) {
            try { const e = await r.text(); log(e); Logger.error({ type: "planner_error", error: e }); } catch { }
            return null;
        }
        j = await r.json();
    } catch (e) {
        log("network_error: " + (e && e.message ? e.message : String(e)));
        Logger.error({ type: "planner_network_error", error: e.message });
        return null;
    }
    const s = j?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    Logger.info({ type: "planner_response", response: s });
    return extractJson(s);
}
