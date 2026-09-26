import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  // Só ligar atrás de proxy confiável: com isto, o IP do cliente vem do
  // X-Forwarded-For, que qualquer um forja se a requisição chega direto.
  TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),

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

  // Prazo de guarda (LGPD): passou disto, é apagado automaticamente.
  MESSAGE_LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  INTERACTION_RETENTION_DAYS: z.coerce.number().int().positive().default(180),
  RETENTION_INTERVAL_HOURS: z.coerce.number().int().positive().default(6),

  // PersonAI
  PERSONAI_MODEL: z.string().default("claude-sonnet-5"),
  PERSONAI_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(3_600),
  // Teto por chamada de modelo. Sem isto, o SDK espera até 10 min (com retry,
  // ainda mais) antes de falhar — o fallback do Bedrock nunca chegaria a
  // tempo de valer a pena numa conversa de WhatsApp.
  PERSONAI_MODEL_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  PERPLEXITY_API_KEY: z.string().optional(),
  PERPLEXITY_MODEL: z.string().default("sonar"),

  // Redundância de modelo. Usa as credenciais AWS padrão do ambiente.
  BEDROCK_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  BEDROCK_REGION: z.string().default("us-east-1"),
  BEDROCK_MODEL: z.string().default("anthropic.claude-sonnet-5"),
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
