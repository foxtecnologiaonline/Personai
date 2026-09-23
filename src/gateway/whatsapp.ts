/** Limite de corpo de mensagem de texto da API do WhatsApp. */
const MAX_TEXT_LENGTH = 4096;
const RETRY_DELAY_MS = 500;

export interface WhatsAppSender {
  sendText(phoneNumberId: string, toWaId: string, text: string): Promise<void>;
}

export interface GraphSenderOptions {
  accessToken: string;
  graphVersion: string;
  timeoutMs?: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

type Attempt = { ok: true } | { ok: false; retriable: boolean; error: Error };

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class GraphWhatsAppSender implements WhatsAppSender {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: GraphSenderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl ?? "https://graph.facebook.com";
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async sendText(phoneNumberId: string, toWaId: string, text: string): Promise<void> {
    const url = `${this.baseUrl}/${this.options.graphVersion}/${phoneNumberId}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: toWaId,
      type: "text",
      text: { preview_url: false, body: text.slice(0, MAX_TEXT_LENGTH) },
    };

    let lastError: Error | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const outcome = await this.post(url, payload);
      if (outcome.ok) return;

      lastError = outcome.error;
      if (!outcome.retriable) break;
      if (attempt === 0) await delay(RETRY_DELAY_MS);
    }

    throw lastError ?? new Error("Falha ao enviar mensagem pelo WhatsApp");
  }

  private async post(url: string, payload: unknown): Promise<Attempt> {
    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (response.ok) return { ok: true };

      const detail = await response.text().catch(() => "");
      return {
        ok: false,
        retriable: response.status === 429 || response.status >= 500,
        error: new Error(`Graph API respondeu ${response.status}: ${detail.slice(0, 300)}`),
      };
    } catch (error) {
      return { ok: false, retriable: true, error: error as Error };
    }
  }
}
