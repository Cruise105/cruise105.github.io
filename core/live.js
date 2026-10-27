// The DM's Perspective — live link (Firebase Realtime Database).
//
// Google Drive keeps everything; this carries everything a player sees the moment it changes (their sheet, HP,
// turns, conditions, and what other apps show on their sheet). Nobody signs in: each character has its own long
// secret key that only travels inside their sheet file (so only that player and the DM know it), and the
// database's rules only let a device reach a character whose key it knows. Every device must also be signed in
// with a Google account (the suite's own sign-in, used once per device), so nobody can use the live link
// anonymously, and the DM's Perspective can block an account that misuses it. If Firebase can't be reached, every
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

/* ---------- diagnostics: add #livelog to an app's address to see what the live link sends and receives ---------- */
const logLines = [];
let logBox = null;
function log(kind, path, detail = '') {
  const t = new Date();
  logLines.push(`${t.toLocaleTimeString([], { hour12: false })}.${String(t.getMilliseconds()).padStart(3, '0')}  ${kind.padEnd(5)} ${path}${detail ? `  ${detail}` : ''}`);
  if (logLines.length > 60) logLines.shift();
  if (!logBox && typeof location !== 'undefined' && /livelog/.test(location.hash) && typeof document !== 'undefined') {
    logBox = document.createElement('pre');
    logBox.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;max-height:40vh;overflow:auto;z-index:99999;margin:0;padding:8px;'
      + 'background:rgba(0,0,0,.88);color:#9f9;font:11px/1.35 monospace;border:1px solid #4a4;border-radius:6px;white-space:pre-wrap;pointer-events:auto';
    document.body.append(logBox);
  }
  if (logBox) { logBox.textContent = logLines.join('\n'); logBox.scrollTop = logBox.scrollHeight; }
}
export const logText = () => logLines.join('\n');
const short = k => String(k).slice(0, 4);

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
      if (auth.authStateReady) await withTimeout(auth.authStateReady(), 10000, 'Restoring the sign-in');
      // sign in to the live link with this device's Google account (kept by Firebase after the first time)
      if (!auth.currentUser || auth.currentUser.isAnonymous) {
        const pass = await googlePass();
        if (pass) {
          try { await withTimeout(U.signInWithCredential(auth, U.GoogleAuthProvider.credential(null, pass)), 15000, 'Signing in to the live link'); log('ready', 'signed in as a Google account'); }
          catch (e) { log('FAIL', 'Google sign-in', e?.message || String(e)); }
        } else log('FAIL', 'not signed in', 'sign in with Google in the launcher');
      }
      // without a Google account the live link refuses everything; the apps carry on through Drive
      if (!auth.currentUser) await withTimeout(U.signInAnonymously(auth), 15000, 'Connecting to Firebase');
      fb = { db: D.getDatabase(app), ref: D.ref, set: D.set, onValue: D.onValue, onChildAdded: D.onChildAdded, onChildChanged: D.onChildChanged, D, U, auth };
      lastError = '';
      log('ready', 'connected to Firebase');
      return fb;
    } catch (e) {
      lastError = e?.message || String(e);
      log('FAIL', 'connect', lastError);
      ready = null; // try again next time it's asked for
      return null;
    }
  })();
  return ready;
}
export const error = () => lastError;

// The suite's Google pass on this device, waiting a little for an app that's signing in right now.
async function googlePass() {
  const S = await import('./suite.js').catch(() => null);
  if (!S) return null;
  for (let i = 0; i < 30; i++) {
    let p = S.signedIn('');
    if (!p && S.staysSignedIn && S.staysSignedIn()) p = await S.refreshNow().catch(() => null);
    if (p && p.value) return p.value;
    await new Promise(r => setTimeout(r, 1000));
  }
  return null;
}

/**
 * Sign in to the live link as this Google account (tables need a real identity; character channels work either
 * way). accessToken: a Google pass that includes the email permission. Resolves to { uid, email } or null.
 */
export async function identify(accessToken) {
  const c = await connect(); if (!c) return null;
  const u = c.auth.currentUser;
  if (u && !u.isAnonymous) return { uid: u.uid, email: u.email || '' };
  if (!accessToken) return null;
  try {
    const cred = c.U.GoogleAuthProvider.credential(null, accessToken);
    const r = await withTimeout(c.U.signInWithCredential(c.auth, cred), 15000, 'Signing in to the live link');
    log('ready', 'signed in as a Google account');
    return { uid: r.user.uid, email: r.user.email || '' };
  } catch (e) { lastError = e?.message || String(e); log('FAIL', 'identify', lastError); return null; }
}
/** Who the live link knows this device as: { uid, email, google } or null. */
export function who() {
  const u = fb?.auth?.currentUser;
  return u ? { uid: u.uid, email: u.email || '', google: !u.isAnonymous } : null;
}
/** Leave the live link's Google sign-in on this device (character channels carry on anonymously). */
export async function forgetIdentity() {
  const c = await connect(); if (!c) return;
  try { await c.U.signOut(c.auth); await c.U.signInAnonymously(c.auth); } catch { /* */ }
}
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
  if (!okKey(key)) { log('FAIL', `send ${path}`, 'no character key'); return false; }
  const c = await connect(); if (!c) return false;
  const t0 = Date.now();
  try { await c.set(c.ref(c.db, cpath(key, path)), value ?? null); log('sent', `${short(key)}…/${path}`, `${Date.now() - t0} ms`); return true; }
  catch (e) { lastError = e.message; log('FAIL', `send ${short(key)}…/${path}`, e.message); return false; }
}
/** Hear one character's value whenever it changes. Returns a stop function. */
export function cwatch(key, path, cb) {
  let stop = null, stopped = false;
  if (okKey(key)) connect().then(c => {
    if (!c || stopped) return;
    log('watch', `${short(key)}…/${path}`);
    stop = c.onValue(c.ref(c.db, cpath(key, path)), snap => {
      log('got', `${short(key)}…/${path}`, `${JSON.stringify(snap.val() ?? null).length} bytes`);
      try { cb(snap.val()); } catch (e) { log('ERROR', `handling ${short(key)}…/${path}`, e?.message || String(e)); console.error(e); }
    }, e => { lastError = e.message; log('FAIL', `watch ${short(key)}…/${path}`, e.message); });
  });
  return () => { stopped = true; stop?.(); };
}
/**
 * Hear each entry under one character's path, one at a time: every existing entry once, then only an entry
 * that's added or changed (never the whole list again). cb(name, value). Returns a stop function.
 * This keeps a busy list (sheet fields, HP changes, channels) from re-downloading everything on each change.
 */
export function cwatchEach(key, path, cb) {
  let stops = [], stopped = false;
  if (okKey(key)) connect().then(c => {
    if (!c || stopped) return;
    log('watch', `${short(key)}…/${path}/*`);
    const r = c.ref(c.db, cpath(key, path));
    const handle = snap => {
      const v = snap.val();
      log('got', `${short(key)}…/${path}/${snap.key}`, `${JSON.stringify(v ?? null).length} bytes`);
      try { cb(snap.key, v); } catch (e) { log('ERROR', `handling ${short(key)}…/${path}/${snap.key}`, e?.message || String(e)); console.error(e); }
    };
    const fail = e => { lastError = e.message; log('FAIL', `watch ${short(key)}…/${path}`, e.message); };
    stops = [c.onChildAdded(r, handle, fail), c.onChildChanged(r, handle, fail)];
  });
  return () => { stopped = true; stops.forEach(s => s()); };
}
/** An app's channel for one character: the sheet fields it shows there. */
export function channel(key, name, fields) {
  return cput(key, `ch/${name}`, { fields, t: Date.now() });
}
/** Sheet field paths can't go into Firebase keys as they are ("hp.max"); these swap them safely. */
export const encPath = p => String(p).replace(/\./g, '~');
export const decPath = p => String(p).replace(/~/g, '.');
