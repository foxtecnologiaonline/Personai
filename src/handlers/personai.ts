import type {
  HandlerContext,
  HandlerReply,
  NormalizedMessage,
  ProductHandler,
  ProductId,
} from "../domain/types.js";
import type { PersonAiAssistant } from "../personai/assistant.js";
import type { ProductApiRegistry } from "../personai/product-api.js";
import { routePersonAiIntent } from "../personai/router.js";
import type { ConversationSession } from "../personai/session.js";

const PRODUCT_LABELS: Record<ProductId, string> = {
  "sales-agent": "o atendimento comercial",
  "monneyhub-zap": "o MonneyHub, que cuida do financeiro",
  "normas-ia": "o Normas.IA, que cuida de normas e regulamentação",
  personai: "o assistente geral",
};

const FALLBACK_REPLY =
  "Não consegui responder agora. Pode tentar de novo daqui a pouco?";

export interface PersonAiHandlerDeps {
  assistant: PersonAiAssistant;
  session: ConversationSession;
  products: ProductApiRegistry;
}

/**
 * Assistente pessoal: responde o que não é de nenhum produto específico, com
 * contexto do Serviço de Memória, e encaminha pergunta de produto para a API
 * interna correspondente. Não executa ações em nome do usuário.
 */
export class PersonAiHandler implements ProductHandler {
  readonly product = "personai" as const;

  constructor(private readonly deps: PersonAiHandlerDeps) {}

  async handle(message: NormalizedMessage, ctx: HandlerContext): Promise<HandlerReply | null> {
    const route = routePersonAiIntent(message.text);

    switch (route.target.kind) {
      case "forget-memory":
        return this.forget(message, ctx);
      case "product":
        return this.askProduct(route.target.product, message);
      case "general":
        return this.converse(message, ctx);
    }
  }

  private async forget(message: NormalizedMessage, ctx: HandlerContext): Promise<HandlerReply> {
    const deleted = await ctx.memory.forgetAll(message.tenantId, message.userRef);
    // A conversa recente também é memória: esquecer pela metade não é esquecer.
    await this.deps.session.clear(message.tenantId, message.userRef);

    ctx.logger.info({ tenantId: message.tenantId, deleted }, "memória apagada a pedido do usuário");

    return {
      text:
        `Pronto. Apaguei tudo o que eu guardava sobre você: ${deleted.preferences} preferência(s), ` +
        `${deleted.facts} informação(ões) e ${deleted.interactions} registro(s) de conversa, ` +
        `além do histórico recente. A partir daqui começo do zero.`,
      skipMemory: true,
    };
  }

  private async askProduct(
    product: ProductId,
    message: NormalizedMessage,
  ): Promise<HandlerReply> {
    const api = this.deps.products.get(product);
    if (!api) {
      return {
        text: `Isso é com ${PRODUCT_LABELS[product]}, que ainda não está ligado neste canal. Posso ajudar com outra coisa enquanto isso?`,
      };
    }

    const answer = await api.answer({
      tenantId: message.tenantId,
      userRef: message.userRef,
      question: message.text,
    });

    return { text: answer?.text ?? FALLBACK_REPLY };
  }

  private async converse(message: NormalizedMessage, ctx: HandlerContext): Promise<HandlerReply> {
    const [memory, history] = await Promise.all([
      // O histórico que o assistente usa vem da sessão, não de `interactions`.
      ctx.memory.getContext(message.tenantId, message.userRef, {
        factLimit: 10,
        interactionLimit: 0,
      }),
      this.deps.session.load(message.tenantId, message.userRef),
    ]);

    const answer = await this.deps.assistant.answer({
      question: message.text,
      memory,
      history,
    });

    if (!answer) return { text: FALLBACK_REPLY };

    try {
      await this.deps.session.append(message.tenantId, message.userRef, [
        { role: "user", text: message.text },
        { role: "assistant", text: answer.text },
      ]);

      for (const fact of answer.facts) {
        await ctx.memory.rememberFact(message.tenantId, message.userRef, fact, "personai");
      }
      for (const preference of answer.preferences) {
        await ctx.memory.setPreference(
          message.tenantId,
          message.userRef,
          preference.key,
          preference.value,
        );
      }
    } catch (error) {
      // Gravar memória não pode custar a resposta que já foi produzida.
      ctx.logger.warn({ err: error }, "falha ao persistir memória do PersonAI");
    }

    return { text: answer.text };
  }
}
