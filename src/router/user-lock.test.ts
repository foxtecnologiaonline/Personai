import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createRedis } from "../queue/inbound.js";
import { RedisConversationLock } from "./user-lock.js";

const REDIS_URL = process.env["REDIS_URL"];

describe.skipIf(!REDIS_URL)("RedisConversationLock (integração)", () => {
  const redis = createRedis(REDIS_URL!);

  afterAll(async () => {
    await redis.quit();
  });

  it("faz o segundo esperar até o primeiro liberar", async () => {
    const lock = new RedisConversationLock(redis, { pollMs: 20 });
    const key = randomUUID();
    const ordem: string[] = [];

    const release = await lock.acquire(key);

    const segundo = lock.acquire(key).then(async (releaseSegundo) => {
      ordem.push("segundo entrou");
      await releaseSegundo();
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    ordem.push("primeiro saiu");
    await release();

    await segundo;
    expect(ordem).toEqual(["primeiro saiu", "segundo entrou"]);
  });

  it("desiste depois do teto de espera em vez de travar a mensagem", async () => {
    const lock = new RedisConversationLock(redis, { maxWaitMs: 150, pollMs: 20 });
    const key = randomUUID();

    await lock.acquire(key);
    const inicio = Date.now();
    const release = await lock.acquire(key);

    expect(Date.now() - inicio).toBeGreaterThanOrEqual(140);
    await expect(release()).resolves.toBeUndefined();
  });

  it("expira sozinha se quem segurava morreu", async () => {
    const lock = new RedisConversationLock(redis, { ttlSeconds: 1, pollMs: 20 });
    const key = randomUUID();

    await lock.acquire(key);
    expect(await redis.ttl(`personai:lock:${key}`)).toBeGreaterThan(0);
  });
});
