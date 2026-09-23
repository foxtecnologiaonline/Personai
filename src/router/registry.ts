import type { ProductHandler, ProductId } from "../domain/types.js";

/**
 * Onde cada produto pluga seu handler. Produto sem handler registrado ainda não
 * entrou em operação — o dispatch responde por ele em vez de silenciar.
 */
export class HandlerRegistry {
  private readonly handlers = new Map<ProductId, ProductHandler>();

  register(handler: ProductHandler): this {
    this.handlers.set(handler.product, handler);
    return this;
  }

  get(product: ProductId): ProductHandler | undefined {
    return this.handlers.get(product);
  }

  registered(): ProductId[] {
    return [...this.handlers.keys()];
  }
}
