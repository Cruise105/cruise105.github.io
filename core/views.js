// The DM's Perspective — what a player's sheet shows from each app.
//
// One copy of these rules, used everywhere: the app that owns the data sends it to the sheet over the live link
// the moment it changes, and the Character Sheet on the DM's device saves the same thing into the sheet file on
// Drive. Both come from here, so they always agree. Only player-safe information leaves these functions.
//
// Each item and disease also carries its effects (what it does to the character's numbers), read from its text by
// effects.js, or the DM's own corrections where they made some. The sheet applies them.
import { parseEffects, worksWhileCarried, describe } from './effects.js';
// each effect also carries its plain-words line (txt), so the sheet can list it as is
const withText = fx => fx.map(e => ({ ...e, txt: describe(e) }));

/* ---------- Session Notes: deaths, Favor of Fate, diseases, survival ---------- */
// A disease shows once symptoms start (on its own), or while incubating only if the DM revealed it. Only what's
// affecting the character right now: every effect in force at the current stage (stages build on each other),
// never the stages still to come, the save DC, or how their saves have gone.
export function snView(sn, pc) {
  if (!pc) return null;
  const dis = new Map((sn?.diseases || []).map(d => [d.id, d]));
  const cases = (sn?.cases || []).filter(cs => cs.pcId === pc.id && !cs.deleted
    && (['sick', 'declining'].includes(cs.state) || (cs.state === 'incubating' && cs.revealed)));
  const sv = pc.survival || {};
  return {
    pcId: pc.id,
    deaths: (pc.deaths || []).length,
    favorSpent: !!pc.favor?.spent,
    survival: sv.hunger != null ? { hunger: sv.hunger, thirst: sv.thirst, fatigue: sv.fatigue } : null,
    diseases: cases.map(cs => {
      const d = dis.get(cs.diseaseId) || {};
      const stage = cs.state === 'incubating' ? 0 : Math.max(0, cs.stage || 0);
      const texts = (d.stages || []).slice(0, stage);
      // what the stages in force do to the numbers (the DM's own list for a stage, where they made one)
      const fx = withText(texts.flatMap((t, i) => (Array.isArray(d.stageFx?.[i]) ? d.stageFx[i] : parseEffects(t))));
      return { id: cs.id, name: d.name || 'Disease', state: cs.state, effects: texts, fx };
    }),
  };
}

/* ---------- Magic Items: what a character holds (never what it's worth) ---------- */
export const weightLb = w => { const m = /([\d.]+)\s*lb/i.exec(String(w || '')); return m ? Number(m[1]) : 0; };
export function attuneText(i) {
  const a = i?.attune || {};
  return a.mode === 'required' ? `Requires attunement${a.by ? ` ${a.by}` : ''}` : a.mode === 'optional' ? 'Attunement optional' : '';
}
/**
 * mi: the magic item app's saved data ({ state }), seed: Map of its built-in items by id, holder: its record for
 * this character. Returns { items, limit, held } or null.
 */
export function miView(mi, seed, holder) {
  if (!holder) return null;
  const st = mi?.state || {};
  const items = new Map();
  if (seed) for (const [id, i] of seed) items.set(id, i);
  for (const c of st.custom || []) items.set(c.id, c);
  const get = id => { const i = items.get(id); const e = st.edits?.[id]; return i ? (e ? { ...i, ...e } : i) : null; };
  const held = (st.inv || []).filter(x => x.holder === holder.id);
  const list = held.map(x => {
    const i = get(x.itemId); if (!i) return null;
    // what it does to the numbers: the DM's own list if they made one, otherwise read from its description
    const fx = withText(Array.isArray(i.fx) ? i.fx : (worksWhileCarried(i) ? parseEffects(i.desc) : []));
    return {
      cid: x.cid, name: i.name, type: [i.type, i.rarity].filter(Boolean).join(', '),
      attune: attuneText(i), needsAttune: i.attune?.mode === 'required', attuned: !!x.attuned, desc: i.desc || '', weight: weightLb(i.weight), fx,
    };
  }).filter(Boolean);
  return { items: list, limit: Number(holder.limit) || 3, held: held.length };
}

/* ---------- boons (granted in the Character Sheet's library) ---------- */
export function boonFx(b) { return withText(Array.isArray(b?.fx) ? b.fx : parseEffects(b?.desc || b?.text || '')); }
