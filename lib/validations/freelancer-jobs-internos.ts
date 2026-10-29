import { z } from "zod";

/**
 * Validações para `freelancer_jobs_internos` — jobs de freelancer sem
 * orçamento/projeto/cliente. Unicidade de código por tenant é verificada
 * na action (via erro 23505 do Postgres).
 */

const codigoSchema = z
  .string()
  .trim()
  .min(1, { message: "Código é obrigatório" })
  .max(40, { message: "Código deve ter no máximo 40 caracteres" });

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
  codigo: codigoSchema,
  nome: nomeSchema,
  descricao: descricaoSchema,
});

export const editarJobInternoSchema = z.object({
  id: z.string().uuid({ message: "ID inválido" }),
  codigo: codigoSchema,
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
