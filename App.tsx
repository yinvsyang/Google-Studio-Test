
import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Stars, Text, Environment } from '@react-three/drei';
import * as THREE from 'three';
import { 
  FUEL_CONFIG, 
  FuelType, 
  BOUNDS_SIZE, 
  SPEED_NEUTRON, 
  SPEED_FRAGMENT,
  RADIUS_NEUTRON,
  RADIUS_FRAGMENT,
  COLOR_NEUTRON,
  COLOR_FRAGMENT,
  FRICTION_FRAGMENT
} from './constants';
import { analyzeReaction } from './services/geminiService';
import { SimulationStats } from './types';

// --- Components ---

interface PhysicsState {
  atoms: Float32Array; // x,y,z, active(1/0)
  neutrons: Float32Array; // x,y,z, vx,vy,vz, active(1/0), generation
  fragments: Float32Array; // x,y,z, vx,vy,vz, active(1/0)
}

const MAX_NEUTRONS = 3000; // Increased buffer for larger chain reactions
const MAX_FRAGMENTS = 3000;

const SceneContent = ({ 
  fuelType, 
  atomCount, 
  triggerAnalysis,
  startTrigger,
  resetTrigger,
  onStatsUpdate 
}: { 
  fuelType: FuelType, 
  atomCount: number, 
  triggerAnalysis: number,
  startTrigger: number,
  resetTrigger: number,
  onStatsUpdate: (stats: SimulationStats) => void
}) => {
  const fuel = FUEL_CONFIG[fuelType];
  
  // Refs for InstancedMeshes
  const atomsMeshRef = useRef<THREE.InstancedMesh>(null);
  const neutronsMeshRef = useRef<THREE.InstancedMesh>(null);
  const fragmentsMeshRef = useRef<THREE.InstancedMesh>(null);

  // Physics State (Mutable for performance)
  const state = useRef({
    atoms: new Float32Array(atomCount * 4), // x,y,z,active
    neutrons: new Float32Array(MAX_NEUTRONS * 8), // x,y,z,vx,vy,vz,active,gen
    fragments: new Float32Array(MAX_FRAGMENTS * 7), // x,y,z,vx,vy,vz,active
    atomCount: atomCount,
    neutronCount: 0,
    fragmentCount: 0,
    fissionCount: 0,
    maxGen: 0
  });

  // Helper to reset simulation
  const resetSimulation = useCallback(() => {
    const s = state.current;
    s.atomCount = atomCount;
    s.neutronCount = 0;
    s.fragmentCount = 0;
    s.fissionCount = 0;
    s.maxGen = 0;

    // Re-allocate if size changes
    if (s.atoms.length !== atomCount * 4) {
        s.atoms = new Float32Array(atomCount * 4);
    }
    // Zero out others
    s.neutrons.fill(0);
    s.fragments.fill(0);

    // Initialize Atoms in a Cube Lattice with Jitter
    const side = Math.ceil(Math.pow(atomCount, 1/3));
    // Decreased spacing to ensure criticality (closer atoms = more collisions)
    const spacing = fuel.radius * 2.2; 
    const offset = (side * spacing) / 2;
    
    let idx = 0;
    for (let x = 0; x < side; x++) {
      for (let y = 0; y < side; y++) {
        for (let z = 0; z < side; z++) {
          if (idx >= atomCount) break;
          const i = idx * 4;
          // Jitter position
          s.atoms[i] = (x * spacing - offset) + (Math.random() - 0.5) * 1.0;
          s.atoms[i+1] = (y * spacing - offset) + (Math.random() - 0.5) * 1.0;
          s.atoms[i+2] = (z * spacing - offset) + (Math.random() - 0.5) * 1.0;
          s.atoms[i+3] = 1; // Active
          idx++;
        }
      }
    }

    // Update Mesh Counts
    if (atomsMeshRef.current) atomsMeshRef.current.count = atomCount;
    if (neutronsMeshRef.current) neutronsMeshRef.current.count = 0;
    if (fragmentsMeshRef.current) fragmentsMeshRef.current.count = 0;

    // Force initial update
    const tempObj = new THREE.Object3D();
    if (atomsMeshRef.current) {
      for (let i = 0; i < atomCount; i++) {
        tempObj.position.set(s.atoms[i*4], s.atoms[i*4+1], s.atoms[i*4+2]);
        tempObj.scale.set(1,1,1); // Ensure scale is reset
        tempObj.updateMatrix();
        atomsMeshRef.current.setMatrixAt(i, tempObj.matrix);
      }
      atomsMeshRef.current.instanceMatrix.needsUpdate = true;
    }
    if (neutronsMeshRef.current) {
        neutronsMeshRef.current.instanceMatrix.needsUpdate = true;
    }
    if (fragmentsMeshRef.current) {
        fragmentsMeshRef.current.instanceMatrix.needsUpdate = true;
    }

  }, [atomCount, fuel.radius]);

  // Initialize on mount or config change
  useEffect(() => {
    resetSimulation();
  }, [resetSimulation]);

  // Handle Manual Reset
  useEffect(() => {
    if (resetTrigger > 0) {
        resetSimulation();
    }
  }, [resetTrigger, resetSimulation]);

  // Trigger fission logic
  const triggerFission = useCallback((atomIndex: number, incomingGen: number = 0) => {
    const s = state.current;
    const i = atomIndex * 4;
    
    if (s.atoms[i+3] === 0) return; // Already dead

    // Deactivate Atom
    s.atoms[i+3] = 0;
    s.fissionCount++;
    if (incomingGen + 1 > s.maxGen) s.maxGen = incomingGen + 1;

    const x = s.atoms[i];
    const y = s.atoms[i+1];
    const z = s.atoms[i+2];

    // Hide Atom Mesh instance
    if (atomsMeshRef.current) {
      const tempObj = new THREE.Object3D();
      tempObj.position.set(0,0,0);
      tempObj.scale.set(0,0,0); // Hide it
      tempObj.updateMatrix();
      atomsMeshRef.current.setMatrixAt(atomIndex, tempObj.matrix);
      atomsMeshRef.current.instanceMatrix.needsUpdate = true;
    }

    // Spawn Neutrons
    const numNeutrons = Math.floor(Math.random() * (fuel.neutronsPerFissionMax - fuel.neutronsPerFissionMin + 1)) + fuel.neutronsPerFissionMin;
    
    for (let n = 0; n < numNeutrons; n++) {
      if (s.neutronCount >= MAX_NEUTRONS) break;
      const ni = s.neutronCount * 8;
      s.neutrons[ni] = x;
      s.neutrons[ni+1] = y;
      s.neutrons[ni+2] = z;
      
      // Random Direction
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const vx = Math.sin(phi) * Math.cos(theta);
      const vy = Math.sin(phi) * Math.sin(theta);
      const vz = Math.cos(phi);

      s.neutrons[ni+3] = vx * SPEED_NEUTRON;
      s.neutrons[ni+4] = vy * SPEED_NEUTRON;
      s.neutrons[ni+5] = vz * SPEED_NEUTRON;
      s.neutrons[ni+6] = 1; // Active
      s.neutrons[ni+7] = incomingGen + 1; // Generation
      
      s.neutronCount++;
    }

    // Spawn Fragments
    for (let f = 0; f < 2; f++) {
      if (s.fragmentCount >= MAX_FRAGMENTS) break;
      const fi = s.fragmentCount * 7;
      s.fragments[fi] = x;
      s.fragments[fi+1] = y;
      s.fragments[fi+2] = z;

      // Random Direction
      const vx = (Math.random() - 0.5) * SPEED_FRAGMENT;
      const vy = (Math.random() - 0.5) * SPEED_FRAGMENT;
      const vz = (Math.random() - 0.5) * SPEED_FRAGMENT;

      s.fragments[fi+3] = vx;
      s.fragments[fi+4] = vy;
      s.fragments[fi+5] = vz;
      s.fragments[fi+6] = 1; // Active
      s.fragmentCount++;
    }
  }, [fuel]);

  // Handle External Start Trigger
  useEffect(() => {
    if (startTrigger > 0) {
      const s = state.current;
      // Try to find the center-most atom to start with
      const centerIdx = Math.floor(atomCount / 2);
      
      if (s.atoms[centerIdx * 4 + 3] === 1) {
        triggerFission(centerIdx);
      } else {
        // Fallback: Find any active atom if center is gone
        for(let i=0; i<atomCount; i++) {
            if (s.atoms[i * 4 + 3] === 1) {
              triggerFission(i);
              break;
            }
        }
      }
    }
  }, [startTrigger, atomCount, triggerFission]);

  const tempObj = useMemo(() => new THREE.Object3D(), []);

  useFrame(() => {
    const s = state.current;
    
    // 1. Update Neutrons
    if (neutronsMeshRef.current) {
      let activeCount = 0;
      for (let i = 0; i < s.neutronCount; i++) {
        const ni = i * 8;
        if (s.neutrons[ni+6] === 0) continue; // Skip inactive

        // Move
        s.neutrons[ni] += s.neutrons[ni+3];
        s.neutrons[ni+1] += s.neutrons[ni+4];
        s.neutrons[ni+2] += s.neutrons[ni+5];

        const nx = s.neutrons[ni];
        const ny = s.neutrons[ni+1];
        const nz = s.neutrons[ni+2];

        // Bounds Check (Despawn if far out)
        if (Math.abs(nx) > BOUNDS_SIZE || Math.abs(ny) > BOUNDS_SIZE || Math.abs(nz) > BOUNDS_SIZE) {
          s.neutrons[ni+6] = 0;
          continue;
        }

        // Collision Check (Brute force O(N*M) is fine for <500 atoms)
        let hit = false;
        for (let a = 0; a < s.atomCount; a++) {
          const ai = a * 4;
          if (s.atoms[ai+3] === 0) continue;

          const dx = nx - s.atoms[ai];
          const dy = ny - s.atoms[ai+1];
          const dz = nz - s.atoms[ai+2];
          const distSq = dx*dx + dy*dy + dz*dz;
          
          // Collision radius check
          if (distSq < (fuel.radius + RADIUS_NEUTRON) ** 2) {
            // Collision!
            hit = true;
            s.neutrons[ni+6] = 0; // Absorb neutron

            // Fission Check - using modified crossSections in constants.ts for better chain reactions
            if (Math.random() < fuel.crossSection) {
              triggerFission(a, s.neutrons[ni+7]);
            }
            break; 
          }
        }

        // Update Mesh Matrix if still active
        if (!hit) {
          tempObj.position.set(nx, ny, nz);
          tempObj.scale.set(1,1,1);
          tempObj.updateMatrix();
          neutronsMeshRef.current.setMatrixAt(activeCount, tempObj.matrix);
          activeCount++;
        }
      }
      neutronsMeshRef.current.count = activeCount;
      neutronsMeshRef.current.instanceMatrix.needsUpdate = true;
    }

    // 2. Update Fragments (Visual debris)
    if (fragmentsMeshRef.current) {
      let activeCount = 0;
      for (let i = 0; i < s.fragmentCount; i++) {
        const fi = i * 7;
        if (s.fragments[fi+6] === 0) continue;

        // Move
        s.fragments[fi] += s.fragments[fi+3];
        s.fragments[fi+1] += s.fragments[fi+4];
        s.fragments[fi+2] += s.fragments[fi+5];

        // Drag/Slow down
        s.fragments[fi+3] *= FRICTION_FRAGMENT;
        s.fragments[fi+4] *= FRICTION_FRAGMENT;
        s.fragments[fi+5] *= FRICTION_FRAGMENT;

        const fx = s.fragments[fi];
        const fy = s.fragments[fi+1];
        const fz = s.fragments[fi+2];

        if (Math.abs(fx) > BOUNDS_SIZE || Math.abs(fy) > BOUNDS_SIZE || Math.abs(fz) > BOUNDS_SIZE) {
           s.fragments[fi+6] = 0;
           continue;
        }

        tempObj.position.set(fx, fy, fz);
        // Rotate for effect
        tempObj.rotation.set(fx, fy, fz); 
        tempObj.updateMatrix();
        fragmentsMeshRef.current.setMatrixAt(activeCount, tempObj.matrix);
        activeCount++;
      }
      fragmentsMeshRef.current.count = activeCount;
      fragmentsMeshRef.current.instanceMatrix.needsUpdate = true;
    }

    // 3. Report Stats (Throttled ideally, but per frame is ok for small React tree)
    onStatsUpdate({
        fuelType,
        totalAtoms: s.atomCount,
        atomsLeft: s.atomCount - s.fissionCount,
        activeNeutrons: neutronsMeshRef.current?.count || 0,
        fissionCount: s.fissionCount,
        maxGeneration: s.maxGen
    });
  });

  // Click handler for Atoms
  const handleAtomClick = (e: any) => {
    e.stopPropagation();
    const instanceId = e.instanceId;
    if (instanceId !== undefined) {
      // Manually trigger fission on the clicked atom
      triggerFission(instanceId, 0);
    }
  };

  return (
    <>
      <ambientLight intensity={0.2} />
      <pointLight position={[10, 10, 10]} intensity={1} />
      <pointLight position={[-10, -10, -10]} intensity={0.5} color="#b0b0ff" />

      {/* ATOMS */}
      <instancedMesh 
        ref={atomsMeshRef} 
        args={[undefined, undefined, atomCount]} 
        onClick={handleAtomClick}
        onPointerOver={(e) => (document.body.style.cursor = 'pointer')}
        onPointerOut={(e) => (document.body.style.cursor = 'auto')}
      >
        <sphereGeometry args={[fuel.radius, 32, 32]} />
        <meshStandardMaterial 
          color={fuel.color} 
          emissive={fuel.emissive}
          emissiveIntensity={0.4}
          roughness={0.1} 
          metalness={0.6} 
        />
      </instancedMesh>

      {/* NEUTRONS */}
      <instancedMesh ref={neutronsMeshRef} args={[undefined, undefined, MAX_NEUTRONS]}>
        <sphereGeometry args={[RADIUS_NEUTRON, 16, 16]} />
        <meshBasicMaterial color={COLOR_NEUTRON} />
      </instancedMesh>

      {/* FRAGMENTS */}
      <instancedMesh ref={fragmentsMeshRef} args={[undefined, undefined, MAX_FRAGMENTS]}>
        <dodecahedronGeometry args={[RADIUS_FRAGMENT, 0]} />
        <meshStandardMaterial color={COLOR_FRAGMENT} roughness={0.4} />
      </instancedMesh>
    </>
  );
};

const App: React.FC = () => {
  const [fuelType, setFuelType] = useState<FuelType>(FuelType.U235);
  const [atomCount, setAtomCount] = useState<number>(125); // 5x5x5
  const [stats, setStats] = useState<SimulationStats | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<string>("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisTrigger, setAnalysisTrigger] = useState(0);
  const [startTrigger, setStartTrigger] = useState(0);
  const [resetTrigger, setResetTrigger] = useState(0);

  // Throttle stats update for React state
  const handleStatsUpdate = useCallback((newStats: SimulationStats) => {
    // Only update state every 10th frame or so ideally, but simple check:
    if (Math.random() > 0.9) {
        setStats({...newStats});
    }
  }, []);

  const handleAnalyze = async () => {
    if (!stats) return;
    setIsAnalyzing(true);
    setAiAnalysis("Analyzing simulation data...");
    const result = await analyzeReaction(stats);
    setAiAnalysis(result);
    setIsAnalyzing(false);
  };

  return (
    <div className="relative w-full h-full bg-black">
      {/* 3D SCENE */}
      <Canvas camera={{ position: [20, 20, 20], fov: 45 }}>
        <color attach="background" args={['#050505']} />
        <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
        <OrbitControls makeDefault />
        <SceneContent 
          fuelType={fuelType} 
          atomCount={atomCount} 
          onStatsUpdate={handleStatsUpdate}
          triggerAnalysis={analysisTrigger}
          startTrigger={startTrigger}
          resetTrigger={resetTrigger}
        />
        <Environment preset="city" />
      </Canvas>

      {/* UI OVERLAY */}
      <div className="absolute top-4 left-4 w-80 bg-gray-900/90 text-white p-6 rounded-xl backdrop-blur-md border border-gray-700 shadow-2xl max-h-[90vh] overflow-y-auto custom-scrollbar">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-green-400 bg-clip-text text-transparent mb-4">
          Nuclear Fission 3D
        </h1>
        
        {/* Controls */}
        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-xs uppercase tracking-wider text-gray-400 mb-1">Fuel Material</label>
            <select 
              value={fuelType} 
              onChange={(e) => setFuelType(e.target.value as FuelType)}
              className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            >
              {Object.values(FuelType).map(type => (
                <option key={type} value={type}>{FUEL_CONFIG[type].name}</option>
              ))}
            </select>
            <p className="text-[10px] text-gray-500 mt-1">
              Cross-section: {Math.round(FUEL_CONFIG[fuelType].crossSection * 100)}% | Neutrons: {FUEL_CONFIG[fuelType].neutronsPerFissionMin}-{FUEL_CONFIG[fuelType].neutronsPerFissionMax}
            </p>
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-gray-400 mb-1">
              Atom Count: <span className="text-white">{atomCount}</span>
            </label>
            <input 
              type="range" 
              min="8" 
              max="512" 
              step="1" 
              value={atomCount} 
              onChange={(e) => setAtomCount(parseInt(e.target.value))}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
          </div>

           <div className="flex gap-2">
            <button 
              className="flex-1 py-3 bg-red-600 hover:bg-red-500 text-white font-bold text-sm rounded-lg shadow-lg border border-red-700 transition-all active:scale-95 uppercase tracking-wide"
              onClick={() => setStartTrigger(s => s + 1)}
            >
              Start Reaction
            </button>
            <button 
              className="px-4 py-3 bg-gray-700 hover:bg-gray-600 text-white font-bold text-sm rounded-lg shadow-lg border border-gray-600 transition-all active:scale-95 uppercase tracking-wide"
              onClick={() => setResetTrigger(s => s + 1)}
            >
              Reset
            </button>
          </div>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 gap-2 text-sm bg-gray-800 p-3 rounded-lg border border-gray-700 mb-4">
            <div>
              <p className="text-gray-400 text-xs">Atoms Left</p>
              <p className="font-mono text-lg text-white">{stats.atomsLeft}</p>
            </div>
            <div>
              <p className="text-gray-400 text-xs">Fissions</p>
              <p className="font-mono text-lg text-orange-400">{stats.fissionCount}</p>
            </div>
            <div>
              <p className="text-gray-400 text-xs">Neutrons</p>
              <p className="font-mono text-lg text-blue-400">{stats.activeNeutrons}</p>
            </div>
            <div>
              <p className="text-gray-400 text-xs">Generation</p>
              <p className="font-mono text-lg text-green-400">{stats.maxGeneration}</p>
            </div>
          </div>
        )}

        {/* Interaction Hint */}
        <div className="text-center text-xs text-gray-400 italic mb-4 border-t border-gray-700 pt-2">
          "Click 'Start' or tap any atom"
        </div>

        {/* AI Analysis */}
        <button 
          onClick={handleAnalyze}
          disabled={isAnalyzing}
          className={`w-full py-2 px-4 rounded font-semibold transition-all flex items-center justify-center gap-2
            ${isAnalyzing 
              ? 'bg-gray-700 text-gray-400 cursor-not-allowed' 
              : 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white shadow-lg hover:shadow-blue-500/25'
            }`}
        >
          {isAnalyzing ? (
            <>
              <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Analyzing...
            </>
          ) : (
            <>
              ✨ Analyze Reaction
            </>
          )}
        </button>

        {aiAnalysis && (
          <div className="mt-4 p-3 bg-gray-800/50 rounded border border-gray-600 text-xs leading-relaxed text-gray-200 max-h-40 overflow-y-auto">
            {aiAnalysis}
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
