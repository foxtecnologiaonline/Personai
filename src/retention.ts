import type pg from "pg";
import type { Logger } from "./logger.js";

/** Trava para que várias instâncias não expurguem ao mesmo tempo. */
const LOCK_KEY = 8_273_412;

export interface RetentionOptions {
  messageLogDays: number;
  interactionDays: number;
}

export interface PurgeResult {
  messageLog: number;
  interactions: number;
}

/**
 * Dado pessoal não pode ficar guardado por prazo indeterminado (LGPD art. 15,
 * I e art. 16): o log de roteamento e o histórico de interação têm prazo, e
 * quem passou do prazo é apagado.
 */
export async function purgeExpiredData(
  pool: pg.Pool,
  options: RetentionOptions,
): Promise<PurgeResult | null> {
  const client = await pool.connect();
  try {
    const lock = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS acquired",
      [LOCK_KEY],
    );
    if (!lock.rows[0]?.acquired) return null;

    try {
      const messageLog = await client.query(
        "DELETE FROM inbound_message_log WHERE received_at < now() - make_interval(days => $1)",
        [options.messageLogDays],
      );
      const interactions = await client.query(
        "DELETE FROM memory.interactions WHERE created_at < now() - make_interval(days => $1)",
        [options.interactionDays],
      );

      return {
        messageLog: messageLog.rowCount ?? 0,
        interactions: interactions.rowCount ?? 0,
      };
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

export function startRetentionSchedule(
  pool: pg.Pool,
  options: RetentionOptions & { intervalHours: number },
  logger: Logger,
): () => void {
  const run = () => {
    purgeExpiredData(pool, options)
      .then((result) => {
        if (result && (result.messageLog > 0 || result.interactions > 0)) {
          logger.info(result, "expurgo de dados expirados concluído");
        }
      })
      .catch((error: unknown) => logger.error({ err: error }, "falha no expurgo de dados"));
  };

  run();
  const timer = setInterval(run, options.intervalHours * 60 * 60 * 1_000);
  timer.unref();
  return () => clearInterval(timer);
}
