
export function log(x) {
  console.log(x);
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function sanitizeUrl(u) {
  if (!u) return u;
  let s = String(u).trim();
  s = s.replace(/^`+|`+$/g, "").trim();
  s = s.replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "").trim();
  return s;
}

export function hostFromUrl(u) {
  try {
    const s = sanitizeUrl(u);
    if (!s) return "";
    const url = s.match(/^[a-zA-Z][a-zA-Z0-9]*:/) ? new URL(s) : new URL("https://" + s);
    return (url.hostname || "").replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function extractJson(s) {
  try { return JSON.parse(s); } catch {}
  const fence = s.match(/```json[\s\S]*?```/i);
  if (fence) {
    const inner = fence[0].replace(/```json/i, "").replace(/```/g, "").trim();
    try { return JSON.parse(inner); } catch {}
  }
  let depth = 0, start = -1;
  for (let idx = 0; idx < s.length; idx++) {
    const ch = s[idx];
    if (ch === '{') {
      if (depth === 0) start = idx;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        const sub = s.slice(start, idx + 1);
        try { return JSON.parse(sub); } catch {}
        start = -1;
      }
    }
  }
  return null;
}

export function extractTargetDomain(text) {
  const t = String(text || "").toLowerCase();
  const dm = t.match(/\b([a-z0-9-]+\.(?:com|in|net|org|io|ai|app|dev|store|shop|co|me|tv|info))\b/);
  return dm ? dm[1].replace(/^www\./, "") : "";
}
