/**
 * HEYBRO CONTENT SCRIPT - ROCK SOLID ARCHITECTURE
 * 
 * Modules:
 * 1. State & Logging
 * 2. VisualCheck: Visibility & Overlay detection
 * 3. SmartLocator: Dynamic element discovery
 * 4. InteractionEngine: Framework-compatible events
 * 5. Execution: Main dispatcher
 */

// --- 1. State & Logging ---

var state = window.__heybro_state || {};
state.nextId = state.nextId || 1;
state.map = state.map || new Map();
state.sigMap = state.sigMap || new Map();
state.sigIndex = state.sigIndex || new Map();
state.badges = state.badges || [];
state.badgeMap = state.badgeMap || new Map();
state.annotating = state.annotating !== undefined ? state.annotating : false;
state.experimental = state.experimental !== undefined ? state.experimental : false;

window.__heybro_state = state;

if (!window.__heybro_logger_init) {
    window.__heybro_logger_init = true;
    const log = (t, d) => { try { chrome.runtime.sendMessage({ t: "EVENT_LOG", event: t, detail: d, url: location.href }); } catch { } };

    // Passive event listeners for activity tracking
    ['click', 'input', 'change', 'scroll'].forEach(evt => {
        document.addEventListener(evt, (e) => {
            if (!e.isTrusted) return; // Ignore synthetic events for logging
            if (evt === 'scroll') { log('scroll', { y: window.scrollY }); return; }
            const el = e.target;
            log(evt, {
                tag: el.tagName?.toLowerCase(),
                id: el.id,
                text: (el.innerText || el.value || "").slice(0, 50)
            });
        }, { capture: true, passive: true });
    });

    // Active interaction tracking for verification
    window.__hb_last_interaction = null;
    ['click', 'input', 'change', 'scroll'].forEach(evt => {
        document.addEventListener(evt, (e) => {
            if (!e.isTrusted) return;
            const el = e.target;
            window.__hb_last_interaction = {
                type: evt,
                ts: Date.now(),
                target: {
                    tag: el.tagName?.toLowerCase(),
                    id: el.id,
                    text: (el.innerText || el.value || "").slice(0, 50),
                    path: getDomPath(el)
                }
            };
        }, { capture: true, passive: true });
    });

    function getDomPath(el) {
        if (!el) return '';
        const stack = [];
        while (el.parentNode != null) {
            let sibCount = 0;
            let sibIndex = 0;
            for (let i = 0; i < el.parentNode.childNodes.length; i++) {
                const sib = el.parentNode.childNodes[i];
                if (sib.nodeName == el.nodeName) {
                    if (sib === el) sibIndex = sibCount;
                    sibCount++;
                }
            }
            if (el.hasAttribute('id') && el.id != '') {
                stack.unshift(el.nodeName.toLowerCase() + '#' + el.id);
            } else if (sibCount > 1) {
                stack.unshift(el.nodeName.toLowerCase() + ':eq(' + sibIndex + ')');
            } else {
                stack.unshift(el.nodeName.toLowerCase());
            }
            el = el.parentNode;
        }
        return stack.slice(1).join(' > '); // slice(1) to remove document
    }

    // Mutation Observer for State Detection
    window.__hb_mutation_count = 0;
    window.__hb_last_mutation_ts = Date.now();

    if (!window.__hb_observer) {
        window.__hb_observer = new MutationObserver((mutations) => {
            window.__hb_mutation_count += mutations.length;
            window.__hb_last_mutation_ts = Date.now();
        });
        window.__hb_observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true,
            attributeFilter: ['class', 'style', 'disabled', 'value', 'aria-label', 'role'] // Filter to relevant attributes
        });
    }
}

// --- 2. VisualCheck ---

const VisualCheck = {
    isVisible(el) {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    },

    isInViewport(el) {
        if (!this.isVisible(el)) return false;
        const rect = el.getBoundingClientRect();
        return (
            rect.top < window.innerHeight &&
            rect.bottom > 0 &&
            rect.left < window.innerWidth &&
            rect.right > 0
        );
    },

    isObscured(el) {
        if (!this.isVisible(el)) return true;
        const rect = el.getBoundingClientRect();

        // Helper to check a point
        const checkPoint = (x, y) => {
            if (x < 0 || x > window.innerWidth || y < 0 || y > window.innerHeight) return false;
            const topEl = document.elementFromPoint(x, y);
            if (!topEl) return false;
            if (topEl === el || el.contains(topEl) || topEl.contains(el)) return false;
            const style = window.getComputedStyle(topEl);
            if (style.pointerEvents === 'none') return false;
            return true; // Obscured
        };

        // Check center
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        if (!checkPoint(cx, cy)) return false;

        // Check corners if center is obscured
        if (!checkPoint(rect.left + 2, rect.top + 2)) return false;
        if (!checkPoint(rect.right - 2, rect.bottom - 2)) return false;

        return true;
    }
};

// --- 3. SmartLocator ---

const SmartLocator = {
    clean(str) {
        return String(str || "").toLowerCase().replace(/\s+/g, " ").trim();
    },

    score(el, criteria) {
        if (!VisualCheck.isVisible(el)) return -1;

        let score = 0;
        const text = this.clean(el.innerText || el.textContent);
        const value = this.clean(el.value);
        const label = this.clean(el.getAttribute('aria-label') || el.getAttribute('name') || "");
        const placeholder = this.clean(el.getAttribute('placeholder'));
        const id = this.clean(el.id);
        const testId = this.clean(el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-qa'));
        const href = this.clean(el.href || el.getAttribute('href'));
        const role = this.clean(el.getAttribute('role'));
        const tag = el.tagName.toLowerCase();
        const className = this.clean(el.className);

        // 1. Exact ID/TestID match (High confidence)
        if (criteria.id && (id === criteria.id || testId === criteria.id)) score += 100;

        // 2. Text/Label Match
        if (criteria.text) {
            const target = this.clean(criteria.text);
            if (text === target || value === target) score += 50;
            else if (text.includes(target) || value.includes(target)) score += 20;

            if (label === target) score += 40;
            else if (label.includes(target)) score += 15;

            if (placeholder === target) score += 30;
        }

        // 3. Attributes
        if (criteria.href && href.includes(this.clean(criteria.href))) score += 30;
        if (criteria.role && role === criteria.role) score += 10;
        if (criteria.tag && tag === criteria.tag) score += 5;

        // 4. Class Name Heuristics (e.g. "btn", "button")
        if (className.includes("btn") || className.includes("button")) score += 5;

        // 5. Viewport Bonus
        if (VisualCheck.isInViewport(el)) score += 5;

        return score;
    },

    find(payload) {
        // Strategy 1: Internal Map ID Lookup (Fastest & Most Reliable)
        if (payload.id) {
            // Check internal map first - this is the ID we assigned
            const mapped = state.map.get(parseInt(payload.id));
            if (mapped && VisualCheck.isVisible(mapped)) return mapped;
        }

        // Strategy 2: Direct Selector
        if (payload.selector) {
            try {
                const el = document.querySelector(payload.selector);
                if (el && VisualCheck.isVisible(el)) return el;
            } catch { }
        }

        // Strategy 3: DOM ID Lookup
        if (payload.id) {
            const el = document.getElementById(payload.id);
            if (el && VisualCheck.isVisible(el)) return el;
        }

        // Strategy 4: Scoring Scan (Robust Fallback)
        // Expanded candidates to include potential interactive divs/spans
        const candidates = document.querySelectorAll('a, button, input, textarea, select, [role], [onclick], [tabindex], div[class*="btn"], span[class*="btn"], div[class*="button"], span[class*="button"]');
        let bestEl = null;
        let bestScore = 0;

        // Normalize payload for scoring
        const criteria = {
            id: payload.id ? this.clean(payload.id) : null,
            text: payload.text ? this.clean(payload.text) : null,
            href: payload.href ? this.clean(payload.href) : null,
            role: payload.role ? this.clean(payload.role) : null,
            tag: payload.tag ? this.clean(payload.tag) : null
        };

        // If we have a signature from a previous map, merge it
        if (payload.sig) {
            if (!criteria.text) criteria.text = this.clean(payload.sig.text);
            if (!criteria.tag) criteria.tag = this.clean(payload.sig.tag);
            if (!criteria.role) criteria.role = this.clean(payload.sig.role);
        }

        for (const el of candidates) {
            const s = this.score(el, criteria);
            if (s > bestScore) {
                bestScore = s;
                bestEl = el;
            }
        }

        // Lower threshold slightly to be more forgiving
        if (bestScore > 5) return bestEl;

        // Strategy 5: XPath Fallback
        if (payload.xpath) {
            try {
                const res = document.evaluate(payload.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                if (res.singleNodeValue && VisualCheck.isVisible(res.singleNodeValue)) return res.singleNodeValue;
            } catch { }
        }

        // Log failure for debugging
        if (payload.id || payload.text || payload.selector) {
            // console.warn("SmartLocator failed to find element:", payload, "Best Score:", bestScore);
        }

        return null;
    }
};

// --- 4. InteractionEngine ---

const InteractionEngine = {
    async scrollIntoView(el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        await new Promise(r => setTimeout(r, 500)); // Wait for scroll
    },

    async click(el, force = false) {
        await this.scrollIntoView(el);

        if (!force && VisualCheck.isObscured(el)) {
            // console.warn("Element appears obscured, forcing native click");
            force = true;
        }

        // Analyze the element to predict behavior
        const linkInfo = this.analyzeLinkBehavior(el);

        // Store link info for the tap function to use
        if (linkInfo.willOpenNewTab) {
            window.__hb_expecting_new_tab = {
                href: linkInfo.href,
                timestamp: Date.now(),
                elementInfo: {
                    tag: el.tagName,
                    id: el.id,
                    text: (el.textContent || '').slice(0, 50)
                }
            };

            // Clear after 3 seconds
            setTimeout(() => {
                delete window.__hb_expecting_new_tab;
            }, 3000);
        }

        const rect = el.getBoundingClientRect();
        const opts = {
            bubbles: true, cancelable: true, view: window,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            buttons: 1
        };

        // Full event sequence for modern frameworks
        el.dispatchEvent(new PointerEvent('pointerover', opts));
        el.dispatchEvent(new MouseEvent('mouseover', opts));
        el.dispatchEvent(new PointerEvent('pointerenter', opts));
        el.dispatchEvent(new MouseEvent('mouseenter', opts));
        el.dispatchEvent(new PointerEvent('pointerdown', opts));
        el.dispatchEvent(new MouseEvent('mousedown', opts));

        el.focus();

        el.dispatchEvent(new PointerEvent('pointerup', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.dispatchEvent(new MouseEvent('click', opts));

        // Final fallback for super stubborn elements
        if (force) {
            try { el.click(); } catch { }
        }

        return true;
    },

    analyzeLinkBehavior(el) {
        // Analyze element to predict if it will open a new tab
        const info = {
            href: null,
            willOpenNewTab: false,
            hasTarget: false,
            targetValue: null,
            hasOnClick: false
        };

        // Check if it's a link or has a click handler
        const isLink = el.tagName?.toLowerCase() === 'a';
        const href = el.href || el.getAttribute('href');
        const target = el.target || el.getAttribute('target');
        const hasOnClick = el.onclick || el.getAttribute('onclick');

        info.href = href;
        info.hasTarget = !!target;
        info.targetValue = target;
        info.hasOnClick = !!hasOnClick;

        // Predict new tab opening
        if (isLink && target && (target === '_blank' || target === '_new')) {
            info.willOpenNewTab = true;
        }

        // Check parent elements for target
        let parent = el.parentElement;
        while (parent && !info.willOpenNewTab) {
            const parentTarget = parent.target || parent.getAttribute('target');
            if (parent.tagName?.toLowerCase() === 'a' && parentTarget && (parentTarget === '_blank' || parentTarget === '_new')) {
                info.willOpenNewTab = true;
                if (!info.href) {
                    info.href = parent.href || parent.getAttribute('href');
                }
            }
            parent = parent.parentElement;
        }

        return info;
    },

    async type(el, value, append = false) {
        await this.scrollIntoView(el);
        el.focus();

        const isContentEditable = el.isContentEditable || el.contentEditable === 'true';

        if (isContentEditable) {
            // Handle contenteditable divs (like Gmail compose)
            const newValue = append ? (el.textContent || el.innerText || '') + value : value;

            // Clear existing content if not appending
            if (!append) {
                el.textContent = '';
            }

            // Insert text at cursor position or append
            const selection = window.getSelection();
            const range = document.createRange();

            if (el.childNodes.length > 0) {
                range.selectNodeContents(el);
                range.collapse(false); // Move to end
            } else {
                range.setStart(el, 0);
                range.collapse(true);
            }

            selection.removeAllRanges();
            selection.addRange(range);

            // Insert text
            document.execCommand('insertText', false, value);

            // Dispatch events for frameworks
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));

            return (el.textContent || el.innerText || '').length;
        } else {
            // Handle standard input/textarea elements
            const tagName = el.tagName?.toLowerCase();
            let setter;

            try {
                if (tagName === 'textarea') {
                    setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
                } else if (tagName === 'input') {
                    setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                }
            } catch (e) {
                // Descriptor access failed, fall back to direct assignment
                setter = null;
            }

            const newValue = append ? (el.value || '') + value : value;

            if (setter) {
                setter.call(el, newValue);
            } else {
                el.value = newValue;
            }

            // Dispatch events
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));

            // Simulate keypresses
            el.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
            el.dispatchEvent(new KeyboardEvent('keyup', { key: 'End', bubbles: true }));

            return newValue.length;
        }
    }
};

// --- 5. Execution ---

async function execute(payload) {
    const action = payload.action;

    // Global Actions
    if (action === 'new_tab') {
        if (payload.url) try { chrome.runtime.sendMessage({ action: "OPEN_NEW_TAB", url: payload.url }); } catch { }
        return { ok: true };
    }

    if (action === 'scroll') {
        if (payload.to === 'top') window.scrollTo({ top: 0, behavior: 'smooth' });
        else if (payload.to === 'bottom') window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        else if (payload.amount) window.scrollBy({ top: payload.amount, behavior: 'smooth' });
        else {
            // Scroll to element
            const target = SmartLocator.find(payload);
            if (target) await InteractionEngine.scrollIntoView(target);
            else window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
        }
        await new Promise(r => setTimeout(r, 300));
        return { ok: true };
    }

    // Element Actions
    const el = SmartLocator.find(payload);

    if (!el) {
        return { ok: false, error: "Element not found" };
    }

    if (action === 'click' || action === 'tap') {
        await InteractionEngine.click(el, payload.force);
        return { ok: true, clicked: true };
    }

    if (action === 'type') {
        const len = await InteractionEngine.type(el, payload.value || payload.text, payload.append);
        return { ok: true, typed: len };
    }

    if (action === 'press') {
        const key = payload.key;
        const modifiers = payload.modifiers || [];

        if (!key) {
            return { ok: false, error: "No key specified" };
        }

        try {
            const mods = {
                ctrlKey: modifiers.some(m => String(m).toLowerCase().includes("ctrl")),
                shiftKey: modifiers.some(m => String(m).toLowerCase().includes("shift")),
                altKey: modifiers.some(m => String(m).toLowerCase().includes("alt")),
                metaKey: modifiers.some(m => String(m).toLowerCase().includes("meta"))
            };

            const code = key === "Enter" ? "Enter" : key;
            const keyEventInit = { key, code, bubbles: true, cancelable: true, ...mods, view: window };

            // Helper to dispatch with legacy properties
            const dispatchKey = (type) => {
                const e = new KeyboardEvent(type, keyEventInit);
                // Try to define legacy properties if possible
                try { Object.defineProperty(e, 'keyCode', { get: () => key === "Enter" ? 13 : 0 }); } catch { }
                try { Object.defineProperty(e, 'which', { get: () => key === "Enter" ? 13 : 0 }); } catch { }
                el.dispatchEvent(e);
            };

            dispatchKey("keydown");
            dispatchKey("keypress");
            dispatchKey("keyup");

            let submitted = false;
            if (String(key).toLowerCase() === "enter") {
                const form = (el && (el.form || (el.closest && el.closest("form")))) || document.querySelector("form");
                if (form) {
                    if (typeof form.requestSubmit === "function") {
                        form.requestSubmit();
                    } else {
                        const btn = form.querySelector("button[type='submit'], input[type='submit']");
                        if (btn) {
                            btn.click();
                        } else {
                            form.submit();
                        }
                    }
                    submitted = true;
                } else {
                    const btn = document.querySelector("button[type='submit'], input[type='submit']");
                    if (btn) {
                        btn.click();
                        submitted = true;
                    }
                }
            }

            try { window.__hb_last_key = key; } catch { }
            return { ok: true, key, modifiers, submitted };
        } catch (error) {
            return { ok: false, error: error.message };
        }
    }

    return { ok: false, error: `Unknown action: ${action}` };
}

// --- 6. PageScanner ---

const PageScanner = {
    walk(root, out) {
        const stack = [root];
        const seen = new Set();
        while (stack.length) {
            const node = stack.pop();
            if (!node || seen.has(node)) continue;
            seen.add(node);
            if (node.nodeType === 1) {
                const el = node;
                const tag = el.tagName.toLowerCase();
                if (VisualCheck.isVisible(el)) {
                    // Check if interactive
                    const role = el.getAttribute('role');
                    const hasClick = el.hasAttribute('onclick') || el.getAttribute('tabindex') === '0';
                    const hasHref = el.hasAttribute('href'); // Links with href are always interactive
                    const isInput = ['a', 'button', 'input', 'textarea', 'select', 'details', 'summary'].includes(tag);
                    const isRole = ['button', 'link', 'menuitem', 'tab', 'checkbox', 'radio', 'switch', 'combobox', 'textbox'].includes(role);

                    // Refined cursor check: only if leaf node or has specific attributes
                    const style = getComputedStyle(el);
                    const isPointer = style.cursor === 'pointer';
                    const isLeaf = el.children.length === 0 && String(el.innerText || "").trim().length > 0;

                    // Exclude generic containers unless they have explicit interactive traits
                    const isGeneric = tag === 'div' || tag === 'span' || tag === 'section' || tag === 'body' || tag === 'html';

                    const isInteractive =
                        isInput ||
                        isRole ||
                        hasClick ||
                        hasHref || // Any element with href should be tagged
                        (isPointer && (isLeaf || !isGeneric));

                    if (isInteractive) out.push(el);
                }

                const sr = el.shadowRoot;
                if (sr) stack.push(sr);
                if (tag === 'iframe') {
                    try {
                        const doc = el.contentDocument || el.contentWindow?.document;
                        if (doc && doc.documentElement) stack.push(doc.documentElement);
                    } catch { }
                }
            }
            const children = node.children || node.childNodes;
            if (children) {
                for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
            }
        }
    },

    simplify(annotate) {
        state.map.clear();
        state.badges.forEach(b => b.remove());
        state.badges = [];
        state.nextId = 1;

        const els = [];
        this.walk(document, els);

        // Deduplication Logic
        const groups = [];
        const THRESHOLD = 5; // pixels

        for (const el of els) {
            const r = el.getBoundingClientRect();
            let added = false;
            for (const group of groups) {
                const gr = group.rect;
                if (Math.abs(r.left - gr.left) < THRESHOLD &&
                    Math.abs(r.top - gr.top) < THRESHOLD &&
                    Math.abs(r.width - gr.width) < THRESHOLD &&
                    Math.abs(r.height - gr.height) < THRESHOLD) {
                    group.candidates.push(el);
                    added = true;
                    break;
                }
            }
            if (!added) {
                groups.push({ rect: r, candidates: [el] });
            }
        }

        const finalEls = [];
        for (const group of groups) {
            // Select best candidate from group
            // Preference: button > a > input > textarea > select > [role=button] > leaf node > others
            group.candidates.sort((a, b) => {
                const score = (el) => {
                    let s = 0;
                    const tag = el.tagName.toLowerCase();
                    if (tag === 'button') s += 10;
                    else if (tag === 'a') s += 9;
                    else if (tag === 'input') s += 8;
                    else if (tag === 'textarea') s += 8;
                    else if (tag === 'select') s += 8;
                    else if (el.getAttribute('role') === 'button') s += 7;
                    else if (el.getAttribute('role') === 'link') s += 6;

                    if (!el.children.length) s += 2; // Leaf node preference
                    if (String(el.innerText || "").trim().length > 0) s += 1;
                    return s;
                };
                return score(b) - score(a);
            });
            finalEls.push(group.candidates[0]);
        }

        const nodes = [];
        for (const el of finalEls) {
            const id = state.nextId++;
            state.map.set(id, el);
            el.dataset.agentId = String(id);

            const r = el.getBoundingClientRect();

            if (annotate) {
                const b = document.createElement('div');
                b.textContent = id;
                b.style.cssText = `position:fixed;z-index:2147483647;background:#000;color:#fff;font-size:10px;padding:1px 3px;border-radius:3px;pointer-events:none;opacity:0.8;`;
                b.style.left = Math.max(0, r.left) + 'px';
                b.style.top = Math.max(0, r.top) + 'px';
                document.body.appendChild(b);
                state.badges.push(b);
            }

            nodes.push({
                i: id,
                t: el.tagName.toLowerCase(),
                x: String(el.innerText || el.value || "").slice(0, 50).replace(/\s+/g, " ").trim(),
                l: (el.getAttribute('aria-label') || el.getAttribute('name') || "").slice(0, 50),
                r: el.getAttribute('role') || "",
                b: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
            });
        }
        return nodes;
    },

    mapCompact() {
        // Similar to simplify but returns compact format for experimental mode
        state.map.clear();
        state.nextId = 1;
        const els = [];
        this.walk(document, els);

        return els.map(el => {
            const id = state.nextId++;
            state.map.set(id, el);
            el.dataset.agentId = String(id);
            const r = el.getBoundingClientRect();

            return {
                i: id,
                t: el.tagName.toLowerCase(),
                x: String(el.innerText || el.value || "").slice(0, 100).replace(/\s+/g, " ").trim(),
                l: (el.getAttribute('aria-label') || "").slice(0, 50),
                r: el.getAttribute('role') || undefined,
                h: el.getAttribute('href') || undefined,
                p: el.getAttribute('placeholder') || undefined,
                b: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
            };
        });
    }
};

// --- Listener Setup ---

if (!window.__heybro_listener_added) {
    window.__heybro_listener_added = true;
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.t === "ping") { sendResponse({ ok: true }); return; }
        if (msg.t === "execute") {
            execute(msg.payload).then(res => sendResponse(res)).catch(e => sendResponse({ ok: false, error: e.message }));
            return true;
        }
        if (msg.t === "evaluate") {
            try {
                const result = eval(msg.code);
                sendResponse({ ok: true, result });
            } catch (e) {
                sendResponse({ ok: false, error: e.message });
            }
            return;
        }
        if (msg.t === "simplify") {
            try {
                const els = PageScanner.simplify(msg.annotate);
                sendResponse({ elements: els });
            } catch (e) {
                console.error("Heybro: simplify error", e);
                sendResponse({ elements: [], error: e.message });
            }
            return;
        }
        if (msg.t === "mapCompact") {
            try {
                const els = PageScanner.mapCompact();
                sendResponse({ elements: els });
            } catch (e) {
                sendResponse({ elements: [], error: e.message });
            }
            return;
        }
        if (msg.t === "getPageState") {
            try {
                const sel = window.getSelection();
                const active = document.activeElement;
                sendResponse({
                    state: {
                        url: location.href,
                        title: document.title,
                        readyState: document.readyState,
                        scroll: { y: window.scrollY, x: window.scrollX },
                        selectedText: sel ? sel.toString() : "",
                        activeElement: active ? {
                            tag: active.tagName.toLowerCase(),
                            type: active.type || "",
                            text: (active.innerText || active.value || "").slice(0, 50)
                        } : null,
                        lastInteraction: window.__hb_last_interaction,
                        mutationCount: window.__hb_mutation_count
                    }
                });
            } catch (e) {
                sendResponse({ state: { url: location.href, error: e.message } });
            }
            return;
        }
        if (msg.t === "getFormState") {
            try {
                const forms = {};
                document.querySelectorAll('form').forEach((f, i) => {
                    const data = {};
                    new FormData(f).forEach((v, k) => data[k] = v);
                    forms[`form_${i}`] = data;
                });
                sendResponse({ state: forms });
            } catch (e) {
                sendResponse({ state: {} });
            }
            return;
        }
    });
}