import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool } from "../db/pool.js";
import { PgMemoryRepository } from "./repository.js";

const DATABASE_URL = process.env["DATABASE_URL"];

describe.skipIf(!DATABASE_URL)("PgMemoryRepository (integração)", () => {
  const pool = createPool(DATABASE_URL!);
  const memory = new PgMemoryRepository(pool);
  const userRef = randomUUID().replaceAll("-", "");
  let tenantId: string;

  beforeAll(async () => {
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO tenants (name, phone_number_id) VALUES ($1, $2) RETURNING id",
      ["Tenant de teste", `PN_${randomUUID()}`],
    );
    tenantId = rows[0]!.id;
  });

  afterAll(async () => {
    await pool.query("DELETE FROM tenants WHERE id = $1", [tenantId]);
    await pool.end();
  });

  it("sobrescreve preferência existente em vez de duplicar", async () => {
    await memory.setPreference(tenantId, userRef, "canal_preferido", "whatsapp");
    await memory.setPreference(tenantId, userRef, "canal_preferido", "email");

    const context = await memory.getContext(tenantId, userRef);
    expect(context.preferences).toEqual({ canal_preferido: "email" });
  });

  it("reforça fato repetido sem criar linha nova", async () => {
    await memory.rememberFact(tenantId, userRef, "é MEI desde 2021", "onboarding");
    await memory.rememberFact(tenantId, userRef, "é MEI desde 2021");

    const { facts } = await memory.getContext(tenantId, userRef);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ content: "é MEI desde 2021", source: "onboarding" });
  });

  it("devolve interações mais recentes primeiro, respeitando o limite", async () => {
    for (const product of ["personai", "monneyhub-zap", "normas-ia"]) {
      await memory.recordInteraction(tenantId, userRef, product, `roteada para ${product}`);
    }

    const { interactions } = await memory.getContext(tenantId, userRef, { interactionLimit: 2 });
    expect(interactions).toHaveLength(2);
    expect(interactions[0]?.product).toBe("normas-ia");
  });

  it("isola memória entre tenants", async () => {
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO tenants (name, phone_number_id) VALUES ($1, $2) RETURNING id",
      ["Outro tenant", `PN_${randomUUID()}`],
    );
    const outroTenant = rows[0]!.id;

    const context = await memory.getContext(outroTenant, userRef);
    expect(context).toEqual({ preferences: {}, facts: [], interactions: [] });

    await pool.query("DELETE FROM tenants WHERE id = $1", [outroTenant]);
  });

  it("apaga tudo e registra a exclusão para auditoria", async () => {
    const deleted = await memory.forgetAll(tenantId, userRef);

    expect(deleted).toMatchObject({ preferences: 1, facts: 1, interactions: 3 });
    expect(await memory.getContext(tenantId, userRef)).toEqual({
      preferences: {},
      facts: [],
      interactions: [],
    });

    const audit = await pool.query<{ completed_at: Date | null; deleted_counts: unknown }>(
      "SELECT completed_at, deleted_counts FROM memory.deletion_requests WHERE tenant_id = $1 AND user_ref = $2",
      [tenantId, userRef],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.completed_at).toBeInstanceOf(Date);
    expect(audit.rows[0]?.deleted_counts).toMatchObject({ facts: 1, interactions: 3 });
  });
});
