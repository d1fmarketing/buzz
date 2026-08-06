import { copyDefaultLimits } from "./limits";
import type { CockpitState } from "./types";

const STARTER_TIME = "2026-08-06T16:00:00.000Z";
const HONEY_PUBKEY =
  "1111111111111111111111111111111111111111111111111111111111111111";
const FIZZ_PUBKEY =
  "2222222222222222222222222222222222222222222222222222222222222222";
const BUMBLE_PUBKEY =
  "3333333333333333333333333333333333333333333333333333333333333333";
const CRITIC_PUBKEY =
  "4444444444444444444444444444444444444444444444444444444444444444";

export const EMPTY_STATE: CockpitState = {
  version: 1,
  starter: false,
  updatedAt: STARTER_TIME,
  projects: [],
  missions: [],
  dispatches: [],
  agents: [],
  attention: [],
  messages: [],
};

/**
 * A visibly-labelled starter workspace. It is returned only when the server
 * has no persisted cockpit content and is removed by the first real create.
 */
export const STARTER_STATE: CockpitState = {
  version: 1,
  starter: true,
  updatedAt: STARTER_TIME,
  projects: [
    {
      id: "starter-project",
      name: "Projeto de exemplo · Venture Studio",
      description:
        "Conteúdo de demonstração para apresentar projetos, missões e branches.",
      color: "#D97757",
      missionIds: ["starter-mission"],
      createdAt: STARTER_TIME,
      updatedAt: STARTER_TIME,
      isSample: true,
    },
  ],
  missions: [
    {
      id: "starter-mission",
      projectId: "starter-project",
      title: "Missão de exemplo · Refinar uma oportunidade",
      objective: "Demonstrar o loop Isa → especialistas → síntese.",
      brief:
        "Exemplo local. Nenhum prompt desta missão foi enviado ao Buzz ou consumiu uma API.",
      status: "running",
      channelId: "starter-channel",
      threadIds: ["starter-thread-honey", "starter-thread-fizz"],
      agentIds: [HONEY_PUBKEY, FIZZ_PUBKEY, BUMBLE_PUBKEY, CRITIC_PUBKEY],
      dispatchIds: ["starter-dispatch-honey", "starter-dispatch-fizz"],
      limits: copyDefaultLimits(),
      createdAt: STARTER_TIME,
      updatedAt: STARTER_TIME,
      isSample: true,
    },
  ],
  dispatches: [
    {
      id: "starter-dispatch-honey",
      missionId: "starter-mission",
      agentId: HONEY_PUBKEY,
      agentName: "Honey",
      prompt: "Mapear sinais e hipóteses de forma independente.",
      status: "handed_off",
      receipts: [
        { status: "planned", at: STARTER_TIME },
        { status: "sent", at: STARTER_TIME, eventId: "starter-event-honey" },
        { status: "relay_accepted", at: STARTER_TIME },
        { status: "working", at: STARTER_TIME },
        {
          status: "response_received",
          at: STARTER_TIME,
          eventId: "starter-response-honey",
        },
        {
          status: "handoff_proposed",
          at: STARTER_TIME,
          targetAgentIds: [FIZZ_PUBKEY],
        },
        {
          status: "handed_off",
          at: STARTER_TIME,
          targetAgentIds: [FIZZ_PUBKEY],
        },
      ],
      depth: 0,
      criticCycle: 0,
      retryCount: 0,
      proposedAgentIds: [FIZZ_PUBKEY],
      threadId: "starter-thread-honey",
      eventId: "starter-event-honey",
      responseEventId: "starter-response-honey",
      createdAt: STARTER_TIME,
      updatedAt: STARTER_TIME,
      isSample: true,
    },
    {
      id: "starter-dispatch-fizz",
      missionId: "starter-mission",
      agentId: FIZZ_PUBKEY,
      agentName: "Fizz",
      prompt: "Testar as hipóteses e apontar contradições.",
      status: "working",
      receipts: [
        { status: "planned", at: STARTER_TIME },
        { status: "sent", at: STARTER_TIME, eventId: "starter-event-fizz" },
        { status: "relay_accepted", at: STARTER_TIME },
        { status: "working", at: STARTER_TIME },
      ],
      depth: 1,
      criticCycle: 0,
      retryCount: 0,
      proposedAgentIds: [],
      parentDispatchId: "starter-dispatch-honey",
      threadId: "starter-thread-fizz",
      eventId: "starter-event-fizz",
      createdAt: STARTER_TIME,
      updatedAt: STARTER_TIME,
      isSample: true,
    },
  ],
  agents: [
    {
      id: HONEY_PUBKEY,
      pubkey: HONEY_PUBKEY,
      name: "Honey",
      role: "Research",
      presence: "online",
      activity: "idle",
      lastResponseAt: STARTER_TIME,
      statusUpdatedAt: STARTER_TIME,
      isSample: true,
    },
    {
      id: FIZZ_PUBKEY,
      pubkey: FIZZ_PUBKEY,
      name: "Fizz",
      role: "Analysis",
      presence: "online",
      activity: "working",
      statusUpdatedAt: STARTER_TIME,
      isSample: true,
    },
    {
      id: BUMBLE_PUBKEY,
      pubkey: BUMBLE_PUBKEY,
      name: "Bumble",
      role: "Strategy",
      presence: "away",
      activity: "idle",
      statusUpdatedAt: STARTER_TIME,
      isSample: true,
    },
    {
      id: CRITIC_PUBKEY,
      pubkey: CRITIC_PUBKEY,
      name: "Critic",
      role: "Critical review",
      presence: "offline",
      activity: "unknown",
      statusUpdatedAt: STARTER_TIME,
      isSample: true,
    },
  ],
  attention: [
    {
      id: "starter-attention",
      kind: "handoff",
      severity: "info",
      title: "Exemplo: handoff proposto",
      detail: "Honey propôs Fizz e a Isa confirmou o encaminhamento.",
      projectId: "starter-project",
      missionId: "starter-mission",
      dispatchId: "starter-dispatch-honey",
      createdAt: STARTER_TIME,
      isSample: true,
    },
  ],
  messages: [
    {
      id: "starter-message-isa",
      channelId: "starter-channel",
      content:
        "Honey, investigue esta oportunidade sem ler os outros branches.",
      authorPubkey: "starter-isa",
      authorName: "Isa",
      createdAt: STARTER_TIME,
      kind: 9,
      tags: [["p", HONEY_PUBKEY]],
      attachments: [],
      threadId: "starter-thread-honey",
      rootId: "starter-thread-honey",
      isMine: true,
      isSample: true,
    },
    {
      id: "starter-message-honey",
      channelId: "starter-channel",
      content:
        "Resultado de demonstração concluído. Próximo especialista: Fizz, para validar as contradições.",
      authorPubkey: HONEY_PUBKEY,
      authorName: "Honey",
      createdAt: STARTER_TIME,
      kind: 9,
      tags: [["p", FIZZ_PUBKEY]],
      attachments: [],
      threadId: "starter-thread-honey",
      rootId: "starter-thread-honey",
      replyToId: "starter-message-isa",
      isSample: true,
    },
  ],
};

export function cloneCockpitState(state: CockpitState): CockpitState {
  return {
    ...state,
    projects: state.projects.map((project) => ({
      ...project,
      missionIds: [...project.missionIds],
    })),
    missions: state.missions.map((mission) => ({
      ...mission,
      threadIds: [...mission.threadIds],
      agentIds: [...mission.agentIds],
      dispatchIds: [...mission.dispatchIds],
      limits: { ...mission.limits },
    })),
    dispatches: state.dispatches.map((dispatch) => ({
      ...dispatch,
      proposedAgentIds: [...dispatch.proposedAgentIds],
      receipts: dispatch.receipts.map((receipt) => ({
        ...receipt,
        targetAgentIds: receipt.targetAgentIds
          ? [...receipt.targetAgentIds]
          : undefined,
      })),
    })),
    agents: state.agents.map((agent) => ({ ...agent })),
    attention: state.attention.map((item) => ({ ...item })),
    messages: state.messages.map((message) => ({
      ...message,
      tags: message.tags.map((tag) => [...tag]),
      attachments: message.attachments.map((attachment) => ({ ...attachment })),
    })),
  };
}
