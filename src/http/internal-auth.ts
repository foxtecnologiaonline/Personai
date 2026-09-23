import type { FastifyReply, FastifyRequest } from "fastify";
import { timingSafeEqualString } from "../security.js";

/** Guarda das rotas `/internal/*`, que nunca devem ser expostas na borda pública. */
export function internalTokenGuard(expected: string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = request.headers["x-internal-token"];
    if (typeof token !== "string" || !timingSafeEqualString(token, expected)) {
      await reply.code(401).send({ error: "unauthorized" });
    }
  };
}

/** Rotas internas têm volume baixo e origem conhecida: limite estreito serve. */
export const INTERNAL_RATE_LIMIT = { max: 60, timeWindow: "1 minute" } as const;
