import { state, saveSettings, createSession, switchSession, deleteSession, updateSessionHistory, getActiveSession } from './state.js';

const els = {
    stream: document.getElementById("stream"),
    instruction: document.getElementById("instruction"),
    sendBtn: document.getElementById("send-btn"),
    settingsBtn: document.getElementById("settings-btn"),
    settingsModal: document.getElementById("settings-modal"),
    saveSettings: document.getElementById("save-settings"),
    geminiKey: document.getElementById("gemini-key"),
    geminiModel: document.getElementById("gemini-model"),
    modeSelect: document.getElementById("mode-select"),
    taskListBtn: document.getElementById("task-list-btn"),
    taskDrawer: document.getElementById("task-drawer"),
    taskList: document.getElementById("task-list"),
    closeDrawer: document.getElementById("close-drawer"),
    drawerNewTask: document.getElementById("drawer-new-task")
};

export function getEls() {
    return els;
}

function scrollToBottom() {
    if (els.stream) {
        els.stream.scrollTop = els.stream.scrollHeight;
    }
}

// Stream Renderer
let currentAgentDiv = null;
let typeQueue = [];
let isTyping = false;

async function processTypeQueue() {
    if (isTyping) return;
    isTyping = true;
    while (typeQueue.length > 0) {
        const { char, div } = typeQueue.shift();
        div.textContent += char;
        scrollToBottom();
        // Random typing delay for realism
        await new Promise(r => setTimeout(r, Math.random() * 10 + 5));
    }
    isTyping = false;
    // Remove cursor when done
    if (currentAgentDiv) currentAgentDiv.classList.remove("cursor");
}

export function streamText(text, save = true) {
    if (!els.stream) return;
    if (state.autoStop && text !== "\nStopped in middle.\n") return;

    if (save) updateSessionHistory({ type: "agent_text", content: text });

    if (!currentAgentDiv) {
        currentAgentDiv = document.createElement("div");
        currentAgentDiv.className = "msg-agent cursor";
        els.stream.appendChild(currentAgentDiv);
    }

    // Add to queue
    for (const char of text) {
        typeQueue.push({ char, div: currentAgentDiv });
    }
    processTypeQueue();
}

export function stopStreaming() {
    typeQueue = [];
    isTyping = false;
    if (currentAgentDiv) {
        currentAgentDiv.classList.remove("cursor");
        currentAgentDiv = null;
    }
}

export function appendBlock(content, type = "text", save = true) {
    if (!els.stream) return;

    if (save) updateSessionHistory({ type: "block", contentType: type, content: content });

    // Finish current typing block
    if (currentAgentDiv) {
        currentAgentDiv.classList.remove("cursor");
        currentAgentDiv = null;
    }

    const div = document.createElement("div");

    if (type === "user") {
        div.className = "msg-user";
        div.textContent = content;
    } else if (type === "action") {
        div.className = "md-block";
        div.textContent = content;
    } else if (type === "plan") {
        div.className = "todo-list";
        div.innerHTML = content.map(item => {
            const icon = item.status === "completed" ? "✓" : (item.status === "active" ? "→" : "○");
            const cls = item.status === "completed" ? "done" : (item.status === "active" ? "active" : "");
            return `
        <div class="todo-item">
          <div class="todo-icon ${cls}">${icon}</div>
          <div class="todo-text ${cls}">${item.title}</div>
        </div>
      `;
        }).join("");
    }

    els.stream.appendChild(div);
    scrollToBottom();
}

function renderHistory(history) {
    if (!els.stream) return;
    els.stream.innerHTML = "";
    currentAgentDiv = null;
    typeQueue = [];
    isTyping = false;

    for (const event of history) {
        if (event.type === "agent_text") {
            const div = document.createElement("div");
            div.className = "msg-agent";
            div.textContent = event.content;
            els.stream.appendChild(div);
        } else if (event.type === "block") {
            appendBlock(event.content, event.contentType, false);
        }
    }
    scrollToBottom();
}

function renderTaskList() {
    if (!els.taskList) return;
    els.taskList.innerHTML = "";
    state.sessions.forEach(s => {
        const row = document.createElement("div");
        row.style.padding = "10px";
        row.style.borderBottom = "1px solid #27272a";
        row.style.cursor = "pointer";
        row.style.background = s.id === state.activeSessionId ? "#27272a" : "transparent";
        row.style.display = "flex";
        row.style.justifyContent = "space-between";
        row.style.alignItems = "center";

        const title = document.createElement("div");
        title.textContent = s.title;
        title.style.fontSize = "13px";
        title.style.fontWeight = s.id === state.activeSessionId ? "600" : "400";

        const delBtn = document.createElement("button");
        delBtn.textContent = "✕";
        delBtn.style.background = "transparent";
        delBtn.style.border = "none";
        delBtn.style.color = "#a1a1aa";
        delBtn.style.cursor = "pointer";
        delBtn.onclick = (e) => {
            e.stopPropagation();
            deleteSession(s.id);
            renderTaskList();
            if (s.id === state.activeSessionId) {
                const active = getActiveSession();
                if (active) renderHistory(active.history);
            }
        };

        row.onclick = () => {
            switchSession(s.id);
            renderHistory(s.history);
            renderTaskList();
            els.taskDrawer.style.transform = "translateX(-100%)";
        };

        row.appendChild(title);
        row.appendChild(delBtn);
        els.taskList.appendChild(row);
    });
}

export function initSettingsUI() {
    const newTaskBtn = document.getElementById("new-task-btn");
    if (newTaskBtn) {
        newTaskBtn.addEventListener("click", () => {
            createSession("New Task");
            renderHistory([]);
            streamText("Ready for a new task.\n");
        });
    }

    if (els.taskListBtn) {
        els.taskListBtn.addEventListener("click", () => {
            renderTaskList();
            els.taskDrawer.style.transform = "translateX(0)";
        });
    }

    if (els.closeDrawer) {
        els.closeDrawer.addEventListener("click", () => {
            els.taskDrawer.style.transform = "translateX(-100%)";
        });
    }

    if (els.drawerNewTask) {
        els.drawerNewTask.addEventListener("click", () => {
            createSession("New Task");
            renderHistory([]);
            streamText("Ready for a new task.\n");
            els.taskDrawer.style.transform = "translateX(-100%)";
        });
    }

    if (els.settingsBtn) {
        els.settingsBtn.addEventListener("click", () => {
            els.settingsModal.classList.add("visible");
            if (els.geminiKey) els.geminiKey.value = state.geminiKey || "";
            if (els.geminiModel) els.geminiModel.value = state.geminiModel || "gemini-2.5-flash";
            if (els.modeSelect) els.modeSelect.value = state.experimentalMode ? "experimental" : "standard";
        });
    }

    const closeSettingsBtn = document.getElementById("close-settings");
    if (closeSettingsBtn) {
        closeSettingsBtn.addEventListener("click", () => {
            els.settingsModal.classList.remove("visible");
        });
    }

    if (els.saveSettings) {
        els.saveSettings.addEventListener("click", () => {
            state.geminiKey = els.geminiKey.value;
            state.geminiModel = els.geminiModel.value;
            state.experimentalMode = els.modeSelect.value === "experimental";
            saveSettings();
            els.settingsModal.classList.remove("visible");
        });
    }

    if (els.instruction) {
        els.instruction.addEventListener("input", function () {
            this.style.height = "auto";
            this.style.height = (this.scrollHeight) + "px";
        });
    }

    // Initial load
    const active = getActiveSession();
    if (active) renderHistory(active.history);
}

export function setRunning(v) {
    if (els.sendBtn) {
        els.sendBtn.innerHTML = v
            ? `<div style="width:10px;height:10px;background:white;border-radius:2px;animation:spin 1s infinite"></div>`
            : `<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`;
    }
    document.body.classList.toggle("running", !!v);
}

// Legacy shims
export function logToUI(text) { }
export function agentAddDetail(text) { }
export function agentUpdateMain(text) { }
export function updateProgressBar(p) { }
export function initMenu() { }
export function startLogStreaming() { }
export function addMessage(role, text) {
    if (role === "user") appendBlock(text, "user");
    else streamText(text);
}
export function addStep(title) { return { update: () => { } }; }
export function addPlan(subtasks) { appendBlock(subtasks, "plan"); return { update: () => { } }; }
