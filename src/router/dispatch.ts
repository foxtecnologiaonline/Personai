import type pg from "pg";
import type { HandlerReply, NormalizedMessage, ProductId } from "../domain/types.js";
import type { WhatsAppSender } from "../gateway/whatsapp.js";
import type { Logger } from "../logger.js";
import type { MemoryApi } from "../memory/types.js";
import type { InboundJob } from "../queue/inbound.js";
import type { IntentClassifier } from "./classifier.js";
import type { HandlerRegistry } from "./registry.js";

const UNAVAILABLE_REPLY =
  "Recebi sua mensagem. Esse atendimento ainda está sendo ativado neste canal — em breve respondo por aqui.";

const UNSUPPORTED_REPLY =
  "Por enquanto consigo ler só mensagens de texto. Pode me escrever o que você precisa?";

export interface DispatchDeps {
  pool: pg.Pool;
  registry: HandlerRegistry;
  classifier: IntentClassifier;
  memory: MemoryApi;
  sender: WhatsAppSender;
  logger: Logger;
}

export interface DispatchResult {
  status: "processed" | "duplicate" | "no_reply";
  product?: ProductId;
}

/**
 * Reivindica a mensagem. Reentrega da Meta depois de processada não passa;
 * retentativa de uma tentativa que falhou passa — senão a mensagem ficaria sem
 * resposta para sempre.
 */
async function claim(pool: pg.Pool, job: InboundJob): Promise<boolean> {
  const { rowCount } = await pool.query(
    `INSERT INTO inbound_message_log (message_id, tenant_id, status)
          VALUES ($1, $2, 'processing')
     ON CONFLICT (message_id)
     DO UPDATE SET status = 'processing'
          WHERE inbound_message_log.status <> 'processed'
       RETURNING message_id`,
    [job.messageId, job.tenantId],
  );
  return (rowCount ?? 0) > 0;
}

export async function dispatchInbound(
  job: InboundJob,
  deps: DispatchDeps,
): Promise<DispatchResult> {
  if (!(await claim(deps.pool, job))) {
    deps.logger.debug({ messageId: job.messageId }, "mensagem já processada, ignorando reentrega");
    return { status: "duplicate" };
  }

  const message: NormalizedMessage = { ...job, timestamp: new Date(job.timestamp) };

  const intent =
    message.kind === "unsupported"
      ? null
      : await deps.classifier.classify(message.text);

  let reply: HandlerReply | null;
  let product: ProductId;

  if (!intent) {
    product = "personai";
    reply = { text: UNSUPPORTED_REPLY };
  } else {
    product = intent.product;
    const handler = deps.registry.get(product);
    reply = handler
      ? await handler.handle(message, { memory: deps.memory, logger: deps.logger })
      : { text: UNAVAILABLE_REPLY };
  }

  if (reply) {
    await deps.sender.sendText(job.phoneNumberId, job.waId, reply.text);
  }

  await deps.pool.query(
    `UPDATE inbound_message_log
        SET status = 'processed', product = $2, processed_at = now()
      WHERE message_id = $1`,
    [job.messageId, product],
  );

  // Registrar a interação logo após uma exclusão a pedido recriaria memória do
  // usuário no mesmo instante em que ele pediu para ser esquecido.
  if (reply?.skipMemory) {
    return { status: "processed", product };
  }

  // Histórico de interação é best-effort: não pode derrubar uma resposta já enviada.
  await deps.memory
    .recordInteraction(
      job.tenantId,
      job.userRef,
      product,
      `mensagem roteada para ${product}${intent ? ` (${intent.source})` : " (tipo não suportado)"}`,
    )
    .catch((error: unknown) => {
      deps.logger.warn({ err: error }, "falha ao registrar interação na memória");
    });

  deps.logger.info(
    { messageId: job.messageId, product, source: intent?.source ?? "unsupported" },
    "mensagem processada",
  );

  return { status: reply ? "processed" : "no_reply", product };
}
