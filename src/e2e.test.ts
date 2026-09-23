import { createHmac, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { Worker } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool } from "./db/pool.js";
import { TenantResolver } from "./gateway/tenants.js";
import type { WhatsAppSender } from "./gateway/whatsapp.js";
import { PersonAiHandler } from "./handlers/personai.js";
import { deriveUserRef } from "./identity.js";
import { createLogger } from "./logger.js";
import { PgMemoryRepository } from "./memory/repository.js";
import type Anthropic from "@anthropic-ai/sdk";
import { PersonAiAssistant } from "./personai/assistant.js";
import { ProductApiRegistry } from "./personai/product-api.js";
import { RedisConversationSession } from "./personai/session.js";
import { createInboundQueue, createRedis, inboundJobOptions, type InboundJob } from "./queue/inbound.js";
import { ClaudeIntentClassifier } from "./router/classifier.js";
import { HandlerRegistry } from "./router/registry.js";
import { createInboundWorker } from "./router/worker.js";
import { buildServer } from "./server.js";

const DATABASE_URL = process.env["DATABASE_URL"];
const REDIS_URL = process.env["REDIS_URL"];

const APP_SECRET = "app-secret-de-teste-0123456789";
const VERIFY_TOKEN = "verify-token-de-teste-0123";
const USER_REF_SECRET = "0123456789abcdef0123456789abcdef";
const INTERNAL_TOKEN = "token-interno-de-teste-0123456789";

const sign = (raw: Buffer) =>
  `sha256=${createHmac("sha256", APP_SECRET).update(raw).digest("hex")}`;

async function waitFor<T>(check: () => T | undefined, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("condição não satisfeita dentro do tempo limite");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe.skipIf(!DATABASE_URL || !REDIS_URL)("ponta a ponta: webhook → fila → worker", () => {
  const pool = createPool(DATABASE_URL!);
  const memory = new PgMemoryRepository(pool);
  const logger = createLogger(process.env["E2E_LOG"] ?? "silent");
  const sent: Array<{ to: string; text: string }> = [];
  const sender: WhatsAppSender = {
    async sendText(_phoneNumberId, to, text) {
      sent.push({ to, text });
    },
  };

  // Fila própria por execução: sem isto, job órfão de uma rodada interrompida
  // é processado pela rodada seguinte e polui as asserções.
  const queuePrefix = `test-${randomUUID().slice(0, 8)}`;
  const phoneNumberId = `PN_${randomUUID()}`;
  const waId = "5511987654321";
  let tenantId: string;
  let userRef: string;
  let app: FastifyInstance;
  let queue: Queue<InboundJob>;
  let worker: Worker<InboundJob>;
  let queueRedis: Redis;
  let workerRedis: Redis;
  let sessionRedis: Redis;

  const REPLY = "Oi! Como posso ajudar?";

  // Modelo substituído: o que se testa aqui é o encanamento, não a geração.
  const claudeStub = {
    beta: {
      messages: {
        parse: async () => ({
          parsed_output: { reply: REPLY, facts: ["gosta de café"], preferences: [] },
        }),
      },
    },
  } as unknown as Anthropic;

  const postWebhook = (payload: unknown) => {
    const raw = Buffer.from(JSON.stringify(payload));
    return app.inject({
      method: "POST",
      url: "/webhooks/whatsapp",
      headers: { "content-type": "application/json", "x-hub-signature-256": sign(raw) },
      payload: raw,
    });
  };

  const textMessage = (messageId: string, text: string) => ({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: phoneNumberId },
              contacts: [{ profile: { name: "Ana" }, wa_id: waId }],
              messages: [
                {
                  from: waId,
                  id: messageId,
                  timestamp: "1700000000",
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  });

  beforeAll(async () => {
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO tenants (name, phone_number_id) VALUES ($1, $2) RETURNING id",
      ["Tenant e2e", phoneNumberId],
    );
    tenantId = rows[0]!.id;
    userRef = deriveUserRef(USER_REF_SECRET, tenantId, waId);

    queueRedis = createRedis(REDIS_URL!);
    workerRedis = createRedis(REDIS_URL!);
    sessionRedis = createRedis(REDIS_URL!);
    queue = createInboundQueue(queueRedis, queuePrefix);

    const personai = new PersonAiHandler({
      assistant: new PersonAiAssistant({
        claude: claudeStub,
        bedrock: null,
        model: "claude-sonnet-5",
        bedrockModel: "anthropic.claude-sonnet-5",
        search: null,
        logger,
      }),
      session: new RedisConversationSession(sessionRedis, { ttlSeconds: 60 }),
      products: new ProductApiRegistry(),
    });

    worker = createInboundWorker(
      { connection: workerRedis, concurrency: 2, prefix: queuePrefix },
      {
        pool,
        registry: new HandlerRegistry().register(personai),
        classifier: new ClaudeIntentClassifier({ client: null, model: "claude-sonnet-5", logger }),
        memory,
        sender,
        logger,
      },
    );

    app = await buildServer({
      logger,
      gateway: {
        verifyToken: VERIFY_TOKEN,
        appSecret: APP_SECRET,
        tenants: new TenantResolver(pool),
        deriveRef: (tenant, wa) => deriveUserRef(USER_REF_SECRET, tenant, wa),
        enqueue: async (job) => {
          await queue.add("inbound", job, { ...inboundJobOptions, jobId: job.messageId });
        },
      },
      memory: { memory, internalToken: INTERNAL_TOKEN },
      ops: { internalToken: INTERNAL_TOKEN, pool, queue },
    });
    await app.ready();
  });

  afterAll(async () => {
    await worker?.close();
    await queue?.close();
    await queueRedis?.quit();
    await workerRedis?.quit();
    await sessionRedis?.quit();
    await app?.close();
    await pool.query("DELETE FROM tenants WHERE id = $1", [tenantId]);
    await pool.end();
  });

  it("responde o handshake de verificação da Meta", async () => {
    const ok = await app.inject({
      method: "GET",
      url: `/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1234`,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe("1234");

    const recusado = await app.inject({
      method: "GET",
      url: "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1234",
    });
    expect(recusado.statusCode).toBe(403);
  });

  it("expõe status operacional só com token interno", async () => {
    const semToken = await app.inject({ method: "GET", url: "/internal/status" });
    expect(semToken.statusCode).toBe(401);

    const comToken = await app.inject({
      method: "GET",
      url: "/internal/status",
      headers: { "x-internal-token": INTERNAL_TOKEN },
    });
    expect(comToken.statusCode).toBe(200);
    expect(comToken.json()).toMatchObject({ database: "ok" });
    expect(comToken.json().queue).toHaveProperty("waiting");
  });

  it("recusa webhook com assinatura inválida", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/whatsapp",
      headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=" + "0".repeat(64) },
      payload: Buffer.from(JSON.stringify(textMessage("wamid.invalido", "oi"))),
    });

    expect(response.statusCode).toBe(401);
    expect(await queue.getJob("wamid.invalido")).toBeUndefined();
  });

  it("ignora mensagem de phone_number_id sem tenant", async () => {
    const response = await postWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "PN_desconhecido" },
                messages: [
                  { from: waId, id: "wamid.sem-tenant", timestamp: "1700000000", type: "text", text: { body: "oi" } },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ received: 1, queued: 0 });
  });

  it("entrega a mensagem ao handler e responde pelo WhatsApp", { timeout: 20_000 }, async () => {
    const messageId = `wamid.${randomUUID()}`;
    const response = await postWebhook(textMessage(messageId, "oi, tudo bem?"));
    expect(response.json()).toMatchObject({ received: 1, queued: 1 });

    const reply = await waitFor(() => sent.find((item) => item.to === waId));
    expect(reply.text).toContain(REPLY);
    // Primeiro contato: o aviso de privacidade vai junto da resposta.
    expect(reply.text).toContain("apagar minha memória");

    const log = await pool.query<{ status: string; product: string }>(
      "SELECT status, product FROM inbound_message_log WHERE message_id = $1",
      [messageId],
    );
    expect(log.rows[0]).toMatchObject({ status: "processed", product: "personai" });

    const { interactions, facts } = await memory.getContext(tenantId, userRef);
    expect(interactions[0]?.product).toBe("personai");
    // O que o assistente julgou digno de lembrar foi para o Serviço de Memória.
    expect(facts.map((fact) => fact.content)).toContain("gosta de café");
  });


  it("não responde duas vezes a mesma mensagem reentregue", { timeout: 20_000 }, async () => {
    const messageId = `wamid.${randomUUID()}`;
    await postWebhook(textMessage(messageId, "oi, tudo bem?"));
    await waitFor(() => (sent.length >= 2 ? sent.length : undefined));

    const antes = sent.length;
    await postWebhook(textMessage(messageId, "oi, tudo bem?"));
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    expect(sent.length).toBe(antes);
  });

  it(
    "apaga a memória do usuário quando ele pede pelo WhatsApp",
    { timeout: 20_000 },
    async () => {
      await memory.setPreference(tenantId, userRef, "tom", "informal");
      await memory.rememberFact(tenantId, userRef, "prefere ser chamada de Ana");

      const messageId = `wamid.${randomUUID()}`;
      await postWebhook(textMessage(messageId, "por favor, apagar minha memória"));

      const reply = await waitFor(() => sent.find((item) => item.text.startsWith("Pronto.")));
      expect(reply.text).toContain("preferência");

      // Exclusão a pedido não pode ser seguida de um novo registro sobre o usuário.
      expect(await memory.getContext(tenantId, userRef)).toEqual({
        preferences: {},
        facts: [],
        interactions: [],
      });
    },
  );
});
