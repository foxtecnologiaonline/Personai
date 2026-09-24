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

**PersonAI (assistente pessoal no WhatsApp)**
- Responde pergunta aberta com Claude, usando preferências e fatos do Serviço de Memória como contexto.
- Roteamento secundário próprio: pedido de exclusão, pergunta sobre produto FOX (vai para a API interna do produto) ou pergunta aberta. Medido em 30 casos rotulados — o critério da spec é ≥ 90% de acerto.
- Busca fundamentada para pergunta aberta, com **fonte citada pelo código**, não pelo modelo: citação é requisito, não pode depender de o modelo lembrar.
- Fallback de modelo via Amazon Bedrock quando o primário falha (responde sem extrair memória — perder um fato é melhor que ficar sem resposta).
- Conversa recente vive só no Redis com TTL; o que merece durar vira fato ou preferência no Serviço de Memória. `"apagar minha memória"` limpa os dois.
- **Não executa ações** (comprar, agendar, pagar): não recebe ferramenta que aja, e o prompt reforça.

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
- **Uma conversa por vez.** Mensagens seguidas do mesmo usuário são serializadas por uma trava no Redis (com expiração). Sem ela, duas mensagens em sequência caem em workers diferentes, leem o mesmo estado e respondem em cima uma da outra — o usuário recebe o aviso de privacidade duas vezes. A espera tem teto: passado o limite, segue mesmo assim, porque não responder é pior que responder fora de ordem.
- **Entrega é at-least-once.** Se o processo cair entre enviar a resposta e marcar como processada, a retentativa reenvia. O oposto (perder a resposta) seria pior.
- **A resposta a um pedido de exclusão não gera novo registro de memória** — apagar e logo em seguida gravar algo sobre a pessoa não seria exclusão.

## Operação

**Cadastro de tenant**

```bash
npm run tenant -- add --name "Cliente X" --phone-number-id 123456 [--waba-id 789]
npm run tenant -- list
npm run tenant -- disable --phone-number-id 123456
```

**Deploy** — `Dockerfile` multi-estágio, rodando como usuário sem privilégio. A imagem sobe os dois papéis: `docker run personai api` e `docker run personai worker`. Dentro do container as tarefas operacionais rodam do build (`npm run migrate:prod`, `npm run tenant:prod`) — a imagem de produção não traz `tsx`. Não há `HEALTHCHECK` embutido de propósito: o worker não sobe servidor HTTP, então quem roda o papel `api` define o check (`GET /health`) no orquestrador. O CI (`.github/workflows/ci.yml`) roda typecheck, migrações, a suíte completa contra Postgres e Redis reais, o build e o `docker build`.

**Atrás de proxy** — `TRUST_PROXY=true` só quando houver um proxy confiável na frente. Ligado sem isso, o IP do cliente passa a vir do `X-Forwarded-For`, que qualquer um forja.

**Monitoração** — `GET /internal/status` (token interno) devolve estado do banco e a contagem da fila. Fila crescendo é o primeiro sinal de que mensagem de usuário está sem resposta.

**Prazo de guarda** — o worker expurga automaticamente `inbound_message_log` (padrão 90 dias) e `memory.interactions` (padrão 180 dias), com trava para não duplicar entre instâncias. Configurável por env.

**Rate limit** — aplicado só às rotas `/internal/*`. O webhook fica de fora de propósito: o tráfego da Meta vem de poucos IPs, e limitar por IP ali descartaria mensagem legítima de tenant movimentado. Quem protege o webhook é a assinatura HMAC.

## O que ainda falta para produção

Tudo aqui depende de credencial ou decisão que não é do código:

- **Credenciais da Meta** — WABA, app secret, número verificado, token permanente, e o webhook publicado em URL HTTPS
- **Chave Anthropic de produção** — sem ela o assistente não responde pergunta aberta
- **Onde hospedar** — a imagem roda em qualquer lugar; falta escolher
- **Perplexity** — chave real e smoke test: o mapeamento da resposta foi escrito de forma defensiva, sem acesso à doc viva
- **Bedrock** — credenciais AWS e confirmação do model id na região escolhida
- **Backup do Postgres** — depende do provedor escolhido
- **Mensagem proativa** fora da janela de 24h da Meta exige template aprovado (não bloqueia o PersonAI, que é reativo)
- **Avaliação de qualidade da resposta** — todos os testes usam duplo de modelo. O encanamento está provado; a qualidade da resposta, não

## Próxima fase

Fase 1 — MonneyHub MEI-Oráculo e MonneyHub Zap. O MonneyHub Zap pluga um `ProductHandler` no gateway; a mesma API interna registrada no `ProductApiRegistry` já faz o PersonAI responder pergunta de saldo sem duplicar lógica.
