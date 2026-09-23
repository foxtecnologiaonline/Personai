import { createHmac } from "node:crypto";

/**
 * Pseudonimiza o usuário antes de qualquer persistência (LGPD art. 13): o
 * número de telefone fica só em memória durante o processamento da mensagem.
 * Determinístico por tenant, então o direito de esquecimento continua aplicável.
 */
export function deriveUserRef(secret: string, tenantId: string, waId: string): string {
  return createHmac("sha256", secret).update(`${tenantId}:${waId}`).digest("hex");
}
