var state = window.__heybro_state || {
  nextId: 1,
  map: new Map(),
  sigMap: new Map(),
  sigIndex: new Map(),
  badges: [],
  badgeMap: new Map(),
  annotating: false,
  experimental: false
};
window.__heybro_state = state;

if (!window.__heybro_dom_observer_added) {
  window.__heybro_dom_observer_added = true;
  let __hb_last_clear = 0;
  const obs = new MutationObserver(() => {
    const now = Date.now();
    if (now - __hb_last_clear < 250) return;
    __hb_last_clear = now;
    state.map.clear();
    state.sigMap.clear();
    state.sigIndex.clear();
    state.nextId = 1;
  });
  obs.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
}

if (!window.__heybro_event_logger_added) {
  window.__heybro_event_logger_added = true;
  const send = (event, detail) => {
    try { chrome.runtime.sendMessage({ t: "EVENT_LOG", event, detail, url: location.href }); } catch { }
  };
  document.addEventListener("click", (e) => {
    try {
      const t = e.target;
      const tag = t && t.tagName ? t.tagName.toLowerCase() : "";
      const text = (t && (t.innerText || t.textContent) ? (t.innerText || t.textContent).trim().slice(0, 120) : "");
      const label = t ? labelForEx(t) : "";
      send("click", { tag, text, label });
    } catch { }
  }, true);
  document.addEventListener("input", (e) => {
    try {
      const t = e.target;
      const tag = t && t.tagName ? t.tagName.toLowerCase() : "";
      const valuePreview = t && typeof t.value === "string" ? t.value.slice(0, 30) : "";
      send("input", { tag, valuePreview });
    } catch { }
  }, true);
  window.addEventListener("scroll", () => {
    try { send("scroll", { y: window.scrollY }); } catch { }
  }, { passive: true });
}


function isTopWindow() {
  try { return window.top === window; } catch (e) { return true; }
}

function isVisible(el) {
  const cs = getComputedStyle(el);
  if (cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) === 0) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  return true;
}

function isRenderable(el) {
  const cs = getComputedStyle(el);
  if (cs.visibility === "hidden" || cs.display === "none") return false;
  if (!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)) return false;
  return true;
}

function labelFor(el) {
  let t = "";
  if (el.labels && el.labels.length) t = el.labels[0].innerText.trim();
  if (!t && el.getAttribute) t = el.getAttribute("aria-label") || "";
  if (!t && el.placeholder) t = el.placeholder;
  return t || "";
}

function typeFor(el) {
  const n = el.tagName.toLowerCase();
  if (n === "a") return "link";
  if (n === "button") return "button";
  if (n === "input") return "input";
  if (n === "textarea") return "textarea";
  if (n === "select") return "select";
  return n;
}

function stableKey(sig) {
  const t = (sig && sig.tag) ? String(sig.tag).toLowerCase() : "";
  const r = (sig && sig.role) ? String(sig.role).toLowerCase() : "";
  const i = (sig && sig.id) ? String(sig.id).toLowerCase() : "";
  const x = (sig && sig.text) ? String(sig.text).toLowerCase().slice(0, 120) : "";
  const l = (sig && sig.label) ? String(sig.label).toLowerCase().slice(0, 120) : "";
  const h = (sig && sig.href) ? String(sig.href).toLowerCase() : "";
  const p = (sig && sig.placeholder) ? String(sig.placeholder).toLowerCase() : "";
  const d = (sig && sig.testid) ? String(sig.testid).toLowerCase() : "";
  return [t, r, i, x, l, h, p, d].join("|#|");
}

function roleFor(el) {
  return el.getAttribute("role") || "";
}

function clearBadges() {
  for (const b of state.badges) b.remove();
  state.badges = [];
  state.badgeMap.clear();
}


function annotateBadge(el, id) {
  const r = el.getBoundingClientRect();
  const b = document.createElement("div");
  b.textContent = String(id);
  b.style.cssText = `
    position: fixed; left: ${Math.max(0, r.left)}px; top: ${Math.max(0, r.top)}px;
    background: #111; color: #fff; font-size: 12px; padding: 2px 4px;
    border-radius: 4px; z-index: 2147483647; pointer-events: none; box-shadow: 0 0 2px #fff;
  `;
  b.dataset.agentId = String(id);
  document.body.appendChild(b);
  state.badges.push(b);
  state.badgeMap.set(id, b);
}

function updateBadges() {
  if (!state.annotating) return;
  for (const [id, el] of state.map.entries()) {
    const b = state.badgeMap.get(id);
    if (!b) continue;
    const r = el.getBoundingClientRect();
    b.style.left = Math.max(0, r.left) + "px";
    b.style.top = Math.max(0, r.top) + "px";
  }
}

function isInteractive(el) {
  const n = el.tagName.toLowerCase();
  if (["a", "button", "input", "textarea", "select"].includes(n)) return true;
  const role = el.getAttribute("role");
  if (role && ["button", "link", "tab", "menuitem"].includes(role)) return true;
  if (el.tabIndex >= 0) return true;
  const cs = getComputedStyle(el);
  if (cs.cursor === "pointer") return true;
  if (typeof el.onclick === "function") return true;
  return false;
}

function isClickable(el) {
  if (!isVisible(el)) return false;
  if (el.disabled) return false;
  const cs = getComputedStyle(el);
  if (cs.pointerEvents === "none") return false;
  return true;
}

function getByFor(id) {
  const label = document.querySelector(`label[for="${id}"]`);
  return label ? label.innerText.trim() : "";
}

function byLabelled(el) {
  const ids = (el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
  if (!ids.length) return "";
  let s = "";
  for (const i of ids) {
    const n = document.getElementById(i);
    if (n) s += (n.innerText || n.textContent || "").trim() + " ";
  }
  return s.trim();
}

function labelForEx(el) {
  let t = "";
  if (el.labels && el.labels.length) t = el.labels[0].innerText.trim();
  if (!t && el.getAttribute) t = el.getAttribute("aria-label") || "";
  if (!t && el.placeholder) t = el.placeholder;
  if (!t && el.id) t = getByFor(el.id);
  if (!t) t = byLabelled(el);
  if (!t && el.title) t = el.title;
  if (!t && el.alt) t = el.alt;
  return t || "";
}

function walk(root, out) {
  const stack = [root];
  const seen = new Set();
  while (stack.length) {
    const node = stack.pop();
    if (!node || seen.has(node)) continue;
    seen.add(node);
    if (node.nodeType === 1) {
      const el = node;
      if (isInteractive(el)) out.push(el);
      const sr = el.shadowRoot;
      if (sr) stack.push(sr);
      if (el.tagName && el.tagName.toLowerCase() === "iframe") {
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
}

function simplify(annotate) {
  clearBadges();
  state.map.clear();
  state.nextId = 1;
  state.annotating = !!annotate;
  const nodes = [];
  const els = [];
  walk(document, els);
  for (const el of els) {
    if (!isVisible(el)) continue;
    const __tag = el.tagName ? el.tagName.toLowerCase() : "";
    if (__tag === "a") {
      const __href = el.href || el.getAttribute('href') || "";
      if (__href && isAdOrTrackerHref(__href)) continue;
    }
    const id = state.nextId++;
    el.dataset.agentId = String(id);
    state.map.set(id, el);
    const sig = {
      tag: el.tagName ? el.tagName.toLowerCase() : "",
      id: el.id || "",
      role: roleFor(el),
      text: (el.innerText || el.textContent || "").trim(),
      label: labelForEx(el),
      href: stripTrackingParams(el.href || el.getAttribute('href') || ""),
      placeholder: el.placeholder || "",
      testid: el.getAttribute && (el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-qa') || el.getAttribute('data-automation')) || ""
    };
    state.sigMap.set(id, sig);
    state.sigIndex.set(stableKey(sig), id);
    if (annotate) annotateBadge(el, id);
    nodes.push({
      id,
      type: typeFor(el),
      text: (el.innerText || "").trim(),
      label: labelForEx(el)
    });
  }
  return nodes;
}

function inFooter(el) {
  return !!(el.closest("footer") || el.closest("[role=contentinfo]") ||
    el.closest("#footer") || el.closest(".footer"));
}

function mapGlobal() {
  const nodes = [];
  const els = [];
  walk(document, els);
  let id = 1;
  for (const el of els) {
    if (!isRenderable(el)) continue;
    const __tag = el.tagName ? el.tagName.toLowerCase() : "";
    if (__tag === "a") {
      const __href = el.href || el.getAttribute('href') || "";
      if (__href && isAdOrTrackerHref(__href)) continue;
    }
    el.dataset.agentId = String(id);
    state.map.set(id, el);
    const sig = {
      tag: el.tagName ? el.tagName.toLowerCase() : "",
      id: el.id || "",
      role: roleFor(el),
      text: (el.innerText || el.textContent || "").trim(),
      label: labelForEx(el),
      href: stripTrackingParams(el.href || el.getAttribute('href') || ""),
      placeholder: el.placeholder || "",
      testid: el.getAttribute && (el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-qa') || el.getAttribute('data-automation')) || ""
    };
    state.sigMap.set(id, sig);
    state.sigIndex.set(stableKey(sig), id);
    nodes.push({
      id,
      type: typeFor(el),
      text: (el.innerText || "").trim(),
      label: labelForEx(el),
      inFooter: inFooter(el)
    });
    id++;
  }
  return nodes;
}

function cleanText(s) {
  return String(s || "").replace(/\s+/g, " ").replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "").trim().slice(0, 60);
}

function mapCompact() {
  const out = [];
  const els = [];
  walk(document, els);
  let id = 1;
  for (const el of els) {
    if (!isRenderable(el)) continue;
    const rect = el.getBoundingClientRect();
    const inViewport = rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= window.innerHeight && rect.right >= 0 && rect.left <= window.innerWidth;
    if (!inViewport) continue;
    const __tag = el.tagName ? el.tagName.toLowerCase() : "";
    if (__tag === "a") {
      const __href = el.href || el.getAttribute('href') || "";
      if (__href && isAdOrTrackerHref(__href)) continue;
    }
    el.dataset.agentId = String(id);
    state.map.set(id, el);
    const sig = {
      tag: el.tagName ? el.tagName.toLowerCase() : "",
      id: el.id || "",
      role: roleFor(el),
      text: (el.innerText || el.textContent || "").trim(),
      label: labelForEx(el),
      href: stripTrackingParams(el.href || el.getAttribute('href') || ""),
      placeholder: el.placeholder || "",
      testid: el.getAttribute && (el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-qa') || el.getAttribute('data-automation')) || ""
    };
    state.sigMap.set(id, sig);
    state.sigIndex.set(stableKey(sig), id);

    // Get bounding box
    // rect computed above
    const bbox = {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      w: Math.round(rect.width),
      h: Math.round(rect.height)
    };

    out.push({
      i: id,
      t: el.tagName.toLowerCase(),
      y: typeFor(el),
      r: roleFor(el),
      x: cleanText(el.innerText || el.textContent || ""),
      l: cleanText(labelForEx(el)),
      f: inFooter(el) ? 1 : 0,
      b: bbox, // bounding box
      v: inViewport, // viewport-visible
      e: !el.disabled && !el.getAttribute('aria-disabled'), // enabled
      c: el.checked || false, // checked state for checkboxes/radio
      s: el.selectedIndex !== undefined ? el.selectedIndex : null, // selected index for selects
      h: stripTrackingParams(el.href || el.getAttribute('href') || ""), // href for links
      p: el.placeholder || "", // placeholder
      a: el === document.activeElement // active/focused
    });
    id++;
  }
  return out;
}

function getById(id) {
  return state.map.get(id) || document.querySelector(`[data-agent-id="${id}"]`);
}

function describeElement(el) {
  if (!el) return null;
  return {
    tag: el.tagName ? el.tagName.toLowerCase() : "",
    id: el.id || "",
    type: el.type || "",
    text: (el.innerText || el.textContent || "").trim(),
    label: labelForEx(el)
  };
}

function getPageState() {
  let selectedText = "";
  try {
    const selection = window.getSelection();
    if (selection && selection.toString().trim()) {
      selectedText = selection.toString().trim();
    }
  } catch (e) {
    // Selection might not be accessible
  }

  return {
    url: location.href,
    title: document.title,
    readyState: document.readyState,
    activeElement: describeElement(document.activeElement),
    scroll: { x: scrollX, y: scrollY },
    viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 },
    selectedText: selectedText
  };
}

function sanitizeUrl(u) {
  if (!u) return "";
  let s = String(u).trim();
  s = s.replace(/^`+|`+$/g, "").trim();
  s = s.replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "").trim();
  return s;
}

function hostFromUrl(u) {
  try {
    const s = sanitizeUrl(u);
    if (!s) return "";
    const url = s.match(/^[a-zA-Z][a-zA-Z0-9]*:/) ? new URL(s) : new URL(s, location.href);
    return (url.hostname || "").replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function stripTrackingParams(u) {
  try {
    const s = sanitizeUrl(u);
    if (!s) return "";
    const url = s.match(/^[a-zA-Z][a-zA-Z0-9]*:/) ? new URL(s) : new URL(s, location.href);
    const qs = new URLSearchParams(url.search);
    const keys = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid", "yclid", "mc_eid", "igshid", "si", "spm", "ref", "affid"];
    for (const k of keys) qs.delete(k);
    url.search = qs.toString() ? "?" + qs.toString() : "";
    return url.toString();
  } catch {
    return sanitizeUrl(u);
  }
}

function isAdOrTrackerHref(u) {
  const h = hostFromUrl(u);
  if (!h) return false;
  const blocked = new Set(["aax-eu-zaz.amazon.in", "googleads.g.doubleclick.net", "adservice.google.com", "pagead2.googlesyndication.com", "adclick.g.doubleclick.net"]);
  return blocked.has(h);
}

function getFormState() {
  const forms = {};
  const inputs = document.querySelectorAll('input, textarea, select');

  for (const input of inputs) {
    const name = input.name || input.id;
    if (!name) continue;

    if (input.type === 'checkbox' || input.type === 'radio') {
      forms[name] = input.checked;
    } else if (input.tagName === 'SELECT') {
      forms[name] = input.value;
    } else {
      const value = input.value;
      if (value) forms[name] = value.slice(0, 100); // Limit length
    }
  }

  return forms;
}

function findTarget(payload) {
  if (!payload) return null;

  let candidates = [];
  const viewportOnly = !!payload.viewportOnly;

  // Direct href lookup
  if (payload.href) {
    const href = sanitizeUrl(payload.href);
    if (href) {
      if (isAdOrTrackerHref(href)) return null;
      const link = document.querySelector(`a[href="${href}"]`) || document.querySelector(`[href="${href}"]`) || document.querySelector(`a[href*="${href}"]`) || document.querySelector(`[href*="${href}"]`);
      if (link && isRenderable(link)) {
        if (viewportOnly) {
          const r = link.getBoundingClientRect();
          const inViewport = r.width > 0 && r.height > 0 && r.bottom >= 0 && r.top <= window.innerHeight && r.right >= 0 && r.left <= window.innerWidth;
          if (!inViewport) return null;
        }
        return link;
      }
    }
  }

  // Direct ID lookup (fastest)
  if (payload.id) {
    const byId = getById(payload.id);
    if (byId && isRenderable(byId)) {
      // Verify element is still in DOM and visible
      const rect = byId.getBoundingClientRect();
      const inViewport = rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= window.innerHeight && rect.right >= 0 && rect.left <= window.innerWidth;
      if ((rect.width > 0 && rect.height > 0) && (!viewportOnly || inViewport)) {
        return byId;
      }
    }
    // Fallback via stored signature when ID no longer maps
    const sig = state.sigMap.get(payload.id);
    if (sig) {
      const key = stableKey(sig);
      const remapId = state.sigIndex.get(key);
      if (remapId) {
        const re = getById(remapId);
        if (re && isRenderable(re)) return re;
      }
      // Try direct selectors first
      if (sig.id) {
        const e1 = document.getElementById(sig.id);
        if (e1 && isRenderable(e1)) {
          if (viewportOnly) {
            const r = e1.getBoundingClientRect();
            const inViewport = r.width > 0 && r.height > 0 && r.bottom >= 0 && r.top <= window.innerHeight && r.right >= 0 && r.left <= window.innerWidth;
            if (!inViewport) return null;
          }
          return e1;
        }
      }
      if (sig.testid) {
        const e2 = document.querySelector(`[data-testid="${sig.testid}"]`) ||
          document.querySelector(`[data-test="${sig.testid}"]`) ||
          document.querySelector(`[data-qa="${sig.testid}"]`) ||
          document.querySelector(`[data-automation="${sig.testid}"]`);
        if (e2 && isRenderable(e2)) {
          if (viewportOnly) {
            const r = e2.getBoundingClientRect();
            const inViewport = r.width > 0 && r.height > 0 && r.bottom >= 0 && r.top <= window.innerHeight && r.right >= 0 && r.left <= window.innerWidth;
            if (!inViewport) return null;
          }
          return e2;
        }
      }

      // Score-based search over interactive elements
      const els = [];
      walk(document, els);
      let best = null;
      let bestScore = -1;
      for (const el of els) {
        if (!isRenderable(el)) continue;
        const tag = el.tagName ? el.tagName.toLowerCase() : "";
        if (tag === "a") {
          const __h = el.href || el.getAttribute('href') || "";
          if (__h && isAdOrTrackerHref(__h)) continue;
        }
        let score = 0;
        const text = (el.innerText || el.textContent || "").trim().toLowerCase();
        const label = labelForEx(el).toLowerCase();
        const role = roleFor(el).toLowerCase();
        const href = (el.href || el.getAttribute('href') || "").toLowerCase();
        const placeholder = (el.placeholder || "").toLowerCase();
        const testid = el.getAttribute && ((el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-qa') || el.getAttribute('data-automation')) || "").toLowerCase();

        if (sig.tag && tag === sig.tag) score += 2;
        if (sig.role && role === sig.role.toLowerCase()) score += 2;
        if (sig.id && el.id && el.id.toLowerCase() === sig.id.toLowerCase()) score += 5;
        if (sig.testid && testid && testid === sig.testid.toLowerCase()) score += 5;
        if (sig.text) {
          const s = sig.text.toLowerCase();
          if (text === s) score += 5; else if (text.includes(s)) score += 3;
        }
        if (sig.label) {
          const s = sig.label.toLowerCase();
          if (label === s) score += 5; else if (label.includes(s)) score += 3;
        }
        if (sig.placeholder) {
          const s = sig.placeholder.toLowerCase();
          if (placeholder === s) score += 3; else if (placeholder.includes(s)) score += 2;
        }
        if (sig.href) {
          const s = sig.href.toLowerCase();
          if (href && href === s) score += 8; else if (href.includes(s)) score += 4;
        }
        if (isClickable(el)) score += 2;
        const r = el.getBoundingClientRect();
        const inViewport = r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight;
        if (inViewport) score += 1;
        if (score > bestScore) {
          bestScore = score;
          best = el;
        }
      }
      if (best && bestScore >= 4) return best;
    }
  }

  // Signature-based lookup from payload
  const sigPayload = payload.sig || payload.signature;
  if (sigPayload && typeof sigPayload === "object") {
    const key = stableKey(sigPayload);
    const remapId = state.sigIndex.get(key);
    if (remapId) {
      const re = getById(remapId);
      if (re && isRenderable(re)) {
        if (viewportOnly) {
          const r = re.getBoundingClientRect();
          const inViewport = r.width > 0 && r.height > 0 && r.bottom >= 0 && r.top <= window.innerHeight && r.right >= 0 && r.left <= window.innerWidth;
          if (!inViewport) return null;
        }
        return re;
      }
    }
    // Try direct selectors first
    if (sigPayload.id) {
      const e1 = document.getElementById(sigPayload.id);
      if (e1 && isRenderable(e1)) return e1;
    }
    if (sigPayload.testid) {
      const e2 = document.querySelector(`[data-testid="${sigPayload.testid}"]`) ||
        document.querySelector(`[data-test="${sigPayload.testid}"]`) ||
        document.querySelector(`[data-qa="${sigPayload.testid}"]`) ||
        document.querySelector(`[data-automation="${sigPayload.testid}"]`);
      if (e2 && isRenderable(e2)) return e2;
    }
    if (sigPayload.href) {
      const href = sanitizeUrl(sigPayload.href);
      if (href) {
        if (isAdOrTrackerHref(href)) return null;
        const e3 = document.querySelector(`a[href="${href}"]`) || document.querySelector(`[href="${href}"]`) || document.querySelector(`a[href*="${href}"]`) || document.querySelector(`[href*="${href}"]`);
        if (e3 && isRenderable(e3)) return e3;
      }
    }

    // Score-based search across interactive elements
    const els2 = [];
    walk(document, els2);
    let best2 = null;
    let bestScore2 = -1;
    for (const el of els2) {
      if (!isRenderable(el)) continue;
      const tag = el.tagName ? el.tagName.toLowerCase() : "";
      if (tag === "a") {
        const __h = el.href || el.getAttribute('href') || "";
        if (__h && isAdOrTrackerHref(__h)) continue;
      }
      let score = 0;
      const text = (el.innerText || el.textContent || "").trim().toLowerCase();
      const label = labelForEx(el).toLowerCase();
      const role = roleFor(el).toLowerCase();
      const href = (el.href || el.getAttribute('href') || "").toLowerCase();
      const placeholder = (el.placeholder || "").toLowerCase();
      const testid = el.getAttribute && ((el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-qa') || el.getAttribute('data-automation')) || "").toLowerCase();

      if (sigPayload.tag && tag === String(sigPayload.tag).toLowerCase()) score += 2;
      if (sigPayload.role && role === String(sigPayload.role).toLowerCase()) score += 2;
      if (sigPayload.id && el.id && el.id.toLowerCase() === String(sigPayload.id).toLowerCase()) score += 5;
      if (sigPayload.testid && testid && testid === String(sigPayload.testid).toLowerCase()) score += 5;
      if (sigPayload.text) {
        const s = String(sigPayload.text).toLowerCase();
        if (text === s) score += 5; else if (text.includes(s)) score += 3;
      }
      if (sigPayload.label) {
        const s = String(sigPayload.label).toLowerCase();
        if (label === s) score += 5; else if (label.includes(s)) score += 3;
      }
      if (sigPayload.placeholder) {
        const s = String(sigPayload.placeholder).toLowerCase();
        if (placeholder === s) score += 3; else if (placeholder.includes(s)) score += 2;
      }
      if (sigPayload.href) {
        const s = String(sigPayload.href).toLowerCase();
        if (href && (href === s)) score += 8; else if (href.includes(s)) score += 4;
      }
      // Favor clickable and viewport-visible elements
      if (isClickable(el)) score += 2;
      const r = el.getBoundingClientRect();
      const inViewport = r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight;
      if (inViewport) score += 1;

      if (score > bestScore2) { bestScore2 = score; best2 = el; }
    }
    if (best2 && bestScore2 >= 4) return best2;
  }

  // XPath lookup
  if (payload.xpath) {
    try {
      const result = document.evaluate(payload.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      const element = result.singleNodeValue;
      if (element && isRenderable(element)) {
        return element;
      }
    } catch (e) {
      // Invalid XPath, continue with other methods
    }
  }

  // CSS selector lookup
  if (payload.selector) {
    try {
      const element = document.querySelector(payload.selector);
      if (element && isRenderable(element)) {
        return element;
      }
    } catch (e) {
      // Invalid selector, continue
    }
  }

  // Text-based lookup with enhanced matching
  if (payload.text) {
    const els = [];
    walk(document, els);
    const searchText = String(payload.text).toLowerCase().trim();
    const isExact = payload.exact;
    const isPartial = payload.partial !== false; // Default to partial matching

    for (const el of els) {
      if (!isRenderable(el)) continue;

      let extra = "";
      const testid = el.getAttribute && (el.getAttribute("data-testid") || el.getAttribute("data-test") || el.getAttribute("data-qa") || el.getAttribute("data-automation")) || "";
      const role = el.getAttribute ? (el.getAttribute("role") || "") : "";
      const idAttr = el.id || "";
      if (testid) extra += " " + String(testid).toLowerCase();
      if (role) extra += " " + String(role).toLowerCase();
      if (idAttr) extra += " " + String(idAttr).toLowerCase();
      const elementText = (((el.innerText || el.textContent || "") + " " + labelForEx(el) + extra)).toLowerCase();

      let matches = false;
      if (isExact) {
        matches = elementText.trim() === searchText;
      } else if (isPartial) {
        matches = elementText.includes(searchText);
      } else {
        // Word boundary matching
        const words = searchText.split(/\s+/);
        matches = words.every(word => elementText.includes(word));
      }

      if (matches) {
        const rect = el.getBoundingClientRect();
        const tag = el.tagName ? el.tagName.toLowerCase() : "";
        const href = (el.href || el.getAttribute('href') || "").toLowerCase();
        const clickable = isClickable(el);
        const inViewport = rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= window.innerHeight && rect.right >= 0 && rect.left <= window.innerWidth;
        if (viewportOnly && !inViewport) {
          continue;
        }
        const dm = searchText.match(/\b([a-z0-9-]+\.(?:com|in|net|org|io|ai|app|dev|store|shop|co|me|tv|info))\b/);
        const domainWord = dm ? dm[1].toLowerCase() : "";
        let score = 0;
        if (isExact && elementText.trim() === searchText) score += 8;
        if (!isExact && elementText.includes(searchText)) score += 4;
        if (tag === 'a') score += 3;
        if (tag === 'button') score += 2;
        if (href && domainWord && href.includes(domainWord)) score += 6;
        if (clickable) score += 2;
        if (inViewport) score += 1;
        candidates.push({
          element: el,
          score,
          bbox: { x: rect.left, y: rect.top, width: rect.width, height: rect.height, visible: rect.width > 0 && rect.height > 0 }
        });
      }
    }

    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.bbox.visible !== b.bbox.visible) return a.bbox.visible ? -1 : 1;
      return 0;
    });

    // Return specific index if requested
    if (payload.index !== undefined && payload.index < candidates.length) {
      return candidates[payload.index].element;
    }

    // Return best candidate
    if (candidates.length > 0) return candidates[0].element;
  }

  return null;
}

function findInputElement(el, payload) {
  if (el && (el.isContentEditable ||
    (el.tagName && ["input", "textarea"].includes(el.tagName.toLowerCase())))) {
    return el;
  }

  if (el) {
    const forId = el.getAttribute && el.getAttribute("for");
    if (forId) {
      const byFor = document.getElementById(forId);
      if (byFor) return byFor;
    }

    const within = el.querySelector && el.querySelector("input,textarea,[contenteditable='true']");
    if (within) return within;
  }

  if (payload && payload.text) {
    const label = String(payload.text).toLowerCase();
    const candidates = Array.from(document.querySelectorAll("input,textarea,[contenteditable='true']"));
    for (const cand of candidates) {
      const s = ((cand.getAttribute("placeholder") || "") + " " +
        (cand.getAttribute("aria-label") || "") + " " + labelForEx(cand)).toLowerCase();
      if (s.includes(label)) return cand;
    }
  }

  return el;
}

async function execute(payload) {
  const a = payload.action;
  const behavior = state.experimental ? "smooth" : "auto";

  if (a === "new_tab") {
    const u = payload.value || payload.url;
    if (u && isTopWindow()) {
      try { chrome.runtime.sendMessage({ action: "OPEN_NEW_TAB", url: u }); } catch { }
    }
    return { ok: true };
  }

  if (a === "scroll") {
    const behavior = payload.behavior || (state.experimental ? "smooth" : "auto");
    const to = payload.to;
    const amount = Number(payload.amount || 0);
    const direction = payload.direction || "down";

    // Handle verification mode
    if (payload.verify) {
      const target = findTarget(payload);
      if (!target) return { visible: false };

      const rect = target.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      const windowWidth = window.innerWidth;

      // Check if element is visible in viewport
      const isVisible = rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= windowHeight &&
        rect.right <= windowWidth;

      return { visible: isVisible, rect: { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right } };
    }

    // Handle predefined scroll positions
    if (to === "top") {
      window.scrollTo({ top: 0, left: 0, behavior });
      return { ok: true, position: { x: 0, y: 0 } };
    }

    if (to === "bottom") {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo({ top: maxScroll, left: 0, behavior });
      return { ok: true, position: { x: 0, y: maxScroll } };
    }

    if (to === "middle") {
      const middleY = (document.documentElement.scrollHeight - window.innerHeight) / 2;
      window.scrollTo({ top: middleY, left: 0, behavior });
      return { ok: true, position: { x: 0, y: middleY } };
    }

    if (to === "left") {
      window.scrollTo({ top: window.scrollY, left: 0, behavior });
      return { ok: true, position: { x: 0, y: window.scrollY } };
    }

    if (to === "right") {
      const maxLeft = document.documentElement.scrollWidth - window.innerWidth;
      window.scrollTo({ top: window.scrollY, left: maxLeft, behavior });
      return { ok: true, position: { x: maxLeft, y: window.scrollY } };
    }

    // Handle directional scrolling
    if (to === "up" || to === "down" || to === "left" || to === "right") {
      const scrollAmount = amount || (direction === "up" || direction === "down" ? window.innerHeight * 0.8 : window.innerWidth * 0.8);
      const deltaX = (to === "left" ? -scrollAmount : to === "right" ? scrollAmount : 0);
      const deltaY = (to === "up" ? -scrollAmount : to === "down" ? scrollAmount : 0);

      window.scrollBy({ top: deltaY, left: deltaX, behavior });
      return { ok: true, scrolled: { x: deltaX, y: deltaY } };
    }

    // Handle scrolling to specific amount
    if (amount) {
      const deltaY = direction === "up" ? -Math.abs(amount) : Math.abs(amount);
      window.scrollBy({ top: deltaY, left: 0, behavior });
      return { ok: true, scrolled: { x: 0, y: deltaY } };
    }

    // Handle scrolling to element
    if (to === "element" || payload.id || payload.selector || payload.text) {
      const target = findTarget(payload);
      if (!target) return { ok: false, error: "Target element not found" };

      target.scrollIntoView({
        behavior,
        block: payload.block || "center",
        inline: payload.inline || "center"
      });

      // Verify scroll worked
      await new Promise(resolve => setTimeout(resolve, behavior === "smooth" ? 500 : 100));
      const rect = target.getBoundingClientRect();
      const isVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;

      return {
        ok: true,
        elementVisible: isVisible,
        elementRect: { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right }
      };
    }

    // Default scroll down
    window.scrollBy({ top: window.innerHeight * 0.8, left: 0, behavior });
    return { ok: true };
  }

  let el = findTarget(payload);

  if (a === "click") {
    if (!el) return { ok: false, error: "Element not found" };

    try {
      // Resolve most clickable target
      let useEl = el;
      if (!isClickable(useEl)) {
        const anc = el.closest && el.closest('a,button,[role="button"],[role="link"],[onclick]');
        if (anc) useEl = anc;
        if (!isClickable(useEl) && el.querySelector) {
          const desc = el.querySelector('a,button,[role="button"],[role="link"],[onclick]');
          if (desc) useEl = desc;
        }
        const forId = useEl.getAttribute && useEl.getAttribute('for');
        if (forId) {
          const byFor = document.getElementById(forId);
          if (byFor) useEl = byFor;
        }
      }

      // Get current bounding box
      const rect = useEl.getBoundingClientRect();
      const bbox = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom
      };

      // Check if element is in viewport
      const isInViewport = bbox.top >= 0 &&
        bbox.left >= 0 &&
        bbox.bottom <= window.innerHeight &&
        bbox.right <= window.innerWidth;

      // Scroll element into view if needed
      if (!isInViewport) {
        useEl.scrollIntoView({
          behavior: state.experimental ? "smooth" : "auto",
          block: "center",
          inline: "center"
        });

        // Wait for scroll and get updated position
        if (!payload.force) {
          await new Promise(resolve => setTimeout(resolve, state.experimental ? 500 : 100));
        }

        // Recalculate bounding box after scroll
        const newRect = useEl.getBoundingClientRect();
        bbox.left = newRect.left;
        bbox.top = newRect.top;
        bbox.width = newRect.width;
        bbox.height = newRect.height;
        bbox.right = newRect.right;
        bbox.bottom = newRect.bottom;
      }

      // Calculate click coordinates - use center but ensure it's within bounds
      let clickX = bbox.left + (bbox.width / 2);
      let clickY = bbox.top + (bbox.height / 2);

      // Apply any custom offsets
      if (payload.offsetX !== undefined) clickX += payload.offsetX;
      if (payload.offsetY !== undefined) clickY += payload.offsetY;

      // Ensure click coordinates are within element bounds
      clickX = Math.max(bbox.left + 1, Math.min(clickX, bbox.right - 1));
      clickY = Math.max(bbox.top + 1, Math.min(clickY, bbox.bottom - 1));

      // Create mouse event options
      const eventOpts = {
        bubbles: true,
        cancelable: true,
        clientX: clickX,
        clientY: clickY,
        button: 0,
        buttons: 1,
        view: window
      };

      // Dispatch mouse event sequence
      // Dispatch mouse/pointer event sequence
      useEl.dispatchEvent(new MouseEvent("mouseenter", eventOpts));
      useEl.dispatchEvent(new PointerEvent("pointerenter", eventOpts));
      await new Promise(resolve => setTimeout(resolve, 10));

      useEl.dispatchEvent(new MouseEvent("mousedown", eventOpts));
      useEl.dispatchEvent(new PointerEvent("pointerdown", eventOpts));
      await new Promise(resolve => setTimeout(resolve, 10));

      useEl.dispatchEvent(new MouseEvent("mouseup", eventOpts));
      useEl.dispatchEvent(new PointerEvent("pointerup", eventOpts));
      await new Promise(resolve => setTimeout(resolve, 10));

      // Adjust target if overlay intercepts the click
      const topEl = document.elementFromPoint(Math.max(1, Math.min(clickX, window.innerWidth - 1)), Math.max(1, Math.min(clickY, window.innerHeight - 1)));
      if (topEl && topEl !== useEl && !useEl.contains(topEl)) {
        if (isClickable(topEl)) {
          topEl.dispatchEvent(new MouseEvent("click", eventOpts));
        } else {
          useEl.dispatchEvent(new MouseEvent("click", eventOpts));
        }
      } else {
        useEl.dispatchEvent(new MouseEvent("click", eventOpts));
      }

      // Fallback to native click if events didn't work
      if (!payload.force) {
        setTimeout(() => {
          try {
            useEl.click();
          } catch (e) {
            // Silent fallback failure
          }
        }, 50);
      }

      // Store event for testing
      try { window.__hb_last_event = "clicked"; } catch { }

      return {
        ok: true,
        clicked: true,
        bbox: bbox,
        clickCoords: { x: clickX, y: clickY },
        elementId: useEl.dataset.agentId
      };

    } catch (error) {
      // Force click as last resort
      try {
        useEl.click();
        return { ok: true, clicked: true, method: "force" };
      } catch { }

      return { ok: false, error: error.message };
    }
  }

  if (a === "type") {
    // Enhanced input element detection
    if (!el) {
      // Check active element first
      const ae = document.activeElement;
      if (ae && ae.tagName && ["input", "textarea"].includes(ae.tagName.toLowerCase())) {
        el = ae;
      }
      // Try to find by text/label
      if (!el && payload.text) el = findTarget({ text: payload.text });
      // Fallback to first available input
      if (!el) el = document.querySelector("input:not([type='hidden']),textarea,[contenteditable='true']");
      if (!el) return { ok: false, error: "No input element found" };
    }

    el = findInputElement(el, payload);
    if (!el) return { ok: false, error: "Element is not a valid input target" };

    // Scroll into view with better positioning
    el.scrollIntoView({
      behavior: state.experimental ? "smooth" : "auto",
      block: "center",
      inline: "nearest"
    });

    // Wait for scroll and focus
    await new Promise(resolve => setTimeout(resolve, 100));

    const val = payload.value || "";
    const append = !!payload.append;
    const mode = payload.mode || "set";
    const clearFirst = payload.clearFirst !== false;
    const simulate = payload.simulate !== false;
    const slowTyping = payload.slow;
    const delay = payload.delay || (slowTyping ? 100 : 10);

    try {
      // Focus the element
      el.focus();

      // Handle different input types
      if (el.isContentEditable || el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && ["text", "email", "password", "search", "url", "tel"].includes(el.type))) {

        let current = "";
        if (el.isContentEditable) {
          current = el.innerText || el.textContent || "";
        } else {
          current = el.value || "";
        }
        if (!append && mode === "set" && current === val) {
          return { ok: true, typed: 0 };
        }

        if (clearFirst && !append) {
          if (el.isContentEditable) {
            try {
              document.execCommand && document.execCommand("selectAll", false, null);
              document.execCommand && document.execCommand("delete", false, null);
            } catch { }
          } else {
            el.value = "";
          }
        }

        if (simulate) {
          // Simulate real typing with events
          for (let i = 0; i < val.length; i++) {
            const char = val[i];

            // Create and dispatch keyboard events
            const keydownEvent = new KeyboardEvent("keydown", {
              key: char,
              bubbles: true,
              cancelable: true
            });
            const keypressEvent = new KeyboardEvent("keypress", {
              key: char,
              bubbles: true,
              cancelable: true
            });
            const keyupEvent = new KeyboardEvent("keyup", {
              key: char,
              bubbles: true,
              cancelable: true
            });

            el.dispatchEvent(keydownEvent);
            el.dispatchEvent(keypressEvent);

            if (el.isContentEditable) {
              document.execCommand && document.execCommand("insertText", false, char);
            } else {
              el.value += char;
            }

            el.dispatchEvent(keyupEvent);
            el.dispatchEvent(new Event("input", { bubbles: true }));

            if (slowTyping) {
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
        } else {
          // Direct value setting
          if (el.isContentEditable) {
            document.execCommand && document.execCommand("insertText", false, val);
          } else {
            el.value = append ? (el.value + val) : val;
          }
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }

        // Final change event
        el.dispatchEvent(new Event("change", { bubbles: true }));

      } else if (el.tagName === "INPUT" && ["number", "date", "datetime-local"].includes(el.type)) {
        // Special handling for numeric/date inputs
        el.value = append ? (el.value + val) : val;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));

      } else {
        // Fallback for other input types
        el.value = append ? (el.value + val) : val;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }

      return { ok: true, typed: val.length };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }


  if (a === "select") {
    // Enhanced element finding
    if (!el) {
      el = document.querySelector("select");
      if (!el && payload.text) {
        // Try to find select by associated label
        const labels = document.querySelectorAll("label");
        for (const label of labels) {
          const labelText = label.textContent.trim().toLowerCase();
          const searchText = payload.text.toLowerCase();
          if (labelText.includes(searchText)) {
            const forId = label.getAttribute("for");
            if (forId) {
              el = document.getElementById(forId);
              if (el && el.tagName.toLowerCase() === "select") break;
            }
            // Check if select is inside label
            el = label.querySelector("select");
            if (el) break;
          }
        }
      }
    }

    if (!el || el.tagName.toLowerCase() !== "select") {
      return { ok: false, error: "No select element found" };
    }

    // Handle probe mode - return available options
    if (payload.probeOnly) {
      const options = Array.from(el.options).map((opt, idx) => ({
        index: idx,
        value: opt.value,
        text: opt.text.trim(),
        selected: opt.selected
      }));
      return { ok: true, options, currentValue: el.value, currentIndex: el.selectedIndex };
    }

    // Handle verify mode - check if selection worked
    if (payload.verifyOnly) {
      return { selected: el.value === payload.value || el.selectedIndex === payload.index };
    }

    // Scroll element into view
    el.scrollIntoView({ behavior: "auto", block: "center", inline: "center" });
    await new Promise(resolve => setTimeout(resolve, 100));

    const caseSensitive = payload.caseSensitive || false;
    const partial = payload.partial !== false;

    let targetOption = null;
    let selectionMethod = "";

    // Method 1: Select by index
    if (payload.index !== undefined && payload.index >= 0 && payload.index < el.options.length) {
      el.selectedIndex = payload.index;
      targetOption = el.options[payload.index];
      selectionMethod = "index";
    }

    // Method 2: Select by value (exact match)
    if (!targetOption && payload.value !== undefined) {
      for (const option of el.options) {
        if (option.value === payload.value) {
          el.value = option.value;
          targetOption = option;
          selectionMethod = "value";
          break;
        }
      }
    }

    // Method 3: Select by visible text/label
    if (!targetOption) {
      const searchText = (payload.label || payload.optionText || "").toLowerCase();
      if (searchText) {
        for (const option of el.options) {
          const optionText = caseSensitive ? option.text.trim() : option.text.trim().toLowerCase();
          const matches = partial ?
            optionText.includes(searchText) :
            optionText === searchText;

          if (matches) {
            el.value = option.value;
            targetOption = option;
            selectionMethod = "text";
            break;
          }
        }
      }
    }

    // Fallback: select first option if nothing found
    if (!targetOption && el.options.length > 0) {
      el.selectedIndex = 0;
      targetOption = el.options[0];
      selectionMethod = "fallback";
    }

    // Dispatch events to trigger any listeners
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("input", { bubbles: true }));

    // Verify selection worked
    const success = targetOption && (el.value === targetOption.value || el.selectedIndex === targetOption.index);

    return {
      ok: !!targetOption,
      selected: success,
      value: el.value,
      index: el.selectedIndex,
      text: targetOption ? targetOption.text.trim() : "",
      method: selectionMethod,
      totalOptions: el.options.length
    };
  }


  if (a === "check") {
    // Enhanced element finding for checkboxes and radio buttons
    if (!el) {
      if (payload.group) {
        // Find radio button in specific group
        el = document.querySelector(`input[type="radio"][name="${payload.group}"][value="${payload.value}"]`);
      } else {
        // Find by text/label association
        if (payload.text) {
          const labels = document.querySelectorAll("label");
          for (const label of labels) {
            const labelText = label.textContent.trim().toLowerCase();
            const searchText = payload.text.toLowerCase();
            if (labelText.includes(searchText)) {
              const forId = label.getAttribute("for");
              if (forId) {
                el = document.getElementById(forId);
                if (el && (el.type === "checkbox" || el.type === "radio")) break;
              }
              // Check if input is inside label
              el = label.querySelector('input[type="checkbox"], input[type="radio"]');
              if (el) break;
            }
          }
        }

        // Fallback to first checkbox/radio if no text specified
        if (!el) {
          el = document.querySelector('input[type="checkbox"], input[type="radio"]');
        }
      }
    }

    if (!el || (el.type !== "checkbox" && el.type !== "radio")) {
      return { ok: false, error: "No checkbox or radio button found" };
    }

    // Handle probe mode
    if (payload.probeOnly) {
      return {
        found: true,
        type: el.type,
        name: el.name,
        value: el.value,
        checked: el.checked,
        disabled: el.disabled
      };
    }

    // Handle verify mode
    if (payload.verifyOnly) {
      const expectedState = payload.toggle ? !payload.originalState : !!payload.value;
      return { stateCorrect: el.checked === expectedState };
    }

    // Scroll into view
    el.scrollIntoView({ behavior: "auto", block: "center", inline: "center" });
    await new Promise(resolve => setTimeout(resolve, 100));

    const isRadio = el.type === "radio";
    const originalState = el.checked;

    let targetState;
    if (payload.toggle) {
      targetState = !originalState;
    } else if (payload.force) {
      targetState = !!payload.value;
    } else {
      targetState = !!payload.value;
    }

    // For radio buttons, we need different logic
    if (isRadio) {
      if (targetState) {
        // For radio buttons, setting checked to true will uncheck others in the group
        el.checked = true;
      } else if (payload.force) {
        // If forcing false, we might need to select another radio or handle differently
        el.checked = false;
      } else {
        // Normally radio buttons can't be unchecked by user interaction
        // But if forced, we'll allow it
        el.checked = false;
      }
    } else {
      // Checkbox logic
      el.checked = targetState;
    }

    // Dispatch appropriate events
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("input", { bubbles: true }));

    // For radio buttons, also dispatch to the group
    if (isRadio && el.name) {
      const group = document.querySelectorAll(`input[type="radio"][name="${el.name}"]`);
      group.forEach(radio => {
        if (radio !== el) {
          radio.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
    }

    const success = el.checked === targetState;

    return {
      ok: success,
      type: el.type,
      name: el.name,
      value: el.value,
      checked: el.checked,
      changed: el.checked !== originalState,
      groupSize: isRadio && el.name ? document.querySelectorAll(`input[type="radio"][name="${el.name}"]`).length : 1
    };
  }

  if (a === "navigate") {
    const method = payload.method || "auto";

    // Handle history navigation
    if (method === "history") {
      const direction = payload.direction;
      if (direction === "back") {
        window.history.back();
        return { ok: true, action: "history_back" };
      } else if (direction === "forward") {
        window.history.forward();
        return { ok: true, action: "history_forward" };
      } else {
        return { ok: false, error: "Invalid history direction. Use 'back' or 'forward'" };
      }
    }

    // Handle link/form navigation
    if (!el && (payload.id || payload.selector || payload.text)) {
      el = findTarget(payload);
    }

    if (!el) {
      return { ok: false, error: "No navigation target found" };
    }

    // Determine navigation method based on element type
    const tagName = el.tagName ? el.tagName.toLowerCase() : "";

    if (tagName === "a") {
      // Link navigation
      const href = el.href || el.getAttribute("href");
      const target = el.target || payload.target || "_self";

      if (href) {
        if (target === "_blank") {
          window.open(href, "_blank");
          return { ok: true, action: "link_new_tab", href, target };
        } else {
          window.location.assign(href);
          return { ok: true, action: "link_navigate", href };
        }
      } else {
        // Link without href, treat as button
        el.click();
        return { ok: true, action: "link_click" };
      }

    } else if (tagName === "form") {
      // Form submission
      el.submit();
      return { ok: true, action: "form_submit" };

    } else if (["button", "input"].includes(tagName) && el.type === "submit") {
      // Submit button
      el.click();
      return { ok: true, action: "submit_click" };

    } else if (tagName === "input" && el.type === "image") {
      // Image input
      el.click();
      return { ok: true, action: "image_input_click" };

    } else {
      // Generic clickable element
      el.click();
      return { ok: true, action: "element_click" };
    }
  }

  // Enhanced focus action
  if (a === "focus") {
    if (!el) return { ok: false, error: "No element found to focus" };

    el.scrollIntoView({ behavior: "auto", block: "center", inline: "center" });
    await new Promise(resolve => setTimeout(resolve, 100));

    try {
      el.focus();
      return { ok: true, focused: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  // Enhanced submit action
  if (a === "submit") {
    let form = null;
    const method = payload.method || "auto";

    if (el) {
      if (el.tagName.toLowerCase() === "form") {
        form = el;
      } else {
        form = el.form || el.closest("form");
      }
    }

    if (!form) {
      // Find any form on the page
      form = document.querySelector("form");
    }

    if (!form) {
      return { ok: false, error: "No form found to submit" };
    }

    try {
      if (method === "button" || !el) {
        // Click submit button
        const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
        if (submitBtn) {
          submitBtn.click();
        } else {
          form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        }
      } else if (method === "form") {
        // Submit form directly
        form.submit();
      } else {
        // Auto method - try requestSubmit first, fallback to submit
        if (typeof form.requestSubmit === "function") {
          form.requestSubmit();
        } else {
          form.submit();
        }
      }

      try { window.__hb_submitted = "true"; } catch { }
      return { ok: true, method };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  // Enhanced press action
  if (a === "press") {
    const key = payload.key;
    const modifiers = payload.modifiers || [];

    if (!key) {
      return { ok: false, error: "No key specified" };
    }

    // Determine target element
    let target = el;
    if (!target) {
      target = document.activeElement || document.body;
    }

    try {
      const mods = {
        ctrlKey: modifiers.some(m => m.toLowerCase().includes("ctrl")),
        shiftKey: modifiers.some(m => m.toLowerCase().includes("shift")),
        altKey: modifiers.some(m => m.toLowerCase().includes("alt")),
        metaKey: modifiers.some(m => m.toLowerCase().includes("meta"))
      };

      const code = key === "Enter" ? "Enter" : key;
      const keyEventInit = { key, code, bubbles: true, cancelable: true, ...mods, view: window };

      // Helper to dispatch with legacy properties
      const dispatchKey = (type) => {
        const e = new KeyboardEvent(type, keyEventInit);
        // Try to define legacy properties if possible
        try { Object.defineProperty(e, 'keyCode', { get: () => key === "Enter" ? 13 : 0 }); } catch { }
        try { Object.defineProperty(e, 'which', { get: () => key === "Enter" ? 13 : 0 }); } catch { }
        target.dispatchEvent(e);
      };

      dispatchKey("keydown");
      dispatchKey("keypress");
      dispatchKey("keyup");

      let submitted = false;
      if (String(key).toLowerCase() === "enter") {
        const form = (target && (target.form || (target.closest && target.closest("form")))) || document.querySelector("form");
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

  return { ok: false, error: `Unknown action: ${a}` };
}

function handleCopy(payload, sendResponse) {
  try {
    let targets = [];
    const maxLength = payload.maxLength || 10000;

    if (payload.all) {
      // Find all matching elements
      if (payload.selector) {
        targets = Array.from(document.querySelectorAll(payload.selector));
      } else if (payload.xpath) {
        const result = document.evaluate(payload.xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        for (let i = 0; i < result.snapshotLength; i++) {
          targets.push(result.snapshotItem(i));
        }
      } else {
        // Find all elements matching text
        const allElements = document.querySelectorAll("*");
        const searchText = (payload.text || payload.source || "").toLowerCase();
        for (const el of allElements) {
          const elText = (el.innerText || el.textContent || "").toLowerCase();
          if (elText.includes(searchText)) {
            targets.push(el);
          }
        }
      }
    } else {
      // Find single target
      let target = findTarget(payload);
      if (!target && payload.text) target = findTarget({ text: payload.text });
      if (!target && payload.source) target = findTarget({ text: payload.source });
      targets = target ? [target] : [];
    }

    if (targets.length === 0) {
      sendResponse({ ok: false, error: "No elements found to copy" });
      return;
    }

    let copiedContent = "";

    for (const target of targets) {
      let content = "";

      switch (payload.type) {
        case "value":
          if (target.tagName && ["input", "textarea", "select"].includes(target.tagName.toLowerCase())) {
            content = target.value || "";
          }
          break;

        case "html":
          content = target.outerHTML || "";
          break;

        case "table":
          if (target.tagName === "TABLE") {
            content = extractTableContent(target, payload.format);
          } else {
            content = target.innerText || target.textContent || "";
          }
          break;

        case "list":
          if (["UL", "OL"].includes(target.tagName)) {
            content = extractListContent(target, payload.format);
          } else {
            content = target.innerText || target.textContent || "";
          }
          break;

        case "attribute":
          if (payload.attribute) {
            content = target.getAttribute(payload.attribute) || "";
          }
          break;

        case "text":
        default:
          if (target.isContentEditable) {
            content = target.innerText || target.textContent || "";
          } else if (target.tagName && ["input", "textarea"].includes(target.tagName.toLowerCase())) {
            content = target.value || "";
          } else {
            content = target.innerText || target.textContent || "";
          }
          break;
      }

      // Apply formatting
      if (payload.format === "markdown" && payload.type === "table") {
        // Already handled in extractTableContent
      }

      // Accumulate content
      if (copiedContent) copiedContent += "\n\n";
      copiedContent += content;

      // Break if we're approaching max length
      if (copiedContent.length >= maxLength * 0.9) break;
    }

    // Truncate if needed
    if (copiedContent.length > maxLength) {
      copiedContent = copiedContent.substring(0, maxLength - 3) + "...";
    }

    // Copy to clipboard
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(copiedContent)
        .then(() => sendResponse({
          ok: true,
          copied: copiedContent,
          length: copiedContent.length,
          elements: targets.length,
          type: payload.type
        }))
        .catch(() => {
          fallbackCopy(copiedContent);
          sendResponse({
            ok: true,
            copied: copiedContent,
            length: copiedContent.length,
            elements: targets.length,
            type: payload.type
          });
        });
    } else {
      fallbackCopy(copiedContent);
      sendResponse({
        ok: true,
        copied: copiedContent,
        length: copiedContent.length,
        elements: targets.length,
        type: payload.type
      });
    }
  } catch (error) {
    sendResponse({ ok: false, error: error.message });
  }
}

function extractTableContent(table, format) {
  if (format === "markdown") {
    const rows = Array.from(table.rows);
    if (rows.length === 0) return "";

    let markdown = "";

    // Header row
    const headers = Array.from(rows[0].cells).map(cell => cell.textContent.trim());
    markdown += "| " + headers.join(" | ") + " |\n";
    markdown += "|" + headers.map(() => "---").join("|") + "|\n";

    // Data rows
    for (let i = 1; i < rows.length; i++) {
      const cells = Array.from(rows[i].cells).map(cell => cell.textContent.trim());
      markdown += "| " + cells.join(" | ") + " |\n";
    }

    return markdown;
  } else {
    // Plain text table
    const rows = Array.from(table.rows);
    let text = "";

    for (const row of rows) {
      const cells = Array.from(row.cells).map(cell => cell.textContent.trim());
      text += cells.join("\t") + "\n";
    }

    return text;
  }
}

function extractListContent(list, format) {
  const items = Array.from(list.children).filter(child => child.tagName === "LI");
  let content = "";

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const marker = list.tagName === "OL" ? `${i + 1}. ` : "• ";
    content += marker + item.textContent.trim() + "\n";
  }

  return content;
}

function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;opacity:0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try { document.execCommand("copy"); } catch { }
  document.body.removeChild(ta);
}

function handlePaste(payload, sendResponse) {
  try {
    let target = findTarget(payload);
    if (!target && payload.text) target = findTarget({ text: payload.text });
    if (!target) target = document.activeElement || document.querySelector("input,textarea,[contenteditable='true']");

    if (!target) {
      sendResponse({ ok: false, error: "No target element found for pasting" });
      return;
    }

    // Handle verify mode
    if (payload.verifyOnly) {
      let currentContent = "";
      if (target.isContentEditable) {
        currentContent = target.innerText || target.textContent || "";
      } else if (target.tagName && ["input", "textarea"].includes(target.tagName.toLowerCase())) {
        currentContent = target.value || "";
      }

      const expectedContent = payload.expectedContent || "";
      const pasted = payload.append ?
        currentContent.includes(expectedContent) :
        currentContent === expectedContent;

      sendResponse({ pasted, currentContent, expectedContent });
      return;
    }

    const doPaste = async (text) => {
      if (!text) {
        sendResponse({ ok: false, error: "No text to paste" });
        return;
      }

      const append = payload.append !== false;
      const clearFirst = payload.clearFirst || false;
      const simulate = payload.simulate !== false;
      const delay = payload.delay || 50;

      try {
        // Focus the target element
        target.focus();
        target.scrollIntoView({ behavior: "auto", block: "center", inline: "center" });

        let originalContent = "";
        if (target.isContentEditable) {
          originalContent = target.innerText || target.textContent || "";
        } else if (target.tagName && ["input", "textarea"].includes(target.tagName.toLowerCase())) {
          originalContent = target.value || "";
        }

        if (clearFirst && !append) {
          if (target.isContentEditable) {
            target.innerHTML = "";
          } else if (target.tagName && ["input", "textarea"].includes(target.tagName.toLowerCase())) {
            target.value = "";
          }
        }

        if (simulate) {
          // Simulate typing the pasted text
          const finalText = append ? (originalContent + text) : text;

          if (target.isContentEditable) {
            // For contentEditable, insert text at cursor or replace all
            if (clearFirst || !append) {
              target.innerHTML = "";
            }
            document.execCommand && document.execCommand("insertText", false, text);
          } else if (target.tagName && ["input", "textarea"].includes(target.tagName.toLowerCase())) {
            target.value = finalText;
            target.dispatchEvent(new Event("input", { bubbles: true }));
          }

          // Simulate keyboard events for paste
          target.dispatchEvent(new ClipboardEvent("paste", {
            bubbles: true,
            clipboardData: new DataTransfer()
          }));
          target.dispatchEvent(new ClipboardEvent("paste", {
            bubbles: true,
            clipboardData: (() => {
              const dt = new DataTransfer();
              dt.setData("text/plain", text);
              return dt;
            })()
          }));

        } else {
          // Direct paste using clipboard API simulation
          const finalText = append ? (originalContent + text) : text;

          if (target.isContentEditable) {
            if (clearFirst || !append) {
              target.innerHTML = "";
            }
            document.execCommand && document.execCommand("insertText", false, text);
          } else if (target.tagName && ["input", "textarea"].includes(target.tagName.toLowerCase())) {
            target.value = finalText;
            target.dispatchEvent(new Event("input", { bubbles: true }));
          } else {
            // For other elements, dispatch paste event
            const pasteEvent = new ClipboardEvent("paste", {
              bubbles: true,
              cancelable: true,
              clipboardData: (() => {
                const dt = new DataTransfer();
                dt.setData("text/plain", text);
                return dt;
              })()
            });
            target.dispatchEvent(pasteEvent);
          }
        }

        // Dispatch change event
        target.dispatchEvent(new Event("change", { bubbles: true }));

        // Store paste info for verification
        payload.expectedContent = append ? (originalContent + text) : text;

        sendResponse({
          ok: true,
          pasted: text,
          length: text.length,
          append,
          simulate,
          targetType: target.isContentEditable ? "contentEditable" :
            (target.tagName ? target.tagName.toLowerCase() : "unknown")
        });

      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    };

    // Get text to paste
    if (payload.value) {
      // Use provided value directly
      doPaste(payload.value);
    } else {
      // Read from clipboard
      if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText()
          .then(text => doPaste(text))
          .catch(error => sendResponse({ ok: false, error: "Clipboard access denied: " + error.message }));
      } else {
        sendResponse({ ok: false, error: "Clipboard API not available" });
      }
    }
  } catch (error) {
    sendResponse({ ok: false, error: error.message });
  }
}

if (!window.__heybro_listener_added) {
  window.__heybro_listener_added = true;
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.t) return;

    if (msg.t === "ping") {
      sendResponse({ ok: true });
      return;
    }

    if (msg.t === "getPageState") {
      sendResponse({ state: getPageState() });
      return;
    }

    if (msg.t === "getTestState") {
      const out = {};
      try {
        out.name = document.getElementById("name")?.value || "";
        out.agree = !!document.getElementById("agree")?.checked;
        out.opt = document.getElementById("opt")?.value || "";
        out.lastEvent = document.getElementById("lastEvent")?.textContent || window.__hb_last_event || "";
        out.lastKey = document.getElementById("lastKey")?.textContent || window.__hb_last_key || "";
        out.submitted = document.getElementById("submitted")?.textContent || window.__hb_submitted || "";
        out.scrollY = scrollY;
      } catch { }
      sendResponse({ state: out });
      return;
    }

    if (msg.t === "getFormState") {
      sendResponse({ state: getFormState() });
      return;
    }

    if (msg.t === "probe") {
      const p = msg.payload || {};
      if (p && p.domStableMs) {
        const ms = Number(p.domStableMs) || 500;
        let last = Date.now();
        const obs = new MutationObserver(() => { last = Date.now(); });
        obs.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
        const check = () => {
          if (Date.now() - last >= ms) {
            obs.disconnect();
            const el = findTarget(p);
            let ok = !!el || (!p.selector && !p.text);
            if (ok && p.visible) ok = el ? isVisible(el) : ok;
            if (ok && p.clickable) ok = el ? isClickable(el) : ok;
            if (ok && p.attribute && p.attribute.name) {
              const v = el ? el.getAttribute(p.attribute.name) : null;
              ok = v != null;
              if (ok && p.attribute.value) ok = String(v).toLowerCase().includes(String(p.attribute.value).toLowerCase());
            }
            if (ok && p.textIncludes) {
              const t = el ? ((el.innerText || el.textContent || "")) : "";
              ok = String(t).toLowerCase().includes(String(p.textIncludes).toLowerCase());
            }
            sendResponse({ ok });
          } else {
            setTimeout(check, 100);
          }
        };
        setTimeout(check, 100);
        return true;
      }
      const el = findTarget(p);
      let ok = !!el || (!p.selector && !p.text);
      if (ok && p.visible) ok = el ? isVisible(el) : ok;
      if (ok && p.clickable) ok = el ? isClickable(el) : ok;
      if (ok && p.attribute && p.attribute.name) {
        const v = el ? el.getAttribute(p.attribute.name) : null;
        ok = v != null;
        if (ok && p.attribute.value) ok = String(v).toLowerCase().includes(String(p.attribute.value).toLowerCase());
      }
      if (ok && p.textIncludes) {
        const t = el ? ((el.innerText || el.textContent || "")) : "";
        ok = String(t).toLowerCase().includes(String(p.textIncludes).toLowerCase());
      }
      sendResponse({ ok });
      return;
    }

    if (msg.t === "simplify") {
      sendResponse({ elements: simplify(!!msg.annotate) });
      return;
    }

    if (msg.t === "execute") {
      const p = msg.payload || {};

      if (p.action === "new_tab") {
        const u = p.value || p.url;
        if (u && isTopWindow()) {
          chrome.runtime.sendMessage({ action: "OPEN_NEW_TAB", url: u }, (resp) => {
            sendResponse({ ok: true, newTabId: resp?.newTabId });
          });
          return true;
        }
      }

      if (p.action === "copy") {
        handleCopy(p, sendResponse);
        return true;
      }

      if (p.action === "paste") {
        handlePaste(p, sendResponse);
        return true;
      }

      execute(p).then(r => sendResponse(r)).catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
    }

    if (msg.t === "clear") {
      clearBadges();
      sendResponse({ ok: true });
      return;
    }

    if (msg.t === "working") {
      sendResponse({ ok: true });
      return;
    }

    if (msg.t === "setMode") {
      state.experimental = !!msg.experimental;
      sendResponse({ ok: true });
      return;
    }

    if (msg.t === "mapGlobal") {
      sendResponse({ elements: mapGlobal() });
      return;
    }

    if (msg.t === "mapCompact") {
      sendResponse({ elements: mapCompact() });
      return;
    }
  });
}

function loop() {
  updateBadges();
  requestAnimationFrame(loop);
}
loop();
