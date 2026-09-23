-- Núcleo multi-tenant do Gateway WhatsApp (Camada A).

CREATE TABLE IF NOT EXISTS tenants (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  phone_number_id  text NOT NULL UNIQUE,
  waba_id          text,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Guarda identificador e roteamento da mensagem, nunca o conteúdo: minimização
-- de dados (LGPD art. 6º, III). Também é a garantia durável de idempotência
-- contra reentrega do webhook da Meta.
CREATE TABLE IF NOT EXISTS inbound_message_log (
  message_id     text PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product        text,
  status         text NOT NULL DEFAULT 'received',
  received_at    timestamptz NOT NULL DEFAULT now(),
  processed_at   timestamptz
);

CREATE INDEX IF NOT EXISTS inbound_message_log_tenant_received_idx
  ON inbound_message_log (tenant_id, received_at DESC);
