import Anthropic from "@anthropic-ai/sdk";
import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { GraphWhatsAppSender } from "./gateway/whatsapp.js";
import { TenantResolver } from "./gateway/tenants.js";
import { PersonAiHandler } from "./handlers/personai.js";
import { deriveUserRef } from "./identity.js";
import { createLogger } from "./logger.js";
import { PgMemoryRepository } from "./memory/repository.js";
import { createInboundQueue, createRedis, inboundJobOptions } from "./queue/inbound.js";
import { ClaudeIntentClassifier } from "./router/classifier.js";
import { HandlerRegistry } from "./router/registry.js";
import { createInboundWorker } from "./router/worker.js";
import { buildServer } from "./server.js";

type Mode = "api" | "worker" | "all";

const mode = (process.argv[2] ?? "all") as Mode;
if (!["api", "worker", "all"].includes(mode)) {
  console.error(`Modo inválido: ${mode}. Use api, worker ou all.`);
  process.exit(1);
}

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const pool = createPool(config.DATABASE_URL);
const memory = new PgMemoryRepository(pool);
const closers: Array<() => Promise<unknown>> = [() => pool.end()];

if (config.CLASSIFIER_ENABLED && !config.ANTHROPIC_API_KEY) {
  logger.warn("ANTHROPIC_API_KEY ausente: só o classificador por regras ficará ativo");
}

const anthropic =
  config.CLASSIFIER_ENABLED && config.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: config.ANTHROPIC_API_KEY })
    : null;

if (mode !== "worker") {
  const redis = createRedis(config.REDIS_URL);
  const queue = createInboundQueue(redis);
  closers.unshift(() => queue.close(), () => redis.quit());

  const app = await buildServer({
    logger,
    gateway: {
      verifyToken: config.WHATSAPP_VERIFY_TOKEN,
      appSecret: config.WHATSAPP_APP_SECRET,
      tenants: new TenantResolver(pool),
      deriveRef: (tenantId, waId) => deriveUserRef(config.USER_REF_SECRET, tenantId, waId),
      enqueue: async (job) => {
        await queue.add("inbound", job, { ...inboundJobOptions, jobId: job.messageId });
      },
    },
    memory: { memory, internalToken: config.INTERNAL_API_TOKEN },
  });

  closers.unshift(() => app.close());
  await app.listen({ host: config.HOST, port: config.PORT });
}

if (mode !== "api") {
  // Conexão própria: o worker bloqueia a dele esperando job.
  const redis = createRedis(config.REDIS_URL);
  const registry = new HandlerRegistry().register(new PersonAiHandler());

  const worker = createInboundWorker(
    { connection: redis },
    {
      pool,
      registry,
      classifier: new ClaudeIntentClassifier({
        client: anthropic,
        model: config.CLASSIFIER_MODEL,
        logger,
      }),
      memory,
      sender: new GraphWhatsAppSender({
        accessToken: config.WHATSAPP_ACCESS_TOKEN,
        graphVersion: config.WHATSAPP_GRAPH_VERSION,
      }),
      logger,
    },
  );

  closers.unshift(() => worker.close(), () => redis.quit());
  logger.info({ produtos: registry.registered() }, "worker de mensagens ativo");
}

let shuttingDown = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "encerrando");
    void (async () => {
      for (const close of closers) {
        await close().catch((error: unknown) => logger.error({ err: error }, "erro ao encerrar"));
      }
      process.exit(0);
    })();
  });
}
