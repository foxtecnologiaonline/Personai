import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool } from "./db/pool.js";
import { purgeExpiredData } from "./retention.js";

const DATABASE_URL = process.env["DATABASE_URL"];

describe.skipIf(!DATABASE_URL)("expurgo de dados expirados (integração)", () => {
  const pool = createPool(DATABASE_URL!);
  const userRef = randomUUID().replaceAll("-", "");
  let tenantId: string;

  beforeAll(async () => {
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO tenants (name, phone_number_id) VALUES ($1, $2) RETURNING id",
      ["Tenant de retenção", `PN_${randomUUID()}`],
    );
    tenantId = rows[0]!.id;

    await pool.query(
      `INSERT INTO inbound_message_log (message_id, tenant_id, status, received_at)
            VALUES ($1, $3, 'processed', now() - interval '120 days'),
                   ($2, $3, 'processed', now())`,
      [`wamid.antiga.${randomUUID()}`, `wamid.nova.${randomUUID()}`, tenantId],
    );

    await pool.query(
      `INSERT INTO memory.interactions (tenant_id, user_ref, product, summary, created_at)
            VALUES ($1, $2, 'personai', 'antiga', now() - interval '400 days'),
                   ($1, $2, 'personai', 'recente', now())`,
      [tenantId, userRef],
    );
  });

  afterAll(async () => {
    await pool.query("DELETE FROM tenants WHERE id = $1", [tenantId]);
    await pool.end();
  });

  it("apaga o que passou do prazo e mantém o que está dentro", async () => {
    const result = await purgeExpiredData(pool, {
      messageLogDays: 90,
      interactionDays: 180,
    });

    expect(result).not.toBeNull();

    const log = await pool.query(
      "SELECT count(*)::int AS total FROM inbound_message_log WHERE tenant_id = $1",
      [tenantId],
    );
    expect(log.rows[0]?.total).toBe(1);

    const interactions = await pool.query<{ summary: string }>(
      "SELECT summary FROM memory.interactions WHERE tenant_id = $1",
      [tenantId],
    );
    expect(interactions.rows.map((row) => row.summary)).toEqual(["recente"]);
  });

  it("não apaga nada quando o prazo é maior que a idade dos registros", async () => {
    const result = await purgeExpiredData(pool, {
      messageLogDays: 3_650,
      interactionDays: 3_650,
    });

    expect(result).toMatchObject({ messageLog: 0, interactions: 0 });
  });
});
