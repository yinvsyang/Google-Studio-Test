
// Simulation Bounds
export const BOUNDS_SIZE = 60;

// Physics Constants
export const SPEED_NEUTRON = 1.2;
export const SPEED_FRAGMENT = 0.6;
export const FRICTION_FRAGMENT = 0.98; // Fragments slow down

export enum ParticleType {
  ATOM = 'ATOM',
  NEUTRON = 'NEUTRON',
  FRAGMENT = 'FRAGMENT'
}

export enum FuelType {
  U235 = 'U-235',
  Pu239 = 'Pu-239'
}

export interface FuelProperty {
  name: string;
  color: string;
  emissive: string;
  radius: number;
  crossSection: number; // 0-1 probability of fission on impact
  neutronsPerFissionMin: number;
  neutronsPerFissionMax: number;
  criticalMassThreshold: number; // visual helper only
}

export const FUEL_CONFIG: Record<FuelType, FuelProperty> = {
  [FuelType.U235]: {
    name: "Uranium-235",
    color: "#4ade80", // Green
    emissive: "#15803d",
    radius: 1.5,
    crossSection: 0.85, // High probability to ensure chain reaction in small clusters
    neutronsPerFissionMin: 2,
    neutronsPerFissionMax: 4,
    criticalMassThreshold: 50
  },
  [FuelType.Pu239]: {
    name: "Plutonium-239",
    color: "#a855f7", // Purple
    emissive: "#6b21a8",
    radius: 1.4, // Slightly denser/smaller
    crossSection: 0.95, // Extremely volatile
    neutronsPerFissionMin: 3,
    neutronsPerFissionMax: 5, // Can release more neutrons
    criticalMassThreshold: 30
  }
};

// Common Constants
export const RADIUS_NEUTRON = 0.25;
export const RADIUS_FRAGMENT = 0.7;

export const COLOR_NEUTRON = "#38bdf8"; // Blue-400
export const COLOR_FRAGMENT = "#f97316"; // Orange-500
export const COLOR_FLASH = "#ffffff";
