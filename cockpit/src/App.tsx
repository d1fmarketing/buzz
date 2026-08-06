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
  linkThread,
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [messageLoading, setMessageLoading] = useState(false);
  const [messageError, setMessageError] = useState<string>();
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
        const normalizedAgents = mergeFeedActivity(
          normalizeAgentsResponse(agentsResult.value),
          feedResult.status === "fulfilled"
            ? normalizeMessagesResponse(feedResult.value)
            : [],
        );
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
          const response = messages.find(
            (message) =>
              message.authorPubkey === dispatch.agentId &&
              message.id !== dispatch.eventId &&
              (message.replyToId === dispatch.eventId ||
                message.rootId === dispatch.eventId ||
                (Boolean(dispatch.threadId) &&
                  message.threadId === dispatch.threadId)),
          );
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
    if (!currentMission.channelId) {
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
      let normalized: Message[];
      if (currentMission.threadIds.length > 0) {
        const threadResults = await Promise.allSettled(
          currentMission.threadIds.map((threadId) =>
            cockpitApi.thread(currentMission.channelId ?? "", threadId),
          ),
        );
        normalized = threadResults.flatMap((result) =>
          result.status === "fulfilled"
            ? normalizeMessagesResponse(result.value, {
                channelId: currentMission.channelId,
                authorNames,
              })
            : [],
        );
      } else {
        normalized = normalizeMessagesResponse(
          await cockpitApi.messages(currentMission.channelId),
          {
            channelId: currentMission.channelId,
            authorNames,
          },
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
      ];
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

  async function handleLinkThread(threadId: string) {
    if (!state || !currentMission) return;
    const next = linkThread(state, currentMission.id, threadId);
    await persistState(next, state);
  }

  async function handleSend(submission: ComposerSubmission) {
    if (!state || !currentMission?.channelId) {
      throw new Error("A missão precisa de um canal do Buzz antes do envio.");
    }
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
        channelId: currentMission.channelId,
        content: sendContent,
        mentions: [agent.pubkey || agent.id],
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
        delivered = linkThread(delivered, currentMission.id, receipt.eventId);
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
          threadId: receipt.eventId,
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
        messages={liveMessages}
        messageLoading={messageLoading}
        messageError={messageError}
        mode={mode}
        view={missionView}
        saving={saving}
        sending={sending}
        onSend={handleSend}
        onStatusChange={handleMissionStatus}
        onLinkThread={handleLinkThread}
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
