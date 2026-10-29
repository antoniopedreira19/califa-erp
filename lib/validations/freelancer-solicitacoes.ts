import { z } from "zod";
import { onlyDigits } from "@/lib/utils";

const dataOpcional = z
  .string()
  .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), {
    message: "Data inválida",
  })
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

export const criarSolicitacaoSchema = z
  .object({
    nome_freela: z
      .string()
      .trim()
      .min(2, { message: "Nome deve ter ao menos 2 caracteres" })
      .max(200),
    cpf_freela: z
      .string()
      .transform(onlyDigits)
      .refine((v) => v === "" || v.length === 11, {
        message: "CPF deve ter 11 dígitos",
      })
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional(),
    job_id: z.string().uuid({ message: "Escolha um job" }),
    /** 'producao' = grava em `job_id` da `freelancer_solicitacoes`;
     *  'interno' = grava em `job_interno_id`. Default 'producao' pra compat
     *  com form antigo. */
    job_origem: z
      .enum(["producao", "interno"])
      .optional()
      .default("producao"),
    cargo: textoOpcional(100),
    tipo: z.enum(["mensal", "periodo", "diarias"], {
      errorMap: () => ({ message: "Escolha o tipo do contrato" }),
    }),
    valor: z.coerce
      .number({ invalid_type_error: "Valor inválido" })
      .min(0, { message: "Valor deve ser positivo ou zero" }),
    data_inicio: dataOpcional,
    data_termino: dataOpcional,
    cidade: textoOpcional(100),
    observacoes: textoOpcional(1000),
  })
  .superRefine((v, ctx) => {
    if (v.data_inicio && v.data_termino && v.data_termino < v.data_inicio) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["data_termino"],
        message: "Data de término deve ser igual ou posterior à data de início",
      });
    }
  });

export const rejeitarSolicitacaoSchema = z.object({
  motivo: z
    .string()
    .trim()
    .min(3, { message: "Explique brevemente o motivo da rejeição" })
    .max(500),
});

export type CriarSolicitacaoInput = z.infer<typeof criarSolicitacaoSchema>;
export type RejeitarSolicitacaoInput = z.infer<typeof rejeitarSolicitacaoSchema>;
