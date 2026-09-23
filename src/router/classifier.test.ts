import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { createLogger } from "../logger.js";
import { ClaudeIntentClassifier, classifyByRules } from "./classifier.js";

const logger = createLogger("silent");

const fakeClient = (parse: () => unknown): Anthropic =>
  ({ beta: { messages: { parse } } }) as unknown as Anthropic;

const classifier = (client: Anthropic | null) =>
  new ClaudeIntentClassifier({ client, model: "claude-sonnet-5", logger });

describe("classifyByRules", () => {
  it.each([
    ["qual é o meu saldo hoje?", "monneyhub-zap"],
    ["preciso da NR-35 atualizada", "normas-ia"],
    ["quero um orçamento do plano anual", "sales-agent"],
    ["/geral me ajuda com uma dúvida", "personai"],
    ["pode apagar minha memória por favor", "personai"],
  ])("roteia %s para %s", (text, product) => {
    expect(classifyByRules(text)).toMatchObject({ product, source: "rule" });
  });

  it("não decide por regra quando nenhum termo casa", () => {
    expect(classifyByRules("oi, tudo bem?")).toBeNull();
  });
});

describe("ClaudeIntentClassifier", () => {
  it("usa a regra sem chamar o modelo", async () => {
    const result = await classifier(
      fakeClient(() => {
        throw new Error("o modelo não deveria ser chamado");
      }),
    ).classify("qual meu extrato?");

    expect(result).toMatchObject({ product: "monneyhub-zap", source: "rule" });
  });

  it("cai no assistente geral quando não há cliente de IA", async () => {
    const result = await classifier(null).classify("oi, tudo bem?");
    expect(result).toMatchObject({ product: "personai", source: "fallback" });
  });

  it("aceita a decisão do modelo quando a confiança é suficiente", async () => {
    const client = fakeClient(() => ({
      parsed_output: { product: "sales-agent", confidence: 0.9, reason: "quer contratar" },
    }));

    const result = await classifier(client).classify("me manda os valores de implantação");
    expect(result).toMatchObject({ product: "sales-agent", source: "llm", confidence: 0.9 });
  });

  it("descarta decisão de baixa confiança em favor do assistente geral", async () => {
    const client = fakeClient(() => ({
      parsed_output: { product: "normas-ia", confidence: 0.2, reason: "mensagem ambígua" },
    }));

    const result = await classifier(client).classify("e aquilo lá?");
    expect(result).toMatchObject({ product: "personai", source: "fallback" });
  });

  it("não derruba a mensagem quando o modelo falha", async () => {
    const client = fakeClient(() => {
      throw new Error("429 rate limit");
    });

    const result = await classifier(client).classify("uma pergunta qualquer");
    expect(result).toMatchObject({ product: "personai", source: "fallback" });
  });

  it("trata resposta não parseável como falha", async () => {
    const client = fakeClient(() => ({ parsed_output: null }));
    const result = await classifier(client).classify("outra pergunta");
    expect(result).toMatchObject({ product: "personai", source: "fallback" });
  });
});
