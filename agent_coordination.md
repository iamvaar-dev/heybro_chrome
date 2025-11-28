# Agent Coordination Plan

## 1. Roles & Responsibilities

### Central Coordinator (`background.js`)
- **Role:** The "State Authority".
- **Responsibility:**
  - Holds the master state (Task Context, Action History, Tab Registry).
  - Serializes state to `chrome.storage.local` for persistence.
  - Acts as the mutex/lock for task execution (ensures only one "run" is active).
  - Routes messages between the UI (Side Panel) and the Worker (Agent).

### Execution Worker (`lib/agent.js`)
- **Role:** The "Task Runner".
- **Responsibility:**
  - Runs the main loop (`startAutoRun`).
  - Fetches plans from the Planner (LLM).
  - Executes tools on the Content Script.
  - Reports progress and errors back to the Coordinator.
  - **Failure Behavior:** If a tool fails, it attempts a local retry (refresh DOM -> retry with signature) before escalating to a replan.

### DOM Agent (`content.js`)
- **Role:** The "Local Operative".
- **Responsibility:**
  - Scans the page for elements.
  - Executes atomic actions (Click, Type).
  - **Failure Behavior:** If an element ID is missing, it uses the "Signature" (Text, Role, Attributes) to find the best semantic match.

## 2. Interaction Protocol

### Start Task
1. **UI** sends `START_TASK` to **Coordinator**.
2. **Coordinator** initializes `TaskContext` and sets status to "Running".
3. **Coordinator** triggers **Worker** (`startAutoRun`).

### Execution Loop
1. **Worker** requests `GET_STATE` from **Coordinator**.
2. **Worker** requests `simplify` (Element Map) from **DOM Agent**.
3. **Worker** sends Prompt to **Planner (LLM)**.
4. **Planner** returns `Action`.
5. **Worker** sends `EXECUTE` to **DOM Agent**.
   - *Payload includes:* `id`, `signature` (fallback).
6. **DOM Agent** returns `Result`.
7. **Worker** sends `RECORD_ACTION` to **Coordinator**.
8. **Coordinator** saves state to Storage.

### Failure & Retry
1. **Tool Failure (Element Not Found):**
   - **DOM Agent** reports failure.
   - **Worker** triggers `simplify` (Refresh Map).
   - **Worker** retries `EXECUTE` with the *same action* (using Signature).
   - If 2nd failure: **Worker** reports error to **Coordinator** and requests a **Re-plan** (new LLM call).

2. **System Crash / Restart:**
   - **Coordinator** (`background.js`) wakes up.
   - Loads state from `chrome.storage.local`.
   - If task was "Running", it can resume (future capability) or show "Paused" state to user.

## 3. APIs

### Message Passing (Runtime Messages)
- `GET_STATE`: Returns full browser state.
- `UPDATE_TASK_CONTEXT`: Updates subtasks, errors, or data.
- `RECORD_ACTION`: Logs a completed action.
- `TASK_ADD_RELEVANT_TAB`: Tracks tabs used in the task.

### Storage API
- Key: `heybro_state`
- Value: `{ taskContext: {...}, actionHistory: [...] }`
