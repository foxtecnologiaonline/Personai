import type { Redis } from "ioredis";

export interface ConversationTurn {
  role: "user" | "assistant";
  text: string;
}

export interface ConversationSession {
  load(tenantId: string, userRef: string): Promise<ConversationTurn[]>;
  append(tenantId: string, userRef: string, turns: ConversationTurn[]): Promise<void>;
  clear(tenantId: string, userRef: string): Promise<void>;
}

export interface SessionOptions {
  ttlSeconds?: number;
  maxTurns?: number;
}

/**
 * Contexto curto da conversa, o que o assistente precisa para não perder o fio
 * entre uma mensagem e a próxima.
 *
 * Fica só no Redis, com TTL: conteúdo de conversa é o dado mais sensível do
 * fluxo e não tem por que virar registro permanente. O que merece durar sai
 * daqui como fato ou preferência e vai para o Serviço de Memória.
 */
export class RedisConversationSession implements ConversationSession {
  private readonly ttlSeconds: number;
  private readonly maxTurns: number;

  constructor(
    private readonly redis: Redis,
    options: SessionOptions = {},
  ) {
    this.ttlSeconds = options.ttlSeconds ?? 3_600;
    this.maxTurns = options.maxTurns ?? 12;
  }

  private key(tenantId: string, userRef: string): string {
    return `personai:conv:${tenantId}:${userRef}`;
  }

  async load(tenantId: string, userRef: string): Promise<ConversationTurn[]> {
    const raw = await this.redis.lrange(this.key(tenantId, userRef), 0, -1);
    const turns: ConversationTurn[] = [];
    for (const item of raw) {
      try {
        turns.push(JSON.parse(item) as ConversationTurn);
      } catch {
        // Entrada corrompida não pode derrubar a conversa inteira.
      }
    }
    return turns;
  }

  async append(tenantId: string, userRef: string, turns: ConversationTurn[]): Promise<void> {
    if (turns.length === 0) return;
    const key = this.key(tenantId, userRef);

    await this.redis
      .multi()
      .rpush(key, ...turns.map((turn) => JSON.stringify(turn)))
      .ltrim(key, -this.maxTurns, -1)
      .expire(key, this.ttlSeconds)
      .exec();
  }

  async clear(tenantId: string, userRef: string): Promise<void> {
    await this.redis.del(this.key(tenantId, userRef));
  }
}
