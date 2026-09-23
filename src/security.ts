import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Comparação de segredos em tempo constante. Passa pelo SHA-256 antes para que
 * strings de tamanhos diferentes não vazem informação pelo comprimento.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a, "utf8").digest();
  const digestB = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(digestA, digestB);
}
