# Personai

Specs técnicas de arquitetura para a suíte de produtos FOX Tecnologia — camadas de infraestrutura compartilhada (Gateway WhatsApp/Roteador de Intenção, Serviço de Scoring via SageMaker, Serviço de Memória/Contexto do usuário) e o escopo funcional do PersonAI, o assistente pessoal no WhatsApp.

## Conteúdo

- [`00-visao-geral-e-camadas-compartilhadas.md`](00-visao-geral-e-camadas-compartilhadas.md) — visão geral da lista de 9 produtos, as três camadas compartilhadas e a ordem de execução recomendada por fases.
- [`08-personai.md`](08-personai.md) — escopo técnico detalhado do item 8 (PersonAI): objetivo, provedores, escopo funcional v1, critérios de aceite e prompt inicial para o Claude Code.

## Stack padrão FOX TecnologIA

React Native/Expo, Next.js, PostgreSQL, BullMQ+Redis, S3/R2, Claude Sonnet como IA primária (Bedrock como fallback), multi-tenant desde o MVP, LGPD desde o dia 1.
