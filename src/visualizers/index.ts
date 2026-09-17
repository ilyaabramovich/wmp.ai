import type { Visualizer } from './types';
import { OceanMist } from './oceanMist';
import { FireStorm } from './fireStorm';
import { SwirlingCyclone } from './swirlingCyclone';
import { RainbowRibbons } from './rainbowRibbons';

/**
 * Registry. To add a preset: create a module exporting a class that implements
 * Visualizer, then append an instance here. Menus are built from this list.
 */
export const presets: Visualizer[] = [
  new OceanMist(),
  new FireStorm(),
  new SwirlingCyclone(),
  new RainbowRibbons(),
];

export const RANDOM_ID = '__random__';

export function presetsByCategory(): Map<string, Visualizer[]> {
  const m = new Map<string, Visualizer[]>();
  for (const p of presets) {
    if (!m.has(p.category)) m.set(p.category, []);
    m.get(p.category)!.push(p);
  }
  return m;
}

export function findPreset(id: string): Visualizer | undefined {
  return presets.find((p) => p.id === id);
}
