import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { COURSES } from "./courses.js";
import { api, localStore } from "./storage.js";

/*
  PUTT TOGETHER — find people to golf with across BC

  Members sign in with their email address (a link or a 6-digit code, no
  password). The server, netlify/functions/api.mjs, keeps members and games
  and only shows each member the games they should see. src/storage.js is the
  thin layer that talks to it.

  Newsletter (Beehiiv): sign-ups go through netlify/functions/subscribe.mjs so
  the API key never lives in browser code. Add BEEHIIV_API_KEY and
  BEEHIIV_PUBLICATION_ID in Netlify's environment variables to switch it on.

  Contact us: the small link at the bottom of every screen. Notes go through
  the server (POST /api/contact) to Syavash's inbox.

  Look: black and green with cream. Sora for text, Space Grotesk for headings.
*/
const NEWSLETTER_ENDPOINT = "/api/subscribe";
const CONTACT_EMAIL = "savyorish@gmail.com"; // shown under the contact form; the server does the sending

// ---------- Reference data ----------

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

const TYPES = { pnp: "Pitch & putt", "9": "9 holes", "18": "18 holes" };
const TYPE_ORDER = ["pnp", "9", "18"]; // shortest round first (object keys would put the numbers first)
const typeOptions = (withAny) => [...(withAny ? [{ value: "any", label: "Any" }] : []), ...TYPE_ORDER.map((value) => ({ value, label: TYPES[value] }))];

const VIBES = {
  fun: { label: "Just for fun", hint: "no pressure on the score" },
  casual: { label: "Casual", hint: "we keep score but nobody sweats it" },
  keen: { label: "Keen", hint: "playing to our handicaps" },
};

// Where to meet: the choices when you host. Pitch & putts usually have a check-in desk, not a pro shop.
const MEET_REST = ["Clubhouse entrance", "First tee", "Putting green", "Parking lot", "Check group messages on the day"];
const meetChoices = (type) =>
  type === "pnp" ? ["Check-in desk / ticket booth", "Outside the pro shop", ...MEET_REST] : ["Outside the pro shop", "Check-in desk / ticket booth", ...MEET_REST];
const defaultMeet = (type) => (type === "pnp" ? "Check-in desk / ticket booth" : "Outside the pro shop");

// Course list lives in src/courses.js. People can still type any course name.
const courseKey = (name) => name.trim().toLowerCase();
const COURSE_BY_NAME = new Map(COURSES.map((c) => [courseKey(c.name), c]));
const findCourse = (name) => COURSE_BY_NAME.get(courseKey(name || ""));
// The longest round a course offers, used to pre-fill "Type of golf"
const bestType = (c) => (c.types.includes("18") ? "18" : c.types.includes("9") ? "9" : "pnp");
const byName = (a, b) => a.name.replace(/^The /, "").localeCompare(b.name.replace(/^The /, ""));

const LEGACY_PROFILE_KEY = "putt-profile-v1"; // details entered before sign-in existed, kept in this browser
const TEXT_KEY = "putt-textsize-v1"; // personal
const EMAIL_KEY = "putt-email-v1"; // the address you last signed in with, to save typing

// Pictures: the default is your initial. These are the emoji choices.
const EMOJIS = ["⛳", "🏌️", "🌲", "🍁", "☀️", "🌈", "🐻", "🦅", "🦆", "🐦", "🌊", "⛰️", "☕", "🍺", "🐕", "🌷"];
const PHOTO_SIZE = 120; // photos are shrunk to this many pixels square before they're saved

async function subscribeToNewsletter({ email, firstName, area }) {
  if (!NEWSLETTER_ENDPOINT) return false;
  try {
    const res = await fetch(NEWSLETTER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, firstName, area }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------- Helpers ----------

const pad = (n) => String(n).padStart(2, "0");
const toISODate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDate = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const gameStart = (g) => {
  const d = parseDate(g.date);
  const [h, mi] = (g.time || "00:00").split(":").map(Number);
  d.setHours(h, mi, 0, 0);
  return d;
};
const hasStarted = (g) => gameStart(g).getTime() <= Date.now();
const fmtTime = (t) => {
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${pad(m)} ${h >= 12 ? "PM" : "AM"}`;
};
const fmtLongDate = (s) =>
  parseDate(s).toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" });
const relDay = (s) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((parseDate(s) - today) / 86400000);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  return null;
};
const fmtWhen = (at) =>
  new Date(at).toLocaleString("en-CA", { weekday: "short", hour: "numeric", minute: "2-digit" });
const displayName = (p) => (p.name || "").trim();
const firstName = (name) => (name || "").trim().split(/\s+/)[0].replace(/\.$/, "");
// Details saved in this browser before sign-in existed. Older ones have firstName and lastInitial.
function legacyProfile() {
  try {
    const p = JSON.parse(localStore.get(LEGACY_PROFILE_KEY) || "null");
    if (!p || typeof p !== "object") return null;
    if (p.name) return p;
    const first = (p.firstName || "").trim();
    return { ...p, name: p.lastInitial ? `${first} ${p.lastInitial.toUpperCase()}` : first };
  } catch {
    return null;
  }
}
const initials = (name) =>
  name
    .replace(".", "")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());
const joinNames = (names) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

// ----- Pictures -----

// A person's picture: { kind: "letter" } (their initial), { kind: "emoji", emoji }, or { kind: "photo", photo } (a small data URL)
const avatarOf = (p) => (p?.avatar && (p.avatar.kind === "emoji" || p.avatar.kind === "photo") ? p.avatar : { kind: "letter" });

// Shrinks a photo to a small square in the browser, so the list of games stays quick to load.
async function shrinkPhoto(file) {
  if (!file || !file.type.startsWith("image/")) throw new Error("Choose a photo file, like a JPG or PNG.");
  let img;
  try {
    img = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    img = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const el = new Image();
      el.onload = () => {
        URL.revokeObjectURL(url);
        resolve(el);
      };
      el.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("That photo couldn't be opened. Try a JPG or PNG."));
      };
      el.src = url;
    });
  }
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const side = Math.min(w, h);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = PHOTO_SIZE;
  canvas.getContext("2d").drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
  if (img.close) img.close();
  return canvas.toDataURL("image/jpeg", 0.8);
}

function validateDetails(v) {
  const e = {};
  if (!v.name.trim()) e.name = "Enter the name you'd like other golfers to see.";
  if (!v.area) e.area = "Choose the area where you usually golf.";
  return e;
}

// ---------- Styles ----------
// Black (#0F0F0F) and card grey (#202020), neon green (#5DD62C) for what matters, cream (#F8F8F8) text.
// Sizes are in em so the "Larger text" button scales the whole app.

const css = `
.pt {
  --bg: #0F0F0F; --card: #202020; --accent: #5DD62C; --accent-hover: #4CC01F; --green: #337418; --text: #F8F8F8;
  --t85: rgba(248,248,248,.85); --t80: rgba(248,248,248,.8); --t70: rgba(248,248,248,.7); --t60: rgba(248,248,248,.6);
  --t55: rgba(248,248,248,.55); --t50: rgba(248,248,248,.5); --t45: rgba(248,248,248,.45); --t40: rgba(248,248,248,.4); --t35: rgba(248,248,248,.35);
  --line: rgba(248,248,248,.06); --line2: rgba(248,248,248,.12); --line3: rgba(248,248,248,.16);
  --display: "Space Grotesk", system-ui, sans-serif;
  --r: 22px;
  font-family: "Sora", system-ui, sans-serif;
  font-size: 16px; line-height: 1.5; color: var(--text); background: var(--bg);
  min-height: 100vh; position: relative; color-scheme: dark;
}
.pt.large { font-size: 19px; }
.pt::before { content: ""; position: absolute; top: -160px; left: 0; right: 0; height: 620px; z-index: 0; pointer-events: none;
  background: radial-gradient(circle 480px at 50% 50%, rgba(93,214,44,.22), rgba(93,214,44,0) 62%); }
.pt *, .pt *::before, .pt *::after { box-sizing: border-box; }
.pt h1, .pt h2, .pt h3 { font-family: var(--display); font-weight: 700; margin: 0; line-height: 1.15; color: var(--text); }
.pt h1 { font-size: 2.067em; line-height: 1.04; letter-spacing: -.005em; }
.pt h2 { font-size: 1.2em; }
.pt h3 { font-size: 1.05em; }
.pt p { margin: 0; }
.pt a { color: var(--accent); }
.pt a:hover { color: var(--text); }
.pt :focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.pt .eyebrow { display: block; font-family: var(--display); font-weight: 500; font-size: .733em; letter-spacing: .16em; color: var(--t45); }
.lede { color: var(--t60); font-size: .933em; max-width: 34em; }
.lede .free { display: block; margin-top: 6px; color: var(--accent); font-weight: 600; }
.muted { color: var(--t50); }
.small { font-size: .833em; }
.accent { color: var(--accent); }
.stack { display: grid; gap: 8px; }
.stack-lg { display: grid; gap: 16px; }

/* Header */
.top { position: sticky; top: 0; z-index: 30; backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); background: rgba(15,15,15,.78); border-bottom: 1px solid rgba(248,248,248,.07); }
.top-inner { max-width: 560px; margin: 0 auto; padding: 14px 20px 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
.mark { width: 30px; height: 30px; border-radius: 10px; background: var(--accent); display: grid; place-items: center; flex: none; }
.mark::after { content: ""; width: 9px; height: 9px; border-radius: 50%; background: var(--bg); display: block; }
.mark.big { width: 34px; height: 34px; border-radius: 11px; }
.mark.big::after { width: 10px; height: 10px; }
.wordmark { font-family: var(--display); font-weight: 700; font-size: 1.133em; letter-spacing: .01em; line-height: 1; white-space: nowrap; }
.wordmark.big { font-size: 1.267em; }
.top-actions { display: flex; align-items: center; gap: 8px; flex: none; }
.textsize { font: inherit; font-family: var(--display); font-weight: 700; font-size: .8em; min-height: 34px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--line3); background: transparent; color: var(--t70); cursor: pointer; white-space: nowrap; }
.textsize:hover { border-color: var(--text); color: var(--text); }
.textsize[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); background: rgba(93,214,44,.12); }
.textsize .short { display: none; }
.mebtn { width: 34px; height: 34px; border-radius: 50%; border: 1px solid rgba(93,214,44,.5); background: var(--card); color: var(--accent); font: inherit; font-weight: 600; font-size: .8em; cursor: pointer; flex: none; display: grid; place-items: center; padding: 0; overflow: hidden; }
.mebtn:hover { border-color: var(--accent); }
.mebtn img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mebtn .em { font-size: 1.3em; line-height: 1; }
.tabs { max-width: 560px; margin: 0 auto; padding: 12px 20px 14px; display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; }
.tabs::-webkit-scrollbar { display: none; }
.tab { flex: none; font: inherit; font-weight: 500; font-size: .867em; padding: 9px 15px; border-radius: 999px; border: 0; background: var(--card); color: var(--t60); cursor: pointer; white-space: nowrap; }
.tab:hover { color: var(--text); }
.tab[aria-current="page"] { background: var(--accent); color: var(--bg); font-weight: 600; }

/* Page */
.wrap { position: relative; z-index: 1; max-width: 560px; margin: 0 auto; padding: 22px 20px 40px; display: grid; gap: 22px; }
.wrap.narrow { max-width: 460px; padding: 40px 24px 40px; gap: 28px; }
.steps { margin: 0; padding: 0; list-style: none; display: grid; gap: 12px; counter-reset: s; }
.steps li { counter-increment: s; display: flex; gap: 12px; align-items: flex-start; font-size: .933em; color: var(--t80); }
.steps li::before { content: counter(s); width: 24px; height: 24px; flex: none; border-radius: 8px; background: rgba(93,214,44,.14); border: 1px solid rgba(93,214,44,.35); color: var(--accent); font-size: .8em; font-weight: 700; display: grid; place-items: center; margin-top: 1px; }
.steps strong { color: var(--text); font-weight: 600; }

/* Cards and rows */
.card { background: var(--card); border: 1px solid var(--line); border-radius: var(--r); padding: 18px; display: grid; gap: 16px; }
.card.pad { padding: 20px; gap: 18px; }
.card.center { text-align: center; justify-items: center; padding: 26px 20px; gap: 14px; }
.card.faded { opacity: .7; }
.inset { background: var(--bg); border-radius: 16px; padding: 14px; display: grid; gap: 10px; }
.row { display: flex; justify-content: space-between; gap: 12px; font-size: .867em; align-items: center; }
.row > :first-child { color: var(--t50); flex: none; }
.row > :last-child { font-weight: 600; text-align: right; min-width: 0; overflow-wrap: anywhere; }
.plus { width: 44px; height: 44px; border-radius: 50%; background: rgba(93,214,44,.14); color: var(--accent); display: grid; place-items: center; font-size: 1.33em; font-weight: 600; }
.banner { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-radius: 14px; background: rgba(51,116,24,.28); border: 1px solid rgba(93,214,44,.25); font-size: .867em; color: var(--t85); }
.listhead { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; font-size: .833em; color: var(--t50); }

/* Fields */
.field { display: grid; gap: 7px; border: 0; margin: 0; padding: 0; min-width: 0; }
.label { font-size: .833em; font-weight: 600; color: var(--t55); letter-spacing: .02em; padding: 0; }
.hint { font-size: .8em; color: var(--t40); }
.error { font-size: .833em; color: var(--accent); font-weight: 600; }
.pt input[type=text], .pt input[type=email], .pt input[type=date], .pt input[type=time], .pt select, .pt textarea {
  font: inherit; font-size: .933em; width: 100%; min-height: 48px; padding: 0 14px; border-radius: 14px; border: 1px solid var(--line2); background: var(--bg); color: var(--text); color-scheme: dark;
}
.pt select { cursor: pointer; }
.pt select option { background: var(--card); color: var(--text); }
.pt textarea { padding: 12px 14px; min-height: 5.5em; resize: vertical; line-height: 1.45; }
.pt input::placeholder, .pt textarea::placeholder { color: var(--t35); }
.pt input:focus, .pt select:focus, .pt textarea:focus { outline: none; border-color: var(--accent); }
.pt [aria-invalid="true"] { border-color: var(--accent); }
.pt .onpage { background: var(--card); font-weight: 500; }
.two { display: flex; gap: 12px; flex-wrap: wrap; }
.two > * { flex: 1 1 46%; min-width: 140px; }
.code { max-width: 9em; letter-spacing: .18em; font-family: var(--display); font-size: 1.3em !important; font-weight: 700; text-align: center; }

/* Pills and tiles */
.pills { display: flex; gap: 8px; flex-wrap: wrap; }
.pill { font: inherit; font-weight: 500; font-size: .833em; padding: 8px 14px; border-radius: 999px; border: 1px solid rgba(248,248,248,.14); background: transparent; color: var(--t60); cursor: pointer; white-space: nowrap; }
.pill:hover:not(:disabled) { border-color: rgba(248,248,248,.4); color: var(--text); }
.pill[aria-pressed="true"] { background: rgba(93,214,44,.14); border-color: var(--accent); color: var(--accent); font-weight: 600; }
.pill:disabled { opacity: .5; cursor: default; }
.tiles { display: flex; gap: 8px; flex-wrap: wrap; }
.tile { flex: 1 1 30%; font: inherit; font-weight: 500; font-size: .867em; padding: 12px 8px; border-radius: 14px; background: var(--bg); border: 1px solid rgba(248,248,248,.1); color: var(--t60); cursor: pointer; text-align: center; }
.tile:hover { color: var(--text); border-color: rgba(248,248,248,.3); }
.tile[aria-pressed="true"] { background: rgba(93,214,44,.14); border-color: var(--accent); color: var(--accent); font-weight: 600; }
.tiles.stacked { display: grid; }
.tiles.stacked .tile { text-align: left; padding: 13px 15px; }
.tile b { display: block; font-weight: 600; font-size: 1.04em; color: var(--text); }
.tile[aria-pressed="true"] b { color: var(--accent); }
.tile span { display: block; font-size: .96em; color: var(--t50); margin-top: 2px; font-weight: 500; }
.tile[aria-pressed="true"] span { color: var(--t60); }
.check { position: relative; display: flex; gap: 12px; align-items: flex-start; cursor: pointer; font-size: .867em; color: var(--t70); line-height: 1.45; }
.check input { position: absolute; opacity: 0; width: 1px; height: 1px; margin: 0; }
.check .box { width: 22px; height: 22px; flex: none; border-radius: 7px; border: 1px solid rgba(248,248,248,.2); display: grid; place-items: center; margin-top: 1px; color: var(--bg); font-size: .9em; font-weight: 700; line-height: 1; }
.check input:checked + .box { background: var(--accent); border-color: var(--accent); }
.check input:checked + .box::after { content: "✓"; }
.check input:focus-visible + .box { outline: 2px solid var(--accent); outline-offset: 2px; }
.check .free { color: var(--accent); font-weight: 700; }

/* Buttons */
.btn { font: inherit; font-weight: 700; font-size: .967em; min-height: 52px; padding: 0 22px; border-radius: 14px; border: 0; background: var(--accent); color: var(--bg); cursor: pointer; width: 100%; }
.btn:hover:not(:disabled) { background: var(--accent-hover); }
.btn.secondary { background: transparent; border: 1px solid var(--line3); color: var(--t80); font-weight: 600; font-size: .933em; min-height: 46px; }
.btn.secondary:hover:not(:disabled) { border-color: var(--text); color: var(--text); background: transparent; }
.btn.cream { background: var(--text); color: var(--bg); }
.btn.cream:hover:not(:disabled) { background: #fff; }
.btn.quiet { background: rgba(248,248,248,.05); color: var(--t70); font-weight: 600; font-size: .867em; min-height: 42px; }
.btn.quiet:hover:not(:disabled) { color: var(--text); background: rgba(248,248,248,.08); }
.btn.sm { min-height: 42px; font-size: .867em; padding: 0 16px; width: auto; border-radius: 12px; }
.btn:disabled { background: rgba(248,248,248,.04); border: 1px solid rgba(248,248,248,.08); color: var(--t35); cursor: not-allowed; }
.linkbtn { font: inherit; font-size: .833em; font-weight: 600; background: none; border: 0; padding: 4px 0; color: var(--t50); text-decoration: underline; cursor: pointer; justify-self: start; text-align: left; }
.linkbtn:hover:not(:disabled) { color: var(--accent); }
.linkbtn.accent { color: var(--accent); text-decoration: none; }
.linkbtn.accent:hover:not(:disabled) { color: var(--text); }
.linkbtn:disabled { cursor: default; opacity: .6; }
.status { display: flex; align-items: center; gap: 8px; font-size: .867em; color: var(--accent); font-weight: 600; }
.status::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); flex: none; }
.actions { display: grid; gap: 8px; }

/* Game cards */
.game-head { display: flex; gap: 14px; align-items: flex-start; }
.datebox { width: 58px; flex: none; border-radius: 16px; background: var(--bg); border: 1px solid rgba(248,248,248,.08); padding: 9px 0; text-align: center; }
.datebox .dow, .datebox .mon { font-size: .7em; font-weight: 600; letter-spacing: .1em; color: var(--t50); text-transform: uppercase; line-height: 1.3; }
.datebox .dnum { font-family: var(--display); font-weight: 700; font-size: 1.467em; line-height: 1.1; color: var(--accent); }
.game-title { min-width: 0; flex: 1; display: grid; gap: 7px; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; }
.tag { padding: 3px 9px; border-radius: 999px; background: rgba(248,248,248,.07); color: rgba(248,248,248,.72); font-size: .733em; font-weight: 600; letter-spacing: .04em; }
.tag.open { background: rgba(93,214,44,.16); border: 1px solid rgba(93,214,44,.35); color: var(--accent); }
.tag.dim { color: var(--t50); }
.tag.booked { background: var(--green); color: var(--text); }
.tag.note { background: rgba(51,116,24,.35); color: var(--text); }
.meta { font-size: .9em; color: rgba(248,248,248,.62); }
.hostnote { padding-left: 12px; border-left: 2px solid var(--accent); font-size: .9em; color: rgba(248,248,248,.78); }
.group { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.group-label { font-size: .833em; color: var(--t50); }
.group-names { font-size: .833em; color: var(--t60); }
.seats { display: flex; align-items: center; padding-right: 8px; }
.seats .ball { margin-right: -8px; box-shadow: 0 0 0 2px var(--card); }
.ball { width: 34px; height: 34px; border-radius: 50%; background: var(--green); color: var(--text); font-size: .767em; font-weight: 600; display: grid; place-items: center; flex: none; line-height: 1; }
.ball.you { background: var(--accent); color: var(--bg); font-weight: 700; }
.ball.open { background: var(--bg); border: 1px dashed rgba(93,214,44,.6); color: var(--accent); font-size: 1em; }
.ball.emoji { background: var(--bg); border: 1px solid rgba(248,248,248,.12); font-size: 1.05em; }
.ball.emoji.you { border-color: var(--accent); background: rgba(93,214,44,.14); }
.ball.photo { overflow: hidden; background: var(--card); }
.ball.photo.you { outline: 2px solid var(--accent); outline-offset: -2px; }
.ball img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ball.lg { width: 48px; height: 48px; font-size: 1em; }
.ball.lg.emoji { font-size: 1.5em; }
.msgs { display: grid; gap: 10px; }
.msg { display: grid; gap: 3px; }
.msg-head { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.msg-name { font-weight: 600; font-size: .833em; color: var(--accent); }
.msg-at { font-size: .733em; color: var(--t40); }
.msg p { font-size: .9em; color: var(--t80); overflow-wrap: anywhere; }
.compose { display: flex; gap: 8px; }
.compose input { background: var(--card); min-height: 44px; border-radius: 12px; font-size: .9em; }
.compose .btn { width: auto; min-height: 44px; padding: 0 16px; border-radius: 12px; font-size: .867em; flex: none; }

/* People, pictures */
.people { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.people li { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.person-name { font-weight: 600; flex: 1; min-width: 6em; overflow-wrap: anywhere; font-size: .933em; }
.pick { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.emojis { display: grid; grid-template-columns: repeat(auto-fill, minmax(48px, 1fr)); gap: 6px; }
.emojis button { font: inherit; font-size: 1.4em; line-height: 1; min-height: 48px; border-radius: 12px; border: 1px solid rgba(248,248,248,.1); background: var(--bg); cursor: pointer; }
.emojis button[aria-pressed="true"] { border-color: var(--accent); background: rgba(93,214,44,.14); }

/* My games */
.stats { display: flex; gap: 10px; }
.stat { flex: 1; background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 16px; }
.stat b { display: block; font-family: var(--display); font-weight: 700; font-size: 1.733em; color: var(--accent); line-height: 1; }
.stat span { display: block; font-size: .833em; color: var(--t55); margin-top: 4px; }
.news { background: linear-gradient(140deg, #337418, #0F0F0F 78%); border: 1px solid rgba(93,214,44,.25); border-radius: var(--r); padding: 20px; display: grid; gap: 12px; }
.news h2 { font-size: 1.267em; }
.news p { font-size: .9em; color: var(--t80); }
.news .check { color: var(--t85); }

/* Courses */
.course { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 16px 18px; display: grid; gap: 12px; }
.course h3 { font-size: 1.033em; line-height: 1.2; }
.course-city { font-size: .833em; color: var(--t50); margin-top: 4px; }
.course-actions { display: flex; gap: 8px; flex-wrap: wrap; }

/* Footer, toast, dialogs */
.foot { position: relative; z-index: 1; max-width: 560px; margin: 0 auto; padding: 0 20px 100px; display: grid; gap: 10px; justify-items: center; text-align: center; }
.foot p { font-size: .8em; color: var(--t40); text-wrap: pretty; max-width: 36em; }
.foot .linkbtn { justify-self: center; font-size: .767em; font-weight: 500; color: rgba(248,248,248,.38); letter-spacing: .02em; }
.notice { position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%); z-index: 60; width: min(420px, calc(100% - 32px)); background: var(--accent); color: var(--bg); border-radius: 16px; padding: 14px 18px; display: flex; gap: 14px; align-items: center; box-shadow: 0 18px 40px rgba(0,0,0,.5); }
.notice p { flex: 1; font-size: .9em; font-weight: 600; }
.notice button { font: inherit; border: 0; background: rgba(15,15,15,.12); color: var(--bg); font-weight: 700; font-size: .833em; border-radius: 10px; padding: 8px 12px; min-height: 40px; cursor: pointer; }
.notice.error { background: var(--card); color: var(--text); border: 1px solid var(--accent); }
.notice.error button { background: var(--accent); color: var(--bg); }
.overlay { position: fixed; inset: 0; z-index: 70; background: rgba(15,15,15,.72); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); display: grid; place-items: center; padding: 20px; overflow: auto; }
.dialog { width: min(460px, 100%); background: var(--card); border: 1px solid rgba(248,248,248,.08); border-radius: 24px; padding: 22px; display: grid; gap: 16px; max-height: calc(100vh - 40px); overflow: auto; }
.dialog h2 { font-size: 1.4em; line-height: 1.1; }
.dialog-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
.xbtn { width: 32px; height: 32px; flex: none; border-radius: 10px; border: 1px solid rgba(248,248,248,.14); background: transparent; color: rgba(248,248,248,.65); font: inherit; font-size: .933em; cursor: pointer; }
.xbtn:hover { color: var(--text); border-color: var(--text); }
.dialog-actions { display: grid; gap: 8px; }
.dialog .body { font-size: .933em; color: var(--t80); display: grid; gap: 12px; }
.quote { display: grid; gap: 10px; padding: 16px; border-radius: 18px; background: var(--bg); border-left: 2px solid var(--accent); }
.quote p { font-size: .9em; color: rgba(248,248,248,.82); line-height: 1.55; }
.quote .tagline { color: var(--accent); font-weight: 600; }
@media (prefers-reduced-motion: no-preference) {
  .dialog { animation: pop .18s ease-out; }
  @keyframes pop { from { transform: translateY(8px); opacity: 0; } to { transform: none; opacity: 1; } }
}

@media (max-width: 430px) {
  .pt h1 { font-size: 1.8em; }
  .top-inner { padding: 12px 14px 0; }
  .tabs { padding: 10px 14px 12px; gap: 6px; }
  .tab { flex: 1 1 auto; padding: 8px 7px; font-size: .8em; text-align: center; }
  .pt.large .tabs { display: grid; grid-template-columns: repeat(2, 1fr); }
  .wrap { padding: 18px 14px 32px; gap: 18px; }
  .wrap.narrow { padding: 32px 18px 32px; gap: 24px; }
  .card { padding: 16px; }
  .card.pad { padding: 18px 16px; }
  .datebox { width: 52px; }
  .game-head { gap: 12px; }
  .textsize { padding: 0 10px; }
  .textsize .long { display: none; }
  .textsize .short { display: inline; }
  .foot { padding: 0 14px 100px; }
}
`;

// ---------- Small components ----------

function Brand({ big }) {
  return (
    <div className="brand">
      <span className={`mark${big ? " big" : ""}`} aria-hidden="true" />
      <span className={`wordmark${big ? " big" : ""}`}>Putt Together</span>
    </div>
  );
}

function TextSizeButton({ large, onToggle }) {
  return (
    <button className="textsize" aria-pressed={large} aria-label="Larger text" title="Larger text" onClick={onToggle}>
      <span className="long">{large ? "Regular text" : "Larger text"}</span>
      <span className="short" aria-hidden="true">
        Aa
      </span>
    </button>
  );
}

function Field({ id, label, hint, error, children }) {
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint && <p className="hint">{hint}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

// A row of round buttons where one is chosen (filters, small choices)
function Pills({ id, label, ariaLabel, options, value, onChange }) {
  return (
    <div className="field">
      {label && (
        <span className="label" id={id}>
          {label}
        </span>
      )}
      <div className="pills" role="group" aria-labelledby={label ? id : undefined} aria-label={label ? undefined : ariaLabel}>
        {options.map((o) => (
          <button type="button" key={String(o.value)} className="pill" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// Bigger boxes for the choices on the Host form
function Tiles({ id, label, options, value, onChange, stacked, error }) {
  return (
    <div className="field">
      <span className="label" id={id}>
        {label}
      </span>
      <div className={`tiles${stacked ? " stacked" : ""}`} role="group" aria-labelledby={id}>
        {options.map((o) => (
          <button type="button" key={String(o.value)} className="tile" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
            {o.hint ? (
              <>
                <b>{o.label}</b>
                <span>{o.hint}</span>
              </>
            ) : (
              o.label
            )}
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function Check({ checked, onChange, children }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="box" aria-hidden="true" />
      <span>{children}</span>
    </label>
  );
}

// A person's picture: their initial, an emoji, or a small photo
function Ball({ person, you, lg }) {
  const a = avatarOf(person);
  return (
    <span className={`ball${you ? " you" : ""}${lg ? " lg" : ""}${a.kind !== "letter" ? ` ${a.kind}` : ""}`} aria-hidden="true" title={person.name}>
      {a.kind === "photo" ? <img src={a.photo} alt="" /> : a.kind === "emoji" ? a.emoji : initials(person.name || "")}
    </span>
  );
}

function AvatarPicker({ name, value, onChange }) {
  const a = avatarOf({ avatar: value });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const pickFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      onChange({ kind: "photo", photo: await shrinkPhoto(file) });
    } catch (err) {
      setError(err.message || "That photo didn't work. Try another one.");
    }
    setBusy(false);
  };

  return (
    <div className="field">
      <span className="label" id="pic-label">
        Your picture
      </span>
      <div className="pick">
        <Ball person={{ name, avatar: a }} lg />
        <div className="pills" role="group" aria-labelledby="pic-label">
          <button type="button" className="pill" aria-pressed={a.kind === "letter"} onClick={() => onChange({ kind: "letter" })}>
            My initial
          </button>
          <button
            type="button"
            className="pill"
            aria-pressed={a.kind === "emoji"}
            onClick={() => onChange({ kind: "emoji", emoji: a.kind === "emoji" ? a.emoji : EMOJIS[0] })}
          >
            An emoji
          </button>
          <button type="button" className="pill" aria-pressed={a.kind === "photo"} onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? "One moment…" : a.kind === "photo" ? "A different photo" : "A photo"}
          </button>
        </div>
      </div>
      {a.kind === "emoji" && (
        <div className="emojis" role="group" aria-label="Choose an emoji">
          {EMOJIS.map((e) => (
            <button type="button" key={e} aria-pressed={a.emoji === e} onClick={() => onChange({ kind: "emoji", emoji: e })} aria-label={`Emoji ${e}`}>
              {e}
            </button>
          ))}
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickFile} aria-label="Choose a photo" />
      <p className="hint">Shown next to your name so people recognize you at the course. Your initial is fine too.</p>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function DetailsFields({ v, set, errors, withPicture }) {
  const up = (k) => (e) => set({ ...v, [k]: e.target.value });
  return (
    <>
      <Field id="name" label="Your name" hint="What other golfers will see." error={errors.name}>
        <input
          id="name"
          type="text"
          maxLength={40}
          autoComplete="nickname"
          placeholder="A first name, a nickname, whatever you like"
          value={v.name}
          onChange={up("name")}
          aria-invalid={!!errors.name}
        />
      </Field>
      {withPicture && <AvatarPicker name={v.name} value={v.avatar} onChange={(avatar) => set({ ...v, avatar })} />}
      <Field id="area" label="Where do you usually golf?" error={errors.area}>
        <select id="area" value={v.area} onChange={up("area")} aria-invalid={!!errors.area}>
          <option value="">Choose an area</option>
          {AREAS.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      </Field>
    </>
  );
}

function Dialog({ d, busy, onClose, onConfirm }) {
  const confirmRef = useRef(null);
  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
        <h2 id="dlg-title">{d.title}</h2>
        <div className="body">{d.body}</div>
        <div className="dialog-actions">
          <button ref={confirmRef} className={`btn${d.danger ? " cream" : ""}`} onClick={onConfirm} disabled={busy}>
            {busy ? "One moment…" : d.confirmLabel}
          </button>
          <button className="btn secondary" onClick={onClose} disabled={busy}>
            Go back
          </button>
        </div>
      </div>
    </div>
  );
}

// The Contact us form: a note straight to Syavash
function ContactDialog({ me, legacy, onClose, onSent }) {
  const [v, setV] = useState({ name: me?.name || legacy?.name || "", email: me?.email || localStore.get(EMAIL_KEY) || legacy?.email || "", message: "" });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState("");
  const [mailto, setMailto] = useState("");
  const [busy, setBusy] = useState(false);
  const msgRef = useRef(null);
  const up = (k) => (e) => {
    setV({ ...v, [k]: e.target.value });
    setErrors({});
    setError("");
  };

  useEffect(() => {
    // Straight to the message box on a desktop. On a phone, let people read the note first.
    if (window.matchMedia?.("(min-width: 700px)").matches) msgRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const send = async () => {
    const e = {};
    if (!validEmail(v.email)) e.email = "Enter an email address like name@example.com, so Syavash can write back.";
    if (!v.message.trim()) e.message = "Add a note so he knows what you'd like.";
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    const res = await api.contact({ name: v.name.trim(), email: v.email.trim(), message: v.message.trim() });
    setBusy(false);
    if (res.error) {
      if (res.errors) setErrors(res.errors);
      else setError(res.error);
      if (res.mailto) setMailto(res.mailto);
      return;
    }
    onSent();
  };

  const subject = encodeURIComponent("Putt Together");
  const body = encodeURIComponent(`${v.message.trim()}\n\n${v.name.trim()}`);

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="contact-title">
        <div className="dialog-head">
          <h2 id="contact-title">Contact us</h2>
          <button className="xbtn" onClick={onClose} aria-label="Close" disabled={busy}>
            ✕
          </button>
        </div>
        <div className="quote">
          <p>Hey, I'm Syavash, just a guy looking to golf. Built this app to make finding golf buddies a little easier. Have a feature or feedback let me know!</p>
          <p className="tagline">Pitch and putt or a full round, let's get out there!</p>
        </div>
        <Field id="c-name" label="Your name">
          <input id="c-name" type="text" maxLength={60} autoComplete="name" value={v.name} onChange={up("name")} />
        </Field>
        <Field id="c-email" label="Your email" error={errors.email}>
          <input id="c-email" type="email" inputMode="email" autoComplete="email" value={v.email} onChange={up("email")} aria-invalid={!!errors.email} />
        </Field>
        <Field id="c-msg" label="Feature or feedback" error={errors.message}>
          <textarea
            ref={msgRef}
            id="c-msg"
            rows={4}
            maxLength={2000}
            placeholder="What would make this easier for you?"
            value={v.message}
            onChange={up("message")}
            aria-invalid={!!errors.message}
          />
        </Field>
        {error && (
          <p className="error">
            {error}
            {mailto && (
              <>
                {" "}
                You can email{" "}
                <a href={`mailto:${mailto}?subject=${subject}&body=${body}`}>{mailto}</a> directly instead.
              </>
            )}
          </p>
        )}
        <button className="btn" onClick={send} disabled={busy}>
          {busy ? "Sending…" : "Send it"}
        </button>
        <p className="hint" style={{ textAlign: "center" }}>
          Goes straight to {CONTACT_EMAIL}
        </p>
      </div>
    </div>
  );
}

// ---------- Game card ----------

function GroupMessages({ game, onPost }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const msgs = game.messages || [];
  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    const ok = await onPost(game, text.trim());
    setSending(false);
    if (ok) setText("");
  };
  return (
    <>
      <button className="btn quiet" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? "Hide group messages" : `Group messages (${msgs.length})`}
      </button>
      {open && (
        <div className="inset">
          {msgs.length === 0 ? (
            <p className="hint">No messages yet. Say hello, or let people know if you're running late.</p>
          ) : (
            <div className="msgs">
              {msgs.map((m) => (
                <div className="msg" key={m.id}>
                  <div className="msg-head">
                    <span className="msg-name">{m.name}</span>
                    <span className="msg-at">{fmtWhen(m.at)}</span>
                  </div>
                  <p>{m.text}</p>
                </div>
              ))}
            </div>
          )}
          <div className="compose">
            <input
              type="text"
              aria-label="Write a message"
              placeholder="Say hello, or say you're running late"
              maxLength={300}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
            />
            <button className="btn" onClick={send} disabled={sending || !text.trim()}>
              {sending ? "…" : "Send"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function GameCard({ game, me, onJoin, onLeave, onCancel, onPostMessage }) {
  const d = parseDate(game.date);
  const inGame = game.players.some((p) => p.id === me.id);
  const isHost = game.hostId === me.id;
  const open = game.totalSpots - game.players.length;
  const seats = Array.from({ length: game.totalSpots }, (_, i) => game.players[i] || null);
  const rel = relDay(game.date);
  const started = hasStarted(game);
  const host = game.players.find((p) => p.id === game.hostId) || game.players[0];
  const hostName = host ? (host.id === me.id ? "you" : host.name) : "";
  const others = game.players.filter((p) => p.id !== me.id && p.id !== host?.id).map((p) => p.name);

  return (
    <article className={`card${game.cancelled ? " faded" : ""}`} aria-label={`${game.course}, ${fmtLongDate(game.date)}`}>
      <div className="game-head">
        <div className="datebox" aria-hidden="true">
          <div className="dow">{d.toLocaleDateString("en-CA", { weekday: "short" })}</div>
          <div className="dnum">{d.getDate()}</div>
          <div className="mon">{d.toLocaleDateString("en-CA", { month: "short" })}</div>
        </div>
        <div className="game-title">
          <div className="tags">
            <span className="tag">{TYPES[game.type]}</span>
            {game.cancelled ? (
              <span className="tag dim">Cancelled by the host</span>
            ) : started ? (
              <span className="tag dim">Teed off</span>
            ) : open > 0 ? (
              <span className="tag open">
                {open} open {open === 1 ? "spot" : "spots"}
              </span>
            ) : (
              <span className="tag dim">Full</span>
            )}
            {game.teeBooked && <span className="tag booked">Tee booked</span>}
          </div>
          <h2>{game.course}</h2>
          <p className="meta">
            {fmtLongDate(game.date)} · {fmtTime(game.time)}
            {rel && ` · ${rel}`}
          </p>
        </div>
      </div>

      <div className="inset">
        <div className="row">
          <span>Pace</span>
          <span>
            {VIBES[game.vibe].label} — {VIBES[game.vibe].hint}
          </span>
        </div>
        <div className="row">
          <span>Meet</span>
          <span>{game.meetAt}</span>
        </div>
        <div className="row">
          <span>Area</span>
          <span>{game.area}</span>
        </div>
      </div>

      {game.note && <p className="hostnote">{game.note}</p>}

      <div className="group">
        <div className="seats" aria-hidden="true">
          {seats.map((p, i) =>
            p ? (
              <Ball key={p.id} person={p} you={p.id === me.id} />
            ) : (
              <span className="ball open" key={`open-${i}`}>
                +
              </span>
            )
          )}
        </div>
        <span className="group-label">
          {open > 0 ? `${game.players.length} in, ${open} to go` : "Group complete"}
          {hostName && ` · hosted by ${hostName}`}
        </span>
      </div>
      {others.length > 0 && <p className="group-names">Also in: {joinNames(others)}</p>}

      {!game.cancelled && (
        <div className="actions">
          {isHost ? (
            <>
              <p className="status">You're hosting this game</p>
              <button className="btn secondary" onClick={() => onCancel(game)}>
                Cancel this game
              </button>
            </>
          ) : inGame ? (
            <>
              <p className="status">You're in this game</p>
              <button className="btn secondary" onClick={() => onLeave(game)}>
                Leave this game
              </button>
            </>
          ) : started ? (
            <button className="btn" disabled>
              This game has teed off
            </button>
          ) : open > 0 ? (
            <button className="btn" onClick={() => onJoin(game)}>
              Join this game
            </button>
          ) : (
            <button className="btn" disabled>
              This game is full
            </button>
          )}
          {(isHost || inGame) && <GroupMessages game={game} onPost={onPostMessage} />}
        </div>
      )}
    </article>
  );
}

// ---------- Screens ----------

function Intro() {
  return (
    <>
      <div className="stack" style={{ gap: 12 }}>
        <h1 style={{ fontSize: "2.4em", lineHeight: 1.02, letterSpacing: "-.01em" }}>Find people to golf with in BC.</h1>
        <p className="lede" style={{ maxWidth: "30em" }}>
          Join a group heading to a pitch &amp; putt or a full course, or post your own tee time and let others fill the spots.
          <span className="free">It's free.</span>
        </p>
      </div>
      <ol className="steps">
        <li>
          <span>
            <strong>Tell us your area.</strong> We'll show games near you first.
          </span>
        </li>
        <li>
          <span>
            <strong>Pick a game with an open spot</strong>, or host your own.
          </span>
        </li>
        <li>
          <span>
            <strong>Meet at the course</strong> and play a round with new people.
          </span>
        </li>
      </ol>
    </>
  );
}

// Sign in with an email link or the 6-digit code from the same email. No passwords.
function SignIn({ onSignedIn, legacy, startNotice, large, onToggleText }) {
  const [email, setEmail] = useState(() => localStore.get(EMAIL_KEY) || legacy?.email || "");
  const [step, setStep] = useState("email"); // "email" -> "code"
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState(startNotice || "");
  const codeRef = useRef(null);

  const sendLink = async () => {
    const e = email.trim();
    if (!validEmail(e)) {
      setError("Enter an email address like name@example.com.");
      return;
    }
    setBusy(true);
    setError("");
    setNote("");
    const res = await api.requestLink(e, legacy || undefined);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    localStore.set(EMAIL_KEY, e);
    setStep("code");
    setTimeout(() => codeRef.current?.focus(), 50);
  };

  const useCode = async () => {
    const c = code.replace(/\D/g, "");
    if (c.length !== 6) {
      setError("Type the 6-digit code from the email.");
      return;
    }
    setBusy(true);
    setError("");
    const res = await api.signInWithCode(email.trim(), c);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    onSignedIn(res.member);
  };

  return (
    <main className="wrap narrow">
      <div className="top-inner" style={{ padding: 0 }}>
        <Brand big />
        <TextSizeButton large={large} onToggle={onToggleText} />
      </div>

      {step === "email" && <Intro />}

      {step === "email" ? (
        <section className="card pad" aria-labelledby="signin-h">
          <h2 id="signin-h" className="eyebrow">
            Sign in or join
          </h2>
          {note && <p className="status">{note}</p>}
          <Field id="email" label="Email address" hint="No password. We'll email you a link to tap, or a code to type." error={error}>
            <input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendLink()}
              aria-invalid={!!error}
            />
          </Field>
          <button className="btn" onClick={sendLink} disabled={busy}>
            {busy ? "Sending…" : "Email me a sign-in link"}
          </button>
          <p className="hint">New here? Same button. We'll ask for your name and area next. Your email stays private.</p>
        </section>
      ) : (
        <section className="card pad" aria-labelledby="code-h">
          <h2 id="code-h">Check your email</h2>
          <p className="lede">
            We sent a sign-in link to <strong style={{ color: "var(--text)", overflowWrap: "anywhere" }}>{email.trim()}</strong>. Tap the link in that
            email, or type the 6-digit code from it here.
          </p>
          <Field id="code" label="6-digit code" error={error}>
            <input
              ref={codeRef}
              id="code"
              className="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && useCode()}
              aria-invalid={!!error}
            />
          </Field>
          <button className="btn" onClick={useCode} disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <p className="hint">Can't find it? Check your junk folder. The link and code work for 15 minutes.</p>
          <button
            className="linkbtn"
            onClick={() => {
              setStep("email");
              setCode("");
              setError("");
            }}
          >
            Send another email, or use a different address
          </button>
        </section>
      )}
    </main>
  );
}

const NEWSLETTER_LINE = "Email me the Putt Together newsletter now and then, with group outings, local discounts, course updates and golf events around BC. Unsubscribe anytime.";

// First sign-in: the details other golfers see
function Welcome({ me, legacy, onDone, large, onToggleText }) {
  const [v, setV] = useState({ name: me.name || legacy?.name || "", area: me.area || legacy?.area || "" });
  const [newsletter, setNewsletter] = useState(!!(me.newsletter || legacy?.newsletter));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const e = validateDetails(v);
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    await onDone(v, newsletter);
    setSaving(false);
  };

  return (
    <main className="wrap narrow">
      <div className="top-inner" style={{ padding: 0 }}>
        <Brand big />
        <TextSizeButton large={large} onToggle={onToggleText} />
      </div>
      <div className="stack" style={{ gap: 12 }}>
        <span className="eyebrow">Almost there</span>
        <h1 style={{ fontSize: "2.4em", lineHeight: 1.02, letterSpacing: "-.01em" }}>A couple of details.</h1>
        <p className="lede">
          You're signed in as <span style={{ color: "var(--text)", overflowWrap: "anywhere" }}>{me.email}</span>.
        </p>
      </div>
      <section className="card pad" aria-labelledby="welcome-h">
        <h2 id="welcome-h" className="eyebrow">
          Get started
        </h2>
        <DetailsFields v={v} set={setV} errors={errors} />
        <Check checked={newsletter} onChange={setNewsletter}>
          {NEWSLETTER_LINE} <span className="free">It's free.</span>
        </Check>
        <button className="btn" onClick={submit} disabled={saving}>
          {saving ? "Saving…" : "Start finding games"}
        </button>
        <p className="hint">Other golfers see your name and area. Your email stays private.</p>
      </section>
    </main>
  );
}

// Shown once on Find a game until you pick a picture or say Not now
function PicturePanel({ me, onSave, onSkip }) {
  const [avatar, setAvatar] = useState(me.avatar);
  const [saving, setSaving] = useState(false);
  return (
    <section className="card" aria-labelledby="pic-h">
      <h2 id="pic-h">Add a picture?</h2>
      <AvatarPicker name={me.name} value={avatar} onChange={setAvatar} />
      <div className="actions">
        <button
          className="btn"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            await onSave(avatarOf({ avatar }));
            setSaving(false);
          }}
        >
          {saving ? "Saving…" : "Save my picture"}
        </button>
        <button className="linkbtn" onClick={onSkip}>
          Not now
        </button>
      </div>
    </section>
  );
}

// After a game, a private question about each person you played with
function HowDidItGo({ game, onAnswer, onSkip }) {
  const pending = game.players.filter((p) => !game.answered?.[p.id]);
  return (
    <section className="card" aria-labelledby="how-h">
      <div className="stack">
        <span className="eyebrow">After your round</span>
        <h2 id="how-h">How was your game at {game.course}?</h2>
        <p className="lede">{fmtLongDate(game.date)}. Would you play with them again? Your answers are private.</p>
      </div>
      <ul className="people">
        {pending.map((p) => (
          <li key={p.id}>
            <Ball person={p} lg />
            <span className="person-name">{p.name}</span>
            <div className="pills" role="group" aria-label={`Would you play with ${p.name} again?`}>
              <button className="pill" onClick={() => onAnswer(game, p, "yes")}>
                Yes, happily
              </button>
              <button className="pill" onClick={() => onAnswer(game, p, "no")}>
                Rather not
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className="hint">Rather not means the two of you won't see each other's games from now on. Nobody is told.</p>
      <button className="linkbtn" onClick={() => onSkip(game)}>
        Skip this
      </button>
    </section>
  );
}

function FindGames({ games, me, filters, setFilters, onRefresh, refreshing, goHost, cardProps, toAsk, askProps, showPicture, pictureProps }) {
  const live = games.filter((g) => !g.cancelled && !hasStarted(g));
  const list = live
    .filter(
      (g) =>
        (filters.area === "all" || g.area === filters.area) &&
        (filters.type === "any" || g.type === filters.type) &&
        (!filters.course || courseKey(g.course) === courseKey(filters.course))
    )
    .sort((a, b) => gameStart(a) - gameStart(b));
  const nearby = live.filter((g) => g.area === me.area && g.totalSpots > g.players.length && !g.players.some((p) => p.id === me.id)).length;
  const sub =
    nearby > 0
      ? `${nearby} ${nearby === 1 ? "round" : "rounds"} near you still ${nearby === 1 ? "has" : "have"} room. Tap Join and you're in the group.`
      : live.length > 0
        ? "Nothing open near you right now. Try another area, or post a tee time and let others fill it."
        : "Nothing posted yet. Post a tee time and let others fill it.";

  return (
    <main className="wrap">
      <section className="stack-lg">
        <div className="stack">
          <span className="eyebrow">Find a game</span>
          <h1>Hi {firstName(me.name)}.</h1>
          <p className="lede">{sub}</p>
        </div>
        <Pills id="f-type" ariaLabel="Type of golf" options={typeOptions(true)} value={filters.type} onChange={(type) => setFilters({ ...filters, type })} />
        <select className="onpage" aria-label="Area" value={filters.area} onChange={(e) => setFilters({ ...filters, area: e.target.value })}>
          <option value="all">All of BC</option>
          {AREAS.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      </section>

      {toAsk ? <HowDidItGo game={toAsk} {...askProps} /> : showPicture ? <PicturePanel me={me} {...pictureProps} /> : null}

      {filters.course && (
        <div className="banner">
          <span>Showing games at {filters.course} only</span>
          <button className="linkbtn accent" onClick={() => setFilters({ ...filters, course: "" })}>
            Clear
          </button>
        </div>
      )}

      <section className="stack-lg" style={{ gap: 14 }} aria-label="Games">
        <div className="listhead">
          <span>
            {list.length} upcoming {list.length === 1 ? "game" : "games"}
          </span>
          <button className="linkbtn" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? "Checking…" : "Check for new games"}
          </button>
        </div>
        {list.map((g) => (
          <GameCard key={g.id} game={g} me={me} {...cardProps} />
        ))}
        {list.length === 0 && (
          <div className="card center">
            <span className="plus" aria-hidden="true">
              +
            </span>
            <p className="lede" style={{ maxWidth: "26em" }}>
              {live.length === 0
                ? "No games posted yet. Be the first: post a tee time and other golfers can join you."
                : filters.area === "all"
                  ? "Nothing matches those filters right now. Try Any type, or post a game yourself."
                  : `Nothing matches in ${filters.area} right now. Try All of BC, or post a game yourself.`}
            </p>
            <button className="btn sm" onClick={goHost}>
              Host a game
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

function HostGame({ me, onPost, prefill }) {
  const tomorrow = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return toISODate(d);
  }, []);
  const blank = {
    course: "",
    type: "pnp",
    area: me.area || AREAS[0],
    date: tomorrow,
    time: "09:00",
    totalSpots: 4,
    teeBooked: false,
    vibe: "casual",
    meetAt: defaultMeet("pnp"),
    meetCustom: "",
    meetEdited: false,
    note: "",
  };
  const [f, setF] = useState(() => {
    const c = prefill && findCourse(prefill);
    if (!c) return blank;
    const type = bestType(c);
    return { ...blank, course: c.name, area: c.area, type, meetAt: defaultMeet(type) };
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const up = (k, val) => setF((p) => ({ ...p, [k]: val }));
  // Where to meet follows the type of golf until the host picks something themselves
  const pick = (k, val) =>
    setF((p) => {
      const n = { ...p, [k]: val };
      if (k === "type" && !p.meetEdited) n.meetAt = defaultMeet(val);
      return n;
    });
  const areaCourses = useMemo(() => COURSES.filter((c) => c.area === f.area).sort(byName), [f.area]);
  const meetOptions = useMemo(() => {
    const opts = meetChoices(f.type);
    return f.meetAt !== "other" && !opts.includes(f.meetAt) ? [f.meetAt, ...opts] : opts;
  }, [f.type, f.meetAt]);

  // Picking a course from the list fills in its area and type of golf
  const chooseCourse = (value) =>
    setF((p) => {
      const c = findCourse(value);
      if (!c) return { ...p, course: value };
      const type = c.types.includes(p.type) ? p.type : bestType(c);
      return { ...p, course: c.name, area: c.area, type, meetAt: p.meetEdited ? p.meetAt : defaultMeet(type) };
    });

  const submit = async () => {
    const e = {};
    const meetAt = f.meetAt === "other" ? f.meetCustom.trim() : f.meetAt;
    if (!f.course.trim()) e.course = "Enter the course name.";
    if (!f.date) e.date = "Pick a date.";
    if (!f.time) e.time = "Pick a tee time.";
    if (f.date && f.time && gameStart(f) < new Date()) e.date = "That date and time has already passed. Pick one in the future.";
    if (!meetAt) e.meetAt = "Tell people where to meet.";
    setErrors(e);
    if (Object.keys(e).length) {
      const first = Object.keys(e)[0];
      document.getElementById(`h-${first}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    setSaving(true);
    const ok = await onPost({
      course: f.course.trim(),
      type: f.type,
      area: f.area,
      date: f.date,
      time: f.time,
      totalSpots: f.totalSpots,
      teeBooked: f.teeBooked,
      vibe: f.vibe,
      meetAt,
      note: f.note.trim(),
    });
    setSaving(false);
    if (ok) setF(blank);
  };

  return (
    <main className="wrap">
      <section className="stack">
        <span className="eyebrow">Host a game</span>
        <h1>Post a tee time.</h1>
        <p className="lede">Fill in the round and other golfers take the open spots. You'll see who joins under My games.</p>
      </section>

      <section className="card pad" aria-label="Game details">
        <Field id="h-area" label="Area">
          <select id="h-area" value={f.area} onChange={(e) => up("area", e.target.value)}>
            {AREAS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </Field>

        <Field id="h-course" label="Course" hint={`Start typing to see courses in ${f.area}. If yours isn't listed, just type its name.`} error={errors.course}>
          <input
            id="h-course"
            type="text"
            list="course-list"
            autoComplete="off"
            placeholder="Start typing a course name"
            value={f.course}
            onChange={(e) => chooseCourse(e.target.value)}
            aria-invalid={!!errors.course}
          />
          <datalist id="course-list">
            {areaCourses.map((c) => (
              <option key={c.name} value={c.name}>
                {c.city}
              </option>
            ))}
          </datalist>
        </Field>

        <Tiles id="h-type" label="Type of golf" value={f.type} onChange={(v) => pick("type", v)} options={typeOptions(false)} />

        <div className="two">
          <Field id="h-date" label="Date" error={errors.date}>
            <input id="h-date" type="date" min={toISODate(new Date())} value={f.date} onChange={(e) => up("date", e.target.value)} aria-invalid={!!errors.date} />
          </Field>
          <Field id="h-time" label="Tee time" error={errors.time}>
            <input id="h-time" type="time" step={60} value={f.time} onChange={(e) => up("time", e.target.value)} aria-invalid={!!errors.time} />
          </Field>
        </div>

        <Tiles
          id="h-spots"
          label="Group size, including you"
          value={f.totalSpots}
          onChange={(v) => up("totalSpots", v)}
          options={[
            { value: 2, label: "You + 1" },
            { value: 3, label: "You + 2" },
            { value: 4, label: "You + 3" },
          ]}
        />

        <Tiles
          id="h-vibe"
          label="Pace"
          stacked
          value={f.vibe}
          onChange={(v) => up("vibe", v)}
          options={Object.entries(VIBES).map(([value, x]) => ({ value, label: x.label, hint: x.hint[0].toUpperCase() + x.hint.slice(1) }))}
        />

        <Tiles
          id="h-booked"
          label="Have you booked the tee time?"
          value={f.teeBooked}
          onChange={(v) => up("teeBooked", v)}
          options={[
            { value: true, label: "Yes, it's booked" },
            { value: false, label: "Not yet" },
          ]}
        />

        <Field id="h-meetAt" label="Where should everyone meet?" error={errors.meetAt}>
          <select
            id="h-meetAt"
            value={f.meetAt}
            onChange={(e) => setF((p) => ({ ...p, meetAt: e.target.value, meetEdited: true }))}
            aria-invalid={!!errors.meetAt}
          >
            {meetOptions.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
            <option value="other">Something else…</option>
          </select>
          {f.meetAt === "other" && (
            <input
              type="text"
              aria-label="Where to meet"
              placeholder="Tell people exactly where to meet"
              maxLength={200}
              value={f.meetCustom}
              onChange={(e) => up("meetCustom", e.target.value)}
              aria-invalid={!!errors.meetAt}
            />
          )}
        </Field>

        <Field id="h-note" label="Anything else people should know?">
          <textarea
            id="h-note"
            rows={3}
            maxLength={280}
            placeholder="Optional. Walking not riding, beginners welcome…"
            value={f.note}
            onChange={(e) => up("note", e.target.value)}
          />
        </Field>

        {Object.keys(errors).length > 0 && <p className="error">Have a look at the fields marked above.</p>}
        <button className="btn" onClick={submit} disabled={saving}>
          {saving ? "Posting…" : "Post this game"}
        </button>
      </section>
    </main>
  );
}

function CourseList({ me, games, onHostHere, onSeeGames }) {
  const [area, setArea] = useState(me.area || "all");
  const [type, setType] = useState("any");
  const [query, setQuery] = useState("");

  const gameCounts = useMemo(() => {
    const counts = {};
    games
      .filter((g) => !g.cancelled && !hasStarted(g))
      .forEach((g) => {
        const k = courseKey(g.course);
        counts[k] = (counts[k] || 0) + 1;
      });
    return counts;
  }, [games]);

  const q = query.trim().toLowerCase();
  const list = COURSES.filter(
    (c) =>
      (area === "all" || c.area === area) &&
      (type === "any" || c.types.includes(type)) &&
      (!q || c.name.toLowerCase().includes(q) || c.city.toLowerCase().includes(q))
  ).sort((a, b) => a.city.localeCompare(b.city) || byName(a, b));

  return (
    <main className="wrap">
      <section className="stack-lg">
        <div className="stack">
          <span className="eyebrow">Courses</span>
          <h1>Every course in BC.</h1>
          <p className="lede" aria-live="polite">
            {list.length} {list.length === 1 ? "course" : "courses"} listed{area !== "all" ? ` in ${area}` : ""}. Pick one to host a game there.
          </p>
        </div>
        <input
          className="onpage"
          type="text"
          aria-label="Search by course or town"
          placeholder="Search by course or town"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="onpage" aria-label="Area" value={area} onChange={(e) => setArea(e.target.value)}>
          <option value="all">All of BC</option>
          {AREAS.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <Pills id="c-type" ariaLabel="Type of golf" options={typeOptions(true)} value={type} onChange={setType} />
      </section>

      <section className="stack-lg" style={{ gap: 10 }} aria-label="Courses">
        {list.length === 0 ? (
          <div className="card center">
            <p className="lede">No courses match. Try All of BC or Any type, or clear the search.</p>
          </div>
        ) : (
          list.map((c) => {
            const count = gameCounts[courseKey(c.name)] || 0;
            return (
              <article key={c.name} className="course">
                <div>
                  <h3>{c.name}</h3>
                  <p className="course-city">
                    {c.city}
                    {area === "all" && `, ${c.area}`}
                  </p>
                </div>
                <div className="tags">
                  {TYPE_ORDER.filter((t) => c.types.includes(t)).map((t) => (
                    <span key={t} className="tag">
                      {TYPES[t]}
                    </span>
                  ))}
                  {c.access === "members" && <span className="tag dim">Members and guests only</span>}
                  {c.note && <span className="tag note">{c.note}</span>}
                  {count > 0 && (
                    <span className="tag open">
                      {count} upcoming {count === 1 ? "game" : "games"}
                    </span>
                  )}
                </div>
                <div className="course-actions">
                  {count > 0 && (
                    <button className="btn sm" onClick={() => onSeeGames(c)}>
                      See {count === 1 ? "the game" : "the games"}
                    </button>
                  )}
                  <button className="btn sm secondary" onClick={() => onHostHere(c)}>
                    Host a game here
                  </button>
                </div>
              </article>
            );
          })
        )}
        <p className="hint">Don't see your course? You can type any course name when you host a game.</p>
      </section>
    </main>
  );
}

function NewsletterCard({ me, onSubscribe }) {
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <section className="news" aria-labelledby="news-h">
      <h2 id="news-h">The newsletter</h2>
      {me.newsletter ? (
        <p>
          You're signed up with <span style={{ overflowWrap: "anywhere" }}>{me.email}</span>. To stop it, use the unsubscribe link at the bottom of any
          newsletter email.
        </p>
      ) : (
        <>
          <Check checked={agree} onChange={setAgree}>
            {NEWSLETTER_LINE} <span className="free">It's free.</span>
          </Check>
          <button
            className="btn"
            disabled={!agree || busy}
            onClick={async () => {
              setBusy(true);
              await onSubscribe();
              setBusy(false);
            }}
          >
            {busy ? "Signing you up…" : "Sign me up"}
          </button>
        </>
      )}
    </section>
  );
}

function MyGames({ games, me, goFind, goHost, cardProps, onSaveDetails, onSubscribe, onSignOut, onUnhide }) {
  const mine = games
    .filter((g) => g.players.some((p) => p.id === me.id) && !(g.cancelled && g.hostId === me.id))
    .sort((a, b) => gameStart(a) - gameStart(b));
  const hostingCount = mine.filter((g) => g.hostId === me.id).length;
  const joinedCount = mine.filter((g) => g.hostId !== me.id && !g.cancelled).length;
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState({ name: me.name, area: me.area, avatar: me.avatar });
  const [errors, setErrors] = useState({});
  const hidden = me.hidden || [];

  const save = async () => {
    const e = validateDetails(v);
    setErrors(e);
    if (Object.keys(e).length) return;
    const ok = await onSaveDetails(v);
    if (ok) setEditing(false);
  };

  return (
    <main className="wrap">
      <section className="stack-lg">
        <div className="stack">
          <span className="eyebrow">My games</span>
          <h1>{mine.length > 0 ? "Your next rounds." : "No rounds yet."}</h1>
        </div>
        <div className="stats">
          <div className="stat">
            <b>{hostingCount}</b>
            <span>Hosting</span>
          </div>
          <div className="stat">
            <b>{joinedCount}</b>
            <span>Joined</span>
          </div>
        </div>
      </section>

      <section className="stack-lg" style={{ gap: 12 }} aria-labelledby="rounds-h">
        <h2 id="rounds-h" className="eyebrow">
          Your rounds
        </h2>
        {mine.length === 0 ? (
          <div className="card center">
            <p className="lede">Nothing booked yet. Join a round or post your own tee time.</p>
            <div className="course-actions" style={{ justifyContent: "center" }}>
              <button className="btn sm" onClick={goFind}>
                Find a game
              </button>
              <button className="btn sm secondary" onClick={goHost}>
                Host a game
              </button>
            </div>
          </div>
        ) : (
          mine.map((g) => <GameCard key={g.id} game={g} me={me} {...cardProps} />)
        )}
      </section>

      <section className="card" aria-labelledby="details-h">
        <h2 id="details-h" className="eyebrow">
          Your details
        </h2>
        {editing ? (
          <>
            <DetailsFields v={v} set={setV} errors={errors} withPicture />
            <div className="actions">
              <button className="btn" onClick={save}>
                Save changes
              </button>
              <button
                className="btn secondary"
                onClick={() => {
                  setEditing(false);
                  setV({ name: me.name, area: me.area, avatar: me.avatar });
                  setErrors({});
                }}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="stack" style={{ gap: 10 }}>
              <div className="row">
                <span>Name</span>
                <span>{displayName(me)}</span>
              </div>
              <div className="row">
                <span>Picture</span>
                <span>
                  <Ball person={me} />
                </span>
              </div>
              <div className="row">
                <span>Email</span>
                <span>{me.email}</span>
              </div>
              <div className="row">
                <span>Area</span>
                <span>{me.area}</span>
              </div>
            </div>
            <button className="btn secondary" onClick={() => setEditing(true)}>
              Edit my details
            </button>
          </>
        )}
      </section>

      {hidden.length > 0 && (
        <section className="card" aria-labelledby="hidden-h">
          <h2 id="hidden-h" className="eyebrow">
            Golfers you've hidden
          </h2>
          <p className="hint">You don't see each other's games. They weren't told.</p>
          <ul className="people">
            {hidden.map((p) => (
              <li key={p.id}>
                <span className="person-name">{p.name}</span>
                <button className="pill" onClick={() => onUnhide(p)}>
                  Unhide
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <NewsletterCard me={me} onSubscribe={onSubscribe} />

      <button className="linkbtn" onClick={onSignOut}>
        Sign out on this device
      </button>
    </main>
  );
}

// ---------- App ----------

export default function App() {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState(null); // the signed-in member, from the server
  const [games, setGames] = useState([]); // games this member can see
  const [toAskList, setToAskList] = useState([]); // past games to ask about
  const [tab, setTab] = useState("find");
  const [large, setLarge] = useState(false);
  const [notice, setNotice] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [contact, setContact] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filters, setFilters] = useState({ area: "all", type: "any" });
  const [hostPrefill, setHostPrefill] = useState(null); // { course, n } when hosting from the Courses page
  const [startNotice, setStartNotice] = useState("");
  const legacy = useMemo(legacyProfile, []);

  // Anything the server sends back about games or the member lands here
  const absorb = useCallback((res) => {
    if (!res || res.error) return res;
    if (Array.isArray(res.games)) setGames(res.games);
    if (Array.isArray(res.toAsk)) setToAskList(res.toAsk);
    if (res.member) setMe(res.member);
    return res;
  }, []);

  // A server error: show it, and if we've been signed out, go back to the sign-in screen
  const fail = useCallback((res) => {
    if (res.status === 401) {
      setMe(null);
      setNotice({ kind: "error", text: "You've been signed out. Sign in again to carry on." });
    } else {
      setNotice({ kind: "error", text: res.error || "Something went wrong. Try again." });
    }
    return false;
  }, []);

  const loadGames = useCallback(async () => {
    const res = absorb(await api.games());
    if (res.error && res.status === 401) fail(res);
  }, [absorb, fail]);

  useEffect(() => {
    (async () => {
      if (localStore.get(TEXT_KEY) === "large") setLarge(true);
      const q = new URLSearchParams(window.location.search);
      if (q.has("signin")) {
        if (q.get("signin") === "expired") setStartNotice("That sign-in link has expired. Ask for a new one below.");
        window.history.replaceState(null, "", window.location.pathname);
      }
      const res = await api.me();
      if (res.member) {
        setMe(res.member);
        if (res.member.area) setFilters((f) => ({ ...f, area: res.member.area }));
        if (res.member.complete) await loadGames();
      }
      setLoading(false);
    })();
  }, [loadGames]);

  useEffect(() => {
    if (me?.complete && tab !== "host") loadGames();
    window.scrollTo({ top: 0 });
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // ----- Signing in and out -----

  const handleSignedIn = async (member) => {
    setMe(member);
    if (member.area) setFilters((f) => ({ ...f, area: member.area }));
    if (member.complete) {
      await loadGames();
      setTab("find");
      setNotice({ text: `Welcome back, ${firstName(member.name)}.` });
    }
  };

  const finishWelcome = async (v, newsletter) => {
    let fields = { name: v.name.trim(), area: v.area, newsletter };
    if (newsletter && !me.newsletter) {
      fields.newsletterSynced = await subscribeToNewsletter({ email: me.email, firstName: fields.name, area: fields.area });
    }
    const res = await api.updateMe(fields);
    if (res.error) return fail(res);
    setMe(res.member);
    setFilters({ area: res.member.area, type: "any" });
    await loadGames();
    setTab("find");
    setNotice({ text: `You're set up, ${firstName(res.member.name)}. Here's who's heading out in ${res.member.area}.` });
    return true;
  };

  const signOut = () =>
    setDialog({
      title: "Sign out on this device?",
      body: <p>Your games and details stay as they are. Sign back in any time with your email.</p>,
      confirmLabel: "Yes, sign out",
      onConfirm: async () => {
        await api.signOut();
        setMe(null);
        setGames([]);
        setToAskList([]);
        setTab("find");
        return { text: "You're signed out." };
      },
    });

  // ----- Games -----

  const summary = (g) => (
    <div className="inset">
      <div className="row">
        <span>Course</span>
        <span>{g.course}</span>
      </div>
      <div className="row">
        <span>When</span>
        <span>
          {fmtLongDate(g.date)} · {fmtTime(g.time)}
        </span>
      </div>
      <div className="row">
        <span>Meet</span>
        <span>{g.meetAt}</span>
      </div>
    </div>
  );

  const askJoin = (game) =>
    setDialog({
      title: "Join this game?",
      body: (
        <>
          {summary(game)}
          <p>If your plans change, come back and tap Leave this game so someone else can take your spot.</p>
        </>
      ),
      confirmLabel: "Yes, join this game",
      onConfirm: async () => {
        const res = absorb(await api.gameAction(game.id, "join"));
        return res.error
          ? { kind: "error", text: res.error }
          : { text: `You're in. See you at ${game.course} on ${fmtLongDate(game.date)} at ${fmtTime(game.time)}.` };
      },
    });

  const askLeave = (game) =>
    setDialog({
      title: "Leave this game?",
      body: (
        <>
          {summary(game)}
          <p>Your spot will open up for someone else.</p>
        </>
      ),
      confirmLabel: "Yes, leave this game",
      danger: true,
      onConfirm: async () => {
        const res = absorb(await api.gameAction(game.id, "leave"));
        return res.error ? { kind: "error", text: res.error } : { text: `You've left the game at ${game.course}. The spot is open again.` };
      },
    });

  const askCancel = (game) =>
    setDialog({
      title: "Cancel this game?",
      body: (
        <>
          {summary(game)}
          <p>
            {game.players.length > 1
              ? "Everyone who joined will see that it's cancelled. Consider sending the group a message first."
              : "No one has joined yet."}
          </p>
        </>
      ),
      confirmLabel: "Yes, cancel this game",
      danger: true,
      onConfirm: async () => {
        const res = absorb(await api.gameAction(game.id, "cancel"));
        return res.error ? { kind: "error", text: res.error } : { text: "Your game is cancelled." };
      },
    });

  const postMessage = async (game, text) => {
    const res = absorb(await api.gameAction(game.id, "message", { text }));
    if (res.error) fail(res);
    return !res.error;
  };

  const postGame = async (f) => {
    const res = absorb(await api.postGame(f));
    if (res.error) {
      fail(res);
      return false;
    }
    setFilters({ area: res.game.area, type: "any" });
    setTab("find");
    setNotice({ text: `Your game is posted. Golfers in ${res.game.area} can see it and join now.` });
    return true;
  };

  // ----- Your details -----

  const saveDetails = async (v) => {
    const res = await api.updateMe({ name: v.name.trim(), area: v.area, avatar: avatarOf({ avatar: v.avatar }) });
    if (res.error) return fail(res);
    setMe(res.member);
    setNotice({ text: "Your details are saved." });
    return true;
  };

  const savePicture = async (avatar) => {
    const res = await api.updateMe({ avatar });
    if (res.error) return fail(res);
    setMe(res.member);
    setNotice({ text: avatar.kind === "letter" ? "Your initial it is." : "Your picture is saved." });
    return true;
  };

  const skipPicture = async () => {
    const res = await api.updateMe({ pictureAsked: true });
    if (res.error) fail(res);
    else setMe(res.member);
  };

  const subscribe = async () => {
    const synced = await subscribeToNewsletter({ email: me.email, firstName: me.name, area: me.area });
    const res = await api.updateMe({ newsletter: true, newsletterSynced: synced });
    if (res.error) return fail(res);
    setMe(res.member);
    setNotice({ text: "You're signed up for the newsletter." });
  };

  // ----- After a game: "Would you play with them again?" -----

  const answerGame = (game, p, answer) => {
    if (answer === "yes") {
      api.answer(game.id, p.id, "yes").then((res) => (res.error ? fail(res) : absorb(res)));
      // Take the person off the question straight away
      setToAskList((list) => list.map((g) => (g.id === game.id ? { ...g, players: g.players.filter((x) => x.id !== p.id) } : g)).filter((g) => g.players.length));
      return;
    }
    setDialog({
      title: `Rather not play with ${p.name} again?`,
      body: <p>The two of you won't see each other's games from now on. {p.name} isn't told. You can undo this later under My games.</p>,
      confirmLabel: "Yes, I'd rather not",
      danger: true,
      onConfirm: async () => {
        const res = absorb(await api.answer(game.id, p.id, "no"));
        if (res.error) return { kind: "error", text: res.error };
        return { text: `Done. You and ${p.name} won't see each other's games.` };
      },
    });
  };

  const skipGame = async (game) => {
    setToAskList((list) => list.filter((g) => g.id !== game.id));
    const res = await api.skip(game.id);
    if (res.error) fail(res);
    else absorb(res);
  };

  const unhideGolfer = async (p) => {
    const res = absorb(await api.unhide(p.id));
    if (res.error) return fail(res);
    setNotice({ text: `${p.name} can see your games again, and you theirs.` });
  };

  const runDialog = async () => {
    setBusy(true);
    const msg = await dialog.onConfirm();
    setBusy(false);
    setDialog(null);
    if (msg) setNotice(msg);
  };

  const toggleText = () => {
    const next = !large;
    setLarge(next);
    localStore.set(TEXT_KEY, next ? "large" : "regular");
  };

  const cardProps = { onJoin: askJoin, onLeave: askLeave, onCancel: askCancel, onPostMessage: postMessage };
  const signedIn = !!(me && me.complete);
  const toAsk = toAskList[0] || null;
  const myAvatar = me ? avatarOf(me) : null;

  return (
    <div className={`pt${large ? " large" : ""}`}>
      <style>{css}</style>

      {signedIn && (
        <header className="top">
          <div className="top-inner">
            <Brand />
            <div className="top-actions">
              <TextSizeButton large={large} onToggle={toggleText} />
              <button className="mebtn" aria-label="My games" title="My games" onClick={() => setTab("mine")}>
                {myAvatar.kind === "photo" ? (
                  <img src={myAvatar.photo} alt="" />
                ) : myAvatar.kind === "emoji" ? (
                  <span className="em" aria-hidden="true">
                    {myAvatar.emoji}
                  </span>
                ) : (
                  initials(me.name)
                )}
              </button>
            </div>
          </div>
          <nav className="tabs" aria-label="Main">
            {[
              ["find", "Find a game"],
              ["host", "Host a game"],
              ["courses", "Courses"],
              ["mine", "My games"],
            ].map(([key, label]) => (
              <button
                key={key}
                className="tab"
                aria-current={tab === key ? "page" : undefined}
                onClick={() => {
                  if (key === "host") setHostPrefill(null);
                  if (key === "find") setFilters((x) => ({ ...x, course: "" }));
                  setTab(key);
                }}
              >
                {label}
              </button>
            ))}
          </nav>
        </header>
      )}

      {loading ? (
        <main className="wrap narrow">
          <div className="top-inner" style={{ padding: 0 }}>
            <Brand big />
          </div>
          <p className="lede">Loading…</p>
        </main>
      ) : !me ? (
        <SignIn onSignedIn={handleSignedIn} legacy={legacy} startNotice={startNotice} large={large} onToggleText={toggleText} />
      ) : !me.complete ? (
        <Welcome me={me} legacy={legacy} onDone={finishWelcome} large={large} onToggleText={toggleText} />
      ) : tab === "find" ? (
        <FindGames
          games={games}
          me={me}
          filters={filters}
          setFilters={setFilters}
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await loadGames();
            setRefreshing(false);
          }}
          goHost={() => setTab("host")}
          cardProps={cardProps}
          toAsk={toAsk}
          askProps={{ onAnswer: answerGame, onSkip: skipGame }}
          showPicture={!me.avatar && !me.pictureAsked}
          pictureProps={{ onSave: savePicture, onSkip: skipPicture }}
        />
      ) : tab === "host" ? (
        <HostGame key={hostPrefill?.n || "host"} me={me} onPost={postGame} prefill={hostPrefill?.course} />
      ) : tab === "courses" ? (
        <CourseList
          me={me}
          games={games}
          onHostHere={(c) => {
            setHostPrefill({ course: c.name, n: Date.now() });
            setTab("host");
          }}
          onSeeGames={(c) => {
            setFilters({ area: c.area, type: "any", course: c.name });
            setTab("find");
          }}
        />
      ) : (
        <MyGames
          games={games}
          me={me}
          goFind={() => setTab("find")}
          goHost={() => setTab("host")}
          cardProps={cardProps}
          onSaveDetails={saveDetails}
          onSubscribe={subscribe}
          onSignOut={signOut}
          onUnhide={unhideGolfer}
        />
      )}

      {!loading && (
        <footer className="foot">
          {signedIn && (
            <p>
              Meet at the course, in public, and let someone know where you're playing. Posted games, your name and your picture are visible to
              members of Putt Together. Your email stays private.
            </p>
          )}
          <button className="linkbtn" onClick={() => setContact(true)}>
            Contact us
          </button>
        </footer>
      )}

      {contact && (
        <ContactDialog
          me={me}
          legacy={legacy}
          onClose={() => setContact(false)}
          onSent={() => {
            setContact(false);
            setNotice({ text: "Thanks. Your note is on its way to Syavash." });
          }}
        />
      )}

      {dialog && <Dialog d={dialog} busy={busy} onClose={() => setDialog(null)} onConfirm={runDialog} />}

      {notice && (
        <div className={`notice${notice.kind === "error" ? " error" : ""}`} role="status" aria-live="polite">
          <p>{notice.text}</p>
          <button onClick={() => setNotice(null)}>OK</button>
        </div>
      )}
    </div>
  );
}
