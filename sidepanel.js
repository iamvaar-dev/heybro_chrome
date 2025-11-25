const instructionEl = document.getElementById("instruction");
const geminiKeyEl = document.getElementById("gemini-key");
const geminiModelEl = document.getElementById("gemini-model");
const sendBtnEl = document.getElementById("send-btn");
const annotateEl = document.getElementById("annotate");
const clearEl = document.getElementById("clear");
const logEl = document.getElementById("log");
const copyLogsEl = document.getElementById("copy-logs");
const barEl = document.getElementById("bar");
const modeStdEl = document.getElementById("mode-standard");
const modeExpEl = document.getElementById("mode-experimental");
const screenChatEl = document.getElementById("screen-chat");
const screenSettingsEl = document.getElementById("screen-settings");
const screenToolsEl = document.getElementById("screen-tools");
const screenLogsEl = document.getElementById("screen-logs");
const menuBtnEl = document.getElementById("menu-btn");
const menuPanelEl = document.getElementById("menu-panel");
const menuSettingsEl = document.getElementById("menu-settings");
const menuToolsEl = document.getElementById("menu-tools");
const menuLogsEl = document.getElementById("menu-logs");
const chatMessagesEl = document.getElementById("chat-messages");

let experimentalMode = false;
let currentRunId = null;
let currentRunBuffer = [];
let currentRunMeta = null;
let currentRunActions = [];
let autoStop = false;
let lastCall = null;
let lastCallAt = 0;
let lastEnterPressedAt = 0;
let newTabsOpened = 0;
let openedHrefs = new Set();
let stuckCount = 0;
let __hb_ocr_worker = null;
let __hb_current_agent_msg = null;
let __hb_semantics = { addToCartAt: 0, onCartPageAt: 0 };

function showScreen(name) {
  const all = [screenChatEl, screenSettingsEl, screenToolsEl, screenLogsEl];
  for (const el of all) if (el) el.classList.remove("active");
  if (name === "chat" && screenChatEl) screenChatEl.classList.add("active");
  if (name === "settings" && screenSettingsEl) screenSettingsEl.classList.add("active");
  if (name === "tools" && screenToolsEl) screenToolsEl.classList.add("active");
  if (name === "logs" && screenLogsEl) screenLogsEl.classList.add("active");
}

function initMenu() {
  if (menuBtnEl) {
    menuBtnEl.addEventListener("click", () => {
      const vis = menuPanelEl && menuPanelEl.style.display !== "none";
      if (menuPanelEl) menuPanelEl.style.display = vis ? "none" : "block";
    });
  }
  function open(name) {
    if (menuPanelEl) menuPanelEl.style.display = "none";
    showScreen(name);
  }
  if (menuSettingsEl) menuSettingsEl.addEventListener("click", () => open("settings"));
  if (menuToolsEl) menuToolsEl.addEventListener("click", () => open("tools"));
  if (menuLogsEl) menuLogsEl.addEventListener("click", () => open("logs"));
}

function appendChatMessage(role, text) {
  if (!chatMessagesEl) return;
  const row = document.createElement("div");
  row.className = "chat-msg";
  const r = document.createElement("div");
  r.className = "chat-role";
  r.textContent = role === "user" ? "You" : "Agent";
  const c = document.createElement("div");
  c.className = "chat-main";
  c.textContent = String(text || "");
  const details = document.createElement("div");
  details.className = "chat-details";
  details.style.display = "none";
  const toggle = document.createElement("button");
  toggle.className = "toggle-details btn secondary";
  toggle.textContent = "Details";
  toggle.addEventListener("click", () => {
    const vis = details.style.display !== "none";
    details.style.display = vis ? "none" : "block";
  });
  const body = document.createElement("div");
  body.appendChild(c);
  body.appendChild(toggle);
  body.appendChild(details);
  row.appendChild(r);
  row.appendChild(body);
  chatMessagesEl.appendChild(row);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  if (role !== "user") __hb_current_agent_msg = { row, main: c, details };
}

function beginAgentMessage(text) {
  appendChatMessage("agent", text);
}

function agentUpdateMain(text) {
  if (!__hb_current_agent_msg) return;
  __hb_current_agent_msg.main.textContent = String(text || "");
}

function agentAddDetail(text) {
  if (!__hb_current_agent_msg) return;
  const line = document.createElement("div");
  line.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  line.style.fontSize = "12px";
  line.textContent = String(text || "");
  __hb_current_agent_msg.details.appendChild(line);
}

// internal plan is shown only inside chat details; no external list renderer

function startRun(type, instruction) {
  currentRunId = String(Date.now());
  currentRunBuffer = [];
  currentRunMeta = { type, instruction, startedAt: Date.now() };
  currentRunActions = [];
  logEl.textContent = "";
  try {
    chrome.runtime.sendMessage({ t: "SET_TASK_CONTEXT", ctx: { currentGoal: instruction } });
  } catch {}
  newTabsOpened = 0;
  openedHrefs = new Set();
  try { chrome.runtime.sendMessage({ t: "TASK_MEMORY_RESET" }); } catch {}
  appendChatMessage("user", instruction);
  beginAgentMessage("Running task");
}

function log(x) {
  const s = typeof x === "string" ? x : JSON.stringify(x);
  currentRunBuffer.push(s);
  logEl.textContent = currentRunBuffer.join("\n");
}

async function finishRun() {
  if (!currentRunId) return;
  const data = {};
  data["run_" + currentRunId] = {
    id: currentRunId,
    meta: { ...currentRunMeta, endedAt: Date.now() },
    logs: currentRunBuffer
  };
  await chrome.storage.local.set(data);
  try {
    if (__hb_ocr_worker && __hb_ocr_worker.terminate) {
      await __hb_ocr_worker.terminate();
    }
  } catch {}
  __hb_ocr_worker = null;
  try { await updateMemorySummary(); } catch {}
  try { await chrome.runtime.sendMessage({ t: "TASK_MEMORY_RESET" }); } catch {}
}

async function loadSettings() {
  const s = await chrome.storage.local.get(["geminiKey", "geminiModel", "experimentalMode"]);
  geminiKeyEl.value = s.geminiKey || "";
  geminiModelEl.value = s.geminiModel || "gemini-2.5-flash";
  experimentalMode = (s.experimentalMode !== undefined) ? !!s.experimentalMode : true;
  syncModeUI();
}

let __hb_log_timer = null;
async function fetchGlobalLogs() {
  try { const r = await chrome.runtime.sendMessage({ t: "GET_LOGS" }); return (r && r.logs) ? r.logs : []; } catch { return []; }
}
async function renderCombinedLogs() {
  const gl = await fetchGlobalLogs();
  const rl = currentRunBuffer || [];
  const lines = [].concat(gl).concat(rl.length ? [""] : []).concat(rl);
  logEl.textContent = lines.join("\n");
}
function startLogStreaming() {
  if (__hb_log_timer) return;
  __hb_log_timer = setInterval(renderCombinedLogs, 1000);
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
    return [i,t,y,r,x,l,h,p,o,b].map(v => String(v || "").replace(/\s+/g, " ").slice(0, 200)).join("|");
  }).join("\n");
}

function parseTargetUrl(instruction) {
  const text = String(instruction || "").toLowerCase();
  const explicit = text.match(/https?:\/\/\S+/);
  if (explicit) return explicit[0];
  const domainMatch = text.match(/\b([a-z0-9-]+\.(?:com|in|net|org|io|ai|app|dev|store|shop|co|me|tv|info))(?:\b|\s|$)/);
  if (domainMatch) return "https://" + domainMatch[1];
  const siteMatch = text.match(/\b(on|open|go to)\s+([a-z0-9-]+)/);
  const site = siteMatch ? siteMatch[2] : "";
  const map = {
    youtube: "https://www.youtube.com",
    google: "https://www.google.com",
    bing: "https://www.bing.com",
    duckduckgo: "https://duckduckgo.com"
  };
  if (map[site]) return map[site];
  return "https://www.google.com";
}

async function generatePlan(instruction, key, model) {
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(key);
  const prompt = "Task: " + String(instruction || "") + "\nReturn JSON with {\"subtasks\":[{\"title\":string}]} focusing on 3-7 atomic UI actions.";
  const body = { contents: [{ role: "user", parts: [{ text: prompt }]}] };
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) return [];
    const j = await r.json();
    const s = j?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    let o = null; try { o = JSON.parse(s); } catch { o = extractJson(s); }
    const list = (o && Array.isArray(o.subtasks)) ? o.subtasks : [];
    return list.map(x => ({ title: String(x.title || x || ""), status: "pending" })).filter(st => st.title);
  } catch {
    return [];
  }
}

function fallbackPlanFromInstruction(instruction) {
  const text = String(instruction || "").toLowerCase();
  const domain = extractTargetDomain(text);
  const steps = [];
  if (domain) {
    steps.push({ title: `Navigate to ${domain}` });
    steps.push({ title: "Wait until page is ready" });
    steps.push({ title: "Find relevant element(s)" });
    steps.push({ title: "Interact and verify result" });
  } else {
    steps.push({ title: "Open site or perform web search" });
    steps.push({ title: "Wait until results are visible" });
    steps.push({ title: "Click a relevant result" });
    steps.push({ title: "Verify destination page" });
  }
  return steps.map(st => ({ title: String(st.title), status: "pending" }));
}

async function ensurePlanForInstruction(instruction) {
  const key = geminiKeyEl.value.trim();
  const model = geminiModelEl.value.trim();
  let plan = [];
  if (key && model) {
    plan = await generatePlan(instruction, key, model).catch(() => []);
  }
  if (!plan || !plan.length) {
    plan = fallbackPlanFromInstruction(instruction);
  }
  if (Array.isArray(plan) && plan.length) await savePlan(plan);
}

async function savePlan(subtasks) {
  try { await chrome.runtime.sendMessage({ t: "UPDATE_TASK_CONTEXT", patch: { subtasks } }); } catch {}
  try { agentAddDetail("Plan created: " + String(subtasks.length) + " subtasks"); } catch {}
}

async function completeNextSubtask() {
  let ctx = null;
  try { const r = await chrome.runtime.sendMessage({ t: "GET_TASK_CONTEXT" }); ctx = r && r.taskContext ? r.taskContext : null; } catch {}
  const list = (ctx && Array.isArray(ctx.subtasks)) ? ctx.subtasks : [];
  const idx = list.findIndex(st => String(st.status || "") !== "completed");
  if (idx >= 0) {
    const updated = list.map((st, i) => (i === idx) ? { ...st, status: "completed" } : st);
    try { await chrome.runtime.sendMessage({ t: "UPDATE_TASK_CONTEXT", patch: { subtasks: updated } }); } catch {}
    try { agentAddDetail("Completed subtask: " + String(list[idx].title || list[idx].name || "")); } catch {}
  }
}

async function updateMemorySummary() {
  let mem = null;
  try { const r = await chrome.runtime.sendMessage({ t: "TASK_MEMORY_GET" }); mem = r && r.memory ? r.memory : null; } catch {}
  const key = geminiKeyEl.value.trim();
  const model = geminiModelEl.value.trim();
  if (!key || !model) {
    const o = {
      goal: currentRunMeta?.instruction || "",
      steps: (currentRunActions || []).map(h => ({ tool: h.t, args: h.a, ok: h.ok, url: h.u })),
      keyResults: [],
      errors: []
    };
    try { await chrome.runtime.sendMessage({ t: "UPDATE_TASK_CONTEXT", patch: { collectedData: { summary: o } } }); } catch {}
    return;
  }
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(key);
  const textLogs = (mem && Array.isArray(mem.logs)) ? mem.logs.slice(-60).join("\n") : "";
  const textActions = (mem && Array.isArray(mem.actions)) ? JSON.stringify(mem.actions.slice(-40)) : "[]";
  const prompt = "Summarize the recent automation session in stable JSON with keys goal, steps, keyResults, errors. Keep under 20 lines. Logs:\n" + textLogs + "\nActions:\n" + textActions;
  const body = { contents: [{ role: "user", parts: [{ text: prompt }]}] };
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) return;
    const j = await r.json();
    const s = j?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    let o = null; try { o = JSON.parse(s); } catch { o = extractJson(s); }
    if (!o) return;
    try { await chrome.runtime.sendMessage({ t: "UPDATE_TASK_CONTEXT", patch: { collectedData: { summary: o } } }); } catch {}
  } catch {}
}

async function ensureInitialTabForInstruction(instruction) {
  let tabId = await getInjectableTabId();
  if (tabId) return tabId;
  const url = parseTargetUrl(instruction);
  const r = await execTool(0, { tool: "new_tab", args: { url } });
  return r && r.newTabId ? r.newTabId : undefined;
}

async function saveSettings() {
  await chrome.storage.local.set({
    geminiKey: geminiKeyEl.value,
    geminiModel: geminiModelEl.value,
    experimentalMode
  });
}

geminiKeyEl.addEventListener("input", saveSettings);
geminiModelEl.addEventListener("input", saveSettings);
modeStdEl.addEventListener("click", () => { experimentalMode = false; syncModeUI(); saveSettings(); });
modeExpEl.addEventListener("click", () => { experimentalMode = true; syncModeUI(); saveSettings(); });

function syncModeUI() {
  modeStdEl.classList.toggle("active", !experimentalMode);
  modeExpEl.classList.toggle("active", experimentalMode);
  document.body.classList.toggle("exp", experimentalMode);
}

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs[0] ? tabs[0].id : undefined;
}

function isInjectable(url) {
  return !!(url && /^(https?|file):/i.test(url));
}

async function getInjectableTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  let tab = tabs && tabs[0];
  if (tab && isInjectable(tab.url)) return tab.id;
  const all = await chrome.tabs.query({ currentWindow: true });
  for (const t of all) {
    if (isInjectable(t.url)) return t.id;
  }
  return undefined;
}

async function ensureContent(tabId) {
  if (!tabId || typeof tabId !== 'number') {
    throw new Error("Invalid tabId provided to ensureContent");
  }

  try {
    await chrome.tabs.sendMessage(tabId, { t: "ping" });
    return;
  } catch {}

  try {
    const t = await chrome.tabs.get(tabId);
    if (!t || !isInjectable(t.url)) {
      return;
    }
  } catch {}

  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["content.js"]
    });
  } catch {}

  for (let i = 0; i < 5; i++) {
    try {
      await chrome.tabs.sendMessage(tabId, { t: "ping" });
      return;
    } catch {}
    await new Promise(res => setTimeout(res, 200));
  }
}

async function sendToAgent(tabId, msg) {
  if (!tabId || typeof tabId !== 'number') {
    throw new Error("Invalid tabId provided to sendToAgent");
  }

  try {
    const t = await chrome.tabs.get(tabId);
    if (!t || !isInjectable(t.url)) {
      return null;
    }
  } catch {}

  try {
    await ensureContent(tabId);
  } catch {}
  for (let i = 0; i < 3; i++) {
    try {
      return await chrome.tabs.sendMessage(tabId, msg);
    } catch (err) {
      if (err && /No tab with id/i.test(err.message || "")) {
        return null;
      }
    }
    await new Promise(res => setTimeout(res, 200));
    try { await ensureContent(tabId); } catch {}
  }
  return null;
}

async function getAllFrames(tabId) {
  try {
    return await chrome.webNavigation.getAllFrames({ tabId });
  } catch {
    return [];
  }
}

async function sendToAgentFrame(tabId, frameId, msg) {
  if (!tabId || typeof tabId !== 'number') {
    return null;
  }

  try {
    const t = await chrome.tabs.get(tabId);
    if (!t || !isInjectable(t.url)) {
      return null;
    }
  } catch {}

  try {
    await ensureContent(tabId);
  } catch {}
  for (let i = 0; i < 3; i++) {
    try {
      return await chrome.tabs.sendMessage(tabId, msg, { frameId });
    } catch (err) {
      if (err && /No tab with id/i.test(err.message || "")) {
        return null;
      }
    }
    await new Promise(res => setTimeout(res, 200));
    try { await ensureContent(tabId); } catch {}
  }
  return null;
}

async function getBrowserState() {
  return await chrome.runtime.sendMessage({ t: "GET_STATE" });
}

async function waitReady(tabId, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await sendToAgent(tabId, { t: "getPageState" });
      const rs = r && r.state && r.state.readyState;
      if (rs === "interactive" || rs === "complete") return true;
    } catch {}
    await new Promise(res => setTimeout(res, 200));
  }
  return false;
}

async function simplify(tabId, annotate) {
  const r = await sendToAgent(tabId, { t: "simplify", annotate });
  return (r && Array.isArray(r.elements)) ? r.elements : [];
}

async function mapGlobal(tabId) {
  const r = await sendToAgent(tabId, { t: "mapGlobal" });
  return (r && Array.isArray(r.elements)) ? r.elements : [];
}

async function mapCompact(tabId) {
  const r = await sendToAgent(tabId, { t: "mapCompact" });
  return (r && Array.isArray(r.elements)) ? r.elements : [];
}

async function execute(tabId, payload) {
  const frames = await getAllFrames(tabId);
  if (!frames || !frames.length) {
    return await sendToAgent(tabId, { t: "execute", payload });
  }
  for (const f of frames) {
    const r = await sendToAgentFrame(tabId, f.frameId, { t: "execute", payload });
    if (r && r.ok) return r;
  }
  return await sendToAgent(tabId, { t: "execute", payload });
}

async function ensureExistingTab(tabId) {
  try {
    if (tabId && typeof tabId === 'number') {
      const t = await chrome.tabs.get(tabId);
      if (t && isInjectable(t.url)) return tabId;
    }
  } catch {}
  let newId = await getInjectableTabId();
  if (!newId) {
    try {
      const nt = await chrome.tabs.create({ url: "about:blank", active: true });
      newId = nt?.id;
    } catch {}
  }
  return newId;
}

async function probe(tabId, payload) {
  const frames = await getAllFrames(tabId);
  if (!frames || !frames.length) {
    const r = await sendToAgent(tabId, { t: "probe", payload });
    return r && r.ok;
  }
  for (const f of frames) {
    const r = await sendToAgentFrame(tabId, f.frameId, { t: "probe", payload });
    if (r && r.ok) return true;
  }
  const rr = await sendToAgent(tabId, { t: "probe", payload });
  return rr && rr.ok;
}

async function _retry(tabId, payload, tries = 3, delayMs = 400) {
  let wait = delayMs;
  for (let i = 0; i < tries; i++) {
    const probeOk = await probe(tabId, payload);
    if (probeOk) {
      const r = await execute(tabId, payload);
      if (r && r.ok) return r;
    }
    if (payload.action === "click") {
      await execute(tabId, { action: "scroll", amount: 600 });
    }
    const jitter = Math.floor(Math.random() * 120);
    await new Promise(res => setTimeout(res, wait + jitter));
    wait = Math.min(2000, wait * 2);
  }
  return await execute(tabId, payload);
}

function normalizeCall(call) {
  if (!call) return { tool: undefined, args: {} };
  
  if (call.tool || call.action) {
    const base = call.tool || call.action;
    const raw = call.args !== undefined ? call.args : (call.params !== undefined ? call.params : undefined);
    let args = {};
    if (Array.isArray(raw)) {
      const v = raw[0];
      if (typeof v === "number") args.id = v;
      else if (typeof v === "string") args.text = v;
      else if (v && typeof v === "object") args = v;
    } else if (typeof raw === "string") {
      args = { text: raw };
    } else if (raw && typeof raw === "object") {
      args = raw;
    }
    // Normalize element payload when provided under args for specific tools
    if (base === "tap" && args && typeof args === "object" && args.element && typeof args.element === "object") {
      const el = args.element;
      if (el.i !== undefined && args.id === undefined) args.id = el.i;
      if (!args.text && el.x) args.text = String(el.x).replace(/\s+/g, " ").trim();
      if (!args.href) {
        args.href = el.h || el.href || (String(el.x || "").match(/https?:\/\/[^\s]+/) || [])[0];
      }
      const sig = {
        tag: el.t || undefined,
        role: el.r || undefined,
        text: el.x ? String(el.x).replace(/\s+/g, " ").trim() : undefined,
        label: el.l ? String(el.l).replace(/\s+/g, " ").trim() : undefined,
        href: el.h || undefined,
        placeholder: el.p || undefined,
        testid: el.testid || el.qa || undefined
      };
      args.signature = sig;
      delete args.element;
    }
    return { tool: base, args };
  }
  
  const keys = Object.keys(call);
  const known = ["tap", "type", "press", "select", "submit", "check", "scroll", "navigate", "new_tab", "search", "done", "focus", "copy", "paste"];
  
  for (const k of known) {
    if (call[k] !== undefined) {
      const v = call[k];
      if (k === "tap") {
        if (typeof v === "number") return { tool: "tap", args: { id: v } };
        if (typeof v === "string") return { tool: "tap", args: { text: v } };
        if (Array.isArray(v)) {
          const first = v[0];
          if (typeof first === "string") return { tool: "tap", args: { text: first } };
          if (typeof first === "number") return { tool: "tap", args: { id: first } };
        }
        if (v && typeof v === "object") {
          // Handle malformed selectors like {"i":29} -> {"id":29}
          const normalized = { ...v };
          if (normalized.selector && typeof normalized.selector === "object") {
            if (normalized.selector.i !== undefined) {
              normalized.id = normalized.selector.i;
              delete normalized.selector;
            }
          }
          if (normalized.element && typeof normalized.element === "object") {
            const el = normalized.element;
            if (el.i !== undefined) normalized.id = el.i;
            if (!normalized.text && el.x) normalized.text = String(el.x).replace(/\s+/g, " ").trim();
            // Extract href-like substring from text
            const m = String(el.x || "").match(/https?:\/\/[^\s]+/);
            if (m && !normalized.href) normalized.href = m[0];
            // Build signature from compact element for stable re-resolution
            const sig = {
              tag: el.t || undefined,
              role: el.r || undefined,
              text: el.x ? String(el.x).replace(/\s+/g, " ").trim() : undefined,
              label: el.l ? String(el.l).replace(/\s+/g, " ").trim() : undefined,
              href: el.h || undefined,
              placeholder: el.p || undefined,
              testid: el.testid || el.qa || undefined
            };
            normalized.signature = sig;
            delete normalized.element;
          }
          return { tool: "tap", args: normalized };
        }
      }
      if (k === "type") {
        const value = call.text !== undefined ? call.text : (call.value !== undefined ? call.value : undefined);
        if (typeof v === "string") return { tool: "type", args: { target: v, text: value } };
        if (typeof v === "number") return { tool: "type", args: { id: v, text: value } };
        if (v && typeof v === "object") {
          // Handle malformed selectors like {"i":29} -> {"id":29}
          const normalized = { ...v };
          if (normalized.selector && typeof normalized.selector === "object") {
            if (normalized.selector.i !== undefined) {
              normalized.id = normalized.selector.i;
              delete normalized.selector;
            }
          }
          return { tool: "type", args: { ...normalized, text: value } };
        }
        return { tool: "type", args: { text: value } };
      }
      if (k === "press") {
        const key = typeof v === "string" ? v : (call.key || "Enter");
        return { tool: "press", args: { key } };
      }
      if (k === "select") {
        const value = call.value !== undefined ? call.value : undefined;
        if (typeof v === "string") return { tool: "select", args: { target: v, value } };
        if (typeof v === "number") return { tool: "select", args: { id: v, value } };
        if (v && typeof v === "object") return { tool: "select", args: { ...v, value } };
        return { tool: "select", args: { value } };
      }
      if (k === "submit") {
        if (typeof v === "string") return { tool: "submit", args: { target: v } };
        if (typeof v === "number") return { tool: "submit", args: { id: v } };
        if (v && typeof v === "object") return { tool: "submit", args: v };
        return { tool: "submit", args: {} };
      }
      if (k === "check") {
        const value = call.value !== undefined ? !!call.value : (typeof v === "boolean" ? v : true);
        if (typeof v === "string") return { tool: "check", args: { target: v, value } };
        if (typeof v === "number") return { tool: "check", args: { id: v, value } };
        if (v && typeof v === "object") return { tool: "check", args: { ...v, value } };
        return { tool: "check", args: { value } };
      }
      if (k === "scroll") {
        if (typeof v === "string") return { tool: "scroll", args: { to: v } };
        if (typeof v === "number") return { tool: "scroll", args: { amount: v } };
        if (v && typeof v === "object") return { tool: "scroll", args: v };
        return { tool: "scroll", args: {} };
      }
      if (k === "navigate") {
        if (typeof v === "string") return { tool: "navigate", args: { url: v } };
        if (v && typeof v === "object") return { tool: "navigate", args: v };
        return { tool: "navigate", args: {} };
      }
      if (k === "new_tab") {
        if (typeof v === "string") return { tool: "new_tab", args: { url: v } };
        if (v && typeof v === "object") return { tool: "new_tab", args: v };
        return { tool: "new_tab", args: {} };
      }
      if (k === "search") {
        const q = typeof v === "string" ? v : (call.query || "");
        return { tool: "search", args: { query: q } };
      }
      if (k === "done") return { tool: "done", args: {} };
      if (k === "finish") return { tool: "done", args: {} };
      if (k === "focus") {
        if (typeof v === "string") return { tool: "focus", args: { target: v } };
        if (typeof v === "number") return { tool: "focus", args: { id: v } };
        if (v && typeof v === "object") return { tool: "focus", args: v };
        return { tool: "focus", args: {} };
      }
      if (k === "copy") {
        const source = typeof v === "string" ? v : undefined;
        return { tool: "copy", args: { source } };
      }
      if (k === "paste") {
        const value = call.value !== undefined ? call.value : (typeof v === "string" ? v : undefined);
        return { tool: "paste", args: { value } };
      }
    }
  }
  
  if (keys.length === 1) {
    const k = keys[0];
    const v = call[k];
    if (typeof v === "string") {
      if (k === "tap") return { tool: "tap", args: { text: v } };
      if (k === "type") return { tool: "type", args: { text: v } };
      if (k === "search") return { tool: "search", args: { query: v } };
      if (k === "new_tab") return { tool: "new_tab", args: { url: v } };
      if (k === "navigate") return { tool: "navigate", args: { url: v } };
      if (k === "finish") return { tool: "done", args: {} };
    }
    if (Array.isArray(v)) {
      const first = v[0];
      if (typeof first === "number") return { tool: k, args: { id: first } };
      if (typeof first === "string") return { tool: k, args: { text: first } };
      if (first && typeof first === "object") return { tool: k, args: first };
      return { tool: k, args: {} };
    }
    if (typeof v === "object") return { tool: k, args: v };
    return { tool: k, args: {} };
  }
  
  return { tool: undefined, args: {} };
}

function sanitizeUrl(u) {
  if (!u) return u;
  let s = String(u).trim();
  s = s.replace(/^`+|`+$/g, "").trim();
  s = s.replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "").trim();
  return s;
}

function hostFromUrl(u) {
  try {
    const s = sanitizeUrl(u);
    if (!s) return "";
    const url = s.match(/^[a-zA-Z][a-zA-Z0-9]*:/) ? new URL(s) : new URL("https://" + s);
    return (url.hostname || "").replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function extractTargetDomain(text) {
  const t = String(text || "").toLowerCase();
  const dm = t.match(/\b([a-z0-9-]+\.(?:com|in|net|org|io|ai|app|dev|store|shop|co|me|tv|info))\b/);
  return dm ? dm[1].replace(/^www\./, "") : "";
}

function maybeCompleteInstruction(instruction, preState) {
  try {
    const url = (preState && preState.state && preState.state.url) ? String(preState.state.url).toLowerCase() : "";
    const domain = extractTargetDomain(instruction);
    if (!domain || !url.includes(domain)) return null;
    const t = String(instruction).toLowerCase();
    const isSimpleOpen = /\b(open|go to|navigate|search for|find)\b/.test(t) && !/\b(video|playlist|channel|login|sign in|subscribe|results|play)\b/.test(t);
    if (isSimpleOpen) return { tool: "done", args: {} };
    if (/add\s*to\s*(cart|basket)|buy\s*now/.test(t)) {
      const added = __hb_semantics.addToCartAt && (Date.now() - __hb_semantics.addToCartAt < 60000);
      const onCart = __hb_semantics.onCartPageAt && (Date.now() - __hb_semantics.onCartPageAt < 60000);
      if (added || onCart) return { tool: "done", args: {} };
    }
    return null;
  } catch {
    return null;
  }
}

function injectVerification(call, preState) {
  if (!call || !call.tool) return call;
  const t = call.tool;
  const args = call.args || {};
  if (t === "navigate") {
    const host = args.url ? hostFromUrl(args.url) : "";
    if (host && !args.verifyAfter) {
      call = { tool: t, args: { ...args, verifyAfter: { urlIncludes: host } } };
    }
  }
  if (t === "tap") {
    const href = args.href || (args.signature && args.signature.href) || (args.element && args.element.h) || "";
    const host = href ? hostFromUrl(href) : "";
    if (host && !args.verifyAfter) {
      call = { tool: t, args: { ...args, verifyAfter: { urlIncludes: host } } };
    }
  }
  if (t === "submit" && !args.verifyAfter) {
    call = { tool: t, args: { ...args, verifyAfter: { condition: { ready: true } } } };
  }
  if (t === "press" && String(args.key || "").toLowerCase() === "enter" && !args.verifyAfter) {
    call = { tool: t, args: { ...args, verifyAfter: { condition: { ready: true } } } };
  }
  return call;
}

function callsEqual(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
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
  currentRunActions.push(h);
  if (currentRunActions.length > 50) currentRunActions = currentRunActions.slice(-50);
  if (!h.ok) {
    try {
      chrome.runtime.sendMessage({ t: "TASK_RECORD_ERROR", action: action, error: result && result.error ? result.error : "action_failed" });
    } catch {}
  }
  try {
    chrome.runtime.sendMessage({ t: "TASK_MEMORY_RECORD_ACTION", action, result, preState, postState });
  } catch {}
  try { updateSemantics(action, result, preState, postState); } catch {}
}

function buildHistoryForPrompt(maxItems = 20) {
  const items = currentRunActions.slice(-maxItems);
  return JSON.stringify(items);
}

function shouldSkipCall(call) {
  const t = call.tool || call.action;
  const nonRepeat = new Set(["navigate","tap","type","focus","submit","select","check","copy","paste","new_tab","switch_tab","search","press"]);
  if (!nonRepeat.has(t)) return false;
  const sig = JSON.stringify({ t, a: normalizeArgsForHistory(call.args || {}) });
  for (let i = currentRunActions.length - 1; i >= 0; i--) {
    const h = currentRunActions[i];
    const hs = JSON.stringify({ t: h.t, a: h.a });
    if (hs === sig && h.ok) {
      if (t === "press" && String(h.a.key || "").toLowerCase() !== "enter") return false;
      return true;
    }
    // Additional persistent dedup rules
    if (t === "search" && h.t === "search" && h.ok) {
      if ((h.a.query || "").toLowerCase() === (call.args?.query || "").toLowerCase()) return true;
    }
    if (t === "tap" && h.t === "tap" && h.ok) {
      const a = call.args || {}; const ha = h.a || {};
      if (a.id && ha.id && a.id === ha.id) return true;
      if (a.href && ha.href && a.href === ha.href) return true;
      if (a.text && ha.text && String(a.text).toLowerCase() === String(ha.text).toLowerCase()) return true;
    }
  }
  // Prevent re-click on links already opened in a new tab
  if (t === "tap" && call.args && call.args.href) {
    const href = String(call.args.href).trim();
    if (openedHrefs.has(href)) return true;
  }
  if (t === "tap") {
    const args = call.args || {};
    const txt = String(args.text || "").toLowerCase();
    const lbl = String((args.signature && args.signature.label) || "").toLowerCase();
    const addIntention = /add\s*to\s*(cart|basket)|buy\s*now/.test(txt) || /add\s*to\s*(cart|basket)|buy\s*now/.test(lbl);
    if (addIntention) {
      if (__hb_semantics.addToCartAt && (Date.now() - __hb_semantics.addToCartAt < 30000)) return true;
      if (__hb_semantics.onCartPageAt && (Date.now() - __hb_semantics.onCartPageAt < 20000)) return true;
    }
  }
  // Skip redundant navigate to same URL even if prior attempt failed
  if (t === "navigate" && call.args && call.args.url) {
    const url = String(call.args.url).trim();
    for (let i = currentRunActions.length - 1; i >= 0; i--) {
      const h = currentRunActions[i];
      if (h.t === "navigate" && String(h.a.url || "").trim() === url) {
        return true;
      }
    }
    const host = hostFromUrl(url);
    if (host) {
      for (let i = currentRunActions.length - 1; i >= 0; i--) {
        const h = currentRunActions[i];
        if (h.t === "navigate") {
          const ph = hostFromUrl(h.a.url || "");
          if (ph && ph === host && (Date.now() - (h.ts || 0) < 2500)) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

function updateSemantics(action, result, preState, postState) {
  const args = action.args || {};
  const txt = String(args.text || "").toLowerCase();
  const lbl = String((args.signature && args.signature.label) || "").toLowerCase();
  const ok = !!(result && result.ok);
  const url = postState && postState.state && postState.state.url ? String(postState.state.url) : "";
  if (ok && (/(add\s*to\s*(cart|basket)|buy\s*now)/.test(txt) || /(add\s*to\s*(cart|basket)|buy\s*now)/.test(lbl))) {
    __hb_semantics.addToCartAt = Date.now();
  }
  if (String(url).toLowerCase().includes("cart")) {
    __hb_semantics.onCartPageAt = Date.now();
  }
}

const SEARCH_ENGINES = {
  google: payload => {
    const q = String(payload.query || "").trim();
    const encodedQuery = encodeURIComponent(q);
    let url = `https://www.google.com/search?q=${encodedQuery}`;
    const params = [];
    if (payload.site) params.push(`site:${encodeURIComponent(payload.site)}`);
    if (payload.filetype) params.push(`filetype:${payload.filetype}`);
    if (payload.inurl) params.push(`inurl:${encodeURIComponent(payload.inurl)}`);
    if (payload.intitle) params.push(`intitle:${encodeURIComponent(payload.intitle)}`);
    if (payload.exclude) params.push(`-${encodeURIComponent(payload.exclude)}`);
    if (payload.dateRange) params.push(`qdr:${payload.dateRange}`);
    if (payload.language && payload.language !== "en") params.push(`lr=lang_${payload.language}`);
    if (payload.region) params.push(`gl=${payload.region}`);
    if (payload.safe === false) params.push("safe=off");
    if (payload.num && payload.num !== 10) params.push(`num=${payload.num}`);
    if (payload.start && payload.start > 0) params.push(`start=${payload.start}`);
    if (params.length > 0) url += "+" + params.join("+");
    return url;
  },
  bing: payload => {
    const q = String(payload.query || "").trim();
    const encodedQuery = encodeURIComponent(q);
    let url = `https://www.bing.com/search?q=${encodedQuery}`;
    const params = [];
    if (payload.site) params.push(`site:${encodeURIComponent(payload.site)}`);
    if (payload.filetype) params.push(`filetype:${payload.filetype}`);
    if (payload.language && payload.language !== "en") params.push(`setlang=${payload.language}`);
    if (payload.region) params.push(`cc=${payload.region}`);
    if (payload.safe === false) params.push("adlt=off");
    if (payload.num && payload.num !== 10) params.push(`count=${payload.num}`);
    if (payload.start && payload.start > 0) params.push(`first=${payload.start + 1}`);
    if (params.length > 0) url += "&" + params.join("&");
    return url;
  },
  duckduckgo: payload => {
    const q = String(payload.query || "").trim();
    const encodedQuery = encodeURIComponent(q);
    let url = `https://duckduckgo.com/?q=${encodedQuery}`;
    const params = [];
    if (payload.site) params.push(`site:${encodeURIComponent(payload.site)}`);
    if (payload.filetype) params.push(`filetype:${payload.filetype}`);
    if (payload.safe === false) params.push("kp=-2");
    if (payload.region) params.push(`kl=${payload.region}`);
    if (params.length > 0) url += "&" + params.join("&");
    return url;
  },
  yahoo: payload => {
    const q = String(payload.query || "").trim();
    const encodedQuery = encodeURIComponent(q);
    let url = `https://search.yahoo.com/search?q=${encodedQuery}`;
    const params = [];
    if (payload.site) params.push(`site:${encodeURIComponent(payload.site)}`);
    if (payload.num && payload.num !== 10) params.push(`n=${payload.num}`);
    if (payload.start && payload.start > 0) params.push(`b=${payload.start + 1}`);
    if (params.length > 0) url += "&" + params.join("&");
    return url;
  },
  startpage: payload => {
    const q = String(payload.query || "").trim();
    const encodedQuery = encodeURIComponent(q);
    return `https://www.startpage.com/sp/search?q=${encodedQuery}`;
  },
  ecosia: payload => {
    const q = String(payload.query || "").trim();
    const encodedQuery = encodeURIComponent(q);
    return `https://www.ecosia.org/search?q=${encodedQuery}`;
  }
};

const TOOL_HANDLERS = {
  search: async (tabId, args) => {
    const payload = {
      query: args.query,
      engine: args.engine || "google",
      site: args.site,
      filetype: args.filetype,
      inurl: args.inurl,
      intitle: args.intitle,
      exact: args.exact || false,
      exclude: args.exclude,
      dateRange: args.dateRange,
      language: args.language || "en",
      region: args.region,
      safe: args.safe !== false,
      num: args.num || 10,
      start: args.start || 0,
      newTab: args.newTab !== false,
      active: args.active !== false
    };
    if (!payload.query || typeof payload.query !== "string") {
      return { ok: false, error: "Search query is required" };
    }
    const q = payload.query.trim();
    if (!q) {
      return { ok: false, error: "Search query cannot be empty" };
    }
    const builder = SEARCH_ENGINES[(payload.engine || "").toLowerCase()] || SEARCH_ENGINES.google;
    const searchUrl = builder(payload);
    if (payload.newTab || !tabId) {
      const r = await execTool(null, { tool: "new_tab", args: { url: searchUrl, active: payload.active, title: `Search: ${q}` } });
      return { ok: r.ok, newTabId: r && r.newTabId, searchUrl, engine: payload.engine, query: q };
    }
    const nr = await execTool(tabId, { tool: "navigate", args: { url: searchUrl } });
    return { ok: nr.ok, searchUrl, engine: payload.engine, query: q };
  },
  switch_tab: async (tabId, args) => {
    const id = args.id;
    if (id) {
      const r = await chrome.runtime.sendMessage({ t: "SWITCH_TAB", tabId: id });
      return { ok: true, activeTabId: r && r.activeTabId };
    }
    return { ok: false };
  },
  tap: async (tabId, args) => {
    if (args && args.element && typeof args.element === "object" && !args.signature) {
      const el = args.element;
      if (el.i !== undefined && args.id === undefined) args.id = el.i;
      if (!args.text && el.x) args.text = String(el.x).replace(/\s+/g, " ").trim();
      if (!args.href) {
        args.href = el.h || el.href || (String(el.x || "").match(/https?:\/\/[^\s]+/) || [])[0];
      }
      args.signature = { tag: el.t || undefined, role: el.r || undefined, text: el.x ? String(el.x).replace(/\s+/g, " ").trim() : undefined, label: el.l ? String(el.l).replace(/\s+/g, " ").trim() : undefined, href: el.h || undefined, placeholder: el.p || undefined, testid: el.testid || el.qa || undefined };
      delete args.element;
    }
    const payload = { action: "click", id: args.id, selector: args.selector, text: args.target || args.text, exact: args.exact, partial: args.partial, index: args.index, xpath: args.xpath, href: args.href, sig: args.signature, clickable: true, visible: true, viewportOnly: true };
    async function verifyAfterTap() {
      if (!args || !args.verifyAfter) return true;
      const v = args.verifyAfter;
      if (v.urlIncludes) {
        const u = String(v.urlIncludes).toLowerCase();
        for (let i = 0; i < 10; i++) {
          const ps = await sendToAgent(tabId, { t: "getPageState" });
          const cu = (ps && ps.state && ps.state.url ? String(ps.state.url).toLowerCase() : "");
          if (cu.includes(u)) return true;
          await new Promise(res => setTimeout(res, 300));
        }
        return false;
      }
      if (v.element) {
        const p = { ...v.element, visible: true, clickable: true, domStableMs: v.domStableMs || 500 };
        const ok = await probe(tabId, p);
        return !!ok;
      }
      return true;
    }
    const bsBefore = await getBrowserState().catch(() => null);
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await ensureActiveAndFocused(tabId);
        if (await probe(tabId, payload)) {
          const result = await execute(tabId, payload);
          if (result && result.ok) {
            const verified = await verifyAfterTap();
            if (verified) return result;
          }
        }
        if (attempt === 0) {
          await execute(tabId, { action: "scroll", id: args.id, selector: args.selector, text: args.target || args.text, to: "element" });
          await new Promise(res => setTimeout(res, 300));
        } else if (attempt === 1) {
          payload.offsetX = Math.floor(Math.random() * 10) - 5;
          payload.offsetY = Math.floor(Math.random() * 10) - 5;
        } else if (attempt === 2) {
          payload.force = true;
        }
        await new Promise(res => setTimeout(res, attempt * 200 + 300));
      } catch (e) {
        if (attempt === 3) throw e;
      }
    }
    try {
      const bsAfter = await getBrowserState();
      const beforeIds = new Set(((bsBefore && bsBefore.tabs) ? bsBefore.tabs.map(t => t.id) : []));
      const afterTabs = (bsAfter && bsAfter.tabs) ? bsAfter.tabs : [];
      let newTabId = null;
      for (const t of afterTabs) {
        if (!beforeIds.has(t.id)) {
          newTabId = t.id;
          break;
        }
      }
      if (!newTabId && bsBefore && bsAfter && bsBefore.activeTabId !== bsAfter.activeTabId) {
        newTabId = bsAfter.activeTabId;
      }
      if (newTabId) {
        const href = args.href || (args.signature && args.signature.href) || "";
        if (href) openedHrefs.add(String(href).trim());
        await ensureActiveAndFocused(newTabId);
        return { ok: true, newTabId, action: "tap_new_tab" };
      }
    } catch {}
    return await execute(tabId, payload);
  },
  type: async (tabId, args) => {
    const payload = { action: "type", id: args.id, selector: args.selector, text: args.target || args.field || args.label, value: args.value || args.text, append: args.append, mode: args.mode || "set", clearFirst: args.clear !== false, simulate: args.simulate !== false, xpath: args.xpath };
    if (!payload.value && payload.value !== "") {
      return { ok: false, error: "No text value provided for typing" };
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (await probe(tabId, { action: "type", ...payload, probeOnly: true })) {
          const result = await execute(tabId, payload);
          if (result && result.ok) return result;
        }
        if (attempt === 0) {
          await execute(tabId, { action: "focus", id: args.id, selector: args.selector, text: args.target || args.field || args.label });
          await new Promise(res => setTimeout(res, 200));
        } else if (attempt === 1) {
          payload.slow = true;
          payload.delay = 50;
        }
        await new Promise(res => setTimeout(res, attempt * 300 + 200));
      } catch (e) {
        if (attempt === 2) throw e;
      }
    }
    return await execute(tabId, payload);
  },
  select: async (tabId, args) => {
    const payload = { action: "select", id: args.id, selector: args.selector, text: args.target || args.text, value: args.value, index: args.index, label: args.label, optionText: args.optionText, xpath: args.xpath, partial: args.partial !== false, caseSensitive: args.caseSensitive || false };
    if (!payload.value && payload.index === undefined && !payload.label && !payload.optionText) {
      return { ok: false, error: "Must provide value, index, label, or optionText for select" };
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const probeResult = await execute(tabId, { action: "select", ...payload, probeOnly: true });
        if (probeResult && probeResult.options) {
          const result = await execute(tabId, payload);
          if (result && result.ok) {
            await new Promise(res => setTimeout(res, 100));
            const verifyResult = await execute(tabId, { action: "select", ...payload, verifyOnly: true });
            if (verifyResult && verifyResult.selected) {
              return result;
            }
          }
        }
        if (attempt === 0) {
          await execute(tabId, { action: "scroll", id: payload.id, selector: payload.selector, text: payload.text, to: "element" });
          await new Promise(res => setTimeout(res, 300));
        }
        await new Promise(res => setTimeout(res, attempt * 200 + 200));
      } catch (e) {
        if (attempt === 2) throw e;
      }
    }
    return await execute(tabId, payload);
  },
  check: async (tabId, args) => {
    const payload = { action: "check", id: args.id, selector: args.selector, text: args.target || args.text, value: args.value, state: args.state, group: args.group, xpath: args.xpath, toggle: args.toggle || false, force: args.force || false };
    if (payload.state !== undefined && payload.value === undefined) {
      payload.value = payload.state;
    }
    if (payload.value === undefined && !payload.toggle) {
      payload.value = true;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const probeResult = await execute(tabId, { action: "check", ...payload, probeOnly: true });
        if (probeResult && probeResult.found) {
          const result = await execute(tabId, payload);
          if (result && result.ok) {
            await new Promise(res => setTimeout(res, 100));
            const verifyResult = await execute(tabId, { action: "check", ...payload, verifyOnly: true });
            if (verifyResult && verifyResult.stateCorrect) {
              return result;
            }
          }
        }
        if (attempt === 0) {
          await execute(tabId, { action: "scroll", id: payload.id, selector: payload.selector, text: payload.text, to: "element" });
          await new Promise(res => setTimeout(res, 300));
        }
        await new Promise(res => setTimeout(res, attempt * 200 + 200));
      } catch (e) {
        if (attempt === 2) throw e;
      }
    }
    return await execute(tabId, payload);
  },
  navigate: async (tabId, args) => {
    const payload = { action: "navigate", url: args.url, id: args.id, selector: args.selector, text: args.text, xpath: args.xpath, method: args.method || "auto", target: args.target || "_self", waitForLoad: args.waitForLoad !== false, timeout: args.timeout || 10000, back: args.back || false, forward: args.forward || false, reload: args.reload || false };
    async function verifyAfterNavigate() {
      if (!args || !args.verifyAfter) return true;
      const v = args.verifyAfter;
      if (v.urlIncludes) {
        const uinc = String(v.urlIncludes).toLowerCase();
        for (let i = 0; i < 12; i++) {
          const ps = await sendToAgent(tabId, { t: "getPageState" });
          const cu = (ps && ps.state && ps.state.url ? String(ps.state.url).toLowerCase() : "");
          if (cu.includes(uinc)) return true;
          await new Promise(res => setTimeout(res, 300));
        }
        return false;
      }
      if (v.condition && v.condition.ready) {
        const ok = await waitReady(tabId, args.timeout || 10000);
        return !!ok;
      }
      if (v.element) {
        const p = { ...v.element, visible: true, clickable: !!v.clickable, domStableMs: v.domStableMs || 500 };
        const ok = await probe(tabId, p);
        return !!ok;
      }
      return true;
    }
    if (payload.reload) {
      await chrome.tabs.reload(tabId);
      if (payload.waitForLoad) {
        await waitReady(tabId, payload.timeout);
      }
      return { ok: true, action: "reload" };
    }
    if (payload.back) {
      const result = await execute(tabId, { action: "navigate", method: "history", direction: "back" });
      if (payload.waitForLoad) {
        await waitReady(tabId, payload.timeout);
      }
      return result;
    }
    if (payload.forward) {
      const result = await execute(tabId, { action: "navigate", method: "history", direction: "forward" });
      if (payload.waitForLoad) {
        await waitReady(tabId, payload.timeout);
      }
      return result;
    }
    if (payload.url) {
      let url = sanitizeUrl(payload.url);
      if (!url) {
        return { ok: false, error: "Invalid or empty URL provided" };
      }
      if (!url.match(/^[a-zA-Z][a-zA-Z0-9]*:/)) {
        url = "https://" + url;
      }
      try {
        new URL(url);
        if (payload.target === "_blank") {
          const newTabResult = await execTool(null, { tool: "new_tab", args: { url } });
          const verified = await verifyAfterNavigate();
          return { ok: newTabResult.ok && verified, newTabId: newTabResult.newTabId, action: "new_tab" };
        } else {
          await chrome.tabs.update(tabId, { url });
          if (payload.waitForLoad !== false) {
            const ready = await waitReady(tabId, payload.timeout || 10000);
            const verified = await verifyAfterNavigate();
            return { ok: !!verified, url, ready, action: "navigate" };
          }
          const verified = await verifyAfterNavigate();
          return { ok: !!verified, url, action: "navigate" };
        }
      } catch (error) {
        return { ok: false, error: "Invalid URL format: " + error.message };
      }
    }
    if (payload.id || payload.selector || payload.text) {
      const result = await _retry(tabId, { action: "navigate", id: payload.id, selector: payload.selector, text: payload.text, xpath: payload.xpath, method: "link" });
      if (result && result.ok && payload.waitForLoad) {
        await waitReady(tabId, payload.timeout);
      }
      return result;
    }
    return { ok: false, error: "No URL or target element specified for navigation" };
  },
  scroll: async (tabId, args) => {
    const payload = { action: "scroll", id: args.id, selector: args.selector, text: args.target || args.text, to: args.to, amount: args.amount, direction: args.direction || "down", smooth: args.smooth !== false, behavior: args.behavior || (experimentalMode ? "smooth" : "auto"), xpath: args.xpath };
    if (payload.id || payload.selector || payload.text) {
      payload.to = "element";
    } else if (payload.to) {
      const validTos = ["top", "bottom", "middle", "up", "down", "left", "right"];
      if (!validTos.includes(payload.to)) {
        return { ok: false, error: "Invalid scroll target. Use: top, bottom, middle, up, down, left, right, or element" };
      }
    } else if (payload.amount) {
      if (typeof payload.amount !== "number") {
        return { ok: false, error: "Scroll amount must be a number" };
      }
    } else {
      payload.to = "down";
      payload.amount = window.innerHeight * 0.8;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await execute(tabId, payload);
        if (result && result.ok) {
          await new Promise(res => setTimeout(res, payload.smooth ? 800 : 200));
          if (payload.to === "element" && (payload.id || payload.selector || payload.text)) {
            const verifyResult = await execute(tabId, { action: "scroll", verify: true, id: payload.id, selector: payload.selector, text: payload.text });
            if (verifyResult && verifyResult.visible) {
              return result;
            }
          } else {
            return result;
          }
        }
      } catch (e) {
        if (attempt === 2) throw e;
      }
      await new Promise(res => setTimeout(res, attempt * 200 + 100));
    }
    return await execute(tabId, payload);
  },
  new_tab: async (tabId, args) => {
    const payload = { url: args.url, title: args.title || "", active: args.active !== false, pinned: args.pinned || false, index: args.index, windowId: args.windowId, openerTabId: args.openerTabId || tabId };
    let url = payload.url;
    if (url) {
      url = sanitizeUrl(url);
      if (!url) {
        return { ok: false, error: "Invalid or empty URL provided" };
      }
      if (!url.match(/^[a-zA-Z][a-zA-Z0-9]*:/)) {
        url = "https://" + url;
      }
      try {
        new URL(url);
      } catch (error) {
        return { ok: false, error: "Invalid URL format: " + error.message };
      }
    } else {
      url = "about:blank";
    }
    const createOptions = { url: url, active: payload.active, pinned: payload.pinned, openerTabId: payload.openerTabId };
    if (payload.index !== undefined) {
      createOptions.index = payload.index;
    }
    if (payload.windowId) {
      createOptions.windowId = payload.windowId;
    }
    try {
      if (newTabsOpened >= 3) {
        return { ok: false, error: "new_tab_limit_reached" };
      }
      const newTab = await chrome.tabs.create(createOptions);
      if (newTab?.id) {
        newTabsOpened++;
        if (url && url !== "about:blank") {
          await new Promise(resolve => setTimeout(resolve, 500));
          try {
            await chrome.scripting.executeScript({ target: { tabId: newTab.id, allFrames: true }, files: ["content.js"] });
          } catch {}
        }
        return { ok: true, newTabId: newTab.id, url: newTab.url, title: newTab.title, active: newTab.active, index: newTab.index };
      } else {
        return { ok: false, error: "Failed to create new tab" };
      }
    } catch (error) {
      return { ok: false, error: "Tab creation failed: " + error.message };
    }
  },
  copy: async (tabId, args) => {
    const payload = { action: "copy", id: args.id, selector: args.selector, text: args.target || args.text, xpath: args.xpath, source: args.source, type: args.type || "text", all: args.all || false, attribute: args.attribute, maxLength: args.maxLength || 10000, format: args.format || "text" };
    const validTypes = ["text", "html", "value", "table", "list", "attribute"];
    if (!validTypes.includes(payload.type)) {
      return { ok: false, error: "Invalid copy type. Use: text, html, value, table, list, attribute" };
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await execute(tabId, payload);
        if (result && result.ok && result.copied && result.copied.trim()) {
          if (result.copied.length > 0) {
            return result;
          }
        }
        if (attempt === 0 && (payload.id || payload.selector || payload.text)) {
          await execute(tabId, { action: "scroll", id: payload.id, selector: payload.selector, text: payload.text, to: "element" });
          await new Promise(res => setTimeout(res, 300));
        }
        await new Promise(res => setTimeout(res, attempt * 200 + 200));
      } catch (e) {
        if (attempt === 2) throw e;
      }
    }
    return await execute(tabId, payload);
  },
  paste: async (tabId, args) => {
    const payload = { action: "paste", id: args.id, selector: args.selector, text: args.target || args.text, value: args.value, append: args.append !== false, xpath: args.xpath, clearFirst: args.clearFirst || false, simulate: args.simulate !== false, delay: args.delay || 50 };
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await execute(tabId, payload);
        if (result && result.ok) {
          await new Promise(res => setTimeout(res, 200));
          const verifyResult = await execute(tabId, { action: "paste", ...payload, verifyOnly: true });
          if (verifyResult && verifyResult.pasted) {
            return result;
          }
        }
        if (attempt === 0 && (payload.id || payload.selector || payload.text)) {
          await execute(tabId, { action: "scroll", id: payload.id, selector: payload.selector, text: payload.text, to: "element" });
          await new Promise(res => setTimeout(res, 300));
        }
        await new Promise(res => setTimeout(res, attempt * 300 + 300));
      } catch (e) {
        if (attempt === 2) throw e;
      }
    }
    return await execute(tabId, payload);
  },
  wait: async (tabId, args) => {
    const payload = { ms: args.ms !== undefined ? args.ms : (args.seconds !== undefined ? Number(args.seconds) * 1000 : (args.timeout !== undefined ? Number(args.timeout) : 1000)), condition: args.condition, timeout: args.timeout || 10000, selector: args.selector, text: args.text, visible: args.visible !== false, clickable: !!args.clickable, attribute: args.attribute, textIncludes: args.textIncludes, domStableMs: args.domStableMs };
    if (payload.condition && typeof payload.condition === "object") {
      const startTime = Date.now();
      while (Date.now() - startTime < payload.timeout) {
        try {
          const state = await sendToAgent(tabId, { t: "getPageState" });
          let ok = false;
          if (payload.condition.ready) {
            const rs = state && state.state && state.state.readyState;
            ok = rs === "interactive" || rs === "complete";
          }
          if (payload.condition.urlIncludes) {
            const u = state && state.state && state.state.url;
            if (u) ok = ok || String(u).includes(payload.condition.urlIncludes);
          }
          if (payload.condition.titleIncludes) {
            const t = state && state.state && state.state.title;
            if (t) ok = ok || String(t).includes(payload.condition.titleIncludes);
          }
          if (ok) return { ok: true, waited: Date.now() - startTime };
        } catch (e) {}
        await new Promise(res => setTimeout(res, 200));
      }
      return { ok: false, error: "Wait condition timeout" };
    }
    if (payload.selector || payload.text) {
      const startTime = Date.now();
      while (Date.now() - startTime < payload.timeout) {
        const found = await probe(tabId, { selector: payload.selector, text: payload.text, visible: payload.visible, clickable: payload.clickable, attribute: payload.attribute, textIncludes: payload.textIncludes, domStableMs: payload.domStableMs });
        if (found) {
          return { ok: true, waited: Date.now() - startTime };
        }
        await new Promise(res => setTimeout(res, 200));
      }
      return { ok: false, error: "Element wait timeout" };
    }
    await new Promise(res => setTimeout(res, payload.ms));
    return { ok: true, waited: payload.ms };
  },
  focus: async (tabId, args) => {
    const payload = { id: args.id, selector: args.selector, text: args.target || args.text, xpath: args.xpath, scroll: args.scroll !== false };
    const result = await _retry(tabId, { action: "focus", id: payload.id, selector: payload.selector, text: payload.text, xpath: payload.xpath, scroll: payload.scroll });
    return result;
  },
  submit: async (tabId, args) => {
    const payload = { id: args.id, selector: args.selector, text: args.target || args.text, xpath: args.xpath, method: args.method || "auto" };
    const result = await _retry(tabId, { action: "submit", id: payload.id, selector: payload.selector, text: payload.text, xpath: payload.xpath, method: payload.method });
    await new Promise(res => setTimeout(res, 500));
    return result;
  },
  press: async (tabId, args) => {
    const payload = { key: args.key || args.value, id: args.id, selector: args.selector, text: args.target || args.text, xpath: args.xpath, modifiers: args.modifiers || [], repeat: args.repeat || 1, delay: args.delay || 100 };
    if (!payload.key) {
      return { ok: false, error: "Key is required for press tool" };
    }
    const validKeys = ["Enter", "Tab", "Escape", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"];
    const isSpecialKey = validKeys.includes(payload.key) || payload.key.length === 1;
    if (!isSpecialKey) {
      return { ok: false, error: "Invalid key. Use single character or special key name" };
    }
    const validModifiers = ["ctrl", "shift", "alt", "meta", "control", "option", "command"];
    for (const mod of payload.modifiers) {
      if (!validModifiers.includes(mod.toLowerCase())) {
        return { ok: false, error: `Invalid modifier: ${mod}. Use: ctrl, shift, alt, meta` };
      }
    }
    if (String(payload.key).toLowerCase() === "enter") {
      payload.repeat = 1;
    }
    payload.repeat = Math.max(1, Math.min(payload.repeat, 3));
    const nowPress = Date.now();
    if (String(payload.key).toLowerCase() === "enter" && (nowPress - lastEnterPressedAt < 2000)) {
      return { ok: true, pressed: payload.key, repeat: 0 };
    }
    const pressPayload = { action: "press", key: payload.key, id: payload.id, selector: payload.selector, text: payload.text, xpath: payload.xpath, modifiers: payload.modifiers };
    for (let i = 0; i < payload.repeat; i++) {
      const result = await _retry(tabId, pressPayload);
      if (!result || !result.ok) {
        return result;
      }
      if (i < payload.repeat - 1) {
        await new Promise(res => setTimeout(res, payload.delay));
      }
    }
    if (String(payload.key).toLowerCase() === "enter") {
      lastEnterPressedAt = Date.now();
    }
    return { ok: true, pressed: payload.key, repeat: payload.repeat };
  },
  done: async () => {
    return { ok: true };
  }
};

async function execTool(tabId, call) {
  const nc = normalizeCall(call);
  const t = nc.tool;
  const args = nc.args || {};
  if (tabId) {
    await waitReady(tabId);
  }
  const handler = TOOL_HANDLERS[t];
  if (!handler) {
    return { ok: false, error: `Unknown tool: ${t}` };
  }
  return await handler(tabId, args);
}

function buildSystemPrompt(context, instruction, history, logsText) {
  const tabsCount = Array.isArray(context.tabs) ? context.tabs.length + 1 : 1;
  const activeTabId = context.activeTabId || "";
  const pageTitle = (context.page && context.page.title) || "";
  const pageUrl = (context.page && context.page.url) || "";
  const ready = !!(context.page && context.page.ready);
  const elementsCount = Array.isArray(context.elements) ? context.elements.length : 0;
  const sampleTabsArr = (Array.isArray(context.tabs) ? context.tabs.slice(0, 8) : []).map(t => ({ id: t.id, title: t.x, active: !!t.a }));
  const sampleTabs = JSON.stringify(sampleTabsArr);
  const elementsText = elementsToText(Array.isArray(context.elements) ? context.elements.slice(0, 120) : []);
  const ocrList = Array.isArray(context.elements) ? context.elements.filter(e => e && e.o && String(e.o).trim().length > 0).slice(0, 40) : [];
  const ocrText = ocrList.map(e => [e.i || e.id || "", String(e.o || "").replace(/\s+/g, " ").slice(0, 200), e.b ? JSON.stringify(e.b) : ""].join("|")).join("\n");
  return `You are Heybro, a complete UI automation agent. Act like a careful human operating the browser UI. Prefer DOM-aware actions over low-level inputs.

STATE:
- tabs=${tabsCount}, activeTabId=${activeTabId}
- page.title="${pageTitle}", page.url="${pageUrl}", ready=${ready}
- elements=${elementsCount}
- tabsList=${sampleTabs}

TASK:
- ${instruction}

 ELEMENTS:
 ${elementsText}

OCR:
${ocrText}

LOGS:
${logsText || ""}

HISTORY:
${history || "[]"}

OUTPUT:
- Return JSON with exactly ONE next step. Provide either a single 'call' object or a 'calls' array of length 1. Each call has 'tool' and 'args'. Plan only the immediate next action based on the latest STATE and HISTORY.

ROLE:
- Understand the task end-to-end, plan sub-steps, and execute UI actions until done. Treat this as a continuous UI automation loop.

PLANNING:
- Protocol per step:
  1) Fetch current page state and elements (already provided)
  2) Choose exactly one next action
  3) Include any necessary pre-waits (use 'wait' with conditions)
  4) After actions like navigate/tap/type, verify state change via 'wait' or 'verifyAfter'
  5) Do not repeat successful steps listed in HISTORY
- Derive a minimal ordered plan: navigate/open → wait/verify → interact → verify → done.
- Always include a wait/verify after navigation, tab switches, or when element presence is uncertain.

WORKFLOW EXAMPLE:
- Instruction: search "Jhol on youtube"
- Plan:
  1) navigate to https://youtube.com
  2) wait for search input element (visible + clickable)
  3) type "Jhol" into the search input
  4) press Enter to submit
  5) wait until results are visible

TOOLS:
- tap, type, focus, submit, select, check, press, copy, paste, scroll, navigate, new_tab, switch_tab, search, wait

RULES:
- Prefer specific selectors/ids; fallback to xpath/text when needed
- Include waits after navigation; verify element presence before interacting
- Avoid repeating successful actions
- Use 'search' only when not on the target site and no in-site search input is available; otherwise prefer typing into the site's search box and submitting, or navigating directly to the site's search results URL
- Use HISTORY to avoid re-running actions that already succeeded

SIGNATURES:
- For 'tap', include an 'element' with fields from ELEMENTS (i,t,y,r,x,l,h,p) or provide a 'signature' {tag,role,text,label,href,placeholder,testid}
- If a link has a known 'href', prefer direct 'navigate' to that URL if tapping fails

VERIFICATION:
- After 'tap' or 'navigate', include 'verifyAfter' when appropriate, e.g., { urlIncludes: "youtube.com" } or { element: { text: "Results" } }
- Use 'wait' with { selector/text, visible:true, clickable:true, domStableMs } before interacting when needed

COMPLETION:
- When the main task is truly complete, return { tool: "done" } (or an array with a single 'done').`;
}

function extractJson(s) {
  try { return JSON.parse(s); } catch {}
  const fence = s.match(/```json[\s\S]*?```/i);
  if (fence) {
    const inner = fence[0].replace(/```json/i, "").replace(/```/g, "").trim();
    try { return JSON.parse(inner); } catch {}
  }
  let depth = 0, start = -1;
  for (let idx = 0; idx < s.length; idx++) {
    const ch = s[idx];
    if (ch === '{') {
      if (depth === 0) start = idx;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        const sub = s.slice(start, idx + 1);
        try { return JSON.parse(sub); } catch {}
        start = -1;
      }
    }
  }
  return null;
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
  } catch (e) {}

  // Include scroll info for scrollable content or pagination tasks
  if (/scroll|bottom|more|load|next|previous|page|infinite/i.test(task)) {
    if (state.scroll) {
      // Check if page is scrollable by comparing scroll position to viewport
      // We can't directly access window.innerHeight here, so we'll use a heuristic
      const scrollY = state.scroll.y || 0;
      // Include scroll info if there's any scroll position or if it's a scrolling task
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
      // Silently ignore form state errors - not critical for basic functionality
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

async function callGemini(elements, instruction, key, model, tabId) {
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
  const body = {
    contents: [{
      role: "user",
      parts: [{
        text: buildSystemPrompt(context, instruction, buildHistoryForPrompt(24), logs)
      }]
    }]
  };

  let j;
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    clearTimeout(to);
    if (!r.ok) {
      try { const e = await r.text(); log(e); } catch {}
      return null;
    }
    j = await r.json();
  } catch (e) {
    log("network_error: " + (e && e.message ? e.message : String(e)));
    return null;
  }
  const s = j?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return extractJson(s);
}

function rankCandidates(elements, keywords) {
  return elements
    .map(e => {
      const s = ((e.text || e.x || "") + " " + (e.label || e.l || "") + " " + (e.o || e.ocr || "")).toLowerCase();
      const h = String(e.href || e.h || "").toLowerCase();
      let score = 0;
      for (const k of (keywords || [])) {
        if (s.includes(k)) score += 2;
        if (h.includes(k)) score += 4;
      }
      if (e.v) score += 2; // must be viewport-visible
      if ((e.type || e.y) === "button" || e.t === "button") score += 1.5;
      if ((e.type || e.y) === "link" || e.t === "a") score += 1.5;
      if (e.inFooter === 1 || e.inFooter === true || e.f === 1) score += 1;
      if ((e.o || e.ocr) && (keywords || []).some(k => String(e.o || e.ocr).toLowerCase().includes(k))) score += 3;
      // Prefer larger clickable targets
      if (e.b && ((e.type || e.y) === "button" || e.t === "a")) {
        const area = (e.b.w || 0) * (e.b.h || 0);
        if (area > 2000) score += 1;
        if (area > 6000) score += 1;
      }
      return { e, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(x => x.e);
}

function prefilter(elements, instruction) {
  const text = instruction.toLowerCase();
  const tokens = text.split(/[^a-z0-9]+/).filter(Boolean);
  let filtered = Array.isArray(elements) ? elements.filter(e => e && e.v) : [];
  if (filtered.length === 0) filtered = elements;
  
  if (tokens.includes("footer") || tokens.includes("bottom")) {
    filtered = filtered.filter(e => 
      (e.inFooter === 1 || e.inFooter === true || e.f === 1) || 
      /footer|bottom/.test(((e.label || e.l || "") + " " + (e.text || e.x || "")).toLowerCase())
    );
  }
  
  const keywords = tokens.filter(t => 
    t.length >= 3 && !["the", "and", "with", "into", "click", "go", "to"].includes(t)
  );
  
  const domainWords = keywords.filter(t => /[a-z]/.test(t));
  const hrefMatches = elements.filter(e => {
    const h = String(e.href || e.h || "").toLowerCase();
    return h && domainWords.some(dw => h.includes(dw));
  });
  if (hrefMatches.length) filtered = hrefMatches;

  if (keywords.length) {
    filtered = filtered.filter(e => {
      const s = ((e.text || e.x || "") + " " + (e.label || e.l || "") + " " + (e.o || e.ocr || "")).toLowerCase();
      for (const k of keywords) {
        if (s.includes(k)) return true;
      }
      return false;
    });
  }
  
  if (filtered.length === 0) filtered = elements;
  filtered = rankCandidates(filtered, keywords).slice(0, 24);
  return filtered;
}

async function ensureCandidates(tabId, instruction, elements) {
  let candidates = prefilter(elements, instruction);
  if (candidates && candidates.length) return candidates;
  // Try scrolling to reveal more content
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await execute(tabId, { action: "scroll", to: "down" });
      await new Promise(res => setTimeout(res, 500));
      const next = await mapCompact(tabId);
      candidates = prefilter(next, instruction);
      if (candidates && candidates.length) return candidates;
    } catch {}
  }
  return candidates || [];
}

function fallbackAction(elements, instruction) {
  const m = instruction.match(/open\s+(https?:\/\/\S+)/i);
  if (m) return { action: "new_tab", value: m[1] };

  const kw = instruction.toLowerCase();

  // Check for search commands
  if (/^search\s+/i.test(kw) || /search\s+for/i.test(kw) || /find\s+/i.test(kw)) {
    const queryMatch = instruction.match(/(?:search|find)\s+(?:for\s+)?(.+)/i);
    const query = queryMatch ? queryMatch[1].trim() : instruction.replace(/^(search|find)\s+/i, '').trim();
    return { tool: "search", args: { query } };
  }

  const targetDomain = (() => {
    const dm = kw.match(/\b([a-z0-9-]+\.(?:com|in|net|org|io|ai|app|dev|store|shop|co|me|tv|info))\b/);
    return dm ? dm[1] : "";
  })();

  if (targetDomain) {
    const hit = elements.find(e => String(e.href || e.h || "").toLowerCase().includes(targetDomain.replace(/^www\./, "")));
    if (hit) {
      const el = { i: hit.i || hit.id, t: hit.t || hit.tag || hit.type, y: hit.y || hit.type, r: hit.r || hit.role, x: hit.x || hit.text || "", l: hit.l || hit.label || "", h: hit.h || hit.href || "", p: hit.p || hit.placeholder || "" };
      return { tool: "tap", args: { element: el, verifyAfter: { urlIncludes: targetDomain.replace(/^www\./, "") } } };
    }
    return { tool: "navigate", args: { url: "https://" + targetDomain } };
  }

  if (/type\s+/.test(kw)) {
    const valm = instruction.match(/type\s+"([^"]+)"|type\s+'([^']+)'|type\s+(.+)/i);
    const value = valm ? (valm[1] || valm[2] || valm[3]).trim() : "";
    const input = elements.find(e => (e.y || e.type) === "input" || e.t === "input");
    if (input) return { action: "type", id: input.i || input.id, value };
  }

  const ranked = rankCandidates(elements, kw.split(/[^a-z0-9]+/).filter(Boolean));
  if (ranked.length) return { action: "click", id: ranked[0].i || ranked[0].id };
  return null;
}

function pickNextCall(action, instruction, elements) {
  try {
    if (!action) {
      const fa = fallbackAction(elements, instruction);
      return fa ? normalizeCall(fa) : null;
    }
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
    const fa = fallbackAction(elements, instruction);
    return fa ? normalizeCall(fa) : null;
  } catch {
    const fa = fallbackAction(elements, instruction);
    return fa ? normalizeCall(fa) : null;
  }
}

function guardNextCall(nc, instruction, preState, elements) {
  try {
    // Site-aware handling for 'search': prefer in-site search or direct site results
    if (nc && nc.tool === "search") {
      const q = (nc.args && (nc.args.query || nc.args.text)) ? String(nc.args.query || nc.args.text).trim() : "";
      const url0 = (preState && preState.state && preState.state.url) ? String(preState.state.url).toLowerCase() : "";
      const host0 = hostFromUrl(url0);
      const text0 = String(instruction || "").toLowerCase();
      let targetDomain = "";
      const dm0 = text0.match(/\b([a-z0-9-]+\.(?:com|in|net|org|io|ai|app|dev|store|shop|co|me|tv|info))\b/);
      if (dm0) targetDomain = dm0[1].replace(/^www\./, "");
      const activeDomain = (host0 || targetDomain || "").replace(/^www\./, "");

      if (activeDomain) {
        // Try to find an in-page search input
        const searchEl = (elements || []).find(e => {
          const isInput = ((e.t || e.tag || e.type) === "input" || (e.y || e.type) === "input");
          const text = ((e.l || e.label || "") + " " + (e.p || e.placeholder || "") + " " + (e.x || e.text || "")).toLowerCase();
          return isInput && /search/.test(text);
        });
        if (searchEl && q) {
          const id = searchEl.i || searchEl.id;
          return normalizeCall({ tool: "type", args: { id, value: q } });
        }
        if (/youtube\./.test(activeDomain) && q) {
          const navUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
          return injectVerification(normalizeCall({ tool: "navigate", args: { url: navUrl } }), preState);
        }
      }
      // Otherwise, avoid opening a new tab for generic web search; navigate current tab
      const args = { ...(nc.args || {}) };
      args.newTab = false;
      args.active = true;
      return normalizeCall({ tool: "search", args });
    }

    const url = (preState && preState.state && preState.state.url) ? String(preState.state.url).toLowerCase() : "";
    const text = String(instruction || "").toLowerCase();
    let targetDomain = "";
    const dm = text.match(/\b([a-z0-9-]+\.(?:com|in|net|org|io|ai|app|dev|store|shop|co|me|tv|info))\b/);
    if (dm) targetDomain = dm[1].replace(/^www\./, "");
    if (!targetDomain) return nc;
    if (url.includes(targetDomain)) return nc;
    const link = elements.find(e => String(e.href || e.h || "").toLowerCase().includes(targetDomain));
    if (link) {
      const el = { i: link.i || link.id, t: link.t || link.tag || link.type, y: link.y || link.type, r: link.r || link.role, x: link.x || link.text || "", l: link.l || link.label || "", h: link.h || link.href || "", p: link.p || link.placeholder || "" };
      return injectVerification(normalizeCall({ tool: "tap", args: { element: el } }), preState);
    }
    return injectVerification(normalizeCall({ tool: "navigate", args: { url: "https://www." + targetDomain } }), preState);
  } catch {
    return nc;
  }
}

async function setRunning(v) {
  document.body.classList.toggle("running", !!v);
  if (sendBtnEl) sendBtnEl.textContent = v ? "Stop" : "Send";
}

  

async function startAutoRun() {
  autoStop = false;
  await setRunning(true);
  let tabId = await getInjectableTabId();
  const key = geminiKeyEl.value.trim();
  const model = geminiModelEl.value.trim();
  const instruction = instructionEl.value.trim();
  if (instruction) {
    await ensurePlanForInstruction(instruction);
    try {
      const rctx0 = await chrome.runtime.sendMessage({ t: "GET_TASK_CONTEXT" });
      const subtasks0 = rctx0?.taskContext?.subtasks || [];
      if (subtasks0 && subtasks0.length) agentAddDetail("Plan: " + JSON.stringify(subtasks0));
    } catch {}
  }
  
  if (!key) {
    log("Add Gemini API Key in Settings");
    if (tabId) await sendToAgent(tabId, { t: "working", on: false });
    await setRunning(false);
    return;
  }
  
  let step = 0;
  if (tabId) {
    try {
      const t = await chrome.tabs.get(tabId);
      if (t && isInjectable(t.url)) {
        await ensureActiveAndFocused(tabId);
        await sendToAgent(tabId, { t: "setMode", experimental: experimentalMode });
        await sendToAgent(tabId, { t: "working", on: true });
        await waitReady(tabId);
      }
      try { chrome.runtime.sendMessage({ t: "TASK_ADD_RELEVANT_TAB", tabId }); } catch {}
    } catch {}
  }
  startRun("auto", instruction);
  
  while (!autoStop && step < 15) {
    // Ensure we have a valid tabId
    if (!tabId) {
      tabId = await getInjectableTabId();
      if (tabId) {
        await sendToAgent(tabId, { t: "setMode", experimental: experimentalMode });
        await sendToAgent(tabId, { t: "working", on: true });
      }
    }

    let elements = [];
    if (tabId) {
      try {
        elements = experimentalMode ? await mapCompact(tabId) : await simplify(tabId, true);
        try { elements = await enrichWithOCR(tabId, elements, instruction); } catch {}
        if (!elements || elements.length === 0) {
          elements = await mapCompact(tabId);
          try { elements = await enrichWithOCR(tabId, elements, instruction); } catch {}
        }
      } catch (e) {
        log("Failed to get elements from tab " + tabId + ": " + e.message);
        // Try to reinject content script
        try {
          await chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            files: ["content.js"]
          });
          // Wait a bit for script to load
          await new Promise(resolve => setTimeout(resolve, 500));
          // Try again
          elements = experimentalMode ? await mapCompact(tabId) : await simplify(tabId, true);
          try { elements = await enrichWithOCR(tabId, elements, instruction); } catch {}
        } catch (injectError) {
          log("Failed to reinject content script: " + injectError.message);
          // Try to get a new tab if current one failed
          tabId = await getInjectableTabId();
          if (tabId) {
            elements = experimentalMode ? await mapCompact(tabId) : await simplify(tabId, true);
            try { elements = await enrichWithOCR(tabId, elements, instruction); } catch {}
          }
        }
      }
    }

    const sendList = await ensureCandidates(tabId, instruction, elements);
    try {
      const snapText = elementsToText(Array.isArray(sendList) ? sendList.slice(0, 120) : []);
      chrome.runtime.sendMessage({ t: "TASK_MEMORY_SAVE_SNAPSHOT", elementsText: snapText });
    } catch {}
    const action = await callGemini(sendList, instruction, key, model, tabId);
    const nc0 = pickNextCall(action, instruction, sendList);
    tabId = await ensureExistingTab(tabId);
    const preState = tabId ? await sendToAgent(tabId, { t: "getPageState" }) : null;
    let nc = guardNextCall(nc0, instruction, preState, sendList);
    nc = injectVerification(nc, preState);
    const autoDone = maybeCompleteInstruction(instruction, preState);
    if (autoDone) nc = autoDone;
    if (!nc) break;
    if (nc.tool === "done") {
      log("Done");
      break;
    }
    if (shouldSkipCall(nc)) {
      log(JSON.stringify({ skipped: nc }));
      continue;
    }
      
      if (!tabId && (nc.tool === "new_tab" || nc.tool === "search")) {
        const r = await execTool(tabId || 0, nc);
        if (r && r.newTabId) {
          tabId = r.newTabId;
          await sendToAgent(tabId, { t: "setMode", experimental: experimentalMode });
          await sendToAgent(tabId, { t: "working", on: true });
        }
        log(JSON.stringify({ call: nc, result: r }));
        continue;
      }
      
      const now = Date.now();
      if (lastCall && callsEqual(lastCall, nc) && (now - lastCallAt < 1200)) {
        continue;
      }
      
    const preState2 = preState;
    if (nc.tool === "navigate") {
      const u = preState2 && preState2.state && preState2.state.url ? preState2.state.url : "";
      if (u && nc.args && nc.args.url && String(u) === String(nc.args.url)) {
        log(JSON.stringify({ skipped: nc }));
        lastCall = nc;
        lastCallAt = now;
        continue;
      }
    }
    await ensureActiveAndFocused(tabId);
    const r = await execTool(tabId, nc);
    if (r && r.newTabId) {
      tabId = r.newTabId;
      await ensureActiveAndFocused(tabId);
    }
    await ensureActiveAndFocused(tabId);
    log(JSON.stringify({ call: nc, result: r }));
    agentAddDetail("Result: " + JSON.stringify({ ok: r?.ok, newTabId: r?.newTabId }));
    try {
      const postState = tabId ? await sendToAgent(tabId, { t: "getPageState" }) : null;
      recordAction(nc, r, preState2, postState);
      agentAddDetail("Next: " + String(nc.tool || "") + " " + JSON.stringify(normalizeArgsForHistory(nc.args || {})));
      if (r && r.ok) await completeNextSubtask();
    } catch {}
    lastCall = nc;
    lastCallAt = now;
    
    
    barEl.style.width = String(((step + 1) / 15) * 100) + "%";
    await new Promise(res => setTimeout(res, 1000));
    step++;
  }
  
  if (tabId) await sendToAgent(tabId, { t: "working", on: false });
  await finishRun();
  await setRunning(false);
  try {
    const rctx = await chrome.runtime.sendMessage({ t: "GET_TASK_CONTEXT" });
    const sum = rctx?.taskContext?.collectedData?.summary;
    if (sum) agentAddDetail("Summary: " + JSON.stringify(sum));
  } catch {}
  agentUpdateMain("Completed");
}

if (sendBtnEl) {
  sendBtnEl.addEventListener("click", async () => {
    const running = document.body.classList.contains("running");
    if (running) {
      autoStop = true;
      log("Stopped");
      await setRunning(false);
      return;
    }
    await startAutoRun();
  });
}

if (instructionEl) {
  instructionEl.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const running = document.body.classList.contains("running");
      if (running) {
        autoStop = true;
        log("Stopped");
        await setRunning(false);
      } else {
        await startAutoRun();
      }
    }
  });
}

annotateEl.addEventListener("click", async () => {
  const tabId = await getInjectableTabId();
  if (!tabId) {
    log("No active tab");
    return;
  }
  await simplify(tabId, true);
  log("IDs on");
});

clearEl.addEventListener("click", async () => {
  const tabId = await getInjectableTabId();
  if (!tabId) {
    log("No active tab");
    return;
  }
  await sendToAgent(tabId, { t: "clear" });
  log("IDs off");
});

copyLogsEl.addEventListener("click", async () => {
  const gl = await fetchGlobalLogs();
  const rl = currentRunBuffer || [];
  const lines = [].concat(gl).concat(rl.length ? [""] : []).concat(rl);
  try { await navigator.clipboard.writeText(lines.join("\n")); } catch {}
});

async function runToolTestSuite() {
  let tabId = await getInjectableTabId();
  const testHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Heybro Test</title></head><body>
  <h1>Test Page</h1>
  <form id="f">
    <label for="name">Name</label>
    <input id="name" type="text" placeholder="Your name" />
    <input id="agree" type="checkbox" />
    <select id="opt"><option value="a">Alpha</option><option value="b">Bravo</option></select>
    <button id="go" type="button">Go</button>
    <button id="submit" type="submit">Submit</button>
  </form>
  <div id="lastEvent"></div>
  <div id="lastKey"></div>
  <div id="submitted"></div>
  <div style="height:2000px">Spacer</div>
  <script>
    document.getElementById('go').addEventListener('click', function(){ document.getElementById('lastEvent').textContent = 'Go clicked'; });
    document.getElementById('f').addEventListener('submit', function(e){ e.preventDefault(); document.getElementById('submitted').textContent = 'true'; });
    document.addEventListener('keydown', function(e){ document.getElementById('lastKey').textContent = e.key; });
  </script>
  </body></html>`;
  
  const open = await execTool(tabId, { tool: "new_tab", args: { url: "https://example.org/" } });
  tabId = open?.newTabId || tabId;
  await waitReady(tabId);
  
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (html) => { document.open(); document.write(html); document.close(); },
      args: [testHtml]
    });
    await waitReady(tabId);
  } catch {}
  
  const results = [];
  const push = (name, res, pass, actual) => {
    results.push({ tool: name, res, pass, actual });
  };
  
  let r, st;
  
  r = await execTool(tabId, { tool: "focus", args: { selector: "#name" } });
  const psFocus = await sendToAgent(tabId, { t: "getPageState" });
  push("focus", r, !!(r?.ok && psFocus?.state?.activeElement?.id === "name"), psFocus.state);
  
  r = await execTool(tabId, { tool: "type", args: { selector: "#name", value: "Alice" } });
  st = await sendToAgent(tabId, { t: "getTestState" });
  push("type", r, !!(r?.ok && st?.state?.name === "Alice"), st.state);

  r = await execTool(tabId, { tool: "tap", args: { selector: "#go" } });
  st = await sendToAgent(tabId, { t: "getTestState" });
  push("tap", r, !!(r?.ok && String(st?.state?.lastEvent || "").toLowerCase().includes("go clicked")), st.state);
  
  r = await execTool(tabId, { tool: "check", args: { selector: "#agree", value: true } });
  st = await sendToAgent(tabId, { t: "getTestState" });
  push("check", r, !!(r?.ok && st?.state?.agree === true), st.state);
  
  r = await execTool(tabId, { tool: "select", args: { selector: "#opt", value: "b" } });
  st = await sendToAgent(tabId, { t: "getTestState" });
  push("select", r, !!(r?.ok && st?.state?.opt === "b"), st.state);
  
  r = await execTool(tabId, { tool: "tap", args: { selector: "#go" } });
  await new Promise(res => setTimeout(res, 100));
  st = await sendToAgent(tabId, { t: "getTestState" });
  push("tap", r, !!(r?.ok && st?.state?.lastEvent === "Go clicked"), st.state);
  
  r = await execTool(tabId, { tool: "press", args: { key: "Enter" } });
  await new Promise(res => setTimeout(res, 100));
  st = await sendToAgent(tabId, { t: "getTestState" });
  push("press", r, !!(r?.ok && st?.state?.lastKey === "Enter"), st.state);
  
  r = await execTool(tabId, { tool: "submit", args: { selector: "#submit" } });
  await new Promise(res => setTimeout(res, 100));
  st = await sendToAgent(tabId, { t: "getTestState" });
  push("submit", r, !!(r?.ok && st?.state?.submitted === "true"), st.state);
  
  r = await execTool(tabId, { tool: "scroll", args: { to: "bottom" } });
  st = await sendToAgent(tabId, { t: "getTestState" });
  push("scroll_bottom", r, !!(r?.ok && (st?.state?.scrollY || 0) > 1000), st.state);
  
  r = await execTool(tabId, { tool: "scroll", args: { to: "top" } });
  st = await sendToAgent(tabId, { t: "getTestState" });
  push("scroll_top", r, !!(r?.ok && (st?.state?.scrollY || 0) < 50), st.state);
  
  r = await execTool(tabId, { tool: "copy", args: { selector: "#name" } });
  push("copy", r, !!(r?.ok && r?.copied === "Alice"), r);
  
  r = await execTool(tabId, { tool: "paste", args: { selector: "#name", value: "Bob" } });
  st = await sendToAgent(tabId, { t: "getTestState" });
  push("paste", r, !!(r?.ok && st?.state?.name === "Bob"), st.state);
  
  const secondUrl = `https://example.org/?second=${Date.now()}`;
  r = await execTool(tabId, { tool: "new_tab", args: { url: secondUrl } });
  push("new_tab", r, !!(r?.ok && r?.newTabId), r);
  
  const searchRes = await execTool(tabId, { tool: "search", args: { query: "heybro test" } });
  push("search", searchRes, !!(searchRes?.ok && searchRes?.newTabId), searchRes);
  
  if (r?.newTabId) {
    const sw = await execTool(tabId, { tool: "switch_tab", args: { id: r.newTabId } });
    push("switch_tab", sw, !!(sw?.ok && sw?.activeTabId === r.newTabId), sw);
  }
  
  const dn = await execTool(tabId, { tool: "done", args: {} });
  push("done", dn, !!(dn?.ok), dn);
  
  const navUrl = `https://example.org/?nav=${Date.now()}`;
  r = await execTool(tabId, { tool: "navigate", args: { url: navUrl } });
  await waitReady(tabId);
  const ps = await sendToAgent(tabId, { t: "getPageState" });
  push("navigate", r, !!(r?.ok && String(ps?.state?.url || '').includes('?nav=')), ps.state);
  
  log(JSON.stringify(results));
}

loadSettings()
startLogStreaming()
initMenu()
async function ensureActiveAndFocused(tabId) {
  if (!tabId) return;
  try {
    const t = await chrome.tabs.get(tabId);
    if (!t) return;
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(t.windowId, { focused: true });
  } catch {}
}
async function ensureTesseractLoaded() {
  if (window.Tesseract) return window.Tesseract;
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = chrome.runtime.getURL("vendor/tesseract.min.js");
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => reject(new Error("tesseract_load_failed"));
    document.head.appendChild(s);
  });
}

async function captureVisibleDataUrl() {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(undefined, { format: "png" });
    return dataUrl;
  } catch {
    return null;
  }
}

async function enrichWithOCR(tabId, elements, instruction) {
  try {
    const dataUrl = await captureVisibleDataUrl();
    if (!dataUrl) return elements;
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
    const base = document.createElement("canvas");
    base.width = img.width; base.height = img.height;
    const bctx = base.getContext("2d");
    bctx.drawImage(img, 0, 0);
    // Get viewport for DPI scaling
    let vw = 0, vh = 0, dpr = 1;
    try {
      const ps = await sendToAgent(tabId, { t: "getPageState" });
      vw = ps?.state?.viewport?.width || 0;
      vh = ps?.state?.viewport?.height || 0;
      dpr = ps?.state?.viewport?.dpr || (vw ? (img.width / vw) : 1);
    } catch {}
    const T = await ensureTesseractLoaded().catch(() => null);
    if (!T) return elements;
    const worker = await getOcrWorker(T).catch(() => null);
    if (!worker) return elements;
    const tokens = String(instruction || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const candidates = (elements || []).filter(e => {
      const b = e.b;
      if (!b || !e.v) return false;
      const area = (b.w || 0) * (b.h || 0);
      if (area < 3000) return false;
      const hasText = String(e.x || "").trim().length >= 4;
      const isImg = (String(e.t || e.tag || e.type).toLowerCase() === "img") || /image|graphic/.test(String(e.r || "").toLowerCase());
      if (isImg) return true;
      if (!hasText) return true;
      return tokens.some(t => !hasText || !String(e.x || "").toLowerCase().includes(t));
    }).slice(0, 12);
    for (const e of candidates) {
      const b = e.b;
      const crop = document.createElement("canvas");
      // Scale and clamp to image bounds
      const sx = Math.max(0, Math.round((b.x || 0) * dpr));
      const sy = Math.max(0, Math.round((b.y || 0) * dpr));
      const sw = Math.max(1, Math.min(Math.round((b.w || 1) * dpr), base.width - sx));
      const sh = Math.max(1, Math.min(Math.round((b.h || 1) * dpr), base.height - sy));
      crop.width = sw; crop.height = sh;
      const cctx = crop.getContext("2d");
      cctx.drawImage(base, sx, sy, sw, sh, 0, 0, sw, sh);
      let res;
      try {
        res = await worker.recognize(crop);
      } catch {}
      const txt = (res && res.data && res.data.text ? res.data.text : "").replace(/\s+/g, " ").trim();
      if (txt) e.o = txt;
    }
    return elements;
  } catch {
    return elements;
  }
}

async function getOcrWorker(T) {
  if (__hb_ocr_worker) return __hb_ocr_worker;
  const wp = chrome.runtime.getURL("vendor/worker.min.js");
  const cp = chrome.runtime.getURL("vendor/core");
  const lp = chrome.runtime.getURL("vendor/lang");
  const worker = await T.createWorker("eng", undefined, {
    workerPath: wp,
    corePath: cp,
    langPath: lp,
    workerBlobURL: false,
    gzip: true
  });
  __hb_ocr_worker = worker;
  return worker;
}
