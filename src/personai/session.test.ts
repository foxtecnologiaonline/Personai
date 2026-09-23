import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createRedis } from "../queue/inbound.js";
import { RedisConversationSession } from "./session.js";

const REDIS_URL = process.env["REDIS_URL"];

describe.skipIf(!REDIS_URL)("RedisConversationSession (integração)", () => {
  const redis = createRedis(REDIS_URL!);
  const session = new RedisConversationSession(redis, { ttlSeconds: 60, maxTurns: 4 });
  const tenantId = randomUUID();
  const userRef = randomUUID().replaceAll("-", "");

  afterAll(async () => {
    await session.clear(tenantId, userRef);
    await redis.quit();
  });

  it("devolve vazio quando não há conversa", async () => {
    expect(await session.load(tenantId, userRef)).toEqual([]);
  });

  it("guarda os turnos na ordem em que aconteceram", async () => {
    await session.append(tenantId, userRef, [
      { role: "user", text: "oi" },
      { role: "assistant", text: "olá!" },
    ]);

    expect(await session.load(tenantId, userRef)).toEqual([
      { role: "user", text: "oi" },
      { role: "assistant", text: "olá!" },
    ]);
  });

  it("mantém só os turnos mais recentes", async () => {
    await session.append(tenantId, userRef, [
      { role: "user", text: "pergunta 2" },
      { role: "assistant", text: "resposta 2" },
      { role: "user", text: "pergunta 3" },
      { role: "assistant", text: "resposta 3" },
    ]);

    const turns = await session.load(tenantId, userRef);
    expect(turns).toHaveLength(4);
    expect(turns[0]).toEqual({ role: "user", text: "pergunta 2" });
  });

  it("define expiração na conversa", async () => {
    const ttl = await redis.ttl(`personai:conv:${tenantId}:${userRef}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  it("apaga a conversa quando pedido", async () => {
    await session.clear(tenantId, userRef);
    expect(await session.load(tenantId, userRef)).toEqual([]);
  });
});
