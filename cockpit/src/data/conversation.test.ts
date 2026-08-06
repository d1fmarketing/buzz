import { describe, expect, it } from "vitest";
import {
  normalizeCockpitState,
  normalizeMessagesResponse,
  presentMessagesForReader,
  reconcileBuzzMessageEdits,
} from ".";

const CHANNEL = "11111111-2222-3333-4444-555555555555";
const ROOT = "a".repeat(64);
const REPLY = "b".repeat(64);
const AGENT = "c".repeat(64);
const TARGET = "d".repeat(64);
const EDIT_ONE = "e".repeat(64);
const EDIT_TWO = "f".repeat(64);
const ORLA = "1ee579145add2761f00559a70c01ccf4b7e2185c5e11836157872ac59e040f44";

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

  it("folds an edit into its target while preserving original identity and thread", () => {
    const [message] = reconcileBuzzMessageEdits(
      normalizeMessagesResponse([
        {
          id: TARGET,
          pubkey: AGENT,
          kind: 9,
          created_at: 100,
          content: "original",
          tags: [
            ["h", CHANNEL],
            ["e", ROOT, "", "root"],
            ["p", AGENT],
            [
              "imeta",
              "url https://relay.example/media/original.png",
              "m image/png",
              "x original-hash",
              "filename original.png",
            ],
          ],
        },
        {
          id: EDIT_ONE,
          pubkey: "1".repeat(64),
          kind: 40003,
          created_at: 200,
          content: "edited content",
          tags: [
            ["h", CHANNEL],
            ["e", TARGET],
            ["p", "2".repeat(64)],
            [
              "imeta",
              "url https://relay.example/media/edited.png",
              "m image/png",
              "x edited-hash",
              "filename edited.png",
            ],
          ],
        },
      ]),
    );

    expect(message).toMatchObject({
      id: TARGET,
      channelId: CHANNEL,
      authorPubkey: AGENT,
      createdAt: "1970-01-01T00:01:40.000Z",
      kind: 9,
      content: "edited content",
      rootId: ROOT,
      threadId: ROOT,
    });
    expect(message.tags).toContainEqual(["p", AGENT]);
    expect(message.tags).not.toContainEqual(["p", "2".repeat(64)]);
    expect(message.tags).not.toContainEqual(["e", TARGET]);
    expect(message.attachments).toEqual([
      expect.objectContaining({
        name: "edited.png",
        url: "https://relay.example/media/edited.png",
        sha256: "edited-hash",
      }),
    ]);
  });

  it("uses only the latest edit and lets its empty imeta set remove attachments", () => {
    const [message] = reconcileBuzzMessageEdits(
      normalizeMessagesResponse([
        {
          id: TARGET,
          pubkey: AGENT,
          kind: 9,
          created_at: 100,
          content: "original",
          tags: [
            ["h", CHANNEL],
            [
              "imeta",
              "url https://relay.example/media/original.png",
              "m image/png",
              "x original-hash",
            ],
          ],
        },
        {
          id: EDIT_TWO,
          pubkey: AGENT,
          kind: 40003,
          created_at: 300,
          content: "latest",
          tags: [
            ["h", CHANNEL],
            ["e", TARGET],
          ],
        },
        {
          id: EDIT_ONE,
          pubkey: AGENT,
          kind: 40003,
          created_at: 200,
          content: "older",
          tags: [
            ["h", CHANNEL],
            ["e", TARGET],
            [
              "imeta",
              "url https://relay.example/media/older.png",
              "m image/png",
              "x older-hash",
            ],
          ],
        },
      ]),
    );

    expect(message.content).toBe("latest");
    expect(message.attachments).toEqual([]);
    expect(message.tags.some((tag) => tag[0] === "imeta")).toBe(false);
  });

  it("hides an edit event when its target is not loaded", () => {
    const [unrelated] = normalizeMessagesResponse([
      {
        id: ROOT,
        pubkey: AGENT,
        kind: 9,
        created_at: 100,
        content: "unrelated",
        tags: [["h", CHANNEL]],
      },
    ]);
    const orphanEdits = normalizeMessagesResponse(
      [
        {
          id: EDIT_ONE,
          pubkey: AGENT,
          kind: 40003,
          created_at: 200,
          content: "must stay hidden",
          tags: [
            ["h", CHANNEL],
            ["e", TARGET],
          ],
        },
      ],
      { channelId: CHANNEL },
    );

    expect(orphanEdits).toHaveLength(1);
    expect(reconcileBuzzMessageEdits([unrelated, ...orphanEdits])).toEqual([
      unrelated,
    ]);
  });

  it("removes orchestration ledgers and short supersession controls in Reader", () => {
    const messages = normalizeMessagesResponse([
      {
        id: "1".repeat(64),
        pubkey: ORLA,
        kind: 9,
        created_at: 100,
        content:
          "Ledger — SH-BLUEPRINT-00 · RECIBO DE FECHAMENTO (registro; não centralizo).",
        tags: [["h", CHANNEL]],
      },
      {
        id: "2".repeat(64),
        pubkey: ORLA,
        kind: 9,
        created_at: 101,
        content:
          "@Rune, o pedido anterior foi superseded. Nenhuma ação adicional é necessária.",
        tags: [["h", CHANNEL]],
      },
      {
        id: "3".repeat(64),
        pubkey: AGENT,
        kind: 9,
        created_at: 102,
        content: "A recomendação profissional continua válida para o projeto.",
        tags: [["h", CHANNEL]],
      },
    ]);

    const reader = presentMessagesForReader(messages);

    expect(reader.hiddenProtocolCount).toBe(2);
    expect(reader.messages.map((message) => message.id)).toEqual([
      "3".repeat(64),
    ]);
  });

  it("hides mass readback acknowledgements but never a media-bearing result", () => {
    const messages = normalizeMessagesResponse([
      {
        id: "6".repeat(64),
        pubkey: AGENT,
        kind: 9,
        created_at: 105,
        content:
          "@Orla (Operations / Traffic / PMO), leitura integral concluída: **285/285 eventos**, em ordem.",
        tags: [["h", CHANNEL]],
      },
      {
        id: "7".repeat(64),
        pubkey: AGENT,
        kind: 9,
        created_at: 106,
        content:
          "@Orla, leitura integral concluída: **285/285 eventos**. Resultado visual anexado.",
        tags: [
          ["h", CHANNEL],
          [
            "imeta",
            "url https://relay.example/media/readback.png",
            "m image/png",
          ],
        ],
      },
    ]);

    const reader = presentMessagesForReader(messages);

    expect(reader.hiddenProtocolCount).toBe(1);
    expect(reader.messages.map((message) => message.id)).toEqual([
      "7".repeat(64),
    ]);
  });

  it("does not hide ledger language from a different specialist", () => {
    const [message] = normalizeMessagesResponse([
      {
        id: "8".repeat(64),
        pubkey: AGENT,
        kind: 9,
        created_at: 107,
        content:
          "Ledger — esta é uma análise substantiva de arquitetura, não um recibo da Orla.",
        tags: [["h", CHANNEL]],
      },
    ]);

    expect(presentMessagesForReader([message]).messages).toHaveLength(1);
  });

  it("hides technical provenance gates while keeping ordinary QA", () => {
    const messages = normalizeMessagesResponse([
      {
        id: "9".repeat(64),
        pubkey: AGENT,
        kind: 9,
        created_at: 108,
        content:
          "Gate de fechamento de Vale — SH-BLUEPRINT-00 · VEREDITO PASS. Verifiquei o artefato real e o manifest.",
        tags: [["h", CHANNEL]],
      },
      {
        id: "a1".repeat(32),
        pubkey: AGENT,
        kind: 9,
        created_at: 109,
        content:
          "A revisão independente encontrou uma contradição importante para a decisão do RJ.",
        tags: [["h", CHANNEL]],
      },
    ]);

    const reader = presentMessagesForReader(messages);

    expect(reader.hiddenProtocolCount).toBe(1);
    expect(reader.messages.map((message) => message.id)).toEqual([
      "a1".repeat(32),
    ]);
  });

  it("redacts internal paths and jargon without hiding substantive corrections", () => {
    const [message] = normalizeMessagesResponse([
      {
        id: "4".repeat(64),
        pubkey: AGENT,
        kind: 9,
        created_at: 103,
        content:
          "**Contrato corrigido:** suporte AI 24/7. Esse trecho fica superseded por SUPERSEDED_BY(44f20cf7).\n- Artefato: `OUTBOX/SH_BLUEPRINT/final.md`\nA análise completa segue disponível em `PLANS/review.md`.",
        tags: [["h", CHANNEL]],
      },
    ]);

    const reader = presentMessagesForReader([message]);

    expect(reader.hiddenProtocolCount).toBe(0);
    expect(reader.messages[0]?.content).toContain("Contrato corrigido");
    expect(reader.messages[0]?.content).toContain("substituído");
    expect(reader.messages[0]?.content).toContain("arquivo interno");
    expect(reader.messages[0]?.content).not.toMatch(/OUTBOX|PLANS|supersed/i);
  });

  it("keeps substantive blueprint discussion and attachments intact", () => {
    const [message] = normalizeMessagesResponse([
      {
        id: "5".repeat(64),
        pubkey: AGENT,
        kind: 9,
        created_at: 104,
        content:
          "O blueprint recomenda texto como caminho completo e fornecedores substituíveis.",
        tags: [
          ["h", CHANNEL],
          [
            "imeta",
            "url https://relay.example/media/diagram.png",
            "m image/png",
          ],
        ],
      },
    ]);

    const reader = presentMessagesForReader([message]);

    expect(reader.messages).toHaveLength(1);
    expect(reader.messages[0]?.content).toContain("blueprint recomenda");
    expect(reader.messages[0]?.attachments).toEqual(message.attachments);
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

  it("round-trips a project's Buzz channel identity", () => {
    const normalized = normalizeCockpitState({
      version: 1,
      projects: [
        {
          id: `buzz-channel:${CHANNEL}`,
          name: "Methylia — nome local",
          description: "Contexto local",
          color: "#123456",
          buzz_channel_id: CHANNEL.toUpperCase(),
          missionIds: [],
          createdAt: "2026-08-06T00:00:00Z",
          updatedAt: "2026-08-06T00:00:00Z",
        },
      ],
    });

    expect(normalized.projects[0]).toMatchObject({
      name: "Methylia — nome local",
      description: "Contexto local",
      color: "#123456",
      buzzChannelId: CHANNEL,
    });
  });
});
