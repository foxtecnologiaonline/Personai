import type {
  HandlerContext,
  HandlerReply,
  NormalizedMessage,
  ProductHandler,
} from "../domain/types.js";

const FORGET_PATTERN =
  /\b(apag\w*|exclu\w*|esque[cç]\w*)\s+(a\s+|as\s+)?(minha\s+|minhas\s+)?mem[óo]ria\b/i;

/**
 * Handler do assistente geral. A conversa em si é a Fase 5; o que já vale hoje
 * é o direito de esquecimento — quem tem memória guardada precisa conseguir
 * apagá-la pelo próprio canal, sem depender de suporte.
 */
export class PersonAiHandler implements ProductHandler {
  readonly product = "personai" as const;

  async handle(message: NormalizedMessage, ctx: HandlerContext): Promise<HandlerReply | null> {
    if (FORGET_PATTERN.test(message.text)) {
      const deleted = await ctx.memory.forgetAll(message.tenantId, message.userRef);
      ctx.logger.info({ tenantId: message.tenantId, deleted }, "memória apagada a pedido do usuário");

      return {
        text:
          `Pronto. Apaguei tudo o que eu guardava sobre você: ${deleted.preferences} preferência(s), ` +
          `${deleted.facts} informação(ões) e ${deleted.interactions} registro(s) de conversa. ` +
          `A partir daqui começo do zero.`,
        skipMemory: true,
      };
    }

    const context = await ctx.memory.getContext(message.tenantId, message.userRef, {
      factLimit: 5,
      interactionLimit: 3,
    });
    const conhecido = context.interactions.length > 0 || context.facts.length > 0;

    return {
      text: conhecido
        ? "Oi de novo! O assistente geral ainda está em construção — por enquanto consigo apagar sua memória se você pedir (\"apagar minha memória\")."
        : "Oi! Sou o assistente geral da FOX. Ainda estou em construção por aqui. Se quiser, pode pedir \"apagar minha memória\" a qualquer momento.",
    };
  }
}
