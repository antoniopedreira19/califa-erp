/**
 * Cadastro de impostos (módulo fiscal, entrega 1 — 02/10/2026): validação
 * das edições da tela Cadastros do Financeiro › Impostos e as contas puras
 * que ela faz (máscara do CNAE, percentual digitado com vírgula, véspera da
 * vigência nova, PIS/COFINS pela opção de crédito).
 *
 * Usado pelas Server Actions de `app/(app)/financeiro/cadastros/impostos`
 * e pelos diálogos da tela (o cliente mostra o mesmo que o servidor aceita).
 * Testes: `node --import tsx --test lib/validations/fiscal-cadastro.test.ts`.
 */
import { z } from "zod";
import { apenasDigitosCnpj, cnpjValido } from "@/lib/utils/cnpj";
import { addDias } from "@/lib/fiscal/datas";

// ---------------------------------------------------------------------------
// Contas puras
// ---------------------------------------------------------------------------

/** "00.00-0-00": o formato do código CNAE (o mesmo CHECK de `fiscal_cnaes`). */
export const FORMATO_CNAE = /^[0-9]{2}\.[0-9]{2}-[0-9]-[0-9]{2}$/;

/** Subitem da LC 116 ("12.08", "17.10", "1.03"). */
export const FORMATO_SUBITEM = /^[0-9]{1,2}\.[0-9]{2}$/;

/** Máscara progressiva do CNAE: "8230001" → "82.30-0-01". */
export function formatarCodigoCnae(entrada: string): string {
  const d = entrada.replace(/\D/g, "").slice(0, 7);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length === 5) return `${d.slice(0, 2)}.${d.slice(2, 4)}-${d.slice(4)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 4)}-${d.slice(4, 5)}-${d.slice(5)}`;
}

/**
 * Percentual digitado ("2,5", "2.5", "2", " 0,65 ") em número. Vazio = nulo;
 * texto que não é número = NaN (o schema recusa com mensagem).
 */
export function lerPercentual(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  const s = String(v).trim().replace("%", "").trim();
  if (s === "") return null;
  if (!/^[0-9]+([.,][0-9]+)?$/.test(s)) return Number.NaN;
  return Number(s.replace(",", "."));
}

/** Número para o campo de texto: 1.65 → "1,65"; nulo → "". */
export function percentualParaCampo(v: number | null | undefined): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(".", ",");
}

/** A véspera da vigência nova: é onde a linha atual fecha. */
export function vesperaDaVigencia(vigenciaInicio: string): string {
  return addDias(vigenciaInicio, -1);
}

/** Primeiro dia do mês seguinte a uma data ISO (sugestão de "Vale a partir de"). */
export function primeiroDiaDoMesSeguinte(dataIso: string): string {
  const [y, m] = dataIso.slice(0, 10).split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/**
 * PIS e COFINS de um CNAE pela opção de crédito. A tela mostra os dois
 * travados (protótipo aprovado em 02/10/2026): quem decide é a opção
 * "Dá crédito sobre os custos" × "Sem crédito (alíquota reduzida)".
 *
 * - Mantida a opção da linha atual, ficam as alíquotas dela.
 * - Trocada, valem as do regime escolhido: não cumulativo 1,65% + 7,6%
 *   (Leis 10.637/2002 e 10.833/2003); cumulativo 0,65% + 3% (Lei 9.718/1998
 *   e LC 70/1991) — as mesmas da carga da planilha.
 */
export const PIS_COFINS_NAO_CUMULATIVO = { aliquota_pis: 1.65, aliquota_cofins: 7.6 } as const;
export const PIS_COFINS_CUMULATIVO = { aliquota_pis: 0.65, aliquota_cofins: 3 } as const;

export function aliquotasPisCofins(
  cumulativo: boolean,
  atual?: { aliquota_pis: number; aliquota_cofins: number; cumulativo: boolean } | null,
): { aliquota_pis: number; aliquota_cofins: number } {
  if (atual && atual.cumulativo === cumulativo) {
    return { aliquota_pis: atual.aliquota_pis, aliquota_cofins: atual.aliquota_cofins };
  }
  return cumulativo ? { ...PIS_COFINS_CUMULATIVO } : { ...PIS_COFINS_NAO_CUMULATIVO };
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const dataIso = z
  .string({ required_error: "Informe a data." })
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data.");

const aliquotaIss = z.preprocess(
  lerPercentual,
  z
    .number({ invalid_type_error: "ISS: use só números, como 2 ou 2,5." })
    .refine((v) => !Number.isNaN(v), "ISS: use só números, como 2 ou 2,5.")
    .refine((v) => v >= 0 && v < 100, "ISS: a alíquota fica entre 0 e 100%.")
    .nullable(),
);

const dia = (rotulo: string) =>
  z.coerce
    .number({ invalid_type_error: `${rotulo}: informe um dia de 1 a 31.` })
    .int(`${rotulo}: informe um dia de 1 a 31.`)
    .min(1, `${rotulo}: informe um dia de 1 a 31.`)
    .max(31, `${rotulo}: informe um dia de 1 a 31.`);

/** CNPJ emissor: informar o CNPJ e ativar; vencimento do ISS; observação. */
export const estabelecimentoSchema = z
  .object({
    id: z.string().uuid(),
    cnpj: z
      .string()
      .optional()
      .transform((v) => apenasDigitosCnpj(v ?? "")),
    ativo: z.boolean(),
    iss_dia: dia("Dia do ISS"),
    iss_retido_dia: dia("Dia do ISS retido"),
    iss_regra: z.enum(["antecipa", "prorroga", "ultimo_util"], {
      errorMap: () => ({ message: "Escolha o que acontece em dia não útil." }),
    }),
    observacao: z
      .string()
      .optional()
      .transform((v) => (v ?? "").trim())
      .refine((v) => v.length <= 500, "Observação: até 500 caracteres.")
      .transform((v) => (v === "" ? null : v)),
  })
  .superRefine((v, ctx) => {
    if (v.cnpj !== "" && v.cnpj.length !== 14) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cnpj"], message: "O CNPJ tem 14 dígitos." });
    } else if (v.cnpj !== "" && !cnpjValido(v.cnpj)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cnpj"], message: "CNPJ inválido: confira os dígitos." });
    }
    if (v.ativo && v.cnpj === "") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cnpj"], message: "Para ativar, informe o CNPJ." });
    }
  })
  .transform((v) => ({ ...v, cnpj: v.cnpj === "" ? null : v.cnpj }));

export type EstabelecimentoInput = z.input<typeof estabelecimentoSchema>;

/** "Editar alíquotas": a linha atual fecha na véspera e nasce a nova. */
export const novaVigenciaCnaeSchema = z.object({
  cnae_id: z.string().uuid(),
  vigencia_inicio: dataIso,
  aliquota_iss: aliquotaIss,
  cumulativo: z.boolean(),
});

export type NovaVigenciaCnaeInput = z.input<typeof novaVigenciaCnaeSchema>;

/** "Novo CNAE" para um CNPJ emissor. */
export const novoCnaeSchema = z.object({
  estabelecimento_id: z.string().uuid(),
  codigo: z
    .string()
    .transform((v) => formatarCodigoCnae(v))
    .refine((v) => FORMATO_CNAE.test(v), "Código do CNAE no formato 00.00-0-00."),
  subitem: z
    .string()
    .optional()
    .transform((v) => (v ?? "").trim().replace(",", "."))
    .refine((v) => v === "" || FORMATO_SUBITEM.test(v), "Subitem da LC 116 no formato 12.08.")
    .transform((v) => (v === "" ? null : v)),
  descricao: z
    .string()
    .transform((v) => v.trim())
    .refine((v) => v.length >= 3, "Informe a descrição da atividade.")
    .refine((v) => v.length <= 300, "Descrição: até 300 caracteres."),
  aliquota_iss: aliquotaIss,
  cumulativo: z.boolean(),
  vigencia_inicio: dataIso,
});

export type NovoCnaeInput = z.input<typeof novoCnaeSchema>;

/** Feriado novo: nacional (município nulo) ou de uma cidade. */
export const novoFeriadoSchema = z.object({
  data: dataIso,
  nome: z
    .string()
    .transform((v) => v.trim())
    .refine((v) => v.length >= 2, "Informe o nome do feriado.")
    .refine((v) => v.length <= 120, "Nome: até 120 caracteres."),
  municipio: z
    .string()
    .nullable()
    .optional()
    .transform((v) => {
      const s = (v ?? "").trim();
      return s === "" ? null : s;
    }),
});

export type NovoFeriadoInput = z.input<typeof novoFeriadoSchema>;

export const idSchema = z.object({ id: z.string().uuid() });

/** Parâmetros: valores novos a partir de uma data (linha nova por chave). */
export const novaVigenciaParametrosSchema = z.object({
  vigencia_inicio: dataIso,
  valores: z
    .array(
      z.object({
        chave: z.string().min(1).max(80),
        valor: z
          .number({ invalid_type_error: "Use só números." })
          .refine((v) => Number.isFinite(v), "Use só números.")
          .refine((v) => v >= 0, "O valor não pode ser negativo."),
      }),
    )
    .min(1, "Nada para salvar."),
});

export type NovaVigenciaParametrosInput = z.input<typeof novaVigenciaParametrosSchema>;
