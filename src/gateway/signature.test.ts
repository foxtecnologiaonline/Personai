import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyMetaSignature } from "./signature.js";

const SECRET = "segredo-do-app-meta-para-teste";
const BODY = Buffer.from(JSON.stringify({ object: "whatsapp_business_account" }));
const sign = (body: Buffer, secret: string) =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

describe("verifyMetaSignature", () => {
  it("aceita assinatura gerada com o app secret correto", () => {
    expect(verifyMetaSignature(BODY, sign(BODY, SECRET), SECRET)).toBe(true);
  });

  it("recusa assinatura gerada com outro segredo", () => {
    expect(verifyMetaSignature(BODY, sign(BODY, "outro-segredo"), SECRET)).toBe(false);
  });

  it("recusa quando o corpo foi alterado depois de assinado", () => {
    const signature = sign(BODY, SECRET);
    const adulterado = Buffer.from(JSON.stringify({ object: "adulterado" }));
    expect(verifyMetaSignature(adulterado, signature, SECRET)).toBe(false);
  });

  it("recusa header ausente, algoritmo diferente ou hex inválido", () => {
    expect(verifyMetaSignature(BODY, undefined, SECRET)).toBe(false);
    expect(verifyMetaSignature(BODY, "sha1=abc", SECRET)).toBe(false);
    expect(verifyMetaSignature(BODY, "sha256=nao-e-hex", SECRET)).toBe(false);
    expect(verifyMetaSignature(BODY, "sha256=", SECRET)).toBe(false);
  });
});
