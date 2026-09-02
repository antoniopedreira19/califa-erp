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
 * Regional, Produto, Final previsto e Serviço são obrigatórios AQUI e
 * nullable no banco — há projetos anteriores ao handoff sem esses dados,
 * e um NOT NULL exigiria backfill.
 *
 * Desde 06/08/2026: Regional e Responsável são listas (tabelas
 * `projeto_regionais` e `projeto_responsaveis`); o primeiro item de cada
 * uma alimenta as colunas de compatibilidade em `projetos`. Cidade saiu
 * do formulário — passou a ser informada no orçamento. Produto entrou,
 * vindo do cadastro do cliente selecionado.
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
    produto_id: z.string().uuid("Selecione uma marca do cadastro do cliente."),
    // Os dois chegam de `formData.getAll`, e a conferência do servidor
    // compara o tamanho da lista com o número de linhas que o `.in()`
    // devolveu — que vem deduplicado. Um id repetido reprovaria com
    // "Regional inválida." mesmo estando tudo certo, e ainda estouraria
    // a unique do vínculo no insert. Dedupe aqui, num lugar só.
    responsavel_ids: z
      .array(z.string().uuid("Responsável inválido."))
      .min(1, "Selecione ao menos um responsável.")
      .transform((v) => Array.from(new Set(v))),
    regional_ids: z
      .array(z.string().uuid("Regional inválida."))
      .min(1, "Selecione ao menos uma regional.")
      .transform((v) => Array.from(new Set(v))),
    // ⚠️ `categoria_id` (o antigo Serviço) saiu do formulário em
    // 02/09/2026 (decisão 037): virou `orcamentos.servico_id`. A coluna
    // continua no banco pelo dado histórico, mas nada mais escreve nela.
    //
    // Acréscimos MANUAIS à Equipe. Pode vir vazia: criador, GPs e
    // produtores dos orçamentos entram por derivação no servidor, e são
    // eles que garantem que a equipe nunca fique sem ninguém.
    equipe_ids: z
      .array(z.string().uuid("Membro de equipe inválido."))
      .transform((v) => Array.from(new Set(v)))
      .default([]),
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
