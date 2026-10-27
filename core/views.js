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

/* ---------- Magic items that leave something open: which weapon or armor it is, which damage type it resists ---------- */
// The SRD weapons and armor (names as in the Character Sheet's equipment list, so the sheet can find their numbers)
export const WEAPONS = [['Club', 'bludgeoning'], ['Dagger', 'piercing'], ['Greatclub', 'bludgeoning'], ['Handaxe', 'slashing'], ['Javelin', 'piercing'], ['Light hammer', 'bludgeoning'],
  ['Mace', 'bludgeoning'], ['Quarterstaff', 'bludgeoning'], ['Sickle', 'slashing'], ['Spear', 'piercing'], ['Crossbow, light', 'piercing'], ['Dart', 'piercing'], ['Shortbow', 'piercing'],
  ['Sling', 'bludgeoning'], ['Battleaxe', 'slashing'], ['Flail', 'bludgeoning'], ['Glaive', 'slashing'], ['Greataxe', 'slashing'], ['Greatsword', 'slashing'], ['Halberd', 'slashing'],
  ['Lance', 'piercing'], ['Longsword', 'slashing'], ['Maul', 'bludgeoning'], ['Morningstar', 'piercing'], ['Pike', 'piercing'], ['Rapier', 'piercing'], ['Scimitar', 'slashing'],
  ['Shortsword', 'piercing'], ['Trident', 'piercing'], ['War pick', 'piercing'], ['Warhammer', 'bludgeoning'], ['Whip', 'slashing'], ['Blowgun', 'piercing'], ['Crossbow, hand', 'piercing'],
  ['Crossbow, heavy', 'piercing'], ['Longbow', 'piercing']];
export const AMMUNITION = ['Arrow', 'Crossbow bolt', 'Sling bullet', 'Blowgun needle'];
export const ARMORS = [['Padded Armor', 'light'], ['Leather Armor', 'light'], ['Studded Leather Armor', 'light'], ['Hide Armor', 'medium'], ['Chain Shirt', 'medium'], ['Scale Mail', 'medium'],
  ['Breastplate', 'medium'], ['Half Plate Armor', 'medium'], ['Ring Mail', 'heavy'], ['Chain Mail', 'heavy'], ['Splint Armor', 'heavy'], ['Plate Armor', 'heavy']];
export const DAMAGE_TYPES = ['acid', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'poison', 'psychic', 'radiant', 'thunder', 'bludgeoning', 'piercing', 'slashing'];
const SWORDS = ['Greatsword', 'Longsword', 'Rapier', 'Scimitar', 'Shortsword'], AXES = ['Battleaxe', 'Greataxe', 'Handaxe'];

/**
 * What a magic item leaves for the DM to choose: { kind: 'weapon'|'armor'|'', options: [names], fixed: name, dmg: bool }.
 * "Weapon (any sword)" offers the swords; "Armor (plate)" is plate, no choice; "resistance to one type of damage" asks which.
 */
export function itemChoices(item) {
  const t = String(item?.type || ''), out = { kind: '', options: [], fixed: '', dmg: false };
  out.dmg = /resistance to one (?:type of damage|damage type)|one damage type of your choice/i.test(item?.desc || '');
  const w = /^\s*weapon\s*\(([^)]*)\)?/i.exec(t), a = /^\s*armor\s*\(([^)]*)\)?/i.exec(t);
  if (w) {
    out.kind = 'weapon';
    const spec = w[1].toLowerCase().trim();
    if (/^any\b/.test(spec)) {
      let names = [];
      if (/sword/.test(spec)) names.push(...SWORDS);
      if (/\baxe/.test(spec)) names.push(...AXES);
      if (/ammunition/.test(spec)) names.push(...AMMUNITION);
      if (/slashing/.test(spec)) names = names.filter(n => WEAPONS.find(x => x[0] === n)?.[1] === 'slashing');
      out.options = names.length ? names : WEAPONS.map(x => x[0]);
    } else {
      const s = spec.replace(/s$/, '');
      out.fixed = [...WEAPONS.map(x => x[0]), ...AMMUNITION].find(n => n.toLowerCase() === s || n.toLowerCase() === spec) || '';
    }
  } else if (a) {
    out.kind = 'armor';
    const spec = a[1].toLowerCase().trim(), open = !/\)/.test(t);
    if (/shield/.test(spec)) out.fixed = 'Shield';
    else if (/\b(light|medium|heavy)\b/.test(spec) || /^any/.test(spec)) {
      // "Armor (light, medium, or heavy)" (sometimes cut short to "Armor (light")
      const kinds = open && spec === 'light' || /^any/.test(spec) ? ['light', 'medium', 'heavy'] : ['light', 'medium', 'heavy'].filter(k => spec.includes(k));
      out.options = ARMORS.filter(x => kinds.includes(x[1])).map(x => x[0]);
    } else out.fixed = ARMORS.map(x => x[0]).find(n => n.toLowerCase().startsWith(spec)) || '';
  }
  return out;
}
/** Does handing this item out need the DM to pick something? */
export const needsChoice = item => { const c = itemChoices(item); return c.options.length > 1 || c.dmg; };
/** The name a chosen copy goes by: "Weapon, +1" with a longsword is "Longsword, +1"; "Flame Tongue (Scimitar)". */
export function choiceName(name, ch = {}) {
  let n = String(name || ''); const extra = [];
  if (ch.base) {
    if (/^(weapon|armor|ammunition)(?=,)/i.test(n)) n = n.replace(/^(weapon|armor|ammunition)(?=,)/i, ch.base); // "Armor, +1" → "Chain Mail, +1"
    else if (!n.toLowerCase().includes(ch.base.toLowerCase().replace(/ armor$/, ''))) extra.push(ch.base);
  }
  if (ch.dmg) extra.push(ch.dmg);
  return extra.length ? `${n} (${extra.join(', ')})` : n;
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
    let raw = Array.isArray(i.fx) ? i.fx : (worksWhileCarried(i) ? parseEffects(i.desc) : []);
    // the damage type the DM chose for "resistance to one type of damage"
    const ch = x.choice || {}, ic = itemChoices(i);
    if (ch.dmg) { raw = raw.filter(e => e.k !== 'resist'); raw = [...raw, { k: 'resist', on: ch.dmg }]; }
    const fx = withText(raw);
    const base = ch.base || ic.fixed || '';
    return {
      cid: x.cid, name: choiceName(i.name, { ...ch, base: ch.base || '' }), base, baseKind: base ? ic.kind : '', type: [i.type, i.rarity].filter(Boolean).join(', '),
      attune: attuneText(i), needsAttune: i.attune?.mode === 'required', attuned: !!x.attuned, desc: i.desc || '', weight: weightLb(i.weight), fx,
    };
  }).filter(Boolean);
  return { items: list, limit: Number(holder.limit) || 3, held: held.length };
}

/* ---------- boons (granted in the Character Sheet's library) ---------- */
export function boonFx(b) { return withText(Array.isArray(b?.fx) ? b.fx : parseEffects(b?.desc || b?.text || '')); }
