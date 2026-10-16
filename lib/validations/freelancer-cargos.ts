import { z } from "zod";

/**
 * Validações para o catálogo `freelancer_cargos`.
 * Duplicata por tenant é verificada na action, não aqui.
 */

export const criarCargoSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(2, { message: "Nome deve ter ao menos 2 caracteres" })
    .max(80, { message: "Nome deve ter no máximo 80 caracteres" }),
});

export const renomearCargoSchema = z.object({
  id: z.string().uuid({ message: "ID inválido" }),
  nome: z
    .string()
    .trim()
    .min(2, { message: "Nome deve ter ao menos 2 caracteres" })
    .max(80, { message: "Nome deve ter no máximo 80 caracteres" }),
});

export const toggleCargoAtivoSchema = z.object({
  id: z.string().uuid({ message: "ID inválido" }),
  ativo: z.boolean(),
});

export type CriarCargoInput = z.infer<typeof criarCargoSchema>;
export type RenomearCargoInput = z.infer<typeof renomearCargoSchema>;
export type ToggleCargoAtivoInput = z.infer<typeof toggleCargoAtivoSchema>;
