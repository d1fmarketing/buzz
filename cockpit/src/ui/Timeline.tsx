import { Bot, CheckCheck, File, MessageSquareText, Radio } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { compactId, formatClock } from "./format";
import { Avatar, EmptyState, StateBadge, type Tone } from "./primitives";

export interface TimelineAttachment {
  name: string;
  url?: string;
}

export interface TimelineEntry {
  id: string;
  authorName: string;
  authorLabel?: string;
  avatarUrl?: string;
  content: string;
  createdAt?: string;
  eventId?: string;
  role?: "isa" | "agent" | "system";
  status?: "sent" | "accepted" | "working" | "responded";
  attachments?: TimelineAttachment[];
}

const statusLabels: Record<NonNullable<TimelineEntry["status"]>, string> = {
  sent: "Enviado",
  accepted: "Relay aceitou",
  working: "Trabalhando",
  responded: "Resposta recebida",
};

const statusTones: Record<NonNullable<TimelineEntry["status"]>, Tone> = {
  sent: "neutral",
  accepted: "violet",
  working: "amber",
  responded: "mint",
};

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

export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title="A conversa começa aqui"
        description="Envie o primeiro brief no modo Operator ou vincule uma thread que já existe no Buzz."
      />
    );
  }

  return (
    <ol className="timeline" aria-label="Conversa da missão">
      {entries.map((entry) => (
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
            <div className="markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {entry.content}
              </ReactMarkdown>
            </div>
            {entry.attachments && entry.attachments.length > 0 ? (
              <ul
                className="timeline-entry__attachments"
                aria-label="Arquivos anexados"
              >
                {entry.attachments.map((attachment) => (
                  <li key={`${entry.id}-${attachment.name}`}>
                    {attachment.url ? (
                      <a href={attachment.url} target="_blank" rel="noreferrer">
                        <File size={14} aria-hidden="true" />
                        {attachment.name}
                      </a>
                    ) : (
                      <span>
                        <File size={14} aria-hidden="true" />
                        {attachment.name}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
            <footer className="timeline-entry__footer">
              {entry.status ? <TimelineStatus status={entry.status} /> : null}
              {entry.eventId ? (
                <span className="event-id" title={entry.eventId}>
                  #{compactId(entry.eventId)}
                </span>
              ) : null}
            </footer>
          </article>
        </li>
      ))}
    </ol>
  );
}

export function ConversationHeading({ count }: { count: number }) {
  return (
    <div className="conversation-heading">
      <div>
        <Bot size={16} aria-hidden="true" />
        <span>Conversa</span>
      </div>
      <span>
        {count} {count === 1 ? "entrada" : "entradas"}
      </span>
    </div>
  );
}
