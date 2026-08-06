import { copyDefaultLimits } from "./limits";
import { cloneCockpitState, EMPTY_STATE, STARTER_STATE } from "./starter";
import type {
  CockpitState,
  ChannelSummary,
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
  buzzChannelId?: string;
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
  const buzzChannelId = input.buzzChannelId?.trim().toLowerCase();
  if (
    buzzChannelId &&
    base.projects.some(
      (project) => project.buzzChannelId?.toLowerCase() === buzzChannelId,
    )
  ) {
    throw new Error(`Buzz channel ${buzzChannelId} is already linked`);
  }

  const project: Project = {
    id,
    name,
    description: input.description?.trim() ?? "",
    color: input.color ?? "#D97757",
    buzzChannelId: buzzChannelId || undefined,
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

export type BuzzChannelImportConflictReason =
  | "invalid_channel"
  | "duplicate_source"
  | "channel_identity_collision"
  | "ambiguous_legacy"
  | "ambiguous_name";

export interface BuzzChannelImportConflict {
  channelId: string;
  channelName: string;
  reason: BuzzChannelImportConflictReason;
  projectIds: string[];
}

export interface BuzzChannelImportResult {
  state: CockpitState;
  importedProjectIds: string[];
  linkedProjectIds: string[];
  conflicts: BuzzChannelImportConflict[];
}

function normalizedProjectName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function deterministicChannelProjectId(channelId: string): string {
  return `buzz-channel:${channelId}`;
}

function projectReferencesChannel(
  state: CockpitState,
  projectId: string,
  channelId: string,
): boolean {
  return state.missions.some(
    (mission) =>
      mission.projectId === projectId &&
      (mission.channelId?.toLowerCase() === channelId ||
        mission.conversationRefs?.some(
          (conversation) => conversation.channelId.toLowerCase() === channelId,
        )),
  );
}

/**
 * Import selected Buzz channels as local project workspaces. Channel UUIDs are
 * the durable identity; imported presentation fields are never synchronized
 * over subsequent user edits.
 */
export function importBuzzChannelProjects(
  state: CockpitState,
  channels: readonly ChannelSummary[],
  now?: string,
): BuzzChannelImportResult {
  const timestamp = nowIso(now);
  const uniqueChannels = new Map<string, ChannelSummary>();
  const conflicts: BuzzChannelImportConflict[] = [];

  for (const channel of channels) {
    const channelId = channel.id.trim().toLowerCase();
    const channelName = channel.name.trim();
    if (!channelId || !channelName) {
      conflicts.push({
        channelId,
        channelName,
        reason: "invalid_channel",
        projectIds: [],
      });
      continue;
    }
    if (!uniqueChannels.has(channelId)) {
      uniqueChannels.set(channelId, {
        ...channel,
        id: channelId,
        name: channelName,
      });
    }
  }

  if (uniqueChannels.size === 0) {
    return {
      state,
      importedProjectIds: [],
      linkedProjectIds: [],
      conflicts,
    };
  }

  const base = state.starter ? createEmptyState(timestamp) : state;
  let projects = base.projects;
  let changed = false;
  const importedProjectIds: string[] = [];
  const linkedProjectIds: string[] = [];
  const claimedProjectIds = new Set<string>();
  const channelNameCounts = new Map<string, number>();

  for (const channel of uniqueChannels.values()) {
    const name = normalizedProjectName(channel.name);
    channelNameCounts.set(name, (channelNameCounts.get(name) ?? 0) + 1);
  }

  const selectedChannelIds = [...uniqueChannels.keys()];
  const legacyChannelCounts = new Map<string, number>();
  for (const project of projects) {
    const count = selectedChannelIds.filter((channelId) =>
      projectReferencesChannel(base, project.id, channelId),
    ).length;
    legacyChannelCounts.set(project.id, count);
  }

  const addConflict = (
    channel: ChannelSummary,
    reason: BuzzChannelImportConflictReason,
    candidates: readonly Project[],
  ) => {
    conflicts.push({
      channelId: channel.id,
      channelName: channel.name,
      reason,
      projectIds: [...new Set(candidates.map((project) => project.id))],
    });
  };

  const linkProject = (project: Project, channelId: string) => {
    const updated: Project = {
      ...project,
      buzzChannelId: channelId,
      updatedAt: timestamp,
    };
    projects = projects.map((candidate) =>
      candidate.id === project.id ? updated : candidate,
    );
    claimedProjectIds.add(project.id);
    linkedProjectIds.push(project.id);
    changed = true;
  };

  for (const channel of uniqueChannels.values()) {
    const channelId = channel.id;
    const sourceMatches = projects.filter(
      (project) => project.buzzChannelId?.toLowerCase() === channelId,
    );
    if (sourceMatches.length > 1) {
      addConflict(channel, "duplicate_source", sourceMatches);
      continue;
    }
    if (sourceMatches.length === 1) {
      claimedProjectIds.add(sourceMatches[0].id);
      continue;
    }

    const deterministicId = deterministicChannelProjectId(channelId);
    const deterministicMatch = projects.find(
      (project) => project.id === deterministicId,
    );
    if (deterministicMatch) {
      if (
        claimedProjectIds.has(deterministicMatch.id) ||
        (deterministicMatch.buzzChannelId &&
          deterministicMatch.buzzChannelId.toLowerCase() !== channelId)
      ) {
        addConflict(channel, "channel_identity_collision", [
          deterministicMatch,
        ]);
        continue;
      }
      linkProject(deterministicMatch, channelId);
      continue;
    }

    const allLegacyMatches = projects.filter(
      (project) =>
        !project.buzzChannelId &&
        !claimedProjectIds.has(project.id) &&
        projectReferencesChannel(base, project.id, channelId),
    );
    const legacyMatches = allLegacyMatches.filter(
      (project) => legacyChannelCounts.get(project.id) === 1,
    );
    if (allLegacyMatches.length > 0 && legacyMatches.length !== 1) {
      addConflict(channel, "ambiguous_legacy", allLegacyMatches);
      continue;
    }
    if (legacyMatches.length === 1) {
      linkProject(legacyMatches[0], channelId);
      continue;
    }

    const normalizedName = normalizedProjectName(channel.name);
    const nameMatches = projects.filter(
      (project) =>
        !project.buzzChannelId &&
        !claimedProjectIds.has(project.id) &&
        normalizedProjectName(project.name) === normalizedName,
    );
    if ((channelNameCounts.get(normalizedName) ?? 0) > 1) {
      if (nameMatches.length > 0) {
        addConflict(channel, "ambiguous_name", nameMatches);
        continue;
      }
    } else if (nameMatches.length > 1) {
      addConflict(channel, "ambiguous_name", nameMatches);
      continue;
    } else if (nameMatches.length === 1) {
      linkProject(nameMatches[0], channelId);
      continue;
    }

    const project: Project = {
      id: deterministicId,
      name: channel.name,
      description: channel.about ?? channel.purpose ?? channel.topic ?? "",
      color: "#6e5ae6",
      buzzChannelId: channelId,
      missionIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    projects = [...projects, project];
    claimedProjectIds.add(project.id);
    importedProjectIds.push(project.id);
    changed = true;
  }

  if (!changed) {
    return {
      state,
      importedProjectIds,
      linkedProjectIds,
      conflicts,
    };
  }

  return {
    state: {
      ...base,
      starter: false,
      updatedAt: timestamp,
      projects,
    },
    importedProjectIds,
    linkedProjectIds,
    conflicts,
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

export interface EnsureProjectConversationMissionResult {
  state: CockpitState;
  mission: Mission;
}

/**
 * Ensure one stable, local mission anchors the continuous conversation for an
 * imported Buzz-channel project. The deterministic id is never trusted by
 * itself: project and channel ownership must also match before reuse.
 */
export function ensureProjectConversationMission(
  state: CockpitState,
  projectId: string,
  now?: string,
): EnsureProjectConversationMissionResult {
  const project = state.projects.find(
    (candidate) => candidate.id === projectId,
  );
  if (!project) {
    throw new Error(`Project ${projectId} does not exist`);
  }
  const channelId = project.buzzChannelId?.trim().toLowerCase();
  if (!channelId) {
    throw new Error(`Project ${projectId} is not linked to a Buzz channel`);
  }

  const missionId = `project-conversation:${channelId}`;
  const existing = state.missions.find((mission) => mission.id === missionId);
  if (existing) {
    if (
      existing.projectId !== project.id ||
      existing.channelId?.toLowerCase() !== channelId
    ) {
      throw new Error(
        `Conversation mission ${missionId} belongs to another project or channel`,
      );
    }
    return { state, mission: existing };
  }

  const next = createMission(state, {
    id: missionId,
    projectId: project.id,
    title: "Conversa contínua",
    objective: "Manter a conversa deste projeto no mesmo canal do Buzz.",
    brief: "Workspace contínuo vinculado ao canal do projeto.",
    channelId,
    now,
  });
  const mission = next.missions.find((candidate) => candidate.id === missionId);
  if (!mission) {
    throw new Error(`Conversation mission ${missionId} was not created`);
  }
  return { state: next, mission };
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
