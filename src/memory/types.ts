export interface MemoryFact {
  content: string;
  source: string | null;
  lastSeenAt: Date;
}

export interface MemoryInteraction {
  product: string;
  summary: string;
  createdAt: Date;
}

export interface MemoryContext {
  preferences: Record<string, string>;
  facts: MemoryFact[];
  interactions: MemoryInteraction[];
}

export interface ForgetResult {
  preferences: number;
  facts: number;
  interactions: number;
  completedAt: Date;
}

export interface MemoryContextOptions {
  factLimit?: number;
  interactionLimit?: number;
}

/**
 * API interna do Serviço de Memória/Contexto (Camada C). Não pertence a nenhum
 * produto: qualquer um que precise lembrar preferência ou contexto consome isto.
 */
export interface MemoryApi {
  getContext(
    tenantId: string,
    userRef: string,
    options?: MemoryContextOptions,
  ): Promise<MemoryContext>;
  setPreference(tenantId: string, userRef: string, key: string, value: string): Promise<void>;
  rememberFact(tenantId: string, userRef: string, content: string, source?: string): Promise<void>;
  recordInteraction(
    tenantId: string,
    userRef: string,
    product: string,
    summary: string,
  ): Promise<void>;
  /** Exclusão total e imediata, com trilha de auditoria. */
  forgetAll(tenantId: string, userRef: string): Promise<ForgetResult>;
}
