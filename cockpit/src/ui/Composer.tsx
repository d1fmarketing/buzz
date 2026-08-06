import { useEffect, useId, useRef, useState } from "react";
import { AtSign, File, LoaderCircle, Paperclip, Send, X } from "lucide-react";

const BUZZ_ATTACHMENT_ACCEPT =
  "image/jpeg,image/png,image/gif,image/webp,video/mp4";
const BUZZ_ATTACHMENT_EXTENSION = /\.(?:jpe?g|png|gif|webp|mp4)$/i;
const MAX_ATTACHMENTS = 20;

function isSupportedBuzzAttachment(file: File) {
  return (
    BUZZ_ATTACHMENT_ACCEPT.split(",").includes(file.type) ||
    BUZZ_ATTACHMENT_EXTENSION.test(file.name)
  );
}

export interface ComposerAgent {
  pubkey: string;
  name: string;
  role?: string;
}

export interface ComposerSubmission {
  agentPubkey: string;
  channelId: string;
  destinationId: string;
  replyTo?: string;
  content: string;
  files: File[];
  parentDispatchId?: string;
  depth?: number;
}

export interface ComposerDestination {
  id: string;
  label: string;
  channelId: string;
  replyTo?: string;
}

export function Composer({
  agents,
  destinations,
  preferredDestinationId,
  preferredAgentPubkey,
  disabled,
  sending,
  onSend,
}: {
  agents: ComposerAgent[];
  destinations: ComposerDestination[];
  preferredDestinationId?: string;
  preferredAgentPubkey?: string;
  disabled?: boolean;
  sending?: boolean;
  onSend: (submission: ComposerSubmission) => Promise<void>;
}) {
  const [content, setContent] = useState("");
  const [agentPubkey, setAgentPubkey] = useState(agents[0]?.pubkey ?? "");
  const [destinationId, setDestinationId] = useState(destinations[0]?.id ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [localError, setLocalError] = useState<string>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaId = useId();

  useEffect(() => {
    if (
      preferredAgentPubkey &&
      agents.some((agent) => agent.pubkey === preferredAgentPubkey)
    ) {
      setAgentPubkey(preferredAgentPubkey);
      return;
    }
    if (!agents.some((agent) => agent.pubkey === agentPubkey)) {
      setAgentPubkey(agents[0]?.pubkey ?? "");
    }
  }, [agentPubkey, agents, preferredAgentPubkey]);

  useEffect(() => {
    if (
      preferredDestinationId &&
      destinations.some(
        (destination) => destination.id === preferredDestinationId,
      )
    ) {
      setDestinationId(preferredDestinationId);
      return;
    }
    if (!destinations.some((destination) => destination.id === destinationId)) {
      setDestinationId(destinations[0]?.id ?? "");
    }
  }, [destinationId, destinations, preferredDestinationId]);

  const canSend =
    Boolean(content.trim() || files.length > 0) &&
    Boolean(agentPubkey) &&
    Boolean(destinationId) &&
    !disabled &&
    !sending;

  async function submit() {
    if (!canSend) return;
    const destination = destinations.find(
      (candidate) => candidate.id === destinationId,
    );
    if (!destination) return;
    setLocalError(undefined);
    try {
      await onSend({
        agentPubkey,
        channelId: destination.channelId,
        destinationId: destination.id,
        replyTo: destination.replyTo,
        content: content.trim(),
        files,
      });
      setContent("");
      setFiles([]);
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "O envio não foi concluído.",
      );
    }
  }

  return (
    <section className="composer" aria-label="Composer da Isa">
      <div className="composer__route">
        <span>Isa envia para</span>
        <label className="agent-select">
          <AtSign size={14} aria-hidden="true" />
          <span className="sr-only">Escolher agente</span>
          <select
            value={agentPubkey}
            disabled={disabled || sending || agents.length === 0}
            onChange={(event) => setAgentPubkey(event.target.value)}
          >
            {agents.length === 0 ? (
              <option value="">Nenhum agente disponível</option>
            ) : null}
            {agents.map((agent) => (
              <option value={agent.pubkey} key={agent.pubkey}>
                {agent.name}
                {agent.role ? ` — ${agent.role}` : ""}
              </option>
            ))}
          </select>
        </label>
        <span>na conversa</span>
        <label className="destination-select">
          <span className="sr-only">Escolher conversa de destino</span>
          <select
            value={destinationId}
            disabled={disabled || sending || destinations.length === 0}
            onChange={(event) => setDestinationId(event.target.value)}
          >
            {destinations.length === 0 ? (
              <option value="">Nenhuma conversa vinculada</option>
            ) : null}
            {destinations.map((destination) => (
              <option value={destination.id} key={destination.id}>
                {destination.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="sr-only" htmlFor={textareaId}>
        Brief ou resposta
      </label>
      <textarea
        id={textareaId}
        value={content}
        disabled={disabled || sending}
        rows={4}
        placeholder="Dê contexto, defina a entrega e diga o que conta como evidência…"
        onChange={(event) => setContent(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            void submit();
          }
        }}
      />

      {files.length > 0 ? (
        <ul
          className="composer__files"
          aria-label="Arquivos preparados para envio"
        >
          {files.map((file, index) => (
            <li key={`${file.name}-${file.lastModified}`}>
              <File size={13} aria-hidden="true" />
              <span>{file.name}</span>
              <button
                type="button"
                aria-label={`Remover ${file.name}`}
                onClick={() =>
                  setFiles((current) =>
                    current.filter((_, itemIndex) => itemIndex !== index),
                  )
                }
              >
                <X size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {localError ? (
        <p className="composer__error" role="alert">
          {localError}
        </p>
      ) : null}

      <div className="composer__actions">
        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          accept={BUZZ_ATTACHMENT_ACCEPT}
          multiple
          onChange={(event) => {
            const selected = Array.from(event.target.files ?? []);
            const supported = selected.filter(isSupportedBuzzAttachment);
            const unsupported = selected.filter(
              (file) => !isSupportedBuzzAttachment(file),
            );
            const availableSlots = Math.max(0, MAX_ATTACHMENTS - files.length);
            const accepted = supported.slice(0, availableSlots);
            const excessCount = supported.length - accepted.length;

            setFiles((current) => [...current, ...accepted]);
            if (unsupported.length > 0 || excessCount > 0) {
              const reasons = [];
              if (unsupported.length > 0) {
                reasons.push(
                  `formato não aceito: ${unsupported.map((file) => file.name).join(", ")}`,
                );
              }
              if (excessCount > 0) {
                reasons.push(`limite de ${MAX_ATTACHMENTS} anexos por envio`);
              }
              setLocalError(
                `O Buzz envia JPEG, PNG, GIF, WebP e MP4; ${reasons.join("; ")}.`,
              );
            } else {
              setLocalError(undefined);
            }
            event.target.value = "";
          }}
        />
        <button
          className="icon-button icon-button--label"
          type="button"
          disabled={disabled || sending}
          title="JPEG, PNG, GIF, WebP ou MP4"
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip size={15} aria-hidden="true" />
          Anexar
        </button>
        <span className="composer__hint">⌘ Enter para enviar</span>
        <button
          className="button button--violet"
          type="button"
          disabled={!canSend}
          onClick={() => void submit()}
        >
          {sending ? (
            <LoaderCircle className="spin" size={15} aria-hidden="true" />
          ) : (
            <Send size={15} aria-hidden="true" />
          )}
          {sending ? "Enviando" : "Enviar dispatch"}
        </button>
      </div>
    </section>
  );
}
