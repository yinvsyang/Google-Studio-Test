
import { GoogleGenAI } from "@google/genai";
import { SimulationStats } from "../types";
import { FUEL_CONFIG } from "../constants";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const analyzeReaction = async (stats: SimulationStats): Promise<string> => {
  try {
    const fuelInfo = FUEL_CONFIG[stats.fuelType];
    
    const prompt = `
      You are a nuclear physics expert observing a 3D simulation of a fission chain reaction.
      
      Current Simulation State:
      - Fuel Type: ${stats.fuelType}
      - Initial Atoms: ${stats.totalAtoms}
      - Atoms Fissioned: ${stats.fissionCount} (${((stats.fissionCount / stats.totalAtoms) * 100).toFixed(1)}% burned)
      - Active Neutrons: ${stats.activeNeutrons}
      - Reaction Generation Depth: ${stats.maxGeneration}
      
      Fuel Properties used in Sim:
      - Fission Probability (Cross Section): ${fuelInfo.crossSection * 100}%
      - Avg Neutrons per Fission: ~${(fuelInfo.neutronsPerFissionMin + fuelInfo.neutronsPerFissionMax) / 2}
      
      Analyze the criticality of this reaction. 
      1. Is it sub-critical, critical, or super-critical based on the numbers?
      2. How does the choice of ${stats.fuelType} affect the speed/spread compared to other fuels?
      3. Provide a brief educational fun fact about ${stats.fuelType}.
      
      Keep the response concise (under 100 words), strictly physics-focused, and in plain text suitable for a UI overlay.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    return response.text || "Analysis unavailable.";
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    return "Unable to contact the nuclear regulatory commission AI (API Error).";
  }
};
