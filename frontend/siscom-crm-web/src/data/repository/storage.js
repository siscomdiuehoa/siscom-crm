// Storage adapter. Today: browser localStorage. Later: replace with an HTTP/API adapter exposing the same get/set/remove/keys contract.
export const storage = {
  get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
  set(key, value) {
    try { localStorage.setItem(key, value); return { ok: true }; }
    catch (e) { return { ok: false, error: e && e.name === 'QuotaExceededError' ? 'quota' : String(e && e.message || e) }; }
  },
  remove(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } },
  keys() { try { return Object.keys(localStorage); } catch (e) { return []; } },
};
