import type { Dispatch, Mission } from "./types";

export type DispatchBlockCode =
  | "mission_not_active"
  | "dispatch_budget"
  | "specialist_budget"
  | "handoff_depth"
  | "children_budget"
  | "critic_cycles"
  | "retry_budget"
  | "no_material_gain";

export type DispatchGuardResult =
  | { allowed: true }
  | { allowed: false; code: DispatchBlockCode; message: string };

export interface DispatchCandidate {
  agentId: string;
  depth: number;
  criticCycle?: number;
  retryCount?: number;
  parentDispatchId?: string;
  noMaterialGainRounds?: number;
}

/**
 * Apply the mission's explicit stop conditions before another Buzz send.
 * This is intentionally a pure frontend guard: Buzz remains the source of
 * truth for messages and receipts, while the cockpit owns only loop policy.
 */
export function guardMissionDispatch(
  mission: Mission,
  allDispatches: readonly Dispatch[],
  candidate: DispatchCandidate,
): DispatchGuardResult {
  if (mission.status !== "draft" && mission.status !== "running") {
    return {
      allowed: false,
      code: "mission_not_active",
      message: "A missão está pausada ou encerrada.",
    };
  }

  const dispatches = allDispatches.filter(
    (dispatch) => dispatch.missionId === mission.id,
  );
  if (dispatches.length >= mission.limits.maxDispatches) {
    return {
      allowed: false,
      code: "dispatch_budget",
      message: `A missão atingiu o limite de ${mission.limits.maxDispatches} dispatches.`,
    };
  }

  const specialists = new Set(dispatches.map((dispatch) => dispatch.agentId));
  specialists.add(candidate.agentId);
  if (specialists.size > mission.limits.maxSpecialists) {
    return {
      allowed: false,
      code: "specialist_budget",
      message: `A missão atingiu o limite de ${mission.limits.maxSpecialists} especialistas.`,
    };
  }

  if (candidate.depth > mission.limits.maxHandoffDepth) {
    return {
      allowed: false,
      code: "handoff_depth",
      message: `O handoff ultrapassaria a profundidade ${mission.limits.maxHandoffDepth}.`,
    };
  }

  if (candidate.parentDispatchId) {
    const children = dispatches.filter(
      (dispatch) => dispatch.parentDispatchId === candidate.parentDispatchId,
    );
    if (children.length >= mission.limits.maxChildrenPerResponse) {
      return {
        allowed: false,
        code: "children_budget",
        message: `A resposta já originou ${mission.limits.maxChildrenPerResponse} próximos agentes.`,
      };
    }
  }

  if ((candidate.criticCycle ?? 0) > mission.limits.maxCriticCycles) {
    return {
      allowed: false,
      code: "critic_cycles",
      message: `A missão atingiu ${mission.limits.maxCriticCycles} ciclos builder ↔ critic.`,
    };
  }

  if ((candidate.retryCount ?? 0) > mission.limits.maxRetriesPerDispatch) {
    return {
      allowed: false,
      code: "retry_budget",
      message: `O dispatch já usou a repetição permitida (${mission.limits.maxRetriesPerDispatch}).`,
    };
  }

  if (
    (candidate.noMaterialGainRounds ?? 0) >= mission.limits.maxNoNoveltyRounds
  ) {
    return {
      allowed: false,
      code: "no_material_gain",
      message: `Duas rodadas não trouxeram ganho material; a missão deve parar ou mudar de direção.`,
    };
  }

  return { allowed: true };
}
