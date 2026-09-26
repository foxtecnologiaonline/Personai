import { randomUUID } from "node:crypto";
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

// Só libera ou renova quem detém o token — sem isto, um dono cuja posse já
// expirou apagaria (ou renovaria) a trava de quem a adquiriu depois dele.
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

const RENEW_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("expire", KEYS[1], ARGV[2])
end
return 0
`;

/**
 * Serializa o atendimento por usuário. Sem isto, duas mensagens em sequência
 * caem em workers diferentes, leem o mesmo estado e respondem em cima uma da
 * outra — o usuário recebe o aviso de privacidade duas vezes e a segunda
 * resposta ignora a primeira.
 *
 * A posse é renovada periodicamente enquanto durar o processamento (busca +
 * modelo + gravação de memória facilmente passam da TTL inicial) — sem
 * renovação, a trava expiraria no meio de uma resposta lenta e reabriria
 * exatamente a corrida que ela existe para fechar. Se o processo morrer, a
 * renovação para e a trava expira sozinha.
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
    this.maxWaitMs = options.maxWaitMs ?? 15_000;
    this.pollMs = options.pollMs ?? 150;
  }

  async acquire(key: string): Promise<() => Promise<void>> {
    const redisKey = `personai:lock:${key}`;
    const token = randomUUID();
    const deadline = Date.now() + this.maxWaitMs;

    for (;;) {
      const acquired = await this.redis.set(redisKey, token, "EX", this.ttlSeconds, "NX");
      if (acquired) return this.holdWithRenewal(redisKey, token);
      if (Date.now() >= deadline) return noop;
      await new Promise((resolve) => setTimeout(resolve, this.pollMs));
    }
  }

  private holdWithRenewal(redisKey: string, token: string): () => Promise<void> {
    const interval = setInterval(() => {
      this.redis.eval(RENEW_SCRIPT, 1, redisKey, token, this.ttlSeconds).catch(() => undefined);
    }, (this.ttlSeconds * 1000) / 3);
    interval.unref();

    return async () => {
      clearInterval(interval);
      await this.redis.eval(RELEASE_SCRIPT, 1, redisKey, token).catch(() => undefined);
    };
  }
}
