import { z } from "zod";
import { apenasDigitosCnpj, cnpjValido } from "@/lib/utils/cnpj";

export const empresaContabilSchema = z.object({
  razao_social: z
    .string()
    .trim()
    .min(3, "Razão social é obrigatória.")
    .max(200, "Razão social muito longa."),
  nome_fantasia: z
    .string()
    .trim()
    .max(120, "Nome fantasia muito longo.")
    .optional()
    .or(z.literal("")),
  cnpj: z
    .string()
    .transform(apenasDigitosCnpj)
    .refine((v) => v.length === 14, "CNPJ deve ter 14 dígitos.")
    .refine(cnpjValido, "CNPJ inválido."),
});

export type EmpresaContabilInput = z.infer<typeof empresaContabilSchema>;

/**
 * Configuração CNAB Santander da empresa contábil. Necessária pra
 * geração de arquivo de remessa. Todos os campos são obrigatórios em
 * conjunto — ou preenche tudo, ou deixa tudo vazio; parcial não faz
 * sentido operacional.
 *
 * `sequencial_arquivo` começa em 11 pra evitar a faixa 1-10 que o
 * Santander trata como teste (Nota G010 do manual).
 */
export const configCnabSantanderSchema = z
  .object({
    convenio_cnab_santander: z
      .string()
      .trim()
      .max(20, "Convênio tem no máximo 20 caracteres.")
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    agencia_debito: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ?? "").replace(/\D/g, ""))
      .transform((v) => (v.length > 0 ? v : null))
      .refine(
        (v) => v === null || (v.length >= 1 && v.length <= 5),
        "Agência precisa ter até 5 dígitos.",
      ),
    agencia_debito_dv: z
      .string()
      .trim()
      .max(1, "Máximo 1 caractere.")
      .optional()
      .transform((v) => (v && v.length > 0 ? v.toUpperCase() : null)),
    conta_debito: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ?? "").replace(/\D/g, ""))
      .transform((v) => (v.length > 0 ? v : null))
      .refine(
        (v) => v === null || (v.length >= 1 && v.length <= 12),
        "Conta precisa ter até 12 dígitos.",
      ),
    conta_debito_dv: z
      .string()
      .trim()
      .max(1, "Máximo 1 caractere.")
      .optional()
      .transform((v) => (v && v.length > 0 ? v.toUpperCase() : null)),
    sequencial_arquivo: z
      .string()
      .trim()
      .optional()
      .transform((v) => {
        if (!v || v.length === 0) return null;
        const n = Number(v.replace(/\D/g, ""));
        return Number.isFinite(n) && n >= 0 ? n : null;
      })
      .refine(
        (v) => v === null || v >= 11,
        "Sequencial precisa ser >= 11 (evita faixa de teste 1-10).",
      ),
    endereco_logradouro: z
      .string()
      .trim()
      .max(200, "Máximo 200 caracteres.")
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    endereco_cidade: z
      .string()
      .trim()
      .max(100, "Máximo 100 caracteres.")
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    endereco_cep: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ?? "").replace(/\D/g, ""))
      .transform((v) => (v.length > 0 ? v : null))
      .refine(
        (v) => v === null || v.length === 8,
        "CEP precisa ter 8 dígitos.",
      ),
    endereco_uf: z
      .string()
      .trim()
      .max(2, "UF tem 2 caracteres.")
      .optional()
      .transform((v) => (v && v.length > 0 ? v.toUpperCase() : null))
      .refine(
        (v) => v === null || v.length === 2,
        "UF precisa ter 2 letras.",
      ),
  })
  .superRefine((val, ctx) => {
    // Se preencheu convênio, tudo o mais é obrigatório junto.
    const temConvenio = val.convenio_cnab_santander !== null;
    if (!temConvenio) return;

    const obrigatorios: [keyof typeof val, string][] = [
      ["agencia_debito", "Preencha a agência do débito."],
      ["conta_debito", "Preencha a conta do débito."],
      ["sequencial_arquivo", "Preencha o sequencial (comece em 11)."],
    ];
    for (const [campo, msg] of obrigatorios) {
      if (val[campo] === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [campo],
          message: msg,
        });
      }
    }
  });

export type ConfigCnabSantanderInput = z.infer<typeof configCnabSantanderSchema>;
