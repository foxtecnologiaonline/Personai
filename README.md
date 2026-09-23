# Personai

Camadas compartilhadas da suíte de produtos FOX TecnologIA e o assistente pessoal no WhatsApp.

Este repositório carrega as specs de arquitetura (`docs/`) e a implementação da **Fase 0 — camadas compartilhadas**: o Gateway WhatsApp/Roteador de Intenção (Camada A) e o Serviço de Memória/Contexto (Camada C). Produtos (Sales Agent, MonneyHub Zap, Normas.IA) entram nas fases seguintes plugando um handler — não reimplementando canal nem memória.

## Specs

- [`docs/00-visao-geral-e-camadas-compartilhadas.md`](docs/00-visao-geral-e-camadas-compartilhadas.md) — os 9 produtos, as 3 camadas compartilhadas e a ordem de execução por fases.
- [`docs/08-personai.md`](docs/08-personai.md) — escopo do PersonAI (Fase 5).

## O que já roda

**Camada A — Gateway WhatsApp / Roteador de Intenção**
- Webhook único da Meta Business API com validação de assinatura HMAC (`X-Hub-Signature-256`) sobre o corpo bruto.
- Resolução de tenant por `phone_number_id`, com cache de 60s inclusive para número desconhecido.
- Fila BullMQ de entrada, deduplicada por `jobId` (id da mensagem) e por `inbound_message_log` no Postgres.
- Classificador de intenção: regra determinística primeiro, Claude só no que sobra. Falha de IA nunca derruba a mensagem — cai no assistente geral.
- Handlers plugam por `HandlerRegistry`; produto sem handler ainda recebe uma resposta honesta em vez de silêncio.

**Camada C — Serviço de Memória/Contexto**
- Schema Postgres dedicado (`memory`), não acoplado a produto: preferências, fatos e histórico de interação.
- API interna autenticada por token (`/internal/memory/*`), com corpo em JSON para que identificador de usuário não caia em log de acesso.
- Exclusão total com trilha de auditoria — e comando `"apagar minha memória"` disponível ao usuário pelo próprio WhatsApp.

**Camada B (scoring/SageMaker)** entra na Fase 3, junto com Radar de Vendas e Churn Radar.

## Como rodar

```bash
docker compose up -d          # Postgres + Redis
cp .env.example .env          # preencher os segredos
npm install
npm run migrate
npm run dev                   # api + worker no mesmo processo
```

Em produção os dois papéis escalam separados: `node dist/index.js api` e `node dist/index.js worker`.

## Endpoints

| Método | Rota | Para quê |
|---|---|---|
| `GET` | `/health` | Liveness. |
| `GET` | `/webhooks/whatsapp` | Handshake de verificação da Meta. |
| `POST` | `/webhooks/whatsapp` | Mensagens recebidas (exige assinatura válida). |
| `POST` | `/internal/memory/context` | Lê contexto do usuário. |
| `PUT` | `/internal/memory/preferences` | Grava preferência. |
| `POST` | `/internal/memory/facts` | Grava fato recorrente. |
| `POST` | `/internal/memory/interactions` | Registra interação. |
| `POST` | `/internal/memory/forget` | Exclusão total (LGPD). |

As rotas `/internal/*` exigem o header `x-internal-token` e não devem ser expostas na borda pública.

## Testes

```bash
npm run typecheck
npm test                      # só unitários
DATABASE_URL=postgres://fox:fox@localhost:5432/fox \
REDIS_URL=redis://localhost:6379 npm test   # inclui integração e ponta a ponta
```

O teste ponta a ponta exercita webhook → fila → worker → handler → resposta com Postgres e Redis reais; só o envio para a Graph API é substituído por um duplo.

## Decisões que valem saber

- **O telefone do usuário não é persistido.** Tudo que vai para o banco usa `user_ref`, um HMAC de `tenant + wa_id` (`USER_REF_SECRET`). Trocar essa chave torna a memória existente inalcançável.
- **`inbound_message_log` guarda roteamento, nunca conteúdo.** Serve de idempotência durável e de auditoria, sem virar um arquivo de conversas.
- **Reentrega processada é ignorada; retentativa de falha não.** A reivindicação da mensagem só bloqueia o que já foi respondido — senão uma falha de envio deixaria a mensagem sem resposta para sempre.
- **Entrega é at-least-once.** Se o processo cair entre enviar a resposta e marcar como processada, a retentativa reenvia. O oposto (perder a resposta) seria pior.
- **A resposta a um pedido de exclusão não gera novo registro de memória** — apagar e logo em seguida gravar algo sobre a pessoa não seria exclusão.

## Próxima fase

Fase 1 — MonneyHub MEI-Oráculo e MonneyHub Zap, este último plugando um handler no gateway já validado aqui.
