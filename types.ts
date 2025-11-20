
import { FuelType } from './constants';

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface SimulationStats {
  fuelType: FuelType;
  totalAtoms: number;
  atomsLeft: number;
  activeNeutrons: number;
  fissionCount: number;
  maxGeneration: number; // Depth of chain reaction
}

// Internal physics state types
export interface AtomState {
  id: number;
  active: boolean;
  x: number;
  y: number;
  z: number;
}

export interface ProjectileState {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  generation: number; // Chain reaction depth
  life: number;
}
