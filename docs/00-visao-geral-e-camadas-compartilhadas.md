# Visão geral — lista "Negócios" (escopos individuais)

# Escopo técnico — lista "Negócios"

Escopos otimizados para entregar direto ao Claude Code, um por item da lista. Cada um assume o stack padrão FOX TecnologIA (React Native/Expo, Next.js, PostgreSQL, BullMQ+Redis, S3/R2, Claude Sonnet como IA primária, Meta Business API para WhatsApp, multi-tenant desde o MVP, LGPD desde o dia 1) e integra os provedores mapeados na sessão: Perplexity (Search/Agent/Router API), Microsoft Foundry & Azure, AWS.

Decisão de arquitetura que vale pra todos os 9: WhatsApp entra sempre via infraestrutura ZapScript já existente (Meta Business API + BullMQ), não reinventar canal. IA conversacional primária continua Claude (Bedrock só entra como fallback/redundância, nunca como default). Nesta revisão, três pedaços de infra que se repetiam em itens diferentes foram extraídos como **camadas compartilhadas** (seção abaixo, antes dos itens individuais) — cada item passa a consumir essas camadas em vez de reimplementar a mesma integração.

Este arquivo cobre a infraestrutura compartilhada e a ordem de execução. Cada item (01 a 09) está em arquivo próprio, pronto pra entregar individualmente ao Claude Code — os itens que dependem de uma camada compartilhada referenciam este arquivo.

---

## Camadas compartilhadas

Construir cada uma como serviço interno, uma vez só. Evita reimplementar a mesma integração 3-4 vezes e evita bug divergente entre produtos quando alguém corrige um lado e esquece o outro.

### A. Gateway WhatsApp / Roteador de Intenção
**Usado por:** Sales Agent (1), MonneyHub Zap (5), Normas.IA (6), PersonAI (8) — todo item conversacional no WhatsApp.

- Webhook único (Meta Business API) recebe toda mensagem inbound, identifica tenant, enfileira via BullMQ.
- Classificador de intenção compartilhado decide qual produto trata a mensagem, e despacha pro handler correspondente com uma mensagem já normalizada (tenant, texto, metadata).
- Cada produto implementa só o handler específico da sua lógica de negócio; "receber, autenticar tenant, enfileirar, rotear, responder" é responsabilidade do gateway, não de cada item.

**Prompt inicial pro Claude Code:** "Implemente um serviço de gateway WhatsApp único: webhook Meta Business API, identificação de tenant, fila BullMQ de entrada, e um roteador de intenção que despacha pra o handler do produto correto (sales-agent, monneyhub-zap, normas-ia, personai) via uma interface comum (recebe mensagem normalizada, devolve resposta)."

### B. Serviço de Scoring (SageMaker)
**Usado por:** Radar de Vendas (3), Churn Radar (9).

- Client/wrapper único de chamada a endpoint SageMaker (autenticação, retry com backoff, timeout, log estruturado) — cada produto só passa payload de features e nome do endpoint.
- Job runner genérico (cron BullMQ diário): busca dado atualizado → chama endpoint → persiste em tabela própria do produto. A mecânica do job é idêntica entre os dois; só muda fonte de dado, endpoint e tabela de destino.

**Prompt inicial pro Claude Code:** "Implemente um client/wrapper compartilhado pra chamadas a endpoints Amazon SageMaker (auth, retry com backoff, timeout, log estruturado) e um job runner genérico (BullMQ) parametrizável por: fonte de dado, endpoint SageMaker, tabela de destino. Radar de Vendas e Churn Radar configuram uma instância cada, sem duplicar a lógica de chamada."

### C. Serviço de Memória/Contexto do Usuário
**Usado por:** PersonAI (8) principalmente — desenhado pra ser consumível por qualquer produto futuro que precise lembrar preferência/contexto do usuário.

- Schema Postgres dedicado (não é tabela de nenhum produto específico): preferência, fato recorrente, histórico de interação.
- API interna de leitura/escrita + endpoint de exclusão total (LGPD, direito de esquecimento) — construído uma vez.
- PersonAI é o primeiro e principal consumidor, mas a tabela e a API não pertencem a ele.

**Prompt inicial pro Claude Code:** "Implemente um serviço de memória de usuário como módulo próprio: schema Postgres dedicado (não acoplado a nenhum produto), API interna de leitura/escrita/exclusão de memória por usuário, com exclusão total em até 24h pra conformidade LGPD."

---

## Ordem de execução recomendada

**Fase 0 — Camadas compartilhadas.** Gateway WhatsApp/Roteador de Intenção primeiro — sem ele, Sales Agent, MonneyHub Zap, Normas.IA e PersonAI não têm onde plugar. Serviço de Memória/Contexto junto ou logo em seguida — é dependência direta do PersonAI, mais barato construir antes dele existir do que migrar depois. O client/job runner de Scoring pode esperar até a Fase 3, quando Radar de Vendas entra em jogo.

**Fase 1 — MonneyHub MEI-Oráculo e MonneyHub Zap.** Reaproveitam dado e infra que já existem, menor esforço pra validar — e MonneyHub Zap já testa o Gateway WhatsApp em produção com escopo simples, antes de plugar os itens mais complexos nele.

**Fase 2 — Sales Agent e Normas.IA.** Infra WhatsApp já validada na fase anterior, só troca a lógica de negócio.

**Fase 3 — Radar de Vendas e Churn Radar juntos.** Compartilham o mesmo padrão de infraestrutura de scoring (constrói uma vez, usa duas) e fazem sentido no mesmo momento: Radar de Vendas depende de volume de lead suficiente pra treinar, Churn Radar depende de histórico de cliente ativo — ambos exigem "esperar dado acumular", então entram na mesma janela.

**Fase 4 — Atendimento Telefônico e SegurancaMPE.** Bloqueados em decisão de fornecedor externo (telefonia / conexão de log) antes de codar — ficam represados até essa decisão fechar, independente do resto do roadmap.

**Fase 5 — PersonAI.** O mais arriscado tecnicamente (depende de roteamento certo entre os outros oito produtos), mas agora herda o Gateway WhatsApp e o Serviço de Memória já maduros e testados nas fases anteriores — o que reduz bastante o risco em relação a construir tudo do zero.
