import type { ProductId } from "../domain/types.js";

export interface ProductQuery {
  tenantId: string;
  userRef: string;
  question: string;
}

export interface ProductAnswer {
  text: string;
}

/**
 * Como o PersonAI fala com os outros produtos FOX. Cada produto expõe sua API
 * interna e registra um adaptador aqui — o assistente nunca acessa banco de
 * produto direto.
 */
export interface InternalProductApi {
  readonly product: ProductId;
  answer(query: ProductQuery): Promise<ProductAnswer | null>;
}

export class ProductApiRegistry {
  private readonly apis = new Map<ProductId, InternalProductApi>();

  register(api: InternalProductApi): this {
    this.apis.set(api.product, api);
    return this;
  }

  get(product: ProductId): InternalProductApi | undefined {
    return this.apis.get(product);
  }

  available(): ProductId[] {
    return [...this.apis.keys()];
  }
}
