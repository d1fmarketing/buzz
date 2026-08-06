import { describe, expect, it } from "vitest";
import type { AgentSummary, Message } from "../domain";
import {
  cockpitMediaUrl,
  messagesToTimelineEntries,
  timelineEntryHasMedia,
} from "./Timeline";

const HONEY = "a".repeat(64);
const FIZZ = "b".repeat(64);
const OWNER = "d".repeat(64);

const agents: AgentSummary[] = [
  {
    id: HONEY,
    pubkey: HONEY,
    name: "Honey",
    role: "Editorial",
    presence: "online",
    activity: "idle",
  },
  {
    id: FIZZ,
    pubkey: FIZZ,
    name: "Fizz",
    role: "Production",
    presence: "online",
    activity: "idle",
  },
];

function message(input: Partial<Message>): Message {
  return {
    id: "c".repeat(64),
    channelId: "11111111-2222-3333-4444-555555555555",
    content: "",
    authorPubkey: HONEY,
    authorName: "Honey",
    createdAt: "2026-08-06T00:00:00Z",
    kind: 9,
    tags: [],
    attachments: [],
    ...input,
  };
}

describe("conversation timeline projection", () => {
  it("routes only content-addressed relay media through the local CLI", () => {
    const mediaName = `${"e".repeat(64)}.png`;

    expect(
      cockpitMediaUrl(`https://relay.example/media/${mediaName}?w=640`),
    ).toBe(`/api/media/${mediaName}`);
    expect(cockpitMediaUrl("https://example.com/reference.png")).toBe(
      "https://example.com/reference.png",
    );
  });

  it("shows a narrative tag as a mention without inventing a handoff", () => {
    const [entry] = messagesToTimelineEntries(
      [
        message({
          content: "Fizz também analisou este ponto.",
          tags: [["p", FIZZ]],
        }),
      ],
      agents,
    );

    expect(entry.mentions).toEqual([
      expect.objectContaining({ pubkey: FIZZ, name: "Fizz" }),
    ]);
    expect(entry.handoffTargetPubkeys).toEqual([]);
  });

  it("preserves an explicit handoff and recognizes generated media", () => {
    const [entry] = messagesToTimelineEntries(
      [
        message({
          content:
            "Próximo especialista: Fizz, para testar.\n\n![image](https://relay.example/result.png)",
          tags: [["p", FIZZ]],
        }),
      ],
      agents,
    );

    expect(entry.handoffTargetPubkeys).toEqual([FIZZ]);
    expect(timelineEntryHasMedia(entry)).toBe(true);
  });

  it("includes documents in the artifact filter", () => {
    const [entry] = messagesToTimelineEntries(
      [
        message({
          content: "Relatório anexado.",
          attachments: [
            {
              id: "report-attachment",
              name: "report.pdf",
              url: `https://relay.example/media/${"f".repeat(64)}.pdf`,
              mimeType: "application/pdf",
            },
          ],
        }),
      ],
      agents,
    );

    expect(timelineEntryHasMedia(entry)).toBe(true);
  });

  it("labels the authenticated Buzz owner as RJ instead of exposing a key", () => {
    const [entry] = messagesToTimelineEntries(
      [
        message({
          content: "@RJ concluído.",
          tags: [
            ["p", OWNER],
            ["auth", OWNER],
          ],
        }),
      ],
      agents,
    );

    expect(entry.mentions).toEqual([
      expect.objectContaining({ pubkey: OWNER, name: "RJ" }),
    ]);
  });

  it("renders owner-authored prompts as Isa in a shared conversation", () => {
    const entries = messagesToTimelineEntries(
      [
        message({
          id: "1".repeat(64),
          authorPubkey: OWNER,
          authorName: "Owner",
          content: "Investigue esta hipótese.",
        }),
        message({
          id: "2".repeat(64),
          content: "Análise concluída.",
          tags: [["auth", OWNER]],
        }),
      ],
      agents,
    );

    expect(entries[0]).toMatchObject({
      authorName: "Isa",
      authorLabel: "Orquestradora",
      role: "isa",
    });
  });
});
