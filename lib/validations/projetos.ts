import { z } from "zod";

/** Limite do contador de caracteres da descrição (UI e banco). */
export const DESCRICAO_MAX = 600;

/**
 * Schema de projeto. Código é gerado no server (não vem do form).
 * data_inicio_prevista é NOT NULL — determina o ano do código.
 *
 * `responsavel_id` voltou ao formulário em 30/07/2026, revertendo o
 * handoff que o preenchia com o usuário logado. Quem responde pelo
 * projeto nem sempre é quem o cadastrou — a coluna `created_by` já
 * registra o criador.
 *
 * `campanha` saiu do formulário, mas continua opcional no schema:
 * o update só a inclui no payload quando o form realmente a envia, para
 * não zerar o valor já gravado.
 *
 * Regional, Cidade, Final previsto e Categoria são obrigatórios AQUI e
 * nullable no banco — há projetos anteriores ao handoff sem esses dados,
 * e um NOT NULL exigiria backfill.
 */
export const projetoSchema = z
  .object({
    nome: z
      .string()
      .trim()
      .min(2, "Informe o nome do projeto (mín. 2 caracteres).")
      .max(200, "Máximo 200 caracteres."),
    campanha: z
      .string()
      .trim()
      .max(200, "Máximo 200 caracteres.")
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    empresa_id: z.string().uuid("Selecione a empresa."),
    cliente_id: z.string().uuid("Selecione um cliente válido."),
    responsavel_id: z.string().uuid("Selecione um responsável válido."),
    regional_id: z.string().uuid("Selecione a regional."),
    cidade_id: z.string().uuid("Selecione a cidade."),
    categoria_id: z.string().uuid("Selecione uma categoria para continuar."),
    data_inicio_prevista: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Data de início é obrigatória."),
    data_fim_prevista: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Data final é obrigatória."),
    descricao: z
      .string()
      .trim()
      .max(DESCRICAO_MAX, `Máximo ${DESCRICAO_MAX} caracteres.`)
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
  })
  .refine((d) => d.data_fim_prevista >= d.data_inicio_prevista, {
    message: "A data final não pode ser anterior à data de início.",
    path: ["data_fim_prevista"],
  });

export type ProjetoInput = z.infer<typeof projetoSchema>;
