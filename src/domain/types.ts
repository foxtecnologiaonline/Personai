import type { Logger } from "../logger.js";
import type { MemoryApi } from "../memory/types.js";

export const PRODUCT_IDS = ["sales-agent", "monneyhub-zap", "normas-ia", "personai"] as const;
export type ProductId = (typeof PRODUCT_IDS)[number];

/** Produto que recebe o que não cai em nenhum outro (assistente geral). */
export const DEFAULT_PRODUCT: ProductId = "personai";

export type MessageKind = "text" | "interactive" | "unsupported";

/** Mensagem recém-extraída do webhook, antes de resolver o tenant. */
export interface InboundMessage {
  messageId: string;
  phoneNumberId: string;
  /** Telefone do usuário no WhatsApp. É dado pessoal: usar para responder, nunca persistir. */
  waId: string;
  text: string;
  kind: MessageKind;
  rawType: string;
  timestamp: Date;
  profileName?: string;
}

/** O que o gateway entrega a qualquer handler de produto. */
export interface NormalizedMessage extends InboundMessage {
  tenantId: string;
  /** Pseudônimo estável do usuário — é isto que os produtos persistem. */
  userRef: string;
}

export interface HandlerReply {
  text: string;
  /** Para respostas que não devem gerar novo registro de memória (ex.: exclusão a pedido). */
  skipMemory?: boolean;
}

export interface HandlerContext {
  memory: MemoryApi;
  logger: Logger;
}

/**
 * Interface comum da Camada A: o gateway recebe, autentica, enfileira, roteia e
 * responde. Cada produto implementa só isto.
 */
export interface ProductHandler {
  readonly product: ProductId;
  handle(message: NormalizedMessage, ctx: HandlerContext): Promise<HandlerReply | null>;
}
