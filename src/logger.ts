import { pino, type Logger } from "pino";

export type { Logger };

// Conteúdo de mensagem e telefone do usuário nunca vão para o log (LGPD).
// O que identifica uma mensagem no log é messageId/userRef, ambos opacos.
const REDACTED_PATHS = [
  "req.headers.authorization",
  'req.headers["x-internal-token"]',
  'req.headers["x-hub-signature-256"]',
  "*.text",
  "*.waId",
  "*.wa_id",
  "*.profileName",
  "*.value",
  "*.content",
];

export function createLogger(level: string): Logger {
  return pino({
    level,
    base: undefined,
    redact: { paths: REDACTED_PATHS, censor: "[redigido]" },
  });
}
