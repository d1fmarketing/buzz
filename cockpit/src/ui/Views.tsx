import { useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CircleAlert,
  FlaskConical,
  FolderPlus,
  GitBranch,
  Plus,
  Settings2,
  Sparkles,
} from "lucide-react";
import type {
  AgentSummary,
  AttentionItem,
  ChannelSummary,
  CockpitState,
  Mission,
  Project,
} from "../domain";
import { compactId, formatRelativeTime } from "./format";
import {
  Avatar,
  EmptyState,
  InternalLink,
  RowAction,
  StateBadge,
} from "./primitives";
import {
  activityLabel,
  missionStatusLabel,
  missionStatusTone,
  presenceLabel,
} from "./status";
import type { CockpitMode } from "./Shell";

export function SampleBanner() {
  return (
    <div className="sample-banner">
      <FlaskConical size={15} aria-hidden="true" />
      <span>Exemplo local — nenhum prompt desta área foi enviado ao Buzz.</span>
    </div>
  );
}

function MissionIndex({
  missions,
  projects,
}: {
  missions: Mission[];
  projects: Project[];
}) {
  if (missions.length === 0) {
    return (
      <EmptyState
        title="Nenhuma missão ainda"
        description="Crie uma missão para reunir o brief, as threads e a sequência de agentes em um único lugar."
      />
    );
  }

  return (
    <ul className="index-list">
      {missions.map((mission) => {
        const project = projects.find(
          (candidate) => candidate.id === mission.projectId,
        );
        return (
          <li key={mission.id}>
            <InternalLink
              className="index-row"
              href={`/projects/${encodeURIComponent(mission.projectId)}/missions/${encodeURIComponent(mission.id)}`}
            >
              <div className="index-row__primary">
                <strong>{mission.title}</strong>
                <p>
                  {mission.objective ||
                    mission.brief ||
                    "Sem objetivo registrado."}
                </p>
              </div>
              <div className="index-row__cell">
                <span>Projeto</span>
                <p>{project?.name ?? "Projeto"}</p>
              </div>
              <div className="index-row__cell">
                <span>Estado</span>
                <StateBadge tone={missionStatusTone[mission.status]}>
                  {missionStatusLabel[mission.status]}
                </StateBadge>
              </div>
              <RowAction />
            </InternalLink>
          </li>
        );
      })}
    </ul>
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
  agents,
  mode,
  saving,
  onCreateProject,
}: {
  state: CockpitState;
  agents: AgentSummary[];
  mode: CockpitMode;
  saving: boolean;
  onCreateProject: (input: {
    name: string;
    description: string;
  }) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const activeMissions = state.missions.filter(
    (mission) => mission.status === "running",
  );
  const workingAgents = agents.filter((agent) => agent.activity === "working");
  const openAttention = state.attention.filter((item) => !item.resolvedAt);
  const recent = [...state.missions]
    .sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    )
    .slice(0, 8);

  return (
    <div className="page">
      <header className="page-heading">
        <div className="page-heading__copy">
          <span className="eyebrow">
            <Sparkles size={13} aria-hidden="true" /> Venture Studio
          </span>
          <h1>O trabalho em curso, sem a inbox.</h1>
          <p>
            Projetos, missões e respostas do Buzz organizados pelo caminho que o
            trabalho percorreu.
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

      <section className="signal-strip" aria-label="Resumo do cockpit">
        <div className="signal">
          <span className="signal__value">{state.projects.length}</span>
          <span className="signal__label">projetos</span>
        </div>
        <div className="signal">
          <span className="signal__value">{activeMissions.length}</span>
          <span className="signal__label">missões em curso</span>
        </div>
        <div className="signal">
          <span className="signal__value">{workingAgents.length}</span>
          <span className="signal__label">agentes trabalhando</span>
        </div>
        <div className="signal">
          <span className="signal__value">{openAttention.length}</span>
          <span className="signal__label">itens de atenção</span>
        </div>
      </section>

      <section className="section-block">
        <header className="section-heading">
          <h2>Missões recentes</h2>
          <span>{recent.length} visíveis</span>
        </header>
        <MissionIndex missions={recent} projects={state.projects} />
      </section>

      {openAttention.length > 0 ? (
        <section className="section-block">
          <header className="section-heading">
            <h2>Precisa de atenção</h2>
            <InternalLink href="/attention" className="row-action">
              Ver tudo <ArrowRight size={14} aria-hidden="true" />
            </InternalLink>
          </header>
          <AttentionRows items={openAttention.slice(0, 3)} state={state} />
        </section>
      ) : null}
    </div>
  );
}

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
            <option value="">Vincular depois</option>
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
  mode,
  saving,
  onCreateMission,
}: {
  project: Project;
  state: CockpitState;
  agents: AgentSummary[];
  channels: ChannelSummary[];
  mode: CockpitMode;
  saving: boolean;
  onCreateMission: (input: {
    title: string;
    objective: string;
    channelId?: string;
  }) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
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

  return (
    <div className="page">
      <header className="page-heading">
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
              "Reúna aqui as missões e threads deste projeto."}
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
          channels={channels}
          saving={saving}
          onClose={() => setCreating(false)}
          onCreate={async (input) => {
            await onCreateMission(input);
            setCreating(false);
          }}
        />
      ) : null}

      <section className="signal-strip" aria-label="Resumo do projeto">
        <div className="signal">
          <span className="signal__value">{missions.length}</span>
          <span className="signal__label">missões</span>
        </div>
        <div className="signal">
          <span className="signal__value">
            {missions.filter((mission) => mission.status === "running").length}
          </span>
          <span className="signal__label">em curso</span>
        </div>
        <div className="signal">
          <span className="signal__value">{projectAgents.length}</span>
          <span className="signal__label">especialistas envolvidos</span>
        </div>
        <div className="signal">
          <span className="signal__value">
            {missions.reduce(
              (count, mission) => count + mission.threadIds.length,
              0,
            )}
          </span>
          <span className="signal__label">threads vinculadas</span>
        </div>
      </section>

      <section className="section-block">
        <header className="section-heading">
          <h2>Missões</h2>
          <span>{missions.length} no projeto</span>
        </header>
        <MissionIndex missions={missions} projects={state.projects} />
      </section>
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
          <h1>Atenção, não outra inbox.</h1>
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
