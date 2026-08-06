import type { MissionLimits } from "./types";

export const DEFAULT_LIMITS: Readonly<MissionLimits> = Object.freeze({
  initialSpecialists: 4,
  maxSpecialists: 7,
  maxChildrenPerResponse: 2,
  maxHandoffDepth: 3,
  maxCriticCycles: 2,
  maxDispatches: 16,
  maxRetriesPerDispatch: 1,
  maxNoNoveltyRounds: 2,
});

export function copyDefaultLimits(): MissionLimits {
  return { ...DEFAULT_LIMITS };
}
