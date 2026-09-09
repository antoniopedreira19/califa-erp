import { z } from "zod";
import { isValidCnpj, onlyDigits } from "@/lib/utils";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Schema de cliente (PJ).
 *
 * CNPJ é obrigatório desde 09/09/2026 (decisão do Tiago, junto com o
 * desenho "Clientes - Novo Cadastro"): é ele que impede cadastro repetido
 * da mesma empresa. Vale também na edição — dos 157 clientes de então, só
 * 3 estavam sem CNPJ, e um deles é real (SEBRAE).
 *
 * E-mail e telefone continuam opcionais, de propósito: 155 dos 157
 * clientes não tinham e-mail e 156 não tinham telefone, e obrigá-los
 * travaria a edição de praticamente toda a base.
 *
 * Todos os campos que vêm como string vazia são normalizados para null
 * antes de gravar.
 */
export const clienteSchema = z.object({
  nome_fantasia: z
    .string()
    .trim()
    .min(2, "Informe o nome fantasia (mín. 2 caracteres).")
    .max(200, "Máximo 200 caracteres."),
  codigo_curto: z
    .string()
    .trim()
    .min(1, "Informe o código.")
    .max(50, "Máximo 50 caracteres."),
  razao_social: z
    .string()
    .trim()
    .max(200, "Máximo 200 caracteres.")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  cnpj: z
    .string()
    .optional()
    .transform((v) => (v ? onlyDigits(v) : ""))
    .refine((v) => v !== "", "Informe o CNPJ.")
    .refine((v) => v === "" || v.length === 14, "CNPJ deve ter 14 dígitos.")
    .refine((v) => v === "" || isValidCnpj(v), "CNPJ inválido."),
  email: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null))
    .refine((v) => v === null || EMAIL_RE.test(v), "E-mail inválido."),
  telefone: z
    .string()
    .optional()
    .transform((v) => (v ? onlyDigits(v) : ""))
    .refine(
      (v) => v === "" || v.length === 10 || v.length === 11,
      "Telefone deve ter 10 ou 11 dígitos.",
    )
    .transform((v) => (v === "" ? null : v)),
  observacoes: z
    .string()
    .trim()
    .max(2000, "Máximo 2000 caracteres.")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  /**
   * Honorários padrão do cliente. Obrigatório: é ele que abastece toda
   * versão de orçamento do cliente, então não pode nascer indefinido.
   * Aceita "12" e "12,5" — o formulário é pt-BR.
   */
  percentual_honorarios_padrao: z
    .string()
    .trim()
    .min(1, "Informe o percentual de honorários.")
    .transform((v) => Number(v.replace(",", ".")))
    .refine((n) => Number.isFinite(n), "Percentual inválido.")
    .refine(
      (n) => n >= 0 && n <= 100,
      "Percentual de honorários precisa estar entre 0 e 100.",
    ),
});

export type ClienteInput = z.infer<typeof clienteSchema>;

/**
 * Contatos adicionais (colunas `emails_extras` / `telefones_extras`).
 *
 * Linha em branco é descartada em silêncio — o desenho deixa a linha
 * vazia na tela enquanto a pessoa decide, e sair sem preencher não pode
 * virar erro. O que sobra precisa ser válido.
 */
export const emailsExtrasSchema = z
  .array(z.string())
  .default([])
  .transform((lista) => lista.map((v) => v.trim()).filter((v) => v !== ""))
  .superRefine((lista, ctx) => {
    lista.forEach((valor, i) => {
      if (!EMAIL_RE.test(valor)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `E-mail adicional inválido: "${valor}".`,
          path: [i],
        });
      }
      if (valor.length > 200) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Máximo 200 caracteres.",
          path: [i],
        });
      }
    });
  });

export const telefonesExtrasSchema = z
  .array(z.string())
  .default([])
  .transform((lista) => lista.map((v) => onlyDigits(v)).filter((v) => v !== ""))
  .superRefine((lista, ctx) => {
    lista.forEach((valor, i) => {
      if (valor.length !== 10 && valor.length !== 11) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Telefone adicional deve ter 10 ou 11 dígitos.",
          path: [i],
        });
      }
    });
  });

/**
 * Marcas e portais que chegam junto do cliente (desenho de 09/09/2026).
 *
 * Antes só dava para cadastrá-los depois de o cliente existir, em cartões
 * separados na tela de edição. Agora vêm no mesmo envio do formulário.
 *
 * `id` presente = registro que já existe no banco (edição); ausente =
 * linha nova. A marca padrão (PRD-01) nunca entra nesta lista: ela é
 * criada e renomeada pelo próprio cadastro do cliente.
 */
export const marcaLinhaSchema = z.object({
  id: z.string().uuid().optional(),
  nome: z
    .string()
    .trim()
    .min(1, "Informe o nome da marca.")
    .max(120, "Máximo 120 caracteres."),
  /** Marca e portal nunca são apagados — jobs e envios de faturamento
   *  antigos apontam para eles. O "X" da tela inativa; a linha continua
   *  no formulário, apagada, com a opção de reativar. */
  ativo: z.boolean().default(true),
});

export const portalLinhaSchema = z.object({
  id: z.string().uuid().optional(),
  nome: z
    .string()
    .trim()
    .min(1, "Informe o nome do portal.")
    .max(80, "Máximo 80 caracteres."),
  ativo: z.boolean().default(true),
  url: z
    .string()
    .trim()
    .min(1, "Informe o link do portal.")
    .max(500, "Máximo 500 caracteres.")
    .refine(
      (v) => /^https?:\/\//i.test(v),
      "O link precisa começar com http:// ou https://.",
    ),
});

/** Linha totalmente vazia é descarte, não erro: o botão "Adicionar" cria
 *  a linha antes de a pessoa digitar, e salvar sem preencher é comum. */
export const marcasSchema = z
  .array(
    z.object({
      id: z.string().optional(),
      nome: z.string(),
      ativo: z.boolean().optional(),
    }),
  )
  .default([])
  .transform((lista) => lista.filter((m) => m.nome.trim() !== ""))
  .pipe(z.array(marcaLinhaSchema));

export const portaisSchema = z
  .array(
    z.object({
      id: z.string().optional(),
      nome: z.string(),
      url: z.string(),
      ativo: z.boolean().optional(),
    }),
  )
  .default([])
  .transform((lista) =>
    lista.filter((p) => p.nome.trim() !== "" || p.url.trim() !== ""),
  )
  .pipe(z.array(portalLinhaSchema));

export type MarcaLinha = z.infer<typeof marcaLinhaSchema>;
export type PortalLinha = z.infer<typeof portalLinhaSchema>;

/** Padrão comercial da agência — usado quando o campo chega vazio na
 *  edição de um cadastro antigo. Espelha o default da coluna no banco. */
export const HONORARIOS_PADRAO_FALLBACK = 12;
