// State Manager - Single source of truth for browser state
const stateManager = {
  tabs: {},
  activeTabId: null,
  tabOrder: [],
  actionHistory: [],
  currentTask: null,
  taskContext: {
    currentGoal: "",
    subtasks: [],
    relevantTabs: [],
    collectedData: {},
    errors: []
  },

  // Update tab registry
  updateTab(tab) {
    if (!tab?.id) return;
    const prev = this.tabs[tab.id] || {};
    this.tabs[tab.id] = {
      id: tab.id,
      windowId: tab.windowId,
      url: tab.url || prev.url || "",
      title: tab.title || prev.title || "",
      status: tab.status === "complete" ? "complete" : "loading",
      isActive: this.activeTabId === tab.id,
      createdAt: prev.createdAt || Date.now(),
      lastAccessed: Date.now(),
      lastSnapshot: null
    };
    if (!this.tabOrder.includes(tab.id)) {
      this.tabOrder.push(tab.id);
    }
  },

  // Record action for history
  recordAction(action, result) {
    this.actionHistory.push({
      timestamp: Date.now(),
      action,
      result
    });

    // Keep only last 50 actions
    if (this.actionHistory.length > 50) {
      this.actionHistory = this.actionHistory.slice(-50);
    }
  },

  setTaskContext(ctx) {
    const tc = ctx || {};
    this.taskContext = {
      currentGoal: String(tc.currentGoal || ""),
      subtasks: Array.isArray(tc.subtasks) ? tc.subtasks : [],
      relevantTabs: Array.isArray(tc.relevantTabs) ? tc.relevantTabs.filter(x => typeof x === "number") : [],
      collectedData: tc.collectedData && typeof tc.collectedData === "object" ? tc.collectedData : {},
      errors: Array.isArray(tc.errors) ? tc.errors : []
    };
  },

  updateTaskContext(patch) {
    const p = patch || {};
    const tc = this.taskContext || { currentGoal: "", subtasks: [], relevantTabs: [], collectedData: {}, errors: [] };
    if (p.currentGoal !== undefined) tc.currentGoal = String(p.currentGoal || "");
    if (p.subtasks) tc.subtasks = Array.isArray(p.subtasks) ? p.subtasks : tc.subtasks;
    if (p.relevantTabs) {
      const set = new Set([...(tc.relevantTabs || [])]);
      for (const id of p.relevantTabs) if (typeof id === "number") set.add(id);
      tc.relevantTabs = Array.from(set);
    }
    if (p.collectedData && typeof p.collectedData === "object") {
      tc.collectedData = { ...(tc.collectedData || {}), ...p.collectedData };
    }
    if (p.errors) {
      tc.errors = [...(tc.errors || []), ...p.errors];
    }
    this.taskContext = tc;
  },

  addRelevantTab(tabId) {
    if (!this.taskContext) this.taskContext = { currentGoal: "", subtasks: [], relevantTabs: [], collectedData: {}, errors: [] };
    if (tabId && typeof tabId === "number" && !this.taskContext.relevantTabs.includes(tabId)) {
      this.taskContext.relevantTabs.push(tabId);
    }
  },

  recordTaskError(err) {
    if (!this.taskContext) this.taskContext = { currentGoal: "", subtasks: [], relevantTabs: [], collectedData: {}, errors: [] };
    const payload = err || {};
    this.taskContext.errors.push({
      timestamp: Date.now(),
      action: payload.action,
      error: payload.error
    });
  },

  resetTask() {
    this.taskContext = { currentGoal: "", subtasks: [], relevantTabs: [], collectedData: {}, errors: [] };
  },

  // Get current browser state
  async getCurrentState() {
    const tabs = await chrome.tabs.query({});
    const windows = await chrome.windows.getAll({ populate: true });

    return {
      windows: windows.map(w => ({ id: w.id, focused: !!w.focused })),
      tabs: Object.values(this.tabs),
      activeTabId: this.activeTabId,
      actionHistory: this.actionHistory.slice(-10),
      taskContext: this.taskContext
    };
  }
};

let interactionLogs = [];
let taskMemory = { logs: [], actions: [], snapshots: [] };

function fmtTime(ts) {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `[${h}:${m}:${s}]`;
}

function pushLog(line) {
  const ts = Date.now();
  const s = fmtTime(ts) + " " + String(line || "");
  interactionLogs.push(s);
  if (interactionLogs.length > 1000) interactionLogs = interactionLogs.slice(-1000);
  try { taskMemory.logs.push(s); if (taskMemory.logs.length > 1000) taskMemory.logs = taskMemory.logs.slice(-1000); } catch { }
}

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs?.[0]?.id;
}

// Use stateManager.updateTab instead

async function refreshAllTabs() {
  const all = await chrome.tabs.query({});
  for (const t of all) stateManager.updateTab(t);
  const activeId = await getActiveTabId();
  stateManager.activeTabId = activeId || stateManager.activeTabId;
  for (const id of Object.keys(stateManager.tabs)) {
    stateManager.tabs[id].isActive = Number(id) === stateManager.activeTabId;
  }
}

function isInjectable(url) {
  return !!(url && /^(https?|file):/i.test(url));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  if (msg.t === "getActiveTabId") {
    getActiveTabId().then(id => sendResponse({ id }));
    return true;
  }

  if (msg.t === "GET_STATE") {
    (async () => {
      await refreshAllTabs();
      const state = await stateManager.getCurrentState();
      sendResponse(state);
    })();
    return true;
  }

  if (msg.t === "GET_TASK_CONTEXT") {
    sendResponse({ taskContext: stateManager.taskContext });
    return false;
  }

  if (msg.t === "SET_TASK_CONTEXT") {
    stateManager.setTaskContext(msg.ctx || {});
    sendResponse({ ok: true });
    return false;
  }

  if (msg.t === "UPDATE_TASK_CONTEXT") {
    stateManager.updateTaskContext(msg.patch || {});
    sendResponse({ ok: true });
    return false;
  }

  if (msg.t === "TASK_ADD_RELEVANT_TAB" && typeof msg.tabId === "number") {
    stateManager.addRelevantTab(msg.tabId);
    sendResponse({ ok: true });
    return false;
  }

  if (msg.t === "TASK_RECORD_ERROR") {
    stateManager.recordTaskError({ action: msg.action, error: msg.error });
    sendResponse({ ok: true });
    return false;
  }

  if (msg.t === "TASK_RESET") {
    stateManager.resetTask();
    sendResponse({ ok: true });
    return false;
  }

  if (msg.t === "GET_LOGS") {
    sendResponse({ logs: interactionLogs.slice(-500) });
    return false;
  }

  if (msg.t === "TASK_MEMORY_GET") {
    sendResponse({ memory: taskMemory });
    return false;
  }

  if (msg.t === "TASK_MEMORY_RESET") {
    taskMemory = { logs: [], actions: [], snapshots: [] };
    sendResponse({ ok: true });
    return false;
  }

  if (msg.t === "TASK_MEMORY_RECORD_ACTION") {
    const entry = { timestamp: Date.now(), action: msg.action, result: msg.result, preState: msg.preState, postState: msg.postState };
    taskMemory.actions.push(entry);
    if (taskMemory.actions.length > 200) taskMemory.actions = taskMemory.actions.slice(-200);
    sendResponse({ ok: true });
    return false;
  }

  if (msg.t === "TASK_MEMORY_SAVE_SNAPSHOT") {
    const snap = { timestamp: Date.now(), elementsText: msg.elementsText };
    taskMemory.snapshots.push(snap);
    if (taskMemory.snapshots.length > 50) taskMemory.snapshots = taskMemory.snapshots.slice(-50);
    sendResponse({ ok: true });
    return false;
  }

  if (msg.t === "EVENT_LOG") {
    const tab = sender && sender.tab ? sender.tab : null;
    const t = (msg.event || msg.type || "").toLowerCase();
    const d = msg.detail || {};
    if (t === "click") {
      const tag = String(d.tag || "").toLowerCase();
      const text = String(d.text || d.label || "").trim();
      pushLog(`Click → <${tag}> "${text}"`);
    } else if (t === "input") {
      const tag = String(d.tag || "").toLowerCase();
      const val = String(d.valuePreview || "");
      pushLog(`Input → <${tag}> "${val}"`);
    } else if (t === "scroll") {
      const y = d && typeof d.y === "number" ? d.y : 0;
      pushLog(`Scroll → y=${y}`);
    }
    sendResponse({ ok: true });
    return false;
  }

  if (msg.t === "SWITCH_TAB" && msg.tabId) {
    chrome.tabs.update(msg.tabId, { active: true }, async (tab) => {
      if (tab) {
        stateManager.updateTab(tab);
        stateManager.activeTabId = tab.id;

        // Ensure window is focused so user can see the tab switch
        try {
          await chrome.windows.update(tab.windowId, { focused: true });
        } catch (e) {
          // Window focusing might fail in some environments
        }
      }
      try {
        pushLog(`Tab switched → id=${stateManager.activeTabId}`);
      } catch { }
      sendResponse({ ok: true, activeTabId: stateManager.activeTabId });
    });
    return true;
  }

  if (msg.action === "OPEN_NEW_TAB" && msg.url) {
    chrome.tabs.create({ url: msg.url, active: true }, async (newTab) => {
      try {
        if (newTab?.id) {
          stateManager.updateTab(newTab);
          stateManager.activeTabId = newTab.id;
          stateManager.addRelevantTab(newTab.id);
          try { pushLog(`Tab created → ${newTab.url || ""}`); } catch { }
          try {
            await chrome.scripting.executeScript({
              target: { tabId: newTab.id, allFrames: true },
              files: ["content.js"]
            });
          } catch (e) {
            // Content script injection might fail for some URLs
          }
          sendResponse({ status: "success", newTabId: newTab.id });
        } else {
          sendResponse({ status: "error" });
        }
      } catch (e) {
        sendResponse({ status: "error" });
      }
    });
    return true;
  }

  if (msg.t === "RECORD_ACTION") {
    stateManager.recordAction(msg.action, msg.result);
    try {
      const entry = { timestamp: Date.now(), action: msg.action, result: msg.result, preState: msg.preState, postState: msg.postState };
      taskMemory.actions.push(entry);
      if (taskMemory.actions.length > 200) taskMemory.actions = taskMemory.actions.slice(-200);
    } catch { }
    return false;
  }

  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  (async () => {
    try {
      if (chrome.sidePanel?.setOptions) {
        await chrome.sidePanel.setOptions({ enabled: true, path: "sidepanel.html" });
      }
    } catch { }

    try {
      if (chrome.sidePanel?.setPanelBehavior) {
        await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
      }
    } catch { }

    let tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    let tab = tabs?.[0];
    await refreshAllTabs();

    if (!tab || !isInjectable(tab.url)) {
      const all = await chrome.tabs.query({ currentWindow: true });
      for (const t of all) {
        if (isInjectable(t.url)) {
          tab = t;
          break;
        }
      }
    }

    if (tab) stateManager.updateTab(tab);

    try {
      if (chrome.sidePanel?.open && tab?.id) {
        await chrome.sidePanel.open({ tabId: tab.id });
      }
    } catch { }
  })();
});

chrome.action.onClicked.addListener(async (tab) => {
  let targetTab = tab;

  if (!targetTab?.id || !isInjectable(targetTab.url)) {
    const all = await chrome.tabs.query({ currentWindow: true });
    for (const t of all) {
      if (isInjectable(t.url)) {
        targetTab = t;
        break;
      }
    }
  }

  if (targetTab) stateManager.updateTab(targetTab);

  try {
    if (chrome.sidePanel?.open) {
      await chrome.sidePanel.open({ tabId: targetTab.id });
    }
  } catch { }
});

chrome.tabs.onCreated.addListener((tab) => {
  stateManager.updateTab(tab);
  try { pushLog(`Tab created → ${tab.url || ""}`); } catch { }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  delete stateManager.tabs[tabId];
  stateManager.tabOrder = stateManager.tabOrder.filter(id => id !== tabId);
  try { pushLog(`Tab closed → id=${tabId}`); } catch { }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  stateManager.activeTabId = tabId;
  const t = await chrome.tabs.get(tabId).catch(() => undefined);
  if (t) stateManager.updateTab(t);
  try { pushLog(`Tab activated → id=${tabId}, url= \`${t?.url || ""}\``); } catch { }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  stateManager.updateTab(tab);
  try {
    if (changeInfo.url) {
      pushLog(`Navigation → \`${changeInfo.url}\``);
    }
  } catch { }
});
