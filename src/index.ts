import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import Anthropic from "@anthropic-ai/sdk";
import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { GraphWhatsAppSender } from "./gateway/whatsapp.js";
import { TenantResolver } from "./gateway/tenants.js";
import { PersonAiHandler } from "./handlers/personai.js";
import { deriveUserRef } from "./identity.js";
import { createLogger } from "./logger.js";
import { PgMemoryRepository } from "./memory/repository.js";
import { PersonAiAssistant } from "./personai/assistant.js";
import { ProductApiRegistry } from "./personai/product-api.js";
import { PerplexitySearch } from "./personai/search.js";
import { RedisConversationSession } from "./personai/session.js";
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

const anthropic = config.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: config.ANTHROPIC_API_KEY })
  : null;

if (!anthropic) {
  logger.warn(
    "ANTHROPIC_API_KEY ausente: classificador roda só por regras e o assistente fica sem modelo primário",
  );
}

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
  // E outra para a sessão de conversa, que não pode esperar o bloqueio da fila.
  const sessionRedis = createRedis(config.REDIS_URL);

  const assistant = new PersonAiAssistant({
    claude: anthropic,
    bedrock: config.BEDROCK_ENABLED
      ? new AnthropicBedrockMantle({ awsRegion: config.BEDROCK_REGION })
      : null,
    model: config.PERSONAI_MODEL,
    bedrockModel: config.BEDROCK_MODEL,
    search: config.PERPLEXITY_API_KEY
      ? new PerplexitySearch({
          apiKey: config.PERPLEXITY_API_KEY,
          model: config.PERPLEXITY_MODEL,
          logger,
        })
      : null,
    logger,
  });

  const registry = new HandlerRegistry().register(
    new PersonAiHandler({
      assistant,
      session: new RedisConversationSession(sessionRedis, {
        ttlSeconds: config.PERSONAI_SESSION_TTL_SECONDS,
      }),
      // Produtos registram sua API interna aqui a partir da Fase 1.
      products: new ProductApiRegistry(),
    }),
  );

  const worker = createInboundWorker(
    { connection: redis },
    {
      pool,
      registry,
      classifier: new ClaudeIntentClassifier({
        client: config.CLASSIFIER_ENABLED ? anthropic : null,
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

  closers.unshift(() => worker.close(), () => redis.quit(), () => sessionRedis.quit());
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
