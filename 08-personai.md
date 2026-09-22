> **Contexto padrão FOX TecnologIA:** React Native/Expo, Next.js, PostgreSQL, BullMQ+Redis, S3/R2, Claude Sonnet como IA primária (Bedrock só como fallback), multi-tenant desde o MVP, LGPD desde o dia 1.
>
> **Depende de:** Camada A — Gateway WhatsApp/Roteador de Intenção e Camada C — Serviço de Memória/Contexto — ver `00-visao-geral-e-camadas-compartilhadas.md`.

## 8. PersonAI (assistente pessoal no zap)

**Objetivo:** assistente pessoal de uso geral dentro do WhatsApp — o "hub" que amarra os outros produtos e responde qualquer coisa com contexto de memória do usuário.

**Provedores:** Perplexity Agent API (pesquisa fundamentada pra pergunta aberta) · Amazon Bedrock (fallback de modelo) · Serviço de Memória/Contexto compartilhado (ver Camadas compartilhadas) · Gateway WhatsApp compartilhado (canal).

**Escopo funcional v1:**
- Consome mensagem do Gateway WhatsApp compartilhado quando roteada como "assistente geral" (não caiu em nenhum produto específico, ou usuário pediu o assistente geral explicitamente).
- Usa o Serviço de Memória/Contexto compartilhado pra preferência, fato recorrente e contexto de conversas anteriores — não tem tabela própria de memória.
- Roteamento interno secundário (dentro do próprio PersonAI): pergunta geral → Perplexity Agent API; pergunta sobre produto FOX específico (saldo, agendamento) → chama a API interna do produto correspondente.
- Resposta sempre cita fonte quando a informação vem de busca externa.
- Opt-out de memória disponível e visível — herdado do endpoint de exclusão do Serviço de Memória compartilhado (LGPD — direito de esquecimento aplicado desde o v1).

**Fora de escopo v1:** ações autônomas (comprar, agendar, pagar sem confirmação explícita do usuário a cada ação).

**Critérios de aceite:**
- Usuário consegue apagar sua própria memória via comando simples no WhatsApp, com confirmação de exclusão em até 24h (via Serviço de Memória compartilhado).
- Roteamento de intenção secundário acerta o produto correto em ≥ 90% dos casos de teste.

**Prompt inicial pro Claude Code:** "Implemente o handler do PersonAI: consome mensagem roteada como 'assistente geral' do Gateway WhatsApp compartilhado, aplica classificador de intenção secundário (produto interno vs. pergunta geral), usa o Serviço de Memória/Contexto compartilhado pra contexto do usuário, Perplexity Agent API pra pergunta aberta com citação de fonte, e Amazon Bedrock como fallback se a chamada primária (Claude) falhar."
