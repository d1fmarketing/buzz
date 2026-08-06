import { describe, expect, it } from "vitest";
import {
  createEmptyState,
  createMission,
  createProject,
  DEFAULT_LIMITS,
  ensureProjectConversationMission,
} from ".";

const NOW = "2026-08-06T20:00:00.000Z";
const CHANNEL_A = "11111111-2222-3333-4444-555555555555";
const CHANNEL_B = "66666666-7777-8888-9999-aaaaaaaaaaaa";

function stateWithProject(id = "project-a", channelId = CHANNEL_A) {
  return createProject(createEmptyState(NOW), {
    id,
    name: id,
    buzzChannelId: channelId,
    now: NOW,
  });
}

describe("continuous project conversation mission", () => {
  it("creates a normal deterministic mission for the project channel", () => {
    const initial = stateWithProject();
    const result = ensureProjectConversationMission(initial, "project-a", NOW);

    expect(result.mission).toMatchObject({
      id: `project-conversation:${CHANNEL_A}`,
      projectId: "project-a",
      channelId: CHANNEL_A,
      title: "Conversa contínua",
      status: "draft",
      conversationRefs: [],
      limits: DEFAULT_LIMITS,
    });
    expect(result.state.projects[0]?.missionIds).toContain(result.mission.id);
  });

  it("is referentially idempotent after creation", () => {
    const first = ensureProjectConversationMission(
      stateWithProject(),
      "project-a",
      NOW,
    );
    const second = ensureProjectConversationMission(
      first.state,
      "project-a",
      "2026-08-06T21:00:00.000Z",
    );

    expect(second.state).toBe(first.state);
    expect(second.mission).toBe(first.mission);
    expect(second.state.missions).toHaveLength(1);
  });

  it("isolates missions by channel and refuses a deterministic id collision", () => {
    let state = stateWithProject();
    state = createProject(state, {
      id: "project-b",
      name: "project-b",
      buzzChannelId: CHANNEL_B,
      now: NOW,
    });
    const first = ensureProjectConversationMission(state, "project-a", NOW);
    const second = ensureProjectConversationMission(
      first.state,
      "project-b",
      NOW,
    );
    expect(second.state.missions.map((mission) => mission.id)).toEqual([
      `project-conversation:${CHANNEL_A}`,
      `project-conversation:${CHANNEL_B}`,
    ]);

    const collisionState = createMission(state, {
      id: `project-conversation:${CHANNEL_A}`,
      projectId: "project-b",
      title: "Missão conflitante",
      channelId: CHANNEL_B,
      now: NOW,
    });
    expect(() =>
      ensureProjectConversationMission(collisionState, "project-a", NOW),
    ).toThrow(/belongs to another project or channel/);
  });

  it("requires an existing project with a Buzz channel", () => {
    expect(() =>
      ensureProjectConversationMission(createEmptyState(NOW), "missing", NOW),
    ).toThrow(/does not exist/);

    const unlinked = createProject(createEmptyState(NOW), {
      id: "unlinked",
      name: "unlinked",
      now: NOW,
    });
    expect(() =>
      ensureProjectConversationMission(unlinked, "unlinked", NOW),
    ).toThrow(/not linked to a Buzz channel/);
  });
});
