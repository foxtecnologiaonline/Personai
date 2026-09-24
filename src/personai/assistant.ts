import type { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Logger } from "../logger.js";
import type { MemoryContext } from "../memory/types.js";
import type { GroundedSearch, SearchSource } from "./search.js";
import type { ConversationTurn } from "./session.js";

const MAX_REPLY_CHARS = 1200;

const answerSchema = z.object({
  reply: z.string().min(1).max(MAX_REPLY_CHARS),
  facts: z.array(z.string().max(200)).max(3),
  preferences: z.array(z.object({ key: z.string().max(40), value: z.string().max(200) })).max(3),
});

export type ExtractedPreference = z.infer<typeof answerSchema>["preferences"][number];

const SYSTEM_PROMPT = `Você é o assistente pessoal da FOX TecnologIA, falando por WhatsApp em português do Brasil.

Como responder:
- Curto e direto: no máximo dois parágrafos curtos. É WhatsApp, não relatório.
- Quando houver um bloco <pesquisa>, responda apenas com o que está nele. Não complete com suposição.
- Sem material de pesquisa e sem certeza, diga que não sabe em vez de inventar. Nunca invente número, prazo, valor ou nome.

O que você não faz:
- Você não executa ações: não compra, não agenda, não paga, não cancela, não envia nada a terceiros. Se pedirem, explique que ainda não faz isso e ofereça a informação.
- Nunca afirme ter feito algo que não fez.

Memória (campos facts e preferences):
- Devolva só o que ajudará em conversas futuras (ex.: "é MEI desde 2021", "prefere respostas curtas").
- Listas vazias são resposta válida e o caso mais comum.
- Nunca registre dado sensível (saúde, religião, posição política, biometria) nem documento, cartão ou senha.`;

export interface AssistantRequest {
  question: string;
  memory: MemoryContext;
  history: ConversationTurn[];
}

export interface AssistantAnswer {
  text: string;
  facts: string[];
  preferences: ExtractedPreference[];
  usedSearch: boolean;
  source: "claude" | "bedrock";
}

export interface AssistantDeps {
  claude: Anthropic | null;
  bedrock: AnthropicBedrockMantle | null;
  model: string;
  bedrockModel: string;
  search: GroundedSearch | null;
  logger: Logger;
}

export class PersonAiAssistant {
  constructor(private readonly deps: AssistantDeps) {}

  async answer(request: AssistantRequest): Promise<AssistantAnswer | null> {
    const research = this.deps.search ? await this.deps.search.search(request.question) : null;
    const prompt = buildUserPrompt(request, research?.text);
    const system = buildSystem(request.memory);
    const history = fromFirstUserTurn(request.history).map((turn) => ({
      role: turn.role,
      content: turn.text,
    })) satisfies Array<{ role: "user" | "assistant"; content: string }>;

    const answer =
      (await this.askClaude(system, history, prompt)) ??
      (await this.askBedrock(system, history, prompt));

    if (!answer) return null;

    return {
      ...answer,
      text: withSources(answer.text, research?.sources ?? []),
      usedSearch: research !== null,
    };
  }

  private async askClaude(
    system: string,
    history: Array<{ role: "user" | "assistant"; content: string }>,
    prompt: string,
  ): Promise<Omit<AssistantAnswer, "usedSearch" | "text"> & { text: string } | null> {
    const { claude, model, logger } = this.deps;
    if (!claude) return null;

    try {
      const response = await claude.beta.messages.parse({
        model,
        max_tokens: 1024,
        system,
        thinking: { type: "disabled" },
        output_format: betaZodOutputFormat(answerSchema),
        messages: [...history, { role: "user", content: prompt }],
      });

      const parsed = response.parsed_output;
      if (!parsed) {
        logger.warn("resposta do assistente não pôde ser interpretada");
        return null;
      }

      return {
        text: parsed.reply,
        facts: parsed.facts,
        preferences: parsed.preferences,
        source: "claude",
      };
    } catch (error) {
      logger.warn({ err: error }, "modelo primário falhou; tentando fallback");
      return null;
    }
  }

  /**
   * Fallback de redundância: responde sem saída estruturada, então não extrai
   * memória. Perder um fato é aceitável; ficar sem resposta não é.
   */
  private async askBedrock(
    system: string,
    history: Array<{ role: "user" | "assistant"; content: string }>,
    prompt: string,
  ): Promise<(Omit<AssistantAnswer, "usedSearch" | "text"> & { text: string }) | null> {
    const { bedrock, bedrockModel, logger } = this.deps;
    if (!bedrock) return null;

    try {
      const response = await bedrock.messages.create({
        model: bedrockModel,
        max_tokens: 1024,
        system,
        messages: [...history, { role: "user", content: prompt }],
      });

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();

      if (!text) return null;
      return { text: text.slice(0, MAX_REPLY_CHARS), facts: [], preferences: [], source: "bedrock" };
    } catch (error) {
      logger.error({ err: error }, "fallback de modelo também falhou");
      return null;
    }
  }
}

/**
 * A API recusa conversa que não comece por turno do usuário. Hoje os turnos são
 * gravados em pares, mas um corte de histórico em posição ímpar bastaria para
 * derrubar a resposta — descartar o prefixo é mais barato que o 400.
 */
function fromFirstUserTurn(turns: ConversationTurn[]): ConversationTurn[] {
  const start = turns.findIndex((turn) => turn.role === "user");
  return start === -1 ? [] : turns.slice(start);
}

function buildSystem(memory: MemoryContext): string {
  const blocks = [SYSTEM_PROMPT];

  const preferences = Object.entries(memory.preferences);
  if (preferences.length > 0) {
    blocks.push(
      `Preferências já conhecidas:\n${preferences.map(([key, value]) => `- ${key}: ${value}`).join("\n")}`,
    );
  }

  if (memory.facts.length > 0) {
    blocks.push(`O que você já sabe:\n${memory.facts.map((f) => `- ${f.content}`).join("\n")}`);
  }

  return blocks.join("\n\n");
}

function buildUserPrompt(request: AssistantRequest, research: string | undefined): string {
  if (!research) return request.question;
  return `${request.question}\n\n<pesquisa>\n${research}\n</pesquisa>`;
}

/**
 * As fontes são anexadas pelo código, não pedidas ao modelo: citação é
 * requisito e não pode depender de o modelo lembrar de fazer.
 */
function withSources(text: string, sources: SearchSource[]): string {
  if (sources.length === 0) return text;
  const list = sources.map((source) => `• ${source.title}: ${source.url}`).join("\n");
  return `${text}\n\nFontes:\n${list}`;
}
