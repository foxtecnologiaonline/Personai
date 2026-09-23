import { describe, expect, it } from "vitest";
import { createLogger } from "../logger.js";
import { PerplexitySearch } from "./search.js";

const logger = createLogger("silent");

const stubFetch = (body: unknown, ok = true): typeof fetch =>
  (async () =>
    ({
      ok,
      status: ok ? 200 : 500,
      json: async () => body,
      text: async () => JSON.stringify(body),
    })) as unknown as typeof fetch;

const search = (fetchImpl: typeof fetch) =>
  new PerplexitySearch({ apiKey: "chave-de-teste", fetchImpl, logger });

const withContent = (extra: Record<string, unknown>) => ({
  choices: [{ message: { content: "O IPCA de agosto foi 0,2%." } }],
  ...extra,
});

describe("PerplexitySearch", () => {
  it("extrai resposta e fontes com título", async () => {
    const result = await search(
      stubFetch(
        withContent({
          search_results: [
            { title: "IBGE", url: "https://ibge.gov.br/ipca" },
            { title: "Agência Brasil", url: "https://agenciabrasil.ebc.com.br/ipca" },
          ],
        }),
      ),
    ).search("qual foi o IPCA de agosto?");

    expect(result?.text).toContain("IPCA");
    expect(result?.sources).toEqual([
      { title: "IBGE", url: "https://ibge.gov.br/ipca" },
      { title: "Agência Brasil", url: "https://agenciabrasil.ebc.com.br/ipca" },
    ]);
  });

  it("aceita o formato alternativo em que a fonte vem só como URL", async () => {
    const result = await search(
      stubFetch(withContent({ citations: ["https://ibge.gov.br/ipca"] })),
    ).search("qual foi o IPCA?");

    expect(result?.sources).toEqual([
      { title: "https://ibge.gov.br/ipca", url: "https://ibge.gov.br/ipca" },
    ]);
  });

  it("responde sem fonte quando o provedor não devolve nenhuma", async () => {
    const result = await search(stubFetch(withContent({}))).search("pergunta");
    expect(result?.sources).toEqual([]);
  });

  it("limita a três fontes", async () => {
    const result = await search(
      stubFetch(
        withContent({
          citations: ["https://a.com", "https://b.com", "https://c.com", "https://d.com"],
        }),
      ),
    ).search("pergunta");

    expect(result?.sources).toHaveLength(3);
  });

  it("devolve nulo em erro do provedor, sem lançar", async () => {
    expect(await search(stubFetch({}, false)).search("pergunta")).toBeNull();
    expect(await search(stubFetch({ choices: [] })).search("pergunta")).toBeNull();

    const explode = (async () => {
      throw new Error("timeout");
    }) as unknown as typeof fetch;
    expect(await search(explode).search("pergunta")).toBeNull();
  });
});
