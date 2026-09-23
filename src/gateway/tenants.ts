import type pg from "pg";

export interface Tenant {
  id: string;
  name: string;
  phoneNumberId: string;
}

interface CacheEntry {
  tenant: Tenant | null;
  expiresAt: number;
}

/**
 * Resolve o tenant pelo `phone_number_id` do webhook. Cacheia inclusive a
 * ausência: número desconhecido (ou spam) não vira consulta por mensagem.
 */
export class TenantResolver {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly pool: pg.Pool,
    private readonly ttlMs = 60_000,
  ) {}

  async byPhoneNumberId(phoneNumberId: string): Promise<Tenant | null> {
    const cached = this.cache.get(phoneNumberId);
    if (cached && cached.expiresAt > Date.now()) return cached.tenant;

    const { rows } = await this.pool.query<{ id: string; name: string; phone_number_id: string }>(
      `SELECT id, name, phone_number_id
         FROM tenants
        WHERE phone_number_id = $1 AND active
        LIMIT 1`,
      [phoneNumberId],
    );

    const row = rows[0];
    const tenant: Tenant | null = row
      ? { id: row.id, name: row.name, phoneNumberId: row.phone_number_id }
      : null;

    this.cache.set(phoneNumberId, { tenant, expiresAt: Date.now() + this.ttlMs });
    return tenant;
  }
}
