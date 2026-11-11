/** The behavioural repertoire. Adding a new action means adding it here and giving it
 * region weights in `brain.ts` and an implementation in `society/actions.ts`. */
export const ACTION_IDS = [
  'forage',
  'hunt',
  'mate',
  'rest',
  'explore',
  'teach',
  'socialize',
  'innovate',
  'flee',
] as const;

export type ActionId = (typeof ACTION_IDS)[number];

export interface ActionInfo {
  id: ActionId;
  label: string;
  description: string;
}

export const ACTIONS: Record<ActionId, ActionInfo> = {
  forage: { id: 'forage', label: 'Forage', description: 'Gather plant food from the local biome.' },
  hunt: { id: 'hunt', label: 'Hunt', description: 'Pursue prey; costs energy and risks injury.' },
  mate: { id: 'mate', label: 'Mate', description: 'Produce offspring with a nearby fertile conspecific.' },
  rest: { id: 'rest', label: 'Rest', description: 'Recover health and reduce metabolic cost.' },
  explore: { id: 'explore', label: 'Explore', description: 'Move to a neighbouring cell and scout resources.' },
  teach: { id: 'teach', label: 'Teach', description: 'Transmit knowledge to a conspecific.' },
  socialize: { id: 'socialize', label: 'Socialize', description: 'Maintain social bonds and share information passively.' },
  innovate: { id: 'innovate', label: 'Innovate', description: 'Attempt to discover a new technology.' },
  flee: { id: 'flee', label: 'Flee', description: 'Retreat from a perceived threat.' },
};
