
import { state, saveSettings } from './state.js';

const els = {
    stream: document.getElementById("stream"),
    instruction: document.getElementById("instruction"),
    sendBtn: document.getElementById("send-btn"),
    clearBtn: document.getElementById("clear-btn"),
    settingsBtn: document.getElementById("settings-btn"),
    settingsModal: document.getElementById("settings-modal"),
    closeSettings: document.getElementById("close-settings"),
    saveSettings: document.getElementById("save-settings"),
    geminiKey: document.getElementById("gemini-key"),
    geminiModel: document.getElementById("gemini-model"),
    modeSelect: document.getElementById("mode-select")
};

export function getEls() {
    return els;
}

function scrollToBottom() {
    if (els.stream) {
        els.stream.scrollTop = els.stream.scrollHeight;
    }
}

export function addMessage(role, text) {
    if (!els.stream) return;
    const div = document.createElement("div");
    div.className = `msg ${role}`;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;
    div.appendChild(bubble);
    els.stream.appendChild(div);
    scrollToBottom();
    return div;
}

export function addStep(title) {
    if (!els.stream) return null;
    const div = document.createElement("div");
    div.className = "step active";

    const icon = document.createElement("div");
    icon.className = "step-icon";
    const spinner = document.createElement("div");
    spinner.className = "spinner";
    icon.appendChild(spinner);

    const content = document.createElement("div");
    content.className = "step-content";
    content.textContent = title;

    div.appendChild(icon);
    div.appendChild(content);
    els.stream.appendChild(div);
    scrollToBottom();

    return {
        update: (status, newTitle) => {
            if (newTitle) content.textContent = newTitle;
            if (status === "done") {
                div.className = "step done";
                icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="text-green-500"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                icon.style.color = "var(--success)";
            } else if (status === "error") {
                div.className = "step error";
                icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="text-red-500"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
                icon.style.color = "var(--error)";
            }
        }
    };
}

export function addPlan(subtasks) {
    if (!els.stream || !subtasks || !subtasks.length) return;

    const card = document.createElement("div");
    card.className = "plan-card";

    const header = document.createElement("div");
    header.className = "plan-header";
    header.textContent = "Plan";
    card.appendChild(header);

    const items = subtasks.map(t => {
        const row = document.createElement("div");
        row.className = "plan-item pending";
        row.innerHTML = `<span>•</span><span>${t.title}</span>`;
        card.appendChild(row);
        return { row, title: t.title };
    });

    els.stream.appendChild(card);
    scrollToBottom();

    return {
        update: (index, status) => {
            if (items[index]) {
                const item = items[index];
                item.row.className = `plan-item ${status}`;
                if (status === "active") {
                    item.row.innerHTML = `<span>→</span><span>${item.title}</span>`;
                } else if (status === "completed") {
                    item.row.innerHTML = `<span>✓</span><span>${item.title}</span>`;
                }
            }
        }
    };
}

export function initSettingsUI() {
    if (els.settingsBtn) {
        els.settingsBtn.addEventListener("click", () => {
            els.settingsModal.classList.add("visible");
            // Populate fields
            if (els.geminiKey) els.geminiKey.value = state.geminiKey || "";
            if (els.geminiModel) els.geminiModel.value = state.geminiModel || "gemini-2.5-flash";
            if (els.modeSelect) els.modeSelect.value = state.experimentalMode ? "experimental" : "standard";
        });
    }

    function close() {
        els.settingsModal.classList.remove("visible");
    }

    if (els.closeSettings) els.closeSettings.addEventListener("click", close);

    if (els.saveSettings) {
        els.saveSettings.addEventListener("click", () => {
            state.geminiKey = els.geminiKey.value;
            state.geminiModel = els.geminiModel.value;
            state.experimentalMode = els.modeSelect.value === "experimental";
            saveSettings();
            close();
        });
    }

    if (els.clearBtn) {
        els.clearBtn.addEventListener("click", () => {
            if (els.stream) els.stream.innerHTML = "";
            addMessage("agent", "Chat cleared. Ready for new tasks!");
        });
    }

    // Auto-resize textarea
    if (els.instruction) {
        els.instruction.addEventListener("input", function () {
            this.style.height = "auto";
            this.style.height = (this.scrollHeight) + "px";
        });
    }
}

export function setRunning(v) {
    if (els.sendBtn) {
        els.sendBtn.innerHTML = v
            ? `<div class="spinner" style="width:14px;height:14px;border-color:white;border-top-color:transparent"></div>`
            : `<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`;
    }
    document.body.classList.toggle("running", !!v);
}

// Legacy compatibility shim
export function logToUI(text) {
    // Only log significant errors or info, skip debug noise
    if (text && (text.toLowerCase().includes("error") || text.toLowerCase().includes("fail"))) {
        addStep(text).update("error");
    }
}

export function agentAddDetail(text) {
    // No-op or maybe verbose log
}

export function agentUpdateMain(text) {
    // No-op
}

export function updateProgressBar(p) {
    // No-op
}

export function initMenu() {
    // No-op
}

export function startLogStreaming() {
    // No-op
}
