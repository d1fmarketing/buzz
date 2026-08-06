import {
  copyDefaultLimits,
  createEmptyState,
  type AgentActivity,
  type AgentPresence,
  type AgentSummary,
  type AttachmentSummary,
  type AttentionItem,
  type AttentionKind,
  type AttentionSeverity,
  type ChannelMember,
  type ChannelSummary,
  type CliWriteReceipt,
  type CockpitState,
  type Dispatch,
  type DispatchReceipt,
  type DispatchReceiptStatus,
  type Message,
  type Mission,
  type MissionStatus,
  type Project,
} from "../domain";
import {
  asBoolean,
  asNumber,
  asString,
  firstNumber,
  firstString,
  isRecord,
  parseJsonPayload,
  stableLocalId,
  stringArray,
  toIsoTimestamp,
  unwrapCliRows,
  type JsonRecord,
} from "./guards";

const MISSION_STATUSES = new Set<MissionStatus>([
  "draft",
  "running",
  "paused",
  "awaiting_rj",
  "completed",
  "blocked",
]);

const DISPATCH_STATUSES = new Set<DispatchReceiptStatus>([
  "planned",
  "sent",
  "relay_accepted",
  "working",
  "response_received",
  "handoff_proposed",
  "handed_off",
  "incorporated",
  "completed",
  "blocked",
  "timed_out",
]);

const ATTENTION_KINDS = new Set<AttentionKind>([
  "timeout",
  "blocked",
  "decision",
  "handoff",
  "relay",
  "oauth",
]);

const ATTENTION_SEVERITIES = new Set<AttentionSeverity>([
  "info",
  "warning",
  "critical",
]);

function enumValue<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  fallback: T,
): T {
  const candidate = asString(value) as T | undefined;
  return candidate && allowed.has(candidate) ? candidate : fallback;
}

function normalizeTags(value: unknown): string[][] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((candidate) => {
    if (!Array.isArray(candidate)) {
      return [];
    }
    const tag = candidate.flatMap((part) => {
      if (typeof part === "string") {
        return [part];
      }
      if (typeof part === "number" || typeof part === "boolean") {
        return [String(part)];
      }
      return [];
    });
    return tag.length > 0 ? [tag] : [];
  });
}

function tagValue(tags: readonly string[][], name: string): string | undefined {
  return tags.find((tag) => tag[0] === name)?.[1];
}

function nip10References(tags: readonly string[][]): {
  rootId?: string;
  replyToId?: string;
} {
  let rootId: string | undefined;
  let replyToId: string | undefined;
  let firstEventId: string | undefined;

  for (const tag of tags) {
    if (tag[0] !== "e" || !tag[1]) {
      continue;
    }
    firstEventId ??= tag[1];
    if (tag[3] === "root") {
      rootId = tag[1];
    }
    if (tag[3] === "reply") {
      replyToId = tag[1];
    }
  }

  return {
    rootId: rootId ?? firstEventId,
    replyToId,
  };
}

function parseImeta(
  tag: string[],
  index: number,
): AttachmentSummary | undefined {
  if (tag[0] !== "imeta") {
    return undefined;
  }
  const fields = new Map<string, string>();
  for (const part of tag.slice(1)) {
    const separator = part.indexOf(" ");
    if (separator > 0) {
      fields.set(part.slice(0, separator), part.slice(separator + 1));
    }
  }
  const url = fields.get("url");
  const hash = fields.get("x");
  if (!url && !hash) {
    return undefined;
  }
  const size = asNumber(fields.get("size"));
  const urlName = url?.split("/").pop()?.split("?")[0];
  return {
    id: hash ?? stableLocalId("attachment", `${url ?? ""}:${index}`),
    name: fields.get("name") ?? urlName ?? `Attachment ${index + 1}`,
    url,
    mimeType: fields.get("m"),
    size,
    sha256: hash,
  };
}

function normalizeAttachment(
  value: unknown,
  index: number,
): AttachmentSummary | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const url = firstString(value, "url", "src", "download_url");
  const sha256 = firstString(value, "sha256", "hash", "x");
  const name = firstString(value, "name", "filename", "file_name");
  if (!url && !sha256 && !name) {
    return undefined;
  }
  return {
    id:
      firstString(value, "id") ??
      sha256 ??
      stableLocalId("attachment", `${url}:${index}`),
    name:
      name ?? url?.split("/").pop()?.split("?")[0] ?? `Attachment ${index + 1}`,
    url,
    mimeType: firstString(value, "mimeType", "mime_type", "type"),
    size: firstNumber(value, "size", "bytes"),
    sha256,
  };
}

function normalizeAttachments(
  record: JsonRecord,
  tags: string[][],
): AttachmentSummary[] {
  const fromTags = tags.flatMap((tag, index) => {
    const attachment = parseImeta(tag, index);
    return attachment ? [attachment] : [];
  });
  const raw = record.attachments ?? record.files;
  const fromFields = Array.isArray(raw)
    ? raw.flatMap((value, index) => {
        const attachment = normalizeAttachment(value, index);
        return attachment ? [attachment] : [];
      })
    : [];
  const seen = new Set<string>();
  return [...fromTags, ...fromFields].filter((attachment) => {
    if (seen.has(attachment.id)) {
      return false;
    }
    seen.add(attachment.id);
    return true;
  });
}

export function normalizeChannelsResponse(input: unknown): ChannelSummary[] {
  return unwrapCliRows(input, ["channels", "items"]).flatMap((value) => {
    if (!isRecord(value)) {
      return [];
    }
    const tags = normalizeTags(value.tags);
    const id =
      firstString(value, "channel_id", "channelId", "id") ??
      tagValue(tags, "d");
    const name =
      firstString(value, "name", "display_name", "title") ??
      tagValue(tags, "name");
    if (!id || !name) {
      return [];
    }
    const visibility =
      firstString(value, "visibility") ??
      (tags.some((tag) => tag[0] === "private")
        ? "private"
        : tags.some((tag) => tag[0] === "public")
          ? "public"
          : undefined);
    return [
      {
        id,
        name,
        type:
          firstString(value, "channel_type", "channelType", "type") ??
          tagValue(tags, "t"),
        visibility,
        archived:
          asBoolean(value.archived) ?? tagValue(tags, "archived") === "true",
        about:
          firstString(value, "about", "description") ?? tagValue(tags, "about"),
        topic: firstString(value, "topic") ?? tagValue(tags, "topic"),
        purpose: firstString(value, "purpose") ?? tagValue(tags, "purpose"),
      },
    ];
  });
}

export function normalizeMembersResponse(input: unknown): ChannelMember[] {
  const seen = new Set<string>();
  return unwrapCliRows(input, ["members", "items"]).flatMap((value) => {
    if (!isRecord(value)) {
      return [];
    }
    const pubkey = firstString(value, "pubkey", "public_key", "id");
    if (!pubkey || seen.has(pubkey)) {
      return [];
    }
    seen.add(pubkey);
    return [{ pubkey, role: firstString(value, "role") ?? "member" }];
  });
}

export interface NormalizeMessageOptions {
  channelId?: string;
  threadId?: string;
  authorNames?: Readonly<Record<string, string>>;
  ownerPubkey?: string;
}

export function normalizeMessagesResponse(
  input: unknown,
  options: NormalizeMessageOptions = {},
): Message[] {
  return unwrapCliRows(input, ["messages", "events", "items"]).flatMap(
    (value, index) => {
      if (!isRecord(value)) {
        return [];
      }
      const content = asString(value.content) ?? "";
      const tags = normalizeTags(value.tags);
      const createdAt = toIsoTimestamp(
        value.created_at ?? value.createdAt ?? value.timestamp,
      );
      const authorPubkey =
        firstString(value, "pubkey", "author_pubkey", "authorPubkey") ?? "";
      const id =
        firstString(value, "id", "event_id", "eventId") ??
        stableLocalId(
          "message",
          `${authorPubkey}:${createdAt}:${content}:${index}`,
        );
      const references = nip10References(tags);
      const explicitThreadId = firstString(value, "thread_id", "threadId");
      const channelId =
        firstString(value, "channel_id", "channelId") ??
        tagValue(tags, "h") ??
        options.channelId ??
        "";
      const authorName =
        firstString(
          value,
          "author_name",
          "authorName",
          "display_name",
          "name",
        ) ??
        options.authorNames?.[authorPubkey] ??
        (authorPubkey ? `${authorPubkey.slice(0, 8)}…` : "Unknown");

      return [
        {
          id,
          channelId,
          content,
          authorPubkey,
          authorName,
          createdAt,
          kind: firstNumber(value, "kind") ?? 9,
          tags,
          attachments: normalizeAttachments(value, tags),
          threadId:
            explicitThreadId ?? references.rootId ?? options.threadId ?? id,
          rootId: references.rootId ?? options.threadId ?? id,
          replyToId: references.replyToId,
          isMine:
            asBoolean(value.isMine ?? value.is_mine) ??
            Boolean(
              options.ownerPubkey && options.ownerPubkey === authorPubkey,
            ),
        },
      ];
    },
  );
}

function normalizePresence(value: unknown): AgentPresence {
  const status = asString(value)?.toLowerCase();
  return status === "online" || status === "away" || status === "offline"
    ? status
    : "unknown";
}

function normalizeActivity(record: JsonRecord): AgentActivity {
  const activity = firstString(
    record,
    "activity",
    "activity_status",
  )?.toLowerCase();
  if (activity === "working" || asBoolean(record.working) === true) {
    return "working";
  }
  if (activity === "idle" || asBoolean(record.working) === false) {
    return "idle";
  }
  return "unknown";
}

function mergeProfileContent(record: JsonRecord): JsonRecord {
  const parsed = parseJsonPayload(record.content);
  return isRecord(parsed) ? { ...record, ...parsed } : record;
}

export function normalizeAgentsResponse(input: unknown): AgentSummary[] {
  const seen = new Set<string>();
  return unwrapCliRows(input, ["agents", "users", "profiles", "items"]).flatMap(
    (raw) => {
      if (!isRecord(raw)) {
        return [];
      }
      const value = mergeProfileContent(raw);
      const pubkey =
        firstString(value, "pubkey", "public_key", "agent_pubkey") ?? "";
      const name =
        firstString(value, "display_name", "displayName", "name") ?? "";
      const id = firstString(value, "id", "agent_id") ?? (pubkey || name);
      if (!id || seen.has(id)) {
        return [];
      }
      seen.add(id);
      return [
        {
          id,
          pubkey,
          name: name || (pubkey ? `${pubkey.slice(0, 8)}…` : "Unknown agent"),
          role:
            firstString(value, "role", "profession", "title") ?? "Specialist",
          persona: firstString(value, "persona", "description"),
          avatarUrl: firstString(value, "avatar_url", "avatarUrl", "picture"),
          presence: normalizePresence(value.presence ?? value.presence_status),
          activity: normalizeActivity(value),
          model: firstString(value, "model", "model_id", "modelId"),
          currentProjectId: firstString(
            value,
            "current_project_id",
            "currentProjectId",
          ),
          currentMissionId: firstString(
            value,
            "current_mission_id",
            "currentMissionId",
          ),
          lastActivityAt: value.last_activity_at
            ? toIsoTimestamp(value.last_activity_at)
            : value.lastActivityAt
              ? toIsoTimestamp(value.lastActivityAt)
              : undefined,
          lastResponseAt: value.last_response_at
            ? toIsoTimestamp(value.last_response_at)
            : value.lastResponseAt
              ? toIsoTimestamp(value.lastResponseAt)
              : undefined,
          statusUpdatedAt: value.status_updated_at
            ? toIsoTimestamp(value.status_updated_at)
            : value.statusUpdatedAt
              ? toIsoTimestamp(value.statusUpdatedAt)
              : undefined,
        },
      ];
    },
  );
}

function unwrapReceipt(input: unknown): JsonRecord | undefined {
  let current = parseJsonPayload(input);
  for (let depth = 0; depth < 5; depth += 1) {
    if (!isRecord(current)) {
      return undefined;
    }
    if (
      current.event_id !== undefined ||
      current.eventId !== undefined ||
      current.accepted !== undefined
    ) {
      return current;
    }
    const next =
      current.data ??
      current.result ??
      current.body ??
      current.stdout ??
      current.output;
    if (next === undefined) {
      return current;
    }
    current = parseJsonPayload(next);
  }
  return undefined;
}

export function normalizeWriteReceipt(input: unknown): CliWriteReceipt {
  const value = unwrapReceipt(input);
  if (!value) {
    return { accepted: false, message: "Invalid Buzz CLI response" };
  }
  return {
    eventId: firstString(value, "event_id", "eventId", "id"),
    accepted: asBoolean(value.accepted ?? value.ok) ?? false,
    message: firstString(value, "message", "detail") ?? "",
    requestId: firstString(value, "request_id", "requestId"),
    saved: asBoolean(value.saved),
  };
}

function normalizeProject(
  value: unknown,
  fallbackTime: string,
): Project | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = firstString(value, "id", "project_id", "projectId");
  const name = firstString(value, "name", "title");
  if (!id || !name) {
    return undefined;
  }
  return {
    id,
    name,
    description: firstString(value, "description") ?? "",
    color: firstString(value, "color") ?? "#D97757",
    missionIds: stringArray(value.missionIds ?? value.mission_ids),
    createdAt: toIsoTimestamp(
      value.createdAt ?? value.created_at,
      fallbackTime,
    ),
    updatedAt: toIsoTimestamp(
      value.updatedAt ?? value.updated_at,
      fallbackTime,
    ),
    isSample: asBoolean(value.isSample ?? value.is_sample) || undefined,
  };
}

function normalizeMission(
  value: unknown,
  fallbackTime: string,
): Mission | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = firstString(value, "id", "mission_id", "missionId");
  const projectId = firstString(value, "projectId", "project_id");
  const title = firstString(value, "title", "name");
  if (!id || !projectId || !title) {
    return undefined;
  }
  const rawLimits = isRecord(value.limits) ? value.limits : {};
  const defaults = copyDefaultLimits();
  return {
    id,
    projectId,
    title,
    objective: firstString(value, "objective") ?? "",
    brief: firstString(value, "brief") ?? "",
    status: enumValue(value.status, MISSION_STATUSES, "draft"),
    channelId: firstString(value, "channelId", "channel_id"),
    threadIds: stringArray(value.threadIds ?? value.thread_ids),
    agentIds: stringArray(value.agentIds ?? value.agent_ids),
    dispatchIds: stringArray(value.dispatchIds ?? value.dispatch_ids),
    limits: {
      initialSpecialists:
        firstNumber(rawLimits, "initialSpecialists", "initial_specialists") ??
        defaults.initialSpecialists,
      maxSpecialists:
        firstNumber(rawLimits, "maxSpecialists", "max_specialists") ??
        defaults.maxSpecialists,
      maxChildrenPerResponse:
        firstNumber(
          rawLimits,
          "maxChildrenPerResponse",
          "max_children_per_response",
        ) ?? defaults.maxChildrenPerResponse,
      maxHandoffDepth:
        firstNumber(rawLimits, "maxHandoffDepth", "max_handoff_depth") ??
        defaults.maxHandoffDepth,
      maxCriticCycles:
        firstNumber(rawLimits, "maxCriticCycles", "max_critic_cycles") ??
        defaults.maxCriticCycles,
      maxDispatches:
        firstNumber(rawLimits, "maxDispatches", "max_dispatches") ??
        defaults.maxDispatches,
      maxRetriesPerDispatch:
        firstNumber(
          rawLimits,
          "maxRetriesPerDispatch",
          "max_retries_per_dispatch",
        ) ?? defaults.maxRetriesPerDispatch,
      maxNoNoveltyRounds:
        firstNumber(rawLimits, "maxNoNoveltyRounds", "max_no_novelty_rounds") ??
        defaults.maxNoNoveltyRounds,
    },
    createdAt: toIsoTimestamp(
      value.createdAt ?? value.created_at,
      fallbackTime,
    ),
    updatedAt: toIsoTimestamp(
      value.updatedAt ?? value.updated_at,
      fallbackTime,
    ),
    completedAt:
      value.completedAt || value.completed_at
        ? toIsoTimestamp(value.completedAt ?? value.completed_at)
        : undefined,
    isSample: asBoolean(value.isSample ?? value.is_sample) || undefined,
  };
}

function normalizeReceipt(
  value: unknown,
  fallbackTime: string,
): DispatchReceipt | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const statusString = asString(value.status) as
    | DispatchReceiptStatus
    | undefined;
  if (!statusString || !DISPATCH_STATUSES.has(statusString)) {
    return undefined;
  }
  return {
    status: statusString,
    at: toIsoTimestamp(value.at ?? value.created_at, fallbackTime),
    eventId: firstString(value, "eventId", "event_id"),
    note: firstString(value, "note", "message"),
    targetAgentIds: stringArray(value.targetAgentIds ?? value.target_agent_ids),
  };
}

function normalizeDispatch(
  value: unknown,
  fallbackTime: string,
): Dispatch | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = firstString(value, "id", "dispatch_id", "dispatchId");
  const missionId = firstString(value, "missionId", "mission_id");
  const agentId = firstString(value, "agentId", "agent_id", "pubkey");
  const agentName = firstString(value, "agentName", "agent_name", "name");
  if (!id || !missionId || !agentId || !agentName) {
    return undefined;
  }
  const status = enumValue(value.status, DISPATCH_STATUSES, "planned");
  const receipts = Array.isArray(value.receipts)
    ? value.receipts.flatMap((receipt) => {
        const normalized = normalizeReceipt(receipt, fallbackTime);
        return normalized ? [normalized] : [];
      })
    : [];
  return {
    id,
    missionId,
    agentId,
    agentName,
    prompt: firstString(value, "prompt", "content") ?? "",
    status,
    receipts,
    depth: firstNumber(value, "depth") ?? 0,
    criticCycle: firstNumber(value, "criticCycle", "critic_cycle") ?? 0,
    retryCount: firstNumber(value, "retryCount", "retry_count") ?? 0,
    proposedAgentIds: stringArray(
      value.proposedAgentIds ?? value.proposed_agent_ids,
    ),
    parentDispatchId: firstString(
      value,
      "parentDispatchId",
      "parent_dispatch_id",
    ),
    threadId: firstString(value, "threadId", "thread_id"),
    eventId: firstString(value, "eventId", "event_id"),
    responseEventId: firstString(value, "responseEventId", "response_event_id"),
    createdAt: toIsoTimestamp(
      value.createdAt ?? value.created_at,
      fallbackTime,
    ),
    updatedAt: toIsoTimestamp(
      value.updatedAt ?? value.updated_at,
      fallbackTime,
    ),
    isSample: asBoolean(value.isSample ?? value.is_sample) || undefined,
  };
}

function normalizeAttention(
  value: unknown,
  fallbackTime: string,
): AttentionItem | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = firstString(value, "id");
  const title = firstString(value, "title");
  if (!id || !title) {
    return undefined;
  }
  return {
    id,
    kind: enumValue(value.kind, ATTENTION_KINDS, "blocked"),
    severity: enumValue(value.severity, ATTENTION_SEVERITIES, "warning"),
    title,
    detail: firstString(value, "detail", "description") ?? "",
    projectId: firstString(value, "projectId", "project_id"),
    missionId: firstString(value, "missionId", "mission_id"),
    dispatchId: firstString(value, "dispatchId", "dispatch_id"),
    createdAt: toIsoTimestamp(
      value.createdAt ?? value.created_at,
      fallbackTime,
    ),
    resolvedAt:
      value.resolvedAt || value.resolved_at
        ? toIsoTimestamp(value.resolvedAt ?? value.resolved_at)
        : undefined,
    isSample: asBoolean(value.isSample ?? value.is_sample) || undefined,
  };
}

function objectArray(
  record: JsonRecord,
  camel: string,
  snake?: string,
): unknown[] {
  const value = record[camel] ?? (snake ? record[snake] : undefined);
  return Array.isArray(value) ? value : [];
}

export function normalizeCockpitState(input: unknown): CockpitState {
  let parsed = parseJsonPayload(input);
  if (isRecord(parsed) && isRecord(parsed.data)) {
    parsed = parsed.data;
  }
  if (!isRecord(parsed)) {
    return createEmptyState();
  }
  const updatedAt = toIsoTimestamp(
    parsed.updatedAt ?? parsed.updated_at,
    new Date().toISOString(),
  );
  const projects = objectArray(parsed, "projects").flatMap((value) => {
    const normalized = normalizeProject(value, updatedAt);
    return normalized ? [normalized] : [];
  });
  const missions = objectArray(parsed, "missions").flatMap((value) => {
    const normalized = normalizeMission(value, updatedAt);
    return normalized ? [normalized] : [];
  });
  const dispatches = objectArray(parsed, "dispatches").flatMap((value) => {
    const normalized = normalizeDispatch(value, updatedAt);
    return normalized ? [normalized] : [];
  });
  const agents = normalizeAgentsResponse(objectArray(parsed, "agents"));
  const attention = objectArray(parsed, "attention").flatMap((value) => {
    const normalized = normalizeAttention(value, updatedAt);
    return normalized ? [normalized] : [];
  });
  const messages = normalizeMessagesResponse(objectArray(parsed, "messages"));

  return {
    version: 1,
    starter: asBoolean(parsed.starter) ?? false,
    updatedAt,
    projects,
    missions,
    dispatches,
    agents,
    attention,
    messages,
  };
}
