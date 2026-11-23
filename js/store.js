// localStorage wrapper: every access is try/catch'd, with an in-memory fallback.
const mem = new Map();
let ls = null;
try { ls = window.localStorage; ls.setItem('lg.__t', '1'); ls.removeItem('lg.__t'); } catch (e) { ls = null; }

export function get(key, fallback = null) {
  try {
    const raw = ls ? ls.getItem(key) : mem.get(key);
    if (raw === null || raw === undefined) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    try { const raw = mem.get(key); if (raw != null) return JSON.parse(raw); } catch (e2) { /* ignore */ }
    return fallback;
  }
}
export function set(key, value) {
  const raw = JSON.stringify(value);
  mem.set(key, raw);
  try { if (ls) ls.setItem(key, raw); } catch (e) { /* quota/private mode: memory copy kept */ }
}
export function remove(key) {
  mem.delete(key);
  try { if (ls) ls.removeItem(key); } catch (e) { /* ignore */ }
}
export function isPersistent() { return !!ls; }
