import { useState, useEffect, useMemo, useCallback, useRef } from "react";

/*
  PUTT TOGETHER — find people to golf with across BC

  Newsletter (Beehiiv) setup:
  Beehiiv's API key must never live in browser code (anyone could read it and
  edit your subscriber list). So this app sends sign-ups to a small server
  function, and that function talks to Beehiiv. See netlify/functions/subscribe.mjs.
  Add BEEHIIV_API_KEY and BEEHIIV_PUBLICATION_ID in Netlify's environment
  variables to switch it on. Until then, sign-ups are kept and retried later.

  Shared storage: posted games are saved with netlify/functions/storage.mjs.
  See src/storage.js.
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

// Suggestions only. People can type any course name.
const COURSES = [
  "Stanley Park Pitch & Putt",
  "Queen Elizabeth Pitch & Putt",
  "Rupert Park Pitch & Putt",
  "Central Park Pitch & Putt",
  "Langara Golf Course",
  "Fraserview Golf Course",
  "McCleery Golf Course",
  "Burnaby Mountain Golf Course",
  "Riverway Golf Course",
  "Cedar Hill Golf Course",
];

const GAMES_KEY = "putt-games-v1"; // shared: everyone sees posted games
const PROFILE_KEY = "putt-profile-v1"; // personal: only this person
const TEXT_KEY = "putt-textsize-v1"; // personal

// ---------- Storage (Claude artifact storage, with an in-memory fallback) ----------

const memoryStore = {};
const store = {
  async get(key, shared) {
    if (typeof window === "undefined" || !window.storage) return memoryStore[`${shared}:${key}`] ?? null;
    try {
      const r = await window.storage.get(key, shared);
      return r ? JSON.parse(r.value) : null;
    } catch {
      return null;
    }
  },
  async set(key, value, shared) {
    if (typeof window === "undefined" || !window.storage) {
      memoryStore[`${shared}:${key}`] = value;
      return true;
    }
    try {
      const r = await window.storage.set(key, JSON.stringify(value), shared);
      return !!r;
    } catch {
      return false;
    }
  },
  async del(key, shared) {
    if (typeof window === "undefined" || !window.storage) {
      delete memoryStore[`${shared}:${key}`];
      return true;
    }
    try {
      await window.storage.delete(key, shared);
      return true;
    } catch {
      return false;
    }
  },
};

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

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
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
const displayName = (p) => (p.lastInitial ? `${p.firstName.trim()} ${p.lastInitial.toUpperCase()}.` : p.firstName.trim());
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

function validateDetails(v) {
  const e = {};
  if (!v.firstName.trim()) e.firstName = "Enter your first name.";
  if (!validEmail(v.email)) e.email = "Enter an email address like name@example.com.";
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
.tabs-inner { max-width: 38em; margin: 0 auto; display: grid; grid-template-columns: repeat(3, 1fr); gap: .4em; padding: .5em 1em; }
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
.ball { width: 2.9em; height: 2.9em; border-radius: 50%; display: grid; place-items: center; font-weight: 700; background: var(--fairway); color: #fff; }
.ball.you { background: var(--flag); color: var(--ink); }
.ball.open { background: #fff; border: 3px dashed var(--fairway); color: var(--fairway); font-size: .85em; }
.seat-name { font-size: .85em; line-height: 1.2; overflow-wrap: anywhere; }
.seat-role { font-size: .8em; color: var(--muted); }

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

.foot { font-size: .9em; color: var(--muted); display: grid; gap: .5em; border-top: 2px solid var(--line); padding-top: 1.2em; }
.preview { background: #fff; border: 2px dashed var(--muted); border-radius: 10px; padding: .6em .8em; }

@media (max-width: 30em) {
  .pt h1 { font-size: 1.85em; }
  .card { grid-template-columns: 3.8em 1fr; }
  .card-body { padding: .9em .85em 1.1em; }
  .tagline { display: none; }
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

function DetailsFields({ v, set, errors }) {
  const up = (k) => (e) => set({ ...v, [k]: e.target.value });
  return (
    <>
      <Field id="firstName" label="First name" error={errors.firstName}>
        <input id="firstName" type="text" autoComplete="given-name" value={v.firstName} onChange={up("firstName")} aria-invalid={!!errors.firstName} />
      </Field>
      <Field id="lastInitial" label="First letter of your last name" hint="Optional. Helps tell two Daves apart.">
        <input id="lastInitial" type="text" maxLength={1} autoComplete="off" value={v.lastInitial} onChange={up("lastInitial")} style={{ maxWidth: "5em" }} />
      </Field>
      <Field id="email" label="Email address" hint="Kept private. Other golfers never see it." error={errors.email}>
        <input id="email" type="email" inputMode="email" autoComplete="email" value={v.email} onChange={up("email")} aria-invalid={!!errors.email} />
      </Field>
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
          {game.sample && <span className="tag">Sample</span>}
          {game.cancelled && <span className="tag stop">Cancelled by the host</span>}
          {!game.cancelled && !game.sample && open > 0 && (
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
                  <span className={`ball${p.id === me.id ? " you" : ""}`} aria-hidden="true">
                    {initials(p.name)}
                  </span>
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

        {!game.sample && !game.cancelled && (
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

        {game.sample && <p className="muted">This is a sample. Real games posted by golfers will show up here.</p>}

        {(isHost || inGame) && !game.cancelled && <GroupMessages game={game} onPost={onPostMessage} />}
      </div>
    </article>
  );
}

// ---------- Screens ----------

function Onboarding({ onDone }) {
  const [v, setV] = useState({ firstName: "", lastInitial: "", email: "", area: "" });
  const [newsletter, setNewsletter] = useState(false);
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

      <section className="panel" aria-labelledby="start-h">
        <h2 id="start-h">Get started</h2>
        <DetailsFields v={v} set={setV} errors={errors} />
        <label className="check">
          <input type="checkbox" checked={newsletter} onChange={(e) => setNewsletter(e.target.checked)} />
          <span>
            Yes, email me the Putt Together newsletter now and then, with group outings, course news, and golf events around BC. I can unsubscribe
            any time.
          </span>
        </label>
        <button className="btn" onClick={submit} disabled={saving}>
          {saving ? "Setting up…" : "Start finding games"}
        </button>
        <p className="hint">Other golfers see your first name, last initial, and area. Nothing else.</p>
      </section>
    </main>
  );
}

function FindGames({ games, samples, me, filters, setFilters, onRefresh, refreshing, goHost, cardProps }) {
  const live = games.filter((g) => !g.cancelled);
  const list = live
    .filter((g) => (filters.area === "all" || g.area === filters.area) && (filters.type === "any" || g.type === filters.type))
    .sort((a, b) => gameStart(a) - gameStart(b));
  const showSamples = live.length === 0;

  return (
    <main className="wrap">
      <section>
        <h1>Hi {me.firstName}.</h1>
        <p className="lede">Here's who's heading out. Tap Join on any game with an open spot.</p>
      </section>

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

      {showSamples ? (
        <>
          <section className="panel empty">
            <h2>No games posted yet</h2>
            <p>Be the first. Post a tee time and other golfers can join you. Below are a few samples of what a posted game looks like.</p>
            <button className="btn" onClick={goHost}>
              Host a game
            </button>
          </section>
          {samples.map((g) => (
            <GameCard key={g.id} game={g} me={me} {...cardProps} />
          ))}
        </>
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

function HostGame({ me, onPost }) {
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
  const [f, setF] = useState(blank);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const up = (k, val) => setF((p) => ({ ...p, [k]: val }));

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
        <Field id="course" label="Course name" hint="Start typing, or enter any course." error={errors.course}>
          <input id="course" type="text" list="course-list" value={f.course} onChange={(e) => up("course", e.target.value)} aria-invalid={!!errors.course} />
          <datalist id="course-list">
            {COURSES.map((c) => (
              <option key={c} value={c} />
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

        <Field id="h-area" label="Area">
          <select id="h-area" value={f.area} onChange={(e) => up("area", e.target.value)}>
            {AREAS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </Field>

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

function MyGames({ games, me, goFind, goHost, cardProps, onSaveDetails, onSubscribe, onStartOver }) {
  const hosting = games.filter((g) => g.hostId === me.id && !g.cancelled).sort((a, b) => gameStart(a) - gameStart(b));
  const joined = games
    .filter((g) => g.hostId !== me.id && g.players.some((p) => p.id === me.id))
    .sort((a, b) => gameStart(a) - gameStart(b));
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState({ firstName: me.firstName, lastInitial: me.lastInitial || "", email: me.email, area: me.area });
  const [errors, setErrors] = useState({});

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
            <DetailsFields v={v} set={setV} errors={errors} />
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

      <NewsletterPanel me={me} onSubscribe={onSubscribe} />

      <button className="linkbtn" onClick={onStartOver}>
        Remove my details from this device
      </button>
    </main>
  );
}

// ---------- App ----------

export default function App() {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState(null);
  const [games, setGames] = useState([]);
  const [tab, setTab] = useState("find");
  const [large, setLarge] = useState(false);
  const [notice, setNotice] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filters, setFilters] = useState({ area: "all", type: "any" });

  const loadGames = useCallback(async () => {
    const g = (await store.get(GAMES_KEY, true)) || [];
    setGames(g.filter(isUpcoming));
  }, []);

  const saveMe = useCallback(async (p) => {
    setMe(p);
    await store.set(PROFILE_KEY, p, false);
  }, []);

  useEffect(() => {
    (async () => {
      const [p, t] = await Promise.all([store.get(PROFILE_KEY, false), store.get(TEXT_KEY, false)]);
      if (t === "large") setLarge(true);
      if (p) {
        setMe(p);
        setFilters((f) => ({ ...f, area: p.area }));
        // Retry a newsletter sign-up that couldn't be sent earlier
        if (p.newsletter && !p.newsletterSynced && NEWSLETTER_ENDPOINT) {
          const ok = await subscribeToNewsletter({ email: p.email, firstName: p.firstName, area: p.area });
          if (ok) saveMe({ ...p, newsletterSynced: true });
        }
      }
      await loadGames();
      setLoading(false);
    })();
  }, [loadGames, saveMe]);

  useEffect(() => {
    if (me && tab !== "host") loadGames();
    window.scrollTo({ top: 0 });
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Always re-read the latest list before changing it, so two people joining
  // at once don't overwrite each other.
  const mutateGames = async (fn) => {
    // If someone else changed the list at the same moment, the save is
    // refused, so we re-read and try again (up to 3 times).
    for (let attempt = 0; attempt < 3; attempt++) {
      const latest = ((await store.get(GAMES_KEY, true)) || []).filter(isUpcoming);
      const result = fn(latest);
      if (result.error) {
        setGames(latest);
        return { error: result.error };
      }
      const ok = await store.set(GAMES_KEY, result.next, true);
      if (ok) {
        setGames(result.next);
        return { ok: true };
      }
    }
    return { error: "That didn't save. Check your internet connection and try again." };
  };

  const samples = useMemo(() => {
    const day = (n) => {
      const x = new Date();
      x.setDate(x.getDate() + n);
      return toISODate(x);
    };
    return [
      {
        id: "sample-1", sample: true, course: "Queen Elizabeth Pitch & Putt", type: "pnp", area: "Metro Vancouver",
        date: day(2), time: "10:00", totalSpots: 4, vibe: "fun", teeBooked: false,
        meetAt: "By the starter's booth, 15 minutes before", note: "New to the area and happy to go slow and chat.",
        hostId: "s-linda", players: [{ id: "s-linda", name: "Linda M." }], messages: [],
      },
      {
        id: "sample-2", sample: true, course: "Fraserview Golf Course", type: "18", area: "Metro Vancouver",
        date: day(4), time: "08:12", totalSpots: 4, vibe: "casual", teeBooked: true,
        meetAt: "At the pro shop, 20 minutes before", note: "Walking, not riding. We play ready golf.",
        hostId: "s-gord", players: [{ id: "s-gord", name: "Gord T." }, { id: "s-raj", name: "Raj P." }], messages: [],
      },
      {
        id: "sample-3", sample: true, course: "Cedar Hill Golf Course", type: "9", area: "Victoria and South Island",
        date: day(6), time: "15:30", totalSpots: 4, vibe: "keen", teeBooked: true,
        meetAt: "At the pro shop, 15 minutes before", note: "",
        hostId: "s-anne", players: [{ id: "s-anne", name: "Anne W." }, { id: "s-bev", name: "Bev K." }, { id: "s-tom", name: "Tom L." }], messages: [],
      },
    ];
  }, []);

  // ----- Actions -----

  const handleOnboard = async (v, newsletter) => {
    const p = {
      id: uid(),
      firstName: v.firstName.trim(),
      lastInitial: v.lastInitial.trim(),
      email: v.email.trim(),
      area: v.area,
      newsletter,
      newsletterSynced: false,
      joinedAt: Date.now(),
    };
    if (newsletter) p.newsletterSynced = await subscribeToNewsletter({ email: p.email, firstName: p.firstName, area: p.area });
    await saveMe(p);
    setFilters({ area: p.area, type: "any" });
    setTab("find");
    setNotice({ text: `Welcome, ${p.firstName}. Here are the games in ${p.area}.` });
  };

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
        const res = await mutateGames((list) => {
          const g = list.find((x) => x.id === game.id);
          if (!g || g.cancelled) return { error: "The host cancelled this game." };
          if (g.players.some((p) => p.id === me.id)) return { next: list };
          if (g.players.length >= g.totalSpots) return { error: "Someone just took the last spot. This game is now full." };
          return { next: list.map((x) => (x.id === g.id ? { ...x, players: [...x.players, { id: me.id, name: displayName(me) }] } : x)) };
        });
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
        const res = await mutateGames((list) => ({
          next: list.map((x) => (x.id === game.id ? { ...x, players: x.players.filter((p) => p.id !== me.id) } : x)),
        }));
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
        const res = await mutateGames((list) => ({ next: list.map((x) => (x.id === game.id ? { ...x, cancelled: true } : x)) }));
        return res.error ? { kind: "error", text: res.error } : { text: "Your game is cancelled." };
      },
    });

  const postMessage = async (game, text) => {
    const res = await mutateGames((list) => ({
      next: list.map((x) =>
        x.id === game.id
          ? { ...x, messages: [...(x.messages || []), { id: uid(), name: displayName(me), text, at: Date.now() }].slice(-30) }
          : x
      ),
    }));
    if (res.error) setNotice({ kind: "error", text: res.error });
    return !res.error;
  };

  const postGame = async (f) => {
    const game = {
      ...f,
      id: uid(),
      hostId: me.id,
      players: [{ id: me.id, name: displayName(me) }],
      messages: [],
      createdAt: Date.now(),
    };
    const res = await mutateGames((list) => ({ next: [...list, game] }));
    if (res.error) {
      setNotice({ kind: "error", text: res.error });
      return false;
    }
    setFilters({ area: game.area, type: "any" });
    setTab("find");
    setNotice({ text: `Your game is posted. Golfers in ${game.area} can see it and join now.` });
    return true;
  };

  const saveDetails = async (v) => {
    const next = { ...me, firstName: v.firstName.trim(), lastInitial: v.lastInitial.trim(), email: v.email.trim(), area: v.area };
    await saveMe(next);
    const name = displayName(next);
    if (name !== displayName(me)) {
      await mutateGames((list) => ({
        next: list.map((g) => ({ ...g, players: g.players.map((p) => (p.id === me.id ? { ...p, name } : p)) })),
      }));
    }
    setNotice({ text: "Your details are saved." });
  };

  const subscribe = async () => {
    const synced = await subscribeToNewsletter({ email: me.email, firstName: me.firstName, area: me.area });
    await saveMe({ ...me, newsletter: true, newsletterSynced: synced });
    setNotice({ text: "You're signed up for the newsletter." });
  };

  const startOver = () =>
    setDialog({
      title: "Remove your details from this device?",
      body: <p>Games you've posted or joined stay listed. You can sign up again any time.</p>,
      confirmLabel: "Yes, remove my details",
      danger: true,
      onConfirm: async () => {
        await store.del(PROFILE_KEY, false);
        setMe(null);
        return { text: "Your details were removed from this device." };
      },
    });

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
    store.set(TEXT_KEY, next ? "large" : "regular", false);
  };

  const cardProps = { onJoin: askJoin, onLeave: askLeave, onCancel: askCancel, onPostMessage: postMessage };

  return (
    <div className={`pt${large ? " large" : ""}`}>
      <style>{css}</style>

      <header className="top">
        <div className="top-inner">
          <div className="brand">
            <FlagMark />
            <div>
              <div className="wordmark">Putt Together</div>
              <p className="tagline">Golf buddies across BC</p>
            </div>
          </div>
          <button className="textsize" aria-pressed={large} onClick={toggleText}>
            {large ? "Regular text" : "Larger text"}
          </button>
        </div>
      </header>

      {me && (
        <nav className="tabs" aria-label="Main">
          <div className="tabs-inner">
            {[
              ["find", "Find a game"],
              ["host", "Host a game"],
              ["mine", "My games"],
            ].map(([key, label]) => (
              <button key={key} className="tab" aria-current={tab === key ? "page" : undefined} onClick={() => setTab(key)}>
                {label}
              </button>
            ))}
          </div>
        </nav>
      )}

      {loading ? (
        <main className="wrap">
          <p className="lede">Loading games…</p>
        </main>
      ) : !me ? (
        <Onboarding onDone={handleOnboard} />
      ) : tab === "find" ? (
        <FindGames
          games={games}
          samples={samples}
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
        />
      ) : tab === "host" ? (
        <HostGame me={me} onPost={postGame} />
      ) : (
        <MyGames
          games={games}
          me={me}
          goFind={() => setTab("find")}
          goHost={() => setTab("host")}
          cardProps={cardProps}
          onSaveDetails={saveDetails}
          onSubscribe={subscribe}
          onStartOver={startOver}
        />
      )}

      {!loading && (
        <div style={{ maxWidth: "38em", margin: "0 auto", padding: "0 1em 9em" }}>
          <footer className="foot">
            <p>Meet at the course, in public, and let someone know where you're playing.</p>
            <p>Posted games and your first name are visible to everyone using Putt Together. Your email stays private.</p>
            {!NEWSLETTER_ENDPOINT && (
              <p className="preview">
                Preview mode: newsletter sign-ups are saved in the app but not sent to Beehiiv yet. Add your sign-up link at the top of the code to
                connect it.
              </p>
            )}
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
