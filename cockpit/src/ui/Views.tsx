import { useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CircleAlert,
  FlaskConical,
  FolderPlus,
  GitBranch,
  Images,
  LoaderCircle,
  MessageSquareMore,
  Plus,
  Settings2,
  Sparkles,
} from "lucide-react";
import type {
  AgentSummary,
  AttentionItem,
  ChannelSummary,
  CockpitState,
  Message,
  Project,
} from "../domain";
import { presentMessagesForReader } from "../data";
import { compactId, formatRelativeTime } from "./format";
import {
  Composer,
  type ComposerDestination,
  type ComposerSubmission,
} from "./Composer";
import { Avatar, EmptyState, InternalLink } from "./primitives";
import { activityLabel, missionStatusLabel, presenceLabel } from "./status";
import type { CockpitMode } from "./Shell";
import {
  messagesToTimelineEntries,
  Timeline,
  timelineEntryHasMedia,
} from "./Timeline";

export function SampleBanner() {
  return (
    <div className="sample-banner">
      <FlaskConical size={15} aria-hidden="true" />
      <span>Exemplo local — nenhum prompt desta área foi enviado ao Buzz.</span>
    </div>
  );
}

function NewProjectPanel({
  open,
  saving,
  onClose,
  onCreate,
}: {
  open: boolean;
  saving: boolean;
  onClose: () => void;
  onCreate: (input: { name: string; description: string }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string>();
  if (!open) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    try {
      await onCreate({ name, description });
      setName("");
      setDescription("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "O projeto não foi salvo.",
      );
    }
  }

  return (
    <section className="create-panel" aria-labelledby="new-project-title">
      <h2 id="new-project-title">Novo projeto</h2>
      <form className="create-form" onSubmit={(event) => void submit(event)}>
        <label className="field">
          <span>Nome</span>
          <input
            value={name}
            required
            onChange={(event) => setName(event.target.value)}
            placeholder="Ex.: Methylia"
          />
        </label>
        <label className="field">
          <span>Contexto</span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="O que reúne este projeto?"
          />
        </label>
        <div className="workspace-topbar__actions">
          <button
            className="button button--ghost"
            type="button"
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            className="button button--violet"
            type="submit"
            disabled={saving || !name.trim()}
          >
            <FolderPlus size={15} aria-hidden="true" />
            {saving ? "Salvando" : "Criar projeto"}
          </button>
        </div>
      </form>
      {error ? (
        <p className="composer__error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export function HomeView({
  state,
  mode,
  saving,
  onCreateProject,
}: {
  state: CockpitState;
  mode: CockpitMode;
  saving: boolean;
  onCreateProject: (input: {
    name: string;
    description: string;
  }) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  return (
    <div className="page page--project-picker">
      <header className="page-heading project-picker-heading">
        <div className="page-heading__copy">
          <span className="eyebrow">
            <Sparkles size={13} aria-hidden="true" /> Venture Studio
          </span>
          <h1>Qual projeto você quer acompanhar?</h1>
          <p>
            Cada projeto abre seu próprio histórico, suas threads, agentes,
            handoffs e arquivos — sem misturar conversas de outros projetos.
          </p>
        </div>
        {mode === "operator" ? (
          <button
            className="button button--violet"
            type="button"
            onClick={() => setCreating(true)}
          >
            <Plus size={15} aria-hidden="true" />
            Novo projeto
          </button>
        ) : null}
      </header>

      {state.starter ? <SampleBanner /> : null}

      <NewProjectPanel
        open={creating}
        saving={saving}
        onClose={() => setCreating(false)}
        onCreate={async (input) => {
          await onCreateProject(input);
          setCreating(false);
        }}
      />

      <section className="section-block project-picker">
        <header className="section-heading">
          <h2>Projetos do Buzz</h2>
          <span>{state.projects.length} disponíveis</span>
        </header>
        {state.projects.length === 0 ? (
          <EmptyState
            title="Nenhum projeto vinculado"
            description="Atualize o Buzz para importar os canais ativos ou crie um projeto local."
          />
        ) : (
          <ul className="project-picker__grid">
            {state.projects.map((project) => {
              const missions = state.missions.filter(
                (mission) => mission.projectId === project.id,
              );
              return (
                <li key={project.id}>
                  <InternalLink
                    href={`/projects/${encodeURIComponent(project.id)}`}
                    className="project-card"
                  >
                    <div className="project-card__topline">
                      <span
                        className="project-list__dot"
                        style={
                          {
                            "--project-color": project.color,
                          } as React.CSSProperties
                        }
                      />
                      <span>
                        {project.buzzChannelId
                          ? "Buzz ao vivo"
                          : "Projeto local"}
                      </span>
                    </div>
                    <strong>{project.name}</strong>
                    <p>
                      {project.description ||
                        "Abra o histórico completo deste projeto."}
                    </p>
                    <footer>
                      <span>
                        {project.buzzChannelId
                          ? "Histórico conectado"
                          : `${missions.length} missões`}
                      </span>
                      <span>
                        Abrir projeto{" "}
                        <ArrowRight size={14} aria-hidden="true" />
                      </span>
                    </footer>
                  </InternalLink>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

type ActivityScope = "all" | "handoffs" | "media";

function NewMissionPanel({
  channels,
  saving,
  onCreate,
  onClose,
}: {
  channels: ChannelSummary[];
  saving: boolean;
  onCreate: (input: {
    title: string;
    objective: string;
    channelId?: string;
  }) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    try {
      await onCreate({ title, objective, channelId: channelId || undefined });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A missão não foi salva.",
      );
    }
  }

  return (
    <section className="create-panel" aria-labelledby="new-mission-title">
      <h2 id="new-mission-title">Nova missão</h2>
      <form className="create-form" onSubmit={(event) => void submit(event)}>
        <label className="field">
          <span>Título</span>
          <input
            value={title}
            required
            onChange={(event) => setTitle(event.target.value)}
            placeholder="O que precisa ser concluído?"
          />
        </label>
        <label className="field">
          <span>Objetivo</span>
          <input
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            placeholder="Qual é a entrega final?"
          />
        </label>
        <label className="field">
          <span>Canal do Buzz</span>
          <select
            value={channelId}
            onChange={(event) => setChannelId(event.target.value)}
          >
            {channels.length !== 1 ? (
              <option value="">Vincular depois</option>
            ) : null}
            {channels.map((channel) => (
              <option value={channel.id} key={channel.id}>
                {channel.name} · {compactId(channel.id)}
              </option>
            ))}
          </select>
        </label>
        <div className="workspace-topbar__actions">
          <button
            className="button button--ghost"
            type="button"
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            className="button button--violet"
            type="submit"
            disabled={saving || !title.trim()}
          >
            <GitBranch size={15} aria-hidden="true" />
            {saving ? "Salvando" : "Criar missão"}
          </button>
        </div>
      </form>
      {error ? (
        <p className="composer__error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export function ProjectView({
  project,
  state,
  agents,
  channels,
  messages,
  messageLoading,
  messageError,
  mode,
  saving,
  sending,
  onCreateMission,
  onSend,
}: {
  project: Project;
  state: CockpitState;
  agents: AgentSummary[];
  channels: ChannelSummary[];
  messages: Message[];
  messageLoading: boolean;
  messageError?: string;
  mode: CockpitMode;
  saving: boolean;
  sending: boolean;
  onCreateMission: (input: {
    title: string;
    objective: string;
    channelId?: string;
  }) => Promise<void>;
  onSend: (submission: ComposerSubmission) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [scope, setScope] = useState<ActivityScope>("all");
  const [agentFilter, setAgentFilter] = useState("");
  const [threadFilter, setThreadFilter] = useState("");
  const missions = state.missions.filter(
    (mission) => mission.projectId === project.id,
  );
  const projectAgentIds = new Set(
    missions.flatMap((mission) => mission.agentIds),
  );
  const projectAgents = agents.filter(
    (agent) =>
      projectAgentIds.has(agent.id) || projectAgentIds.has(agent.pubkey),
  );
  const readerPresentation = presentMessagesForReader(messages);
  const presentedMessages =
    mode === "reader" ? readerPresentation.messages : messages;
  const messageById = new Map(
    presentedMessages.map((message) => [message.id, message]),
  );
  const entries = messagesToTimelineEntries(presentedMessages, agents).map(
    (entry) => ({
      ...entry,
      contextLabel: `Thread #${compactId(entry.threadId ?? entry.id)}`,
    }),
  );
  const participantIds = new Set(
    entries.flatMap((entry) =>
      entry.authorPubkey ? [entry.authorPubkey] : [],
    ),
  );
  const speakingAgents = agents.filter(
    (agent) => participantIds.has(agent.pubkey) || participantIds.has(agent.id),
  );
  const threadMap = new Map<
    string,
    { id: string; title: string; count: number; updatedAt?: string }
  >();
  for (const entry of entries) {
    const threadId = entry.threadId ?? entry.id;
    const current = threadMap.get(threadId);
    const source = messageById.get(entry.id);
    const fallbackTitle =
      source?.content.replace(/\s+/g, " ").trim().slice(0, 72) ||
      `Thread #${compactId(threadId)}`;
    threadMap.set(threadId, {
      id: threadId,
      title: current?.title ?? fallbackTitle,
      count: (current?.count ?? 0) + 1,
      updatedAt:
        !current?.updatedAt ||
        Date.parse(entry.createdAt ?? "") > Date.parse(current.updatedAt)
          ? entry.createdAt
          : current.updatedAt,
    });
  }
  const threads = [...threadMap.values()].sort(
    (left, right) =>
      Date.parse(right.updatedAt ?? "") - Date.parse(left.updatedAt ?? ""),
  );
  const visibleEntries = entries.filter((entry) => {
    if (threadFilter && (entry.threadId ?? entry.id) !== threadFilter)
      return false;
    if (
      agentFilter &&
      entry.authorPubkey !== agentFilter &&
      !entry.mentions?.some((mention) => mention.pubkey === agentFilter)
    ) {
      return false;
    }
    if (scope === "handoffs")
      return Boolean(entry.handoffTargetPubkeys?.length);
    if (scope === "media") return timelineEntryHasMedia(entry);
    return true;
  });
  const projectChannel = channels.find(
    (channel) => channel.id === project.buzzChannelId,
  );
  const conversationDestinations: ComposerDestination[] = project.buzzChannelId
    ? [
        {
          id: `${project.buzzChannelId}:new-thread`,
          channelId: project.buzzChannelId,
          label: `Nova conversa · ${projectChannel?.name ?? project.name}`,
        },
        ...threads.map((thread) => ({
          id: `${project.buzzChannelId}:${thread.id}`,
          channelId: project.buzzChannelId ?? "",
          replyTo: thread.id,
          label: `${thread.title} · #${compactId(thread.id)}`,
        })),
      ]
    : [];
  const preferredDestinationId =
    threadFilter && project.buzzChannelId
      ? `${project.buzzChannelId}:${threadFilter}`
      : undefined;

  return (
    <div className="page page--project-workspace">
      <header className="page-heading project-workspace-heading">
        <div className="page-heading__copy">
          <span className="eyebrow">
            <span
              className="project-list__dot"
              style={
                { "--project-color": project.color } as React.CSSProperties
              }
            />{" "}
            Projeto
          </span>
          <h1>{project.name}</h1>
          <p>
            {project.description ||
              `Histórico ao vivo de #${projectChannel?.name ?? project.name}.`}
          </p>
        </div>
        {mode === "operator" ? (
          <button
            className="button button--violet"
            type="button"
            onClick={() => setCreating(true)}
          >
            <Plus size={15} aria-hidden="true" /> Nova missão
          </button>
        ) : null}
      </header>

      {project.isSample ? <SampleBanner /> : null}
      {creating ? (
        <NewMissionPanel
          channels={projectChannel ? [projectChannel] : []}
          saving={saving}
          onClose={() => setCreating(false)}
          onCreate={async (input) => {
            await onCreateMission(input);
            setCreating(false);
          }}
        />
      ) : null}

      {messageError ? (
        <div className="mission-alert" role="alert">
          <AlertTriangle size={15} aria-hidden="true" /> {messageError}
        </div>
      ) : null}

      <div className="project-workspace-grid">
        <section
          className="project-history"
          aria-label={`Histórico de ${project.name}`}
        >
          <header className="project-history__heading">
            <div>
              <span className="live-dot" aria-hidden="true" />
              <strong>
                {threadFilter
                  ? "Conversa selecionada"
                  : mode === "reader"
                    ? "Conversa do projeto"
                    : "Todo o projeto"}
              </strong>
            </div>
            <span>
              {visibleEntries.length} de {entries.length} falas
            </span>
          </header>
          <fieldset
            className="activity-toolbar"
            aria-label="Filtros do projeto"
          >
            <button
              type="button"
              className={scope === "all" ? "is-active" : undefined}
              aria-pressed={scope === "all"}
              onClick={() => setScope("all")}
            >
              <MessageSquareMore size={14} aria-hidden="true" /> Todas
            </button>
            <button
              type="button"
              className={scope === "handoffs" ? "is-active" : undefined}
              aria-pressed={scope === "handoffs"}
              onClick={() => setScope("handoffs")}
            >
              <GitBranch size={14} aria-hidden="true" /> Handoffs
            </button>
            <button
              type="button"
              className={scope === "media" ? "is-active" : undefined}
              aria-pressed={scope === "media"}
              onClick={() => setScope("media")}
            >
              <Images size={14} aria-hidden="true" /> Arquivos
            </button>
            <label className="project-agent-filter">
              <span className="sr-only">Filtrar por agente</span>
              <select
                value={agentFilter}
                onChange={(event) => setAgentFilter(event.target.value)}
              >
                <option value="">Todo o time</option>
                {speakingAgents.map((agent) => (
                  <option value={agent.pubkey || agent.id} key={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
          {mode === "operator" ? (
            <div className="composer-wrap project-composer">
              <Composer
                agents={agents.map((agent) => ({
                  pubkey: agent.pubkey || agent.id,
                  name: agent.name,
                  role: agent.role,
                }))}
                destinations={conversationDestinations}
                preferredDestinationId={preferredDestinationId}
                disabled={
                  messageLoading ||
                  !project.buzzChannelId ||
                  conversationDestinations.length === 0
                }
                sending={sending}
                onSend={onSend}
              />
              <p className="operator-note">
                O envio e os arquivos usam o mesmo canal, relay e OAuth do Buzz.
              </p>
            </div>
          ) : null}
          {messageLoading && entries.length === 0 ? (
            <div className="empty-state" aria-live="polite">
              <LoaderCircle className="spin" size={20} aria-hidden="true" />
              <p>Lendo o histórico completo de {project.name}…</p>
            </div>
          ) : (
            <Timeline entries={visibleEntries} order="newest" />
          )}
        </section>

        <aside
          className="project-context"
          aria-label={`Conversas de ${project.name}`}
        >
          <section className="project-thread-list">
            <header>
              <strong>Conversas</strong>
              <span>{threads.length}</span>
            </header>
            <button
              type="button"
              className={!threadFilter ? "is-active" : undefined}
              onClick={() => setThreadFilter("")}
            >
              <span>
                <strong>
                  {mode === "reader"
                    ? "Conversa do projeto"
                    : "Todo o histórico"}
                </strong>
                <small>
                  {mode === "reader"
                    ? "Conversa sem protocolo"
                    : "Projeto completo"}
                </small>
              </span>
              <small>{entries.length}</small>
            </button>
            <div className="project-thread-list__scroll">
              {threads.map((thread) => (
                <button
                  type="button"
                  className={
                    threadFilter === thread.id ? "is-active" : undefined
                  }
                  onClick={() => setThreadFilter(thread.id)}
                  key={thread.id}
                >
                  <span>
                    <strong>{thread.title}</strong>
                    <small>{formatRelativeTime(thread.updatedAt)}</small>
                  </span>
                  <small>{thread.count}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="project-context__section">
            <header>
              <strong>Missões</strong>
              <span>{missions.length}</span>
            </header>
            {missions.length === 0 ? (
              <p>
                Nenhuma missão criada; o histórico do canal já está visível.
              </p>
            ) : (
              <ul>
                {missions.map((mission) => (
                  <li key={mission.id}>
                    <InternalLink
                      href={`/projects/${encodeURIComponent(project.id)}/missions/${encodeURIComponent(mission.id)}`}
                    >
                      <span>
                        <strong>{mission.title}</strong>
                        <small>{missionStatusLabel[mission.status]}</small>
                      </span>
                      <ArrowRight size={13} aria-hidden="true" />
                    </InternalLink>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="project-context__section">
            <header>
              <strong>Time neste projeto</strong>
              <span>{speakingAgents.length || projectAgents.length}</span>
            </header>
            <div className="project-agent-stack">
              {(speakingAgents.length ? speakingAgents : projectAgents)
                .slice(0, 12)
                .map((agent) => (
                  <Avatar
                    name={agent.name}
                    imageUrl={agent.avatarUrl}
                    tone="violet"
                    key={agent.id}
                  />
                ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function AgentDraftPanel({
  agents,
  channels,
  onClose,
  onSubmit,
}: {
  agents: AgentSummary[];
  channels: ChannelSummary[];
  onClose: () => void;
  onSubmit: (input: {
    agent: AgentSummary;
    channelId: string;
    model: string;
  }) => Promise<void>;
}) {
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const selectedAgent = agents.find((agent) => agent.id === agentId);
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [model, setModel] = useState(selectedAgent?.model ?? "");
  const [status, setStatus] = useState<string>();

  return (
    <section className="create-panel" aria-labelledby="model-draft-title">
      <h2 id="model-draft-title">Preparar ajuste de modelo</h2>
      <form
        className="create-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!selectedAgent || !channelId || !model.trim()) return;
          void onSubmit({
            agent: selectedAgent,
            channelId,
            model: model.trim(),
          })
            .then(() =>
              setStatus("Draft enviado ao Buzz original para revisão."),
            )
            .catch((cause: unknown) =>
              setStatus(
                cause instanceof Error
                  ? cause.message
                  : "O draft não foi enviado.",
              ),
            );
        }}
      >
        <label className="field">
          <span>Agente</span>
          <select
            value={agentId}
            onChange={(event) => {
              const next = agents.find(
                (agent) => agent.id === event.target.value,
              );
              setAgentId(event.target.value);
              setModel(next?.model ?? "");
            }}
          >
            {agents.map((agent) => (
              <option value={agent.id} key={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Modelo</span>
          <input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="Modelo configurado no runtime"
          />
        </label>
        <label className="field">
          <span>Canal de revisão</span>
          <select
            value={channelId}
            onChange={(event) => setChannelId(event.target.value)}
          >
            {channels.map((channel) => (
              <option value={channel.id} key={channel.id}>
                {channel.name} · {compactId(channel.id)}
              </option>
            ))}
          </select>
        </label>
        <div className="workspace-topbar__actions">
          <button
            className="button button--ghost"
            type="button"
            onClick={onClose}
          >
            Fechar
          </button>
          <button
            className="button button--violet"
            type="submit"
            disabled={!selectedAgent || !channelId || !model.trim()}
          >
            <Settings2 size={15} aria-hidden="true" /> Enviar draft
          </button>
        </div>
      </form>
      {status ? (
        <p className="sample-banner" role="status">
          {status}
        </p>
      ) : null}
    </section>
  );
}

export function AgentsView({
  agents,
  channels,
  state,
  mode,
  onDraftAgentModel,
}: {
  agents: AgentSummary[];
  channels: ChannelSummary[];
  state: CockpitState;
  mode: CockpitMode;
  onDraftAgentModel: (input: {
    agent: AgentSummary;
    channelId: string;
    model: string;
  }) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="page">
      <header className="page-heading">
        <div className="page-heading__copy">
          <span className="eyebrow">
            <Bot size={13} aria-hidden="true" /> Venture Studio
          </span>
          <h1>Agentes</h1>
          <p>
            Presença, atividade e resposta são fatos diferentes. Esta tela
            mantém cada sinal separado.
          </p>
        </div>
        {mode === "operator" && agents.length > 0 && channels.length > 0 ? (
          <button
            className="button button--ghost"
            type="button"
            onClick={() => setEditing(true)}
          >
            <Settings2 size={15} aria-hidden="true" /> Preparar ajuste
          </button>
        ) : null}
      </header>

      {editing ? (
        <AgentDraftPanel
          agents={agents}
          channels={channels}
          onClose={() => setEditing(false)}
          onSubmit={onDraftAgentModel}
        />
      ) : null}

      {agents.length === 0 ? (
        <EmptyState
          title="Nenhum agente retornado"
          description="Abra o Buzz original e confirme que os managed agents estão configurados para este relay."
        />
      ) : (
        <ul className="agents-list">
          {agents.map((agent) => {
            const project = state.projects.find(
              (candidate) => candidate.id === agent.currentProjectId,
            );
            const mission = state.missions.find(
              (candidate) => candidate.id === agent.currentMissionId,
            );
            return (
              <li className="agent-row" key={agent.id}>
                <div className="agent-row__identity">
                  <Avatar name={agent.name} imageUrl={agent.avatarUrl} />
                  <div>
                    <strong>{agent.name}</strong>
                    <span>{agent.role}</span>
                  </div>
                </div>
                <div className="agent-row__datum">
                  <span>Presença</span>
                  <span className={`presence presence--${agent.presence}`}>
                    {presenceLabel[agent.presence]}
                  </span>
                </div>
                <div className="agent-row__datum">
                  <span>Atividade</span>
                  <strong>{activityLabel[agent.activity]}</strong>
                </div>
                <div className="agent-row__datum">
                  <span>Modelo</span>
                  <p>{agent.model || "Não informado"}</p>
                </div>
                <div className="agent-row__datum">
                  <span>Última resposta</span>
                  <p>{formatRelativeTime(agent.lastResponseAt)}</p>
                  {mission || project ? (
                    <p>{mission?.title ?? project?.name}</p>
                  ) : null}
                  {project ? (
                    <InternalLink
                      href={`/projects/${encodeURIComponent(project.id)}`}
                      className="agent-row__conversation"
                    >
                      Abrir projeto <ArrowRight size={12} aria-hidden="true" />
                    </InternalLink>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function attentionIcon(item: AttentionItem) {
  if (item.kind === "handoff")
    return <GitBranch size={14} aria-hidden="true" />;
  if (item.kind === "decision")
    return <CircleAlert size={14} aria-hidden="true" />;
  return <AlertTriangle size={14} aria-hidden="true" />;
}

function AttentionRows({
  items,
  state,
}: {
  items: AttentionItem[];
  state: CockpitState;
}) {
  return (
    <ul className="attention-list">
      {items.map((item) => {
        const project = state.projects.find(
          (candidate) => candidate.id === item.projectId,
        );
        const mission = state.missions.find(
          (candidate) => candidate.id === item.missionId,
        );
        const href = mission
          ? `/projects/${encodeURIComponent(mission.projectId)}/missions/${encodeURIComponent(mission.id)}?view=chain`
          : project
            ? `/projects/${encodeURIComponent(project.id)}`
            : "/attention";
        return (
          <li
            className={`attention-row attention-row--${item.severity}`}
            key={item.id}
          >
            <span className="attention-row__icon">{attentionIcon(item)}</span>
            <div className="attention-row__copy">
              <strong>{item.title}</strong>
              <p>{item.detail}</p>
            </div>
            <div className="attention-row__context">
              <span>Contexto</span>
              <p>{mission?.title ?? project?.name ?? "Cockpit"}</p>
            </div>
            <InternalLink className="row-action" href={href}>
              Abrir <ArrowRight size={14} aria-hidden="true" />
            </InternalLink>
          </li>
        );
      })}
    </ul>
  );
}

export function AttentionView({ state }: { state: CockpitState }) {
  const items = state.attention.filter((item) => !item.resolvedAt);
  return (
    <div className="page">
      <header className="page-heading">
        <div className="page-heading__copy">
          <span className="eyebrow">
            <CircleAlert size={13} aria-hidden="true" /> Exceções
          </span>
          <h1>Só o que exige uma decisão.</h1>
          <p>
            Apenas bloqueios, timeouts, falhas, decisões e handoffs que precisam
            de leitura.
          </p>
        </div>
      </header>
      {state.starter ? <SampleBanner /> : null}
      {items.length === 0 ? (
        <EmptyState
          title="Nada exige atenção"
          description="Conversas normais continuam nas missões. Esta área fica vazia até existir uma exceção real."
        />
      ) : (
        <AttentionRows items={items} state={state} />
      )}
    </div>
  );
}

export function NotFoundView() {
  return (
    <div className="not-found">
      <h1>Esta área não existe</h1>
      <p>
        O projeto ou a missão pode ter sido removido da organização local. As
        conversas no Buzz continuam intactas.
      </p>
      <InternalLink className="button button--ink" href="/">
        Voltar à visão geral
      </InternalLink>
    </div>
  );
}
