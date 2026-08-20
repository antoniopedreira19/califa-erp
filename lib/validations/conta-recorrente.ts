import { z } from "zod";
import { rateioSchema, formaPagamentoEnum } from "./conta-avulsa";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const dia1a31 = z.number().int().min(1).max(31);
const mes1a12 = z.number().int().min(1).max(12);

/**
 * Refinement compartilhado para forma de pagamento na recorrência.
 * Cartão exige cartao_credito_id; outras formas proíbem cartao_credito_id.
 * NÃO exige data futura: a data da ocorrência é calculada pelo SQL no
 * momento da materialização (via proxima_fatura_cartao), não pelo formulário.
 */
function aplicarRefinementFormaPagamentoRecorrente<
  T extends {
    forma_pagamento: "pix" | "transferencia" | "boleto" | "cartao_credito" | null;
    cartao_credito_id: string | null;
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
  } else if (data.cartao_credito_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Cartão só pode ser informado quando a forma é cartão de crédito.",
      path: ["cartao_credito_id"],
    });
  }
}

const baseRecorrenteFields = {
  empresa_id: z.string().uuid("Selecione a empresa."),
  descricao: z.string().trim().min(3, "Descrição muito curta.").max(500),
  valor: z
    .string()
    .refine(
      (v) => !Number.isNaN(Number(v)) && Number(v) > 0,
      "Valor deve ser positivo.",
    ),
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
  frequencia: z.enum(["quinzenal", "mensal", "anual"]),
  dia_do_mes: dia1a31.nullable(),
  dia_quinzena_1: dia1a31.nullable(),
  dia_quinzena_2: dia1a31.nullable(),
  dia_do_ano_dia: dia1a31.nullable(),
  dia_do_ano_mes: mes1a12.nullable(),
  data_fim: z
    .string()
    .regex(dateRegex, "Data em YYYY-MM-DD.")
    .nullable()
    .or(z.literal("").transform(() => null)),
  forma_pagamento: formaPagamentoEnum.nullable().or(
    z.literal("").transform(() => null as null),
  ),
  cartao_credito_id: z
    .string()
    .uuid()
    .nullable()
    .or(z.literal("").transform(() => null)),
  rateio: rateioSchema,
} as const;

function aplicarRefinementFrequencia<
  T extends {
    frequencia: "quinzenal" | "mensal" | "anual";
    dia_do_mes: number | null;
    dia_quinzena_1: number | null;
    dia_quinzena_2: number | null;
    dia_do_ano_dia: number | null;
    dia_do_ano_mes: number | null;
  },
>(data: T, ctx: z.RefinementCtx) {
  if (data.frequencia === "mensal" && data.dia_do_mes == null) {
    ctx.addIssue({
      code: "custom",
      path: ["dia_do_mes"],
      message: "Informe o dia do vencimento.",
    });
  }
  if (data.frequencia === "quinzenal") {
    if (data.dia_quinzena_1 == null) {
      ctx.addIssue({
        code: "custom",
        path: ["dia_quinzena_1"],
        message: "Informe o primeiro dia.",
      });
    }
    if (data.dia_quinzena_2 == null) {
      ctx.addIssue({
        code: "custom",
        path: ["dia_quinzena_2"],
        message: "Informe o segundo dia.",
      });
    }
    if (
      data.dia_quinzena_1 != null &&
      data.dia_quinzena_2 != null &&
      data.dia_quinzena_1 >= data.dia_quinzena_2
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["dia_quinzena_2"],
        message: "Segundo dia deve ser maior que o primeiro.",
      });
    }
  }
  if (data.frequencia === "anual") {
    if (data.dia_do_ano_dia == null) {
      ctx.addIssue({
        code: "custom",
        path: ["dia_do_ano_dia"],
        message: "Informe o dia.",
      });
    }
    if (data.dia_do_ano_mes == null) {
      ctx.addIssue({
        code: "custom",
        path: ["dia_do_ano_mes"],
        message: "Informe o mês.",
      });
    }
  }
}

export const criarContaRecorrenteSchema = z
  .object(baseRecorrenteFields)
  .superRefine((data, ctx) => {
    aplicarRefinementFrequencia(data, ctx);
    aplicarRefinementFormaPagamentoRecorrente(data, ctx);
  });

export const editarContaRecorrenteSchema = z
  .object({ ...baseRecorrenteFields, empresa_id: z.string().uuid().optional() })
  .omit({ empresa_id: true })
  .superRefine((data, ctx) => {
    aplicarRefinementFrequencia(data, ctx);
    aplicarRefinementFormaPagamentoRecorrente(data, ctx);
  });

export type CriarContaRecorrenteInput = z.infer<
  typeof criarContaRecorrenteSchema
>;
export type EditarContaRecorrenteInput = z.infer<
  typeof editarContaRecorrenteSchema
>;
