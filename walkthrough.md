# Walkthrough - Fixes for Plan State Updates

I have addressed the issue where the plan state was not updating correctly because the LLM lacked explicit references to the subtasks.

## 1. Explicit Subtask Indices
**Problem**: The LLM was provided with a list of subtasks (e.g., `- Navigate...`, `- Search...`) but was asked to return an `index` for updates. Without explicit numbering, the LLM often guessed the index or failed to provide one, leading to missed updates.
**Fix**:
- Modified `lib/planner.js` to format the `SUBTASKS` list with explicit indices (e.g., `0. Navigate...`, `1. Search...`).
- Updated the system prompt to explicitly instruct the LLM to use these exact index numbers when reporting `subtask_updates`.

## 2. Dynamic Plan Reconciliation (Recap)
**Context**: This builds upon the previous fix where I implemented state-based reconciliation.
- The agent now sends the current page state to the LLM.
- The LLM analyzes the state and returns `subtask_updates` with specific indices (e.g., `index: 1, status: "completed"`).
- The agent applies these updates to its internal plan and persists the state.

## Verification
- **Scenario**: User asks to "play jhol song".
- **Flow**:
    1. Agent navigates to YouTube.
    2. LLM sees "YouTube" title.
    3. LLM sees `0. Navigate to YouTube [pending]` in the prompt.
    4. LLM returns `subtask_updates: [{ index: 0, status: "completed" }]`.
    5. Agent updates plan index 0 to "completed".
    6. Agent persists the new plan state.
- **Outcome**: The plan UI correctly reflects the progress, and the agent moves to the next step without confusion.
