import { z } from "zod";
import { isValidCpf, isValidCnpj, onlyDigits } from "@/lib/utils";
import { normalizarChavePix, problemaDaChavePix } from "@/lib/pix";

/**
 * Schema de validação do cadastro de freelancer.
 *
 * Regras não óbvias:
 *   - CPF é opcional, mas se preenchido tem que ter 11 dígitos válidos.
 *   - CNPJ é opcional, idem com 14 dígitos.
 *   - CNPJ + razão social andam juntos (banco trava com check constraint;
 *     o schema faz a mesma validação pra mensagem amigável antes do submit).
 *   - Se tipo_pagamento = 'pix', chave PIX é obrigatória.
 *   - Decisão 212: chave PIX pede o tipo, e a chave é conferida e gravada no
 *     formato do banco (`lib/pix`), como no fornecedor e no colaborador. O
 *     tipo de conta é opcional.
 *   - Datas no formato ISO YYYY-MM-DD.
 *   - Email vazio é válido (campo opcional). z.string().email() não aceita
 *     vazio nativo — por isso o `.or(z.literal(""))`.
 *
 * Transformações:
 *   - CPF, CNPJ, CEP e celular são normalizados pra só dígitos antes de
 *     ir pro banco. UI formata na leitura.
 *   - Campos texto são `.trim()`-ados pra evitar whitespace fantasma.
 */

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const digitosOpcional = (len: number) =>
  z
    .string()
    .transform(onlyDigits)
    .refine((v) => v === "" || v.length === len, {
      message: `Deve ter ${len} dígitos`,
    })
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const digitosOpcionalEntre = (min: number, max: number) =>
  z
    .string()
    .transform(onlyDigits)
    .refine((v) => v === "" || (v.length >= min && v.length <= max), {
      message: `Deve ter entre ${min} e ${max} dígitos`,
    })
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

export const freelancerSchema = z
  .object({
    // Identificação
    nome_social: z
      .string()
      .trim()
      .min(2, { message: "Nome social deve ter ao menos 2 caracteres" })
      .max(120, { message: "Nome social muito longo" }),
    nome_completo: z
      .string()
      .trim()
      .min(2, { message: "Nome completo é obrigatório" })
      .max(200, { message: "Nome completo muito longo" })
      .refine((v) => v.trim().split(/\s+/).length >= 2, {
        message: "Informe nome e sobrenome",
      }),

    cpf: z
      .string()
      .transform(onlyDigits)
      .refine((v) => v === "" || (v.length === 11 && isValidCpf(v)), {
        message: "CPF inválido",
      })
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional(),

    rg: textoOpcional(30),

    data_nascimento: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Data inválida" })
      .refine((v) => !Number.isNaN(new Date(v).getTime()), { message: "Data inválida" })
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional()
      .or(z.literal("")),

    // Contato
    email: z
      .string()
      .trim()
      .email({ message: "Email inválido" })
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional()
      .or(z.literal("")),

    celular: digitosOpcionalEntre(10, 11),

    // Endereço
    cep: digitosOpcional(8),
    rua: textoOpcional(200),
    numero: textoOpcional(20),
    complemento: textoOpcional(100),
    bairro: textoOpcional(100),
    cidade: textoOpcional(100),

    // Pessoa jurídica
    cnpj: z
      .string()
      .transform(onlyDigits)
      .refine((v) => v === "" || (v.length === 14 && isValidCnpj(v)), {
        message: "CNPJ inválido",
      })
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional(),

    razao_social: textoOpcional(200),

    // Pagamento
    tipo_pagamento: z
      .enum(["conta_bancaria", "pix"])
      .nullable()
      .optional()
      .or(z.literal("").transform(() => null)),

    banco: textoOpcional(100),
    agencia: textoOpcional(20),
    conta: textoOpcional(30),
    // Decisão 212. "" = não informado.
    tipo_conta: z
      .enum(["corrente", "poupanca", "pagamento"])
      .nullable()
      .optional()
      .or(z.literal("").transform(() => null)),
    pix_chave: textoOpcional(140),
    pix_tipo: z
      .enum(["cpf", "cnpj", "email", "telefone", "aleatoria"])
      .nullable()
      .optional()
      .or(z.literal("").transform(() => null)),

    // Diversidade
    cor_raca: textoOpcional(100),
    identidade_genero: textoOpcional(100),
    deficiencia: textoOpcional(200),
    saude_obs: textoOpcional(500),
    contato_emergencia: textoOpcional(100),

    // Workflow
    acao_prevista: z
      .enum(["contratar", "renovar", "manter", "substituir", "encerrar"])
      .nullable()
      .optional()
      .or(z.literal("").transform(() => null)),
  })
  .superRefine((v, ctx) => {
    // CNPJ + razão social são par
    const temCnpj = !!v.cnpj;
    const temRazao = !!v.razao_social;
    if (temCnpj !== temRazao) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: temCnpj ? ["razao_social"] : ["cnpj"],
        message: temCnpj
          ? "Razão Social obrigatória quando CNPJ está preenchido"
          : "CNPJ obrigatório quando Razão Social está preenchida",
      });
    }

    // Decisão 212: a chave PIX vai com o tipo, e só no formato que o banco
    // aceita (a régua do fornecedor e do colaborador).
    if (v.pix_chave && !v.pix_tipo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pix_tipo"],
        message: "Escolha o tipo da chave PIX",
      });
    }
    if (v.pix_tipo && !v.pix_chave) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pix_chave"],
        message: "Informe a chave PIX",
      });
    }
    if (v.pix_tipo && v.pix_chave) {
      const problema = problemaDaChavePix(v.pix_tipo, v.pix_chave);
      if (problema) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pix_chave"], message: problema });
      }
    }

    // Se tipo_pagamento = pix, chave PIX é obrigatória
    if (v.tipo_pagamento === "pix" && !v.pix_chave) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pix_chave"],
        message: "Chave PIX obrigatória quando tipo de pagamento é PIX",
      });
    }

    // Se tipo_pagamento = conta_bancaria, pede banco/agencia/conta
    if (v.tipo_pagamento === "conta_bancaria") {
      if (!v.banco)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["banco"],
          message: "Banco obrigatório",
        });
      if (!v.agencia)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["agencia"],
          message: "Agência obrigatória",
        });
      if (!v.conta)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["conta"],
          message: "Conta obrigatória",
        });
    }
  })
  // Decisão 212: a chave vai para o banco no formato canônico do tipo
  // (CPF/CNPJ só dígitos, e-mail em minúsculas, telefone com +55).
  .transform((v) =>
    v.pix_tipo && v.pix_chave ? { ...v, pix_chave: normalizarChavePix(v.pix_tipo, v.pix_chave) ?? v.pix_chave } : v,
  );

export type FreelancerInput = z.infer<typeof freelancerSchema>;

/**
 * Schema estrito usado em CRIAÇÃO (form admin "Novo freelancer" e form
 * público preenchido pelo próprio freelancer). Exige endereço estruturado
 * completo + CNPJ/razão social.
 *
 * A EDIÇÃO continua usando o schema base — validação cruzada de
 * obrigatoriedade (com fallback pro `endereco_legado` dos migrados) é feita
 * na action `atualizarFreelancer`, que lê o estado atual do banco. Isso
 * evita bloquear o save dos 190 freelas migrados do RH antigo que estão
 * sem o endereço estruturado mas com o legado preservado.
 */
export const freelancerCriarSchema = freelancerSchema.superRefine((v, ctx) => {
  if (!v.cep)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cep"], message: "CEP obrigatório" });
  if (!v.rua)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rua"], message: "Rua obrigatória" });
  if (!v.numero)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["numero"], message: "Número obrigatório" });
  if (!v.bairro)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["bairro"], message: "Bairro obrigatório" });
  if (!v.cidade)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cidade"], message: "Cidade obrigatória" });
  if (!v.cnpj)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cnpj"], message: "CNPJ obrigatório" });
  if (!v.razao_social)
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["razao_social"],
      message: "Razão Social obrigatória",
    });
});
