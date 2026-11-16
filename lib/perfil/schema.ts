import { z } from "zod";
import { isValidCpf, isValidCnpj, onlyDigits } from "@/lib/utils";

/**
 * Schema de rascunho do perfil do colaborador — usado pelo wizard de
 * boas-vindas e pela edição posterior.
 *
 * Todos os campos são opcionais pra permitir salvamento progressivo
 * passo a passo. A validação de "perfil completo" (todos obrigatórios
 * preenchidos + documentos anexados) acontece na RPC
 * `completar_meu_perfil_colaborador` no banco, chamada só no último
 * passo do wizard.
 *
 * Formatos: CPF, CNPJ, CEP e telefone são normalizados pra só dígitos
 * antes de ir pro banco. Enums são validados contra a lista do
 * `lib/types`.
 */

// Helpers --------------------------------------------------------------

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const cpfOpcional = z
  .string()
  .transform(onlyDigits)
  .refine((v) => v === "" || (v.length === 11 && isValidCpf(v)), {
    message: "CPF inválido",
  })
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const cnpjOpcional = z
  .string()
  .transform(onlyDigits)
  .refine((v) => v === "" || (v.length === 14 && isValidCnpj(v)), {
    message: "CNPJ inválido",
  })
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const cepOpcional = z
  .string()
  .transform(onlyDigits)
  .refine((v) => v === "" || v.length === 8, { message: "CEP deve ter 8 dígitos" })
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const telefoneOpcional = z
  .string()
  .transform(onlyDigits)
  .refine((v) => v === "" || (v.length >= 10 && v.length <= 11), {
    message: "Telefone deve ter DDD + 8 ou 9 dígitos",
  })
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const dataIsoOpcional = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Data inválida (use AAAA-MM-DD)" })
  .refine((v) => !Number.isNaN(new Date(v).getTime()), { message: "Data inválida" })
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional()
  .or(z.literal("").transform(() => null));

const emailOpcional = z
  .string()
  .trim()
  .toLowerCase()
  .email({ message: "Email inválido" })
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional()
  .or(z.literal("").transform(() => null));

const ufOpcional = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^$|^[A-Z]{2}$/, { message: "UF inválida (use 2 letras)" })
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

// Schema completo ------------------------------------------------------

export const perfilRascunhoSchema = z.object({
  // Como gosta de ser chamado + dados pessoais
  nome_preferido: textoOpcional(120),
  cidade_origem: textoOpcional(100),
  data_nascimento: dataIsoOpcional,
  estado_civil: z
    .enum([
      "solteiro",
      "casado",
      "uniao_estavel",
      "divorciado",
      "viuvo",
      "separado",
    ])
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  possui_filhos: z.boolean().nullable().optional(),
  tamanho_camiseta: z
    .enum(["pp", "p", "m", "g", "gg", "xg", "xxg"])
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),

  // Contato
  telefone: telefoneOpcional,
  email_pessoal: emailOpcional,

  // Documentos pessoais (campos; arquivos ficam em colaboradores_documentos)
  rg: textoOpcional(30),
  cpf: cpfOpcional,

  // Endereço residencial
  cep: cepOpcional,
  logradouro: textoOpcional(200),
  numero: textoOpcional(20),
  complemento: textoOpcional(100),
  bairro: textoOpcional(100),
  cidade: textoOpcional(100),
  uf: ufOpcional,

  // Dados PJ (obrigatórios pra pj/mei/clt_recibo)
  cnpj: cnpjOpcional,
  razao_social: textoOpcional(200),
  pj_natureza: z
    .enum(["mei", "me", "ltda", "eireli", "slu"])
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),

  // Bancário
  banco_codigo: textoOpcional(10),
  banco_nome: textoOpcional(100),
  agencia: textoOpcional(10),
  agencia_dv: textoOpcional(2),
  conta: textoOpcional(20),
  conta_dv: textoOpcional(2),
  tipo_conta: z
    .enum(["corrente", "poupanca", "pagamento"])
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),

  // PIX
  pix_tipo: z
    .enum(["cpf", "cnpj", "email", "telefone", "aleatoria"])
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  pix_chave: textoOpcional(200),

  // Diversidade e saúde
  vegetariano: z.boolean().nullable().optional(),
  restricao_alimentar: textoOpcional(500),
  etnia: z
    .enum([
      "branca",
      "preta",
      "parda",
      "amarela",
      "indigena",
      "prefiro_nao_informar",
    ])
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  genero_identidade: z
    .enum([
      "mulher_cis",
      "mulher_trans",
      "homem_cis",
      "homem_trans",
      "nao_binario",
      "outro",
      "prefiro_nao_informar",
    ])
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  orientacao_sexual: z
    .enum([
      "heterossexual",
      "homossexual",
      "bissexual",
      "assexual",
      "pansexual",
      "outro",
      "prefiro_nao_informar",
    ])
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  pcd: z
    .enum(["nao", "sim", "prefiro_nao_informar"])
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  pcd_descricao: textoOpcional(500),
  observacao_saude: textoOpcional(500),

  // Contato de emergência
  emergencia_nome: textoOpcional(120),
  emergencia_parentesco: textoOpcional(60),
  emergencia_telefone: telefoneOpcional,

  // Sobre você
  hobbies: textoOpcional(500),
  curiosidade: textoOpcional(500),

  // Foto (caminho no bucket; upload acontece separado)
  foto_path: textoOpcional(400),
});

export type PerfilRascunho = z.infer<typeof perfilRascunhoSchema>;
