// The DM's Perspective — suite core.
//
// One shared piece that every app on cruise105.github.io loads, so they stop keeping their own copies of
// the same plumbing. Phase 1: shared Google sign-in. Sign in once in any app, and every other app on the
// site picks that sign-in up instead of asking again.
//
// How it works: Google gives an app a pass (access token) that lasts about an hour. When any app gets one,
// it hands it to the core, which keeps it in this site's browser storage along with which permissions it
// carries and whose Google account it belongs to. Before an app asks you to sign in, it checks here first.
//
// Apps load this file with import('/core/suite.js') and carry on with their own sign-in if it can't load,
// so the suite never becomes a single point of failure.

export const VERSION = 1;
export const CLIENT_ID = '150155066546-k6e9l4c0fbmel2tdfkv4c4gs41bqd847.apps.googleusercontent.com';
export const SCOPES = {
  appdata: 'https://www.googleapis.com/auth/drive.appdata',
  file: 'https://www.googleapis.com/auth/drive.file',
};

const KEY = 'dmp-suite-token';
const ACCOUNTS = 'dmp-suite-accounts'; // which Google account each app last synced with, so a pass for someone else is never used
const MARGIN = 30000; // treat a pass as expired 30 seconds early, so a request never starts on a dying one

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
function write(t) {
  try { if (t) localStorage.setItem(KEY, JSON.stringify(t)); else localStorage.removeItem(KEY); } catch { /* storage blocked */ }
}
function accounts() { try { return JSON.parse(localStorage.getItem(ACCOUNTS) || '{}') || {}; } catch { return {}; } }
function remember(app, email) {
  if (!app || !email) return;
  const a = accounts(); if (a[app] === email.toLowerCase()) return;
  a[app] = email.toLowerCase();
  try { localStorage.setItem(ACCOUNTS, JSON.stringify(a)); } catch { /* storage blocked */ }
}
const list = s => (Array.isArray(s) ? s : String(s || '').split(/\s+/)).filter(Boolean);

/**
 * The shared sign-in, if there is one this app can use right now.
 * @param {string|string[]} need  the Google permissions this app needs (space-separated or a list)
 * @param {object} [opts]
 * @param {string} [opts.app]     this app's name; once the app has synced with one Google account, a pass for a different account is refused
 * @param {string} [opts.email]   only accept a sign-in for this Google account (when the app knows whose it is)
 * @returns {{value:string, exp:number, scopes:string[], email:string}|null}
 */
export function signedIn(need, opts = {}) {
  const t = read();
  if (!t || !t.value || !(t.exp > Date.now() + MARGIN)) return null;
  if (t.clientId && t.clientId !== CLIENT_ID) return null;
  const have = new Set(list(t.scopes));
  if (!list(need).every(s => have.has(s))) return null;
  const mine = String(t.email || '').toLowerCase();
  const want = String(opts.email || accounts()[opts.app] || '').trim().toLowerCase();
  if (want && mine !== want) return null;       // someone else's account, or not confirmed yet
  if (opts.app && mine) remember(opts.app, mine);
  return { value: t.value, exp: t.exp, scopes: [...have], email: t.email || '' };
}

/**
 * An app just got a pass from Google: share it with the rest of the suite.
 * Pass Google's own response ({ access_token, expires_in, scope }) or { value, exp, scope }.
 * Google lists every permission the pass really carries in `scope`, including ones another app asked for earlier.
 * Resolves once the account's email is known (one small request); the pass is usable by other apps right away.
 */
export async function share(r, opts = {}) {
  const value = r.access_token || r.value;
  if (!value) return;
  const exp = r.exp || Date.now() + (Number(r.expires_in) || 3600) * 1000;
  const prev = read();
  const t = {
    value, exp, clientId: CLIENT_ID,
    scopes: list(r.scope || opts.scope),
    // the same Google account usually signs in again; keep its email until we've confirmed otherwise
    email: opts.email || (prev && prev.value === value ? prev.email : '') || '',
    by: opts.app || '', at: Date.now(),
  };
  write(t);
  if (t.email) { remember(opts.app, t.email); return; }
  try {
    const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', { headers: { Authorization: `Bearer ${value}` } });
    if (!res.ok) return;
    const email = (await res.json())?.user?.emailAddress || '';
    const now = read();
    if (email && now && now.value === value) write({ ...now, email });
    remember(opts.app, email);
  } catch { /* offline: the email gets filled in by the next sign-in */ }
}

/** Google refused this pass (expired or revoked): stop handing it out. Leaves a newer one alone. */
export function forget(value) {
  const t = read();
  if (t && (!value || t.value === value)) write(null);
}

/** For a status line: who's signed in across the suite and for how much longer. */
export function status() {
  const t = read();
  if (!t || !t.value || !(t.exp > Date.now())) return { signedIn: false, email: '', minutesLeft: 0 };
  return { signedIn: true, email: t.email || '', minutesLeft: Math.max(0, Math.round((t.exp - Date.now()) / 60000)) };
}
