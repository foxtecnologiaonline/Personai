import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { createPool } from "./pool.js";

// Vale tanto rodando de src/db (tsx) quanto de dist/db (build).
const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");

// Trava de sessão: duas instâncias subindo ao mesmo tempo não aplicam a mesma
// migração duas vezes.
const LOCK_KEY = 8_273_411;

export async function runMigrations(pool: pg.Pool, dir = MIGRATIONS_DIR): Promise<string[]> {
  const lock = await pool.connect();
  const applied: string[] = [];
  try {
    await lock.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    await lock.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    const { rows } = await lock.query<{ name: string }>("SELECT name FROM schema_migrations");
    const done = new Set(rows.map((r) => r.name));

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(join(dir, file), "utf8");
      try {
        await lock.query("BEGIN");
        await lock.query(sql);
        await lock.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await lock.query("COMMIT");
        applied.push(file);
      } catch (error) {
        await lock.query("ROLLBACK");
        throw new Error(`Falha na migração ${file}: ${(error as Error).message}`, { cause: error });
      }
    }
    return applied;
  } finally {
    await lock.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => undefined);
    lock.release();
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    console.error("DATABASE_URL não definida.");
    process.exit(1);
  }
  const pool = createPool(databaseUrl);
  try {
    const applied = await runMigrations(pool);
    console.log(applied.length ? `Aplicadas: ${applied.join(", ")}` : "Nada a aplicar.");
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
