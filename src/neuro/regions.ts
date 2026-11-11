import { Registry } from '../core/registry.ts';

/**
 * Brain architecture as a set of functional regions rather than a network of neurons.
 *
 * Each region integrates a subset of percepts and contributes to action selection.
 * Regions carry function tags, so a scenario can ablate a region, enlarge it, or
 * substitute an analogue from another lineage (for example distributed ganglia in
 * place of a vertebrate medulla), and the rest of the simulation reacts through the
 * same interface.
 */

export type RegionFunction =
  | 'vital'
  | 'homeostasis'
  | 'threat'
  | 'memory'
  | 'planning'
  | 'motor'
  | 'social';

export interface RegionDefinition {
  id: string;
  name: string;
  description: string;
  functions: RegionFunction[];
  /** Regions tagged vital are required for autonomic survival. */
  vital: boolean;
  /** Share of brain mass in a default vertebrate brain, used for reporting. */
  defaultShare: number;
  color: string;
}

export const BRAIN_REGIONS = new Registry<RegionDefinition>('brain region');

export const BUILTIN_REGIONS: RegionDefinition[] = [
  {
    id: 'medulla',
    name: 'Medulla oblongata',
    description: 'Autonomic control of breathing, heart rate and blood pressure. Failure is rapidly fatal.',
    functions: ['vital', 'homeostasis'],
    vital: true,
    defaultShare: 0.03,
    color: '#c0392b',
  },
  {
    id: 'hypothalamus',
    name: 'Hypothalamus',
    description: 'Homeostatic drives: hunger, thirst, temperature and reproductive urge.',
    functions: ['homeostasis'],
    vital: false,
    defaultShare: 0.05,
    color: '#e67e22',
  },
  {
    id: 'amygdala',
    name: 'Amygdala',
    description: 'Threat detection, fear and aggression.',
    functions: ['threat'],
    vital: false,
    defaultShare: 0.04,
    color: '#8e44ad',
  },
  {
    id: 'hippocampus',
    name: 'Hippocampus',
    description: 'Episodic memory and spatial mapping; reinforces what worked.',
    functions: ['memory'],
    vital: false,
    defaultShare: 0.06,
    color: '#2980b9',
  },
  {
    id: 'cortex',
    name: 'Cerebral cortex',
    description: 'Planning, abstraction, innovation and cultural learning.',
    functions: ['planning'],
    vital: false,
    defaultShare: 0.62,
    color: '#16a085',
  },
  {
    id: 'cerebellum',
    name: 'Cerebellum',
    description: 'Motor coordination and timing; improves the execution of every action.',
    functions: ['motor'],
    vital: false,
    defaultShare: 0.2,
    color: '#7f8c8d',
  },
  {
    id: 'ganglion',
    name: 'Distributed ganglia',
    description: 'Segmentally distributed nerve knots providing autonomic tone without a medulla.',
    functions: ['vital'],
    vital: true,
    defaultShare: 0.05,
    color: '#d35400',
  },
  {
    id: 'pallium',
    name: 'Dorsal pallium',
    description: 'Avian-style forebrain: dense, highly parallel planning circuitry.',
    functions: ['planning'],
    vital: false,
    defaultShare: 0.45,
    color: '#27ae60',
  },
];

for (const region of BUILTIN_REGIONS) {
  BRAIN_REGIONS.ensure(region.id, region);
}

/** Human-like default architecture: every region at its default size. */
export const DEFAULT_REGION_IDS = ['medulla', 'hypothalamus', 'amygdala', 'hippocampus', 'cortex', 'cerebellum'];
