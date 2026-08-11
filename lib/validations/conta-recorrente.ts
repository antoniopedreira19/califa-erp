import { z } from "zod";
import { rateioSchema } from "./conta-avulsa";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const dia1a31 = z.number().int().min(1).max(31);
const mes1a12 = z.number().int().min(1).max(12);

export const criarContaRecorrenteSchema = z
  .object({
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
    rateio: rateioSchema,
  })
  .superRefine((data, ctx) => {
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
  });

export const editarContaRecorrenteSchema = criarContaRecorrenteSchema
  .innerType()
  .omit({
    empresa_id: true,
  });

export type CriarContaRecorrenteInput = z.infer<
  typeof criarContaRecorrenteSchema
>;
export type EditarContaRecorrenteInput = z.infer<
  typeof editarContaRecorrenteSchema
>;
