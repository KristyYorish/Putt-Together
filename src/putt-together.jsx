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
*/
const NEWSLETTER_ENDPOINT = "/api/subscribe";

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

const VIBES = {
  fun: { label: "Just for fun", hint: "no pressure on the score" },
  casual: { label: "Casual", hint: "we keep score but nobody sweats it" },
  keen: { label: "Keen", hint: "playing to our handicaps" },
};

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
const isUpcoming = (g) => gameStart(g).getTime() > Date.now() - 3 * 3600 * 1000;
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

// ----- Pictures -----

// A person's picture: { kind: "letter" } (their initial), { kind: "emoji", emoji }, or { kind: "photo", photo } (a small data URL)
const avatarOf = (p) => (p?.avatar && (p.avatar.kind === "emoji" || p.avatar.kind === "photo") ? p.avatar : { kind: "letter" });
// What travels with your name into posted games. The initial needs no data, so it's left out.
const publicAvatar = (p) => (avatarOf(p).kind === "letter" ? undefined : avatarOf(p));

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

const css = `
@import url('https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Zilla+Slab:wght@600;700&display=swap');

.pt {
  --fog: #EAF0EE; --fairway: #1E4A36; --fairway-dark: #143426; --ink: #17231E;
  --muted: #4A5A53; --line: #C5D2CC; --flag: #F3C53A; --pin: #A8321F; --tint: #F1F7F4;
  font-family: "Atkinson Hyperlegible", system-ui, sans-serif;
  font-size: 19px; line-height: 1.55; color: var(--ink); background: var(--fog);
  min-height: 100vh;
}
.pt.large { font-size: 23px; }
.pt *, .pt *::before, .pt *::after { box-sizing: border-box; }
.pt h1, .pt h2, .pt h3 { font-family: "Zilla Slab", Georgia, serif; line-height: 1.15; margin: 0; color: var(--fairway-dark); }
.pt h1 { font-size: 2.2em; font-weight: 700; }
.pt h2 { font-size: 1.5em; font-weight: 700; }
.pt h3 { font-size: 1.3em; font-weight: 700; }
.pt p { margin: 0; }
.pt :focus-visible { outline: 3px solid var(--ink); outline-offset: 3px; }

.top { background: var(--fairway-dark); color: #fff; }
.top-inner { max-width: 38em; margin: 0 auto; padding: .9em 1em; display: flex; align-items: center; justify-content: space-between; gap: 1em; }
.brand { display: flex; align-items: center; gap: .55em; }
.wordmark { font-family: "Zilla Slab", Georgia, serif; font-weight: 700; font-size: 1.55em; letter-spacing: -.01em; line-height: 1; }
.tagline { font-size: .85em; opacity: .9; margin-top: .2em; }
.textsize { font: inherit; font-size: .85em; font-weight: 700; color: #fff; background: transparent; border: 2px solid rgba(255,255,255,.7); border-radius: 10px; padding: .45em .8em; min-height: 2.6em; cursor: pointer; white-space: nowrap; }
.textsize[aria-pressed="true"] { background: var(--flag); color: var(--ink); border-color: var(--flag); }

.tabs { position: sticky; top: 0; z-index: 20; background: #fff; border-bottom: 2px solid var(--line); }
.tabs-inner { max-width: 38em; margin: 0 auto; display: grid; grid-template-columns: repeat(4, 1fr); gap: .4em; padding: .5em 1em; }
.tab { font: inherit; font-weight: 700; font-size: .95em; min-height: 3em; border-radius: 10px; border: 2px solid transparent; background: transparent; color: var(--fairway); cursor: pointer; padding: .3em .4em; }
.tab[aria-current="page"] { background: var(--fairway); color: #fff; }
.tab:not([aria-current="page"]):hover { border-color: var(--line); }

.wrap { max-width: 38em; margin: 0 auto; padding: 1.4em 1em 2em; display: grid; gap: 1.4em; }
.lede { font-size: 1.1em; margin-top: .5em; max-width: 32em; }
.muted { color: var(--muted); }
.small { font-size: .85em; }

.steps { margin: 1.2em 0 0; padding: 0; list-style: none; display: grid; gap: .7em; counter-reset: s; }
.steps li { counter-increment: s; display: grid; grid-template-columns: 2.2em 1fr; gap: .7em; align-items: start; }
.steps li::before { content: counter(s); width: 2.2em; height: 2.2em; border-radius: 50%; background: var(--flag); color: var(--ink); font-weight: 700; display: grid; place-items: center; }

.panel { background: #fff; border: 2px solid var(--line); border-radius: 14px; padding: 1.3em 1.2em; display: grid; gap: 1.1em; }

.field { display: grid; gap: .35em; border: 0; margin: 0; padding: 0; min-width: 0; }
.label { font-weight: 700; padding: 0; }
.hint { color: var(--muted); font-size: .9em; }
.error { color: var(--pin); font-weight: 700; font-size: .95em; }
.pt input[type=text], .pt input[type=email], .pt input[type=date], .pt input[type=time], .pt select, .pt textarea {
  font: inherit; width: 100%; min-height: 3em; padding: .6em .75em; border: 2px solid #8FA39A; border-radius: 10px; background: #fff; color: var(--ink);
}
.pt textarea { min-height: 5em; resize: vertical; }
.pt [aria-invalid="true"] { border-color: var(--pin); }

.choices { display: grid; gap: .5em; }
.choices.row { grid-template-columns: repeat(auto-fit, minmax(8.5em, 1fr)); }
.choice { display: flex; gap: .7em; align-items: flex-start; border: 2px solid var(--line); border-radius: 12px; padding: .75em .9em; cursor: pointer; background: #fff; }
.choice:has(input:checked) { border-color: var(--fairway); background: var(--tint); }
.choice input { width: 1.3em; height: 1.3em; margin: .15em 0 0; accent-color: var(--fairway); flex: none; }
.choice-hint { display: block; color: var(--muted); font-size: .9em; }
.check { display: flex; gap: .75em; align-items: flex-start; cursor: pointer; }
.check input { width: 1.4em; height: 1.4em; margin: .1em 0 0; accent-color: var(--fairway); flex: none; }

.btn { font: inherit; font-weight: 700; min-height: 3em; padding: .55em 1.2em; border-radius: 10px; border: 2px solid var(--fairway); background: var(--fairway); color: #fff; cursor: pointer; width: 100%; }
.btn:hover:not(:disabled) { background: var(--fairway-dark); border-color: var(--fairway-dark); }
.btn.secondary { background: #fff; color: var(--fairway); }
.btn.secondary:hover:not(:disabled) { background: var(--tint); color: var(--fairway-dark); }
.btn.danger { background: #fff; color: var(--pin); border-color: var(--pin); }
.btn.danger-solid { background: var(--pin); border-color: var(--pin); color: #fff; }
.btn:disabled { background: #DDE5E1; border-color: #DDE5E1; color: var(--muted); cursor: not-allowed; }
.linkbtn { font: inherit; background: none; border: 0; padding: .3em 0; color: var(--fairway); text-decoration: underline; cursor: pointer; font-weight: 700; justify-self: start; }

.filters { display: grid; gap: 1em; }
.seg { display: flex; flex-wrap: wrap; gap: .4em; }
.seg button { font: inherit; font-weight: 700; font-size: .95em; min-height: 2.8em; padding: .3em .9em; border-radius: 999px; border: 2px solid var(--fairway); background: #fff; color: var(--fairway); cursor: pointer; }
.seg button[aria-pressed="true"] { background: var(--fairway); color: #fff; }
.listhead { display: flex; justify-content: space-between; align-items: baseline; gap: 1em; flex-wrap: wrap; }

.card { background: #fff; border: 2px solid var(--line); border-radius: 14px; overflow: hidden; display: grid; grid-template-columns: 4.6em 1fr; }
.card.cancelled { opacity: .75; }
.card-date { background: var(--fairway); color: #fff; display: flex; flex-direction: column; align-items: center; padding: 1em .3em; text-align: center; }
.card-date .dow { font-weight: 700; font-size: .9em; }
.card-date .dnum { font-family: "Zilla Slab", Georgia, serif; font-weight: 700; font-size: 2.1em; line-height: 1; margin: .1em 0; }
.card-date .mon { font-size: .9em; }
.card-body { padding: 1em 1.1em 1.2em; display: grid; gap: .9em; min-width: 0; }
.tags { display: flex; flex-wrap: wrap; gap: .4em; }
.tag { font-size: .85em; font-weight: 700; padding: .15em .65em; border-radius: 999px; background: var(--tint); color: var(--fairway-dark); border: 1px solid var(--line); }
.tag.flag { background: var(--flag); border-color: var(--flag); color: var(--ink); }
.tag.stop { background: #fff; border-color: var(--pin); color: var(--pin); }

.facts { display: grid; grid-template-columns: auto 1fr; margin: 0; }
.facts dt, .facts dd { padding: .4em 0; border-bottom: 1px dashed var(--line); }
.facts dt { color: var(--muted); padding-right: 1em; }
.facts dd { margin: 0; font-weight: 700; }

.group-label { font-weight: 700; margin-bottom: .45em; }
.seats { display: flex; flex-wrap: wrap; gap: .6em; }
.seat { width: 4.6em; display: flex; flex-direction: column; align-items: center; gap: .25em; text-align: center; }
.ball { width: 2.9em; height: 2.9em; border-radius: 50%; display: grid; place-items: center; font-weight: 700; background: var(--fairway); color: #fff; flex: none; }
.ball.you { background: var(--flag); color: var(--ink); }
.ball.open { background: #fff; border: 3px dashed var(--fairway); color: var(--fairway); font-size: .85em; }
.ball.emoji { background: var(--tint); border: 2px solid var(--line); font-size: 1.5em; line-height: 1; }
.ball.emoji.you { background: var(--flag); border-color: var(--flag); }
.ball.photo { overflow: hidden; background: var(--tint); }
.ball.photo.you { box-shadow: 0 0 0 3px var(--flag); }
.ball img { width: 100%; height: 100%; object-fit: cover; display: block; }
.seat-name { font-size: .85em; line-height: 1.2; overflow-wrap: anywhere; }
.seat-role { font-size: .8em; color: var(--muted); }

.pick { display: flex; align-items: center; gap: .8em; flex-wrap: wrap; }
.pick .ball { width: 3.6em; height: 3.6em; font-size: 1.1em; }
.emojis { display: grid; grid-template-columns: repeat(auto-fill, minmax(3.4em, 1fr)); gap: .4em; }
.emojis button { font: inherit; font-size: 1.6em; line-height: 1; min-height: 2.1em; border-radius: 12px; border: 2px solid var(--line); background: #fff; cursor: pointer; }
.emojis button[aria-pressed="true"] { border-color: var(--fairway); background: var(--tint); box-shadow: inset 0 0 0 2px var(--fairway); }

.people { list-style: none; margin: 0; padding: 0; display: grid; gap: .8em; }
.people li { display: flex; align-items: center; gap: .7em; flex-wrap: wrap; }
.person-name { font-weight: 700; flex: 1; min-width: 6em; overflow-wrap: anywhere; }
.people .seg { flex: none; }

.hostnote { border-left: 5px solid var(--flag); padding: .2em 0 .2em .8em; }
.status { display: flex; align-items: center; gap: .5em; font-weight: 700; color: var(--fairway-dark); }
.actions { display: grid; gap: .5em; }

.notes { border: 2px solid var(--line); border-radius: 12px; padding: .2em .9em; }
.notes[open] { padding-bottom: .9em; }
.notes summary { cursor: pointer; font-weight: 700; color: var(--fairway); min-height: 2.6em; display: flex; align-items: center; }
.notes-inner { display: grid; gap: .7em; }
.msgs { list-style: none; margin: 0; padding: 0; display: grid; gap: .6em; }
.msgs li { background: var(--tint); border-radius: 10px; padding: .6em .8em; }

.empty { text-align: left; display: grid; gap: .8em; }

.notice { position: fixed; left: 50%; transform: translateX(-50%); bottom: 1em; width: min(36em, calc(100% - 2em)); background: var(--fairway-dark); color: #fff; border-radius: 14px; padding: 1em 1.1em; display: flex; gap: 1em; align-items: center; box-shadow: 0 10px 30px rgba(20,52,38,.35); z-index: 40; }
.notice.error { background: var(--pin); }
.notice p { flex: 1; }
.notice button { font: inherit; font-weight: 700; background: var(--flag); color: var(--ink); border: 0; border-radius: 10px; min-height: 2.8em; padding: .3em 1.2em; cursor: pointer; }

.overlay { position: fixed; inset: 0; background: rgba(23,35,30,.55); display: grid; place-items: center; padding: 1em; z-index: 50; }
.dialog { background: #fff; border-radius: 16px; padding: 1.4em 1.3em; width: min(30em, 100%); display: grid; gap: 1em; max-height: 90vh; overflow: auto; }
.dialog-actions { display: grid; gap: .5em; }
@media (prefers-reduced-motion: no-preference) {
  .dialog { animation: pop .18s ease-out; }
  @keyframes pop { from { transform: translateY(8px); opacity: 0; } to { transform: none; opacity: 1; } }
}

.search { display: grid; gap: 1em; }
.courselist { list-style: none; margin: 0; padding: 0; display: grid; gap: .8em; }
.course { background: #fff; border: 2px solid var(--line); border-radius: 14px; padding: 1em 1.1em; display: grid; gap: .6em; }
.course h3 { font-size: 1.15em; }
.course-city { color: var(--muted); margin-top: .15em; }
.course-games { font-weight: 700; color: var(--fairway-dark); }
.course .btn { width: auto; justify-self: start; }
.course-actions { display: flex; flex-wrap: wrap; gap: .5em; }

.foot { font-size: .9em; color: var(--muted); display: grid; gap: .5em; border-top: 2px solid var(--line); padding-top: 1.2em; }
.preview { background: #fff; border: 2px dashed var(--muted); border-radius: 10px; padding: .6em .8em; }

@media (max-width: 30em) {
  .pt h1 { font-size: 1.85em; }
  .card { grid-template-columns: 3.8em 1fr; }
  .card-body { padding: .9em .85em 1.1em; }
  .tagline { display: none; }
  .tabs-inner { grid-template-columns: repeat(2, 1fr); gap: .3em; padding: .4em 1em; }
  .tab { min-height: 2.6em; }
  .course .btn { width: 100%; }
}
`;

// ---------- Small components ----------

function FlagMark() {
  return (
    <svg width="30" height="36" viewBox="0 0 30 36" aria-hidden="true">
      <ellipse cx="11" cy="32" rx="9" ry="2.6" fill="rgba(255,255,255,.25)" />
      <rect x="9.5" y="3" width="3" height="29" rx="1.5" fill="#fff" />
      <path d="M12.5 3.5 L28 9.5 L12.5 15.5 Z" fill="#F3C53A" />
    </svg>
  );
}

function Field({ id, label, hint, error, children }) {
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {hint && <p className="hint">{hint}</p>}
      {children}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function Choices({ name, legend, hint, options, value, onChange, row }) {
  return (
    <fieldset className="field">
      <legend className="label">{legend}</legend>
      {hint && <p className="hint">{hint}</p>}
      <div className={`choices${row ? " row" : ""}`}>
        {options.map((o) => (
          <label key={String(o.value)} className="choice">
            <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>
              <strong>{o.label}</strong>
              {o.hint && <span className="choice-hint">{o.hint}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// A person's picture: their initial, an emoji, or a small photo
function Ball({ person, you }) {
  const a = avatarOf(person);
  return (
    <span className={`ball${you ? " you" : ""}${a.kind !== "letter" ? ` ${a.kind}` : ""}`} aria-hidden="true">
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
      <p className="hint">Shown next to your name. Your initial is fine, or pick an emoji or add a photo.</p>
      <div className="pick">
        <Ball person={{ name, avatar: a }} />
        <div className="seg" role="group" aria-labelledby="pic-label">
          <button type="button" aria-pressed={a.kind === "letter"} onClick={() => onChange({ kind: "letter" })}>
            My initial
          </button>
          <button type="button" aria-pressed={a.kind === "emoji"} onClick={() => onChange({ kind: "emoji", emoji: a.kind === "emoji" ? a.emoji : EMOJIS[0] })}>
            An emoji
          </button>
          <button type="button" aria-pressed={a.kind === "photo"} onClick={() => fileRef.current?.click()} disabled={busy}>
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
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function DetailsFields({ v, set, errors, withPicture }) {
  const up = (k) => (e) => set({ ...v, [k]: e.target.value });
  return (
    <>
      <Field id="name" label="Your name" hint="What other golfers will see. A first name, a nickname, whatever you like." error={errors.name}>
        <input id="name" type="text" maxLength={40} autoComplete="nickname" value={v.name} onChange={up("name")} aria-invalid={!!errors.name} />
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
        <div>{d.body}</div>
        <div className="dialog-actions">
          <button ref={confirmRef} className={`btn${d.danger ? " danger-solid" : ""}`} onClick={onConfirm} disabled={busy}>
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

// ---------- Game card ----------

function GroupMessages({ game, onPost }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const msgs = game.messages || [];
  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    const ok = await onPost(game, text.trim());
    setSending(false);
    if (ok) setText("");
  };
  return (
    <details className="notes">
      <summary>Messages for this group ({msgs.length})</summary>
      <div className="notes-inner">
        {msgs.length === 0 ? (
          <p className="muted">No messages yet. Say hello, or let people know if you're running late.</p>
        ) : (
          <ul className="msgs">
            {msgs.map((m) => (
              <li key={m.id}>
                <strong>{m.name}</strong> <span className="muted small">{fmtWhen(m.at)}</span>
                <p>{m.text}</p>
              </li>
            ))}
          </ul>
        )}
        <Field id={`msg-${game.id}`} label="Write a message">
          <textarea id={`msg-${game.id}`} rows={2} maxLength={300} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <button className="btn secondary" onClick={send} disabled={sending || !text.trim()}>
          {sending ? "Sending…" : "Send message"}
        </button>
      </div>
    </details>
  );
}

function GameCard({ game, me, onJoin, onLeave, onCancel, onPostMessage }) {
  const d = parseDate(game.date);
  const inGame = game.players.some((p) => p.id === me.id);
  const isHost = game.hostId === me.id;
  const open = game.totalSpots - game.players.length;
  const seats = Array.from({ length: game.totalSpots }, (_, i) => game.players[i] || null);
  const rel = relDay(game.date);

  return (
    <article className={`card${game.cancelled ? " cancelled" : ""}`} aria-label={`${game.course}, ${fmtLongDate(game.date)}`}>
      <div className="card-date" aria-hidden="true">
        <span className="dow">{d.toLocaleDateString("en-CA", { weekday: "short" })}</span>
        <span className="dnum">{d.getDate()}</span>
        <span className="mon">{d.toLocaleDateString("en-CA", { month: "short" })}</span>
      </div>
      <div className="card-body">
        <div className="tags">
          <span className="tag">{TYPES[game.type]}</span>
          {game.cancelled && <span className="tag stop">Cancelled by the host</span>}
          {!game.cancelled && open > 0 && (
            <span className="tag flag">
              {open} open {open === 1 ? "spot" : "spots"}
            </span>
          )}
          {!game.cancelled && open === 0 && <span className="tag">Full</span>}
        </div>

        <h3>{game.course}</h3>

        <dl className="facts">
          <dt>When</dt>
          <dd>
            {fmtLongDate(game.date)}, {fmtTime(game.time)}
            {rel && ` (${rel})`}
          </dd>
          <dt>Tee time</dt>
          <dd>{game.teeBooked ? "Booked by the host" : "Not booked yet"}</dd>
          <dt>Pace</dt>
          <dd>
            {VIBES[game.vibe].label}, {VIBES[game.vibe].hint}
          </dd>
          <dt>Meet</dt>
          <dd>{game.meetAt}</dd>
          <dt>Area</dt>
          <dd>{game.area}</dd>
        </dl>

        {game.note && (
          <p className="hostnote">
            {game.note} <span className="muted">({game.players[0]?.name})</span>
          </p>
        )}

        <div>
          <p className="group-label">The group</p>
          <div className="seats">
            {seats.map((p, i) =>
              p ? (
                <div className="seat" key={p.id}>
                  <Ball person={p} you={p.id === me.id} />
                  <span className="seat-name">{p.id === me.id ? "You" : p.name}</span>
                  {i === 0 && <span className="seat-role">Host</span>}
                </div>
              ) : (
                <div className="seat" key={`open-${i}`}>
                  <span className="ball open" aria-hidden="true">
                    Open
                  </span>
                  <span className="seat-name">Open spot</span>
                </div>
              )
            )}
          </div>
        </div>

        {!game.cancelled && (
          <div className="actions">
            {isHost ? (
              <>
                <p className="status">You're hosting this game.</p>
                <button className="btn danger" onClick={() => onCancel(game)}>
                  Cancel this game
                </button>
              </>
            ) : inGame ? (
              <>
                <p className="status">You're in this game.</p>
                <button className="btn danger" onClick={() => onLeave(game)}>
                  Leave this game
                </button>
              </>
            ) : open > 0 ? (
              <button className="btn" onClick={() => onJoin(game)}>
                Join this game
              </button>
            ) : (
              <button className="btn" disabled>
                This game is full
              </button>
            )}
          </div>
        )}

        {(isHost || inGame) && !game.cancelled && <GroupMessages game={game} onPost={onPostMessage} />}
      </div>
    </article>
  );
}

// ---------- Screens ----------

function Intro() {
  return (
    <section>
      <h1>Find people to golf with in BC.</h1>
      <p className="lede">
        Join a group heading to a pitch & putt or a full course, or post your own tee time and let others fill the spots. It's free.
      </p>
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
    </section>
  );
}

// Sign in with an email link or the 6-digit code from the same email. No passwords.
function SignIn({ onSignedIn, legacy, startNotice }) {
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
    <main className="wrap">
      {step === "email" && <Intro />}

      {step === "email" ? (
        <section className="panel" aria-labelledby="signin-h">
          <h2 id="signin-h">Sign in or join</h2>
          {note && <p className="status">{note}</p>}
          <Field id="email" label="Your email address" hint="No password needed. We'll email you a link to tap." error={error}>
            <input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendLink()}
              aria-invalid={!!error}
            />
          </Field>
          <button className="btn" onClick={sendLink} disabled={busy}>
            {busy ? "Sending…" : "Email me a sign-in link"}
          </button>
          <p className="hint">New here? Same button. We'll ask for your name and area next.</p>
        </section>
      ) : (
        <section className="panel" aria-labelledby="code-h">
          <h2 id="code-h">Check your email</h2>
          <p>
            We sent a sign-in link to <strong>{email.trim()}</strong>. Tap the link in that email, or type the 6-digit code from it here.
          </p>
          <Field id="code" label="6-digit code" error={error}>
            <input
              ref={codeRef}
              id="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && useCode()}
              aria-invalid={!!error}
              style={{ maxWidth: "9em", letterSpacing: ".15em", fontSize: "1.2em" }}
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

// First sign-in: the details other golfers see
function Welcome({ me, legacy, onDone }) {
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
    <main className="wrap">
      <Intro />
      <section className="panel" aria-labelledby="welcome-h">
        <h2 id="welcome-h">Welcome. A couple of details</h2>
        <p className="hint">You're signed in as {me.email}.</p>
        <DetailsFields v={v} set={setV} errors={errors} />
        <label className="check">
          <input type="checkbox" checked={newsletter} onChange={(e) => setNewsletter(e.target.checked)} />
          <span>
            Yes, email me the Putt Together newsletter now and then, with group outings, course news, and golf events around BC. I can unsubscribe
            any time.
          </span>
        </label>
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
    <section className="panel" aria-labelledby="pic-h">
      <h2 id="pic-h">Add a picture?</h2>
      <p>It helps people recognize you at the course. Your initial works too.</p>
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
    <section className="panel" aria-labelledby="how-h">
      <h2 id="how-h">How was your game at {game.course}?</h2>
      <p>
        {fmtLongDate(game.date)}. Would you play with them again? Your answers are private.
      </p>
      <ul className="people">
        {pending.map((p) => (
          <li key={p.id}>
            <Ball person={p} />
            <span className="person-name">{p.name}</span>
            <div className="seg" role="group" aria-label={`Would you play with ${p.name} again?`}>
              <button onClick={() => onAnswer(game, p, "yes")}>Yes, happily</button>
              <button onClick={() => onAnswer(game, p, "no")}>Rather not</button>
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
  const live = games.filter((g) => !g.cancelled);
  const list = live
    .filter(
      (g) =>
        (filters.area === "all" || g.area === filters.area) &&
        (filters.type === "any" || g.type === filters.type) &&
        (!filters.course || courseKey(g.course) === courseKey(filters.course))
    )
    .sort((a, b) => gameStart(a) - gameStart(b));
  const noGames = live.length === 0;

  return (
    <main className="wrap">
      <section>
        <h1>Hi {me.name.replace(/\.$/, "")}.</h1>
        <p className="lede">Here's who's heading out. Tap Join on any game with an open spot.</p>
      </section>

      {toAsk ? <HowDidItGo game={toAsk} {...askProps} /> : showPicture ? <PicturePanel me={me} {...pictureProps} /> : null}

      <section className="panel filters" aria-label="Filter games">
        <Field id="f-area" label="Area">
          <select id="f-area" value={filters.area} onChange={(e) => setFilters({ ...filters, area: e.target.value })}>
            <option value="all">All of BC</option>
            {AREAS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </Field>
        <div className="field">
          <span className="label" id="f-type">
            Type of golf
          </span>
          <div className="seg" role="group" aria-labelledby="f-type">
            {[["any", "Any"], ...Object.entries(TYPES)].map(([val, label]) => (
              <button key={val} aria-pressed={filters.type === val} onClick={() => setFilters({ ...filters, type: val })}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {filters.course && !noGames && (
        <section className="panel">
          <p>
            Showing games at <strong>{filters.course}</strong> only.
          </p>
          <button className="linkbtn" onClick={() => setFilters({ ...filters, course: "" })}>
            Show games at all courses
          </button>
        </section>
      )}

      {noGames ? (
        <section className="panel empty">
          <h2>No games posted yet</h2>
          <p>Be the first. Post a tee time and other golfers can join you.</p>
          <button className="btn" onClick={goHost}>
            Host a game
          </button>
        </section>
      ) : (
        <>
          <div className="listhead">
            <h2>
              {list.length} upcoming {list.length === 1 ? "game" : "games"}
            </h2>
            <button className="linkbtn" onClick={onRefresh} disabled={refreshing}>
              {refreshing ? "Checking…" : "Check for new games"}
            </button>
          </div>
          {list.length === 0 ? (
            <section className="panel empty">
              <p>
                Nothing matches right now{filters.area !== "all" ? ` in ${filters.area}` : ""}. Try All of BC, or post a game yourself.
              </p>
              <button className="btn" onClick={goHost}>
                Host a game
              </button>
            </section>
          ) : (
            list.map((g) => <GameCard key={g.id} game={g} me={me} {...cardProps} />)
          )}
        </>
      )}
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
    area: me.area,
    date: tomorrow,
    time: "09:00",
    totalSpots: 4,
    teeBooked: false,
    vibe: "casual",
    meetAt: "At the pro shop, 15 minutes before tee time",
    note: "",
  };
  const [f, setF] = useState(() => {
    const c = prefill && findCourse(prefill);
    return c ? { ...blank, course: c.name, area: c.area, type: bestType(c) } : blank;
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const up = (k, val) => setF((p) => ({ ...p, [k]: val }));
  const areaCourses = useMemo(() => COURSES.filter((c) => c.area === f.area).sort(byName), [f.area]);

  // Picking a course from the list fills in its area and type of golf
  const chooseCourse = (value) =>
    setF((p) => {
      const c = findCourse(value);
      if (!c) return { ...p, course: value };
      return { ...p, course: c.name, area: c.area, type: c.types.includes(p.type) ? p.type : bestType(c) };
    });

  const submit = async () => {
    const e = {};
    if (!f.course.trim()) e.course = "Enter the course name.";
    if (!f.date) e.date = "Pick a date.";
    if (!f.time) e.time = "Pick a tee time.";
    if (f.date && f.time && gameStart(f) < new Date()) e.date = "That date and time has already passed. Pick one in the future.";
    if (!f.meetAt.trim()) e.meetAt = "Tell people where to meet.";
    setErrors(e);
    if (Object.keys(e).length) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setSaving(true);
    const ok = await onPost({ ...f, course: f.course.trim(), meetAt: f.meetAt.trim(), note: f.note.trim() });
    setSaving(false);
    if (ok) setF(blank);
  };

  return (
    <main className="wrap">
      <section>
        <h1>Host a game</h1>
        <p className="lede">Post your tee time and let other golfers fill the open spots. You'll see who joins under My games.</p>
      </section>

      <section className="panel" aria-label="Game details">
        <Field id="h-area" label="Area">
          <select id="h-area" value={f.area} onChange={(e) => up("area", e.target.value)}>
            {AREAS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </Field>

        <Field
          id="course"
          label="Course name"
          hint={`Start typing to see courses in ${f.area}. If yours isn't listed, just type its name.`}
          error={errors.course}
        >
          <input
            id="course"
            type="text"
            list="course-list"
            autoComplete="off"
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

        <Choices
          name="type"
          legend="Type of golf"
          row
          value={f.type}
          onChange={(v) => up("type", v)}
          options={Object.entries(TYPES).map(([value, label]) => ({ value, label }))}
        />

        <Field id="date" label="Date" error={errors.date}>
          <input id="date" type="date" min={toISODate(new Date())} value={f.date} onChange={(e) => up("date", e.target.value)} aria-invalid={!!errors.date} />
        </Field>

        <Field id="time" label="Tee time" error={errors.time}>
          <input id="time" type="time" step={60} value={f.time} onChange={(e) => up("time", e.target.value)} aria-invalid={!!errors.time} />
        </Field>

        <Choices
          name="spots"
          legend="How big is the group, including you?"
          row
          value={f.totalSpots}
          onChange={(v) => up("totalSpots", v)}
          options={[
            { value: 2, label: "You + 1", hint: "A pair" },
            { value: 3, label: "You + 2", hint: "A threesome" },
            { value: 4, label: "You + 3", hint: "A full foursome" },
          ]}
        />

        <Choices
          name="booked"
          legend="Have you booked the tee time?"
          value={f.teeBooked}
          onChange={(v) => up("teeBooked", v)}
          options={[
            { value: true, label: "Yes, it's booked" },
            { value: false, label: "Not yet", hint: "We'll book together or walk on" },
          ]}
        />

        <Choices
          name="vibe"
          legend="What's the pace?"
          value={f.vibe}
          onChange={(v) => up("vibe", v)}
          options={Object.entries(VIBES).map(([value, x]) => ({ value, label: x.label, hint: x.hint[0].toUpperCase() + x.hint.slice(1) }))}
        />

        <Field id="meetAt" label="Where should everyone meet?" error={errors.meetAt}>
          <input id="meetAt" type="text" value={f.meetAt} onChange={(e) => up("meetAt", e.target.value)} aria-invalid={!!errors.meetAt} />
        </Field>

        <Field id="note" label="Anything else people should know?" hint="Optional. For example: walking, not riding, or beginners welcome.">
          <textarea id="note" rows={3} maxLength={280} value={f.note} onChange={(e) => up("note", e.target.value)} />
        </Field>

        <button className="btn" onClick={submit} disabled={saving}>
          {saving ? "Posting…" : "Post this game"}
        </button>
      </section>
    </main>
  );
}

function CourseList({ me, games, onHostHere, onSeeGames }) {
  const [area, setArea] = useState(me.area);
  const [type, setType] = useState("any");
  const [query, setQuery] = useState("");

  const gameCounts = useMemo(() => {
    const counts = {};
    games.filter((g) => !g.cancelled).forEach((g) => {
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

  const where = area === "all" ? "across BC" : `in ${area}`;

  return (
    <main className="wrap">
      <section>
        <h1>Courses near you</h1>
        <p className="lede">Every golf course and pitch & putt we know of in BC. Pick one to host a game there.</p>
      </section>

      <section className="panel search" aria-label="Filter courses">
        <Field id="c-area" label="Area">
          <select id="c-area" value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="all">All of BC</option>
            {AREAS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </Field>
        <div className="field">
          <span className="label" id="c-type">
            Type of golf
          </span>
          <div className="seg" role="group" aria-labelledby="c-type">
            {[["any", "Any"], ...Object.entries(TYPES)].map(([val, label]) => (
              <button key={val} aria-pressed={type === val} onClick={() => setType(val)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <Field id="c-search" label="Search by course or town" hint="Optional.">
          <input id="c-search" type="text" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} />
        </Field>
      </section>

      <h2 aria-live="polite">
        {list.length} {list.length === 1 ? "course" : "courses"} {where}
      </h2>

      {list.length === 0 ? (
        <section className="panel empty">
          <p>No courses match. Try All of BC or Any type, or clear the search.</p>
        </section>
      ) : (
        <ul className="courselist">
          {list.map((c) => {
            const count = gameCounts[courseKey(c.name)] || 0;
            return (
              <li key={c.name} className="course">
                <div>
                  <h3>{c.name}</h3>
                  <p className="course-city">
                    {c.city}
                    {area === "all" && `, ${c.area}`}
                  </p>
                </div>
                <div className="tags">
                  {c.types.map((t) => (
                    <span key={t} className="tag">
                      {TYPES[t]}
                    </span>
                  ))}
                  {c.access === "members" && <span className="tag">Members and guests only</span>}
                  {c.note && <span className="tag stop">{c.note}</span>}
                </div>
                {count > 0 && (
                  <p className="course-games">
                    {count} upcoming {count === 1 ? "game" : "games"} here
                  </p>
                )}
                <div className="course-actions">
                  {count > 0 && (
                    <button className="btn" onClick={() => onSeeGames(c)}>
                      See {count === 1 ? "the game" : "the games"}
                    </button>
                  )}
                  <button className={`btn${count > 0 ? " secondary" : ""}`} onClick={() => onHostHere(c)}>
                    Host a game here
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="muted">Don't see your course? You can type any course name when you host a game.</p>
    </main>
  );
}

function NewsletterPanel({ me, onSubscribe }) {
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  if (me.newsletter) {
    return (
      <section className="panel">
        <h2>Newsletter</h2>
        <p>
          You're signed up with {me.email}. To stop it, use the unsubscribe link at the bottom of any newsletter email.
        </p>
      </section>
    );
  }
  return (
    <section className="panel">
      <h2>Newsletter</h2>
      <p>A short email now and then with group outings, course news, and golf events around BC.</p>
      <label className="check">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>Yes, email me the Putt Together newsletter at {me.email}. I can unsubscribe any time.</span>
      </label>
      <button
        className="btn secondary"
        disabled={!agree || busy}
        onClick={async () => {
          setBusy(true);
          await onSubscribe();
          setBusy(false);
        }}
      >
        {busy ? "Signing you up…" : "Sign me up"}
      </button>
    </section>
  );
}

function MyGames({ games, me, goFind, goHost, cardProps, onSaveDetails, onSubscribe, onSignOut, onUnhide }) {
  const hosting = games.filter((g) => g.hostId === me.id && !g.cancelled).sort((a, b) => gameStart(a) - gameStart(b));
  const joined = games
    .filter((g) => g.hostId !== me.id && g.players.some((p) => p.id === me.id))
    .sort((a, b) => gameStart(a) - gameStart(b));
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState({ name: me.name, area: me.area, avatar: me.avatar });
  const [errors, setErrors] = useState({});
  const hidden = me.hidden || [];

  const save = async () => {
    const e = validateDetails(v);
    setErrors(e);
    if (Object.keys(e).length) return;
    await onSaveDetails(v);
    setEditing(false);
  };

  return (
    <main className="wrap">
      <section>
        <h1>My games</h1>
        <p className="lede">Games you're hosting and games you've joined.</p>
      </section>

      <h2>You're hosting</h2>
      {hosting.length === 0 ? (
        <section className="panel empty">
          <p>You're not hosting any games right now.</p>
          <button className="btn secondary" onClick={goHost}>
            Host a game
          </button>
        </section>
      ) : (
        hosting.map((g) => <GameCard key={g.id} game={g} me={me} {...cardProps} />)
      )}

      <h2>You've joined</h2>
      {joined.length === 0 ? (
        <section className="panel empty">
          <p>You haven't joined any games yet.</p>
          <button className="btn secondary" onClick={goFind}>
            Find a game
          </button>
        </section>
      ) : (
        joined.map((g) => <GameCard key={g.id} game={g} me={me} {...cardProps} />)
      )}

      <section className="panel">
        <h2>Your details</h2>
        {editing ? (
          <>
            <DetailsFields v={v} set={setV} errors={errors} withPicture />
            <button className="btn" onClick={save}>
              Save changes
            </button>
            <button className="btn secondary" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <dl className="facts">
              <dt>Name</dt>
              <dd>{displayName(me)}</dd>
              <dt>Picture</dt>
              <dd>
                <Ball person={me} />
              </dd>
              <dt>Email</dt>
              <dd style={{ overflowWrap: "anywhere" }}>{me.email}</dd>
              <dt>Area</dt>
              <dd>{me.area}</dd>
            </dl>
            <button className="btn secondary" onClick={() => setEditing(true)}>
              Edit my details
            </button>
          </>
        )}
      </section>

      {hidden.length > 0 && (
        <section className="panel" aria-labelledby="hidden-h">
          <h2 id="hidden-h">Golfers you've hidden</h2>
          <p className="hint">You don't see each other's games. They weren't told.</p>
          <ul className="people">
            {hidden.map((p) => (
              <li key={p.id}>
                <span className="person-name">{p.name}</span>
                <button className="linkbtn" onClick={() => onUnhide(p)}>
                  Unhide
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <NewsletterPanel me={me} onSubscribe={onSubscribe} />

      <section className="panel">
        <h2>Signed in</h2>
        <p>
          You're signed in as <strong style={{ overflowWrap: "anywhere" }}>{me.email}</strong> on this device. Signing out doesn't change your games.
        </p>
        <button className="btn secondary" onClick={onSignOut}>
          Sign out
        </button>
      </section>
    </main>
  );
}

// ---------- App ----------

export default function App() {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState(null); // the signed-in member, from the server
  const [games, setGames] = useState([]); // upcoming games this member can see
  const [toAskList, setToAskList] = useState([]); // past games to ask about
  const [tab, setTab] = useState("find");
  const [large, setLarge] = useState(false);
  const [notice, setNotice] = useState(null);
  const [dialog, setDialog] = useState(null);
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
      setNotice({ text: `Welcome back, ${member.name}.` });
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
    setNotice({ text: `Welcome, ${res.member.name}. Here are the games in ${res.member.area}.` });
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
    <dl className="facts">
      <dt>Course</dt>
      <dd>{g.course}</dd>
      <dt>When</dt>
      <dd>
        {fmtLongDate(g.date)}, {fmtTime(g.time)}
      </dd>
      <dt>Meet</dt>
      <dd>{g.meetAt}</dd>
    </dl>
  );

  const askJoin = (game) =>
    setDialog({
      title: "Join this game?",
      body: (
        <>
          {summary(game)}
          <p style={{ marginTop: ".8em" }}>If your plans change, come back and tap Leave this game so someone else can take your spot.</p>
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
          <p style={{ marginTop: ".8em" }}>Your spot will open up for someone else.</p>
        </>
      ),
      confirmLabel: "Yes, leave this game",
      danger: true,
      onConfirm: async () => {
        const res = absorb(await api.gameAction(game.id, "leave"));
        return res.error ? { kind: "error", text: res.error } : { text: `You've left the game at ${game.course}.` };
      },
    });

  const askCancel = (game) =>
    setDialog({
      title: "Cancel this game?",
      body: (
        <>
          {summary(game)}
          <p style={{ marginTop: ".8em" }}>
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
      body: (
        <p>
          The two of you won't see each other's games from now on. {p.name} isn't told. You can undo this later under My games.
        </p>
      ),
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

  return (
    <div className={`pt${large ? " large" : ""}`}>
      <style>{css}</style>

      <header className="top">
        <div className="top-inner">
          <div className="brand">
            <FlagMark />
            <div>
              <div className="wordmark">Putt Together</div>
              <p className="tagline">Find your people. Play a round.</p>
            </div>
          </div>
          <button className="textsize" aria-pressed={large} onClick={toggleText}>
            {large ? "Regular text" : "Larger text"}
          </button>
        </div>
      </header>

      {signedIn && (
        <nav className="tabs" aria-label="Main">
          <div className="tabs-inner">
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
          </div>
        </nav>
      )}

      {loading ? (
        <main className="wrap">
          <p className="lede">Loading…</p>
        </main>
      ) : !me ? (
        <SignIn onSignedIn={handleSignedIn} legacy={legacy} startNotice={startNotice} />
      ) : !me.complete ? (
        <Welcome me={me} legacy={legacy} onDone={finishWelcome} />
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
        <div style={{ maxWidth: "38em", margin: "0 auto", padding: "0 1em 9em" }}>
          <footer className="foot">
            <p>Meet at the course, in public, and let someone know where you're playing.</p>
            <p>Posted games, your name, and your picture (if you add one) are visible to members of Putt Together. Your email stays private.</p>
          </footer>
        </div>
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
