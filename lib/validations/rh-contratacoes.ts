/**
 * Schemas de validação do pipeline de Contratação (task 007).
 *
 * Três escopos:
 *   1. `criarContratacaoSchema` — o que o RH preenche no form de nova
 *      contratação (proposta + campos internos).
 *   2. `salvarDadosCandidatoSchema` — o que o candidato preenche na
 *      página pública `/proposta/[token]` depois de aceitar.
 *   3. `motivoTextoSchema` — texto curto pra recusar/desistir.
 *
 * Regras críticas:
 *   - Se `tipo_contratacao` é PJ (pj ou clt_recibo), CNPJ + razão social
 *     + natureza PJ são obrigatórios na hora do aceite.
 *   - Endereço completo (menos complemento) obrigatório pro PJ pra
 *     bater com o modelo de contrato.
 *   - CPF sempre obrigatório.
 *   - Meio de pagamento válido: conta completa OU PIX preenchido.
 */

import { z } from "zod";

const TIPOS_CONTRATACAO = [
  "pj",
  "mei",
  "clt_recibo",
  "clt",
  "estagio",
  "socio",
] as const;
const TIPOS_PJ = ["pj", "clt_recibo"] as const;

const NATUREZAS_PJ = ["mei", "me", "ltda", "eireli", "slu"] as const;

const TIPOS_CONTA = ["corrente", "poupanca", "pagamento"] as const;
const TIPOS_PIX = ["cpf", "cnpj", "email", "telefone", "aleatoria"] as const;

/** Schema do form "Nova contratação" — só o RH. */
export const criarContratacaoSchema = z
  .object({
    nome: z
      .string()
      .trim()
      .min(2, "Nome precisa ter ao menos 2 caracteres.")
      .max(200, "Máximo 200 caracteres."),
    email: z
      .string()
      .trim()
      .min(1, "Informe o e-mail do candidato.")
      .max(200, "Máximo 200 caracteres.")
      .refine(
        (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
        "E-mail inválido.",
      ),
    cargo: z
      .string()
      .trim()
      .min(1, "Informe o cargo.")
      .max(200, "Máximo 200 caracteres."),
    salario_proposto: z
      .string()
      .trim()
      .min(1, "Informe o salário.")
      .transform((v, ctx) => {
        const norm = v.replace(/\./g, "").replace(",", ".");
        const n = Number(norm);
        if (!Number.isFinite(n) || n <= 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Salário precisa ser maior que zero.",
          });
          return z.NEVER;
        }
        return (Math.round(n * 100) / 100).toFixed(2);
      }),
    data_admissao: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
    empresa_id: z.string().trim().min(1, "Selecione uma empresa."),
    regional_id: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    tipo_contratacao: z.enum(TIPOS_CONTRATACAO),
    nivel_id: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    area: z
      .string()
      .trim()
      .max(80, "Máximo 80 caracteres.")
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    pj_natureza: z
      .enum(NATUREZAS_PJ)
      .optional()
      .transform((v) => v ?? null),
    lider_id: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
  })
  .superRefine((val, ctx) => {
    const ehPJ = (TIPOS_PJ as readonly string[]).includes(val.tipo_contratacao);
    if (ehPJ && val.pj_natureza === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pj_natureza"],
        message: "Selecione a natureza do PJ (MEI, ME, LTDA, EIRELI ou SLU).",
      });
    }
  });

export type CriarContratacaoInput = z.infer<typeof criarContratacaoSchema>;

/** Schema do form que o CANDIDATO preenche no /proposta/[token]. */
export const salvarDadosCandidatoSchema = z
  .object({
    cpf: z
      .string()
      .trim()
      .transform((v) => (v ?? "").replace(/\D/g, "")),
    cnpj: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ?? "").replace(/\D/g, ""))
      .transform((v) => (v.length > 0 ? v : null)),
    razao_social: z
      .string()
      .trim()
      .max(200, "Máximo 200 caracteres.")
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    rg: z
      .string()
      .trim()
      .min(1, "Informe o RG.")
      .max(20, "Máximo 20 caracteres."),
    telefone: z
      .string()
      .trim()
      .transform((v) => (v ?? "").replace(/\D/g, ""))
      .refine(
        (v) => v.length === 10 || v.length === 11,
        "Telefone precisa ter 10 (fixo) ou 11 (celular) dígitos.",
      ),
    data_nascimento: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Data de nascimento inválida."),
    cep: z
      .string()
      .trim()
      .transform((v) => (v ?? "").replace(/\D/g, ""))
      .refine((v) => v.length === 8, "CEP precisa ter 8 dígitos."),
    logradouro: z
      .string()
      .trim()
      .min(1, "Informe a rua/avenida.")
      .max(200, "Máximo 200 caracteres."),
    numero: z
      .string()
      .trim()
      .min(1, "Informe o número.")
      .max(20, "Máximo 20 caracteres."),
    complemento: z
      .string()
      .trim()
      .max(100, "Máximo 100 caracteres.")
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    bairro: z
      .string()
      .trim()
      .min(1, "Informe o bairro.")
      .max(100, "Máximo 100 caracteres."),
    cidade: z
      .string()
      .trim()
      .min(1, "Informe a cidade.")
      .max(100, "Máximo 100 caracteres."),
    uf: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, "UF precisa ter 2 letras."),
    banco_codigo: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ?? "").replace(/\D/g, ""))
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
      .transform((v) => (v ?? "").replace(/\D/g, ""))
      .transform((v) => (v.length > 0 ? v : null))
      .refine(
        (v) => v === null || (v.length >= 1 && v.length <= 5),
        "Agência: até 5 dígitos.",
      ),
    agencia_dv: z
      .string()
      .trim()
      .max(1)
      .optional()
      .transform((v) => (v && v.length > 0 ? v.toUpperCase() : null)),
    conta: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ?? "").replace(/\D/g, ""))
      .transform((v) => (v.length > 0 ? v : null))
      .refine(
        (v) => v === null || (v.length >= 1 && v.length <= 12),
        "Conta: até 12 dígitos.",
      ),
    conta_dv: z
      .string()
      .trim()
      .max(1)
      .optional()
      .transform((v) => (v && v.length > 0 ? v.toUpperCase() : null)),
    tipo_conta: z
      .enum(TIPOS_CONTA)
      .optional()
      .transform((v) => v ?? null),
    pix_tipo: z
      .enum(TIPOS_PIX)
      .optional()
      .transform((v) => v ?? null),
    pix_chave: z
      .string()
      .trim()
      .max(200, "Máximo 200 caracteres.")
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    // Campos escondidos passados pelo server pra a refinação saber o
    // tipo_contratacao original da contratação:
    _tipo_contratacao: z.enum(TIPOS_CONTRATACAO),
  })
  .superRefine((val, ctx) => {
    // CPF sempre 11 dígitos
    if (val.cpf.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cpf"],
        message: "Informe o CPF.",
      });
    } else if (val.cpf.length !== 11) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cpf"],
        message: "CPF precisa ter 11 dígitos.",
      });
    }

    // Se PJ: CNPJ + razão social obrigatórios
    const ehPJ = (TIPOS_PJ as readonly string[]).includes(val._tipo_contratacao);
    if (ehPJ) {
      if (val.cnpj === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cnpj"],
          message: "Informe o CNPJ.",
        });
      } else if (val.cnpj.length !== 14) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cnpj"],
          message: "CNPJ precisa ter 14 dígitos.",
        });
      }
      if (val.razao_social === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["razao_social"],
          message: "Informe a razão social.",
        });
      }
    } else if (val.cnpj !== null && val.cnpj.length !== 14) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cnpj"],
        message: "CNPJ precisa ter 14 dígitos.",
      });
    }

    // Meio de pagamento: conta completa OU PIX válido
    const contaCompleta =
      val.banco_codigo !== null &&
      val.agencia !== null &&
      val.conta !== null &&
      val.conta_dv !== null &&
      val.tipo_conta !== null;
    const temPix = val.pix_chave !== null && val.pix_tipo !== null;
    if (!contaCompleta && !temPix) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["banco_codigo"],
        message:
          "Preencha os dados bancários OU o PIX. Um dos dois é obrigatório.",
      });
    }
  });

export type SalvarDadosCandidatoInput = z.infer<
  typeof salvarDadosCandidatoSchema
>;

/** Schema pra recusa/desistência — motivo curto obrigatório. */
export const motivoTextoSchema = z.object({
  motivo: z
    .string()
    .trim()
    .min(3, "Escreva o motivo (mínimo 3 caracteres).")
    .max(500, "Máximo 500 caracteres."),
});
