import { z } from "zod";

/**
 * Schema do BV do item. `item_versao_id` vem do contexto (o botão da
 * calha já sabe em qual linha está), não do form. `tenant_id` e
 * `created_by` são preenchidos pela Server Action.
 *
 * `fornecedor_id` é opcional aqui de propósito: no orçamento o GP pode
 * lançar o valor antes de fechar com quem. A cobrança do preenchimento
 * acontece na tela de acompanhamento do job, na hora de confirmar o
 * envio ao financeiro.
 *
 * `situacao` NÃO entra aqui: ela é derivada do ciclo de vida, nunca
 * escolhida. Nasce `a_negociar`, vira `confirmado` no envio ao financeiro
 * (acompanhamento do job), `recebido` na baixa do contas a receber e
 * `cancelado` quando o BV é removido. Quem grava é a Server Action.
 */
/** Campo opcional vindo de FormData chega como "" quando o usuário não
 *  preencheu. `.transform()` roda DEPOIS da validação, então limpar a
 *  string vazia ali é tarde demais — `.uuid()` já teria reprovado. O
 *  preprocess normaliza antes de qualquer regra rodar. */
const vazioComoNulo = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim().length === 0 ? null : v),
    schema,
  );

export const bvSchema = z.object({
  fornecedor_id: vazioComoNulo(
    z.string().uuid("Fornecedor inválido.").nullable(),
  ).default(null),
  valor: z.coerce
    .number({ invalid_type_error: "Valor do BV inválido." })
    .nonnegative("O valor do BV não pode ser negativo."),
  prazo_repasse: vazioComoNulo(
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.")
      .nullable(),
  ).default(null),
});

export type BvInput = z.infer<typeof bvSchema>;
