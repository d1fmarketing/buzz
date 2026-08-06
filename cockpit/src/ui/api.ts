export interface HealthStatus {
  ok: boolean;
  cliAvailable: boolean;
  relayConfigured: boolean;
  authenticated: boolean;
}

export interface MessageAttachmentInput {
  name: string;
  data: string;
  mimeType?: string;
}

export interface SendMessageInput {
  channelId: string;
  content: string;
  replyTo?: string;
  mentions?: string[];
  attachments?: MessageAttachmentInput[];
}

export interface AgentDraftUpdateInput {
  channelId: string;
  agentName: string;
  displayName?: string;
  systemPrompt?: string;
  runtime?: string;
  provider?: string;
  model?: string;
  respondTo?: "owner-only" | "anyone";
}

interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

export class CockpitApiError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "CockpitApiError";
    this.code = code;
    this.details = details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  const payload = (await response.json().catch(() => null)) as
    | T
    | ApiErrorPayload
    | null;
  if (!response.ok) {
    const errorPayload = payload as ApiErrorPayload | null;
    throw new CockpitApiError(
      errorPayload?.error?.code ?? `HTTP_${response.status}`,
      errorPayload?.error?.message ??
        "O adaptador local não concluiu a operação.",
      errorPayload?.error?.details,
    );
  }
  return payload as T;
}

export const cockpitApi = {
  health: () => request<HealthStatus>("/api/health"),
  state: () => request<unknown>("/api/state"),
  saveState: (state: unknown) =>
    request<unknown>("/api/state", {
      method: "PUT",
      body: JSON.stringify(state),
    }),
  channels: () => request<unknown>("/api/channels"),
  channel: (channelId: string) =>
    request<unknown>(`/api/channels/${encodeURIComponent(channelId)}`),
  channelMembers: (channelId: string) =>
    request<unknown>(`/api/channels/${encodeURIComponent(channelId)}/members`),
  messages: (channelId: string, limit = 120) =>
    request<unknown>(
      `/api/channels/${encodeURIComponent(channelId)}/messages?limit=${encodeURIComponent(limit)}`,
    ),
  thread: (channelId: string, eventId: string) =>
    request<unknown>(
      `/api/channels/${encodeURIComponent(channelId)}/threads/${encodeURIComponent(eventId)}`,
    ),
  searchMessages: (input: {
    query?: string;
    author?: string;
    since?: number;
    limit?: number;
  }) => {
    const search = new URLSearchParams();
    if (input.query) search.set("query", input.query);
    if (input.author) search.set("author", input.author);
    if (input.since !== undefined) search.set("since", String(input.since));
    if (input.limit !== undefined) search.set("limit", String(input.limit));
    return request<unknown>(`/api/messages/search?${search.toString()}`);
  },
  feed: (limit = 50) =>
    request<unknown>(`/api/feed?limit=${encodeURIComponent(limit)}`),
  presence: (pubkeys: string[]) =>
    request<unknown>(
      `/api/presence?pubkeys=${encodeURIComponent(pubkeys.join(","))}`,
    ),
  agents: () => request<unknown>("/api/agents"),
  sendMessage: (input: SendMessageInput) =>
    request<unknown>("/api/messages", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  draftAgentUpdate: (input: AgentDraftUpdateInput) =>
    request<unknown>("/api/agents/draft-update", {
      method: "POST",
      body: JSON.stringify(input),
    }),
};

export async function fileToAttachment(
  file: File,
): Promise<MessageAttachmentInput> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error("Não foi possível ler o arquivo."));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
  const commaIndex = dataUrl.indexOf(",");
  return {
    name: file.name,
    data: commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl,
    mimeType: file.type || undefined,
  };
}
