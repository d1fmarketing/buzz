import { useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CirclePause,
  CirclePlay,
  Clock3,
  FileText,
  Flag,
  GitBranch,
  Link2,
  Radio,
  Users,
  X,
} from "lucide-react";
import type {
  AgentSummary,
  CockpitState,
  Dispatch,
  DispatchReceiptStatus,
  Message,
  Mission,
  MissionStatus,
  Project,
} from "../domain";
import { Composer, type ComposerSubmission } from "./Composer";
import {
  DispatchSpine,
  type DispatchSpineItem,
  type DispatchStage,
} from "./DispatchSpine";
import { compactId } from "./format";
import { EmptyState, StateBadge } from "./primitives";
import { updateSearchParam } from "./router";
import type { CockpitMode, MissionViewMode } from "./Shell";
import { missionStatusLabel, missionStatusTone } from "./status";
import { ConversationHeading, Timeline, type TimelineEntry } from "./Timeline";
import { SampleBanner } from "./Views";

const receiptStage: Record<DispatchReceiptStatus, DispatchStage> = {
  planned: "planned",
  sent: "sent",
  relay_accepted: "accepted",
  working: "working",
  response_received: "responded",
  handoff_proposed: "proposed",
  handed_off: "handed_off",
  incorporated: "incorporated",
  completed: "completed",
  blocked: "blocked",
  timed_out: "blocked",
};

function messageEntries(
  messages: Message[],
  agents: AgentSummary[],
): TimelineEntry[] {
  return [...messages]
    .sort(
      (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
    )
    .map((message) => {
      const agent = agents.find(
        (candidate) =>
          candidate.pubkey === message.authorPubkey ||
          candidate.id === message.authorPubkey,
      );
      return {
        id: message.id,
        authorName: message.isMine ? "Isa" : message.authorName,
        authorLabel: message.isMine ? "Orquestradora" : agent?.role,
        avatarUrl: agent?.avatarUrl,
        content: message.content,
        createdAt: message.createdAt,
        eventId: message.id,
        role: message.isMine ? "isa" : "agent",
        status: message.isMine ? "accepted" : "responded",
        attachments: message.attachments.map((attachment) => ({
          name: attachment.name,
          url: attachment.url,
        })),
      } satisfies TimelineEntry;
    });
}

function receiptActors(
  dispatch: Dispatch,
  status: DispatchReceiptStatus,
  targets: string[],
): { actor: string; target?: string } {
  if (
    status === "working" ||
    status === "response_received" ||
    status === "handoff_proposed"
  ) {
    return {
      actor: dispatch.agentName,
      target: targets.length > 0 ? targets.join(", ") : undefined,
    };
  }
  if (status === "incorporated" || status === "completed") {
    return { actor: "Isa", target: "Síntese" };
  }
  return {
    actor: "Isa",
    target: targets.length > 0 ? targets.join(", ") : dispatch.agentName,
  };
}

function spineItems(
  dispatches: Dispatch[],
  agents: AgentSummary[],
): DispatchSpineItem[] {
  return [...dispatches]
    .sort(
      (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
    )
    .flatMap((dispatch) => {
      const receipts =
        dispatch.receipts.length > 0
          ? dispatch.receipts
          : [{ status: dispatch.status, at: dispatch.updatedAt }];

      return receipts.map((receipt, index) => {
        const targetNames = (receipt.targetAgentIds ?? [])
          .map(
            (target) =>
              agents.find(
                (agent) => agent.id === target || agent.pubkey === target,
              )?.name,
          )
          .filter((name): name is string => Boolean(name));
        const route = receiptActors(dispatch, receipt.status, targetNames);
        const summary =
          receipt.note ||
          (receipt.status === "planned" || receipt.status === "sent"
            ? dispatch.prompt
            : undefined);
        return {
          id: `${dispatch.id}-${receipt.status}-${index}`,
          actor: route.actor,
          target: route.target,
          summary,
          stage: receiptStage[receipt.status],
          timestamp: receipt.at,
          branchLabel:
            dispatch.depth > 0 ? `Branch ${dispatch.depth}` : "Branch raiz",
        } satisfies DispatchSpineItem;
      });
    });
}

function MissionDetails({
  mission,
  agents,
  mode,
  onLinkThread,
}: {
  mission: Mission;
  agents: AgentSummary[];
  mode: CockpitMode;
  onLinkThread: (threadId: string) => Promise<void>;
}) {
  const missionAgents = mission.agentIds
    .map((id) => agents.find((agent) => agent.id === id || agent.pubkey === id))
    .filter((agent): agent is AgentSummary => Boolean(agent));

  return (
    <div className="mission-details">
      <section>
        <h3>
          <Users size={14} aria-hidden="true" /> Especialistas
        </h3>
        {missionAgents.length > 0 ? (
          <ul>
            {missionAgents.map((agent) => (
              <li key={agent.id}>
                <strong>{agent.name}</strong>
                <span>{agent.role}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>Nenhum especialista fixado. A Isa escolhe no primeiro dispatch.</p>
        )}
      </section>
      <section>
        <h3>
          <GitBranch size={14} aria-hidden="true" /> Limites do loop
        </h3>
        <dl>
          <div>
            <dt>Especialistas</dt>
            <dd>
              {mission.limits.initialSpecialists}–
              {mission.limits.maxSpecialists}
            </dd>
          </div>
          <div>
            <dt>Dispatches</dt>
            <dd>{mission.limits.maxDispatches}</dd>
          </div>
          <div>
            <dt>Profundidade</dt>
            <dd>{mission.limits.maxHandoffDepth}</dd>
          </div>
          <div>
            <dt>Builder ↔ critic</dt>
            <dd>{mission.limits.maxCriticCycles}</dd>
          </div>
        </dl>
      </section>
      <section>
        <h3>
          <Link2 size={14} aria-hidden="true" /> Threads
        </h3>
        {mission.threadIds.length > 0 ? (
          <ul className="thread-list">
            {mission.threadIds.map((threadId) => (
              <li title={threadId} key={threadId}>
                #{compactId(threadId)}
              </li>
            ))}
          </ul>
        ) : (
          <p>A primeira mensagem cria e vincula a raiz.</p>
        )}
        {mode === "operator" && !mission.isSample ? (
          <ThreadLinkForm onLinkThread={onLinkThread} />
        ) : null}
      </section>
    </div>
  );
}

function ThreadLinkForm({
  onLinkThread,
}: {
  onLinkThread: (threadId: string) => Promise<void>;
}) {
  const [threadId, setThreadId] = useState("");
  const [status, setStatus] = useState<string>();
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = threadId.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(value)) {
      setStatus("Use o event ID completo de 64 caracteres.");
      return;
    }
    setSaving(true);
    setStatus(undefined);
    try {
      await onLinkThread(value);
      setThreadId("");
      setStatus("Thread vinculada.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "A thread não foi vinculada.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="thread-link-form" onSubmit={(event) => void submit(event)}>
      <label>
        <span>Vincular thread existente</span>
        <input
          value={threadId}
          onChange={(event) => setThreadId(event.target.value)}
          placeholder="Event ID da raiz"
          spellCheck={false}
        />
      </label>
      <button
        className="button button--ghost"
        type="submit"
        disabled={saving || !threadId.trim()}
      >
        <Link2 size={13} aria-hidden="true" />
        {saving ? "Vinculando" : "Vincular"}
      </button>
      {status ? <p role="status">{status}</p> : null}
    </form>
  );
}

function MissionActions({
  mission,
  disabled,
  onStatusChange,
}: {
  mission: Mission;
  disabled: boolean;
  onStatusChange: (status: MissionStatus) => Promise<void>;
}) {
  if (mission.status === "completed") return null;
  const primaryStatus = mission.status === "running" ? "paused" : "running";
  return (
    <div className="mission-header__controls">
      <button
        className="button button--ghost"
        type="button"
        disabled={disabled}
        onClick={() => void onStatusChange(primaryStatus)}
      >
        {mission.status === "running" ? (
          <CirclePause size={14} aria-hidden="true" />
        ) : (
          <CirclePlay size={14} aria-hidden="true" />
        )}
        {mission.status === "running" ? "Pausar" : "Iniciar"}
      </button>
      <button
        className="button button--ghost"
        type="button"
        disabled={disabled}
        onClick={() => void onStatusChange("awaiting_rj")}
      >
        <Flag size={14} aria-hidden="true" /> Decisão do RJ
      </button>
      <button
        className="button button--ink"
        type="button"
        disabled={disabled}
        onClick={() => void onStatusChange("completed")}
      >
        Concluir
      </button>
    </div>
  );
}

interface PendingHandoff {
  dispatch: Dispatch;
  agent: AgentSummary;
}

function findPendingHandoffs(
  dispatches: Dispatch[],
  agents: AgentSummary[],
): PendingHandoff[] {
  return dispatches.flatMap((dispatch) =>
    dispatch.proposedAgentIds.flatMap((agentId) => {
      const agent = agents.find(
        (candidate) => candidate.id === agentId || candidate.pubkey === agentId,
      );
      const alreadyForwarded =
        dispatches.some(
          (candidate) =>
            candidate.parentDispatchId === dispatch.id &&
            candidate.agentId === agentId,
        ) ||
        dispatch.receipts.some(
          (receipt) =>
            receipt.status === "handed_off" &&
            receipt.targetAgentIds?.includes(agentId),
        );
      return agent && !alreadyForwarded ? [{ dispatch, agent }] : [];
    }),
  );
}

function HandoffQueue({
  items,
  mode,
  onPrepare,
}: {
  items: PendingHandoff[];
  mode: CockpitMode;
  onPrepare: (item: PendingHandoff) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="handoff-queue" aria-label="Handoffs propostos">
      <header>
        <strong>Próximos agentes propostos</strong>
        <span>{items.length}</span>
      </header>
      <ul>
        {items.map((item) => (
          <li key={`${item.dispatch.id}-${item.agent.id}`}>
            <div>
              <span>{item.dispatch.agentName}</span>
              <ArrowRight size={12} aria-hidden="true" />
              <strong>{item.agent.name}</strong>
            </div>
            {mode === "operator" ? (
              <button
                type="button"
                className="button button--ghost"
                onClick={() => onPrepare(item)}
              >
                Preparar handoff
              </button>
            ) : (
              <span className="handoff-queue__reader">Revisão da Isa</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function MissionWorkspace({
  state,
  mission,
  project,
  agents,
  messages,
  messageLoading,
  messageError,
  mode,
  view,
  sending,
  saving,
  onSend,
  onStatusChange,
  onLinkThread,
}: {
  state: CockpitState;
  mission: Mission;
  project: Project;
  agents: AgentSummary[];
  messages: Message[];
  messageLoading: boolean;
  messageError?: string;
  mode: CockpitMode;
  view: MissionViewMode;
  sending: boolean;
  saving: boolean;
  onSend: (submission: ComposerSubmission) => Promise<void>;
  onStatusChange: (status: MissionStatus) => Promise<void>;
  onLinkThread: (threadId: string) => Promise<void>;
}) {
  const [handoffDraft, setHandoffDraft] = useState<PendingHandoff>();

  const dispatches = mission.dispatchIds
    .map((id) => state.dispatches.find((dispatch) => dispatch.id === id))
    .filter((dispatch): dispatch is Dispatch => Boolean(dispatch));
  const chain = spineItems(dispatches, agents);
  const pendingHandoffs = findPendingHandoffs(dispatches, agents);
  const entries = messageEntries(messages, agents);
  const missionAgents =
    mission.agentIds.length > 0
      ? agents.filter(
          (agent) =>
            mission.agentIds.includes(agent.id) ||
            mission.agentIds.includes(agent.pubkey),
        )
      : agents;
  const channelLabel = mission.channelId
    ? `canal ${compactId(mission.channelId)}`
    : "sem canal vinculado";
  const canOperate =
    mode === "operator" && !mission.isSample && Boolean(mission.channelId);

  function prepareHandoff(item: PendingHandoff) {
    setHandoffDraft(item);
    if (view !== "conversation") updateSearchParam("view", "conversation");
  }

  return (
    <div className="page page--mission">
      <header className="mission-header">
        <div className="mission-header__topline">
          <StateBadge tone={missionStatusTone[mission.status]}>
            {missionStatusLabel[mission.status]}
          </StateBadge>
          {mode === "operator" ? (
            <MissionActions
              mission={mission}
              disabled={saving || Boolean(mission.isSample)}
              onStatusChange={onStatusChange}
            />
          ) : null}
        </div>
        <div className="mission-heading">
          <h1>{mission.title}</h1>
          <p>
            {mission.objective ||
              mission.brief ||
              "Missão sem objetivo registrado."}
          </p>
        </div>
        <div className="mission-meta">
          <span>
            <FileText size={12} aria-hidden="true" /> {project.name}
          </span>
          <span>
            <Bot size={12} aria-hidden="true" /> {missionAgents.length}{" "}
            especialistas disponíveis
          </span>
          <span>
            <GitBranch size={12} aria-hidden="true" /> {dispatches.length}/
            {mission.limits.maxDispatches} dispatches
          </span>
          <span>
            <Clock3 size={12} aria-hidden="true" /> {channelLabel}
          </span>
        </div>
      </header>

      {mission.isSample ? (
        <div className="mission-sample">
          <SampleBanner />
        </div>
      ) : null}
      {messageError ? (
        <div className="mission-alert" role="alert">
          <AlertTriangle size={15} aria-hidden="true" /> {messageError}
        </div>
      ) : null}

      {view === "conversation" ? (
        <div className="mission-grid">
          <section className="conversation-pane">
            <ConversationHeading count={entries.length} />
            {messageLoading && entries.length === 0 ? (
              <div className="empty-state">
                <Radio className="spin" size={20} aria-hidden="true" />
                <p>Lendo as threads no Buzz…</p>
              </div>
            ) : (
              <Timeline entries={entries} />
            )}
            {mode === "operator" ? (
              <div className="composer-wrap">
                {handoffDraft ? (
                  <div className="handoff-draft" role="status">
                    <GitBranch size={14} aria-hidden="true" />
                    <span>
                      Handoff de{" "}
                      <strong>{handoffDraft.dispatch.agentName}</strong> para{" "}
                      <strong>{handoffDraft.agent.name}</strong>
                    </span>
                    <button
                      type="button"
                      aria-label="Cancelar handoff preparado"
                      onClick={() => setHandoffDraft(undefined)}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
                <Composer
                  agents={missionAgents.map((agent) => ({
                    pubkey: agent.pubkey || agent.id,
                    name: agent.name,
                    role: agent.role,
                  }))}
                  destination={channelLabel}
                  preferredAgentPubkey={
                    handoffDraft?.agent.pubkey || handoffDraft?.agent.id
                  }
                  disabled={!canOperate}
                  sending={sending}
                  onSend={async (submission) => {
                    await onSend({
                      ...submission,
                      parentDispatchId: handoffDraft?.dispatch.id,
                      depth: handoffDraft ? handoffDraft.dispatch.depth + 1 : 0,
                    });
                    setHandoffDraft(undefined);
                  }}
                />
                {!mission.channelId ? (
                  <p className="operator-note">
                    Vincule um canal à missão antes de enviar.
                  </p>
                ) : null}
                {mission.isSample ? (
                  <p className="operator-note">
                    Crie uma missão real para habilitar o composer.
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>
          <aside className="chain-pane" aria-label="Chain da missão">
            <header className="chain-pane__heading">
              <strong>Dispatch spine</strong>
              <span>
                {dispatches.length}/{mission.limits.maxDispatches}
              </span>
            </header>
            <HandoffQueue
              items={pendingHandoffs}
              mode={mode}
              onPrepare={prepareHandoff}
            />
            <div className="chain-pane__body">
              <DispatchSpine items={chain} />
            </div>
          </aside>
        </div>
      ) : (
        <div className="mission-grid mission-grid--chain">
          <section className="chain-focus">
            <header className="conversation-heading">
              <div>
                <GitBranch size={16} aria-hidden="true" />
                <span>Chain completa</span>
              </div>
              <span>{chain.length} marcos</span>
            </header>
            <div className="chain-focus__body">
              {chain.length === 0 ? (
                <EmptyState
                  title="O loop ainda não começou"
                  description="Volte para Conversa e envie o primeiro dispatch no modo Operator."
                />
              ) : (
                <DispatchSpine items={chain} />
              )}
            </div>
          </section>
          <aside className="chain-pane" aria-label="Contexto da missão">
            <header className="chain-pane__heading">
              <strong>Contrato da missão</strong>
              <span>{missionStatusLabel[mission.status]}</span>
            </header>
            <MissionDetails
              mission={mission}
              agents={agents}
              mode={mode}
              onLinkThread={onLinkThread}
            />
            <HandoffQueue
              items={pendingHandoffs}
              mode={mode}
              onPrepare={prepareHandoff}
            />
          </aside>
        </div>
      )}
    </div>
  );
}
