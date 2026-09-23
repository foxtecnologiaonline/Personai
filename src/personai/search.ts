import type { Logger } from "../logger.js";

export interface SearchSource {
  title: string;
  url: string;
}

export interface GroundedAnswer {
  text: string;
  sources: SearchSource[];
}

export interface GroundedSearch {
  search(question: string): Promise<GroundedAnswer | null>;
}

export interface PerplexityOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  logger: Logger;
}

const prop = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const MAX_SOURCES = 3;

/**
 * Busca fundamentada para pergunta aberta.
 *
 * A leitura da resposta é defensiva porque o provedor já devolveu fontes em
 * mais de um formato (`search_results` com título e `citations` só com URL):
 * os dois são aceitos, e a ausência de fonte não invalida a resposta.
 * Confirmar o contrato vigente com uma chave real antes de ir a produção.
 */
export class PerplexitySearch implements GroundedSearch {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: PerplexityOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl ?? "https://api.perplexity.ai";
    this.model = options.model ?? "sonar";
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async search(question: string): Promise<GroundedAnswer | null> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: "system",
              content:
                "Responda de forma factual e concisa, em português do Brasil, citando apenas o que encontrar nas fontes.",
            },
            { role: "user", content: question },
          ],
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        this.options.logger.warn({ status: response.status }, "busca externa falhou");
        return null;
      }

      const body: unknown = await response.json();
      const text = asString(
        prop(prop(asArray(prop(body, "choices"))[0], "message"), "content"),
      );
      if (!text) return null;

      return { text, sources: extractSources(body) };
    } catch (error) {
      // Busca é enriquecimento: se falhar, o assistente ainda responde.
      this.options.logger.warn({ err: error }, "busca externa indisponível");
      return null;
    }
  }
}

function extractSources(body: unknown): SearchSource[] {
  const sources: SearchSource[] = [];

  for (const result of asArray(prop(body, "search_results"))) {
    const url = asString(prop(result, "url"));
    if (url) sources.push({ title: asString(prop(result, "title")) ?? url, url });
  }

  if (sources.length === 0) {
    for (const citation of asArray(prop(body, "citations"))) {
      const url = asString(citation);
      if (url) sources.push({ title: url, url });
    }
  }

  return sources.slice(0, MAX_SOURCES);
}
