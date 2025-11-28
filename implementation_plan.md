# Implementation Plan - Heybro Architecture Improvements

## Goal Description
Improve the Heybro Chrome extension architecture to handle long-running automations, optimize token usage, and ensure "Zero Point Failure" robustness.

## User Review Required
> [!IMPORTANT]
> **Breaking Change Potential:** The "SmartLocator" changes might affect how elements are found. We will maintain backward compatibility with ID-based lookups but prioritize signatures when IDs fail.

## Proposed Changes

### Milestone 1: Token & Prompt Optimization

#### [MODIFY] [planner.js](file:///Users/admin/heybro_chrome/lib/planner.js)
- **Optimize `compressElements`:** Reduce the JSON footprint of element lists by using shorter keys and removing redundant attributes.
- **Refine `buildSystemPrompt`:** Shorten the static instructions.
- **History Pruning:** Update `callGemini` to accept a summarized history or implement the summarization logic before calling it.

#### [MODIFY] [agent.js](file:///Users/admin/heybro_chrome/lib/agent.js)
- **History Management:** Implement a sliding window for `buildHistoryForPrompt`. Keep the last 10 actions in full detail, and summarize or drop older ones.

### Milestone 2: Robustness (Zero Point Failure)

#### [MODIFY] [content.js](file:///Users/admin/heybro_chrome/content.js)
- **Enhance `SmartLocator`:** Improve the scoring algorithm to better utilize the "Signature" (text, role, context) when the ID is invalid.
- **Add `rebind` capability:** Allow the agent to re-scan and find the element if the initial lookup fails.

#### [MODIFY] [agent.js](file:///Users/admin/heybro_chrome/lib/agent.js)
- **Retry Logic:** If a tool execution fails with "Element not found", trigger a `simplify` (refresh) and retry the action using the signature *before* asking the Planner again.

### Milestone 3: Long-Running Support

#### [MODIFY] [background.js](file:///Users/admin/heybro_chrome/background.js)
- **State Persistence:** Save `taskContext` and `actionHistory` to `chrome.storage.local` on every update. Load it on startup.

#### [MODIFY] [lib/tools.js](file:///Users/admin/heybro_chrome/lib/tools.js)
- Implement `isIgnoredUrl` to detect GTM and other service domains.
- Update `execute` and `probe` to filter out ignored frames and prioritize the main frame (frameId 0).

#### [MODIFY] [agent.js](file:///Users/admin/heybro_chrome/lib/agent.js)
- Add a safety check in the main loop to detect if the agent is stuck on an ignored URL (like GTM) and provide a clear signal to the planner or auto-recover.

#### [MODIFY] [content.js](file:///Users/admin/heybro_chrome/content.js)
- (Optional) Add logic to `getPageState` to flag if the current context is a known service frame.

#### [MODIFY] [agent.js](file:///Users/admin/heybro_chrome/lib/agent.js)
- **Step Limit:** Change the hard 50-step limit to a soft limit that prompts the user or auto-continues based on settings.

## Verification Plan

### Automated Tests
- We don't have a full test suite, so we will verify manually.

### Manual Verification
1.  **Token Usage:** Check the logs/console to see the size of the prompt being sent to Gemini.
2.  **Robustness:**
    - Go to a dynamic site (e.g., YouTube, Twitter).
    - Start a task.
    - Manually modify the DOM (delete an ID) while the agent is "thinking".
    - Verify the agent still finds the element using the signature.
3.  **Long Run:** Run a task that requires > 50 steps (e.g., "Scroll down 60 times").
