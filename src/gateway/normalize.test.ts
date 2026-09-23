import { describe, expect, it } from "vitest";
import { extractInboundMessages } from "./normalize.js";

const envelope = (value: unknown) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "WABA_ID", changes: [{ field: "messages", value }] }],
});

const metadata = { display_phone_number: "5511999999999", phone_number_id: "PN_1" };

describe("extractInboundMessages", () => {
  it("extrai mensagem de texto com nome do contato", () => {
    const [message] = extractInboundMessages(
      envelope({
        messaging_product: "whatsapp",
        metadata,
        contacts: [{ profile: { name: "Ana" }, wa_id: "5511888888888" }],
        messages: [
          {
            from: "5511888888888",
            id: "wamid.1",
            timestamp: "1700000000",
            type: "text",
            text: { body: "qual meu saldo?" },
          },
        ],
      }),
    );

    expect(message).toMatchObject({
      messageId: "wamid.1",
      phoneNumberId: "PN_1",
      waId: "5511888888888",
      text: "qual meu saldo?",
      kind: "text",
      profileName: "Ana",
    });
    expect(message?.timestamp.toISOString()).toBe("2023-11-14T22:13:20.000Z");
  });

  it("extrai o título escolhido em resposta interativa", () => {
    const [message] = extractInboundMessages(
      envelope({
        metadata,
        messages: [
          {
            from: "5511888888888",
            id: "wamid.2",
            timestamp: "1700000000",
            type: "interactive",
            interactive: { type: "button_reply", button_reply: { id: "b1", title: "Falar com vendas" } },
          },
        ],
      }),
    );

    expect(message).toMatchObject({ text: "Falar com vendas", kind: "interactive" });
  });

  it("marca tipo não suportado sem descartar a mensagem", () => {
    const [message] = extractInboundMessages(
      envelope({
        metadata,
        messages: [{ from: "551188", id: "wamid.3", timestamp: "1700000000", type: "audio" }],
      }),
    );

    expect(message).toMatchObject({ kind: "unsupported", rawType: "audio", text: "" });
  });

  it("ignora eventos de status e payloads malformados", () => {
    expect(
      extractInboundMessages(
        envelope({ metadata, statuses: [{ id: "wamid.9", status: "delivered" }] }),
      ),
    ).toEqual([]);
    expect(extractInboundMessages({})).toEqual([]);
    expect(extractInboundMessages(null)).toEqual([]);
    expect(extractInboundMessages(envelope({ messages: [{ id: "sem-metadata" }] }))).toEqual([]);
  });
});
