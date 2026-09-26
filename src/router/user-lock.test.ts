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

  it("renova a posse e segue bloqueando mesmo depois da TTL inicial vencer", async () => {
    // TTL curta para o teste ser rápido: sem renovação, a trava sumiria em 1s.
    const lock = new RedisConversationLock(redis, { ttlSeconds: 1, maxWaitMs: 300, pollMs: 20 });
    const key = randomUUID();

    const release = await lock.acquire(key);
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    // Segurando a posse por mais tempo que a TTL: um segundo pedido precisa
    // continuar encontrando a trava ocupada, não vazia por falta de renovação.
    expect(await redis.get(`personai:lock:${key}`)).not.toBeNull();
    const releaseSegundo = await lock.acquire(key);
    expect(await redis.get(`personai:lock:${key}`)).not.toBeNull();

    await release();
    await releaseSegundo();
  });

  it("release de um token não derruba a posse de quem adquiriu depois", async () => {
    const lock = new RedisConversationLock(redis, { ttlSeconds: 1, pollMs: 20 });
    const key = randomUUID();

    const releaseAntigo = await lock.acquire(key);
    // Deixa a posse antiga expirar sem renovação simulada (evento não coberto
    // pelo timer normal): apaga a chave direto para representar "expirou".
    await redis.del(`personai:lock:${key}`);

    const releaseNovo = await lock.acquire(key);
    // O release do dono antigo não pode apagar a posse do dono novo.
    await releaseAntigo();
    expect(await redis.get(`personai:lock:${key}`)).not.toBeNull();

    await releaseNovo();
    expect(await redis.get(`personai:lock:${key}`)).toBeNull();
  });
});
