import type pg from "pg";
import type {
  ForgetResult,
  MemoryApi,
  MemoryContext,
  MemoryContextOptions,
} from "./types.js";

const DEFAULT_FACT_LIMIT = 20;
const DEFAULT_INTERACTION_LIMIT = 10;

export class PgMemoryRepository implements MemoryApi {
  constructor(private readonly pool: pg.Pool) {}

  async getContext(
    tenantId: string,
    userRef: string,
    options: MemoryContextOptions = {},
  ): Promise<MemoryContext> {
    const factLimit = options.factLimit ?? DEFAULT_FACT_LIMIT;
    const interactionLimit = options.interactionLimit ?? DEFAULT_INTERACTION_LIMIT;

    const [preferences, facts, interactions] = await Promise.all([
      this.pool.query<{ key: string; value: string }>(
        "SELECT key, value FROM memory.preferences WHERE tenant_id = $1 AND user_ref = $2",
        [tenantId, userRef],
      ),
      this.pool.query<{ content: string; source: string | null; last_seen_at: Date }>(
        `SELECT content, source, last_seen_at
           FROM memory.facts
          WHERE tenant_id = $1 AND user_ref = $2
          ORDER BY last_seen_at DESC
          LIMIT $3`,
        [tenantId, userRef, factLimit],
      ),
      this.pool.query<{ product: string; summary: string; created_at: Date }>(
        `SELECT product, summary, created_at
           FROM memory.interactions
          WHERE tenant_id = $1 AND user_ref = $2
          ORDER BY created_at DESC
          LIMIT $3`,
        [tenantId, userRef, interactionLimit],
      ),
    ]);

    return {
      preferences: Object.fromEntries(preferences.rows.map((row) => [row.key, row.value])),
      facts: facts.rows.map((row) => ({
        content: row.content,
        source: row.source,
        lastSeenAt: row.last_seen_at,
      })),
      interactions: interactions.rows.map((row) => ({
        product: row.product,
        summary: row.summary,
        createdAt: row.created_at,
      })),
    };
  }

  async setPreference(
    tenantId: string,
    userRef: string,
    key: string,
    value: string,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO memory.preferences (tenant_id, user_ref, key, value)
            VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, user_ref, key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [tenantId, userRef, key, value],
    );
  }

  async rememberFact(
    tenantId: string,
    userRef: string,
    content: string,
    source?: string,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO memory.facts (tenant_id, user_ref, content, source)
            VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, user_ref, content)
       DO UPDATE SET last_seen_at = now(), source = COALESCE(EXCLUDED.source, memory.facts.source)`,
      [tenantId, userRef, content, source ?? null],
    );
  }

  async recordInteraction(
    tenantId: string,
    userRef: string,
    product: string,
    summary: string,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO memory.interactions (tenant_id, user_ref, product, summary)
            VALUES ($1, $2, $3, $4)`,
      [tenantId, userRef, product, summary],
    );
  }

  async forgetAll(tenantId: string, userRef: string): Promise<ForgetResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const request = await client.query<{ id: string }>(
        `INSERT INTO memory.deletion_requests (tenant_id, user_ref) VALUES ($1, $2) RETURNING id`,
        [tenantId, userRef],
      );

      const deleted = { preferences: 0, facts: 0, interactions: 0 };
      for (const table of ["preferences", "facts", "interactions"] as const) {
        const result = await client.query(
          `DELETE FROM memory.${table} WHERE tenant_id = $1 AND user_ref = $2`,
          [tenantId, userRef],
        );
        deleted[table] = result.rowCount ?? 0;
      }

      const completed = await client.query<{ completed_at: Date }>(
        `UPDATE memory.deletion_requests
            SET completed_at = now(), deleted_counts = $2
          WHERE id = $1
      RETURNING completed_at`,
        [request.rows[0]?.id, JSON.stringify(deleted)],
      );
      await client.query("COMMIT");

      return { ...deleted, completedAt: completed.rows[0]?.completed_at ?? new Date() };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
