import type { HandoffDetection, Message } from "./types";

const HANDOFF_MARKERS: ReadonlyArray<{
  label: string;
  pattern: RegExp;
}> = [
  { label: "next specialist", pattern: /\bnext\s+specialist\b/iu },
  {
    label: "próximo especialista",
    pattern: /\bpr[oó]ximo\s+especialista\b/iu,
  },
  { label: "handoff:", pattern: /\bhandoff\s*:/iu },
  { label: "encaminhar para", pattern: /\bencaminhar\s+para\b/iu },
];

export function extractPTagTargets(
  tags: readonly (readonly string[])[],
): string[] {
  const targets = tags
    .filter((tag) => tag[0] === "p" && typeof tag[1] === "string")
    .map((tag) => tag[1].trim().toLowerCase())
    .filter(Boolean);

  return [...new Set(targets)];
}

export function detectExplicitHandoff(
  message: Pick<Message, "content" | "tags">,
): HandoffDetection {
  const marker = HANDOFF_MARKERS.find(({ pattern }) =>
    pattern.test(message.content),
  );
  const targetPubkeys = extractPTagTargets(message.tags);

  if (!marker || targetPubkeys.length === 0) {
    return { isExplicit: false, targetPubkeys: [] };
  }

  return {
    isExplicit: true,
    marker: marker.label,
    targetPubkeys,
  };
}

export function isExplicitHandoff(
  message: Pick<Message, "content" | "tags">,
): boolean {
  return detectExplicitHandoff(message).isExplicit;
}
