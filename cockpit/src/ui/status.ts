import type { AgentActivity, AgentPresence, MissionStatus } from "../domain";
import type { Tone } from "./primitives";

export const missionStatusLabel: Record<MissionStatus, string> = {
  draft: "Rascunho",
  running: "Em curso",
  paused: "Pausada",
  awaiting_rj: "Decisão do RJ",
  completed: "Concluída",
  blocked: "Bloqueada",
};

export const missionStatusTone: Record<MissionStatus, Tone> = {
  draft: "neutral",
  running: "violet",
  paused: "amber",
  awaiting_rj: "amber",
  completed: "mint",
  blocked: "danger",
};

export const presenceLabel: Record<AgentPresence, string> = {
  online: "Online",
  away: "Ausente",
  offline: "Offline",
  unknown: "Sem sinal",
};

export const activityLabel: Record<AgentActivity, string> = {
  working: "Trabalhando",
  idle: "Disponível",
  unknown: "Não observada",
};
