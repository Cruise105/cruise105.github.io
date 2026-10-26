// The DM's Perspective — suite core.
//
// One shared piece that every app on cruise105.github.io loads, so they stop keeping their own copies of
// the same plumbing.
//   Phase 1: shared Google sign-in. Sign in once in any app, and every other app on the site picks it up.
//   Phase 2: shared campaigns and party. One campaign list and one "current campaign" switch for the whole
//            suite, and one party (the Character Sheet's characters, by permanent ID) every app uses.
//
// How it works: Google gives an app a pass (access token) that lasts about an hour. When any app gets one,
// it hands it to the core, which keeps it in this site's browser storage along with which permissions it
// carries and whose Google account it belongs to. Before an app asks you to sign in, it checks here first.
//
// Apps load this file with import('/core/suite.js') and carry on with their own sign-in if it can't load,
// so the suite never becomes a single point of failure.

export const VERSION = 3;
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

/**
 * An app already holds a working pass of its own (from before the suite, or saved from an earlier visit).
 * Share it too, but only when the suite has nothing better: no shared pass, or one that runs out sooner and
 * carries no permission this one lacks. That way a pass with fewer permissions never pushes out a fuller one.
 * Pass { value, exp, scope } with the permissions the app asked for.
 */
export function offer(t, opts = {}) {
  if (!t || !t.value || !(t.exp > Date.now() + MARGIN)) return;
  const cur = read();
  if (cur && cur.value === t.value) return;
  if (cur && cur.value && cur.exp > Date.now() + MARGIN) {
    const mine = new Set(list(t.scope || opts.scope));
    if (cur.exp >= t.exp || !list(cur.scopes).every(s => mine.has(s))) return;
  }
  return share({ value: t.value, exp: t.exp, scope: t.scope || opts.scope }, opts);
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

/* ====================================================================================================
   Phase 2: shared campaigns and party
   ----------------------------------------------------------------------------------------------------
   Both live in the DM's private app-data folder on Google Drive, which every app in the suite can read:
     dmp-suite.json        the campaign list and which one is current (Session Notes keeps it up to date)
     charsheet-party.json  every character, written by the Character Sheet on the DM's device
   A copy of each is kept on the device, so apps know the current campaign and party while offline.
   Every function here takes the app's own Google pass (`token`) and needs the drive.appdata permission.
   ==================================================================================================== */

export const SUITE_FILE = 'dmp-suite.json';
export const PARTY_FILE = 'charsheet-party.json';
const SN_FILE = 'session-notes-sync.json';
const SUITE_CACHE = 'dmp-suite-cache';
const PARTY_CACHE = 'dmp-party-cache';
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

const cacheGet = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const cacheSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };

async function call(token, url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
  if (r.status === 401) { forget(token); const e = new Error('auth'); e.auth = true; e.status = 401; throw e; }
  if (!r.ok) {
    let msg = `Google Drive answered with an error (${r.status}).`;
    try { msg = (await r.json())?.error?.message || msg; } catch { /* keep generic */ }
    const e = new Error(msg); e.status = r.status; if (r.status === 403 && /insufficient|scope/i.test(msg)) e.scope = true; throw e;
  }
  return r;
}
async function findAppdata(token, name) {
  const q = encodeURIComponent(`name='${name}' and trashed=false`);
  const r = await call(token, `${API}?spaces=appDataFolder&q=${q}&orderBy=modifiedTime desc&fields=files(id,modifiedTime)&pageSize=5`);
  return (await r.json()).files?.[0] || null;
}
/** One JSON file from the DM's private app-data folder, or null if it isn't there. */
export async function readAppdata(token, name) {
  const f = await findAppdata(token, name);
  if (!f) return null;
  const t = await (await call(token, `${API}/${f.id}?alt=media`)).text();
  try { return t ? JSON.parse(t) : null; } catch { return null; }
}
/** Save one JSON file to the DM's private app-data folder (creates it the first time). */
export async function writeAppdata(token, name, data) {
  const body = JSON.stringify(data);
  const f = await findAppdata(token, name);
  if (f) {
    await call(token, `${UPLOAD}/${f.id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
    return;
  }
  const b = `dmp${Math.random().toString(36).slice(2)}`;
  await call(token, `${UPLOAD}?uploadType=multipart&fields=id`, {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` },
    body: `--${b}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ name, parents: ['appDataFolder'] })}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${b}--`,
  });
}

/* ---------- campaigns ---------- */
const emptySuite = () => ({ app: 'dmp-suite', v: 1, campaigns: [], current: { id: '', at: 0 } });
// Newest edit wins, record by record, so two devices never undo each other's changes
function mergeSuite(a, b) {
  const out = emptySuite();
  const byId = new Map();
  for (const c of [...(a?.campaigns || []), ...(b?.campaigns || [])]) {
    if (!c?.id) continue;
    const have = byId.get(c.id);
    if (!have || (c.updatedAt || 0) > (have.updatedAt || 0)) byId.set(c.id, { id: c.id, name: c.name || '', deleted: !!c.deleted, updatedAt: c.updatedAt || 0 });
  }
  out.campaigns = [...byId.values()];
  const ca = a?.current || {}, cb = b?.current || {};
  out.current = (cb.at || 0) > (ca.at || 0) ? { id: cb.id || '', at: cb.at || 0 } : { id: ca.id || '', at: ca.at || 0 };
  return out;
}
function tidy(s) {
  const live = s.campaigns.filter(c => !c.deleted);
  if (!live.some(c => c.id === s.current.id)) s.current = { id: live[0]?.id || '', at: s.current.at || 0 };
  return s;
}

/**
 * The campaign list and the current campaign, from Drive (kept on the device for offline use).
 * The first time, it's built from Session Notes' campaigns, so your existing campaigns keep their IDs.
 */
export async function loadSuite(token) {
  let s = await readAppdata(token, SUITE_FILE);
  if (!s || s.app !== 'dmp-suite') {
    const sn = await readAppdata(token, SN_FILE).catch(e => { if (e.auth) throw e; return null; });
    const camps = (sn?.campaigns || []).filter(c => c?.id && !c.deleted);
    if (!camps.length) return tidy(mergeSuite(cacheGet(SUITE_CACHE), null));
    const newest = [...camps].sort((x, y) => (y.updatedAt || y.createdAt || 0) - (x.updatedAt || x.createdAt || 0))[0];
    s = { ...emptySuite(), campaigns: camps.map(c => ({ id: c.id, name: c.name || '', updatedAt: c.updatedAt || c.createdAt || 1 })), current: { id: newest.id, at: 1 } };
    await writeAppdata(token, SUITE_FILE, s);
  }
  s = tidy(mergeSuite(cacheGet(SUITE_CACHE), s));
  cacheSet(SUITE_CACHE, s);
  return s;
}

/**
 * Change the campaign list or switch the current campaign, for every app.
 * patch: { campaigns: [{ id, name, deleted }], current: 'campaign id' }
 */
export async function saveSuite(token, patch = {}) {
  const now = Date.now();
  const mine = emptySuite();
  mine.campaigns = (patch.campaigns || []).map(c => ({ ...c, updatedAt: c.updatedAt || now }));
  if (patch.current) mine.current = { id: patch.current, at: now };
  // Offline: keep the change on this device; it goes up with the next save that reaches Drive
  const local = tidy(mergeSuite(cacheGet(SUITE_CACHE), mine));
  cacheSet(SUITE_CACHE, local);
  const remote = await readAppdata(token, SUITE_FILE);
  const merged = tidy(mergeSuite(remote?.app === 'dmp-suite' ? remote : emptySuite(), local));
  await writeAppdata(token, SUITE_FILE, merged);
  cacheSet(SUITE_CACHE, merged);
  return merged;
}

/** What this device last knew, without going to Drive. */
export function cachedSuite() { return tidy(mergeSuite(cacheGet(SUITE_CACHE), null)); }
export function campaigns() { return cachedSuite().campaigns.filter(c => !c.deleted); }
export function currentCampaign() {
  const s = cachedSuite();
  return s.campaigns.find(c => c.id === s.current.id && !c.deleted) || null;
}

/* ---------- party ---------- */
/** Every character the Character Sheet knows (each with its permanent id and campaignId), from Drive. */
export async function loadParty(token) {
  const p = await readAppdata(token, PARTY_FILE);
  if (p?.app === 'charsheet-party') cacheSet(PARTY_CACHE, { updated: p.updated || 0, chars: p.chars || [] });
  return cachedParty();
}
export function cachedParty() { return cacheGet(PARTY_CACHE)?.chars || []; }
/** The characters in one campaign (the current one if none is given). */
export function party(campaignId) {
  const id = campaignId || currentCampaign()?.id || '';
  return cachedParty().filter(c => c.campaignId === id);
}
