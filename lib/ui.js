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
    themeSelect: document.getElementById("theme-select"),
    taskListBtn: document.getElementById("task-list-btn"),
    taskDrawer: document.getElementById("task-drawer"),
    taskList: document.getElementById("task-list"),
    closeDrawer: document.getElementById("close-drawer"),
    drawerNewTask: document.getElementById("drawer-new-task"),
    showLogsBtn: document.getElementById("show-logs-btn"),
    activeTaskHeader: document.getElementById("active-task-header"),
    taskTextContent: document.getElementById("task-text-content"),
    stepsContainer: document.getElementById("steps-container"),
    welcomeMessage: document.getElementById("welcome-message"),
    answerContainer: document.getElementById("answer-container"),
    answerText: document.getElementById("answer-text"),
    expandControl: document.getElementById("expand-control"),
    expandControl: document.getElementById("expand-control"),
    expandText: document.getElementById("expand-text"),
    drawerBackdrop: document.getElementById("drawer-backdrop")
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
    } else if (type === "success") {
        div.className = "msg-success";
        div.innerHTML = `
            <div class="success-icon">✓</div>
            <div class="success-text">${content}</div>
        `;
    }

    els.stream.appendChild(div);
    scrollToBottom();
    return div;
}

export function updatePlanItem(index, status) {
    if (!els.stream) return;
    // Find the last plan block
    const planBlocks = els.stream.querySelectorAll(".todo-list");
    if (planBlocks.length === 0) return;
    const lastPlan = planBlocks[planBlocks.length - 1];

    const items = lastPlan.querySelectorAll(".todo-item");
    if (index >= 0 && index < items.length) {
        const item = items[index];
        const icon = item.querySelector(".todo-icon");
        const text = item.querySelector(".todo-text");

        if (status === "completed") {
            if (icon) {
                icon.textContent = "✓";
                icon.classList.add("done");
                icon.classList.remove("active");
            }
            if (text) {
                text.classList.add("done");
                text.classList.remove("active");
            }
        } else if (status === "active") {
            if (icon) {
                icon.textContent = "→";
                icon.classList.add("active");
                icon.classList.remove("done");
            }
            if (text) {
                text.classList.add("active");
                text.classList.remove("done");
            }
        }
    }
}

export function toContinuous(text) {
    if (!text) return "";
    const words = text.split(" ");
    if (words.length === 0) return "";

    let first = words[0];
    const rest = words.slice(1).join(" ");

    // Simple heuristic for verb -> continuous
    if (first.endsWith("e")) first = first.slice(0, -1) + "ing";
    else if (!first.endsWith("ing")) first = first + "ing";

    // Capitalize
    first = first.charAt(0).toUpperCase() + first.slice(1);

    return first + (rest ? " " + rest : "") + "...";
}

let currentLiveTaskDiv = null;

export function setLiveTask(text) {
    if (!els.stream) return;

    // Remove existing if any
    if (currentLiveTaskDiv) {
        currentLiveTaskDiv.remove();
        currentLiveTaskDiv = null;
    }

    const div = document.createElement("div");
    div.className = "live-task-container";
    div.innerHTML = `
        <div class="live-task-text">${text}</div>
    `;

    els.stream.appendChild(div);
    currentLiveTaskDiv = div;
    scrollToBottom();
}

export function removeLiveTask() {
    if (currentLiveTaskDiv) {
        currentLiveTaskDiv.remove();
        currentLiveTaskDiv = null;
    }
}

export function logCompletedTask(title) {
    if (!title) return;
    // Use appendBlock with "plan" type to render it exactly like a todo item
    // We pass a single-item array with status "completed"
    appendBlock([{ title: title, status: "completed" }], "plan");
}

function renderHistory(history) {
    if (!els.stream) return;
    resetUI();
    els.stream.innerHTML = "";
    currentAgentDiv = null;
    typeQueue = [];
    isTyping = false;

    let hasUserMessage = false;
    let hasAnswer = false;
    let hasStopped = false;

    for (const event of history) {
        if (event.type === "agent_text") {
            const div = document.createElement("div");
            div.className = "msg-agent";
            div.textContent = event.content;
            els.stream.appendChild(div);
        } else if (event.type === "block") {
            appendBlock(event.content, event.contentType, false);
            if (event.contentType === "user") {
                hasUserMessage = true;
                setTask(event.content); // Restore task header
            }
        } else if (event.type === "answer") {
            hasAnswer = true;
            if (els.answerText) els.answerText.textContent = event.content;
            if (els.answerContainer) {
                els.answerContainer.classList.remove("stopped");
                els.answerContainer.classList.add("visible");
            }
        } else if (event.type === "stopped") {
            hasStopped = true;
            if (els.answerText) els.answerText.textContent = event.content;
            if (els.answerContainer) {
                els.answerContainer.classList.add("visible");
                els.answerContainer.classList.add("stopped");
            }
        }
    }

    // If we have history but no user message (rare), try to set task from session title
    if (!hasUserMessage && history.length > 0) {
        import('./state.js').then(m => {
            const session = m.getActiveSession();
            if (session && session.title !== "New Task") {
                setTask(session.title);
            }
        });
    }

    if (hasAnswer || hasStopped) {
        collapseLogs();
    }

    if (hasAnswer || hasStopped) {
        collapseLogs();
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
            if (els.drawerBackdrop) els.drawerBackdrop.style.display = "none";
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
            // streamText("Ready for a new task.\n"); // Removed to keep home state clean
        });
    }

    if (els.taskListBtn) {
        els.taskListBtn.addEventListener("click", () => {
            renderTaskList();
            els.taskDrawer.style.transform = "translateX(0)";
            if (els.drawerBackdrop) els.drawerBackdrop.style.display = "block";
        });
    }

    if (els.drawerBackdrop) {
        els.drawerBackdrop.addEventListener("click", () => {
            els.taskDrawer.style.transform = "translateX(-100%)";
            els.drawerBackdrop.style.display = "none";
        });
    }

    if (els.closeDrawer) {
        els.closeDrawer.addEventListener("click", () => {
            els.taskDrawer.style.transform = "translateX(-100%)";
            if (els.drawerBackdrop) els.drawerBackdrop.style.display = "none";
        });
    }

    if (els.drawerNewTask) {
        els.drawerNewTask.addEventListener("click", () => {
            createSession("New Task");
            renderHistory([]);
            streamText("Ready for a new task.\n");
            els.taskDrawer.style.transform = "translateX(-100%)";
            if (els.drawerBackdrop) els.drawerBackdrop.style.display = "none";
        });
    }

    if (els.settingsBtn) {
        els.settingsBtn.addEventListener("click", () => {
            els.settingsModal.classList.add("visible");
            if (els.geminiKey) els.geminiKey.value = state.geminiKey || "";
            if (els.geminiKey) els.geminiKey.value = state.geminiKey || "";
            if (els.geminiModel) els.geminiModel.value = state.geminiModel || "gemini-2.5-flash";
            if (els.modeSelect) els.modeSelect.value = state.experimentalMode ? "experimental" : "standard";
            if (els.themeSelect) els.themeSelect.value = state.theme || "dark";
        });
    }

    const closeSettingsBtn = document.getElementById("close-settings");
    if (closeSettingsBtn) {
        closeSettingsBtn.addEventListener("click", () => {
            els.settingsModal.classList.remove("visible");
        });
    }

    // Close settings when clicking outside (on the modal background)
    if (els.settingsModal) {
        els.settingsModal.addEventListener("click", (e) => {
            if (e.target === els.settingsModal) {
                els.settingsModal.classList.remove("visible");
            }
        });
    }

    if (els.saveSettings) {
        els.saveSettings.addEventListener("click", () => {
            state.geminiKey = els.geminiKey.value;
            state.geminiModel = els.geminiModel.value;
            state.experimentalMode = els.modeSelect.value === "experimental";
            state.theme = els.themeSelect.value;
            applyTheme(state.theme);
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
    applyTheme(state.theme);

    initLogViewer();

    if (els.showLogsBtn) {
        els.showLogsBtn.addEventListener("click", () => {
            const modal = document.getElementById("log-modal");
            if (modal) {
                modal.classList.add("visible");
                scrollToBottomLog();
            }
        });
    }

    // Close logs when clicking outside
    const logModal = document.getElementById("log-modal");
    if (logModal) {
        logModal.addEventListener("click", (e) => {
            if (e.target === logModal) {
                logModal.classList.remove("visible");
            }
        });
    }

    if (els.expandControl) {
        els.expandControl.addEventListener("click", () => {
            if (els.stepsContainer && els.stepsContainer.classList.contains("collapsed")) {
                expandLogs();
            } else {
                collapseLogs();
            }
        });
    }
}

function scrollToBottomLog() {
    const c = document.getElementById("log-content");
    if (c) c.scrollTop = c.scrollHeight;
}

export function setRunning(v) {
    if (els.sendBtn) {
        els.sendBtn.innerHTML = v
            ? `<div style="width:10px;height:10px;background:white;border-radius:2px;animation:spin 1s infinite"></div>`
            : `<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`;
    }
    document.body.classList.toggle("running", !!v);
}

// Log Viewer
function initLogViewer() {
    const contentDiv = document.getElementById("log-content");
    const closeBtn = document.getElementById("close-logs");
    const copyBtn = document.getElementById("copy-logs");
    const clearBtn = document.getElementById("clear-logs");
    const modal = document.getElementById("log-modal");

    if (closeBtn && modal) {
        closeBtn.addEventListener("click", () => {
            modal.classList.remove("visible");
        });
    }

    if (copyBtn && contentDiv) {
        copyBtn.addEventListener("click", () => {
            const text = contentDiv.innerText;
            navigator.clipboard.writeText(text).then(() => {
                const original = copyBtn.textContent;
                copyBtn.textContent = "Copied!";
                setTimeout(() => copyBtn.textContent = original, 1500);
            });
        });
    }

    if (clearBtn && contentDiv) {
        clearBtn.addEventListener("click", () => {
            contentDiv.innerHTML = "";
            import('./logger.js').then(m => m.Logger.clear());
        });
    }

    // Listen for logs
    window.addEventListener('heybro-log', (e) => {
        if (!contentDiv) return;
        const entry = e.detail;
        const line = document.createElement('div');
        line.style.marginBottom = "4px";
        line.style.borderBottom = "1px solid #222";
        line.style.paddingBottom = "4px";

        const time = new Date(entry.timestamp).toLocaleTimeString();
        const typeColor = entry.type === 'error' ? '#ef4444' : (entry.type === 'warn' ? '#f59e0b' : '#10b981');

        let dataStr = "";
        try {
            if (typeof entry.data === 'string') dataStr = entry.data;
            else dataStr = JSON.stringify(entry.data, null, 2);
        } catch { dataStr = String(entry.data); }

        line.innerHTML = `
            <div style="color:#666;font-size:10px;">[${time}] <span style="color:${typeColor};font-weight:bold">${entry.type.toUpperCase()}</span></div>
            <div style="white-space:pre-wrap;word-break:break-all;">${dataStr}</div>
        `;

        contentDiv.appendChild(line);

        // Auto scroll if near bottom
        if (modal && modal.classList.contains("visible")) {
            if (contentDiv.scrollHeight - contentDiv.scrollTop - contentDiv.clientHeight < 100) {
                contentDiv.scrollTop = contentDiv.scrollHeight;
            }
        }
    });
}
export function setTask(text) {
    if (els.activeTaskHeader && els.taskTextContent) {
        els.taskTextContent.textContent = text;
        els.activeTaskHeader.style.display = "block";
    }
    if (els.welcomeMessage) els.welcomeMessage.classList.add("hidden");
    if (els.stepsContainer) {
        els.stepsContainer.classList.add("active");
        els.stepsContainer.classList.remove("collapsed"); // Show steps
    }
}

export function showAnswer(text) {
    if (!els.answerContainer || !els.answerText) return;
    els.answerText.textContent = text;
    els.answerContainer.classList.remove("stopped"); // Ensure not red
    els.answerContainer.classList.add("visible");
    updateSessionHistory({ type: "answer", content: text });
    collapseLogs();
}

export function showStopped(reason = "Stopped manually") {
    if (!els.answerContainer || !els.answerText) return;
    els.answerText.textContent = reason;
    els.answerContainer.classList.add("visible");
    els.answerContainer.classList.add("stopped"); // Add error style
    updateSessionHistory({ type: "stopped", content: reason });
    collapseLogs();
}

export function collapseLogs() {
    if (!els.stepsContainer) return;
    els.stepsContainer.classList.add("collapsed");

    if (els.expandControl) {
        els.expandControl.classList.add("visible");
        els.expandControl.classList.remove("expanded");

        // Count steps
        const steps = els.stream ? els.stream.querySelectorAll(".md-block, .msg-agent").length : 0;
        if (els.expandText) els.expandText.textContent = `${steps} steps completed`;
    }
}

function expandLogs() {
    if (!els.stepsContainer) return;
    els.stepsContainer.classList.remove("collapsed");
    if (els.expandControl) {
        els.expandControl.classList.add("expanded");
    }
}

function resetUI() {
    if (els.answerContainer) els.answerContainer.classList.remove("visible");
    if (els.expandControl) {
        els.expandControl.classList.remove("visible");
        els.expandControl.classList.remove("expanded");
    }
    if (els.stepsContainer) {
        els.stepsContainer.classList.add("collapsed"); // Default to collapsed (hidden)
        els.stepsContainer.classList.remove("active");
    }
    if (els.stream) {
        els.stream.classList.remove("history-mode");
    }
    if (els.activeTaskHeader) {
        els.activeTaskHeader.style.display = "none";
    }
    if (els.welcomeMessage) {
        els.welcomeMessage.classList.remove("hidden");
    }
}

export function logToUI(text) { }
export function agentAddDetail(text) { }
export function agentUpdateMain(text) { }
export function updateProgressBar(p) { }
export function initMenu() { }
export function startLogStreaming() { }
export function addMessage(role, text) {
    if (role === "user") {
        // Reset UI on new user message if we were in a finished state
        if (els.stream && els.stream.classList.contains("history-mode")) {
            resetUI();
        }
        appendBlock(text, "user");
    }
    else streamText(text);
}
export function addStep(title) { return { update: () => { } }; }
export function addPlan(subtasks) { appendBlock(subtasks, "plan"); return { update: () => { } }; }

function applyTheme(theme) {
    if (theme === "light") {
        document.documentElement.setAttribute("data-theme", "light");
    } else {
        document.documentElement.removeAttribute("data-theme");
    }
}
