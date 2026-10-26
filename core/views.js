// The DM's Perspective — what a player's sheet shows from each app.
//
// One copy of these rules, used everywhere: the app that owns the data sends it to the sheet over the live link
// the moment it changes, and the Character Sheet on the DM's device saves the same thing into the sheet file on
// Drive. Both come from here, so they always agree. Only player-safe information leaves these functions.

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
      return { id: cs.id, name: d.name || 'Disease', state: cs.state, effects: (d.stages || []).slice(0, stage) };
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
    return {
      cid: x.cid, name: i.name, type: [i.type, i.rarity].filter(Boolean).join(', '),
      attune: attuneText(i), attuned: !!x.attuned, desc: i.desc || '', weight: weightLb(i.weight),
    };
  }).filter(Boolean);
  return { items: list, limit: Number(holder.limit) || 3, held: held.length };
}
