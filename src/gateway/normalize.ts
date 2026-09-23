import type { InboundMessage, MessageKind } from "../domain/types.js";

const prop = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

function parseTimestamp(value: unknown): Date {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date();
}

function extractContent(message: unknown, rawType: string): { text: string; kind: MessageKind } {
  switch (rawType) {
    case "text":
      return { text: asString(prop(prop(message, "text"), "body")) ?? "", kind: "text" };
    case "button":
      return { text: asString(prop(prop(message, "button"), "text")) ?? "", kind: "interactive" };
    case "interactive": {
      const interactive = prop(message, "interactive");
      const title =
        asString(prop(prop(interactive, "button_reply"), "title")) ??
        asString(prop(prop(interactive, "list_reply"), "title"));
      return { text: title ?? "", kind: "interactive" };
    }
    default:
      return { text: "", kind: "unsupported" };
  }
}

/**
 * Extrai mensagens de usuário do payload do webhook da Meta. Eventos de status
 * (entregue/lido) e formatos desconhecidos não derrubam o lote — o webhook
 * precisa responder 200 sempre que a assinatura for válida.
 */
export function extractInboundMessages(payload: unknown): InboundMessage[] {
  const messages: InboundMessage[] = [];

  for (const entry of asArray(prop(payload, "entry"))) {
    for (const change of asArray(prop(entry, "changes"))) {
      const value = prop(change, "value");
      const phoneNumberId = asString(prop(prop(value, "metadata"), "phone_number_id"));
      if (!phoneNumberId) continue;

      const names = new Map<string, string>();
      for (const contact of asArray(prop(value, "contacts"))) {
        const waId = asString(prop(contact, "wa_id"));
        const name = asString(prop(prop(contact, "profile"), "name"));
        if (waId && name) names.set(waId, name);
      }

      for (const message of asArray(prop(value, "messages"))) {
        const messageId = asString(prop(message, "id"));
        const waId = asString(prop(message, "from"));
        if (!messageId || !waId) continue;

        const rawType = asString(prop(message, "type")) ?? "unknown";
        const { text, kind } = extractContent(message, rawType);

        messages.push({
          messageId,
          phoneNumberId,
          waId,
          text,
          kind,
          rawType,
          timestamp: parseTimestamp(prop(message, "timestamp")),
          profileName: names.get(waId),
        });
      }
    }
  }

  return messages;
}
