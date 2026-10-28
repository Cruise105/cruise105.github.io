// The DM's Perspective — key keeper (a Cloudflare Worker).
//
// Google only gives browser apps one-hour passes. This keeps people signed in for weeks: when someone signs in,
// the app sends Google's one-time sign-in code here; this trades it for a long-term key (refresh token), LOCKS
// that key with a secret only this worker has, and hands the locked copy back to the device. Nothing is stored
// here. When a pass runs low, the device sends the locked copy back and gets a fresh one-hour pass.
//
// A locked copy is useless anywhere else: only this worker can open it, and it only answers the suite's site.
//
// Setup (Cloudflare dashboard): paste this file as the Worker's code, and add one secret:
//   GOOGLE_CLIENT_SECRET   the OAuth client's secret from Google Cloud (APIs & Services, Credentials)
// The client id and the allowed site are below.

const CLIENT_ID = '150155066546-k6e9l4c0fbmel2tdfkv4c4gs41bqd847.apps.googleusercontent.com';
const ORIGINS = ['https://thedmsperspective.github.io', 'https://cruise105.github.io'];
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const enc = new TextEncoder(), dec = new TextDecoder();
const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));

// The lock: an AES-GCM key derived from the client secret (so there's only one secret to set up)
async function lockKey(env) {
  const base = await crypto.subtle.importKey('raw', enc.encode(env.GOOGLE_CLIENT_SECRET), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('dmp-keeper-v1'), info: enc.encode('refresh-token') },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function lock(env, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await lockKey(env), enc.encode(JSON.stringify(data)));
  const out = new Uint8Array(12 + ct.byteLength); out.set(iv); out.set(new Uint8Array(ct), 12);
  return b64u(out);
}
async function unlock(env, blob) {
  const all = unb64u(String(blob || ''));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, await lockKey(env), all.slice(12));
  return JSON.parse(dec.decode(pt));
}

async function google(params) {
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const allowed = ORIGINS.includes(origin);
    const cors = { 'Access-Control-Allow-Origin': allowed ? origin : ORIGINS[0], 'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const path = new URL(req.url).pathname;
    if (req.method === 'GET' && path === '/') return reply({ ok: true, keeper: 'dmp', ready: !!env.GOOGLE_CLIENT_SECRET });
    if (!allowed) return reply({ error: 'This only works for the suite\'s own site.' }, 403);
    if (req.method !== 'POST') return reply({ error: 'POST only' }, 405);
    if (!env.GOOGLE_CLIENT_SECRET) return reply({ error: 'The keeper is missing its GOOGLE_CLIENT_SECRET.' }, 500);
    let body = {};
    try { body = await req.json(); } catch { return reply({ error: 'Bad request' }, 400); }

    // Sign-in: trade Google's one-time code for a pass and a locked long-term key
    if (path === '/exchange') {
      const g = await google({ code: body.code || '', client_id: CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: 'postmessage', grant_type: 'authorization_code' });
      if (!g.ok) return reply({ error: g.j.error_description || g.j.error || 'Google refused the sign-in.' }, 400);
      const out = { access_token: g.j.access_token, expires_in: g.j.expires_in, scope: g.j.scope };
      if (g.j.refresh_token) out.key = await lock(env, { rt: g.j.refresh_token, t: Date.now() });
      return reply(out);
    }
    // A fresh one-hour pass from the locked key
    if (path === '/refresh') {
      let k; try { k = await unlock(env, body.key); } catch { return reply({ error: 'That key is not valid here. Sign in again.', signin: true }, 401); }
      const g = await google({ refresh_token: k.rt, client_id: CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, grant_type: 'refresh_token' });
      if (!g.ok) return reply({ error: g.j.error_description || g.j.error || 'Google refused.', signin: g.j.error === 'invalid_grant' }, g.status === 400 ? 401 : 502);
      return reply({ access_token: g.j.access_token, expires_in: g.j.expires_in, scope: g.j.scope });
    }
    // Sign out everywhere: Google forgets the long-term key
    if (path === '/signout') {
      try { const k = await unlock(env, body.key); await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(k.rt), { method: 'POST' }); } catch { /* already gone */ }
      return reply({ ok: true });
    }
    return reply({ error: 'Not found' }, 404);
  },
};
