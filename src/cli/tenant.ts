import { createPool } from "../db/pool.js";

const USAGE = `Gerenciamento de tenants.

  npm run tenant -- add --name "Cliente X" --phone-number-id 123456 [--waba-id 789]
  npm run tenant -- list
  npm run tenant -- disable --phone-number-id 123456

Rodar "add" com um phone-number-id já existente atualiza o cadastro e reativa o tenant.`;

const args = process.argv.slice(2);
const command = args[0];

function flag(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) fail("DATABASE_URL não definida.");

const pool = createPool(databaseUrl);

try {
  switch (command) {
    case "add": {
      const name = flag("name");
      const phoneNumberId = flag("phone-number-id");
      if (!name || !phoneNumberId) fail("Informe --name e --phone-number-id.\n\n" + USAGE);

      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO tenants (name, phone_number_id, waba_id)
              VALUES ($1, $2, $3)
         ON CONFLICT (phone_number_id)
         DO UPDATE SET name = EXCLUDED.name,
                       waba_id = COALESCE(EXCLUDED.waba_id, tenants.waba_id),
                       active = true
           RETURNING id`,
        [name, phoneNumberId, flag("waba-id") ?? null],
      );
      console.log(`Tenant pronto: ${rows[0]?.id}`);
      break;
    }

    case "list": {
      const { rows } = await pool.query(
        "SELECT id, name, phone_number_id, active FROM tenants ORDER BY created_at",
      );
      console.table(rows);
      break;
    }

    case "disable": {
      const phoneNumberId = flag("phone-number-id");
      if (!phoneNumberId) fail("Informe --phone-number-id.\n\n" + USAGE);

      const { rowCount } = await pool.query(
        "UPDATE tenants SET active = false WHERE phone_number_id = $1",
        [phoneNumberId],
      );
      console.log(rowCount ? "Tenant desativado." : "Nenhum tenant com esse phone_number_id.");
      break;
    }

    default:
      console.log(USAGE);
      process.exitCode = command ? 1 : 0;
  }
} finally {
  await pool.end();
}
