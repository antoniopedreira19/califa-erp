import { z } from "zod";

/**
 * Schemas do módulo RH — colaborador, alocação, salário.
 *
 * Ver docs/modulos/rh/03-modelo-de-dados.md.
 */

export const TIPOS_CONTRATACAO_PJ = ["pj", "mei", "clt_recibo"] as const;
export const TIPOS_CONTRATACAO_PF = ["clt", "estagio"] as const;

const tipoContratacaoEnum = z.enum([
  ...TIPOS_CONTRATACAO_PJ,
  ...TIPOS_CONTRATACAO_PF,
]);

/**
 * Schema base do colaborador — dados fixos que não mudam com alocação
 * nem com folha. CPF/CNPJ opcional no cadastro rápido (será exigido pela
 * folha na fase futura).
 */
export const colaboradorSchema = z
  .object({
    nome: z
      .string()
      .trim()
      .min(2, "Nome precisa ter ao menos 2 caracteres.")
      .max(200, "Máximo 200 caracteres."),
    email: z
      .string()
      .trim()
      .max(200, "Máximo 200 caracteres.")
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null))
      .refine(
        (v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
        "E-mail inválido.",
      ),
    tipo_contratacao: tipoContratacaoEnum,
    cpf_cnpj: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v.replace(/\D/g, "") : ""))
      .transform((v) => (v.length > 0 ? v : null)),
    funcao: z
      .string()
      .trim()
      .min(1, "Informe a função.")
      .max(200, "Máximo 200 caracteres."),
    nivel_id: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    data_admissao: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
  })
  .superRefine((val, ctx) => {
    // Formato do documento pelo tipo de contratação
    if (val.cpf_cnpj !== null) {
      const isPJ = (TIPOS_CONTRATACAO_PJ as readonly string[]).includes(
        val.tipo_contratacao,
      );
      const isPF = (TIPOS_CONTRATACAO_PF as readonly string[]).includes(
        val.tipo_contratacao,
      );
      if (isPJ && val.cpf_cnpj.length !== 14) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cpf_cnpj"],
          message: "CNPJ precisa ter 14 dígitos.",
        });
      }
      if (isPF && val.cpf_cnpj.length !== 11) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cpf_cnpj"],
          message: "CPF precisa ter 11 dígitos.",
        });
      }
    }
  });

export type ColaboradorInput = z.infer<typeof colaboradorSchema>;

/**
 * Schema da alocação inicial no cadastro do colaborador. Uma única
 * alocação de 100% em par (empresa, regional). Alocações adicionais e
 * rateio (< 100%) são feitos na página de detalhe.
 */
export const alocacaoInicialSchema = z.object({
  empresa_id: z
    .string()
    .trim()
    .min(1, "Selecione uma empresa."),
  regional_id: z
    .string()
    .trim()
    .min(1, "Selecione uma regional."),
  data_inicio: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
});

/**
 * Schema da alocação com percentual — usado na página de detalhe
 * quando o RH adiciona/edita rateio. Também na revisão do financeiro
 * sobre a folha (fase futura, na Camada 2).
 */
export const alocacaoSchema = z.object({
  empresa_id: z.string().trim().min(1, "Selecione uma empresa."),
  regional_id: z.string().trim().min(1, "Selecione uma regional."),
  percentual: z
    .string()
    .trim()
    .min(1, "Informe o percentual.")
    .transform((v, ctx) => {
      // Aceita "50", "50,5", "50.5"
      const norm = v.replace(",", ".");
      const n = Number(norm);
      if (!Number.isFinite(n) || n <= 0 || n > 100) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Percentual deve ser maior que 0 e no máximo 100.",
        });
        return z.NEVER;
      }
      // Arredonda a 2 decimais e retorna string para insert bater com numeric(5,2)
      return (Math.round(n * 100) / 100).toFixed(2);
    }),
  data_inicio: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
  motivo: z
    .string()
    .trim()
    .max(500, "Máximo 500 caracteres.")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export type AlocacaoInput = z.infer<typeof alocacaoSchema>;

/**
 * Schema do salário inicial no cadastro (ou registrado como mudança
 * depois). Valor > 0.
 */
export const salarioSchema = z.object({
  valor: z
    .string()
    .trim()
    .min(1, "Informe o valor do salário.")
    .transform((v, ctx) => {
      // Aceita "3000", "3000,00", "3000.00", "3.000,00"
      const norm = v.replace(/\./g, "").replace(",", ".");
      const n = Number(norm);
      if (!Number.isFinite(n) || n <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Valor precisa ser maior que zero.",
        });
        return z.NEVER;
      }
      return (Math.round(n * 100) / 100).toFixed(2);
    }),
  data_inicio: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
  motivo: z
    .string()
    .trim()
    .max(500, "Máximo 500 caracteres.")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export type SalarioInput = z.infer<typeof salarioSchema>;

/**
 * Dados bancários do colaborador para pagamento por remessa CNAB.
 * Todos os campos são opcionais no cadastro — o gate de completude é
 * a hora de gerar remessa, não o cadastro. Módulo pgto-remessa.
 */
export const TIPOS_CONTA_BANCARIA = ["corrente", "poupanca", "pagamento"] as const;
export const TIPOS_CHAVE_PIX = [
  "cpf",
  "cnpj",
  "email",
  "telefone",
  "aleatoria",
] as const;

const somenteDigitos = (v: string | undefined) =>
  (v ?? "").replace(/\D/g, "");

export const dadosBancariosColaboradorSchema = z
  .object({
    banco_codigo: z
      .string()
      .trim()
      .optional()
      .transform((v) => somenteDigitos(v))
      .transform((v) => (v.length > 0 ? v : null))
      .refine(
        (v) => v === null || v.length === 3,
        "Código do banco precisa ter 3 dígitos.",
      ),
    banco_nome: z
      .string()
      .trim()
      .max(200, "Máximo 200 caracteres.")
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    agencia: z
      .string()
      .trim()
      .optional()
      .transform((v) => somenteDigitos(v))
      .transform((v) => (v.length > 0 ? v : null))
      .refine(
        (v) => v === null || (v.length >= 1 && v.length <= 5),
        "Agência precisa ter até 5 dígitos.",
      ),
    agencia_dv: z
      .string()
      .trim()
      .max(1, "Máximo 1 caractere.")
      .optional()
      .transform((v) => (v && v.length > 0 ? v.toUpperCase() : null)),
    conta: z
      .string()
      .trim()
      .optional()
      .transform((v) => somenteDigitos(v))
      .transform((v) => (v.length > 0 ? v : null))
      .refine(
        (v) => v === null || (v.length >= 1 && v.length <= 12),
        "Conta precisa ter até 12 dígitos.",
      ),
    conta_dv: z
      .string()
      .trim()
      .max(1, "Máximo 1 caractere.")
      .optional()
      .transform((v) => (v && v.length > 0 ? v.toUpperCase() : null)),
    tipo_conta: z
      .enum(TIPOS_CONTA_BANCARIA)
      .optional()
      .transform((v) => v ?? null),
    pix_tipo: z
      .enum(TIPOS_CHAVE_PIX)
      .optional()
      .transform((v) => v ?? null),
    pix_chave: z
      .string()
      .trim()
      .max(200, "Máximo 200 caracteres.")
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
  })
  .superRefine((val, ctx) => {
    // Se preencheu conta, agência é obrigatória (e vice-versa)
    const bancoParcial =
      (val.banco_codigo || val.agencia || val.conta) &&
      !(val.banco_codigo && val.agencia && val.conta);
    if (bancoParcial) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Se for cadastrar conta bancária, preencha banco, agência e conta.",
        path: ["banco_codigo"],
      });
    }
    // Se preencheu chave PIX, tipo é obrigatório (e vice-versa)
    if ((val.pix_tipo && !val.pix_chave) || (val.pix_chave && !val.pix_tipo)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Preencha tipo e chave PIX juntos.",
        path: ["pix_chave"],
      });
    }
  });

export type DadosBancariosColaboradorInput = z.infer<
  typeof dadosBancariosColaboradorSchema
>;
