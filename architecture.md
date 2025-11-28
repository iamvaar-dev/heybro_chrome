# Heybro Architecture & Improvement Plan

## Executive Summary
Heybro is a Chrome extension agent that automates browser tasks using a "Human-in-the-Loop" approach. It uses a background service worker for state management, a side panel for UI, and injected content scripts for DOM interaction. The core logic relies on a Planner (LLM) to generate steps and an Agent loop to execute them.

**Current Status:** Functional but inefficient in token usage, prone to "element not found" errors on dynamic pages, and limited in long-running task capability due to context window constraints and hard-coded limits.

**Goal:** Evolve into a "Zero Point Failure" system that is token-efficient, robust to DOM changes, and capable of sustained automation.

---

## 1. System Components

### 1.1. Background Service (`background.js`)
- **Role:** Central State Manager & Message Broker.
- **Responsibilities:**
  - Maintains the "Single Source of Truth" (Tabs, Task Context, Action History).
  - Handles tab registry and updates.
  - Persists state (in-memory currently, moving to `storage.local`).
  - Coordinates communication between Side Panel, Content Scripts, and Agent.

### 1.2. Agent Core (`lib/agent.js`)
- **Role:** The "Brain" and Execution Loop.
- **Responsibilities:**
  - **Loop:** `startAutoRun` manages the step-by-step execution (currently limited to 50 steps).
  - **Planning:** Calls `lib/planner.js` to get the next action.
  - **Execution:** Dispatches commands to `content.js` via `lib/tools.js`.
  - **Recovery:** Implements basic retry logic and "Zero Point Failure" element injection.

### 1.3. Planner (`lib/planner.js`)
- **Role:** LLM Interface.
- **Responsibilities:**
  - Constructs the prompt (System Prompt + Context + History).
  - Parses LLM responses into structured JSON (Thought, Call, Subtask Updates).
  - **Current Flaw:** Sends *all* interactive elements and full history, leading to token bloat.

### 1.4. Content Script (`content.js`)
- **Role:** The "Hands and Eyes".
- **Modules:**
  - **`PageScanner`:** Traverses DOM to find interactive elements and creates a flat map.
  - **`SmartLocator`:** Finds elements based on ID, selector, or fuzzy scoring (Text, Role, etc.).
  - **`InteractionEngine`:** Performs actions (Click, Type, Scroll) with event simulation for modern frameworks (React/Vue).
  - **`VisualCheck`:** Determines visibility and occlusion.

### 1.5. UI (`sidepanel.html` / `lib/ui.js`)
- **Role:** User Interface.
- **Responsibilities:**
  - Displays chat, logs, and task status.
  - Captures user instructions.

---

## 2. Data Flow

1.  **User Input:** User types a command in Side Panel.
2.  **Initialization:** `agent.js` starts, fetches `activeTab`.
3.  **Observation:** Agent requests `simplify` (or `mapCompact`) from `content.js`.
4.  **Planning:**
    - `planner.js` builds a prompt with:
        - **Task:** User instruction.
        - **State:** URL, Title.
        - **Elements:** List of interactive elements (compressed).
        - **History:** Recent actions and results.
    - Sends to Gemini (LLM).
5.  **Decision:** LLM returns a Plan (Thought + Tool Call).
6.  **Execution:**
    - `agent.js` sends Tool Call to `content.js`.
    - `SmartLocator` resolves the target element.
    - `InteractionEngine` performs the action.
7.  **Feedback:** Result (Success/Error) is sent back to `agent.js`, recorded in History, and the loop repeats.

---

## 3. Improvement Plan (Target Architecture)

### 3.1. Token Efficiency Strategy
**Problem:** Sending 2000+ elements and full history exhausts context windows and increases cost/latency.
**Solution:**
- **Dynamic Element Filtering:** Only send elements relevant to the *current* viewport or high-level semantic containers if possible. (For now: Aggressive compression of element attributes).
- **History Pruning:** Implement a "Sliding Window" for the prompt. Keep the last N steps detailed, and summarize older steps.
- **Prompt Optimization:** Remove redundant instructions in the system prompt.

### 3.2. Robustness (Zero Point Failure)
**Problem:** "Element not found" due to dynamic IDs or DOM updates between Plan and Execute.
**Solution:**
- **Signature-Based Re-binding:** The Planner will return a "Signature" (Text, Role, Context) alongside the ID.
- **SmartLocator Upgrade:** If ID lookup fails, `SmartLocator` will use the Signature to find the best matching element in the *current* DOM (Semantic Matching).
- **Self-Correction:** If an action fails, the Agent will perform a "Refind" step (refresh DOM -> retry) before giving up.

### 3.3. Long-Running Automations
**Problem:** 50-step hard limit and memory volatility.
**Solution:**
- **Pagination:** Reset the step counter if progress is being made.
- **State Persistence:** Periodically save `taskContext` and `actionHistory` to `chrome.storage.local` to allow recovery after browser restarts or crashes.
- **Async Coordination:** Ensure `background.js` acts as the stable anchor.

---

## 4. Tech Stack
- **Runtime:** Chrome Extension V3 (Service Worker).
- **AI:** Google Gemini (via API).
- **Language:** Vanilla JavaScript (ES Modules).
- **Styling:** CSS Variables (Native look).

---

## 5. Execution Roadmap

### Milestone 1: Token & Prompt Optimization
- [ ] **Task 1.1:** Optimize `compressElements` in `planner.js` to reduce JSON size.
- [ ] **Task 1.2:** Implement "History Summarization" in `agent.js` (keep last 10 detailed, summarize rest).
- [ ] **Task 1.3:** Refine System Prompt to be more concise.

### Milestone 2: Robustness (Zero Point Failure)
- [ ] **Task 2.1:** Enhance `SmartLocator.find` in `content.js` to support robust signature matching (already partially present, needs tuning).
- [ ] **Task 2.2:** Update `planner.js` to always generate robust element signatures.
- [ ] **Task 2.3:** Implement "Stale Element Recovery" in `agent.js` (auto-refresh map if element missing).

### Milestone 3: Long-Running Support
- [ ] **Task 3.1:** Remove/Soft-limit the 50-step cap in `agent.js`.
- [ ] **Task 3.2:** Implement State Persistence in `background.js`.

### Milestone 4: Agent Coordination
- [ ] **Task 4.1:** Ensure single-agent execution via `background.js` locking.
