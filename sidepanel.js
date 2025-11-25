
import { initSettingsUI, initMenu, startLogStreaming, getEls, setRunning, logToUI, stopStreaming, streamText } from './lib/ui.js';
import { loadSettings, state } from './lib/state.js';
import { startAutoRun } from './lib/agent.js';

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  initSettingsUI();
  initMenu();
  startLogStreaming();

  const els = getEls();

  if (els.sendBtn) {
    els.sendBtn.addEventListener("click", async () => {
      const running = document.body.classList.contains("running");
      if (running) {
        state.autoStop = true;
        stopStreaming();
        streamText("\nStopped in middle.\n");
        logToUI("Stopping...");
        await setRunning(false);
        return;
      }
      await startAutoRun();
    });
  }

  if (els.instruction) {
    els.instruction.addEventListener("keydown", async (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const running = document.body.classList.contains("running");
        if (running) {
          state.autoStop = true;
          stopStreaming();
          streamText("\nStopped in middle.\n");
          logToUI("Stopping...");
          await setRunning(false);
        } else {
          await startAutoRun();
        }
      }
    });
  }
});
