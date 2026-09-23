import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { registerGatewayRoutes, type GatewayRoutesOptions } from "./gateway/routes.js";
import { registerMemoryRoutes, type MemoryRoutesOptions } from "./memory/routes.js";

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
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({ loggerInstance: deps.logger, bodyLimit: 1_048_576, trustProxy: true });

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

  app.get("/health", async () => ({ status: "ok" }));

  await registerGatewayRoutes(app, deps.gateway);
  await registerMemoryRoutes(app, deps.memory);

  return app;
}
