export type MissionStatus =
  | "draft"
  | "running"
  | "paused"
  | "awaiting_rj"
  | "completed"
  | "blocked";

export type DispatchReceiptStatus =
  | "planned"
  | "sent"
  | "relay_accepted"
  | "working"
  | "response_received"
  | "handoff_proposed"
  | "handed_off"
  | "incorporated"
  | "completed"
  | "blocked"
  | "timed_out";

export type AgentPresence = "online" | "away" | "offline" | "unknown";

export type AgentActivity = "working" | "idle" | "unknown";

export type AttentionKind =
  | "timeout"
  | "blocked"
  | "decision"
  | "handoff"
  | "relay"
  | "oauth";

export type AttentionSeverity = "info" | "warning" | "critical";

export interface MissionLimits {
  initialSpecialists: number;
  maxSpecialists: number;
  maxChildrenPerResponse: number;
  maxHandoffDepth: number;
  maxCriticCycles: number;
  maxDispatches: number;
  maxRetriesPerDispatch: number;
  maxNoNoveltyRounds: number;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  color: string;
  missionIds: string[];
  createdAt: string;
  updatedAt: string;
  isSample?: boolean;
}

export interface MissionConversationRef {
  id: string;
  channelId: string;
  rootEventId?: string;
  label?: string;
  agentIds: string[];
  linkedAt: string;
  dispatchId?: string;
}

export interface Mission {
  id: string;
  projectId: string;
  title: string;
  objective: string;
  brief: string;
  status: MissionStatus;
  channelId?: string;
  threadIds: string[];
  conversationRefs?: MissionConversationRef[];
  agentIds: string[];
  dispatchIds: string[];
  limits: MissionLimits;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  isSample?: boolean;
}

export interface DispatchReceipt {
  status: DispatchReceiptStatus;
  at: string;
  eventId?: string;
  note?: string;
  targetAgentIds?: string[];
}

export interface Dispatch {
  id: string;
  missionId: string;
  agentId: string;
  agentName: string;
  prompt: string;
  status: DispatchReceiptStatus;
  receipts: DispatchReceipt[];
  depth: number;
  criticCycle: number;
  retryCount: number;
  proposedAgentIds: string[];
  parentDispatchId?: string;
  channelId?: string;
  threadId?: string;
  eventId?: string;
  responseEventId?: string;
  createdAt: string;
  updatedAt: string;
  isSample?: boolean;
}

export interface AgentSummary {
  id: string;
  pubkey: string;
  name: string;
  role: string;
  persona?: string;
  avatarUrl?: string;
  presence: AgentPresence;
  activity: AgentActivity;
  model?: string;
  currentProjectId?: string;
  currentMissionId?: string;
  lastActivityAt?: string;
  lastResponseAt?: string;
  statusUpdatedAt?: string;
  isSample?: boolean;
}

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  severity: AttentionSeverity;
  title: string;
  detail: string;
  projectId?: string;
  missionId?: string;
  dispatchId?: string;
  createdAt: string;
  resolvedAt?: string;
  isSample?: boolean;
}

export interface AttachmentSummary {
  id: string;
  name: string;
  url?: string;
  thumbnailUrl?: string;
  mimeType?: string;
  size?: number;
  sha256?: string;
  dimensions?: string;
}

export interface Message {
  id: string;
  channelId: string;
  content: string;
  authorPubkey: string;
  authorName: string;
  createdAt: string;
  kind: number;
  tags: string[][];
  attachments: AttachmentSummary[];
  threadId?: string;
  rootId?: string;
  replyToId?: string;
  isMine?: boolean;
  isSample?: boolean;
}

export interface ChannelSummary {
  id: string;
  name: string;
  type?: string;
  visibility?: string;
  archived: boolean;
  about?: string;
  topic?: string;
  purpose?: string;
}

export interface ChannelMember {
  pubkey: string;
  role: string;
}

export interface CliWriteReceipt {
  eventId?: string;
  accepted: boolean;
  message: string;
  requestId?: string;
  saved?: boolean;
}

export interface CockpitState {
  version: 1;
  starter: boolean;
  updatedAt: string;
  projects: Project[];
  missions: Mission[];
  dispatches: Dispatch[];
  agents: AgentSummary[];
  attention: AttentionItem[];
  messages: Message[];
}

export interface HandoffDetection {
  isExplicit: boolean;
  marker?: string;
  targetPubkeys: string[];
}
