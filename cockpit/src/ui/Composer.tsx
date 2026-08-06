import { useEffect, useId, useRef, useState } from "react";
import { AtSign, File, LoaderCircle, Paperclip, Send, X } from "lucide-react";

export interface ComposerAgent {
  pubkey: string;
  name: string;
  role?: string;
}

export interface ComposerSubmission {
  agentPubkey: string;
  content: string;
  files: File[];
  parentDispatchId?: string;
  depth?: number;
}

export function Composer({
  agents,
  destination,
  preferredAgentPubkey,
  disabled,
  sending,
  onSend,
}: {
  agents: ComposerAgent[];
  destination?: string;
  preferredAgentPubkey?: string;
  disabled?: boolean;
  sending?: boolean;
  onSend: (submission: ComposerSubmission) => Promise<void>;
}) {
  const [content, setContent] = useState("");
  const [agentPubkey, setAgentPubkey] = useState(agents[0]?.pubkey ?? "");
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

  const canSend =
    Boolean(content.trim() || files.length > 0) &&
    Boolean(agentPubkey) &&
    !disabled &&
    !sending;

  async function submit() {
    if (!canSend) return;
    setLocalError(undefined);
    try {
      await onSend({ agentPubkey, content: content.trim(), files });
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
        {destination ? (
          <span className="composer__destination">em {destination}</span>
        ) : null}
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
          multiple
          onChange={(event) => {
            setFiles((current) => [
              ...current,
              ...Array.from(event.target.files ?? []),
            ]);
            event.target.value = "";
          }}
        />
        <button
          className="icon-button icon-button--label"
          type="button"
          disabled={disabled || sending}
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
