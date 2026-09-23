-- Serviço de Memória/Contexto (Camada C). Schema dedicado: não pertence a
-- nenhum produto. O usuário é identificado por `user_ref`, pseudônimo HMAC
-- derivado do tenant + wa_id — o número de telefone nunca é persistido aqui.

CREATE SCHEMA IF NOT EXISTS memory;

CREATE TABLE IF NOT EXISTS memory.preferences (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_ref    text NOT NULL,
  key         text NOT NULL,
  value       text NOT NULL CHECK (length(value) <= 1000),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_ref, key)
);

CREATE TABLE IF NOT EXISTS memory.facts (
  id            bigserial PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_ref      text NOT NULL,
  content       text NOT NULL CHECK (length(content) <= 500),
  source        text,
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_ref, content)
);

CREATE INDEX IF NOT EXISTS facts_user_recent_idx
  ON memory.facts (tenant_id, user_ref, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS memory.interactions (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_ref    text NOT NULL,
  product     text NOT NULL,
  summary     text NOT NULL CHECK (length(summary) <= 500),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS interactions_user_recent_idx
  ON memory.interactions (tenant_id, user_ref, created_at DESC);

-- Trilha de auditoria do direito de esquecimento: prova de que a exclusão foi
-- pedida e concluída dentro do prazo.
CREATE TABLE IF NOT EXISTS memory.deletion_requests (
  id              bigserial PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_ref        text NOT NULL,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  deleted_counts  jsonb
);

CREATE INDEX IF NOT EXISTS deletion_requests_pending_idx
  ON memory.deletion_requests (requested_at DESC) WHERE completed_at IS NULL;
