// Talks to Putt Together's server (netlify/functions/api.mjs) and keeps a
// couple of small things in this browser (text size, and the details people
// entered before sign-in existed, so they carry over).
//
// Members are signed in with a cookie the server sets; the browser sends it
// automatically, so nothing here handles passwords or tokens.

const memory = {}; // fallback when the browser blocks localStorage

export const localStore = {
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

async function call(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { error: "Couldn't reach Putt Together. Check your internet connection and try again.", offline: true };
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok) {
    const firstFieldError = data.errors && typeof data.errors === "object" ? Object.values(data.errors)[0] : null;
    return {
      ...data,
      error: data.error || firstFieldError || (res.status === 401 ? "Please sign in." : "Something went wrong. Try again."),
      errors: data.errors,
      status: res.status,
    };
  }
  return data;
}

export const api = {
  requestLink: (email, legacy) => call("/api/login", { method: "POST", body: { email, legacy } }),
  signInWithCode: (email, code) => call("/api/login/code", { method: "POST", body: { email, code } }),
  signOut: () => call("/api/logout", { method: "POST", body: {} }),
  me: () => call("/api/me"),
  updateMe: (fields) => call("/api/me", { method: "PUT", body: fields }),
  games: () => call("/api/games"),
  postGame: (game) => call("/api/games", { method: "POST", body: game }),
  gameAction: (id, action, body = {}) => call(`/api/games/${encodeURIComponent(id)}/${action}`, { method: "POST", body }),
  answer: (gameId, playerId, answer) => call("/api/answer", { method: "POST", body: { gameId, playerId, answer } }),
  skip: (gameId) => call("/api/skip", { method: "POST", body: { gameId } }),
  unhide: (playerId) => call("/api/unhide", { method: "POST", body: { playerId } }),
  contact: (fields) => call("/api/contact", { method: "POST", body: fields }),
};
