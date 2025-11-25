
import { sanitizeUrl, hostFromUrl } from './utils.js';
import { state } from './state.js';

async function getBrowserState() {
    return await chrome.runtime.sendMessage({ t: "GET_STATE" });
}

async function sendToAgent(tabId, msg) {
    if (!tabId || typeof tabId !== 'number') {
        throw new Error("Invalid tabId provided to sendToAgent");
    }

    try {
        const t = await chrome.tabs.get(tabId);
        if (!t || !(/^(https?|file):/i.test(t.url))) {
            return null;
        }
    } catch { }

    // Try to ensure content script is ready
    try {
        await chrome.tabs.sendMessage(tabId, { t: "ping" });
    } catch {
        try {
            await chrome.scripting.executeScript({
                target: { tabId, allFrames: true },
                files: ["content.js"]
            });
            await new Promise(res => setTimeout(res, 200));
        } catch { }
    }

    for (let i = 0; i < 3; i++) {
        try {
            return await chrome.tabs.sendMessage(tabId, msg);
        } catch (err) {
            if (err && /No tab with id/i.test(err.message || "")) {
                return null;
            }
        }
        await new Promise(res => setTimeout(res, 200));
    }
    return null;
}

async function getAllFrames(tabId) {
    try {
        return await chrome.webNavigation.getAllFrames({ tabId });
    } catch {
        return [];
    }
}

async function sendToAgentFrame(tabId, frameId, msg) {
    if (!tabId || typeof tabId !== 'number') return null;
    try {
        return await chrome.tabs.sendMessage(tabId, msg, { frameId });
    } catch {
        return null;
    }
}

async function execute(tabId, payload) {
    const frames = await getAllFrames(tabId);
    if (!frames || !frames.length) {
        return await sendToAgent(tabId, { t: "execute", payload });
    }
    for (const f of frames) {
        const r = await sendToAgentFrame(tabId, f.frameId, { t: "execute", payload });
        if (r && r.ok) return r;
    }
    return await sendToAgent(tabId, { t: "execute", payload });
}

async function probe(tabId, payload) {
    const frames = await getAllFrames(tabId);
    if (!frames || !frames.length) {
        const r = await sendToAgent(tabId, { t: "probe", payload });
        return r && r.ok;
    }
    for (const f of frames) {
        const r = await sendToAgentFrame(tabId, f.frameId, { t: "probe", payload });
        if (r && r.ok) return true;
    }
    const rr = await sendToAgent(tabId, { t: "probe", payload });
    return rr && rr.ok;
}

async function _retry(tabId, payload, tries = 3, delayMs = 400) {
    let wait = delayMs;
    for (let i = 0; i < tries; i++) {
        const probeOk = await probe(tabId, payload);
        if (probeOk) {
            const r = await execute(tabId, payload);
            if (r && r.ok) return r;
        }
        if (payload.action === "click") {
            await execute(tabId, { action: "scroll", amount: 600 });
        }
        const jitter = Math.floor(Math.random() * 120);
        await new Promise(res => setTimeout(res, wait + jitter));
        wait = Math.min(2000, wait * 2);
    }
    return await execute(tabId, payload);
}

async function waitReady(tabId, timeoutMs = 4000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const r = await sendToAgent(tabId, { t: "getPageState" });
            const rs = r && r.state && r.state.readyState;
            if (rs === "interactive" || rs === "complete") return true;
        } catch { }
        await new Promise(res => setTimeout(res, 200));
    }
    return false;
}

async function ensureActiveAndFocused(tabId) {
    if (!tabId) return;
    try {
        await chrome.tabs.update(tabId, { active: true });
        const t = await chrome.tabs.get(tabId);
        if (t && t.windowId) {
            await chrome.windows.update(t.windowId, { focused: true });
        }
    } catch { }
}

const SEARCH_ENGINES = {
    google: payload => {
        const q = String(payload.query || "").trim();
        const encodedQuery = encodeURIComponent(q);
        let url = `https://www.google.com/search?q=${encodedQuery}`;
        return url;
    },
    bing: payload => {
        const q = String(payload.query || "").trim();
        const encodedQuery = encodeURIComponent(q);
        return `https://www.bing.com/search?q=${encodedQuery}`;
    },
    duckduckgo: payload => {
        const q = String(payload.query || "").trim();
        const encodedQuery = encodeURIComponent(q);
        return `https://duckduckgo.com/?q=${encodedQuery}`;
    }
};

export const TOOL_HANDLERS = {
    search: async (tabId, args) => {
        const payload = {
            query: args.query,
            engine: args.engine || "google",
            newTab: args.newTab !== false,
            active: args.active !== false
        };
        if (!payload.query || typeof payload.query !== "string") {
            return { ok: false, error: "Search query is required" };
        }
        const q = payload.query.trim();
        if (!q) {
            return { ok: false, error: "Search query cannot be empty" };
        }
        const builder = SEARCH_ENGINES[(payload.engine || "").toLowerCase()] || SEARCH_ENGINES.google;
        const searchUrl = builder(payload);
        if (payload.newTab || !tabId) {
            const r = await execTool(null, { tool: "new_tab", args: { url: searchUrl, active: payload.active, title: `Search: ${q}` } });
            return { ok: r.ok, newTabId: r && r.newTabId, searchUrl, engine: payload.engine, query: q };
        }
        const nr = await execTool(tabId, { tool: "navigate", args: { url: searchUrl } });
        return { ok: nr.ok, searchUrl, engine: payload.engine, query: q };
    },
    switch_tab: async (tabId, args) => {
        const id = args.id;
        if (id) {
            const r = await chrome.runtime.sendMessage({ t: "SWITCH_TAB", tabId: id });
            return { ok: true, activeTabId: r && r.activeTabId };
        }
        return { ok: false };
    },
    tap: async (tabId, args) => {
        if (args && args.element && typeof args.element === "object" && !args.signature) {
            const el = args.element;
            if (el.i !== undefined && args.id === undefined) args.id = el.i;
            if (!args.text && el.x) args.text = String(el.x).replace(/\s+/g, " ").trim();
            if (!args.href) {
                args.href = el.h || el.href || (String(el.x || "").match(/https?:\/\/[^\s]+/) || [])[0];
            }
            args.signature = { tag: el.t || undefined, role: el.r || undefined, text: el.x ? String(el.x).replace(/\s+/g, " ").trim() : undefined, label: el.l ? String(el.l).replace(/\s+/g, " ").trim() : undefined, href: el.h || undefined, placeholder: el.p || undefined, testid: el.testid || el.qa || undefined };
            delete args.element;
        }
        const payload = { action: "click", id: args.id, selector: args.selector, text: args.target || args.text, exact: args.exact, partial: args.partial, index: args.index, xpath: args.xpath, href: args.href, sig: args.signature, clickable: true, visible: true, viewportOnly: true };

        async function verifyAfterTap() {
            if (!args || !args.verifyAfter) return true;
            const v = args.verifyAfter;
            if (v.urlIncludes) {
                const u = String(v.urlIncludes).toLowerCase();
                for (let i = 0; i < 10; i++) {
                    const ps = await sendToAgent(tabId, { t: "getPageState" });
                    const cu = (ps && ps.state && ps.state.url ? String(ps.state.url).toLowerCase() : "");
                    if (cu.includes(u)) return true;
                    await new Promise(res => setTimeout(res, 300));
                }
                return false;
            }
            if (v.element) {
                const p = { ...v.element, visible: true, clickable: true, domStableMs: v.domStableMs || 500 };
                const ok = await probe(tabId, p);
                return !!ok;
            }
            return true;
        }

        const bsBefore = await getBrowserState().catch(() => null);
        for (let attempt = 0; attempt < 4; attempt++) {
            try {
                await ensureActiveAndFocused(tabId);
                if (await probe(tabId, payload)) {
                    const result = await execute(tabId, payload);
                    if (result && result.ok) {
                        const verified = await verifyAfterTap();
                        if (verified) return result;
                    }
                }
                if (attempt === 0) {
                    await execute(tabId, { action: "scroll", id: args.id, selector: args.selector, text: args.target || args.text, to: "element" });
                    await new Promise(res => setTimeout(res, 300));
                } else if (attempt === 1) {
                    payload.offsetX = Math.floor(Math.random() * 10) - 5;
                    payload.offsetY = Math.floor(Math.random() * 10) - 5;
                } else if (attempt === 2) {
                    payload.force = true;
                }
                await new Promise(res => setTimeout(res, attempt * 200 + 300));
            } catch (e) {
                if (attempt === 3) throw e;
            }
        }

        // Check for new tab creation
        try {
            const bsAfter = await getBrowserState();
            const beforeIds = new Set(((bsBefore && bsBefore.tabs) ? bsBefore.tabs.map(t => t.id) : []));
            const afterTabs = (bsAfter && bsAfter.tabs) ? bsAfter.tabs : [];
            let newTabId = null;
            for (const t of afterTabs) {
                if (!beforeIds.has(t.id)) {
                    newTabId = t.id;
                    break;
                }
            }
            if (!newTabId && bsBefore && bsAfter && bsBefore.activeTabId !== bsAfter.activeTabId) {
                newTabId = bsAfter.activeTabId;
            }
            if (newTabId) {
                const href = args.href || (args.signature && args.signature.href) || "";
                if (href) state.openedHrefs.add(String(href).trim());
                await ensureActiveAndFocused(newTabId);
                return { ok: true, newTabId, action: "tap_new_tab" };
            }
        } catch { }

        return await execute(tabId, payload);
    },
    type: async (tabId, args) => {
        const payload = { action: "type", id: args.id, selector: args.selector, text: args.target || args.field || args.label, value: args.value || args.text, append: args.append, mode: args.mode || "set", clearFirst: args.clear !== false, simulate: args.simulate !== false, xpath: args.xpath };
        if (!payload.value && payload.value !== "") {
            return { ok: false, error: "No text value provided for typing" };
        }
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                if (await probe(tabId, { action: "type", ...payload, probeOnly: true })) {
                    const result = await execute(tabId, payload);
                    if (result && result.ok) return result;
                }
                if (attempt === 0) {
                    await execute(tabId, { action: "focus", id: args.id, selector: args.selector, text: args.target || args.field || args.label });
                    await new Promise(res => setTimeout(res, 200));
                } else if (attempt === 1) {
                    payload.slow = true;
                    payload.delay = 50;
                }
                await new Promise(res => setTimeout(res, attempt * 300 + 200));
            } catch (e) {
                if (attempt === 2) throw e;
            }
        }
        return await execute(tabId, payload);
    },
    navigate: async (tabId, args) => {
        const payload = { action: "navigate", url: args.url, id: args.id, selector: args.selector, text: args.text, xpath: args.xpath, method: args.method || "auto", target: args.target || "_self", waitForLoad: args.waitForLoad !== false, timeout: args.timeout || 10000, back: args.back || false, forward: args.forward || false, reload: args.reload || false };

        async function verifyAfterNavigate() {
            if (!args || !args.verifyAfter) return true;
            const v = args.verifyAfter;
            if (v.urlIncludes) {
                const uinc = String(v.urlIncludes).toLowerCase();
                for (let i = 0; i < 12; i++) {
                    const ps = await sendToAgent(tabId, { t: "getPageState" });
                    const cu = (ps && ps.state && ps.state.url ? String(ps.state.url).toLowerCase() : "");
                    if (cu.includes(uinc)) return true;
                    await new Promise(res => setTimeout(res, 300));
                }
                return false;
            }
            if (v.condition && v.condition.ready) {
                const ok = await waitReady(tabId, args.timeout || 10000);
                return !!ok;
            }
            if (v.element) {
                const p = { ...v.element, visible: true, clickable: !!v.clickable, domStableMs: v.domStableMs || 500 };
                const ok = await probe(tabId, p);
                return !!ok;
            }
            return true;
        }

        if (payload.reload) {
            await chrome.tabs.reload(tabId);
            if (payload.waitForLoad) await waitReady(tabId, payload.timeout);
            return { ok: true, action: "reload" };
        }
        if (payload.back) {
            const result = await execute(tabId, { action: "navigate", method: "history", direction: "back" });
            if (payload.waitForLoad) await waitReady(tabId, payload.timeout);
            return result;
        }
        if (payload.forward) {
            const result = await execute(tabId, { action: "navigate", method: "history", direction: "forward" });
            if (payload.waitForLoad) await waitReady(tabId, payload.timeout);
            return result;
        }
        if (payload.url) {
            let url = sanitizeUrl(payload.url);
            if (!url) return { ok: false, error: "Invalid or empty URL provided" };
            if (!url.match(/^[a-zA-Z][a-zA-Z0-9]*:/)) url = "https://" + url;
            try {
                new URL(url);
                if (payload.target === "_blank") {
                    const newTabResult = await execTool(null, { tool: "new_tab", args: { url } });
                    const verified = await verifyAfterNavigate();
                    return { ok: newTabResult.ok && verified, newTabId: newTabResult.newTabId, action: "new_tab" };
                } else {
                    await chrome.tabs.update(tabId, { url });
                    if (payload.waitForLoad !== false) {
                        const ready = await waitReady(tabId, payload.timeout || 10000);
                        const verified = await verifyAfterNavigate();
                        return { ok: !!verified, url, ready, action: "navigate" };
                    }
                    const verified = await verifyAfterNavigate();
                    return { ok: !!verified, url, action: "navigate" };
                }
            } catch (error) {
                return { ok: false, error: "Invalid URL format: " + error.message };
            }
        }
        if (payload.id || payload.selector || payload.text) {
            const result = await _retry(tabId, { action: "navigate", id: payload.id, selector: payload.selector, text: payload.text, xpath: payload.xpath, method: "link" });
            if (result && result.ok && payload.waitForLoad) {
                await waitReady(tabId, payload.timeout);
            }
            return result;
        }
        return { ok: false, error: "No URL or target element specified for navigation" };
    },
    scroll: async (tabId, args) => {
        const payload = { action: "scroll", id: args.id, selector: args.selector, text: args.target || args.text, to: args.to, amount: args.amount, direction: args.direction || "down", smooth: args.smooth !== false, behavior: args.behavior || (state.experimentalMode ? "smooth" : "auto"), xpath: args.xpath };
        if (payload.id || payload.selector || payload.text) {
            payload.to = "element";
        } else if (payload.to) {
            const validTos = ["top", "bottom", "middle", "up", "down", "left", "right"];
            if (!validTos.includes(payload.to)) {
                return { ok: false, error: "Invalid scroll target. Use: top, bottom, middle, up, down, left, right, or element" };
            }
        } else if (payload.amount) {
            if (typeof payload.amount !== "number") {
                return { ok: false, error: "Scroll amount must be a number" };
            }
        } else {
            payload.to = "down";
            payload.amount = window.innerHeight * 0.8;
        }
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const result = await execute(tabId, payload);
                if (result && result.ok) {
                    await new Promise(res => setTimeout(res, payload.smooth ? 800 : 200));
                    if (payload.to === "element" && (payload.id || payload.selector || payload.text)) {
                        const verifyResult = await execute(tabId, { action: "scroll", verify: true, id: payload.id, selector: payload.selector, text: payload.text });
                        if (verifyResult && verifyResult.visible) {
                            return result;
                        }
                    } else {
                        return result;
                    }
                }
            } catch (e) {
                if (attempt === 2) throw e;
            }
            await new Promise(res => setTimeout(res, attempt * 200 + 100));
        }
        return await execute(tabId, payload);
    },
    new_tab: async (tabId, args) => {
        const payload = { url: args.url, title: args.title || "", active: args.active !== false, pinned: args.pinned || false, index: args.index, windowId: args.windowId, openerTabId: args.openerTabId || tabId };
        let url = payload.url;
        if (url) {
            url = sanitizeUrl(url);
            if (!url) return { ok: false, error: "Invalid or empty URL provided" };
            if (!url.match(/^[a-zA-Z][a-zA-Z0-9]*:/)) url = "https://" + url;
            try { new URL(url); } catch (error) { return { ok: false, error: "Invalid URL format: " + error.message }; }
        } else {
            url = "about:blank";
        }
        const createOptions = { url: url, active: payload.active, pinned: payload.pinned, openerTabId: payload.openerTabId };
        if (payload.index !== undefined) createOptions.index = payload.index;
        if (payload.windowId) createOptions.windowId = payload.windowId;
        try {
            if (state.newTabsOpened >= 3) return { ok: false, error: "new_tab_limit_reached" };
            const newTab = await chrome.tabs.create(createOptions);
            if (newTab?.id) {
                state.newTabsOpened++;
                if (url && url !== "about:blank") {
                    await new Promise(resolve => setTimeout(resolve, 500));
                    try {
                        await chrome.scripting.executeScript({ target: { tabId: newTab.id, allFrames: true }, files: ["content.js"] });
                    } catch { }
                }
                return { ok: true, newTabId: newTab.id, url: newTab.url, title: newTab.title, active: newTab.active, index: newTab.index };
            } else {
                return { ok: false, error: "Failed to create new tab" };
            }
        } catch (error) {
            return { ok: false, error: "Tab creation failed: " + error.message };
        }
    },
    wait: async (tabId, args) => {
        const payload = { ms: args.ms !== undefined ? args.ms : (args.seconds !== undefined ? Number(args.seconds) * 1000 : (args.timeout !== undefined ? Number(args.timeout) : 1000)), condition: args.condition, timeout: args.timeout || 10000, selector: args.selector, text: args.text, visible: args.visible !== false, clickable: !!args.clickable, attribute: args.attribute, textIncludes: args.textIncludes, domStableMs: args.domStableMs };
        if (payload.condition && typeof payload.condition === "object") {
            const startTime = Date.now();
            while (Date.now() - startTime < payload.timeout) {
                try {
                    const state = await sendToAgent(tabId, { t: "getPageState" });
                    let ok = false;
                    if (payload.condition.ready) {
                        const rs = state && state.state && state.state.readyState;
                        ok = rs === "interactive" || rs === "complete";
                    }
                    if (payload.condition.urlIncludes) {
                        const u = state && state.state && state.state.url;
                        if (u) ok = ok || String(u).includes(payload.condition.urlIncludes);
                    }
                    if (payload.condition.titleIncludes) {
                        const t = state && state.state && state.state.title;
                        if (t) ok = ok || String(t).includes(payload.condition.titleIncludes);
                    }
                    if (ok) return { ok: true, waited: Date.now() - startTime };
                } catch (e) { }
                await new Promise(res => setTimeout(res, 200));
            }
            return { ok: false, error: "Wait condition timeout" };
        }
        if (payload.selector || payload.text) {
            const startTime = Date.now();
            while (Date.now() - startTime < payload.timeout) {
                const found = await probe(tabId, { selector: payload.selector, text: payload.text, visible: payload.visible, clickable: payload.clickable, attribute: payload.attribute, textIncludes: payload.textIncludes, domStableMs: payload.domStableMs });
                if (found) {
                    return { ok: true, waited: Date.now() - startTime };
                }
                await new Promise(res => setTimeout(res, 200));
            }
            return { ok: false, error: "Element wait timeout" };
        }
        await new Promise(res => setTimeout(res, payload.ms));
        return { ok: true, waited: payload.ms };
    },
    done: async () => {
        return { ok: true };
    }
};

export function normalizeCall(call) {
    if (!call) return { tool: undefined, args: {} };

    if (call.tool || call.action) {
        const base = call.tool || call.action;
        const raw = call.args !== undefined ? call.args : (call.params !== undefined ? call.params : undefined);
        let args = {};
        if (Array.isArray(raw)) {
            const v = raw[0];
            if (typeof v === "number") args.id = v;
            else if (typeof v === "string") args.text = v;
            else if (v && typeof v === "object") args = v;
        } else if (typeof raw === "string") {
            args = { text: raw };
        } else if (raw && typeof raw === "object") {
            args = raw;
        }
        // Normalize element payload when provided under args for specific tools
        if (base === "tap" && args && typeof args === "object" && args.element && typeof args.element === "object") {
            const el = args.element;
            if (el.i !== undefined && args.id === undefined) args.id = el.i;
            if (!args.text && el.x) args.text = String(el.x).replace(/\s+/g, " ").trim();
            if (!args.href) {
                args.href = el.h || el.href || (String(el.x || "").match(/https?:\/\/[^\s]+/) || [])[0];
            }
            const sig = {
                tag: el.t || undefined,
                role: el.r || undefined,
                text: el.x ? String(el.x).replace(/\s+/g, " ").trim() : undefined,
                label: el.l ? String(el.l).replace(/\s+/g, " ").trim() : undefined,
                href: el.h || undefined,
                placeholder: el.p || undefined,
                testid: el.testid || el.qa || undefined
            };
            args.signature = sig;
            delete args.element;
        }
        return { tool: base, args };
    }

    const keys = Object.keys(call);
    const known = ["tap", "type", "press", "select", "submit", "check", "scroll", "navigate", "new_tab", "search", "done", "focus", "copy", "paste", "wait"];

    for (const k of known) {
        if (call[k] !== undefined) {
            const v = call[k];
            if (k === "tap") {
                if (typeof v === "number") return { tool: "tap", args: { id: v } };
                if (typeof v === "string") return { tool: "tap", args: { text: v } };
                if (Array.isArray(v)) {
                    const first = v[0];
                    if (typeof first === "string") return { tool: "tap", args: { text: first } };
                    if (typeof first === "number") return { tool: "tap", args: { id: first } };
                }
                if (v && typeof v === "object") {
                    const normalized = { ...v };
                    if (normalized.selector && typeof normalized.selector === "object") {
                        if (normalized.selector.i !== undefined) {
                            normalized.id = normalized.selector.i;
                            delete normalized.selector;
                        }
                    }
                    if (normalized.element && typeof normalized.element === "object") {
                        const el = normalized.element;
                        if (el.i !== undefined) normalized.id = el.i;
                        if (!normalized.text && el.x) normalized.text = String(el.x).replace(/\s+/g, " ").trim();
                        const m = String(el.x || "").match(/https?:\/\/[^\s]+/);
                        if (m && !normalized.href) normalized.href = m[0];
                        const sig = {
                            tag: el.t || undefined,
                            role: el.r || undefined,
                            text: el.x ? String(el.x).replace(/\s+/g, " ").trim() : undefined,
                            label: el.l ? String(el.l).replace(/\s+/g, " ").trim() : undefined,
                            href: el.h || undefined,
                            placeholder: el.p || undefined,
                            testid: el.testid || el.qa || undefined
                        };
                        normalized.signature = sig;
                        delete normalized.element;
                    }
                    return { tool: "tap", args: normalized };
                }
            }
            // ... (rest of normalization logic similar to original)
            if (k === "type") {
                const value = call.text !== undefined ? call.text : (call.value !== undefined ? call.value : undefined);
                if (typeof v === "string") return { tool: "type", args: { target: v, text: value } };
                if (typeof v === "number") return { tool: "type", args: { id: v, text: value } };
                if (v && typeof v === "object") return { tool: "type", args: { ...v, text: value } };
                return { tool: "type", args: { text: value } };
            }
            if (k === "navigate") {
                if (typeof v === "string") return { tool: "navigate", args: { url: v } };
                if (v && typeof v === "object") return { tool: "navigate", args: v };
                return { tool: "navigate", args: {} };
            }
            if (k === "search") {
                const q = typeof v === "string" ? v : (call.query || "");
                return { tool: "search", args: { query: q } };
            }
            if (k === "done") return { tool: "done", args: {} };
        }
    }

    if (keys.length === 1) {
        const k = keys[0];
        const v = call[k];
        if (typeof v === "string") {
            if (k === "tap") return { tool: "tap", args: { text: v } };
            if (k === "type") return { tool: "type", args: { text: v } };
            if (k === "search") return { tool: "search", args: { query: v } };
            if (k === "new_tab") return { tool: "new_tab", args: { url: v } };
            if (k === "navigate") return { tool: "navigate", args: { url: v } };
        }
        if (typeof v === "object") return { tool: k, args: v };
    }

    return { tool: undefined, args: {} };
}

export async function execTool(tabId, call) {
    const nc = normalizeCall(call);
    const t = nc.tool;
    const args = nc.args || {};
    if (tabId) {
        await waitReady(tabId);
    }
    const handler = TOOL_HANDLERS[t];
    if (!handler) {
        return { ok: false, error: `Unknown tool: ${t}` };
    }
    return await handler(tabId, args);
}

export { sendToAgent, getBrowserState, ensureActiveAndFocused, waitReady };
