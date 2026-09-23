import type { ProductId } from "../domain/types.js";
import {
  GENERAL_COMMAND_PATTERN,
  MEMORY_COMMAND_PATTERN,
  matchProductByRules,
} from "../router/classifier.js";

export type PersonAiTarget =
  | { kind: "forget-memory" }
  | { kind: "product"; product: ProductId }
  | { kind: "general" };

export interface PersonAiRoute {
  target: PersonAiTarget;
  reason: string;
}

/**
 * Roteamento secundário, dentro do PersonAI: a mensagem é um pedido de
 * exclusão, uma pergunta sobre produto FOX (que vai para a API interna do
 * produto) ou uma pergunta aberta (que vai para a busca fundamentada).
 *
 * Determinístico de propósito: é decisão de despacho em caminho quente, e o
 * custo de errar para "general" é baixo — o assistente responde mesmo assim.
 */
export function routePersonAiIntent(text: string): PersonAiRoute {
  if (MEMORY_COMMAND_PATTERN.test(text)) {
    return { target: { kind: "forget-memory" }, reason: "pedido de exclusão de memória" };
  }

  // "/geral ..." é pedido explícito de assistente geral: o resto da frase não
  // deve ser lido como intenção de produto.
  if (GENERAL_COMMAND_PATTERN.test(text)) {
    return { target: { kind: "general" }, reason: "comando explícito de assistente geral" };
  }

  const product = matchProductByRules(text);
  if (product) {
    return { target: { kind: "product", product: product.product }, reason: product.reason };
  }

  return { target: { kind: "general" }, reason: "pergunta aberta" };
}
