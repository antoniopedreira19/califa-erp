import { z } from "zod";

/**
 * Validações para contratos de freelancer.
 *
 * `nome_job` NÃO vem do form — é snapshot derivado do job escolhido na action.
 * O form envia `job_id` + `job_origem`; a action grava em `job_id` ou em
 * `job_interno_id` da tabela `freelancer_contratos` conforme a origem (CHECK
 * no banco garante que só um dos dois fica preenchido).
 */

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

export const contratoSchema = z
  .object({
    freelancer_id: z.string().uuid({ message: "Freelancer inválido" }),
    /** Opcional pra permitir editar contratos legados (`origem_sistema =
     *  ag_california_rh`), que nasceram sem job vinculado no califa-erp e só
     *  carregam `nome_job` como snapshot. A action rejeita vazio quando o
     *  contrato é novo. */
    job_id: z
      .string()
      .refine((v) => v === "" || /^[0-9a-f-]{36}$/i.test(v), {
        message: "Escolha um job",
      })
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional(),
    /** 'producao' = grava em `job_id` da tabela; 'interno' = grava em
     *  `job_interno_id`. Default 'producao' pra compat (form antigo sem campo). */
    job_origem: z
      .enum(["producao", "interno"])
      .optional()
      .default("producao"),
    responsavel_id: z
      .string()
      .refine((v) => v === "" || /^[0-9a-f-]{36}$/i.test(v), {
        message: "Responsável inválido",
      })
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional(),
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

export type ContratoInput = z.infer<typeof contratoSchema>;
