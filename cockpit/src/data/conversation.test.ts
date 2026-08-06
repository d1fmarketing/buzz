import { describe, expect, it } from "vitest";
import { normalizeCockpitState, normalizeMessagesResponse } from ".";

const CHANNEL = "11111111-2222-3333-4444-555555555555";
const ROOT = "a".repeat(64);
const REPLY = "b".repeat(64);
const AGENT = "c".repeat(64);

describe("real Buzz conversation normalization", () => {
  it("preserves Markdown and projects reply, mentions and rich imeta", () => {
    const [message] = normalizeMessagesResponse([
      {
        id: REPLY,
        pubkey: AGENT,
        kind: 9,
        created_at: 1_786_000_000,
        content: "  resposta com indentação\n\n- item\n",
        tags: [
          ["h", CHANNEL],
          ["e", ROOT, "", "root"],
          ["e", ROOT, "", "reply"],
          ["p", AGENT],
          [
            "imeta",
            "url https://relay.example/media/story.png",
            "m image/png",
            "x deadbeef",
            "size 2048",
            "dim 1080x1920",
            "thumb https://relay.example/media/story.thumb.jpg",
          ],
        ],
      },
    ]);

    expect(message.content).toBe("  resposta com indentação\n\n- item\n");
    expect(message.channelId).toBe(CHANNEL);
    expect(message.rootId).toBe(ROOT);
    expect(message.replyToId).toBe(ROOT);
    expect(message.attachments[0]).toMatchObject({
      url: "https://relay.example/media/story.png",
      thumbnailUrl: "https://relay.example/media/story.thumb.jpg",
      mimeType: "image/png",
      size: 2048,
      dimensions: "1080x1920",
    });
  });

  it("migrates legacy channel and thread links into conversation references", () => {
    const normalized = normalizeCockpitState({
      version: 1,
      projects: [
        {
          id: "project",
          name: "Projeto",
          description: "",
          color: "#000",
          missionIds: ["mission"],
          createdAt: "2026-08-06T00:00:00Z",
          updatedAt: "2026-08-06T00:00:00Z",
        },
      ],
      missions: [
        {
          id: "mission",
          projectId: "project",
          title: "Missão",
          channelId: CHANNEL,
          threadIds: [ROOT],
          createdAt: "2026-08-06T00:00:00Z",
          updatedAt: "2026-08-06T00:00:00Z",
        },
      ],
    });

    expect(normalized.missions[0]?.conversationRefs).toEqual([
      expect.objectContaining({
        id: `${CHANNEL}:${ROOT}`,
        channelId: CHANNEL,
        rootEventId: ROOT,
      }),
    ]);
  });
});
