import { Queue, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";
import type { MessageKind } from "../domain/types.js";

// BullMQ não aceita ":" em nome de fila (colide com o namespace de chaves do Redis).
export const INBOUND_QUEUE = "whatsapp-inbound";

export interface InboundJob {
  messageId: string;
  tenantId: string;
  phoneNumberId: string;
  waId: string;
  userRef: string;
  text: string;
  kind: MessageKind;
  rawType: string;
  /** ISO 8601 — o payload do job precisa ser serializável. */
  timestamp: string;
  profileName?: string;
}

/**
 * O job carrega conteúdo de mensagem e telefone do usuário enquanto está na
 * fila. `removeOnComplete` limita essa retenção a 24h, que é também a janela de
 * deduplicação por `jobId` contra reentrega do webhook da Meta.
 */
export const inboundJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 1_000 },
  removeOnComplete: { age: 86_400, count: 10_000 },
  removeOnFail: { age: 604_800 },
};

// BullMQ exige maxRetriesPerRequest: null na conexão usada por workers.
export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}

export function createInboundQueue(connection: Redis): Queue<InboundJob> {
  return new Queue<InboundJob>(INBOUND_QUEUE, { connection });
}
