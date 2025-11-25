
import { initSettingsUI, initMenu, startLogStreaming, getEls, setRunning, logToUI } from './lib/ui.js';
import { loadSettings } from './lib/state.js';
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
        // Stop logic is handled via state.autoStop in agent loop
        // But we can force UI update here
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
          logToUI("Stopping...");
          await setRunning(false);
        } else {
          await startAutoRun();
        }
      }
    });
  }
});
