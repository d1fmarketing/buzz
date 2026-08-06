import {
  useCallback,
  useEffect,
  useMemo,
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
  guardMissionDispatch,
  linkConversation,
  updateMission,
  upsertDispatch,
  type AgentSummary,
  type CockpitState,
  type DispatchReceipt,
  type Message,
  type MissionStatus,
} from "./domain";
import {
  normalizeAgentsResponse,
  normalizeChannelsResponse,
  normalizeCockpitState,
  normalizeMessagesResponse,
  normalizeWriteReceipt,
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
  ActivityView,
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
  if (pathname === "/activity") return { kind: "activity" };
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
  const [activityMessages, setActivityMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [messageLoading, setMessageLoading] = useState(false);
  const [messageError, setMessageError] = useState<string>();
  const [activityError, setActivityError] = useState<string>();
  const [activityLoading, setActivityLoading] = useState(false);
  const [fatalError, setFatalError] = useState<string>();
  const [saveError, setSaveError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  const effectiveAgents = useMemo(() => {
    if (!state) return liveAgents;
    return decorateAgentAssignments(
      liveAgents.length > 0 ? liveAgents : state.agents,
      state,
    );
  }, [liveAgents, state]);

  const currentMission = state?.missions.find(
    (mission) => mission.id === route.missionId,
  );
  const currentProject = state?.projects.find(
    (project) => project.id === route.projectId,
  );

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
      const nextState = createInitialState(normalizeCockpitState(stateValue));
      setState(nextState);
      setChannels(
        channelsResult.status === "fulfilled"
          ? normalizeChannelsResponse(channelsResult.value).filter(
              (channel) => !channel.archived,
            )
          : [],
      );

      if (agentsResult.status === "fulfilled") {
        const baseAgents = normalizeAgentsResponse(agentsResult.value);
        const authorNames = Object.fromEntries(
          baseAgents.map((agent) => [agent.pubkey, agent.name]),
        );
        const normalizedFeed =
          feedResult.status === "fulfilled"
            ? normalizeMessagesResponse(feedResult.value, { authorNames })
            : [];
        setActivityMessages(normalizedFeed);
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
        setActivityMessages(
          feedResult.status === "fulfilled"
            ? normalizeMessagesResponse(feedResult.value)
            : [],
        );
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

  const loadActivityFeed = useCallback(
    async (includeHistory = false) => {
      setActivityLoading(true);
      setActivityError(undefined);
      try {
        const authorNames = Object.fromEntries(
          effectiveAgents.map((agent) => [agent.pubkey, agent.name]),
        );
        const feedResult = await cockpitApi
          .feed(50)
          .then((value) => ({ status: "fulfilled" as const, value }))
          .catch((reason) => ({ status: "rejected" as const, reason }));
        const historyResults = includeHistory
          ? await mapSettledWithLimit(channels, 5, async (channel) => ({
              channel,
              value: await cockpitApi.messages(channel.id, 25),
            }))
          : [];
        const historyMessages = historyResults.flatMap((result) =>
          result.status === "fulfilled"
            ? normalizeMessagesResponse(result.value.value, {
                channelId: result.value.channel.id,
                authorNames,
              })
            : [],
        );
        const feedMessages =
          feedResult.status === "fulfilled"
            ? normalizeMessagesResponse(feedResult.value, { authorNames })
            : [];
        if (feedResult.status === "rejected" && historyMessages.length === 0) {
          throw feedResult.reason;
        }
        setActivityMessages((current) => {
          const combined = includeHistory
            ? [...historyMessages, ...feedMessages]
            : [...current, ...feedMessages];
          return [
            ...new Map(
              combined.map((message) => [message.id, message]),
            ).values(),
          ]
            .sort((left, right) => {
              const time =
                Date.parse(left.createdAt) - Date.parse(right.createdAt);
              return time === 0 ? left.id.localeCompare(right.id) : time;
            })
            .slice(-300);
        });
        const failedChannels = historyResults.filter(
          (result) => result.status === "rejected",
        ).length;
        if (failedChannels > 0 || feedResult.status === "rejected") {
          const details = [];
          if (failedChannels > 0) {
            details.push(
              `${failedChannels} de ${channels.length} conversas não responderam`,
            );
          }
          if (feedResult.status === "rejected") {
            details.push("o feed de menções não respondeu");
          }
          setActivityError(
            `${details.join("; ")}. O restante continua visível.`,
          );
        }
      } catch (error) {
        setActivityError(errorMessage(error));
      } finally {
        setActivityLoading(false);
      }
    },
    [channels, effectiveAgents],
  );

  useEffect(() => {
    if (route.kind !== "activity" || loading) return;
    void loadActivityFeed(true);
    const feedInterval = window.setInterval(
      () => void loadActivityFeed(false),
      15_000,
    );
    const historyInterval = window.setInterval(
      () => void loadActivityFeed(true),
      60_000,
    );
    return () => {
      window.clearInterval(feedInterval);
      window.clearInterval(historyInterval);
    };
  }, [loadActivityFeed, loading, route.kind]);

  useEffect(() => {
    if (
      state?.starter &&
      route.kind === "mission" &&
      currentMission?.isSample
    ) {
      navigate(`/activity${mode === "operator" ? "?mode=operator" : ""}`, {
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
    (messages: Message[]) => {
      if (!currentMission || currentMission.isSample || messages.length === 0)
        return;
      setState((current) => {
        if (!current) return current;
        const mission = current.missions.find(
          (candidate) => candidate.id === currentMission.id,
        );
        if (!mission) return current;

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
    [currentMission, effectiveAgents],
  );

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
      const unique = [
        ...new Map(normalized.map((message) => [message.id, message])).values(),
      ].sort((left, right) => {
        const time = Date.parse(left.createdAt) - Date.parse(right.createdAt);
        return time === 0 ? left.id.localeCompare(right.id) : time;
      });
      setLiveMessages(unique);
      reconcileResponses(unique);
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

  async function handleSend(submission: ComposerSubmission) {
    if (!state || !currentMission) {
      throw new Error(
        "A missão precisa de uma conversa do Buzz antes do envio.",
      );
    }
    const startsNewThread =
      Boolean(currentMission.channelId) &&
      submission.destinationId === `${currentMission.channelId}:new-thread` &&
      submission.channelId === currentMission.channelId &&
      !submission.replyTo;
    const destination = startsNewThread
      ? {
          id: submission.destinationId,
          channelId: submission.channelId,
          rootEventId: undefined,
        }
      : currentMission.conversationRefs?.find(
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

    const guard = guardMissionDispatch(currentMission, state.dispatches, {
      agentId: agent.pubkey || agent.id,
      depth: submission.depth ?? 0,
      parentDispatchId: submission.parentDispatchId,
    });
    if (!guard.allowed) throw new Error(guard.message);

    const timestamp = new Date().toISOString();
    const dispatchId = newLocalId("dispatch");
    const depth = submission.depth ?? 0;
    const sendContent = operationalPrompt(
      submission.content,
      currentMission,
      depth,
    );
    let next = upsertDispatch(state, {
      id: dispatchId,
      missionId: currentMission.id,
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
    next = updateMission(next, currentMission.id, {
      status: "running",
      agentIds: [
        ...new Set([...currentMission.agentIds, agent.pubkey || agent.id]),
      ],
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
        delivered = linkConversation(delivered, currentMission.id, {
          channelId: destinationChannelId,
          rootEventId: conversationRoot,
          label:
            currentMission.conversationRefs?.find(
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
        await loadMissionMessages();
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
                projectId: currentMission.projectId,
                missionId: currentMission.id,
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
        agents={effectiveAgents}
        mode={mode}
        saving={saving}
        onCreateProject={handleCreateProject}
      />
    );
  } else if (route.kind === "activity") {
    content = (
      <ActivityView
        messages={activityMessages}
        agents={effectiveAgents}
        channels={channels}
        state={state}
        loading={activityLoading}
        error={activityError}
        selectedAgentPubkey={location.search.get("agent") ?? undefined}
      />
    );
  } else if (route.kind === "project" && currentProject) {
    content = (
      <ProjectView
        project={currentProject}
        state={state}
        agents={effectiveAgents}
        channels={channels}
        mode={mode}
        saving={saving}
        onCreateMission={handleCreateMission}
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
