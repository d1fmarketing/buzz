import type { Message } from "../domain";

const ORLA_PUBKEY =
  "1ee579145add2761f00559a70c01ccf4b7e2185c5e11836157872ac59e040f44";
const LEDGER_HEADER = /^\s*(?:#{1,6}\s*)?(?:\*\*)?ledger(?:\s|[—:.-])/iu;
const RECONCILIATION_HEADER =
  /^\s*(?:#{1,6}\s*)?(?:\*\*)?reconcilia(?:ção|cao)(?:\s|[—:.-])/iu;
const SUPERSEDED_CONTROL =
  /\b(?:o\s+)?pedido anterior foi supersed(?:e|ed)\b/iu;
const SUPERSEDED_CONTROL_ACTION = /\b(?:ignore|nenhuma ação adicional)\b/iu;
const RECONCILIATION_RECEIPT =
  /\bsupersed(?:e|ed)\b[\s\S]*\b(?:recibos preliminares|despacho)\b/iu;
const LANE_TRACKING_HEADER = /^\s*tracking da lane\b/iu;
const LANE_TRACKING_DETAIL = /\b(?:estado honesto|limite de espera)\b/iu;
const LEDGER_CLOSE =
  /\b(?:fechada no ledger|volta ao meu ledger|delivered_to_RJ)\b/iu;
const LEDGER_CLOSE_DETAIL =
  /\b(?:estado\s*:|recibo|ambas as camadas entregues)\b/iu;
const READBACK_ONLY =
  /^\s*@Orla[\s\S]{0,140}?leitura integral conclu[ií]da\s*:\s*\*\*\d+\/\d+(?: eventos)?\*\*/iu;
const TECHNICAL_AUDIT_HEADER =
  /^\s*(?:#{1,6}\s*)?(?:OK FINAL de proveni[eê]ncia|Readback de proveni[eê]ncia|Chave de proveni[eê]ncia|Gate de fechamento(?: de Vale)?\s*[—-])/iu;
const TECHNICAL_AUDIT_DETAIL =
  /\b(?:SH-BLUEPRINT|proveni[eê]ncia|artefato real|manifest|hash|readback)\b/iu;
const SEQUENCE_CORRECTION =
  /^\s*@Clio[\s\S]{0,180}?condi(?:ç|c)[aã]o vinculante satisfeita[\s\S]{0,260}?\b(?:erratum|sequ[eê]ncia)\b/iu;
const INTERNAL_PATH = /\b(?:OUTBOX|PLANS)\//iu;
const INTERNAL_PATH_TOKEN = /`?(?:OUTBOX|PLANS)\/[\p{L}\p{N}_.\-/]*`?/giu;
const PATH_ONLY_LINE =
  /^\s*(?:[-*]\s*)?(?:\*\*)?(?:artefato|arquivo|destino|path|outbox|salvo em|saved at)(?:\*\*)?\s*:/iu;

function isInternalProtocol(message: Message): boolean {
  const content = message.content.trim();
  if (
    !content ||
    message.isMine ||
    message.attachments.length > 0 ||
    message.tags.some((tag) => tag[0] === "imeta")
  ) {
    return false;
  }
  if (READBACK_ONLY.test(content)) return true;
  if (
    (TECHNICAL_AUDIT_HEADER.test(content) &&
      TECHNICAL_AUDIT_DETAIL.test(content)) ||
    SEQUENCE_CORRECTION.test(content)
  ) {
    return true;
  }
  if (message.authorPubkey !== ORLA_PUBKEY) return false;
  if (LEDGER_HEADER.test(content)) {
    return true;
  }
  if (
    SUPERSEDED_CONTROL.test(content) &&
    SUPERSEDED_CONTROL_ACTION.test(content)
  ) {
    return true;
  }
  if (
    RECONCILIATION_HEADER.test(content) &&
    RECONCILIATION_RECEIPT.test(content)
  ) {
    return true;
  }
  if (
    LANE_TRACKING_HEADER.test(content) &&
    LANE_TRACKING_DETAIL.test(content)
  ) {
    return true;
  }
  return LEDGER_CLOSE.test(content) && LEDGER_CLOSE_DETAIL.test(content);
}

function simplifyInternalReferences(content: string): string {
  const lines = content.split("\n").flatMap((line) => {
    if (INTERNAL_PATH.test(line) && PATH_ONLY_LINE.test(line)) return [];
    return [line.replace(INTERNAL_PATH_TOKEN, "arquivo interno")];
  });

  return lines
    .join("\n")
    .replace(/\bSUPERSEDED_BY(?:_[A-Z0-9_]+|\([^)]*\))?/giu, "substituído")
    .replace(/\bsupersess[aã]o(?:-com-lineage)?\b/giu, "substituição")
    .replace(/\bsupersession\b/giu, "substituição")
    .replace(/\bsuperseded\b/giu, "substituído")
    .replace(/\bsupersede\b/giu, "substitui")
    .replace(/\bsupersed[\p{L}]*/giu, "substituído")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export interface ReaderMessagePresentation {
  messages: Message[];
  hiddenProtocolCount: number;
}

/**
 * Present a human-first conversation without changing the canonical Buzz
 * events. Operator mode can continue to consume the untouched message list.
 */
export function presentMessagesForReader(
  messages: readonly Message[],
): ReaderMessagePresentation {
  let hiddenProtocolCount = 0;
  const presented = messages.flatMap((message) => {
    if (isInternalProtocol(message)) {
      hiddenProtocolCount += 1;
      return [];
    }
    const content = simplifyInternalReferences(message.content);
    if (!content && message.attachments.length === 0) {
      hiddenProtocolCount += 1;
      return [];
    }
    return [{ ...message, content }];
  });

  return { messages: presented, hiddenProtocolCount };
}
