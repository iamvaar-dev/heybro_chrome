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

Generate a plan of 3-7 atomic BROWSER actions to achieve the task.
Allowed actions: Navigate to URL, Click element, Type text, Scroll, Read page content, Search on Google/Bing.
FORBIDDEN actions: Open system apps, Click Start Menu, Use desktop search, Physical actions, "Open Browser" (assume browser is open).

Return JSON with {"subtasks":[{"title":string,"status":"pending"|"completed"}]}.
IMPORTANT: Analyze the Current Page. If the user's goal is partially or fully achieved by the current state, mark those steps as "completed".
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
        const i = e.i !== undefined ? e.i : (e.id !== undefined ? e.id : "");
        const t = e.t || e.tag || e.type || "";
        const y = e.y || e.type || "";
        const r = e.r || e.role || "";
        const x = e.x || e.text || "";
        const l = e.l || e.label || "";
        const h = e.h || e.href || "";
        const p = e.p || e.placeholder || "";
        const o = e.o || e.ocr || "";
        const b = e.b ? JSON.stringify(e.b) : "";
        return [i, t, y, r, x, l, h, p, o, b].map(v => String(v || "").replace(/\s+/g, " ").slice(0, 200)).join("|");
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
    return `You are Heybro, an intelligent and enthusiastic UI automation agent.
Your goal is to help the user navigate the web and perform tasks with a friendly, narrative style.
Think of yourself as a smart companion sitting next to the user, explaining what you see and what you're doing.

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

 ELEMENTS:
 ${elementsText}

OCR:
${ocrText}

LOGS:
${logsText || ""}

HISTORY:
${history || "[]"}
(History keys: t=tool, a=args, ok=success, r=result, u=url, m=dom_mutations_count)

ALIGNMENT:
- Align the next action with the earliest pending subtask from SUBTASKS.
- If already on the destination of a subtask (e.g., target host/tab), skip redundant navigation and advance to the next subtask.
- Prefer in-site search/navigation over generic web search when applicable.

OUTPUT:
- Return JSON with:
  {
    "thought": "A friendly, concise, human-readable explanation of what you are doing. Do NOT mention tool names like 'tap', 'type', or 'switch_tab'. Instead say 'I'll click...', 'Typing...', 'Switching to tab...'. If you are waiting, explain why.",
    "call": { "tool": "...", "args": { ... } },
    "subtask_updates": [ { "index": number, "status": "completed"|"active"|"pending" } ]
  }
- Provide exactly ONE next step in 'call'.
- Analyze the current page state (URL, title, elements) to determine if any pending subtasks have been completed.
- If a subtask is completed, include it in 'subtask_updates'.
- IMPORTANT: Use the exact index number from the SUBTASKS list for the 'index' field.

ROLE:
- Understand the task end-to-end, plan sub-steps, and execute UI actions until done. Treat this as a continuous UI automation loop.
- CRITICAL: You can ONLY interact with the web page content (DOM). You CANNOT interact with the browser chrome (address bar, bookmarks, settings) or use browser keyboard shortcuts (e.g., Ctrl+F, Ctrl+T, Ctrl+P).
- CRITICAL: Do NOT plan steps like "Open browser Find function". Instead, use the 'search' tool or 'type' into a page's search bar.

PERSONA:
- Be conversational and context-aware.
- If you see search results, mention them: "I see a few options here..."
- If you are typing, say what you are typing: "Typing 'artificial intelligence'..."
- If you succeed, celebrate briefly: "Great! We are on the page."
- Avoid robotic "I will now..." phrases. Use "Let me...", "I'll...", "Okay, now..."
- Keep thoughts SHORT and SIMPLE. Avoid long paragraphs.

PLANNING:
- Protocol per step:
  1) Fetch current page state and elements (already provided)
  2) Choose exactly one next action
  3) Include any necessary pre-waits (use 'wait' with conditions)
  4) After actions like navigate/tap/type, verify state change via 'wait' or 'verifyAfter'
  5) Do not repeat successful steps listed in HISTORY
- Derive a minimal ordered plan: navigate/open → wait/verify → interact → verify → done.
- Always include a wait/verify after navigation, tab switches, or when element presence is uncertain.

TOOLS:
- tap, type, focus, submit, select, check, press, copy, paste, scroll, navigate, new_tab, switch_tab, search, wait, read_page
- NOTE: 'press' sends keys to the page. Use it for 'Enter' to submit forms or 'Escape' to close modals. Do NOT use it for browser shortcuts.

TOOL USAGE:
- new_tab: { url: string } -> PREFER this over new_tab() + navigate(). Opens a new tab directly to the URL.
- read_page: {} -> Returns the simplified text content of the page. Use this to read articles or get a summary of the page state.
- navigate: { url: string } -> Navigates the current tab to the URL.
- search: { query: string } -> Performs a Google search in the current tab (or new tab if specified).

RULES:
- Prefer specific selectors/ids; fallback to xpath/text when needed
- Include waits after navigation; verify element presence before interacting
- Avoid repeating successful actions
- Use 'search' only when not on the target site and no in-site search input is available; otherwise prefer typing into the site's search box and submitting, or navigating directly to the site's search results URL
- Use HISTORY to avoid re-running actions that already succeeded
- If you encounter a character limit warning (e.g., negative counter, red text) or a "Text truncated" error from the tool result, you MUST rewrite the content to be shorter and re-type it. Do not just submit.

SIGNATURES:
- For 'tap', include an 'element' with fields from ELEMENTS (i,t,y,r,x,l,h,p) or provide a 'signature' {tag,role,text,label,href,placeholder,testid}
- If a link has a known 'href', prefer direct 'navigate' to that URL if tapping fails

VERIFICATION:
- After 'tap' or 'navigate', include 'verifyAfter' when appropriate, e.g., { urlIncludes: "youtube.com" } or { element: { text: "Results" } }
- Use 'wait' with { selector/text, visible:true, clickable:true, domStableMs } before interacting when needed

COMPLETION:
- When the main task is truly complete, return { "thought": "I have completed the task!", "call": { "tool": "done", "args": { "text": "Here is the answer or summary..." } } }.`;
}

// Compress elements using the optimized schema
function compressElements(elements) {
    return elements.map(el => {
        const compressed = {
            i: el.i || el.id,
            t: el.t || el.tag || el.type,
            x: el.x || el.text || "",
            y: el.y || el.type
        };

        // Enrich with signature-friendly fields
        if (el.r || el.role) compressed.r = el.r || el.role;
        if (el.l || el.label) compressed.l = el.l || el.label;
        if (el.p || el.placeholder) compressed.p = el.p || el.placeholder;
        if (el.h || el.href) compressed.h = el.h || el.href;
        if (el.f !== undefined) compressed.f = el.f;
        if (el.v !== undefined) compressed.v = el.v;
        if (el.e !== undefined) compressed.e = el.e;
        if (el.s !== undefined) compressed.s = el.s;
        if (el.b) compressed.b = el.b;
        if (el.o || el.ocr) compressed.o = el.o || el.ocr;

        return compressed;
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

export async function callGemini(elements, instruction, key, model, tabId, history) {
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
