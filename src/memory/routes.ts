import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { timingSafeEqualString } from "../security.js";
import type { MemoryApi } from "./types.js";

const userSchema = z.object({
  tenantId: z.uuid(),
  userRef: z.string().min(16).max(128),
});

const preferenceSchema = userSchema.extend({
  key: z.string().min(1).max(64),
  value: z.string().min(1).max(1000),
});

const factSchema = userSchema.extend({
  content: z.string().min(1).max(500),
  source: z.string().max(120).optional(),
});

const interactionSchema = userSchema.extend({
  product: z.string().min(1).max(60),
  summary: z.string().min(1).max(500),
});

export interface MemoryRoutesOptions {
  memory: MemoryApi;
  internalToken: string;
}

/**
 * API interna da Camada C. Corpo em JSON (nunca query string) para que
 * identificador de usuário não caia em log de acesso.
 */
export async function registerMemoryRoutes(
  app: FastifyInstance,
  { memory, internalToken }: MemoryRoutesOptions,
): Promise<void> {
  const requireInternalToken = async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.headers["x-internal-token"];
    if (typeof token !== "string" || !timingSafeEqualString(token, internalToken)) {
      await reply.code(401).send({ error: "unauthorized" });
    }
  };

  const parseBody = <T extends z.ZodTypeAny>(schema: T, body: unknown, reply: FastifyReply) => {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      void reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
      return null;
    }
    return parsed.data as z.infer<T>;
  };

  app.post("/internal/memory/context", { preHandler: requireInternalToken }, async (req, reply) => {
    const body = parseBody(userSchema, req.body, reply);
    if (!body) return;
    return memory.getContext(body.tenantId, body.userRef);
  });

  app.put("/internal/memory/preferences", { preHandler: requireInternalToken }, async (req, reply) => {
    const body = parseBody(preferenceSchema, req.body, reply);
    if (!body) return;
    await memory.setPreference(body.tenantId, body.userRef, body.key, body.value);
    return reply.code(204).send();
  });

  app.post("/internal/memory/facts", { preHandler: requireInternalToken }, async (req, reply) => {
    const body = parseBody(factSchema, req.body, reply);
    if (!body) return;
    await memory.rememberFact(body.tenantId, body.userRef, body.content, body.source);
    return reply.code(204).send();
  });

  app.post("/internal/memory/interactions", { preHandler: requireInternalToken }, async (req, reply) => {
    const body = parseBody(interactionSchema, req.body, reply);
    if (!body) return;
    await memory.recordInteraction(body.tenantId, body.userRef, body.product, body.summary);
    return reply.code(204).send();
  });

  // Direito de esquecimento (LGPD art. 18, VI): exclusão imediata e auditável.
  app.post("/internal/memory/forget", { preHandler: requireInternalToken }, async (req, reply) => {
    const body = parseBody(userSchema, req.body, reply);
    if (!body) return;
    const result = await memory.forgetAll(body.tenantId, body.userRef);
    req.log.info({ tenantId: body.tenantId, deleted: result }, "memória do usuário excluída");
    return result;
  });
}
