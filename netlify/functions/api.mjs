// netlify/functions/api.mjs — Putt Together's server: sign-in, members, games
//
// Members sign in with their email address. We send them a link and a 6-digit
// code; tapping the link (or typing the code) signs them in. No passwords.
// Everything they do after that is tied to their account, not their browser,
// so the same person can use a phone and an iPad.
//
// Data lives in Netlify Blobs (built into Netlify, nothing to set up):
//   members    one record per member, by id
//   emails     email address (hashed) -> member id
//   logins     pending sign-in links and codes (good for 15 minutes)
//   sessions   signed-in devices (good for a year)
//   lists      the shared list of games, and the private list of who has hidden whom
//
// The sign-in email goes out through Resend (resend.com, free tier is plenty).
// In Netlify > Project configuration > Environment variables, add:
//   RESEND_API_KEY   your Resend API key
//   MAIL_FROM        the sender, e.g.  Putt Together <hello@mail.merchantsofplay.com>
//                    (an address on a domain you've verified in Resend)
// Until both are added, the app says sign-in email isn't set up yet.

import { createHash, randomBytes, randomInt } from "node:crypto";
import { getStore } from "@netlify/blobs";

const SESSION_DAYS = 365;
const LOGIN_MINUTES = 15;
const LOGINS_PER_HOUR = 5; // sign-in emails per address per hour
const CODE_ATTEMPTS = 5;
const KEEP_PAST_DAYS = 14; // past games stay this long so we can ask how they went
const ASK_AFTER_MINUTES = 90; // ask about a game this long after its tee time
const GAMES_KEY = "putt-games-v1";
const HIDES_KEY = "putt-hides-v2"; // pairs of member ids, "a|b" sorted. Never sent to browsers.
const COOKIE = "pt_session";

const AREAS = [
  "Metro Vancouver",
  "Fraser Valley",
  "Sea to Sky and Sunshine Coast",
  "Victoria and South Island",
  "Central and North Island",
  "Okanagan",
  "Thompson and Cariboo",
  "Kootenays",
  "Northern BC",
];
const TYPES = ["pnp", "9", "18"];
const VIBES = ["fun", "casual", "keen"];

// ---------- Small helpers ----------

const reply = (body, status = 200, headers = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

const store = (name) => getStore({ name, consistency: "strong" });
const hash = (s) => createHash("sha256").update(s).digest("hex");
const token = () => randomBytes(24).toString("hex");
const newId = () => "m" + randomBytes(9).toString("hex");
const normEmail = (e) => String(e || "").trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const isText = (v, max = 300) => typeof v === "string" && v.length <= max;
const clean = (v, max) => String(v ?? "").trim().slice(0, max);
const pairOf = (a, b) => [a, b].sort().join("|");

const isAvatar = (a) =>
  a === undefined ||
  a === null ||
  (a && typeof a === "object" &&
    (a.kind === "letter" ||
      (a.kind === "emoji" && isText(a.emoji, 16)) ||
      (a.kind === "photo" && isText(a.photo, 20000) && a.photo.startsWith("data:image/jpeg;base64,"))));
// What other members see of someone: their initial needs no data, so it's left out
const publicAvatar = (a) => (a && (a.kind === "emoji" || a.kind === "photo") ? a : undefined);
const asPlayer = (m) => ({ id: m.id, name: m.name, avatar: publicAvatar(m.avatar) });

const gameStart = (g) => {
  const [y, mo, d] = g.date.split("-").map(Number);
  const [h, mi] = g.time.split(":").map(Number);
  return new Date(y, mo - 1, d, h, mi).getTime();
};
const isUpcoming = (g) => gameStart(g) > Date.now() - 3 * 3600 * 1000;
const isOver = (g) => Date.now() > gameStart(g) + ASK_AFTER_MINUTES * 60 * 1000;
const keepGame = (g) => gameStart(g) > Date.now() - KEEP_PAST_DAYS * 86400000;

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
const sessionCookie = (sid) => `${COOKIE}=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
const clearedCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

async function readJson(req) {
  try {
    const v = await req.json();
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

// ---------- Members and sessions ----------

const getMember = async (id) => (id ? await store("members").get(id, { type: "json" }) : null);
const saveMember = (m) => store("members").setJSON(m.id, m);

async function currentMember(req) {
  const sid = parseCookies(req)[COOKIE];
  if (!sid || !/^[0-9a-f]{48}$/.test(sid)) return null;
  const s = await store("sessions").get(sid, { type: "json" });
  if (!s || s.exp < Date.now()) return null;
  return getMember(s.memberId);
}

// Everything about a member that the member's own app needs
const ownProfile = (m) => ({
  id: m.id,
  email: m.email,
  name: m.name || "",
  area: m.area || "",
  avatar: m.avatar,
  newsletter: !!m.newsletter,
  pictureAsked: !!m.pictureAsked,
  hidden: m.hidden || [],
  complete: !!(m.name && m.area),
});

// Finish a sign-in: find or create the member, start a session
async function completeLogin(rec) {
  const emailKey = hash(rec.email);
  let id = await store("emails").get(emailKey, { type: "text" });
  let m = id ? await getMember(id) : null;
  if (!m) {
    m = { id: newId(), email: rec.email, name: "", area: "", newsletter: false, newsletterSynced: false, hidden: [], answered: {}, skipped: [], createdAt: Date.now() };
    // Details this person entered before sign-in existed (kept in their browser) carry over
    const l = rec.legacy && typeof rec.legacy === "object" ? rec.legacy : null;
    if (l) {
      m.name = clean(l.name, 40);
      m.area = AREAS.includes(l.area) ? l.area : "";
      if (isAvatar(l.avatar) && l.avatar) m.avatar = l.avatar;
      m.newsletter = !!l.newsletter;
      m.newsletterSynced = !!l.newsletterSynced;
      m.pictureAsked = !!l.pictureAsked;
    }
    await store("emails").set(emailKey, m.id);
  }
  m.lastSeenAt = Date.now();
  await saveMember(m);
  const sid = token();
  await store("sessions").setJSON(sid, { memberId: m.id, exp: Date.now() + SESSION_DAYS * 86400000, createdAt: Date.now() });
  return { m, sid };
}

// ---------- The sign-in email ----------

async function sendLoginEmail({ email, link, code }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from) {
    console.error("Sign-in email isn't set up: add RESEND_API_KEY and MAIL_FROM in Netlify.");
    return { error: "Sign-in email isn't set up yet. The site owner needs to add the email settings in Netlify." };
  }
  const pretty = `${code.slice(0, 3)} ${code.slice(3)}`;
  const text = `Here's your Putt Together sign-in link:\n\n${link}\n\nOr type this code into the app: ${pretty}\n\nThe link and code work for ${LOGIN_MINUTES} minutes. If you didn't ask for this, you can ignore this email.`;
  const html = `
<div style="font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; font-size: 19px; line-height: 1.5; color: #17231E; max-width: 34em; margin: 0 auto; padding: 1.5em 1em;">
  <p style="font-size: 1.4em; font-weight: 700; color: #143426; margin: 0 0 .6em;">Putt Together</p>
  <p>Tap the button to sign in on this device.</p>
  <p style="margin: 1.2em 0;"><a href="${link}" style="display: inline-block; background: #1E4A36; color: #fff; text-decoration: none; font-weight: 700; padding: .8em 1.4em; border-radius: 10px;">Sign in to Putt Together</a></p>
  <p>Or, if you're opening the app somewhere else (your phone, say), type this code into it:</p>
  <p style="font-size: 2em; font-weight: 700; letter-spacing: .15em; margin: .3em 0 1em;">${pretty}</p>
  <p style="color: #4A5A53; font-size: .9em;">The link and code work for ${LOGIN_MINUTES} minutes. If you didn't ask for this, you can ignore this email.</p>
</div>`;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [email], subject: "Your Putt Together sign-in link", html, text }),
    });
    if (!r.ok) {
      console.error("Resend error", r.status, await r.text());
      return { error: "The sign-in email couldn't be sent. Try again in a minute." };
    }
    return { ok: true };
  } catch (err) {
    console.error(err);
    return { error: "The sign-in email couldn't be sent. Try again in a minute." };
  }
}

// ---------- Shared lists (games, hides) with safe concurrent updates ----------

async function readList(key) {
  const r = await store("lists").getWithMetadata(key, { type: "json" });
  return { list: Array.isArray(r?.data) ? r.data : [], etag: r?.etag, exists: !!r };
}

// Re-read, change, and write only if nobody else wrote in between (up to 4 tries)
async function mutateList(key, fn, tidy = (x) => x) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { list, etag, exists } = await readList(key);
    const result = fn(tidy(list));
    if (result.error) return result;
    const options = exists ? (etag ? { onlyIfMatch: etag } : {}) : { onlyIfNew: true };
    const w = await store("lists").setJSON(key, result.next, options);
    if (!w || w.modified !== false) return { ok: true, next: result.next, value: result.value };
  }
  return { error: "Lots of people are using the app right now. Try again in a moment." };
}

const readGames = async () => (await readList(GAMES_KEY)).list.filter(keepGame);
const mutateGames = (fn) => mutateList(GAMES_KEY, fn, (list) => list.filter(keepGame));
const readHides = async () => (await readList(HIDES_KEY)).list;
const mutateHides = (fn) => mutateList(HIDES_KEY, fn);

// What one member sees: upcoming games, minus games with anyone they've hidden or been
// hidden by. Games they're already in always stay, so a host can still cancel.
function visibleTo(games, m, hides) {
  const set = new Set(hides);
  return games.filter((g) => isUpcoming(g) && (g.players.some((p) => p.id === m.id) || !g.players.some((p) => set.has(pairOf(m.id, p.id)))));
}

// Past games to ask this member about, with the people they haven't answered for yet
function toAsk(games, m) {
  const answered = m.answered || {};
  const skipped = new Set(m.skipped || []);
  return games
    .filter((g) => !g.cancelled && isOver(g) && !skipped.has(g.id) && g.players.some((p) => p.id === m.id) && g.players.length > 1)
    .map((g) => ({
      id: g.id,
      course: g.course,
      date: g.date,
      time: g.time,
      players: g.players.filter((p) => p.id !== m.id && !answered[g.id]?.[p.id]).map(({ id, name, avatar }) => ({ id, name, avatar })),
    }))
    .filter((g) => g.players.length > 0)
    .sort((a, b) => gameStart(a) - gameStart(b));
}

async function gamesPayload(m, games) {
  const list = games || (await readGames());
  const hides = await readHides();
  return { games: visibleTo(list, m, hides), toAsk: toAsk(list, m) };
}

function validateGame(f) {
  const e = {};
  const g = {
    course: clean(f.course, 200),
    type: f.type,
    area: f.area,
    date: String(f.date || ""),
    time: String(f.time || ""),
    totalSpots: Number(f.totalSpots),
    teeBooked: !!f.teeBooked,
    vibe: f.vibe,
    meetAt: clean(f.meetAt, 500),
    note: clean(f.note, 1000),
  };
  if (!g.course) e.course = "Enter the course name.";
  if (!TYPES.includes(g.type)) e.type = "Choose the type of golf.";
  if (!AREAS.includes(g.area)) e.area = "Choose an area.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(g.date)) e.date = "Pick a date.";
  if (!/^\d{2}:\d{2}$/.test(g.time)) e.time = "Pick a tee time.";
  if (!e.date && !e.time && gameStart(g) < Date.now()) e.date = "That date and time has already passed. Pick one in the future.";
  if (!Number.isInteger(g.totalSpots) || g.totalSpots < 2 || g.totalSpots > 8) e.totalSpots = "Choose the size of the group.";
  if (!VIBES.includes(g.vibe)) e.vibe = "Choose the pace.";
  if (!g.meetAt) e.meetAt = "Tell people where to meet.";
  return { g, errors: e };
}

// ---------- Routes ----------

export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");
  const method = req.method;

  // Browsers only send our cookie on same-site requests, and every write here is JSON,
  // so a form on someone else's site can't act as a member.
  const site = req.headers.get("sec-fetch-site");
  if (method !== "GET" && site && site !== "same-origin" && site !== "none") return reply({ error: "Not allowed." }, 403);

  // ----- Sign in -----

  if (path === "/api/login" && method === "POST") {
    const body = await readJson(req);
    const email = normEmail(body.email);
    if (!validEmail(email)) return reply({ error: "Enter an email address like name@example.com." }, 400);

    const logins = store("logins");
    const rlKey = "rl-" + hash(email);
    const rl = (await logins.get(rlKey, { type: "json" })) || { n: 0, since: Date.now() };
    if (Date.now() - rl.since > 3600 * 1000) Object.assign(rl, { n: 0, since: Date.now() });
    if (rl.n >= LOGINS_PER_HOUR) return reply({ error: "That's a lot of sign-in emails. Check your inbox (and junk folder), or try again in an hour." }, 429);

    const t = token();
    const code = String(randomInt(0, 1000000)).padStart(6, "0");
    const rec = { email, code, exp: Date.now() + LOGIN_MINUTES * 60 * 1000, attempts: 0, legacy: body.legacy && typeof body.legacy === "object" ? body.legacy : null };
    const link = `${url.origin}/api/login/verify?token=${t}`;
    const sent = await sendLoginEmail({ email, link, code });
    if (sent.error) return reply({ error: sent.error }, 503);

    await logins.setJSON("t-" + t, rec);
    await logins.set("e-" + hash(email), t);
    await logins.setJSON(rlKey, { n: rl.n + 1, since: rl.since });
    return reply({ ok: true });
  }

  // Tapping the link in the email
  if (path === "/api/login/verify" && method === "GET") {
    const t = url.searchParams.get("token") || "";
    const logins = store("logins");
    const rec = /^[0-9a-f]{48}$/.test(t) ? await logins.get("t-" + t, { type: "json" }) : null;
    if (!rec || rec.exp < Date.now()) {
      return new Response(null, { status: 302, headers: { Location: `${url.origin}/?signin=expired`, "Cache-Control": "no-store" } });
    }
    const { sid } = await completeLogin(rec);
    await logins.delete("t-" + t);
    await logins.delete("e-" + hash(rec.email));
    return new Response(null, { status: 302, headers: { Location: `${url.origin}/?signin=done`, "Set-Cookie": sessionCookie(sid), "Cache-Control": "no-store" } });
  }

  // Typing the code from the email into the app
  if (path === "/api/login/code" && method === "POST") {
    const body = await readJson(req);
    const email = normEmail(body.email);
    const code = String(body.code || "").replace(/\D/g, "");
    const logins = store("logins");
    const t = validEmail(email) ? await logins.get("e-" + hash(email), { type: "text" }) : null;
    const rec = t ? await logins.get("t-" + t, { type: "json" }) : null;
    if (!rec || rec.exp < Date.now()) return reply({ error: "That code has expired. Ask for a new sign-in email." }, 400);
    if (rec.attempts >= CODE_ATTEMPTS) return reply({ error: "Too many tries. Ask for a new sign-in email." }, 429);
    if (code !== rec.code) {
      rec.attempts += 1;
      await logins.setJSON("t-" + t, rec);
      return reply({ error: "That code doesn't match. Check the email and try again." }, 400);
    }
    const { m, sid } = await completeLogin(rec);
    await logins.delete("t-" + t);
    await logins.delete("e-" + hash(email));
    return reply({ ok: true, member: ownProfile(m) }, 200, { "Set-Cookie": sessionCookie(sid) });
  }

  if (path === "/api/logout" && method === "POST") {
    const sid = parseCookies(req)[COOKIE];
    if (sid && /^[0-9a-f]{48}$/.test(sid)) await store("sessions").delete(sid);
    return reply({ ok: true }, 200, { "Set-Cookie": clearedCookie() });
  }

  // ----- Everything below needs a signed-in member -----

  const me = await currentMember(req);
  if (!me) return reply({ error: "Please sign in." }, 401);

  if (path === "/api/me" && method === "GET") {
    return reply({ member: ownProfile(me) });
  }

  if (path === "/api/me" && method === "PUT") {
    const body = await readJson(req);
    const errors = {};
    const next = { ...me };
    if ("name" in body) {
      next.name = clean(body.name, 40);
      if (!next.name) errors.name = "Enter the name you'd like other golfers to see.";
    }
    if ("area" in body) {
      next.area = body.area;
      if (!AREAS.includes(next.area)) errors.area = "Choose the area where you usually golf.";
    }
    if ("avatar" in body) {
      if (!isAvatar(body.avatar)) errors.avatar = "That picture didn't work. Try another one.";
      else next.avatar = body.avatar || undefined;
    }
    if ("newsletter" in body) next.newsletter = !!body.newsletter;
    if ("newsletterSynced" in body) next.newsletterSynced = !!body.newsletterSynced;
    if ("pictureAsked" in body) next.pictureAsked = !!body.pictureAsked;
    if (Object.keys(errors).length) return reply({ errors }, 400);
    await saveMember(next);
    // Your name and picture appear in games you're in, so keep those in step
    if (next.name !== me.name || JSON.stringify(publicAvatar(next.avatar)) !== JSON.stringify(publicAvatar(me.avatar))) {
      await mutateGames((list) => ({ next: list.map((g) => ({ ...g, players: g.players.map((p) => (p.id === me.id ? asPlayer(next) : p)) })) }));
    }
    return reply({ member: ownProfile(next) });
  }

  // ----- Games -----

  if (path === "/api/games" && method === "GET") {
    return reply(await gamesPayload(me));
  }

  if (path === "/api/games" && method === "POST") {
    if (!me.name || !me.area) return reply({ error: "Add your name and area first." }, 400);
    const { g, errors } = validateGame(await readJson(req));
    if (Object.keys(errors).length) return reply({ errors }, 400);
    const game = { ...g, id: "g" + randomBytes(8).toString("hex"), hostId: me.id, players: [asPlayer(me)], messages: [], createdAt: Date.now() };
    const res = await mutateGames((list) => ({ next: [...list, game] }));
    if (res.error) return reply({ error: res.error }, 409);
    return reply({ game, ...(await gamesPayload(me, res.next)) });
  }

  const gm = path.match(/^\/api\/games\/([A-Za-z0-9]+)\/(join|leave|cancel|message)$/);
  if (gm && method === "POST") {
    const [, id, action] = gm;
    const body = action === "message" ? await readJson(req) : {};
    const hides = action === "join" ? new Set(await readHides()) : null;
    const res = await mutateGames((list) => {
      const g = list.find((x) => x.id === id);
      if (!g) return { error: "That game is no longer listed." };
      const inGame = g.players.some((p) => p.id === me.id);
      const isHost = g.hostId === me.id;
      if (action === "join") {
        if (g.cancelled) return { error: "The host cancelled this game." };
        if (inGame) return { next: list };
        if (g.players.length >= g.totalSpots) return { error: "Someone just took the last spot. This game is now full." };
        if (g.players.some((p) => hides.has(pairOf(me.id, p.id)))) return { error: "That game isn't available." };
        return { next: list.map((x) => (x.id === id ? { ...x, players: [...x.players, asPlayer(me)] } : x)) };
      }
      if (action === "leave") {
        if (isHost) return { error: "Hosts can cancel the game instead of leaving it." };
        return { next: list.map((x) => (x.id === id ? { ...x, players: x.players.filter((p) => p.id !== me.id) } : x)) };
      }
      if (action === "cancel") {
        if (!isHost) return { error: "Only the host can cancel this game." };
        return { next: list.map((x) => (x.id === id ? { ...x, cancelled: true } : x)) };
      }
      // message
      if (!isHost && !inGame) return { error: "Join the game to message the group." };
      const text = clean(body.text, 300);
      if (!text) return { error: "Write a message first." };
      const msg = { id: "x" + randomBytes(6).toString("hex"), memberId: me.id, name: me.name, text, at: Date.now() };
      return { next: list.map((x) => (x.id === id ? { ...x, messages: [...(x.messages || []), msg].slice(-30) } : x)) };
    });
    if (res.error) return reply({ error: res.error }, 409);
    return reply(await gamesPayload(me, res.next));
  }

  // ----- After a game: "Would you play with them again?" -----

  if (path === "/api/answer" && method === "POST") {
    const body = await readJson(req);
    const answer = body.answer === "no" ? "no" : "yes";
    const games = await readGames();
    const g = games.find((x) => x.id === body.gameId);
    const other = g?.players.find((p) => p.id === body.playerId && p.id !== me.id);
    if (!g || !other || !g.players.some((p) => p.id === me.id)) return reply({ error: "That game isn't one you played." }, 400);
    const next = { ...me, answered: { ...(me.answered || {}), [g.id]: { ...((me.answered || {})[g.id] || {}), [other.id]: answer } } };
    if (answer === "no") {
      const pair = pairOf(me.id, other.id);
      const res = await mutateHides((list) => ({ next: list.includes(pair) ? list : [...list, pair] }));
      if (res.error) return reply({ error: res.error }, 409);
      next.hidden = [...(me.hidden || []).filter((h) => h.id !== other.id), { id: other.id, name: other.name, at: Date.now() }];
    }
    await saveMember(next);
    return reply({ member: ownProfile(next), ...(await gamesPayload(next, games)) });
  }

  if (path === "/api/skip" && method === "POST") {
    const body = await readJson(req);
    const next = { ...me, skipped: [...new Set([...(me.skipped || []), String(body.gameId || "")])].slice(-200) };
    await saveMember(next);
    return reply({ member: ownProfile(next), ...(await gamesPayload(next)) });
  }

  if (path === "/api/unhide" && method === "POST") {
    const body = await readJson(req);
    const other = (me.hidden || []).find((h) => h.id === body.playerId);
    if (!other) return reply({ error: "That golfer isn't hidden." }, 400);
    const pair = pairOf(me.id, other.id);
    const res = await mutateHides((list) => ({ next: list.filter((x) => x !== pair) }));
    if (res.error) return reply({ error: res.error }, 409);
    const next = { ...me, hidden: (me.hidden || []).filter((h) => h.id !== other.id) };
    await saveMember(next);
    return reply({ member: ownProfile(next), ...(await gamesPayload(next)) });
  }

  return reply({ error: "Not found." }, 404);
};

export const config = {
  path: ["/api/login", "/api/login/verify", "/api/login/code", "/api/logout", "/api/me", "/api/games", "/api/games/:id/:action", "/api/answer", "/api/skip", "/api/unhide"],
};
