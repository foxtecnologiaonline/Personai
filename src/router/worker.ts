import { Worker } from "bullmq";
import type { Redis } from "ioredis";
import { INBOUND_QUEUE, type InboundJob } from "../queue/inbound.js";
import { dispatchInbound, type DispatchDeps } from "./dispatch.js";

export interface InboundWorkerOptions {
  connection: Redis;
  concurrency?: number;
  /** Precisa casar com o prefixo da fila (ver `createInboundQueue`). */
  prefix?: string;
}

export function createInboundWorker(
  { connection, concurrency = 10, prefix }: InboundWorkerOptions,
  deps: DispatchDeps,
): Worker<InboundJob> {
  const worker = new Worker<InboundJob>(
    INBOUND_QUEUE,
    async (job) => dispatchInbound(job.data, deps),
    { connection, concurrency, ...(prefix ? { prefix } : {}) },
  );

  worker.on("failed", (job, error) => {
    deps.logger.error(
      { messageId: job?.data.messageId, attempts: job?.attemptsMade, err: error },
      "falha ao processar mensagem",
    );
  });

  return worker;
}
