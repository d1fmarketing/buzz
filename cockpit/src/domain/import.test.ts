import { describe, expect, it } from "vitest";
import type { ChannelSummary } from "./types";
import {
  createEmptyState,
  createMission,
  createProject,
  importBuzzChannelProjects,
} from ".";

const NOW = "2026-08-06T18:00:00.000Z";
const LATER = "2026-08-06T19:00:00.000Z";
const ALPHA_ID = "11111111-2222-3333-4444-555555555555";
const BETA_ID = "66666666-7777-8888-9999-aaaaaaaaaaaa";

function channel(id: string, name: string): ChannelSummary {
  return { id, name, archived: false, type: "stream" };
}

describe("Buzz channel project import", () => {
  it("is idempotent and does not churn state timestamps", () => {
    const first = importBuzzChannelProjects(
      createEmptyState(NOW),
      [channel(ALPHA_ID, "Methylia")],
      NOW,
    );
    expect(first.importedProjectIds).toEqual([`buzz-channel:${ALPHA_ID}`]);
    expect(first.state.projects).toHaveLength(1);

    const second = importBuzzChannelProjects(
      first.state,
      [channel(ALPHA_ID, "Methylia renamed upstream")],
      LATER,
    );
    expect(second.state).toBe(first.state);
    expect(second.importedProjectIds).toEqual([]);
    expect(second.linkedProjectIds).toEqual([]);
    expect(second.state.updatedAt).toBe(NOW);
  });

  it("preserves every local presentation edit on reimport", () => {
    const imported = importBuzzChannelProjects(
      createEmptyState(NOW),
      [channel(ALPHA_ID, "Methylia")],
      NOW,
    ).state;
    const edited = {
      ...imported,
      projects: imported.projects.map((project) => ({
        ...project,
        name: "Methylia — Growth",
        description: "Contexto escrito pelo RJ",
        color: "#123456",
      })),
    };

    const result = importBuzzChannelProjects(
      edited,
      [{ ...channel(ALPHA_ID, "Novo nome no Buzz"), about: "Novo about" }],
      LATER,
    );
    expect(result.state).toBe(edited);
    expect(result.state.projects[0]).toMatchObject({
      name: "Methylia — Growth",
      description: "Contexto escrito pelo RJ",
      color: "#123456",
      buzzChannelId: ALPHA_ID,
    });
  });

  it("keeps same-name channels as distinct UUID-backed projects", () => {
    const result = importBuzzChannelProjects(
      createEmptyState(NOW),
      [channel(ALPHA_ID, "Operations"), channel(BETA_ID, "Operations")],
      NOW,
    );
    expect(result.conflicts).toEqual([]);
    expect(result.state.projects).toHaveLength(2);
    expect(
      result.state.projects.map((project) => project.buzzChannelId),
    ).toEqual([ALPHA_ID, BETA_ID]);
    expect(
      new Set(result.state.projects.map((project) => project.id)).size,
    ).toBe(2);
  });

  it("links a unique legacy project through its mission conversation", () => {
    let state = createProject(createEmptyState(NOW), {
      id: "legacy-project",
      name: "Nome local editado",
      description: "Não sobrescrever",
      now: NOW,
    });
    state = createMission(state, {
      id: "legacy-mission",
      projectId: "legacy-project",
      title: "Missão existente",
      channelId: ALPHA_ID,
      now: NOW,
    });

    const result = importBuzzChannelProjects(
      state,
      [channel(ALPHA_ID, "Nome diferente no Buzz")],
      LATER,
    );
    expect(result.importedProjectIds).toEqual([]);
    expect(result.linkedProjectIds).toEqual(["legacy-project"]);
    expect(result.state.projects).toHaveLength(1);
    expect(result.state.projects[0]).toMatchObject({
      id: "legacy-project",
      name: "Nome local editado",
      description: "Não sobrescrever",
      buzzChannelId: ALPHA_ID,
    });
  });
});
