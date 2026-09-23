import { createHmac, timingSafeEqual } from "node:crypto";

const HEX_SHA256 = /^[0-9a-f]{64}$/i;

/**
 * Valida o header `X-Hub-Signature-256` da Meta contra o corpo bruto da
 * requisição. Sem isto, qualquer um que descubra a URL do webhook injeta
 * mensagem no sistema.
 */
export function verifyMetaSignature(
  rawBody: Buffer,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (!header) return false;

  const [algorithm, provided] = header.split("=");
  if (algorithm !== "sha256" || !provided || !HEX_SHA256.test(provided)) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  return timingSafeEqual(Buffer.from(provided, "hex"), expected);
}
