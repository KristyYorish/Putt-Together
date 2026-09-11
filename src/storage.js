// Storage for Putt Together on Netlify.
//
// The app calls window.storage.get / set / delete (the same shape as Claude's
// artifact storage). Here:
//   - personal data (your profile, text size) stays in this browser
//   - shared data (posted games) is saved on Netlify through /api/storage,
//     so everyone sees the same list
//
// Each save sends a fingerprint of the list as it was when we last read it.
// If someone else changed the list in the meantime, the server refuses the
// save, and the app re-reads and tries again, so nobody's change gets lost.

const SHARED_URL = "/api/storage";
const UNREADABLE = "unreadable"; // never matches, so a failed read can't lead to an overwrite

const lastSeen = {}; // key -> fingerprint of the shared value we last read or wrote
const memory = {}; // fallback when the browser blocks localStorage

async function fingerprint(text) {
  if (text == null) return "none";
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

const local = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return memory[key] ?? null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      memory[key] = value;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    delete memory[key];
  },
};

export function installStorage() {
  if (window.storage) return; // already running somewhere that provides storage

  window.storage = {
    async get(key, shared) {
      if (!shared) {
        const value = local.get(key);
        return value == null ? null : { key, value };
      }
      try {
        const res = await fetch(`${SHARED_URL}?key=${encodeURIComponent(key)}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`Storage read failed (${res.status})`);
        const { value } = await res.json();
        lastSeen[key] = await fingerprint(value);
        return value == null ? null : { key, value };
      } catch (err) {
        lastSeen[key] = UNREADABLE;
        throw err;
      }
    },

    async set(key, value, shared) {
      if (!shared) {
        local.set(key, value);
        return { key, value };
      }
      const res = await fetch(SHARED_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value, base: lastSeen[key] }),
      });
      if (res.status === 409) {
        lastSeen[key] = UNREADABLE;
        return null; // changed by someone else: the app re-reads and retries
      }
      if (!res.ok) throw new Error(`Storage save failed (${res.status})`);
      lastSeen[key] = await fingerprint(value);
      return { key, value };
    },

    async delete(key, shared) {
      if (shared) throw new Error("Shared items can't be deleted.");
      local.remove(key);
      return { key, deleted: true };
    },
  };
}
