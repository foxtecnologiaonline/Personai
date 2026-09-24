import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { registerGatewayRoutes, type GatewayRoutesOptions } from "./gateway/routes.js";
import { registerMemoryRoutes, type MemoryRoutesOptions } from "./memory/routes.js";
import { registerOpsRoutes, type OpsRoutesOptions } from "./ops/status.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Corpo bruto, necessário para validar a assinatura HMAC da Meta. */
    rawBody?: Buffer;
  }
}

export interface ServerDeps {
  logger: FastifyBaseLogger;
  gateway: GatewayRoutesOptions;
  memory: MemoryRoutesOptions;
  ops: OpsRoutesOptions;
  /** Ligar apenas quando houver proxy confiável na frente. */
  trustProxy?: boolean;
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: deps.logger,
    bodyLimit: 1_048_576,
    trustProxy: deps.trustProxy ?? false,
  });

  // A assinatura é sobre os bytes exatos: preservar o corpo bruto antes do parse.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    const raw = body as Buffer;
    request.rawBody = raw;
    try {
      done(null, raw.length > 0 ? JSON.parse(raw.toString("utf8")) : {});
    } catch {
      const error = new Error("JSON inválido") as Error & { statusCode?: number };
      error.statusCode = 400;
      done(error, undefined);
    }
  });

  // Limite por rota, não global: o webhook chega de poucos IPs da Meta, então
  // limitar por IP ali descartaria mensagem legítima de tenant movimentado.
  // Quem protege o webhook é a assinatura HMAC.
  await app.register(rateLimit, { global: false });

  app.get("/health", async () => ({ status: "ok" }));

  await registerGatewayRoutes(app, deps.gateway);
  await registerMemoryRoutes(app, deps.memory);
  await registerOpsRoutes(app, deps.ops);

  return app;
}
