import {
  AlertCircle,
  ArrowDown,
  Check,
  CheckCheck,
  Clock3,
  GitBranch,
  Lightbulb,
  Radio,
  Send,
} from "lucide-react";
import { formatRelativeTime } from "./format";
import { EmptyState, StateBadge, type Tone } from "./primitives";

export type DispatchStage =
  | "planned"
  | "sent"
  | "accepted"
  | "working"
  | "responded"
  | "proposed"
  | "handed_off"
  | "incorporated"
  | "completed"
  | "blocked";

export interface DispatchSpineItem {
  id: string;
  actor: string;
  target?: string;
  summary?: string;
  stage: DispatchStage;
  timestamp?: string;
  branchLabel?: string;
}

const stageMeta: Record<DispatchStage, { label: string; tone: Tone }> = {
  planned: { label: "Planejado", tone: "neutral" },
  sent: { label: "Enviado", tone: "neutral" },
  accepted: { label: "Relay aceitou", tone: "violet" },
  working: { label: "Trabalhando", tone: "amber" },
  responded: { label: "Resposta recebida", tone: "mint" },
  proposed: { label: "Próximo agente proposto", tone: "amber" },
  handed_off: { label: "Handoff realizado", tone: "violet" },
  incorporated: { label: "Incorporado", tone: "mint" },
  completed: { label: "Concluído", tone: "mint" },
  blocked: { label: "Bloqueado", tone: "danger" },
};

function StageIcon({ stage }: { stage: DispatchStage }) {
  if (stage === "sent") return <Send size={13} />;
  if (stage === "accepted") return <Check size={13} />;
  if (stage === "working") return <Radio size={13} />;
  if (stage === "responded") return <CheckCheck size={13} />;
  if (stage === "proposed") return <Lightbulb size={13} />;
  if (stage === "handed_off") return <GitBranch size={13} />;
  if (stage === "incorporated" || stage === "completed")
    return <CheckCheck size={13} />;
  if (stage === "blocked") return <AlertCircle size={13} />;
  return <Clock3 size={13} />;
}

export function DispatchSpine({ items }: { items: DispatchSpineItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="Nenhum dispatch"
        description="A Chain ganha uma etapa quando a Isa envia o primeiro brief a um especialista."
      />
    );
  }

  return (
    <ol className="dispatch-spine" aria-label="Chain da missão">
      {items.map((item, index) => {
        const meta = stageMeta[item.stage];
        return (
          <li
            className={`dispatch-step dispatch-step--${meta.tone}`}
            key={item.id}
          >
            <span className="dispatch-step__node" aria-hidden="true">
              <StageIcon stage={item.stage} />
            </span>
            <div className="dispatch-step__content">
              {item.branchLabel ? (
                <span className="dispatch-step__branch">
                  <GitBranch size={11} aria-hidden="true" />
                  {item.branchLabel}
                </span>
              ) : null}
              <div className="dispatch-step__route">
                <strong>{item.actor}</strong>
                {item.target ? (
                  <>
                    <ArrowDown size={13} aria-hidden="true" />
                    <strong>{item.target}</strong>
                  </>
                ) : null}
              </div>
              {item.summary ? <p>{item.summary}</p> : null}
              <div className="dispatch-step__meta">
                <StateBadge tone={meta.tone}>{meta.label}</StateBadge>
                <time dateTime={item.timestamp}>
                  {formatRelativeTime(item.timestamp)}
                </time>
              </div>
            </div>
            {index < items.length - 1 ? (
              <span className="dispatch-step__connector" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
