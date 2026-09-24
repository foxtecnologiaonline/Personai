import type { Redis } from "ioredis";

export interface ConversationLock {
  /** Devolve uma função de liberação. Nunca falha: no pior caso, segue sem a trava. */
  acquire(key: string): Promise<() => Promise<void>>;
}

export interface ConversationLockOptions {
  /** Expira sozinha: processo que morre segurando a trava não trava o usuário. */
  ttlSeconds?: number;
  maxWaitMs?: number;
  pollMs?: number;
}

const noop = async () => {};

/**
 * Serializa o atendimento por usuário. Sem isto, duas mensagens em sequência
 * caem em workers diferentes, leem o mesmo estado e respondem em cima uma da
 * outra — o usuário recebe o aviso de privacidade duas vezes e a segunda
 * resposta ignora a primeira.
 *
 * Espera limitada: passado o teto, segue mesmo assim. Responder fora de ordem
 * é ruim; não responder é pior.
 */
export class RedisConversationLock implements ConversationLock {
  private readonly ttlSeconds: number;
  private readonly maxWaitMs: number;
  private readonly pollMs: number;

  constructor(
    private readonly redis: Redis,
    options: ConversationLockOptions = {},
  ) {
    this.ttlSeconds = options.ttlSeconds ?? 30;
    this.maxWaitMs = options.maxWaitMs ?? 10_000;
    this.pollMs = options.pollMs ?? 150;
  }

  async acquire(key: string): Promise<() => Promise<void>> {
    const redisKey = `personai:lock:${key}`;
    const deadline = Date.now() + this.maxWaitMs;

    for (;;) {
      const acquired = await this.redis.set(redisKey, "1", "EX", this.ttlSeconds, "NX");
      if (acquired) {
        return async () => {
          await this.redis.del(redisKey).catch(() => undefined);
        };
      }
      if (Date.now() >= deadline) return noop;
      await new Promise((resolve) => setTimeout(resolve, this.pollMs));
    }
  }
}
