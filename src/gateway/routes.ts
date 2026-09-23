import type { FastifyInstance } from "fastify";
import type { InboundJob } from "../queue/inbound.js";
import { timingSafeEqualString } from "../security.js";
import { extractInboundMessages } from "./normalize.js";
import { verifyMetaSignature } from "./signature.js";
import type { TenantResolver } from "./tenants.js";

export interface GatewayRoutesOptions {
  verifyToken: string;
  appSecret: string;
  tenants: TenantResolver;
  deriveRef: (tenantId: string, waId: string) => string;
  enqueue: (job: InboundJob) => Promise<void>;
}

export async function registerGatewayRoutes(
  app: FastifyInstance,
  options: GatewayRoutesOptions,
): Promise<void> {
  // Handshake de verificação do webhook (Meta chama uma vez, no cadastro).
  app.get("/webhooks/whatsapp", async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const challenge = query["hub.challenge"];
    const token = query["hub.verify_token"];

    if (
      query["hub.mode"] === "subscribe" &&
      challenge &&
      token &&
      timingSafeEqualString(token, options.verifyToken)
    ) {
      return reply.type("text/plain").send(challenge);
    }
    return reply.code(403).send({ error: "forbidden" });
  });

  app.post("/webhooks/whatsapp", async (request, reply) => {
    const rawBody = request.rawBody;
    const signature = request.headers["x-hub-signature-256"];

    if (
      !rawBody ||
      !verifyMetaSignature(
        rawBody,
        typeof signature === "string" ? signature : undefined,
        options.appSecret,
      )
    ) {
      request.log.warn("webhook recusado: assinatura inválida");
      return reply.code(401).send({ error: "invalid_signature" });
    }

    const messages = extractInboundMessages(request.body);
    let queued = 0;

    for (const message of messages) {
      const tenant = await options.tenants.byPhoneNumberId(message.phoneNumberId);
      if (!tenant) {
        request.log.warn(
          { phoneNumberId: message.phoneNumberId },
          "phone_number_id sem tenant ativo",
        );
        continue;
      }

      await options.enqueue({
        messageId: message.messageId,
        tenantId: tenant.id,
        phoneNumberId: message.phoneNumberId,
        waId: message.waId,
        userRef: options.deriveRef(tenant.id, message.waId),
        text: message.text,
        kind: message.kind,
        rawType: message.rawType,
        timestamp: message.timestamp.toISOString(),
        profileName: message.profileName,
      });
      queued += 1;
    }

    return reply.code(200).send({ received: messages.length, queued });
  });
}
