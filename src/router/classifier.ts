import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { DEFAULT_PRODUCT, PRODUCT_IDS, type ProductId } from "../domain/types.js";
import type { Logger } from "../logger.js";

export interface IntentClassification {
  product: ProductId;
  confidence: number;
  reason: string;
  source: "rule" | "llm" | "fallback";
}

export interface IntentClassifier {
  classify(text: string): Promise<IntentClassification>;
}

/** Abaixo disto a mensagem vai para o assistente geral em vez de um produto. */
const MIN_CONFIDENCE = 0.5;
const MAX_INPUT_CHARS = 2000;

const RULES: ReadonlyArray<{ product: ProductId; pattern: RegExp; reason: string }> = [
  { product: "personai", pattern: /^\s*\/geral\b/i, reason: "comando de assistente geral" },
  {
    product: "personai",
    pattern: /\b(apag\w*|exclu\w*|esque[cç]\w*)\s+(a\s+|as\s+)?(minha\s+|minhas\s+)?mem[óo]ria\b/i,
    reason: "comando de exclusão de memória",
  },
  {
    product: "monneyhub-zap",
    pattern: /\b(saldo|extrato|fluxo de caixa|boleto|nota fiscal|faturamento|das|mei)\b/i,
    reason: "termo financeiro",
  },
  {
    product: "normas-ia",
    pattern: /\b(nr-?\d+|nbr|norma\w*|regulament\w*|complian\w*|legisla\w*)\b/i,
    reason: "termo normativo",
  },
  {
    product: "sales-agent",
    pattern: /\b(or[çc]amento|proposta|comprar|pre[çc]o|plano|contrat\w*|vend\w*)\b/i,
    reason: "intenção comercial",
  },
];

export function classifyByRules(text: string): IntentClassification | null {
  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      return { product: rule.product, confidence: 1, reason: rule.reason, source: "rule" };
    }
  }
  return null;
}

const classificationSchema = z.object({
  product: z.enum(PRODUCT_IDS),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(200),
});

const SYSTEM_PROMPT = `Você roteia mensagens recebidas no WhatsApp da FOX TecnologIA para o produto que deve respondê-las.

Produtos:
- sales-agent: interesse comercial — orçamento, proposta, preço, contratação.
- monneyhub-zap: finanças do cliente — saldo, extrato, fluxo de caixa, boleto, nota fiscal, obrigações do MEI.
- normas-ia: normas técnicas e regulatórias — NRs, NBRs, compliance, legislação.
- personai: assistente geral — conversa aberta e qualquer coisa que não pertença claramente aos demais.

Na dúvida, escolha personai. Use confiança baixa quando a mensagem for ambígua ou curta demais para decidir.`;

export interface ClaudeClassifierOptions {
  client: Anthropic | null;
  model: string;
  logger: Logger;
}

/**
 * Classificador de intenção da Camada A: regra determinística primeiro (barata
 * e previsível), Claude só no que sobra. Falha de IA nunca derruba a mensagem —
 * cai no assistente geral.
 */
export class ClaudeIntentClassifier implements IntentClassifier {
  constructor(private readonly options: ClaudeClassifierOptions) {}

  async classify(text: string): Promise<IntentClassification> {
    const rule = classifyByRules(text);
    if (rule) return rule;

    const { client, model, logger } = this.options;
    if (!client || text.trim().length === 0) {
      return fallback("classificador de IA indisponível");
    }

    try {
      const response = await client.beta.messages.parse({
        model,
        max_tokens: 256,
        system: SYSTEM_PROMPT,
        thinking: { type: "disabled" },
        output_config: { effort: "low" },
        output_format: betaZodOutputFormat(classificationSchema),
        messages: [{ role: "user", content: text.slice(0, MAX_INPUT_CHARS) }],
      });

      const parsed = response.parsed_output;
      if (!parsed) return fallback("resposta do classificador não pôde ser interpretada");

      if (parsed.confidence < MIN_CONFIDENCE) {
        return {
          product: DEFAULT_PRODUCT,
          confidence: parsed.confidence,
          reason: `confiança abaixo do mínimo: ${parsed.reason}`,
          source: "fallback",
        };
      }

      return { ...parsed, source: "llm" };
    } catch (error) {
      logger.warn({ err: error }, "classificador falhou; roteando para assistente geral");
      return fallback("erro ao chamar o classificador");
    }
  }
}

function fallback(reason: string): IntentClassification {
  return { product: DEFAULT_PRODUCT, confidence: 0, reason, source: "fallback" };
}
