import type { Queue } from "bullmq";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { INTERNAL_RATE_LIMIT, internalTokenGuard } from "../http/internal-auth.js";

export interface OpsRoutesOptions {
  internalToken: string;
  pool: pg.Pool;
  queue: Queue | null;
}

/**
 * Status operacional para monitoração externa: se o banco responde e quanto
 * trabalho está parado na fila. Fila crescendo é o primeiro sinal de que
 * mensagem de usuário está sem resposta.
 */
export async function registerOpsRoutes(
  app: FastifyInstance,
  { internalToken, pool, queue }: OpsRoutesOptions,
): Promise<void> {
  app.get(
    "/internal/status",
    { preHandler: internalTokenGuard(internalToken), config: { rateLimit: INTERNAL_RATE_LIMIT } },
    async (_request, reply) => {
      const [database, jobs] = await Promise.all([
        pool
          .query("SELECT 1")
          .then(() => "ok" as const)
          .catch(() => "erro" as const),
        queue
          ? queue
              .getJobCounts("waiting", "active", "delayed", "failed")
              .catch(() => null)
          : Promise.resolve(null),
      ]);

      const healthy = database === "ok" && (queue === null || jobs !== null);
      return reply.code(healthy ? 200 : 503).send({ database, queue: jobs });
    },
  );
}
