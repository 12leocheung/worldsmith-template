/**
 * Deterministic, human-readable names for the chronicle.
 *
 * Names are derived from an id or cell coordinate rather than drawn from an RNG, so
 * adding the chronicle does not perturb the simulation's random streams. The same
 * person keeps the same name across every snapshot, and the same settlement keeps
 * its name even when the viewer scrubs the timeline.
 */

/** FNV-1a over a string, then a final avalanche. */
export const stableHash = (text: string): number => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
};

const FIRST = [
  'Ada', 'Bram', 'Cora', 'Dain', 'Eira', 'Fenn', 'Greta', 'Hal', 'Iris', 'Jori',
  'Kael', 'Lena', 'Milo', 'Nia', 'Orin', 'Pia', 'Quill', 'Rhea', 'Soren', 'Tess',
  'Ulla', 'Vero', 'Wren', 'Yara',
];

const LAST = [
  'Ash', 'Brook', 'Clay', 'Dune', 'Ember', 'Frost', 'Gale', 'Hollow', 'Iron',
  'Juniper', 'Kestrel', 'Lark', 'Moss', 'North', 'Oak', 'Pine', 'Reed', 'Stone',
  'Thorn', 'Vale', 'Willow', 'Yarrow',
];

const PLACE_FIRST = [
  'Ash', 'Brack', 'Cinder', 'Dawn', 'Ember', 'Frost', 'Gale', 'Hollow', 'Iron',
  'Juniper', 'Kestrel', 'Lark', 'Moss', 'North', 'Oak', 'Pine', 'Reed', 'Stone',
  'Thorn', 'Vale', 'Willow', 'Yarrow',
];

const PLACE_SECOND = [
  'fall', 'ford', 'hollow', 'mere', 'reach', 'ridge', 'spire', 'stead', 'vale',
  'watch', 'wood', 'brook',
];

/**
 * A stable name for one individual. Sapient lineages get personal names; animals
 * keep a species label and their simulation id.
 */
export const personName = (id: number, speciesName: string, sapient: boolean): string => {
  if (!sapient) return `${speciesName} ${id}`;
  const first = FIRST[stableHash(`${id}:first`) % FIRST.length] as string;
  const last = LAST[stableHash(`${id}:last`) % LAST.length] as string;
  return `${first} ${last}`;
};

/** A stable place name for a grid cell. */
export const settlementName = (cell: number, seed: number): string => {
  const h = stableHash(`${seed}:cell:${cell}`);
  const first = PLACE_FIRST[h % PLACE_FIRST.length] as string;
  const second = PLACE_SECOND[(h >>> 8) % PLACE_SECOND.length] as string;
  return `${first}${second}`;
};
