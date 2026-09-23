import { z } from "zod";
import { problemaDaChavePix } from "@/lib/pix";
import { getBancoByCodigo } from "@/lib/dados/bancos-febraban";

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
 * Schema da alocação vigente do colaborador (Camada 1). Novo modelo
 * (2026-09-23): 1 vigente por vez, com toggle "todas as regionais".
 *
 * Regras:
 *   - Se `usa_rateio_empresa = true` → `regional_id` deve ser null (o
 *     custo é expandido pelo rateio da empresa no snapshot da folha).
 *   - Se `usa_rateio_empresa = false` → `regional_id` obrigatório
 *     (100% do custo naquela regional).
 *
 * O toggle só é oferecido na UI quando a empresa tem rateio configurado
 * pra o ano corrente (empresas_rateios_regionais).
 */
export const alocacaoSchema = z
  .object({
    empresa_id: z.string().trim().min(1, "Selecione uma empresa."),
    usa_rateio_empresa: z.boolean().default(false),
    regional_id: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
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
  })
  .superRefine((v, ctx) => {
    if (v.usa_rateio_empresa && v.regional_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["regional_id"],
        message:
          'Não escolha regional quando "Todas as regionais" está ligado.',
      });
    }
    if (!v.usa_rateio_empresa && !v.regional_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["regional_id"],
        message: "Selecione uma regional.",
      });
    }
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
 * Conta e PIX são opcionais, cada um; mas o que for preenchido tem de
 * estar completo e no formato do arquivo de remessa (23/09/2026 — ver o
 * superRefine). Módulo pgto-remessa.
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
    // Os dados daqui saem no arquivo de remessa CNAB. Desde 23/09/2026 a
    // régua é a mesma do cadastro de fornecedor: bloco bancário começado
    // tem de estar completo, e a chave PIX tem de estar no formato que o
    // Santander aceita — o que não sair certo no arquivo não se grava.
    const bancoParcial =
      val.banco_codigo || val.agencia || val.agencia_dv || val.conta || val.conta_dv || val.tipo_conta;
    const bancoCompleto =
      val.banco_codigo && val.agencia && val.conta && val.conta_dv && val.tipo_conta;
    if (bancoParcial && !bancoCompleto) {
      const faltam: Array<[keyof typeof val, string]> = [
        ["banco_codigo", "Informe o banco."],
        ["agencia", "Agência obrigatória."],
        ["conta", "Conta obrigatória."],
        ["conta_dv", "Dígito da conta obrigatório."],
        ["tipo_conta", "Tipo de conta obrigatório."],
      ];
      for (const [campo, message] of faltam) {
        if (!val[campo])
          ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [campo] });
      }
    }
    if (val.banco_codigo && !getBancoByCodigo(val.banco_codigo)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Banco inválido.",
        path: ["banco_codigo"],
      });
    }
    if (val.agencia_dv && !/^[0-9X]$/.test(val.agencia_dv)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Dígito da agência inválido.",
        path: ["agencia_dv"],
      });
    }
    if (val.conta_dv && !/^[0-9X]$/.test(val.conta_dv)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Dígito da conta inválido.",
        path: ["conta_dv"],
      });
    }

    const problemaPix = problemaDaChavePix(val.pix_tipo, val.pix_chave);
    if (problemaPix) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: problemaPix,
        path: [val.pix_tipo ? "pix_chave" : "pix_tipo"],
      });
    }
  });

export type DadosBancariosColaboradorInput = z.infer<
  typeof dadosBancariosColaboradorSchema
>;
