import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Download,
  File,
  Film,
  GitBranch,
  Image as ImageIcon,
  MessageSquareText,
  Radio,
  Reply,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  detectExplicitHandoff,
  type AgentSummary,
  type Message,
} from "../domain";
import { compactId, formatClock } from "./format";
import {
  Avatar,
  EmptyState,
  InternalLink,
  StateBadge,
  type Tone,
} from "./primitives";

export interface TimelineAttachment {
  name: string;
  url?: string;
  thumbnailUrl?: string;
  mimeType?: string;
  size?: number;
  dimensions?: string;
}

export interface TimelineMention {
  pubkey: string;
  name: string;
  avatarUrl?: string;
}

export interface TimelineEntry {
  id: string;
  authorPubkey?: string;
  authorName: string;
  authorLabel?: string;
  avatarUrl?: string;
  content: string;
  createdAt?: string;
  eventId?: string;
  threadId?: string;
  replyToId?: string;
  contextLabel?: string;
  contextHref?: string;
  role?: "isa" | "agent" | "system" | "participant";
  status?: "sent" | "accepted" | "working" | "responded";
  mentions?: TimelineMention[];
  handoffTargetPubkeys?: string[];
  attachments?: TimelineAttachment[];
}

const statusLabels: Record<NonNullable<TimelineEntry["status"]>, string> = {
  sent: "Enviado",
  accepted: "Relay aceitou",
  working: "Trabalhando",
  responded: "Resposta real",
};

const statusTones: Record<NonNullable<TimelineEntry["status"]>, Tone> = {
  sent: "neutral",
  accepted: "violet",
  working: "amber",
  responded: "mint",
};

function markdownImageRegex() {
  return /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
}

const CONTENT_ADDRESSED_MEDIA_RE = /^\/media\/([0-9a-f]{64}\.[a-z0-9]{1,8})$/i;

/**
 * Relay media is read through the authenticated Buzz CLI. Everything else
 * keeps its original URL, so normal web links never become proxy requests.
 */
export function cockpitMediaUrl(value?: string): string | undefined {
  if (!value) return value;
  try {
    const parsed = new URL(value, "http://cockpit.local");
    const match = parsed.pathname.match(CONTENT_ADDRESSED_MEDIA_RE);
    return match ? `/api/media/${match[1].toLowerCase()}` : value;
  } catch {
    return value;
  }
}

function markdownImages(content: string): TimelineAttachment[] {
  return [...content.matchAll(markdownImageRegex())].map((match, index) => ({
    name: match[1]?.trim() || `Imagem ${index + 1}`,
    url: cockpitMediaUrl(match[2]),
    mimeType: "image/*",
  }));
}

function withoutMarkdownImages(content: string): string {
  return content
    .replace(markdownImageRegex(), "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isImageAttachment(attachment: TimelineAttachment): boolean {
  return (
    attachment.mimeType?.startsWith("image/") === true ||
    /\.(?:avif|gif|jpe?g|png|webp)(?:\?|$)/i.test(attachment.url ?? "")
  );
}

function isVideoAttachment(attachment: TimelineAttachment): boolean {
  return (
    attachment.mimeType?.startsWith("video/") === true ||
    /\.(?:mov|mp4|webm)(?:\?|$)/i.test(attachment.url ?? "")
  );
}

function mediaForEntry(entry: TimelineEntry): TimelineAttachment[] {
  const seen = new Set<string>();
  return [
    ...(entry.attachments ?? []),
    ...markdownImages(entry.content),
  ].filter((attachment) => {
    const key = attachment.url ?? `${attachment.name}:${attachment.size ?? 0}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function timelineEntryHasMedia(entry: TimelineEntry): boolean {
  return mediaForEntry(entry).length > 0;
}

export function messagesToTimelineEntries(
  messages: Message[],
  agents: AgentSummary[],
): TimelineEntry[] {
  const agentsByPubkey = new Map(
    agents.flatMap((agent) => [
      [agent.pubkey, agent] as const,
      [agent.id, agent] as const,
    ]),
  );
  const ownerPubkeys = new Set(
    messages.flatMap((message) =>
      message.tags
        .filter((tag) => tag[0] === "auth" && tag[1])
        .map((tag) => tag[1]),
    ),
  );

  return [...messages]
    .sort(
      (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
    )
    .map((message) => {
      const agent = agentsByPubkey.get(message.authorPubkey);
      const isOwnerMessage =
        message.isMine || ownerPubkeys.has(message.authorPubkey);
      const mentionPubkeys = [
        ...new Set(
          message.tags
            .filter((tag) => tag[0] === "p" && tag[1])
            .map((tag) => tag[1]),
        ),
      ];
      const mentions = mentionPubkeys.map((pubkey) => {
        const target = agentsByPubkey.get(pubkey);
        return {
          pubkey,
          name:
            target?.name ??
            (ownerPubkeys.has(pubkey) ? "RJ" : `Agente ${compactId(pubkey)}`),
          avatarUrl: target?.avatarUrl,
        };
      });
      const handoff = detectExplicitHandoff(message);

      return {
        id: message.id,
        authorPubkey: message.authorPubkey,
        authorName: isOwnerMessage
          ? "Isa"
          : (agent?.name ?? message.authorName),
        authorLabel: isOwnerMessage
          ? "Orquestradora"
          : (agent?.role ?? "Participante"),
        avatarUrl: cockpitMediaUrl(agent?.avatarUrl),
        content: message.content,
        createdAt: message.createdAt,
        eventId: message.id,
        threadId: message.rootId ?? message.threadId,
        replyToId: message.replyToId,
        role: isOwnerMessage ? "isa" : agent ? "agent" : "participant",
        status: isOwnerMessage ? "accepted" : agent ? "responded" : undefined,
        mentions,
        handoffTargetPubkeys: handoff.isExplicit ? handoff.targetPubkeys : [],
        attachments: message.attachments.map((attachment) => ({
          name: attachment.name,
          url: cockpitMediaUrl(attachment.url),
          thumbnailUrl: cockpitMediaUrl(attachment.thumbnailUrl),
          mimeType: attachment.mimeType,
          size: attachment.size,
          dimensions: attachment.dimensions,
        })),
      } satisfies TimelineEntry;
    });
}

function formatBytes(value?: number): string | undefined {
  if (!value || value < 1) return undefined;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function TimelineStatus({
  status,
}: {
  status: NonNullable<TimelineEntry["status"]>;
}) {
  return (
    <StateBadge tone={statusTones[status]}>
      {status === "working" ? (
        <Radio size={11} aria-hidden="true" />
      ) : status === "responded" ? (
        <CheckCheck size={11} aria-hidden="true" />
      ) : null}
      {statusLabels[status]}
    </StateBadge>
  );
}

function MediaGallery({ entry }: { entry: TimelineEntry }) {
  const media = useMemo(() => mediaForEntry(entry), [entry]);
  const visualMedia = media.filter(
    (attachment) =>
      attachment.url &&
      (isImageAttachment(attachment) || isVideoAttachment(attachment)),
  );
  const imageMedia = visualMedia.filter(isImageAttachment);
  const files = media.filter(
    (attachment) =>
      !attachment.url ||
      (!isImageAttachment(attachment) && !isVideoAttachment(attachment)),
  );
  const [selectedIndex, setSelectedIndex] = useState<number>();
  const selected =
    selectedIndex === undefined ? undefined : imageMedia[selectedIndex];
  const activeIndex = selectedIndex ?? 0;

  useEffect(() => {
    if (selectedIndex === undefined) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedIndex(undefined);
      if (event.key === "ArrowRight") {
        setSelectedIndex((current) =>
          current === undefined ? current : (current + 1) % imageMedia.length,
        );
      }
      if (event.key === "ArrowLeft") {
        setSelectedIndex((current) =>
          current === undefined
            ? current
            : (current - 1 + imageMedia.length) % imageMedia.length,
        );
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [imageMedia.length, selectedIndex]);

  if (media.length === 0) return null;

  return (
    <>
      {visualMedia.length > 0 ? (
        <fieldset
          className={`media-grid media-grid--${Math.min(visualMedia.length, 3)}`}
          aria-label="Mídia produzida nesta mensagem"
        >
          {visualMedia.map((attachment) =>
            isVideoAttachment(attachment) ? (
              <figure
                className="media-card media-card--video"
                key={attachment.url}
              >
                {/* Buzz media metadata does not expose a captions track to the cockpit. */}
                {/* biome-ignore lint/a11y/useMediaCaption: preserve the original Buzz video with its native controls when no captions asset exists */}
                <video
                  controls
                  preload="metadata"
                  poster={attachment.thumbnailUrl}
                  src={attachment.url}
                />
                <figcaption>
                  <Film size={13} aria-hidden="true" /> {attachment.name}
                </figcaption>
              </figure>
            ) : (
              <button
                className="media-card"
                type="button"
                aria-label={`Abrir ${attachment.name}`}
                onClick={() =>
                  setSelectedIndex(
                    imageMedia.findIndex(
                      (candidate) => candidate.url === attachment.url,
                    ),
                  )
                }
                key={attachment.url}
              >
                <img
                  src={attachment.thumbnailUrl ?? attachment.url}
                  alt={attachment.name}
                  loading="lazy"
                />
                <span className="media-card__caption">
                  <ImageIcon size={13} aria-hidden="true" />
                  <span>{attachment.name}</span>
                  {attachment.dimensions ? (
                    <small>{attachment.dimensions}</small>
                  ) : null}
                </span>
              </button>
            ),
          )}
        </fieldset>
      ) : null}

      {files.length > 0 ? (
        <ul
          className="timeline-entry__attachments"
          aria-label="Arquivos anexados"
        >
          {files.map((attachment) => (
            <li key={`${entry.id}-${attachment.url ?? attachment.name}`}>
              {attachment.url ? (
                <a href={attachment.url} target="_blank" rel="noreferrer">
                  <File size={14} aria-hidden="true" />
                  {attachment.name}
                  {formatBytes(attachment.size) ? (
                    <small>{formatBytes(attachment.size)}</small>
                  ) : null}
                </a>
              ) : (
                <span>
                  <File size={14} aria-hidden="true" /> {attachment.name}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {selected?.url && isImageAttachment(selected) ? (
        <div
          className="media-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`Visualização de ${selected.name}`}
        >
          <button
            className="media-lightbox__backdrop"
            type="button"
            aria-label="Fechar visualização da imagem"
            onClick={() => setSelectedIndex(undefined)}
          />
          <div className="media-lightbox__stage">
            <header>
              <div>
                <strong>{selected.name}</strong>
                <span>
                  {[selected.dimensions, formatBytes(selected.size)]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              <a
                href={selected.url}
                target="_blank"
                rel="noreferrer"
                aria-label="Abrir imagem original"
              >
                <Download size={16} aria-hidden="true" />
              </a>
              <button
                type="button"
                aria-label="Fechar imagem"
                onClick={() => setSelectedIndex(undefined)}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>
            <img src={selected.url} alt={selected.name} />
            {imageMedia.length > 1 ? (
              <>
                <button
                  className="media-lightbox__nav media-lightbox__nav--previous"
                  type="button"
                  aria-label="Imagem anterior"
                  onClick={() =>
                    setSelectedIndex(
                      (activeIndex - 1 + imageMedia.length) % imageMedia.length,
                    )
                  }
                >
                  <ChevronLeft size={20} aria-hidden="true" />
                </button>
                <button
                  className="media-lightbox__nav media-lightbox__nav--next"
                  type="button"
                  aria-label="Próxima imagem"
                  onClick={() =>
                    setSelectedIndex((activeIndex + 1) % imageMedia.length)
                  }
                >
                  <ChevronRight size={20} aria-hidden="true" />
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

function MentionStrip({ entry }: { entry: TimelineEntry }) {
  if (!entry.mentions || entry.mentions.length === 0) return null;
  const handoffs = new Set(entry.handoffTargetPubkeys ?? []);
  return (
    <fieldset className="mention-strip" aria-label="Menções nesta mensagem">
      {entry.mentions.map((mention) => {
        const isHandoff = handoffs.has(mention.pubkey);
        return (
          <span
            className={isHandoff ? "mention-chip is-handoff" : "mention-chip"}
            key={mention.pubkey}
          >
            {isHandoff ? (
              <GitBranch size={12} aria-hidden="true" />
            ) : (
              <span aria-hidden="true">@</span>
            )}
            <span>{isHandoff ? "Handoff proposto" : "Mencionou"}</span>
            <strong>{mention.name}</strong>
          </span>
        );
      })}
    </fieldset>
  );
}

export function Timeline({
  entries,
  order = "oldest",
}: {
  entries: TimelineEntry[];
  order?: "oldest" | "newest";
}) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title="Nenhuma fala neste recorte"
        description="Limpe o filtro ou vincule uma thread real do Buzz a esta missão."
      />
    );
  }

  const visibleEntries = order === "newest" ? [...entries].reverse() : entries;

  return (
    <ol className="timeline" aria-label="Conversa da missão">
      {visibleEntries.map((entry) => {
        const readableContent = withoutMarkdownImages(entry.content);
        return (
          <li
            className={`timeline-entry timeline-entry--${entry.role ?? "agent"}`}
            key={entry.id}
          >
            <div className="timeline-entry__avatar">
              {entry.role === "system" ? (
                <span className="avatar avatar--system" aria-hidden="true">
                  <MessageSquareText size={15} />
                </span>
              ) : (
                <Avatar
                  name={entry.authorName}
                  imageUrl={entry.avatarUrl}
                  tone={entry.role === "isa" ? "ink" : "violet"}
                />
              )}
            </div>
            <article className="timeline-entry__body">
              <header className="timeline-entry__header">
                <div>
                  <strong>{entry.authorName}</strong>
                  {entry.authorLabel ? <span>{entry.authorLabel}</span> : null}
                </div>
                <time dateTime={entry.createdAt}>
                  {formatClock(entry.createdAt)}
                </time>
              </header>
              {entry.contextLabel ? (
                <div className="timeline-entry__context">
                  {entry.contextHref ? (
                    <InternalLink href={entry.contextHref}>
                      {entry.contextLabel}
                    </InternalLink>
                  ) : (
                    <span>{entry.contextLabel}</span>
                  )}
                </div>
              ) : null}
              {readableContent ? (
                <div className="markdown-body">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ children, ...props }) => (
                        <a {...props} target="_blank" rel="noreferrer">
                          {children}
                        </a>
                      ),
                    }}
                  >
                    {readableContent}
                  </ReactMarkdown>
                </div>
              ) : null}
              <MediaGallery entry={entry} />
              <MentionStrip entry={entry} />
              <footer className="timeline-entry__footer">
                {entry.status ? <TimelineStatus status={entry.status} /> : null}
                {entry.replyToId ? (
                  <span className="thread-reference" title={entry.replyToId}>
                    <Reply size={11} aria-hidden="true" /> respondeu a #
                    {compactId(entry.replyToId)}
                  </span>
                ) : null}
                {entry.threadId ? (
                  <span className="thread-reference" title={entry.threadId}>
                    Thread #{compactId(entry.threadId)}
                  </span>
                ) : null}
                {entry.eventId ? (
                  <span className="event-id" title={entry.eventId}>
                    evento #{compactId(entry.eventId)}
                  </span>
                ) : null}
              </footer>
            </article>
          </li>
        );
      })}
    </ol>
  );
}

export function ConversationHeading({
  count,
  total,
  label = "Conversa",
}: {
  count: number;
  total?: number;
  label?: string;
}) {
  return (
    <div className="conversation-heading">
      <div>
        <Bot size={16} aria-hidden="true" />
        <span>{label}</span>
      </div>
      <span>
        {total !== undefined && total !== count
          ? `${count} de ${total}`
          : count}{" "}
        {count === 1 ? "fala" : "falas"}
      </span>
    </div>
  );
}
