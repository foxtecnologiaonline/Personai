import { describe, expect, it, vi } from "vitest";
import type { HandlerContext, NormalizedMessage } from "../domain/types.js";
import { createLogger } from "../logger.js";
import type { MemoryApi } from "../memory/types.js";
import type { PersonAiAssistant } from "../personai/assistant.js";
import { ProductApiRegistry } from "../personai/product-api.js";
import type { ConversationSession } from "../personai/session.js";
import { PersonAiHandler } from "./personai.js";

const logger = createLogger("silent");

const message = (text: string): NormalizedMessage => ({
  messageId: "wamid.1",
  tenantId: "11111111-1111-1111-1111-111111111111",
  phoneNumberId: "PN_1",
  waId: "5511999999999",
  userRef: "ref-do-usuario-0123456789",
  text,
  kind: "text",
  rawType: "text",
  timestamp: new Date(),
});

function memoryStub() {
  return {
    getContext: vi.fn(async () => ({ preferences: {}, facts: [], interactions: [] })),
    setPreference: vi.fn(async () => undefined),
    rememberFact: vi.fn(async () => undefined),
    recordInteraction: vi.fn(async () => undefined),
    forgetAll: vi.fn(async () => ({
      preferences: 2,
      facts: 3,
      interactions: 4,
      completedAt: new Date(),
    })),
  } satisfies MemoryApi;
}

function sessionStub(): ConversationSession & { cleared: number } {
  return {
    cleared: 0,
    async load() {
      return [];
    },
    async append() {},
    async clear() {
      this.cleared += 1;
    },
  };
}

const assistantStub = (answer: unknown): PersonAiAssistant =>
  ({ answer: async () => answer }) as unknown as PersonAiAssistant;

const build = (overrides: {
  assistant?: PersonAiAssistant;
  session?: ConversationSession;
  products?: ProductApiRegistry;
}) =>
  new PersonAiHandler({
    assistant: overrides.assistant ?? assistantStub(null),
    session: overrides.session ?? sessionStub(),
    products: overrides.products ?? new ProductApiRegistry(),
  });

describe("PersonAiHandler", () => {
  it("apaga memória e conversa recente quando o usuário pede", async () => {
    const memory = memoryStub();
    const session = sessionStub();
    const ctx: HandlerContext = { memory, logger };

    const reply = await build({ session }).handle(message("apagar minha memória"), ctx);

    expect(memory.forgetAll).toHaveBeenCalledOnce();
    expect(session.cleared).toBe(1);
    expect(reply?.skipMemory).toBe(true);
    expect(reply?.text).toContain("2 preferência(s)");
    expect(reply?.text).toContain("histórico recente");
  });

  it("avisa com honestidade quando o produto ainda não está ligado", async () => {
    const ctx: HandlerContext = { memory: memoryStub(), logger };
    const reply = await build({}).handle(message("qual meu saldo?"), ctx);

    expect(reply?.text).toContain("MonneyHub");
    expect(reply?.text).toContain("ainda não está ligado");
  });

  it("usa a API interna do produto quando ela existe", async () => {
    const products = new ProductApiRegistry().register({
      product: "monneyhub-zap",
      answer: async () => ({ text: "Seu saldo é R$ 1.234,00." }),
    });
    const ctx: HandlerContext = { memory: memoryStub(), logger };

    const reply = await build({ products }).handle(message("qual meu saldo?"), ctx);
    expect(reply?.text).toBe("Seu saldo é R$ 1.234,00.");
  });

  it("responde pergunta aberta e guarda o que vale lembrar", async () => {
    const memory = memoryStub();
    const ctx: HandlerContext = { memory, logger };
    const assistant = assistantStub({
      text: "Claro!",
      facts: ["é MEI desde 2021"],
      preferences: [{ key: "tom", value: "informal" }],
      usedSearch: false,
      source: "claude",
    });

    const reply = await build({ assistant }).handle(message("você me ajuda?"), ctx);

    expect(reply?.text).toBe("Claro!");
    expect(memory.rememberFact).toHaveBeenCalledWith(
      message("").tenantId,
      message("").userRef,
      "é MEI desde 2021",
      "personai",
    );
    expect(memory.setPreference).toHaveBeenCalledWith(
      message("").tenantId,
      message("").userRef,
      "tom",
      "informal",
    );
  });

  it("não deixa falha ao gravar memória custar a resposta", async () => {
    const memory = memoryStub();
    memory.rememberFact.mockRejectedValueOnce(new Error("banco fora do ar"));
    const ctx: HandlerContext = { memory, logger };
    const assistant = assistantStub({
      text: "Resposta mesmo assim.",
      facts: ["algo"],
      preferences: [],
      usedSearch: false,
      source: "claude",
    });

    const reply = await build({ assistant }).handle(message("pergunta"), ctx);
    expect(reply?.text).toBe("Resposta mesmo assim.");
  });

  it("responde com aviso quando nenhum modelo está disponível", async () => {
    const ctx: HandlerContext = { memory: memoryStub(), logger };
    const reply = await build({}).handle(message("me conta uma curiosidade"), ctx);
    expect(reply?.text).toContain("Não consegui responder agora");
  });
});
