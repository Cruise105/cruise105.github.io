// The DM's Perspective — effects: what an item, disease or boon actually does to a character's numbers.
//
// Item and disease text is written for people ("You gain a +1 bonus to AC and saving throws"). This reads the
// common phrasings into effects the character sheet can apply, so the DM doesn't have to type them in. The DM
// can still correct or add effects by hand in the app that owns the item or disease; those replace what's read.
//
// An effect is { k, on, v, note }:
//   abil     on: str|dex|con|int|wis|cha, v: +/- to the score
//   abilSet  on: an ability, v: the score becomes at least this ("Your Strength score is 19")
//   ac       v: +/- to Armor Class
//   save     on: 'all' or an ability, v: +/- to saving throws
//   check    on: 'all', v: +/- to ability checks (skills, initiative)
//   dc       on: 'spell' | 'ki' (class feature DCs), v: +/- to save DCs
//   spellatk v: +/- to spell attack rolls
//   atk/dmg  on: 'self' (attacks with this item) | 'ranged', v: +/- to attack or damage rolls
//   speed    v: +/- feet of walking speed
//   hpmax    v: +/- to hit point maximum
//   resist   on: a damage type
//   adv/dis  note: what they have advantage or disadvantage on (a reminder; no number changes)
//   note     note: anything else worth showing
// cond: an optional "only if…" the sheet shows next to the effect.

export const ABIL = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha',
  str: 'str', dex: 'dex', con: 'con', int: 'int', wis: 'wis', cha: 'cha' };
const ABIL_NAME = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
const n = s => Number(String(s).replace(/[−–]/g, '-'));
const sentences = t => String(t || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z])/);

/** Read the effects out of a piece of text (an item's description, a disease stage, a boon). */
export function parseEffects(text) {
  const out = [];
  const add = e => { if (!out.some(x => x.k === e.k && x.on === e.on && x.v === e.v && x.note === e.note)) out.push(e); };
  for (const s of sentences(text)) {
    const low = s.toLowerCase();
    const cond = (/\bif you (?:are|aren't|are not)\b[^,.]*/i.exec(s) || [])[0] || '';

    // "-2 DEX and -2 WIS" (diseases)
    for (const m of s.matchAll(/([+\-−–]\s?\d+)\s*(STR|DEX|CON|INT|WIS|CHA)\b/g)) add({ k: 'abil', on: ABIL[m[2].toLowerCase()], v: n(m[1].replace(/\s/g, '')) });
    // "Your Strength score is 19" / "changes to 21"
    for (const m of low.matchAll(/\b(strength|dexterity|constitution|intelligence|wisdom|charisma) score (?:is|changes to|becomes) (\d+)/g)) add({ k: 'abilSet', on: ABIL[m[1]], v: n(m[2]) });
    // "your Strength score increases by 2"
    for (const m of low.matchAll(/\b(strength|dexterity|constitution|intelligence|wisdom|charisma) score (increases|decreases|is reduced) by (\d+)/g)) add({ k: 'abil', on: ABIL[m[1]], v: (m[2] === 'increases' ? 1 : -1) * n(m[3]) });

    // "a +1 bonus to AC and saving throws", "+1 bonus to spell attack rolls and to the saving throw DCs of your warlock spells"
    for (const m of s.matchAll(/([+\-−–]\d+) (?:bonus|penalty) to ([^.;]+)/gi)) {
      const v = n(m[1]), what = m[2].toLowerCase();
      if (/\bac\b|armor class/.test(what)) add({ k: 'ac', v, ...(cond ? { cond } : {}) });
      if (/saving throw dcs? of your ki|ki (?:save )?dc/.test(what)) add({ k: 'dc', on: 'ki', v });
      if (/saving throw dcs?\b(?! of your ki)|spell save dc/.test(what) && /spell/.test(what)) add({ k: 'dc', on: 'spell', v });
      if (/saving throws\b/.test(what)) {
        const one = /(strength|dexterity|constitution|intelligence|wisdom|charisma) saving throws/.exec(what);
        add({ k: 'save', on: one ? ABIL[one[1]] : 'all', v });
      }
      if (/ability checks/.test(what)) add({ k: 'check', on: 'all', v });
      if (/spell attack rolls?/.test(what)) add({ k: 'spellatk', v });
      if (/attack and damage rolls/.test(what) && /this (?:magic )?weapon|with it\b|this weapon|made with (?:this|it)/.test(what)) { add({ k: 'atk', on: 'self', v }); add({ k: 'dmg', on: 'self', v }); }
      else if (/damage rolls on ranged attacks/.test(what)) add({ k: 'dmg', on: 'ranged', v });
      else if (/^attack rolls/.test(what)) add({ k: 'atk', on: 'all', v });
    }

    // resistance / immunity
    for (const m of low.matchAll(/\b(resistance|immunity) to ([a-z ,]+?) damage/g)) {
      for (const t of m[2].split(/,| and | or /).map(x => x.trim()).filter(x => x && !x.includes('?') && x.length < 14 && !/^(all|the|one type of|one type)$|type/.test(x)))
        add({ k: m[1] === 'resistance' ? 'resist' : 'immune', on: t });
    }
    // walking speed
    const sp = /speed (?:increases|is increased) by (\d+) feet/.exec(low); if (sp) add({ k: 'speed', v: n(sp[1]) });
    const spd = /speed (?:decreases|is reduced|is decreased) by (\d+) feet/.exec(low); if (spd) add({ k: 'speed', v: -n(spd[1]) });
    if (/double your walking speed|walking speed is doubled/.test(low)) add({ k: 'note', note: 'Walking speed doubled while it is in use' });
    // hit point maximum
    const hp = /hit point maximum (increases|is increased|decreases|is reduced) by (\d+)/.exec(low);
    if (hp) add({ k: 'hpmax', v: (/increase/.test(hp[1]) ? 1 : -1) * n(hp[2]) });

    // advantage / disadvantage the character has (not ones others have against them)
    for (const m of s.matchAll(/\b(disadvantage|advantage) on ([^.;]+)/gi)) {
      const before = low.slice(0, m.index);
      if (/(?:to see you|against you|attack(?:s| rolls?) against|creatures?|enemies|it has|they have|the target)[^.]*$/.test(before)) continue;
      if (!/\byou\b|\byour\b|^\s*$|\bhave\s*$|\band\s*$/.test(before) && !/^(you|disadvantage|advantage)/i.test(s.trim())) continue;
      const what = m[2].replace(/\s+(?:while|as|until|if)\b.*$/i, '').trim();
      if (/^(their|its|his|her)\b/i.test(what)) continue; // someone else's roll
      add({ k: m[1].toLowerCase() === 'advantage' ? 'adv' : 'dis', note: what });
    }
  }
  return out;
}

/** One effect in plain words, for lists ("AC +1", "Strength −2", "Ki save DC +1"). */
export function describe(e) {
  const sg = v => (v >= 0 ? `+${v}` : `−${Math.abs(v)}`);
  const c = e.cond ? ` (${e.cond})` : '';
  switch (e.k) {
    case 'abil': return `${ABIL_NAME[e.on] || e.on} ${sg(e.v)}${c}`;
    case 'abilSet': return `${ABIL_NAME[e.on] || e.on} becomes ${e.v} (if lower)`;
    case 'ac': return `AC ${sg(e.v)}${c}`;
    case 'save': return `${e.on === 'all' ? 'All saving throws' : `${ABIL_NAME[e.on]} saving throws`} ${sg(e.v)}${c}`;
    case 'check': return `Ability checks ${sg(e.v)}${c}`;
    case 'dc': return `${e.on === 'ki' ? 'Ki save DC' : 'Spell save DC'} ${sg(e.v)}${c}`;
    case 'spellatk': return `Spell attacks ${sg(e.v)}${c}`;
    case 'atk': return `${e.on === 'self' ? 'Attacks with it' : e.on === 'ranged' ? 'Ranged attacks' : 'Attack rolls'} ${sg(e.v)}${c}`;
    case 'dmg': return `${e.on === 'self' ? 'Damage with it' : e.on === 'ranged' ? 'Ranged weapon damage' : 'Damage rolls'} ${sg(e.v)}${c}`;
    case 'speed': return `Speed ${sg(e.v)} ft${c}`;
    case 'hpmax': return `Hit point maximum ${sg(e.v)}${c}`;
    case 'resist': return `Resistance to ${e.on} damage`;
    case 'immune': return `Immunity to ${e.on} damage`;
    case 'adv': return `Advantage on ${e.note}`;
    case 'dis': return `Disadvantage on ${e.note}`;
    default: return e.note || '';
  }
}

/**
 * Does an item do what its text says just by being carried, worn or held? Potions, oils, scrolls, manuals and the
 * like only work when used up, so their effects aren't applied automatically (the DM can add them when it happens).
 */
export function worksWhileCarried(item) {
  const t = `${item?.type || ''} ${item?.name || ''}`.toLowerCase();
  return !/\b(potion|oil|elixir|philter|scroll|manual|tome|dust|ointment|bead of|feather token|necklace of fireballs|spell scroll)\b/.test(t);
}
