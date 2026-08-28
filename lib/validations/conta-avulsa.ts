import { z } from "zod";
import { DOCUMENTO_TIPOS } from "@/lib/types";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const formaPagamentoEnum = z.enum([
  "pix",
  "transferencia",
  "boleto",
  "cartao_credito",
]);

export const rateioSchema = z
  .array(
    z.object({
      regional_id: z.string().uuid("Selecione a regional."),
      percentual: z
        .number({ invalid_type_error: "Informe o percentual." })
        .min(0.01, "Percentual mínimo 0,01.")
        .max(100, "Percentual máximo 100."),
    }),
  )
  .min(1, "Adicione pelo menos uma regional.")
  .refine(
    (a) => Math.abs(a.reduce((s, r) => s + r.percentual, 0) - 100) < 0.01,
    { message: "A soma dos percentuais deve ser 100,00.", path: ["_sum"] },
  )
  .refine(
    (a) => new Set(a.map((r) => r.regional_id)).size === a.length,
    { message: "Cada regional só pode aparecer uma vez.", path: ["_dup"] },
  );

/**
 * Refinement compartilhado: cartão de crédito exige cartao_credito_id e
 * data_prevista_pagamento futura; outras formas proíbem cartao_credito_id.
 * Extraído como função para reusar em criar e editar sem duplicar o body.
 */
function aplicarRefinementFormaPagamento<
  T extends {
    forma_pagamento: "pix" | "transferencia" | "boleto" | "cartao_credito";
    cartao_credito_id: string | null;
    data_prevista_pagamento: string | null;
  },
>(data: T, ctx: z.RefinementCtx) {
  if (data.forma_pagamento === "cartao_credito") {
    if (!data.cartao_credito_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Selecione o cartão de crédito.",
        path: ["cartao_credito_id"],
      });
    }
    if (data.data_prevista_pagamento) {
      const hoje = new Date().toISOString().slice(0, 10);
      if (data.data_prevista_pagamento < hoje) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Cartão exige data de pagamento futura (data da fatura).",
          path: ["data_prevista_pagamento"],
        });
      }
    }
  } else if (data.cartao_credito_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Cartão só pode ser informado quando a forma é cartão de crédito.",
      path: ["cartao_credito_id"],
    });
  }
}

export const criarContaAvulsaSchema = z
  .object({
    empresa_id: z.string().uuid("Selecione a empresa."),
    descricao: z.string().trim().min(3, "Descrição muito curta.").max(500),
    valor: z
      .string()
      .refine(
        (v) => !Number.isNaN(Number(v)) && Number(v) > 0,
        "Valor deve ser positivo.",
      ),
    natureza: z.enum(["entrada", "saida"]),
    data_prevista_pagamento: z
      .string()
      .regex(dateRegex, "Data em YYYY-MM-DD.")
      .nullable()
      .or(z.literal("").transform(() => null)),
    // Fornecedor = destinatário do pagamento; Cliente = rastreabilidade de
    // custo (a qual cliente esse gasto pertence). Podem coexistir.
    fornecedor_id: z
      .string()
      .uuid()
      .nullable()
      .or(z.literal("").transform(() => null)),
    cliente_id: z
      .string()
      .uuid()
      .nullable()
      .or(z.literal("").transform(() => null)),
    job_id: z
      .string()
      .uuid()
      .nullable()
      .or(z.literal("").transform(() => null)),
    plano_conta_tipo_id: z.string().uuid("Selecione o tipo."),
    plano_conta_subtipo_id: z.string().uuid("Selecione o subtipo."),
    forma_pagamento: formaPagamentoEnum,
    cartao_credito_id: z
      .string()
      .uuid()
      .nullable()
      .or(z.literal("").transform(() => null)),
    anexos: z
      .array(
        z.object({
          path: z.string().min(1),
          nome: z.string().min(1),
          tamanho: z.number().int().positive(),
          mimetype: z.string().min(1),
          // Que documento este arquivo é (28/08/2026). O par anda junto:
          // número sem tipo não identifica nada.
          documento_tipo: z.enum(DOCUMENTO_TIPOS).nullable().default(null),
          documento_numero: z.string().trim().max(60).nullable().default(null),
        }),
      )
      .default([]),
    rateio: rateioSchema,
  })
  .superRefine(aplicarRefinementFormaPagamento);

/**
 * Editar não aceita empresa_id (imutável) nem anexos (fluxo separado — anexar
 * numa conta existente é outro caminho, TBD em fase futura; nesta task o
 * editar não altera anexos).
 *
 * Usa `z.object(baseShape).superRefine(...)` em vez de `criarContaAvulsaSchema
 * .innerType().omit()` porque `.innerType()` não existe em `ZodEffects` — o
 * `.superRefine` já envolve o objeto base num `ZodEffects`.
 */
const baseFields = {
  empresa_id: z.string().uuid("Selecione a empresa."),
  descricao: z.string().trim().min(3, "Descrição muito curta.").max(500),
  valor: z
    .string()
    .refine(
      (v) => !Number.isNaN(Number(v)) && Number(v) > 0,
      "Valor deve ser positivo.",
    ),
  natureza: z.enum(["entrada", "saida"]),
  data_prevista_pagamento: z
    .string()
    .regex(dateRegex, "Data em YYYY-MM-DD.")
    .nullable()
    .or(z.literal("").transform(() => null)),
  fornecedor_id: z
    .string()
    .uuid()
    .nullable()
    .or(z.literal("").transform(() => null)),
  cliente_id: z
    .string()
    .uuid()
    .nullable()
    .or(z.literal("").transform(() => null)),
  job_id: z
    .string()
    .uuid()
    .nullable()
    .or(z.literal("").transform(() => null)),
  plano_conta_tipo_id: z.string().uuid("Selecione o tipo."),
  plano_conta_subtipo_id: z.string().uuid("Selecione o subtipo."),
  forma_pagamento: formaPagamentoEnum,
  cartao_credito_id: z
    .string()
    .uuid()
    .nullable()
    .or(z.literal("").transform(() => null)),
  rateio: rateioSchema,
} as const;

export const editarContaAvulsaSchema = z
  .object(baseFields)
  .superRefine(aplicarRefinementFormaPagamento);

export type RateioLinhaInput = z.infer<typeof rateioSchema>[number];
export type CriarContaAvulsaInput = z.infer<typeof criarContaAvulsaSchema>;
export type EditarContaAvulsaInput = z.infer<typeof editarContaAvulsaSchema>;

export const baixaAvulsaSchema = z.object({
  conta_avulsa_id: z.string().uuid(),
  pago_em: z.string().regex(dateRegex, "Data em YYYY-MM-DD."),
  conta_bancaria_id: z.string().uuid("Selecione a conta bancária."),
});

export const estornoAvulsaSchema = z.object({
  conta_avulsa_id: z.string().uuid(),
  motivo: z
    .string()
    .trim()
    .min(10, "Motivo precisa ter pelo menos 10 caracteres.")
    .max(500, "Motivo passa de 500 caracteres."),
});

/** Estendido com parar_recorrencia — usado quando o usuário quer estornar e
 *  também pausar o template recorrente que gerou esta conta. */
export const estornoAvulsaComRecorrenciaSchema = estornoAvulsaSchema.extend({
  parar_recorrencia: z.boolean().optional(),
});
