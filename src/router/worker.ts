import { Worker } from "bullmq";
import type { Redis } from "ioredis";
import { INBOUND_QUEUE, type InboundJob } from "../queue/inbound.js";
import { dispatchInbound, type DispatchDeps } from "./dispatch.js";

export interface InboundWorkerOptions {
  connection: Redis;
  concurrency?: number;
}

export function createInboundWorker(
  { connection, concurrency = 10 }: InboundWorkerOptions,
  deps: DispatchDeps,
): Worker<InboundJob> {
  const worker = new Worker<InboundJob>(
    INBOUND_QUEUE,
    async (job) => dispatchInbound(job.data, deps),
    { connection, concurrency },
  );

  worker.on("failed", (job, error) => {
    deps.logger.error(
      { messageId: job?.data.messageId, attempts: job?.attemptsMade, err: error },
      "falha ao processar mensagem",
    );
  });

  return worker;
}
