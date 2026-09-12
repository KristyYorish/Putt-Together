// netlify/functions/storage.mjs — shared storage for Putt Together
//
// Saves the shared lists with Netlify Blobs (built into Netlify, no setup
// needed). Available at /api/storage.
//   GET  /api/storage?key=putt-games-v1    -> { value }
//   PUT  /api/storage  { key, value, base } -> { ok: true }, or 409 if the list
//        changed since the browser last read it (the app then retries)
// Keys:
//   putt-games-v1  the posted games
//   putt-hides-v1  fingerprints of pairs of golfers who won't see each other's
//                  games (no names or ids, just short hex codes)

import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";

const MAX_CHARS = 3_000_000; // about 3 MB: room for a busy season of games, small photos included

const reply = (body, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

// Every game must look like one the app made, so a bad entry can't break the app for everyone.
const isText = (v, max = 300) => typeof v === "string" && v.length <= max;
// A person's picture: left out (their initial), an emoji, or a small JPEG the app shrank
const isAvatar = (a) =>
  a === undefined ||
  (a && typeof a === "object" &&
    (a.kind === "letter" ||
      (a.kind === "emoji" && isText(a.emoji, 16)) ||
      (a.kind === "photo" && isText(a.photo, 20000) && a.photo.startsWith("data:image/jpeg;base64,"))));
const isGame = (g) =>
  g && typeof g === "object" &&
  isText(g.id, 64) && isText(g.hostId, 64) && isText(g.course, 200) && isText(g.area, 200) &&
  ["pnp", "9", "18"].includes(g.type) && ["fun", "casual", "keen"].includes(g.vibe) &&
  /^\d{4}-\d{2}-\d{2}$/.test(g.date) && /^\d{2}:\d{2}$/.test(g.time) &&
  Number.isInteger(g.totalSpots) && g.totalSpots >= 1 && g.totalSpots <= 12 &&
  (g.meetAt === undefined || isText(g.meetAt, 500)) && (g.note === undefined || isText(g.note, 1000)) &&
  Array.isArray(g.players) && g.players.length <= g.totalSpots &&
  g.players.every((p) => p && isText(p.id, 64) && isText(p.name, 200) && isAvatar(p.avatar)) &&
  (g.messages === undefined || (Array.isArray(g.messages) && g.messages.length <= 50 &&
    g.messages.every((m) => m && isText(m.name, 200) && isText(m.text, 1000) && typeof m.at === "number")));
const isHide = (h) => typeof h === "string" && /^[0-9a-f]{16}$/.test(h);

const LISTS = {
  "putt-games-v1": { ok: (list) => list.every(isGame), error: "That doesn't look like a list of games." },
  "putt-hides-v1": { ok: (list) => list.length <= 50000 && list.every(isHide), error: "That doesn't look like a hide list." },
};

const fingerprint = (text) => (text == null ? "none" : createHash("sha256").update(text).digest("hex"));

export default async (req) => {
  const store = getStore({ name: "putt-together", consistency: "strong" });

  if (req.method === "GET") {
    const key = new URL(req.url).searchParams.get("key");
    if (!LISTS[key]) return reply({ error: "Unknown key." }, 400);
    const value = await store.get(key, { type: "text" });
    return reply({ value: value ?? null });
  }

  if (req.method === "PUT") {
    let body;
    try {
      body = await req.json();
    } catch {
      return reply({ error: "Send JSON." }, 400);
    }
    const { key, value, base } = body || {};
    if (!LISTS[key]) return reply({ error: "Unknown key." }, 400);
    if (typeof value !== "string" || value.length > MAX_CHARS) return reply({ error: "Invalid value." }, 400);
    try {
      const list = JSON.parse(value);
      if (!Array.isArray(list) || !LISTS[key].ok(list)) throw new Error();
    } catch {
      return reply({ error: LISTS[key].error }, 400);
    }

    const current = await store.getWithMetadata(key, { type: "text" });
    if (base !== undefined && fingerprint(current?.data) !== base) {
      return reply({ error: "The list changed. Reload and try again." }, 409);
    }

    // Only write if nothing changed between our check and this write.
    const options = current?.etag ? { onlyIfMatch: current.etag } : current ? {} : { onlyIfNew: true };
    const result = await store.set(key, value, options);
    if (result && result.modified === false) {
      // Refused. Check whether the list really changed before telling the app.
      const now = await store.get(key, { type: "text" });
      if (fingerprint(now) !== fingerprint(current?.data)) {
        return reply({ error: "The list changed. Reload and try again." }, 409);
      }
      await store.set(key, value);
    }
    return reply({ ok: true });
  }

  return reply({ error: "Method not allowed." }, 405);
};

export const config = { path: "/api/storage" };
