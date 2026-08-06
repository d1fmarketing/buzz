import type { ReactNode } from "react";
import {
  AlertCircle,
  Bot,
  ChevronRight,
  FolderKanban,
  LayoutDashboard,
  MessageSquareMore,
  RefreshCw,
} from "lucide-react";
import type { CockpitState } from "../domain";
import type { HealthStatus } from "./api";
import { ConnectionState, InternalLink, SegmentedControl } from "./primitives";
import { updateSearchParam } from "./router";

export type CockpitMode = "reader" | "operator";
export type MissionViewMode = "conversation" | "chain";

export interface RouteDescriptor {
  kind:
    | "home"
    | "activity"
    | "project"
    | "mission"
    | "agents"
    | "attention"
    | "not-found";
  projectId?: string;
  missionId?: string;
}

export function ProjectRail({
  state,
  route,
  health,
}: {
  state: CockpitState;
  route: RouteDescriptor;
  health: HealthStatus;
}) {
  const attentionCount = state.attention.filter(
    (item) => !item.resolvedAt,
  ).length;

  return (
    <aside className="project-rail" aria-label="Navegação do cockpit">
      <div className="project-rail__brand">
        <span className="brand-mark">BZ</span>
        <div>
          <strong>Buzz</strong>
          <span>Cockpit local</span>
        </div>
      </div>

      <nav className="rail-nav" aria-label="Navegação principal">
        <InternalLink
          href="/"
          className={
            route.kind === "home"
              ? "rail-nav__item is-active"
              : "rail-nav__item"
          }
        >
          <LayoutDashboard size={15} aria-hidden="true" />
          Visão geral
        </InternalLink>
        <InternalLink
          href="/activity"
          className={
            route.kind === "activity"
              ? "rail-nav__item is-active"
              : "rail-nav__item"
          }
        >
          <MessageSquareMore size={15} aria-hidden="true" />
          Atividade
        </InternalLink>
        <InternalLink
          href="/agents"
          className={
            route.kind === "agents"
              ? "rail-nav__item is-active"
              : "rail-nav__item"
          }
        >
          <Bot size={15} aria-hidden="true" />
          Agentes
        </InternalLink>
        <InternalLink
          href="/attention"
          className={
            route.kind === "attention"
              ? "rail-nav__item is-active"
              : "rail-nav__item"
          }
        >
          <AlertCircle size={15} aria-hidden="true" />
          Atenção
          {attentionCount > 0 ? (
            <span className="rail-nav__count">{attentionCount}</span>
          ) : null}
        </InternalLink>
      </nav>

      <section className="rail-section" aria-labelledby="projects-label">
        <div className="rail-section__heading" id="projects-label">
          <span>Projetos</span>
          <span>{state.projects.length}</span>
        </div>
        <ul className="project-list">
          {state.projects.map((project) => (
            <li key={project.id}>
              <InternalLink
                href={`/projects/${encodeURIComponent(project.id)}`}
                className={
                  route.projectId === project.id
                    ? "project-list__item is-active"
                    : "project-list__item"
                }
              >
                <span
                  className="project-list__dot"
                  style={
                    { "--project-color": project.color } as React.CSSProperties
                  }
                />
                <span className="project-list__name">{project.name}</span>
                <span className="project-list__count">
                  {project.missionIds.length}
                </span>
              </InternalLink>
            </li>
          ))}
        </ul>
      </section>

      <footer className="project-rail__footer">
        <ConnectionState
          ok={
            health.ok &&
            health.cliAvailable &&
            health.relayConfigured &&
            health.authenticated
          }
          label={health.ok ? "Buzz conectado" : "Buzz indisponível"}
        />
      </footer>
    </aside>
  );
}

export function WorkspaceTopbar({
  state,
  route,
  mode,
  missionView,
  refreshing,
  onRefresh,
}: {
  state: CockpitState;
  route: RouteDescriptor;
  mode: CockpitMode;
  missionView: MissionViewMode;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const project = state.projects.find(
    (candidate) => candidate.id === route.projectId,
  );
  const mission = state.missions.find(
    (candidate) => candidate.id === route.missionId,
  );
  const finalLabel =
    route.kind === "home"
      ? "Visão geral"
      : route.kind === "activity"
        ? "Atividade"
        : route.kind === "agents"
          ? "Agentes"
          : route.kind === "attention"
            ? "Atenção"
            : (mission?.title ?? project?.name ?? "Página não encontrada");

  return (
    <header className="workspace-topbar">
      <nav className="workspace-topbar__trail" aria-label="Localização atual">
        <FolderKanban size={14} aria-hidden="true" />
        {mission && project ? (
          <>
            <span>{project.name}</span>
            <ChevronRight size={12} aria-hidden="true" />
          </>
        ) : null}
        <strong>{finalLabel}</strong>
      </nav>
      <div className="workspace-topbar__actions">
        {route.kind === "mission" ? (
          <SegmentedControl
            label="Visualização da missão"
            value={missionView}
            options={[
              { value: "conversation", label: "Conversa" },
              { value: "chain", label: "Chain" },
            ]}
            onChange={(value) => updateSearchParam("view", value)}
          />
        ) : null}
        <SegmentedControl
          label="Modo do cockpit"
          value={mode}
          options={[
            { value: "reader", label: "Reader" },
            { value: "operator", label: "Operator" },
          ]}
          onChange={(value) => updateSearchParam("mode", value)}
        />
        <button
          className="icon-button"
          type="button"
          onClick={onRefresh}
          aria-label="Atualizar dados do Buzz"
        >
          <RefreshCw
            className={refreshing ? "spin" : undefined}
            size={15}
            aria-hidden="true"
          />
        </button>
      </div>
    </header>
  );
}

export function AppShell({
  state,
  route,
  health,
  mode,
  missionView,
  refreshing,
  onRefresh,
  children,
}: {
  state: CockpitState;
  route: RouteDescriptor;
  health: HealthStatus;
  mode: CockpitMode;
  missionView: MissionViewMode;
  refreshing: boolean;
  onRefresh: () => void;
  children: ReactNode;
}) {
  return (
    <div className="app-shell" data-mode={mode}>
      <a className="skip-link" href="#main-content">
        Pular para o conteúdo
      </a>
      <ProjectRail state={state} route={route} health={health} />
      <div className="workspace">
        <WorkspaceTopbar
          state={state}
          route={route}
          mode={mode}
          missionView={missionView}
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
        <main id="main-content">{children}</main>
      </div>
    </div>
  );
}
