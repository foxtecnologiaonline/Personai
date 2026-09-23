/**
 * Chave usada para marcar que o aviso já foi dado. Fica junto das preferências
 * do usuário de propósito: se ele pedir exclusão, o aviso é apagado com o
 * resto e volta a aparecer — depois de esquecido, ele é alguém novo.
 */
export const PRIVACY_NOTICE_KEY = "aviso_privacidade_em";

/**
 * Transparência no primeiro contato (LGPD art. 9º). O texto descreve o que o
 * código realmente faz: se o comportamento mudar, este aviso muda junto.
 */
export const PRIVACY_NOTICE =
  "Antes de começarmos: eu guardo preferências e informações que você me contar, " +
  "para lembrar nas próximas conversas. O histórico recente do papo expira sozinho " +
  "e seu número de telefone não é armazenado. É só pedir \"apagar minha memória\" " +
  "que eu apago tudo na hora.";
