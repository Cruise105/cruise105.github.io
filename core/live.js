// The DM's Perspective — live link (Firebase Realtime Database).
//
// Google Drive keeps everything; this carries everything a player sees the moment it changes (their sheet, HP,
// turns, conditions, and what other apps show on their sheet). Nobody signs in: each character has its own long
// secret key that only travels inside their sheet file (so only that player and the DM know it), and the
// database's rules only let a device reach a character whose key it knows. If Firebase can't be reached, every
// app carries on through Drive exactly as before, just slower.

const CONFIG = {
  apiKey: 'AIzaSyBTJAZG0DDAiV6pT43lcFGrfeyparvYxGs',
  authDomain: 'dm-s-perspective-suite.firebaseapp.com',
  databaseURL: 'https://dm-s-perspective-suite-default-rtdb.firebaseio.com',
  projectId: 'dm-s-perspective-suite',
  appId: '1:469695074030:web:6eaec90e6b530a92202dff',
};
const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';

let ready = null;   // the connection, once (or while) it's being made
let fb = null;      // { db, ref, set, onValue }
let lastError = '';

const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} took too long`)), ms))]);

/** Connect (once per page). Resolves to the connection, or null if Firebase can't be reached right now. */
export function connect() {
  if (fb) return Promise.resolve(fb);
  if (ready) return ready;
  ready = (async () => {
    try {
      const [A, U, D] = await withTimeout(Promise.all([
        import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-database.js`),
      ]), 15000, 'Loading Firebase');
      const app = A.getApps().find(a => a.name === 'dmp') || A.initializeApp(CONFIG, 'dmp');
      const auth = U.getAuth(app);
      if (!auth.currentUser) await withTimeout(U.signInAnonymously(auth), 15000, 'Connecting to Firebase');
      fb = { db: D.getDatabase(app), ref: D.ref, set: D.set, onValue: D.onValue, D };
      lastError = '';
      return fb;
    } catch (e) {
      lastError = e?.message || String(e);
      ready = null; // try again next time it's asked for
      return null;
    }
  })();
  return ready;
}
export const error = () => lastError;
export const connected = () => !!fb;

/** A new secret key for a character: 32 random letters and digits. */
export function newKey() {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, b => abc[b % abc.length]).join('');
}
const safe = s => String(s || '').replace(/[.#$[\]/]/g, '_');
const clean = path => String(path || '').split('/').map(safe).join('/');

/* ====================================================================================================
   Per-character live data. Each character has its own secret key (kept in their sheet file, so only that
   player and the DM know it); everything for that character lives under c/<key>:
     view        where the fight stands for them (combat tracker → sheet)
     req         a turn button they tapped (sheet → combat tracker)
     ops/<id>    HP changes (both ways; each has an id, so the Drive copy never counts twice)
     stats       their sheet's numbers: HP, AC, Interrupt Point… (sheet → combat tracker)
     sheet/<p>   any field of their sheet that changed (between the player's devices and the DM's)
     ch/<name>   a channel from another app: sn (Session Notes), mi (Magic Items), boons, conds (combat
                 tracker conditions) and whatever future apps add. Each is { fields: { …sheet fields }, t }.
   ==================================================================================================== */
const okKey = k => typeof k === 'string' && k.length >= 24;
const cpath = (key, path) => `c/${key}${path ? `/${clean(path)}` : ''}`;

/** Save (or with null, remove) a value for one character. */
export async function cput(key, path, value) {
  if (!okKey(key)) return false;
  const c = await connect(); if (!c) return false;
  try { await c.set(c.ref(c.db, cpath(key, path)), value ?? null); return true; } catch (e) { lastError = e.message; return false; }
}
/** Hear one character's value whenever it changes. Returns a stop function. */
export function cwatch(key, path, cb) {
  let stop = null, stopped = false;
  if (okKey(key)) connect().then(c => {
    if (!c || stopped) return;
    stop = c.onValue(c.ref(c.db, cpath(key, path)), snap => cb(snap.val()), e => { lastError = e.message; });
  });
  return () => { stopped = true; stop?.(); };
}
/** An app's channel for one character: the sheet fields it shows there. */
export function channel(key, name, fields) {
  return cput(key, `ch/${name}`, { fields, t: Date.now() });
}
/** Sheet field paths can't go into Firebase keys as they are ("hp.max"); these swap them safely. */
export const encPath = p => String(p).replace(/\./g, '~');
export const decPath = p => String(p).replace(/~/g, '.');
