/**
 * Cadastro de impostos (módulo fiscal, entrega 1 — 02/10/2026): validação
 * das edições da tela Cadastros do Financeiro › Impostos e as contas puras
 * que ela faz (máscara do CNAE, percentual digitado com vírgula, véspera da
 * vigência nova, PIS/COFINS pela opção de crédito, dia de vencimento dos
 * federais, conferência do CNPJ emissor novo).
 *
 * Usado pelas Server Actions de `app/(app)/financeiro/cadastros/impostos`
 * e pelos diálogos da tela (o cliente mostra o mesmo que o servidor aceita).
 * Testes: `node --import tsx --test lib/validations/fiscal-cadastro.test.ts`.
 */
import { z } from "zod";
import type { UF } from "@/lib/types";
import { apenasDigitosCnpj, cnpjValido } from "@/lib/utils/cnpj";
import { UFS } from "@/lib/utils/formato-fiscal";
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

/**
 * Os parâmetros que são dia do mês: o vencimento do PIS/COFINS e o das
 * retenções federais (lápis da aba Vencimentos). Vão de 1 a 31, como o dia
 * do ISS; no mês mais curto, vale o último dia (`vencimentoNoMesSeguinte`).
 */
export const CHAVES_DE_DIA: ReadonlySet<string> = new Set(["pis_cofins_dia", "retencoes_dia"]);

/** "Dia do ISS: informe um dia de 1 a 31." — a mesma frase para todo dia do cadastro. */
export function mensagemDoDia(rotulo: string): string {
  return `${rotulo}: informe um dia de 1 a 31.`;
}

/** Dia do mês digitado ("25", " 7 ") em número. Vazio = nulo; o resto ("2,5", texto) = NaN. */
export function lerDiaDoMes(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (s === "") return null;
  if (!/^[0-9]+$/.test(s)) return Number.NaN;
  return Number(s);
}

/** Dia inteiro de 1 a 31. */
export function diaDoMesValido(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 31;
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
// CNPJ emissor novo: grafia, nome sugerido e o que o cadastro exige
// ---------------------------------------------------------------------------

/** Tira os espaços das pontas e junta os repetidos. */
export function semEspacosSobrando(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

/** Para comparar nomes e cidades: sem acento, sem maiúscula, um espaço só. */
export function chaveDeComparacao(texto: string): string {
  return semEspacosSobrando(texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase());
}

/**
 * O município com a grafia que já está no cadastro: "salvador" vira
 * "Salvador", "Sao Paulo" vira "São Paulo". Os feriados da cidade chegam ao
 * CNPJ pelo NOME do município, então a grafia tem de ser a mesma. Cidade nova
 * fica como foi digitada, sem os espaços sobrando.
 */
export function cidadeDoCadastro(digitada: string, existentes: readonly string[]): string {
  const limpa = semEspacosSobrando(digitada);
  const chave = chaveDeComparacao(limpa);
  if (chave === "") return limpa;
  return existentes.find((c) => chaveDeComparacao(c) === chave) ?? limpa;
}

/** "California · Recife": o nome que a tela sugere, no padrão dos CNPJs da carga. */
export function nomeSugerido(empresa: string, municipio: string): string {
  const e = semEspacosSobrando(empresa);
  const m = semEspacosSobrando(municipio);
  return e && m ? `${e} · ${m}` : "";
}

/** Os 8 primeiros dígitos (a raiz da empresa), formatados: "19.437.976". Vazio se não houver. */
export function raizDoCnpjFormatada(cnpj: string | null | undefined): string {
  const raiz = (cnpj ?? "").replace(/\D/g, "").slice(0, 8);
  if (raiz.length !== 8) return "";
  return `${raiz.slice(0, 2)}.${raiz.slice(2, 5)}.${raiz.slice(5, 8)}`;
}

/**
 * A raiz do CNPJ (8 primeiros dígitos) é a da empresa: matriz e filiais de
 * uma PJ dividem a mesma raiz. Mensagem quando o CNPJ é de outra empresa;
 * nulo quando confere (ou quando a empresa não tem CNPJ para comparar).
 */
export function mensagemDaRaiz(cnpj: string, empresa: { razao_social: string; cnpj: string | null }): string | null {
  const raiz = (empresa.cnpj ?? "").replace(/\D/g, "").slice(0, 8);
  if (raiz.length !== 8 || cnpj.replace(/\D/g, "").slice(0, 8) === raiz) return null;
  return `Esse CNPJ não é da ${empresa.razao_social}: os CNPJs dela começam com ${raizDoCnpjFormatada(raiz)}.`;
}

/** A empresa contábil (PJ) que recebe o CNPJ novo. */
export interface EmpresaDoNovoCnpj {
  id: string;
  /** Nome fantasia ou, sem ele, a razão social. */
  nome: string;
  razao_social: string;
  cnpj: string | null;
  ativo: boolean;
}

/** O que a conferência precisa dos CNPJs que já estão no cadastro. */
export interface EstabelecimentoJaCadastrado {
  empresa_contabil_id: string;
  nome: string;
  cnpj: string | null;
  papel: string;
}

/** A matriz da PJ no cadastro, se houver. */
export function matrizDaEmpresa<T extends EstabelecimentoJaCadastrado>(
  existentes: readonly T[],
  empresaContabilId: string,
): T | null {
  return existentes.find((e) => e.empresa_contabil_id === empresaContabilId && e.papel === "matriz") ?? null;
}

/**
 * O que o cadastro exige de um CNPJ emissor novo além do formato — a mesma
 * conferência no diálogo (com o cadastro da tela) e na Server Action (com o
 * banco). Devolve a mensagem do primeiro problema, ou nulo.
 *
 * - Empresa contábil ativa.
 * - Uma matriz por PJ, e a filial só depois dela: os impostos federais da
 *   PJ se apuram pela matriz (comentário da tabela `fiscal_estabelecimentos`),
 *   e a Apuração e o Faturar acham a matriz pela primeira com o papel. O
 *   banco não trava nenhuma das duas; a trava é esta.
 * - Nome único, sem contar acento e maiúscula (o banco trava o nome exato:
 *   `uq_fiscal_estab_nome`).
 * - CNPJ, quando informado, com a raiz da empresa e fora do cadastro (o
 *   banco trava o repetido: `uq_fiscal_estab_cnpj`).
 */
export function problemaDoNovoEstabelecimento(
  novo: { papel: "matriz" | "filial"; nome: string; cnpj: string | null },
  empresa: EmpresaDoNovoCnpj,
  existentes: readonly EstabelecimentoJaCadastrado[],
): string | null {
  if (!empresa.ativo) return `A ${empresa.nome} está inativa nas empresas contábeis.`;
  const matriz = matrizDaEmpresa(existentes, empresa.id);
  if (novo.papel === "matriz" && matriz) {
    return `A ${empresa.nome} já tem matriz: ${matriz.nome}. Cadastre este CNPJ como filial.`;
  }
  if (novo.papel === "filial" && !matriz) {
    return `A ${empresa.nome} ainda não tem matriz no cadastro. Cadastre a matriz primeiro: os impostos federais se apuram por ela.`;
  }
  const chave = chaveDeComparacao(novo.nome);
  const mesmoNome = existentes.find((e) => chaveDeComparacao(e.nome) === chave);
  if (mesmoNome) return `Já existe um CNPJ emissor com o nome ${mesmoNome.nome}.`;
  if (novo.cnpj) {
    const raiz = mensagemDaRaiz(novo.cnpj, empresa);
    if (raiz) return raiz;
    const mesmoCnpj = existentes.find((e) => e.cnpj === novo.cnpj);
    if (mesmoCnpj) return `Esse CNPJ já está no cadastro: ${mesmoCnpj.nome}.`;
  }
  return null;
}

/** O CNPJ novo entra no fim da lista (a tela ordena por `ordem` e depois pelo nome). */
export function ordemDoNovo(existentes: readonly { ordem: number }[]): number {
  return existentes.reduce((m, e) => Math.max(m, e.ordem), 0) + 1;
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
    .number({ invalid_type_error: mensagemDoDia(rotulo) })
    .int(mensagemDoDia(rotulo))
    .min(1, mensagemDoDia(rotulo))
    .max(31, mensagemDoDia(rotulo));

/**
 * Os campos que a edição e o cadastro do CNPJ emissor têm em comum — é o
 * mesmo formulário (o lápis da aba CNPJs e o "Novo CNPJ emissor").
 */
/** Texto opcional de uma linha: vazio vira null. */
const textoOpcional = (rotulo: string, max: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v ?? "").trim())
    .refine((v) => v.length <= max, `${rotulo}: até ${max} caracteres.`)
    .transform((v) => (v === "" ? null : v));

/** Os dados do cabeçalho do PDF da PP (decisão 156): opcionais. */
const dadosDoDocumento = {
  logradouro: textoOpcional("Endereço", 160),
  numero: textoOpcional("Número", 20),
  complemento: textoOpcional("Complemento", 80),
  bairro: textoOpcional("Bairro", 80),
  cep: z
    .string()
    .optional()
    .transform((v) => (v ?? "").replace(/\D/g, ""))
    .refine((v) => v === "" || v.length === 8, "O CEP tem 8 dígitos.")
    .transform((v) => (v === "" ? null : v)),
  telefone: textoOpcional("Telefone", 30),
  email: textoOpcional("E-mail", 120).refine((v) => v === null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "E-mail inválido."),
  inscricao_estadual: textoOpcional("Inscrição estadual", 30),
  inscricao_municipal: textoOpcional("Inscrição municipal", 30),
};

const camposDoEstabelecimento = {
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
  ...dadosDoDocumento,
};

/** CNPJ vazio ou com 14 dígitos válidos; ativo só com CNPJ (o CHECK `chk_fiscal_estab_ativo_tem_cnpj`). */
function conferirCnpjEAtivo(v: { cnpj: string; ativo: boolean }, ctx: z.RefinementCtx) {
  if (v.cnpj !== "" && v.cnpj.length !== 14) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cnpj"], message: "O CNPJ tem 14 dígitos." });
  } else if (v.cnpj !== "" && !cnpjValido(v.cnpj)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cnpj"], message: "CNPJ inválido: confira os dígitos." });
  }
  if (v.ativo && v.cnpj === "") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cnpj"], message: "Para ativar, informe o CNPJ." });
  }
}

/** CNPJ emissor: informar o CNPJ e ativar; vencimento do ISS; observação. */
export const estabelecimentoSchema = z
  .object({
    id: z.string().uuid(),
    ...camposDoEstabelecimento,
  })
  .superRefine(conferirCnpjEAtivo)
  .transform((v) => ({ ...v, cnpj: v.cnpj === "" ? null : v.cnpj }));

export type EstabelecimentoInput = z.input<typeof estabelecimentoSchema>;

/** Texto obrigatório de uma linha: sem os espaços sobrando, com mínimo e máximo. */
const textoDoCadastro = (vazio: string, rotulo: string, max: number) =>
  z
    .string({ required_error: vazio, invalid_type_error: vazio })
    .transform(semEspacosSobrando)
    .refine((v) => v.length >= 2, vazio)
    .refine((v) => v.length <= max, `${rotulo}: até ${max} caracteres.`);

/**
 * "Novo CNPJ emissor": os campos da edição e os que só a criação tem — a
 * empresa contábil, matriz ou filial, o município e a UF, e o nome. A ordem
 * das chaves é a da tela (a primeira mensagem é a do primeiro campo).
 */
export const novoEstabelecimentoSchema = z
  .object({
    empresa_contabil_id: z
      .string({ required_error: "Escolha a empresa contábil.", invalid_type_error: "Escolha a empresa contábil." })
      .uuid("Escolha a empresa contábil."),
    papel: z.enum(["matriz", "filial"], {
      errorMap: () => ({ message: "Escolha se o CNPJ é da matriz ou de uma filial." }),
    }),
    municipio: textoDoCadastro("Informe o município.", "Município", 80),
    uf: z.enum(UFS as [UF, ...UF[]], { errorMap: () => ({ message: "Escolha a UF." }) }),
    nome: textoDoCadastro("Informe o nome do estabelecimento.", "Nome", 80),
    ...camposDoEstabelecimento,
  })
  .superRefine(conferirCnpjEAtivo)
  .transform((v) => ({ ...v, cnpj: v.cnpj === "" ? null : v.cnpj }));

export type NovoEstabelecimentoInput = z.input<typeof novoEstabelecimentoSchema>;

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

/**
 * Parâmetros: valores novos a partir de uma data (linha nova por chave). Os
 * dias de vencimento dos federais (`CHAVES_DE_DIA`) só aceitam dia de 1 a 31:
 * a coluna `valor` é numérica e não tem CHECK, então a trava é esta.
 */
export const novaVigenciaParametrosSchema = z
  .object({
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
  })
  .superRefine((v, ctx) => {
    v.valores.forEach((x, i) => {
      if (CHAVES_DE_DIA.has(x.chave) && !diaDoMesValido(x.valor)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["valores", i, "valor"],
          message: mensagemDoDia("Dia do vencimento"),
        });
      }
    });
  });

export type NovaVigenciaParametrosInput = z.input<typeof novaVigenciaParametrosSchema>;

/**
 * A receita bruta recebida por uma PJ do lucro presumido num trimestre antes
 * do início da Apuração (LC 224/2025; decisão 145, item 7): a sobra de limite
 * e o ajuste do ano usam a receita do ano inteiro.
 */
export const receitaAnteriorSchema = z.object({
  empresa_contabil_id: z.string().uuid("Escolha a empresa."),
  trimestre: z.string().regex(/^\d{4}-T[1-4]$/, "Trimestre inválido."),
  receita_bruta: z
    .number({ invalid_type_error: "Use só números." })
    .refine((v) => Number.isFinite(v), "Use só números.")
    .refine((v) => v >= 0, "A receita não pode ser negativa.")
    .refine((v) => v <= 1e11, "Valor alto demais."),
  observacao: z.string().trim().max(500, "Observação longa demais (até 500 caracteres).").nullable(),
});

export type ReceitaAnteriorInput = z.input<typeof receitaAnteriorSchema>;
