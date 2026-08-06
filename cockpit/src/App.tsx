import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, X } from "lucide-react";
import {
  appendDispatchReceipt,
  createInitialState,
  createMission,
  createProject,
  detectExplicitHandoff,
  ensureProjectConversationMission,
  guardMissionDispatch,
  importBuzzChannelProjects,
  linkConversation,
  updateMission,
  upsertDispatch,
  type AgentSummary,
  type CockpitState,
  type DispatchReceipt,
  type Message,
  type Mission,
  type MissionStatus,
} from "./domain";
import {
  normalizeAgentsResponse,
  normalizeChannelsResponse,
  normalizeCockpitState,
  normalizeMessagesResponse,
  normalizeWriteReceipt,
  reconcileBuzzMessageEdits,
} from "./data";
import { cockpitApi, fileToAttachment, type HealthStatus } from "./ui/api";
import type { ComposerSubmission } from "./ui/Composer";
import { MissionWorkspace } from "./ui/MissionWorkspace";
import { ErrorScreen, LoadingScreen } from "./ui/primitives";
import {
  AppShell,
  type CockpitMode,
  type MissionViewMode,
  type RouteDescriptor,
} from "./ui/Shell";
import { navigate, useRouteLocation } from "./ui/router";
import {
  AgentsView,
  AttentionView,
  HomeView,
  NotFoundView,
  ProjectView,
} from "./ui/Views";

const OFFLINE_HEALTH: HealthStatus = {
  ok: false,
  cliAvailable: false,
  relayConfigured: false,
  authenticated: false,
};

function decodePart(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function routeFromPath(pathname: string): RouteDescriptor {
  if (pathname === "/") return { kind: "home" };
  // Legacy global activity URLs fail closed into the project chooser. A
  // project route is now the only place where a conversation timeline exists.
  if (pathname === "/activity") return { kind: "home" };
  if (pathname === "/agents") return { kind: "agents" };
  if (pathname === "/attention") return { kind: "attention" };

  const missionMatch = pathname.match(
    /^\/projects\/([^/]+)\/missions\/([^/]+)\/?$/,
  );
  if (missionMatch) {
    return {
      kind: "mission",
      projectId: decodePart(missionMatch[1]),
      missionId: decodePart(missionMatch[2]),
    };
  }
  const projectMatch = pathname.match(/^\/projects\/([^/]+)\/?$/);
  if (projectMatch) {
    return { kind: "project", projectId: decodePart(projectMatch[1]) };
  }
  return { kind: "not-found" };
}

function newLocalId(prefix: string): string {
  const value =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${value}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "O adaptador local não concluiu a operação.";
}

async function mapSettledWithLimit<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(values.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        try {
          results[index] = {
            status: "fulfilled",
            value: await worker(values[index]),
          };
        } catch (reason) {
          results[index] = { status: "rejected", reason };
        }
      }
    }),
  );
  return results;
}

function operationalPrompt(
  content: string,
  mission: NonNullable<CockpitState["missions"][number]>,
  depth: number,
): string {
  const nextAgentLimit =
    depth >= mission.limits.maxHandoffDepth
      ? 0
      : mission.limits.maxChildrenPerResponse;
  const remainingDispatches = Math.max(
    0,
    mission.limits.maxDispatches - mission.dispatchIds.length - 1,
  );
  const convention =
    `Loop Isa/Buzz: execute o trabalho da sua profissão e publique resultado, evidência ou bloqueio. ` +
    `Se houver contribuição profissional clara, proponha até ${nextAgentLimit} próximo(s) especialista(s), com menção exata e motivo; mencione a Isa no resultado final. ` +
    `Não gere ACK ou handoff sem contribuição. Limites após esta etapa: profundidade ${depth}/${mission.limits.maxHandoffDepth}; ${remainingDispatches} dispatches restantes.`;
  return content.trim() ? `${content.trim()}\n\n${convention}` : convention;
}

function mergePresence(
  agents: AgentSummary[],
  presenceAgents: AgentSummary[],
): AgentSummary[] {
  const presenceByPubkey = new Map(
    presenceAgents.map((agent) => [agent.pubkey, agent]),
  );
  return agents.map((agent) => {
    const observed = presenceByPubkey.get(agent.pubkey);
    if (!observed) return agent;
    return {
      ...agent,
      presence: observed.presence,
      activity:
        observed.activity === "unknown" ? agent.activity : observed.activity,
      lastActivityAt: observed.lastActivityAt ?? agent.lastActivityAt,
      lastResponseAt: observed.lastResponseAt ?? agent.lastResponseAt,
      statusUpdatedAt: observed.statusUpdatedAt ?? agent.statusUpdatedAt,
    };
  });
}

function mergeFeedActivity(
  agents: AgentSummary[],
  feedMessages: Message[],
): AgentSummary[] {
  const latestByPubkey = new Map<string, string>();
  for (const message of feedMessages) {
    const current = latestByPubkey.get(message.authorPubkey);
    if (!current || Date.parse(message.createdAt) > Date.parse(current)) {
      latestByPubkey.set(message.authorPubkey, message.createdAt);
    }
  }
  return agents.map((agent) => {
    const latest = latestByPubkey.get(agent.pubkey);
    return latest
      ? { ...agent, lastActivityAt: latest, lastResponseAt: latest }
      : agent;
  });
}

const PROJECT_HISTORY_PAGE_SIZE = 200;

function isActiveBuzzProjectChannel(
  channel: ReturnType<typeof normalizeChannelsResponse>[number],
): boolean {
  return (
    !channel.archived && (channel.type === "stream" || channel.type === "forum")
  );
}

async function enrichChannelMetadata(
  listedChannels: ReturnType<typeof normalizeChannelsResponse>,
): Promise<ReturnType<typeof normalizeChannelsResponse>> {
  const names = [
    ...new Set(
      listedChannels
        .filter((channel) => channel.name.trim().toLowerCase() !== "dm")
        .map((channel) => channel.name.trim())
        .filter(Boolean),
    ),
  ];
  const results = await mapSettledWithLimit(names, 4, (name) =>
    cockpitApi.searchChannels(name),
  );
  const metadata = results.flatMap((result) =>
    result.status === "fulfilled"
      ? normalizeChannelsResponse(result.value)
      : [],
  );
  const metadataById = new Map(
    metadata.map((channel) => [channel.id, channel]),
  );
  return listedChannels.map((channel) => ({
    ...channel,
    ...metadataById.get(channel.id),
  }));
}

function mergeMessages(...groups: Message[][]): Message[] {
  return [
    ...new Map(groups.flat().map((message) => [message.id, message])).values(),
  ].sort((left, right) => {
    const time = Date.parse(left.createdAt) - Date.parse(right.createdAt);
    return time === 0 ? left.id.localeCompare(right.id) : time;
  });
}

async function readProjectHistoryPages(
  channelId: string,
  authorNames: Record<string, string>,
  since?: number,
  onPage?: (messages: Message[]) => void,
): Promise<{ messages: Message[]; truncated: boolean }> {
  let before: number | undefined;
  let previousOldest: number | undefined;
  let messages: Message[] = [];

  for (;;) {
    const raw = await cockpitApi.messages(
      channelId,
      PROJECT_HISTORY_PAGE_SIZE,
      {
        before,
        since,
      },
    );
    const batch = normalizeMessagesResponse(raw, { channelId, authorNames });
    messages = mergeMessages(messages, batch);
    onPage?.(messages);
    if (batch.length < PROJECT_HISTORY_PAGE_SIZE) {
      return { messages, truncated: false };
    }

    const oldest = Math.min(
      ...batch.map((message) =>
        Math.floor(Date.parse(message.createdAt) / 1000),
      ),
    );
    if (!Number.isFinite(oldest) || oldest === previousOldest) {
      return { messages, truncated: true };
    }
    previousOldest = oldest;
    before = oldest - 1;
  }
}

function decorateAgentAssignments(
  agents: AgentSummary[],
  state: CockpitState,
): AgentSummary[] {
  const runningMissions = state.missions.filter(
    (mission) => mission.status === "running" && !mission.isSample,
  );
  return agents.map((agent) => {
    const missions = runningMissions.filter((mission) =>
      mission.agentIds.some(
        (agentId) => agentId === agent.id || agentId === agent.pubkey,
      ),
    );
    const mission = missions.sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    )[0];
    if (!mission) return agent;

    const dispatch = state.dispatches
      .filter(
        (candidate) =>
          candidate.missionId === mission.id &&
          (candidate.agentId === agent.id ||
            candidate.agentId === agent.pubkey),
      )
      .sort(
        (left, right) =>
          Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
      )[0];
    const responseAt = dispatch?.receipts
      .filter((receipt) => receipt.status === "response_received")
      .at(-1)?.at;
    const lastResponseAt =
      responseAt &&
      (!agent.lastResponseAt ||
        Date.parse(responseAt) > Date.parse(agent.lastResponseAt))
        ? responseAt
        : agent.lastResponseAt;

    return {
      ...agent,
      currentProjectId: mission.projectId,
      currentMissionId: mission.id,
      activity: dispatch?.status === "working" ? "working" : agent.activity,
      lastActivityAt: dispatch?.updatedAt ?? agent.lastActivityAt,
      lastResponseAt,
    };
  });
}

export default function App() {
  const location = useRouteLocation();
  const route = useMemo(
    () => routeFromPath(location.pathname),
    [location.pathname],
  );
  const mode: CockpitMode =
    location.search.get("mode") === "operator" ? "operator" : "reader";
  const missionView: MissionViewMode =
    location.search.get("view") === "chain" ? "chain" : "conversation";

  const [state, setState] = useState<CockpitState>();
  const [health, setHealth] = useState<HealthStatus>(OFFLINE_HEALTH);
  const [channels, setChannels] = useState<
    ReturnType<typeof normalizeChannelsResponse>
  >([]);
  const [liveAgents, setLiveAgents] = useState<AgentSummary[]>([]);
  const [liveMessages, setLiveMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [messageLoading, setMessageLoading] = useState(false);
  const [messageError, setMessageError] = useState<string>();
  const [projectMessages, setProjectMessages] = useState<Message[]>([]);
  const [projectMessageProjectId, setProjectMessageProjectId] =
    useState<string>();
  const [projectMessageLoading, setProjectMessageLoading] = useState(false);
  const [projectMessageError, setProjectMessageError] = useState<string>();
  const [fatalError, setFatalError] = useState<string>();
  const [saveError, setSaveError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const projectHistoryRequest = useRef(0);

  const effectiveAgents = useMemo(() => {
    if (!state) return liveAgents;
    return decorateAgentAssignments(
      liveAgents.length > 0 ? liveAgents : state.agents,
      state,
    );
  }, [liveAgents, state]);

  const currentProject = state?.projects.find(
    (project) => project.id === route.projectId,
  );
  const routeMission = state?.missions.find(
    (mission) => mission.id === route.missionId,
  );
  const currentMission =
    route.kind === "mission" &&
    currentProject &&
    routeMission?.projectId === currentProject.id
      ? routeMission
      : undefined;

  const loadCockpit = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setFatalError(undefined);

    try {
      const [healthValue, stateValue] = await Promise.all([
        cockpitApi.health(),
        cockpitApi.state(),
      ]);
      const [channelsResult, agentsResult, feedResult] =
        await Promise.allSettled([
          cockpitApi.channels(),
          cockpitApi.agents(),
          cockpitApi.feed(),
        ]);

      setHealth(healthValue);
      const baseState = createInitialState(normalizeCockpitState(stateValue));
      const listedChannels =
        channelsResult.status === "fulfilled"
          ? normalizeChannelsResponse(channelsResult.value).filter(
              (channel) => !channel.archived,
            )
          : [];
      const nextChannels = (await enrichChannelMetadata(listedChannels)).filter(
        (channel) => !channel.archived,
      );
      const imported = importBuzzChannelProjects(
        baseState,
        nextChannels.filter(isActiveBuzzProjectChannel),
      );
      setState(imported.state);
      setChannels(nextChannels);
      if (imported.state !== baseState) {
        const saved = normalizeCockpitState(
          await cockpitApi.saveState(imported.state),
        );
        setState(saved);
      }
      if (imported.conflicts.length > 0) {
        setSaveError(
          `${imported.conflicts.length} canal${imported.conflicts.length === 1 ? "" : "is"} do Buzz precisa${imported.conflicts.length === 1 ? "" : "m"} de vínculo manual com um projeto.`,
        );
      }

      if (agentsResult.status === "fulfilled") {
        const baseAgents = normalizeAgentsResponse(agentsResult.value);
        const authorNames = Object.fromEntries(
          baseAgents.map((agent) => [agent.pubkey, agent.name]),
        );
        const normalizedFeed = reconcileBuzzMessageEdits(
          feedResult.status === "fulfilled"
            ? normalizeMessagesResponse(feedResult.value, { authorNames })
            : [],
        );
        const normalizedAgents = mergeFeedActivity(baseAgents, normalizedFeed);
        const pubkeys = normalizedAgents
          .map((agent) => agent.pubkey)
          .filter(Boolean);
        if (pubkeys.length > 0) {
          const presenceValue = await cockpitApi
            .presence(pubkeys)
            .catch(() => undefined);
          const presenceAgents = presenceValue
            ? normalizeAgentsResponse(presenceValue)
            : [];
          setLiveAgents(mergePresence(normalizedAgents, presenceAgents));
        } else {
          setLiveAgents(normalizedAgents);
        }
      } else {
        setLiveAgents([]);
      }
    } catch (error) {
      setHealth(OFFLINE_HEALTH);
      setFatalError(errorMessage(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadCockpit(true);
  }, [loadCockpit]);

  useEffect(() => {
    if (location.pathname !== "/activity") return;
    navigate("/", { replace: true });
  }, [location.pathname]);

  useEffect(() => {
    const project = route.kind === "project" ? currentProject : undefined;
    const requestId = ++projectHistoryRequest.current;
    setProjectMessageProjectId(project?.id);
    setProjectMessages([]);
    setProjectMessageError(undefined);

    if (!project?.buzzChannelId) {
      setProjectMessageLoading(false);
      return;
    }

    const projectChannelId = project.buzzChannelId;
    let active = true;
    let initialLoaded = false;
    let initialLoading = false;
    let latestTimestamp = 0;
    const authorNames = Object.fromEntries(
      effectiveAgents.map((agent) => [agent.pubkey, agent.name]),
    );

    async function loadInitialHistory() {
      if (initialLoading) return;
      initialLoading = true;
      setProjectMessageLoading(true);
      try {
        const history = await readProjectHistoryPages(
          projectChannelId,
          authorNames,
          undefined,
          (partialHistory) => {
            if (
              active &&
              requestId === projectHistoryRequest.current &&
              route.kind === "project"
            ) {
              setProjectMessages(reconcileBuzzMessageEdits(partialHistory));
            }
          },
        );
        if (
          !active ||
          requestId !== projectHistoryRequest.current ||
          route.kind !== "project"
        ) {
          return;
        }
        latestTimestamp = history.messages.reduce(
          (latest, message) =>
            Math.max(latest, Math.floor(Date.parse(message.createdAt) / 1000)),
          0,
        );
        setProjectMessages(reconcileBuzzMessageEdits(history.messages));
        initialLoaded = true;
        if (history.truncated) {
          setProjectMessageError(
            "O cursor do Buzz não avançou em uma página do histórico; o restante visível continua isolado neste projeto.",
          );
        }
      } catch (error) {
        if (active && requestId === projectHistoryRequest.current) {
          setProjectMessageError(errorMessage(error));
        }
      } finally {
        initialLoading = false;
        if (active && requestId === projectHistoryRequest.current) {
          setProjectMessageLoading(false);
        }
      }
    }

    async function loadNewMessages() {
      if (!initialLoaded) {
        await loadInitialHistory();
        return;
      }
      try {
        const history = await readProjectHistoryPages(
          projectChannelId,
          authorNames,
          latestTimestamp,
        );
        const incoming = history.messages;
        if (!active || requestId !== projectHistoryRequest.current) return;
        if (incoming.length > 0) {
          latestTimestamp = incoming.reduce(
            (latest, message) =>
              Math.max(
                latest,
                Math.floor(Date.parse(message.createdAt) / 1000),
              ),
            latestTimestamp,
          );
          setProjectMessages((current) =>
            reconcileBuzzMessageEdits(mergeMessages(current, incoming)),
          );
        }
        if (history.truncated) {
          setProjectMessageError(
            "A atualização ao vivo encontrou um cursor sem avanço; atualize o projeto para reconciliar o histórico.",
          );
        }
      } catch (error) {
        if (active && requestId === projectHistoryRequest.current) {
          setProjectMessageError(errorMessage(error));
        }
      }
    }

    void loadInitialHistory();
    const interval = window.setInterval(() => void loadNewMessages(), 12_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [currentProject, effectiveAgents, route.kind]);

  useEffect(() => {
    if (
      state?.starter &&
      route.kind === "mission" &&
      currentMission?.isSample
    ) {
      navigate(`/${mode === "operator" ? "?mode=operator" : ""}`, {
        replace: true,
      });
    }
  }, [currentMission, mode, route.kind, state?.starter]);

  const persistState = useCallback(
    async (nextState: CockpitState, previousState?: CockpitState) => {
      const rollback = previousState ?? state;
      setSaving(true);
      setSaveError(undefined);
      setState(nextState);
      try {
        const saved = normalizeCockpitState(
          await cockpitApi.saveState(nextState),
        );
        setState(saved);
      } catch (error) {
        if (rollback) setState(rollback);
        setSaveError(errorMessage(error));
        throw error;
      } finally {
        setSaving(false);
      }
    },
    [state],
  );

  const reconcileResponses = useCallback(
    (missionId: string, messages: Message[]) => {
      if (!missionId || messages.length === 0) return;
      setState((current) => {
        if (!current) return current;
        const mission = current.missions.find(
          (candidate) => candidate.id === missionId,
        );
        if (!mission || mission.isSample) return current;

        let next = current;
        let changed = false;
        const missionDispatches = mission.dispatchIds
          .map((id) =>
            current.dispatches.find((dispatch) => dispatch.id === id),
          )
          .filter((dispatch) => Boolean(dispatch));

        for (const dispatch of missionDispatches) {
          if (!dispatch || dispatch.responseEventId) continue;
          const response = messages.find((message) => {
            if (
              message.authorPubkey !== dispatch.agentId ||
              message.id === dispatch.eventId
            ) {
              return false;
            }
            if (
              message.replyToId === dispatch.eventId ||
              message.rootId === dispatch.eventId
            ) {
              return true;
            }
            return Boolean(
              dispatch.threadId &&
                message.threadId === dispatch.threadId &&
                Date.parse(message.createdAt) >=
                  Date.parse(dispatch.createdAt) - 1_000,
            );
          });
          if (!response) continue;

          const receipts: DispatchReceipt[] = [
            ...dispatch.receipts,
            {
              status: "response_received",
              at: response.createdAt,
              eventId: response.id,
            },
          ];
          let status: "response_received" | "handoff_proposed" =
            "response_received";
          let proposedAgentIds = dispatch.proposedAgentIds;
          const handoff = detectExplicitHandoff(response);
          const knownTargets = handoff.targetPubkeys.filter((target) =>
            effectiveAgents.some(
              (agent) => agent.pubkey === target || agent.id === target,
            ),
          );
          if (handoff.isExplicit && knownTargets.length > 0) {
            proposedAgentIds = [
              ...new Set([...proposedAgentIds, ...knownTargets]),
            ];
            receipts.push({
              status: "handoff_proposed",
              at: response.createdAt,
              eventId: response.id,
              targetAgentIds: knownTargets,
            });
            status = "handoff_proposed";
          }

          next = upsertDispatch(next, {
            ...dispatch,
            status,
            receipts,
            proposedAgentIds,
            responseEventId: response.id,
          });

          if (
            knownTargets.length > 0 &&
            !next.attention.some(
              (item) =>
                item.dispatchId === dispatch.id && item.kind === "handoff",
            )
          ) {
            next = {
              ...next,
              attention: [
                ...next.attention,
                {
                  id: newLocalId("attention"),
                  kind: "handoff",
                  severity: "info",
                  title: `${dispatch.agentName} propôs o próximo especialista`,
                  detail:
                    "A resposta trouxe um marcador explícito e uma menção válida. A Isa pode revisar e encaminhar.",
                  projectId: mission.projectId,
                  missionId: mission.id,
                  dispatchId: dispatch.id,
                  createdAt: response.createdAt,
                },
              ],
            };
          }
          changed = true;
        }

        if (changed) {
          void cockpitApi
            .saveState(next)
            .catch((error: unknown) => setSaveError(errorMessage(error)));
          return next;
        }
        return current;
      });
    },
    [effectiveAgents],
  );

  useEffect(() => {
    if (
      route.kind !== "project" ||
      !currentProject?.buzzChannelId ||
      projectMessageProjectId !== currentProject.id
    ) {
      return;
    }
    reconcileResponses(
      `project-conversation:${currentProject.buzzChannelId.toLowerCase()}`,
      projectMessages,
    );
  }, [
    currentProject,
    projectMessageProjectId,
    projectMessages,
    reconcileResponses,
    route.kind,
  ]);

  const loadMissionMessages = useCallback(async () => {
    if (!currentMission || !state) {
      setLiveMessages([]);
      return;
    }
    if (currentMission.isSample) {
      setLiveMessages(
        state.messages.filter(
          (message) => message.channelId === currentMission.channelId,
        ),
      );
      setMessageError(undefined);
      return;
    }
    const conversationRefs =
      currentMission.conversationRefs &&
      currentMission.conversationRefs.length > 0
        ? currentMission.conversationRefs
        : currentMission.channelId
          ? currentMission.threadIds.length > 0
            ? currentMission.threadIds.map((threadId) => ({
                id: `${currentMission.channelId}:${threadId}`,
                channelId: currentMission.channelId ?? "",
                rootEventId: threadId,
                agentIds: [],
                linkedAt: currentMission.updatedAt,
              }))
            : [
                {
                  id: `${currentMission.channelId}:channel-root`,
                  channelId: currentMission.channelId,
                  agentIds: [],
                  linkedAt: currentMission.updatedAt,
                },
              ]
          : [];
    if (conversationRefs.length === 0) {
      setLiveMessages([]);
      setMessageError(undefined);
      return;
    }

    setMessageLoading(true);
    setMessageError(undefined);
    try {
      const authorNames = Object.fromEntries(
        effectiveAgents.map((agent) => [agent.pubkey, agent.name]),
      );
      const conversationResults = await Promise.allSettled(
        conversationRefs.map(async (conversation) => ({
          conversation,
          raw: conversation.rootEventId
            ? await cockpitApi.thread(
                conversation.channelId,
                conversation.rootEventId,
              )
            : await cockpitApi.messages(conversation.channelId, 200),
        })),
      );
      const failedConversations = conversationResults.filter(
        (result) => result.status === "rejected",
      ).length;
      let normalized = conversationResults.flatMap((result) =>
        result.status === "fulfilled"
          ? normalizeMessagesResponse(result.value.raw, {
              channelId: result.value.conversation.channelId,
              threadId: result.value.conversation.rootEventId,
              authorNames,
            })
          : [],
      );
      if (failedConversations > 0) {
        setMessageError(
          `${failedConversations} conversa${failedConversations === 1 ? "" : "s"} não pôde${
            failedConversations === 1 ? "" : "ram"
          } ser lida; as demais continuam visíveis.`,
        );
      }
      const ownEventIds = new Set(
        currentMission.dispatchIds.flatMap((dispatchId) => {
          const eventId = state.dispatches.find(
            (dispatch) => dispatch.id === dispatchId,
          )?.eventId;
          return eventId ? [eventId] : [];
        }),
      );
      normalized = normalized.map((message) =>
        ownEventIds.has(message.id)
          ? { ...message, isMine: true, authorName: "Isa" }
          : message,
      );
      const unique = reconcileBuzzMessageEdits(mergeMessages(normalized));
      setLiveMessages(unique);
      reconcileResponses(currentMission.id, unique);
    } catch (error) {
      setMessageError(errorMessage(error));
    } finally {
      setMessageLoading(false);
    }
  }, [currentMission, effectiveAgents, reconcileResponses, state]);

  useEffect(() => {
    if (route.kind !== "mission") {
      setLiveMessages([]);
      return;
    }
    void loadMissionMessages();
    const interval = window.setInterval(
      () => void loadMissionMessages(),
      12_000,
    );
    return () => window.clearInterval(interval);
  }, [loadMissionMessages, route.kind]);

  async function handleCreateProject(input: {
    name: string;
    description: string;
  }) {
    if (!state) return;
    const next = createProject(state, { ...input, color: "#6e5ae6" });
    const created = next.projects.at(-1);
    await persistState(next, state);
    if (created)
      navigate(`/projects/${encodeURIComponent(created.id)}?mode=operator`);
  }

  async function handleCreateMission(input: {
    title: string;
    objective: string;
    channelId?: string;
  }) {
    if (!state || !currentProject) return;
    const next = createMission(state, {
      ...input,
      projectId: currentProject.id,
    });
    const created = next.missions.at(-1);
    await persistState(next, state);
    if (created) {
      navigate(
        `/projects/${encodeURIComponent(currentProject.id)}/missions/${encodeURIComponent(created.id)}?mode=operator`,
      );
    }
  }

  async function handleMissionStatus(status: MissionStatus) {
    if (!state || !currentMission) return;
    const timestamp = new Date().toISOString();
    let next = updateMission(state, currentMission.id, { status }, timestamp);
    next = {
      ...next,
      attention: next.attention.map((item) =>
        item.missionId === currentMission.id &&
        item.kind === "decision" &&
        !item.resolvedAt &&
        status !== "awaiting_rj"
          ? { ...item, resolvedAt: timestamp }
          : item,
      ),
    };
    if (
      status === "awaiting_rj" &&
      !next.attention.some(
        (item) =>
          item.missionId === currentMission.id &&
          item.kind === "decision" &&
          !item.resolvedAt,
      )
    ) {
      next = {
        ...next,
        attention: [
          ...next.attention,
          {
            id: newLocalId("attention"),
            kind: "decision",
            severity: "warning",
            title: `${currentMission.title} precisa do RJ`,
            detail:
              "A Isa pausou o loop porque uma decisão humana é necessária.",
            projectId: currentMission.projectId,
            missionId: currentMission.id,
            createdAt: timestamp,
          },
        ],
      };
    }
    if (status === "completed") {
      next = {
        ...next,
        attention: next.attention.map((item) =>
          item.missionId === currentMission.id && !item.resolvedAt
            ? { ...item, resolvedAt: timestamp }
            : item,
        ),
      };
    }
    await persistState(next, state);
  }

  async function handleLinkConversation(input: {
    channelId: string;
    threadId: string;
    label?: string;
  }) {
    if (!state || !currentMission) return;
    const next = linkConversation(state, currentMission.id, {
      channelId: input.channelId,
      rootEventId: input.threadId,
      label: input.label,
      agentIds: [],
    });
    await persistState(next, state);
  }

  async function sendMissionSubmission(
    baseState: CockpitState,
    mission: Mission,
    submission: ComposerSubmission,
    refreshMissionMessages: boolean,
  ) {
    const persistedMission = baseState.missions.find(
      (candidate) => candidate.id === mission.id,
    );
    if (
      !persistedMission ||
      persistedMission.projectId !== mission.projectId ||
      persistedMission.channelId !== mission.channelId
    ) {
      throw new Error("A missão não pertence ao workspace atual.");
    }
    const startsNewThread =
      Boolean(mission.channelId) &&
      submission.destinationId === `${mission.channelId}:new-thread` &&
      submission.channelId === mission.channelId &&
      !submission.replyTo;
    const destination = startsNewThread
      ? {
          id: submission.destinationId,
          channelId: submission.channelId,
          rootEventId: undefined,
        }
      : mission.conversationRefs?.find(
          (conversation) => conversation.id === submission.destinationId,
        );
    if (
      !destination ||
      destination.channelId !== submission.channelId ||
      (destination.rootEventId ?? undefined) !== submission.replyTo
    ) {
      throw new Error("A conversa escolhida não pertence a esta missão.");
    }
    const destinationChannelId = destination.channelId;
    const agent = effectiveAgents.find(
      (candidate) =>
        candidate.pubkey === submission.agentPubkey ||
        candidate.id === submission.agentPubkey,
    );
    if (!agent)
      throw new Error("O agente escolhido não está disponível neste relay.");

    const guard = guardMissionDispatch(mission, baseState.dispatches, {
      agentId: agent.pubkey || agent.id,
      depth: submission.depth ?? 0,
      parentDispatchId: submission.parentDispatchId,
    });
    if (!guard.allowed) throw new Error(guard.message);

    const timestamp = new Date().toISOString();
    const dispatchId = newLocalId("dispatch");
    const depth = submission.depth ?? 0;
    const sendContent = operationalPrompt(submission.content, mission, depth);
    let next = upsertDispatch(baseState, {
      id: dispatchId,
      missionId: mission.id,
      agentId: agent.pubkey || agent.id,
      agentName: agent.name,
      prompt: submission.content,
      status: "planned",
      receipts: [{ status: "planned", at: timestamp }],
      depth,
      criticCycle: 0,
      retryCount: 0,
      proposedAgentIds: [],
      parentDispatchId: submission.parentDispatchId,
      channelId: destinationChannelId,
    });
    next = updateMission(next, mission.id, {
      status: "running",
      agentIds: [...new Set([...mission.agentIds, agent.pubkey || agent.id])],
    });

    setSending(true);
    await persistState(next, state);
    let trackedState = next;
    try {
      const attachments = await Promise.all(
        submission.files.map(fileToAttachment),
      );
      const rawReceipt = await cockpitApi.sendMessage({
        channelId: destinationChannelId,
        content: sendContent,
        mentions: [agent.pubkey || agent.id],
        replyTo: submission.replyTo,
        attachments,
      });
      const receipt = normalizeWriteReceipt(rawReceipt);
      let delivered = appendDispatchReceipt(next, dispatchId, {
        status: "sent",
        at: new Date().toISOString(),
        eventId: receipt.eventId,
        note: receipt.message || undefined,
      });
      trackedState = delivered;

      if (receipt.accepted && receipt.eventId) {
        delivered = appendDispatchReceipt(delivered, dispatchId, {
          status: "relay_accepted",
          at: new Date().toISOString(),
          eventId: receipt.eventId,
        });
        const conversationRoot = submission.replyTo ?? receipt.eventId;
        delivered = linkConversation(delivered, mission.id, {
          channelId: destinationChannelId,
          rootEventId: conversationRoot,
          label:
            mission.conversationRefs?.find(
              (conversation) => conversation.id === submission.destinationId,
            )?.label ?? agent.name,
          agentIds: [agent.pubkey || agent.id],
          dispatchId,
        });
        const acceptedDispatch = delivered.dispatches.find(
          (dispatch) => dispatch.id === dispatchId,
        );
        if (!acceptedDispatch) {
          throw new Error(
            "O dispatch aceito não foi encontrado no estado local.",
          );
        }
        delivered = upsertDispatch(delivered, {
          ...acceptedDispatch,
          status: "relay_accepted",
          eventId: receipt.eventId,
          channelId: destinationChannelId,
          threadId: conversationRoot,
        });
        if (submission.parentDispatchId) {
          const handoffTime = new Date().toISOString();
          delivered = appendDispatchReceipt(
            delivered,
            submission.parentDispatchId,
            {
              status: "handed_off",
              at: handoffTime,
              eventId: receipt.eventId,
              targetAgentIds: [agent.pubkey || agent.id],
            },
          );
          delivered = {
            ...delivered,
            attention: delivered.attention.map((item) =>
              item.kind === "handoff" &&
              item.dispatchId === submission.parentDispatchId &&
              !item.resolvedAt
                ? { ...item, resolvedAt: handoffTime }
                : item,
            ),
          };
        }
        trackedState = delivered;
        await persistState(delivered, next);
        if (refreshMissionMessages) await loadMissionMessages();
        return;
      }

      delivered = appendDispatchReceipt(delivered, dispatchId, {
        status: "blocked",
        at: new Date().toISOString(),
        note: receipt.message || "O relay não aceitou a mensagem.",
      });
      trackedState = delivered;
      await persistState(delivered, next);
      throw new Error(receipt.message || "O relay não aceitou a mensagem.");
    } catch (error) {
      const dispatch = trackedState.dispatches.find(
        (candidate) => candidate.id === dispatchId,
      );
      if (dispatch) {
        const blockedAt = new Date().toISOString();
        let blocked =
          dispatch.status === "blocked"
            ? trackedState
            : appendDispatchReceipt(trackedState, dispatchId, {
                status: "blocked",
                at: blockedAt,
                note: errorMessage(error),
              });
        if (
          !blocked.attention.some(
            (item) =>
              item.dispatchId === dispatchId &&
              item.kind === "blocked" &&
              !item.resolvedAt,
          )
        ) {
          blocked = {
            ...blocked,
            attention: [
              ...blocked.attention,
              {
                id: newLocalId("attention"),
                kind: "blocked",
                severity: "warning",
                title: `${agent.name}: dispatch bloqueado`,
                detail: errorMessage(error),
                projectId: mission.projectId,
                missionId: mission.id,
                dispatchId,
                createdAt: blockedAt,
              },
            ],
          };
        }
        await persistState(blocked, trackedState).catch(() => undefined);
      }
      throw error;
    } finally {
      setSending(false);
    }
  }

  async function handleSend(submission: ComposerSubmission) {
    if (!state || !currentMission) {
      throw new Error(
        "A missão precisa de uma conversa do Buzz antes do envio.",
      );
    }
    await sendMissionSubmission(state, currentMission, submission, true);
  }

  async function handleProjectSend(submission: ComposerSubmission) {
    if (!state || !currentProject?.buzzChannelId) {
      throw new Error("Este projeto ainda não está vinculado a um canal Buzz.");
    }
    if (
      projectMessageProjectId !== currentProject.id ||
      submission.channelId !== currentProject.buzzChannelId
    ) {
      throw new Error("A conversa escolhida não pertence a este projeto.");
    }

    const startsNewThread =
      submission.destinationId ===
        `${currentProject.buzzChannelId}:new-thread` && !submission.replyTo;
    if (
      !startsNewThread &&
      (!submission.replyTo ||
        !projectMessages.some(
          (message) =>
            message.channelId === currentProject.buzzChannelId &&
            message.threadId === submission.replyTo,
        ))
    ) {
      throw new Error("Esta thread não faz parte do histórico deste projeto.");
    }

    let ensured = ensureProjectConversationMission(state, currentProject.id);
    if (!startsNewThread && submission.replyTo) {
      const linkedState = linkConversation(ensured.state, ensured.mission.id, {
        id: submission.destinationId,
        channelId: currentProject.buzzChannelId,
        rootEventId: submission.replyTo,
        label: `Thread #${submission.replyTo.slice(0, 8)}`,
        agentIds: [],
      });
      const linkedMission = linkedState.missions.find(
        (mission) => mission.id === ensured.mission.id,
      );
      if (!linkedMission) {
        throw new Error("A conversa contínua do projeto não foi vinculada.");
      }
      ensured = { state: linkedState, mission: linkedMission };
    }

    await sendMissionSubmission(
      ensured.state,
      ensured.mission,
      submission,
      false,
    );
  }

  async function handleDraftAgentModel(input: {
    agent: AgentSummary;
    channelId: string;
    model: string;
  }) {
    const receipt = normalizeWriteReceipt(
      await cockpitApi.draftAgentUpdate({
        channelId: input.channelId,
        agentName: input.agent.name,
        displayName: input.agent.name,
        model: input.model,
      }),
    );
    if (!receipt.accepted)
      throw new Error(receipt.message || "O Buzz não aceitou o draft.");
  }

  if (loading) return <LoadingScreen />;
  if (fatalError || !state) {
    return (
      <ErrorScreen
        message={fatalError ?? "O estado local não foi carregado."}
        onRetry={() => void loadCockpit(true)}
      />
    );
  }

  let content: ReactNode;
  if (route.kind === "home") {
    content = (
      <HomeView
        state={state}
        mode={mode}
        saving={saving}
        onCreateProject={handleCreateProject}
      />
    );
  } else if (route.kind === "project" && currentProject) {
    const isCurrentProjectHistory =
      projectMessageProjectId === currentProject.id;
    const projectMissionIds = new Set(
      state.missions
        .filter((mission) => mission.projectId === currentProject.id)
        .map((mission) => mission.id),
    );
    const ownEventIds = new Set(
      state.dispatches.flatMap((dispatch) =>
        projectMissionIds.has(dispatch.missionId) && dispatch.eventId
          ? [dispatch.eventId]
          : [],
      ),
    );
    const scopedMessages = isCurrentProjectHistory
      ? projectMessages.map((message) =>
          ownEventIds.has(message.id)
            ? { ...message, isMine: true, authorName: "Isa" }
            : message,
        )
      : [];
    content = (
      <ProjectView
        key={currentProject.id}
        project={currentProject}
        state={state}
        agents={effectiveAgents}
        channels={channels}
        messages={scopedMessages}
        messageLoading={!isCurrentProjectHistory || projectMessageLoading}
        messageError={isCurrentProjectHistory ? projectMessageError : undefined}
        mode={mode}
        saving={saving}
        sending={sending}
        onCreateMission={handleCreateMission}
        onSend={handleProjectSend}
      />
    );
  } else if (route.kind === "mission" && currentProject && currentMission) {
    const missionAgents = currentMission.isSample
      ? state.agents
      : effectiveAgents;
    content = (
      <MissionWorkspace
        key={currentMission.id}
        state={state}
        mission={currentMission}
        project={currentProject}
        agents={missionAgents}
        channels={channels}
        messages={liveMessages}
        messageLoading={messageLoading}
        messageError={messageError}
        mode={mode}
        view={missionView}
        saving={saving}
        sending={sending}
        onSend={handleSend}
        onStatusChange={handleMissionStatus}
        onLinkConversation={handleLinkConversation}
      />
    );
  } else if (route.kind === "agents") {
    content = (
      <AgentsView
        agents={effectiveAgents}
        channels={channels}
        state={state}
        mode={mode}
        onDraftAgentModel={handleDraftAgentModel}
      />
    );
  } else if (route.kind === "attention") {
    content = <AttentionView state={state} />;
  } else {
    content = <NotFoundView />;
  }

  return (
    <>
      <AppShell
        state={state}
        route={route}
        health={health}
        mode={mode}
        missionView={missionView}
        refreshing={refreshing}
        onRefresh={() => void loadCockpit(false)}
      >
        {content}
      </AppShell>
      {saveError ? (
        <div className="global-toast" role="alert">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>{saveError}</span>
          <button
            type="button"
            aria-label="Fechar aviso"
            onClick={() => setSaveError(undefined)}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </>
  );
}
