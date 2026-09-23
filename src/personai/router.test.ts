import { describe, expect, it } from "vitest";
import { routePersonAiIntent, type PersonAiTarget } from "./router.js";

type Label = "forget" | "general" | "monneyhub-zap" | "normas-ia" | "sales-agent";

const label = (target: PersonAiTarget): Label =>
  target.kind === "forget-memory" ? "forget" : target.kind === "general" ? "general" : (target.product as Label);

/**
 * Conjunto rotulado do critério de aceite da spec: o roteamento secundário
 * precisa acertar o destino em pelo menos 90% dos casos. Inclui paráfrases sem
 * a palavra óbvia de propósito — medir só o caso fácil não mede nada.
 */
const CASES: ReadonlyArray<{ text: string; expected: Label }> = [
  // Exclusão de memória
  { text: "apagar minha memória", expected: "forget" },
  { text: "quero que você esqueça meus dados", expected: "forget" },
  { text: "pode excluir meu histórico?", expected: "forget" },
  { text: "apaga tudo o que você sabe sobre mim", expected: "forget" },
  { text: "esquece minhas preferências, por favor", expected: "forget" },

  // Financeiro (MonneyHub)
  { text: "qual é o meu saldo?", expected: "monneyhub-zap" },
  { text: "me manda o extrato de setembro", expected: "monneyhub-zap" },
  { text: "preciso emitir um boleto para um cliente", expected: "monneyhub-zap" },
  { text: "quanto eu tenho na conta hoje?", expected: "monneyhub-zap" },
  { text: "como está meu fluxo de caixa esse mês?", expected: "monneyhub-zap" },
  { text: "tenho que pagar o DAS desse mês?", expected: "monneyhub-zap" },

  // Normas
  { text: "o que diz a NR-12 sobre proteção de máquina?", expected: "normas-ia" },
  { text: "preciso da NBR 5410 atualizada", expected: "normas-ia" },
  { text: "isso está dentro da legislação trabalhista?", expected: "normas-ia" },
  { text: "qual norma regulamentadora cobre trabalho em altura?", expected: "normas-ia" },
  { text: "estamos em compliance com isso?", expected: "normas-ia" },

  // Comercial
  { text: "quero um orçamento", expected: "sales-agent" },
  { text: "quanto custa o plano anual?", expected: "sales-agent" },
  { text: "gostaria de contratar o serviço de vocês", expected: "sales-agent" },
  { text: "me passa a proposta comercial", expected: "sales-agent" },
  { text: "vocês vendem para pequenas empresas?", expected: "sales-agent" },
  { text: "qual o valor da implantação?", expected: "sales-agent" },

  // Pergunta aberta
  { text: "oi, tudo bem?", expected: "general" },
  { text: "bom dia", expected: "general" },
  { text: "me explica o que é CNAE", expected: "general" },
  { text: "qual a previsão do tempo em Curitiba amanhã?", expected: "general" },
  { text: "me ajuda a escrever um e-mail para um cliente?", expected: "general" },
  { text: "o que você consegue fazer?", expected: "general" },
  { text: "quem descobriu o Brasil?", expected: "general" },
  { text: "/geral quanto custa o plano anual?", expected: "general" },
];

describe("roteamento secundário do PersonAI", () => {
  it("acerta o destino em pelo menos 90% dos casos (critério de aceite)", () => {
    const misses = CASES.filter(
      (item) => label(routePersonAiIntent(item.text).target) !== item.expected,
    );
    const accuracy = (CASES.length - misses.length) / CASES.length;

    if (misses.length > 0) {
      console.log(
        "Casos errados:",
        misses.map((m) => `${m.text} → esperado ${m.expected}`),
      );
    }

    expect(accuracy).toBeGreaterThanOrEqual(0.9);
  });

  it("comando /geral tem precedência sobre termo de produto", () => {
    expect(routePersonAiIntent("/geral quanto custa o plano anual?").target).toEqual({
      kind: "general",
    });
    expect(routePersonAiIntent("quanto custa o plano anual?").target).toEqual({
      kind: "product",
      product: "sales-agent",
    });
  });

  it("pedido de exclusão vence qualquer outro termo na mensagem", () => {
    expect(routePersonAiIntent("apaga minha memória e me manda o extrato").target).toEqual({
      kind: "forget-memory",
    });
  });

  it("pergunta sem termo de produto vai para o assistente geral", () => {
    expect(routePersonAiIntent("me conta uma curiosidade").target).toEqual({ kind: "general" });
  });
});
