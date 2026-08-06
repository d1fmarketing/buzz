import { describe, expect, it } from "vitest";
import {
  createEmptyState,
  createMission,
  createProject,
  detectExplicitHandoff,
  guardMissionDispatch,
  upsertDispatch,
} from ".";

const TARGET = "a".repeat(64);

describe("explicit handoff detection", () => {
  it("does not treat a narrative mention as a handoff", () => {
    expect(
      detectExplicitHandoff({
        content: "Conversei com Fizz e concordo com a análise dele.",
        tags: [["p", TARGET]],
      }),
    ).toEqual({ isExplicit: false, targetPubkeys: [] });
  });

  it("requires a real p-tag even when the prose proposes a specialist", () => {
    expect(
      detectExplicitHandoff({
        content: "Próximo especialista: Fizz, para validar a hipótese.",
        tags: [],
      }),
    ).toEqual({ isExplicit: false, targetPubkeys: [] });
  });

  it("accepts an explicit marker plus the exact tagged identity", () => {
    expect(
      detectExplicitHandoff({
        content: "Próximo especialista: Fizz, para validar a hipótese.",
        tags: [
          ["p", TARGET.toUpperCase()],
          ["p", TARGET],
        ],
      }),
    ).toEqual({
      isExplicit: true,
      marker: "próximo especialista",
      targetPubkeys: [TARGET],
    });
  });
});

describe("mission dispatch guard", () => {
  function missionFixture() {
    const withProject = createProject(
      createEmptyState("2026-08-06T00:00:00Z"),
      {
        id: "project",
        name: "Projeto",
        now: "2026-08-06T00:00:00Z",
      },
    );
    const state = createMission(withProject, {
      id: "mission",
      projectId: "project",
      title: "Missão",
      now: "2026-08-06T00:00:00Z",
    });
    const mission = state.missions[0];
    if (!mission) throw new Error("fixture mission missing");
    return { state, mission };
  }

  it("allows the last valid handoff depth and blocks the next one", () => {
    const { state, mission } = missionFixture();
    expect(
      guardMissionDispatch(mission, state.dispatches, {
        agentId: TARGET,
        depth: mission.limits.maxHandoffDepth,
      }),
    ).toEqual({ allowed: true });
    expect(
      guardMissionDispatch(mission, state.dispatches, {
        agentId: TARGET,
        depth: mission.limits.maxHandoffDepth + 1,
      }),
    ).toMatchObject({ allowed: false, code: "handoff_depth" });
  });

  it("keeps the selected Buzz channel on a dispatch", () => {
    const { state, mission } = missionFixture();
    const channelId = "11111111-2222-3333-4444-555555555555";
    const next = upsertDispatch(state, {
      id: "dispatch-with-channel",
      missionId: mission.id,
      agentId: TARGET,
      agentName: "Honey",
      status: "sent",
      channelId,
    });

    expect(next.dispatches[0]?.channelId).toBe(channelId);
  });

  it("blocks a seventeenth dispatch", () => {
    let { state, mission } = missionFixture();
    for (let index = 0; index < mission.limits.maxDispatches; index += 1) {
      state = upsertDispatch(state, {
        id: `dispatch-${index}`,
        missionId: mission.id,
        agentId: String(index % 4).repeat(64),
        agentName: `Agent ${index}`,
        status: "sent",
      });
    }
    expect(
      guardMissionDispatch(mission, state.dispatches, {
        agentId: TARGET,
        depth: 0,
      }),
    ).toMatchObject({ allowed: false, code: "dispatch_budget" });
  });

  it("blocks a third child from one response", () => {
    let { state, mission } = missionFixture();
    for (const [index, agentId] of ["b".repeat(64), "c".repeat(64)].entries()) {
      state = upsertDispatch(state, {
        id: `child-${index}`,
        missionId: mission.id,
        agentId,
        agentName: `Agent ${index}`,
        status: "sent",
        parentDispatchId: "parent",
      });
    }
    expect(
      guardMissionDispatch(mission, state.dispatches, {
        agentId: TARGET,
        depth: 1,
        parentDispatchId: "parent",
      }),
    ).toMatchObject({ allowed: false, code: "children_budget" });
  });

  it("stops at the configured no-material-gain boundary", () => {
    const { state, mission } = missionFixture();
    expect(
      guardMissionDispatch(mission, state.dispatches, {
        agentId: TARGET,
        depth: 0,
        noMaterialGainRounds: mission.limits.maxNoNoveltyRounds,
      }),
    ).toMatchObject({ allowed: false, code: "no_material_gain" });
  });
});
