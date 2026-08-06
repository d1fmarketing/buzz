import { copyDefaultLimits } from "./limits";
import { cloneCockpitState, EMPTY_STATE, STARTER_STATE } from "./starter";
import type {
  CockpitState,
  Dispatch,
  DispatchReceipt,
  Mission,
  MissionConversationRef,
  Project,
} from "./types";

function nowIso(now?: string): string {
  return now ?? new Date().toISOString();
}

function localId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) {
    return `${prefix}-${uuid}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createEmptyState(now?: string): CockpitState {
  return { ...cloneCockpitState(EMPTY_STATE), updatedAt: nowIso(now) };
}

export function hasStateContent(
  state: Partial<CockpitState> | null | undefined,
): boolean {
  if (!state) {
    return false;
  }
  return [
    state.projects,
    state.missions,
    state.dispatches,
    state.agents,
    state.attention,
    state.messages,
  ].some((collection) => Array.isArray(collection) && collection.length > 0);
}

export function createInitialState(
  serverState?: CockpitState | null,
): CockpitState {
  if (serverState && hasStateContent(serverState)) {
    return cloneCockpitState(serverState);
  }
  return cloneCockpitState(STARTER_STATE);
}

function withoutStarterData(state: CockpitState, now: string): CockpitState {
  return state.starter ? createEmptyState(now) : state;
}

export interface CreateProjectInput {
  id?: string;
  name: string;
  description?: string;
  color?: string;
  now?: string;
}

export function createProject(
  state: CockpitState,
  input: CreateProjectInput,
): CockpitState {
  const timestamp = nowIso(input.now);
  const base = withoutStarterData(state, timestamp);
  const name = input.name.trim();
  if (!name) {
    throw new Error("Project name is required");
  }
  const id = input.id?.trim() || localId("project");
  if (base.projects.some((project) => project.id === id)) {
    throw new Error(`Project ${id} already exists`);
  }

  const project: Project = {
    id,
    name,
    description: input.description?.trim() ?? "",
    color: input.color ?? "#D97757",
    missionIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  return {
    ...base,
    starter: false,
    updatedAt: timestamp,
    projects: [...base.projects, project],
  };
}

export interface CreateMissionInput {
  id?: string;
  projectId: string;
  title: string;
  objective?: string;
  brief?: string;
  channelId?: string;
  agentIds?: string[];
  limits?: Partial<Mission["limits"]>;
  now?: string;
}

export function createMission(
  state: CockpitState,
  input: CreateMissionInput,
): CockpitState {
  const timestamp = nowIso(input.now);
  const base = withoutStarterData(state, timestamp);
  const project = base.projects.find(({ id }) => id === input.projectId);
  if (!project) {
    throw new Error(`Project ${input.projectId} does not exist`);
  }
  const title = input.title.trim();
  if (!title) {
    throw new Error("Mission title is required");
  }
  const id = input.id?.trim() || localId("mission");
  if (base.missions.some((mission) => mission.id === id)) {
    throw new Error(`Mission ${id} already exists`);
  }

  const mission: Mission = {
    id,
    projectId: project.id,
    title,
    objective: input.objective?.trim() ?? "",
    brief: input.brief?.trim() ?? "",
    status: "draft",
    channelId: input.channelId,
    threadIds: [],
    conversationRefs: [],
    agentIds: [...new Set(input.agentIds ?? [])],
    dispatchIds: [],
    limits: { ...copyDefaultLimits(), ...input.limits },
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  return {
    ...base,
    starter: false,
    updatedAt: timestamp,
    projects: base.projects.map((candidate) =>
      candidate.id === project.id
        ? {
            ...candidate,
            missionIds: [...candidate.missionIds, id],
            updatedAt: timestamp,
          }
        : candidate,
    ),
    missions: [...base.missions, mission],
  };
}

export type MissionPatch = Partial<
  Omit<Mission, "id" | "projectId" | "createdAt" | "updatedAt">
>;

export function updateMission(
  state: CockpitState,
  missionId: string,
  patch: MissionPatch,
  now?: string,
): CockpitState {
  const timestamp = nowIso(now);
  const current = state.missions.find(({ id }) => id === missionId);
  if (!current) {
    throw new Error(`Mission ${missionId} does not exist`);
  }

  const status = patch.status ?? current.status;
  const updated: Mission = {
    ...current,
    ...patch,
    threadIds: patch.threadIds
      ? [...new Set(patch.threadIds)]
      : current.threadIds,
    conversationRefs: patch.conversationRefs
      ? [
          ...new Map(
            patch.conversationRefs.map((conversation) => [
              conversation.id,
              {
                ...conversation,
                agentIds: [...new Set(conversation.agentIds)],
              },
            ]),
          ).values(),
        ]
      : current.conversationRefs,
    agentIds: patch.agentIds ? [...new Set(patch.agentIds)] : current.agentIds,
    dispatchIds: patch.dispatchIds
      ? [...new Set(patch.dispatchIds)]
      : current.dispatchIds,
    limits: patch.limits ? { ...patch.limits } : current.limits,
    status,
    completedAt:
      status === "completed"
        ? (patch.completedAt ?? current.completedAt ?? timestamp)
        : undefined,
    updatedAt: timestamp,
  };

  return {
    ...state,
    starter: false,
    updatedAt: timestamp,
    missions: state.missions.map((mission) =>
      mission.id === missionId ? updated : mission,
    ),
  };
}

export function linkThread(
  state: CockpitState,
  missionId: string,
  threadId: string,
  now?: string,
): CockpitState {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) {
    throw new Error("Thread id is required");
  }
  const mission = state.missions.find(({ id }) => id === missionId);
  if (!mission) {
    throw new Error(`Mission ${missionId} does not exist`);
  }
  if (mission.threadIds.includes(normalizedThreadId)) {
    return state;
  }
  const timestamp = nowIso(now);
  const conversationRefs = mission.channelId
    ? [
        ...(mission.conversationRefs ?? []),
        {
          id: `${mission.channelId}:${normalizedThreadId}`,
          channelId: mission.channelId,
          rootEventId: normalizedThreadId,
          agentIds: [],
          linkedAt: timestamp,
        },
      ]
    : mission.conversationRefs;
  return updateMission(
    state,
    missionId,
    {
      threadIds: [...mission.threadIds, normalizedThreadId],
      conversationRefs,
    },
    timestamp,
  );
}

export function linkConversation(
  state: CockpitState,
  missionId: string,
  input: Omit<MissionConversationRef, "id" | "linkedAt"> & {
    id?: string;
    linkedAt?: string;
  },
  now?: string,
): CockpitState {
  const mission = state.missions.find(({ id }) => id === missionId);
  if (!mission) throw new Error(`Mission ${missionId} does not exist`);
  const timestamp = input.linkedAt ?? nowIso(now);
  const id =
    input.id ?? `${input.channelId}:${input.rootEventId ?? "channel-root"}`;
  const conversation: MissionConversationRef = {
    ...input,
    id,
    linkedAt: timestamp,
    agentIds: [...new Set(input.agentIds)],
  };
  const refs = mission.conversationRefs ?? [];
  const existing = refs.find((candidate) => candidate.id === id);
  const mergedConversation = existing
    ? {
        ...existing,
        ...conversation,
        label: conversation.label ?? existing.label,
        agentIds: [
          ...new Set([...existing.agentIds, ...conversation.agentIds]),
        ],
      }
    : conversation;
  const nextRefs = existing
    ? refs.map((candidate) =>
        candidate.id === id ? mergedConversation : candidate,
      )
    : [...refs, conversation];
  return updateMission(
    state,
    missionId,
    {
      conversationRefs: nextRefs,
      threadIds: input.rootEventId
        ? [...mission.threadIds, input.rootEventId]
        : mission.threadIds,
    },
    timestamp,
  );
}

export type UpsertDispatchInput = Pick<
  Dispatch,
  "id" | "missionId" | "agentId" | "agentName" | "status"
> &
  Partial<
    Omit<
      Dispatch,
      | "id"
      | "missionId"
      | "agentId"
      | "agentName"
      | "status"
      | "createdAt"
      | "updatedAt"
    >
  > & {
    createdAt?: string;
    updatedAt?: string;
  };

export function upsertDispatch(
  state: CockpitState,
  input: UpsertDispatchInput,
  now?: string,
): CockpitState {
  const timestamp = nowIso(now ?? input.updatedAt);
  const mission = state.missions.find(({ id }) => id === input.missionId);
  if (!mission) {
    throw new Error(`Mission ${input.missionId} does not exist`);
  }
  const existing = state.dispatches.find(({ id }) => id === input.id);
  const dispatch: Dispatch = {
    id: input.id,
    missionId: input.missionId,
    agentId: input.agentId,
    agentName: input.agentName,
    prompt: input.prompt ?? existing?.prompt ?? "",
    status: input.status,
    receipts: (input.receipts ?? existing?.receipts ?? []).map((receipt) => ({
      ...receipt,
      targetAgentIds: receipt.targetAgentIds
        ? [...receipt.targetAgentIds]
        : undefined,
    })),
    depth: input.depth ?? existing?.depth ?? 0,
    criticCycle: input.criticCycle ?? existing?.criticCycle ?? 0,
    retryCount: input.retryCount ?? existing?.retryCount ?? 0,
    proposedAgentIds: [
      ...new Set(input.proposedAgentIds ?? existing?.proposedAgentIds ?? []),
    ],
    parentDispatchId: input.parentDispatchId ?? existing?.parentDispatchId,
    channelId: input.channelId ?? existing?.channelId,
    threadId: input.threadId ?? existing?.threadId,
    eventId: input.eventId ?? existing?.eventId,
    responseEventId: input.responseEventId ?? existing?.responseEventId,
    createdAt: existing?.createdAt ?? input.createdAt ?? timestamp,
    updatedAt: timestamp,
    isSample: input.isSample ?? existing?.isSample,
  };

  return {
    ...state,
    starter: false,
    updatedAt: timestamp,
    missions: state.missions.map((candidate) =>
      candidate.id === mission.id
        ? {
            ...candidate,
            dispatchIds: candidate.dispatchIds.includes(dispatch.id)
              ? candidate.dispatchIds
              : [...candidate.dispatchIds, dispatch.id],
            updatedAt: timestamp,
          }
        : candidate,
    ),
    dispatches: existing
      ? state.dispatches.map((candidate) =>
          candidate.id === dispatch.id ? dispatch : candidate,
        )
      : [...state.dispatches, dispatch],
  };
}

export function appendDispatchReceipt(
  state: CockpitState,
  dispatchId: string,
  receipt: DispatchReceipt,
): CockpitState {
  const dispatch = state.dispatches.find(({ id }) => id === dispatchId);
  if (!dispatch) {
    throw new Error(`Dispatch ${dispatchId} does not exist`);
  }
  return upsertDispatch(
    state,
    {
      ...dispatch,
      status: receipt.status,
      receipts: [...dispatch.receipts, { ...receipt }],
      updatedAt: receipt.at,
    },
    receipt.at,
  );
}
