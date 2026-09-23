import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  WHATSAPP_VERIFY_TOKEN: z.string().min(16),
  WHATSAPP_APP_SECRET: z.string().min(16),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1),
  WHATSAPP_GRAPH_VERSION: z.string().default("v21.0"),

  // Chave do HMAC que pseudonimiza o usuário antes de qualquer persistência.
  // Trocar esta chave torna toda a memória existente inalcançável.
  USER_REF_SECRET: z.string().min(32),
  INTERNAL_API_TOKEN: z.string().min(24),

  ANTHROPIC_API_KEY: z.string().optional(),
  CLASSIFIER_MODEL: z.string().default("claude-sonnet-5"),
  CLASSIFIER_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Configuração inválida:\n${details}`);
  }
  return parsed.data;
}
