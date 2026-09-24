import type { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { createLogger } from "../logger.js";
import type { MemoryContext } from "../memory/types.js";
import { PersonAiAssistant, type AssistantDeps } from "./assistant.js";
import type { GroundedSearch } from "./search.js";

const logger = createLogger("silent");

const emptyMemory: MemoryContext = { preferences: {}, facts: [], interactions: [] };

const claudeStub = (
  reply: unknown,
  capture?: (params: Record<string, unknown>) => void,
): Anthropic =>
  ({
    beta: {
      messages: {
        parse: async (params: Record<string, unknown>) => {
          capture?.(params);
          if (reply instanceof Error) throw reply;
          return { parsed_output: reply };
        },
      },
    },
  }) as unknown as Anthropic;

const bedrockStub = (text: string | Error): AnthropicBedrockMantle =>
  ({
    messages: {
      create: async () => {
        if (text instanceof Error) throw text;
        return { content: [{ type: "text", text }] };
      },
    },
  }) as unknown as AnthropicBedrockMantle;

const searchStub = (result: Awaited<ReturnType<GroundedSearch["search"]>>): GroundedSearch => ({
  async search() {
    return result;
  },
});

const assistant = (overrides: Partial<AssistantDeps>) =>
  new PersonAiAssistant({
    claude: null,
    bedrock: null,
    model: "claude-sonnet-5",
    bedrockModel: "anthropic.claude-sonnet-5",
    search: null,
    logger,
    ...overrides,
  });

describe("PersonAiAssistant", () => {
  it("responde pelo modelo primário e devolve o que vale lembrar", async () => {
    const answer = await assistant({
      claude: claudeStub({
        reply: "Claro, posso ajudar com isso.",
        facts: ["é MEI desde 2021"],
        preferences: [{ key: "tom", value: "informal" }],
      }),
    }).answer({ question: "você me ajuda?", memory: emptyMemory, history: [] });

    expect(answer).toMatchObject({
      text: "Claro, posso ajudar com isso.",
      facts: ["é MEI desde 2021"],
      preferences: [{ key: "tom", value: "informal" }],
      source: "claude",
      usedSearch: false,
    });
  });

  it("cita a fonte quando a informação veio de busca externa", async () => {
    const answer = await assistant({
      claude: claudeStub({ reply: "O IPCA de agosto foi 0,2%.", facts: [], preferences: [] }),
      search: searchStub({
        text: "IPCA de agosto: 0,2%",
        sources: [{ title: "IBGE", url: "https://ibge.gov.br/ipca" }],
      }),
    }).answer({ question: "qual foi o IPCA?", memory: emptyMemory, history: [] });

    expect(answer?.usedSearch).toBe(true);
    expect(answer?.text).toContain("Fontes:");
    expect(answer?.text).toContain("https://ibge.gov.br/ipca");
  });

  it("entrega a pesquisa ao modelo e não cita fonte quando não houve busca", async () => {
    let captured: Record<string, unknown> = {};
    const answer = await assistant({
      claude: claudeStub({ reply: "resposta", facts: [], preferences: [] }, (p) => {
        captured = p;
      }),
      search: searchStub({ text: "material pesquisado", sources: [] }),
    }).answer({ question: "pergunta", memory: emptyMemory, history: [] });

    const messages = captured["messages"] as Array<{ content: string }>;
    expect(messages.at(-1)?.content).toContain("<pesquisa>");
    expect(answer?.text).not.toContain("Fontes:");
  });

  it("injeta preferências e fatos conhecidos no contexto do modelo", async () => {
    let captured: Record<string, unknown> = {};
    await assistant({
      claude: claudeStub({ reply: "ok", facts: [], preferences: [] }, (p) => {
        captured = p;
      }),
    }).answer({
      question: "e aí?",
      memory: {
        preferences: { tom: "informal" },
        facts: [{ content: "é MEI desde 2021", source: null, lastSeenAt: new Date() }],
        interactions: [],
      },
      history: [{ role: "user", text: "oi" }],
    });

    expect(captured["system"]).toContain("tom: informal");
    expect(captured["system"]).toContain("é MEI desde 2021");
    expect((captured["messages"] as unknown[])).toHaveLength(2);
  });

  it("descarta prefixo de histórico que não comece pelo usuário", async () => {
    let captured: Record<string, unknown> = {};
    await assistant({
      claude: claudeStub({ reply: "ok", facts: [], preferences: [] }, (p) => {
        captured = p;
      }),
    }).answer({
      question: "e agora?",
      memory: emptyMemory,
      history: [
        { role: "assistant", text: "resposta órfã" },
        { role: "user", text: "pergunta" },
        { role: "assistant", text: "resposta" },
      ],
    });

    const messages = captured["messages"] as Array<{ role: string; content: string }>;
    expect(messages[0]).toMatchObject({ role: "user", content: "pergunta" });
    expect(messages).toHaveLength(3);
  });

  it("cai para o modelo de redundância quando o primário falha", async () => {
    const answer = await assistant({
      claude: claudeStub(new Error("503 indisponível")),
      bedrock: bedrockStub("Resposta pelo fallback."),
    }).answer({ question: "pergunta", memory: emptyMemory, history: [] });

    expect(answer).toMatchObject({
      text: "Resposta pelo fallback.",
      source: "bedrock",
      facts: [],
      preferences: [],
    });
  });

  it("segue respondendo quando a busca externa falha", async () => {
    const answer = await assistant({
      claude: claudeStub({ reply: "respondo mesmo assim", facts: [], preferences: [] }),
      search: searchStub(null),
    }).answer({ question: "pergunta", memory: emptyMemory, history: [] });

    expect(answer?.text).toBe("respondo mesmo assim");
    expect(answer?.usedSearch).toBe(false);
  });

  it("devolve nulo quando nenhum modelo responde", async () => {
    expect(
      await assistant({
        claude: claudeStub(new Error("falhou")),
        bedrock: bedrockStub(new Error("falhou também")),
      }).answer({ question: "pergunta", memory: emptyMemory, history: [] }),
    ).toBeNull();

    expect(
      await assistant({}).answer({ question: "pergunta", memory: emptyMemory, history: [] }),
    ).toBeNull();
  });
});
