import { z } from "zod";

/** Limite do contador de caracteres do descritivo (UI e CHECK do banco).
 *  O nome do identificador segue `observacoes` — a coluna é
 *  `jobs.observacoes`; só o rótulo virou "Descritivo" em 17/08/2026. */
export const OBSERVACOES_MAX = 500;

/** Teto de contatos de cobrança por job. O formulário não tem por que
 *  passar de alguns; o limite existe para o payload não vir sem fim. */
export const CONTATOS_COBRANCA_MAX = 20;

/**
 * Uma linha da seção "Contato de cobrança" do modal de abertura: quem
 * recebe a cobrança no cliente. Nome e e-mail são obrigatórios porque é
 * por eles que o financeiro cobra; o telefone é o único opcional — nem
 * todo contato tem um, e exigir número travaria a abertura por nada.
 */
export const contatoCobrancaSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(2, "Informe o nome do contato (mín. 2 caracteres).")
    .max(120, "Máximo 120 caracteres."),
  numero: z
    .string()
    .trim()
    .max(40, "Máximo 40 caracteres.")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  email: z
    .string()
    .trim()
    .min(1, "Informe o e-mail do contato.")
    .email("E-mail inválido.")
    .max(200, "Máximo 200 caracteres."),
});

export type ContatoCobrancaInput = z.infer<typeof contatoCobrancaSchema>;

/**
 * Modal "Enviar job para abertura" (handoff "Abertura de Job.dc.html").
 *
 * Só valida o que o modal deixa editar. Produto, GP responsável e produtor
 * responsável continuam herdados — produto vem do projeto, os dois
 * responsáveis vêm do orçamento — e aparecem travados na tela; o servidor
 * relê esses valores do banco em vez de aceitá-los do formulário, então
 * eles não têm campo aqui.
 *
 * Cidade e regional voltaram a ser editáveis em 12/08/2026: chegam
 * pré-preenchidas com o que está no orçamento e, se o usuário trocar, o
 * valor novo é gravado no job E no orçamento — como já acontece com nome
 * e datas. A regional escolhida ainda precisa estar cadastrada no projeto;
 * isso o servidor confere, porque a lista do formulário não é garantia.
 *
 * Não tem `posicao_hierarquia`: não há mais conceito de principal/sub-job.
 *
 * `valor_total` também não está aqui: é recalculado no servidor a partir
 * dos itens da versão aprovada. Valor de faturamento não vem do cliente.
 *
 * Nome, datas, cidade e regional são gravados TAMBÉM no orçamento — ver
 * `enviarJobParaAbertura`.
 *
 * `contatos_cobranca` é o único campo que não vira coluna de `jobs`: vai
 * para a tabela `jobs_contatos`, uma linha por contato, com `tipo`
 * 'cobranca' (17/08/2026 — docs/decisions/012).
 */
export const aberturaJobSchema = z
  .object({
    nome: z
      .string()
      .trim()
      .min(2, "Informe o nome do job (mín. 2 caracteres).")
      .max(200, "Máximo 200 caracteres."),
    cidade_id: z.string().uuid("Selecione a cidade."),
    regional_id: z.string().uuid("Selecione a regional."),
    data_inicio_prevista: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Data de início é obrigatória."),
    data_fim_prevista: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Data de fim é obrigatória."),
    data_prevista_faturamento: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Data prevista para faturamento é obrigatória."),
    observacoes: z
      .string()
      .trim()
      .max(OBSERVACOES_MAX, `Máximo ${OBSERVACOES_MAX} caracteres.`)
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    // Chega como JSON num campo do FormData e é parseado antes de validar
    // (ver `extractInput`). Ao menos um contato é obrigatório desde
    // 17/08/2026: sem ele o financeiro não sabe a quem cobrar.
    contatos_cobranca: z
      .array(contatoCobrancaSchema, {
        required_error: "Informe ao menos um contato de cobrança.",
        invalid_type_error: "Informe ao menos um contato de cobrança.",
      })
      .min(1, "Informe ao menos um contato de cobrança.")
      .max(
        CONTATOS_COBRANCA_MAX,
        `Máximo ${CONTATOS_COBRANCA_MAX} contatos de cobrança.`,
      ),
  })
  .refine((d) => d.data_fim_prevista >= d.data_inicio_prevista, {
    message: "A data de fim não pode ser anterior à data de início.",
    path: ["data_fim_prevista"],
  });

export type AberturaJobInput = z.infer<typeof aberturaJobSchema>;
