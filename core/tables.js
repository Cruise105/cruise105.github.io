// The DM's Perspective — tables: who plays together, and who's the DM.
//
// A table lives in the live link (Firebase), protected by its rules with each person's real Google identity:
//   tables/<id>/info              { name, dm: <uid>, dmName, created }   readable by anyone who has the link
//   tables/<id>/members/<uid>     { email, name, status: 'pending'|'approved', code, at }
//   tables/<id>/invites/<code>    { at }                                 the DM's invite links
//   users/<uid>/tables/<id>       { role: 'dm'|'player', name, at }      each person's own list of tables
//   tables/<id>/newsheets/<uid>/<charId>  { json, name, t }   a character a player made, waiting for the DM's app to
//                                 save it in the DM's Drive (the DM owns it, and it's shared back to the player)
// Anyone can create a table and is its DM. A player asks to join with an invite link and waits for the DM to
// approve them. Only the DM can approve, remove or change anything; a player can only ask, or leave.
//
// The table chosen on this device (and the role there) is kept locally, so apps know at once whether to act as
// the DM's or a player's.
import * as live from './live.js';

const CURRENT = 'dmp-suite-table';
const rnd = n => { const abc = 'abcdefghijkmnpqrstuvwxyz23456789'; return Array.from(crypto.getRandomValues(new Uint8Array(n)), b => abc[b % abc.length]).join(''); };
const getLocal = () => { try { return JSON.parse(localStorage.getItem(CURRENT) || 'null'); } catch { return null; } };
const setLocal = t => { try { if (t) localStorage.setItem(CURRENT, JSON.stringify(t)); else localStorage.removeItem(CURRENT); } catch { /* */ } };

/** The table this device is using: { id, name, role: 'dm'|'player', status } or null. */
export const current = () => getLocal();
/** This device's role at its current table: 'dm', 'player', or '' (no table). */
export const role = () => getLocal()?.role || '';
export function choose(t) { setLocal(t ? { id: t.id, name: t.name || '', role: t.role, status: t.status || 'approved' } : null); }

let me = null;
async function db(token) {
  const c = await live.connect(); if (!c) throw new Error("Couldn't reach the live link. Check the connection.");
  if (!me || !live.who()?.google) me = await live.identify(token);
  if (!me) throw new Error("Couldn't sign in to tables with your Google account. Sign out and in again in the launcher.");
  return c;
}
const val = async (c, path) => (await c.D.get(c.ref(c.db, path))).val();

/** Your tables, as DM or player: [{ id, name, role, status }]. Players' approval is checked against the table. */
export async function mine(token) {
  const c = await db(token);
  const list = Object.entries((await val(c, `users/${me.uid}/tables`)) || {}).map(([id, t]) => ({ id, ...t }));
  for (const t of list) {
    // a DM only counts as DM if the table itself says so (never just your own list)
    if (t.role !== 'player') {
      const dm = await val(c, `tables/${t.id}/info/dm`).catch(() => null);
      t.role = dm === me.uid ? 'dm' : 'player';
      if (t.role === 'dm') { t.status = 'approved'; continue; }
    }
    const m = await val(c, `tables/${t.id}/members/${me.uid}`).catch(() => null);
    t.status = m?.status || 'removed';
    if (t.status === 'approved' && t.waiting) { await c.D.update(c.ref(c.db, `users/${me.uid}/tables/${t.id}`), { waiting: null }); delete t.waiting; }
  }
  return list.sort((a, b) => (a.role === b.role ? (a.name || '').localeCompare(b.name || '') : a.role === 'dm' ? -1 : 1));
}

/** Start a new table; you're its DM. */
export async function create(token, name, dmName = '') {
  const c = await db(token);
  const id = rnd(20), at = Date.now();
  await c.set(c.ref(c.db, `tables/${id}/info`), { name: name || 'My table', dm: me.uid, dmName: dmName || me.email.split('@')[0], created: at });
  await c.set(c.ref(c.db, `users/${me.uid}/tables/${id}`), { role: 'dm', name: name || 'My table', at });
  return { id, name: name || 'My table', role: 'dm', status: 'approved' };
}

/** DM: an invite link for this table (a new one each time; old ones keep working until you turn them off). */
export async function invite(token, id) {
  const c = await db(token);
  const code = rnd(10);
  await c.set(c.ref(c.db, `tables/${id}/invites/${code}`), { at: Date.now() });
  return `${location.origin}/index.html?join=${id}~${code}`;
}
/** DM: stop every invite link for this table (members stay). */
export async function closeInvites(token, id) { const c = await db(token); await c.set(c.ref(c.db, `tables/${id}/invites`), null); }

/** The name and DM of a table, from an invite link (anyone signed in can see this). */
export async function peek(token, id) { const c = await db(token); return val(c, `tables/${id}/info`); }

/** Player: ask to join a table with an invite code. */
export async function requestJoin(token, id, code, name = '') {
  const c = await db(token);
  const info = await val(c, `tables/${id}/info`);
  if (!info) throw new Error("That table doesn't exist anymore.");
  if (info.dm === me.uid) { choose({ id, name: info.name, role: 'dm' }); return { id, name: info.name, role: 'dm', status: 'approved' }; }
  const have = await val(c, `tables/${id}/members/${me.uid}`).catch(() => null);
  if (!have) {
    try { await c.set(c.ref(c.db, `tables/${id}/members/${me.uid}`), { email: me.email, name: name || me.email.split('@')[0], status: 'pending', code, at: Date.now() }); }
    catch { throw new Error('That invite link has been turned off. Ask your DM for a new one.'); }
  }
  await c.set(c.ref(c.db, `users/${me.uid}/tables/${id}`), { role: 'player', name: info.name, at: Date.now(), waiting: !have || have.status !== 'approved' ? true : null });
  return { id, name: info.name, role: 'player', status: have?.status || 'pending' };
}

/** DM: everyone who asked to join or plays at the table, kept up to date. cb([{ uid, email, name, status }]). */
export function watchMembers(token, id, cb) {
  let stop = null, stopped = false;
  db(token).then(c => {
    if (stopped) return;
    stop = c.onValue(c.ref(c.db, `tables/${id}/members`), s => cb(Object.entries(s.val() || {}).map(([uid, m]) => ({ uid, ...m }))), () => cb([]));
  }).catch(() => cb([]));
  return () => { stopped = true; stop?.(); };
}
/** DM: approve someone waiting, or remove a player (removing also declines a request). */
export async function approve(token, id, uid) { const c = await db(token); await c.D.update(c.ref(c.db, `tables/${id}/members/${uid}`), { status: 'approved' }); }
export async function remove(token, id, uid) { const c = await db(token); await c.set(c.ref(c.db, `tables/${id}/members/${uid}`), null); }
/** Approved players' emails at the current table (DM), for sharing character sheets. */
export async function playerEmails(token, id = current()?.id) {
  if (!id || role() !== 'dm') return [];
  const c = await db(token);
  return Object.values((await val(c, `tables/${id}/members`)) || {}).filter(m => m.status === 'approved' && m.email).map(m => ({ email: m.email, name: m.name || '' }));
}
/* ---------- which sheets the DM shared with whom (so a player's app can offer them without searching) ----------
   tables/<id>/members/<uid>/sheets/<charId>  { file: Drive file id, name, at }   members/<uid>/lib: the Table Library's file
   Only the DM writes these; each player can read only their own. */
/** DM: note sheets shared with players, by their email: [{ email, charId, file, name }], plus the Table Library's file. */
export async function assignSheets(token, id, shares, lib = '', gone = []) {
  const c = await db(token);
  const ms = (await val(c, `tables/${id}/members`)) || {};
  const drop = new Set(gone);
  const byEmail = new Map(Object.entries(ms).filter(([, m]) => m.status === 'approved' && m.email).map(([uid, m]) => [m.email.toLowerCase(), { uid, m }]));
  const patch = {}; let n = 0;
  for (const s of shares) {
    const hit = byEmail.get(String(s.email || '').toLowerCase()); if (!hit) continue;
    const have = hit.m.sheets?.[s.charId];
    if (!have || have.file !== s.file || have.name !== (s.name || '')) { patch[`${hit.uid}/sheets/${s.charId}`] = { file: s.file, name: s.name || '', at: Date.now() }; n++; }
    if (lib && hit.m.lib !== lib) { patch[`${hit.uid}/lib`] = lib; n++; }
  }
  // characters the DM deleted: no player is offered them any more
  if (drop.size) for (const [uid, m] of Object.entries(ms)) for (const charId of Object.keys(m?.sheets || {})) if (drop.has(charId)) { patch[`${uid}/sheets/${charId}`] = null; n++; }
  if (n) await c.D.update(c.ref(c.db, `tables/${id}/members`), patch);
  return n;
}
/** Player: send a character you made to your DM, so it's kept in their Drive and shared back to you. */
export async function sendSheet(token, id, sheet) {
  const c = await db(token);
  const json = JSON.stringify(sheet);
  if (json.length > 4500000) throw new Error('This sheet is too big to send (its pictures, most likely). Use smaller pictures and try again.');
  await c.set(c.ref(c.db, `tables/${id}/newsheets/${me.uid}/${sheet.id}`), { json, name: String(sheet.name || '').slice(0, 100), t: Date.now() });
}
/** Player: the characters you've sent that your DM's app hasn't picked up yet (their ids). */
export async function sentSheets(token, id = current()?.id) {
  const c = await db(token);
  return Object.keys((await val(c, `tables/${id}/newsheets/${me.uid}`)) || {});
}
/** DM: characters your players sent, with each player's email from their place at the table (not from the sheet). */
export async function incomingSheets(token, id = current()?.id) {
  const c = await db(token);
  const all = (await val(c, `tables/${id}/newsheets`)) || {};
  if (!Object.keys(all).length) return [];
  const ms = (await val(c, `tables/${id}/members`)) || {};
  const out = [];
  for (const [uid, list] of Object.entries(all)) for (const [charId, x] of Object.entries(list || {})) {
    const m = ms[uid];
    out.push({ uid, charId, json: x.json, name: x.name || '', email: m?.status === 'approved' ? m.email || '' : '', player: m?.name || '' });
  }
  return out;
}
/** DM: done with a player's sent character (saved, or not from an approved player). */
export async function clearIncoming(token, id, uid, charId) { const c = await db(token); await c.set(c.ref(c.db, `tables/${id}/newsheets/${uid}/${charId}`), null); }
/** Player: the sheets your DM shared with you at this table, and the Table Library: { sheets: [{ charId, file, name }], lib } */
export async function mySheets(token, id = current()?.id) {
  const c = await db(token);
  const m = (await val(c, `tables/${id}/members/${me.uid}`)) || {};
  return { sheets: Object.entries(m.sheets || {}).map(([charId, s]) => ({ charId, ...s })), lib: m.lib || '' };
}

/* ---------- the magic item catalog players can browse (Magic Items publishes it; no prices, no DM notes) ----------
   tables/<id>/catalog/items/<key>  { n: name, ty: type, r: rarity, a: attunement line, w: weight, s: source, d: description }
   tables/<id>/catalog/meta         { t, count, sources: { key: name } }
   Only the DM can write it; only the DM and approved players can read it. */
/** A safe database key for an item id ("srd:bag-of-holding", "custom:x1y2"). */
export const itemKey = id => encodeURIComponent(String(id)).replace(/\./g, '%2E');
/** DM: change part of the catalog at once: { 'items/<key>': value or null, meta: {…} }. */
export async function updateCatalog(token, id, patch) { const c = await db(token); await c.D.update(c.ref(c.db, `tables/${id}/catalog`), patch); }
/** Player (or DM): the whole catalog, { items: { key: item }, meta }, or null if the DM hasn't shared one yet. */
export async function catalog(token, id = current()?.id) { const c = await db(token); return val(c, `tables/${id}/catalog`); }

/* ---------- the shops players can visit (the Shops app) ----------
   tables/<id>/shops               what players see: the town where the party is, its open shops and their shelves
   tables/<id>/shopq/<uid>/<req>   a player's buy or sell request (only they can write it; the DM's Shops app answers)
   tables/<id>/shopr/<uid>/<req>   the answer, for that player only */
/** DM: what players see right now (or null when no town is open to them). */
export async function publishShops(token, id, view) { const c = await db(token); await c.set(c.ref(c.db, `tables/${id}/shops`), view ?? null); }
/** Player: the shops, kept up to date. cb(view or null). Returns a stop function. */
export function watchShops(token, id, cb) {
  let stop = null, stopped = false;
  db(token).then(c => { if (stopped) return; stop = c.onValue(c.ref(c.db, `tables/${id}/shops`), s => cb(s.val()), () => cb(null)); }).catch(() => cb(null));
  return () => { stopped = true; stop?.(); };
}
/** Player: ask to buy or sell. Resolves with the DM's Shops app's answer ({ ok, … } or { error }), or a timeout. */
export async function shopRequest(token, id, req, wait = 20000) {
  const c = await db(token);
  const rid = rnd(12), ask = c.ref(c.db, `tables/${id}/shopq/${me.uid}/${rid}`), ans = c.ref(c.db, `tables/${id}/shopr/${me.uid}/${rid}`);
  return new Promise(resolve => {
    let stop = null;
    const done = v => { clearTimeout(timer); stop?.(); resolve(v); c.set(ans, null).catch(() => {}); };
    const timer = setTimeout(() => { c.set(ask, null).catch(() => {}); done({ error: "The shop didn't answer. Your DM's Shops app may not be open right now." }); }, wait);
    stop = c.onValue(ans, s => { if (s.val()) done(s.val()); });
    c.set(ask, { ...req, t: Date.now() }).catch(e => done({ error: e.message }));
  });
}
/** DM: hear every player's requests as they come in. cb({ uid, rid, req }). Returns a stop function. */
export function watchShopRequests(token, id, cb) {
  let stops = [], stopped = false;
  db(token).then(c => {
    if (stopped) return;
    const seen = new Set();
    stops.push(c.onValue(c.ref(c.db, `tables/${id}/shopq`), s => {
      for (const [uid, reqs] of Object.entries(s.val() || {})) for (const [rid, req] of Object.entries(reqs || {})) {
        if (seen.has(rid)) continue; seen.add(rid); cb({ uid, rid, req });
      }
    }));
  }).catch(() => {});
  return () => { stopped = true; stops.forEach(f => f()); };
}
/** DM: answer a request (and clear it). */
export async function answerShop(token, id, uid, rid, answer) {
  const c = await db(token);
  await c.D.update(c.ref(c.db, `tables/${id}`), { [`shopr/${uid}/${rid}`]: answer, [`shopq/${uid}/${rid}`]: null });
}

/** DM: delete a table for good (its players, invites and shared-sheet notes go with it). */
export async function deleteTable(token, id) {
  const c = await db(token);
  const info = await val(c, `tables/${id}/info`);
  if (info && info.dm !== me.uid) throw new Error('Only the DM can delete a table.');
  await c.set(c.ref(c.db, `tables/${id}`), null);
  await c.set(c.ref(c.db, `users/${me.uid}/tables/${id}`), null);
  if (current()?.id === id) choose(null);
}

/** Player: leave a table. DM: forget it on this account (the table itself stays for its players). */
export async function leave(token, id) {
  const c = await db(token);
  const t = (await val(c, `users/${me.uid}/tables/${id}`)) || {};
  if (t.role === 'player') await c.set(c.ref(c.db, `tables/${id}/members/${me.uid}`), null).catch(() => {});
  await c.set(c.ref(c.db, `users/${me.uid}/tables/${id}`), null);
  if (current()?.id === id) choose(null);
}
