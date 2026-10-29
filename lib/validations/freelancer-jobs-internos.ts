import { z } from "zod";

/**
 * Validações para `freelancer_jobs_internos` — jobs de freelancer sem
 * orçamento/projeto/cliente. Só nome + descrição opcional. Códigos ficaram
 * de fora (29/10/2026): o uso é "escolho pelo nome do time", referência
 * cruzada não existe como no /jobs de produção.
 */

const nomeSchema = z
  .string()
  .trim()
  .min(2, { message: "Nome deve ter ao menos 2 caracteres" })
  .max(120, { message: "Nome deve ter no máximo 120 caracteres" });

const descricaoSchema = z
  .string()
  .trim()
  .max(500, { message: "Descrição deve ter no máximo 500 caracteres" })
  .optional()
  .transform((v) => (v && v.length > 0 ? v : null));

export const criarJobInternoSchema = z.object({
  nome: nomeSchema,
  descricao: descricaoSchema,
});

export const editarJobInternoSchema = z.object({
  id: z.string().uuid({ message: "ID inválido" }),
  nome: nomeSchema,
  descricao: descricaoSchema,
});

export const arquivarJobInternoSchema = z.object({
  id: z.string().uuid({ message: "ID inválido" }),
  arquivar: z.boolean(),
});

export type CriarJobInternoInput = z.infer<typeof criarJobInternoSchema>;
export type EditarJobInternoInput = z.infer<typeof editarJobInternoSchema>;
export type ArquivarJobInternoInput = z.infer<typeof arquivarJobInternoSchema>;
