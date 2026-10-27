/**
 * O pacote de carga do histórico financeiro (decisão 211, A1).
 *
 * O script `scripts/historico-financeiro/empacotar.ts` junta num arquivo .json
 * o que uma carga leva — movimentos, notas, jobs, o rateio e os saldos da
 * planilha — e a tela Financeiro › Cadastros › Histórico da planilha o lê no
 * navegador e o envia em partes. Este módulo é o contrato entre os dois: as
 * colunas de cada tabela, na ordem em que vão no pacote, o tipo de cada uma e
 * a divisão em partes que cabem no limite de 1 MB da Server Action.
 *
 * O pacote leva o texto que o sistema usa para achar cada cadastro (o nome da
 * conta, da empresa e da regional, o código do plano de contas, a sigla do
 * cliente, o código do job); a ligação com o id se faz no banco, na função
 * que grava a parte. O que não tem par fica só como texto.
 */
import { z } from "zod";

export const FORMATO_DO_PACOTE = "califa-historico-financeiro/1";

/** A ordem do envio: o que é pequeno primeiro, para um erro de formato aparecer cedo. */
export const TABELAS_DO_PACOTE = ["rateio", "saldos", "jobs", "notas", "movimentos"] as const;
export type TabelaDoPacote = (typeof TABELAS_DO_PACOTE)[number];

export const NOME_DA_TABELA: Record<TabelaDoPacote, string> = {
  rateio: "Rateio",
  saldos: "Saldos",
  jobs: "Jobs",
  notas: "Notas",
  movimentos: "Movimentos",
};

type TipoDaColuna = "texto" | "numero" | "inteiro" | "data" | "booleano";
export type ColunaDoPacote = { nome: string; tipo: TipoDaColuna; obrigatoria?: true; max?: number; padrao?: RegExp };

const t = (nome: string, max = 300): ColunaDoPacote => ({ nome, tipo: "texto", max });
const T = (nome: string, max = 300): ColunaDoPacote => ({ nome, tipo: "texto", max, obrigatoria: true });
/** A divisão do job entre as regionais: "NE:0.25;SP:0.75", o código da planilha e a parte. */
const PARTES_DO_JOB = /^[A-Z0-9]+( [A-Z0-9]+)*:-?\d+(\.\d+)?([eE][-+]?\d+)?(;[A-Z0-9]+( [A-Z0-9]+)*:-?\d+(\.\d+)?([eE][-+]?\d+)?)*$/;
const n = (nome: string): ColunaDoPacote => ({ nome, tipo: "numero" });
const N = (nome: string): ColunaDoPacote => ({ nome, tipo: "numero", obrigatoria: true });
const i = (nome: string): ColunaDoPacote => ({ nome, tipo: "inteiro" });
const I = (nome: string): ColunaDoPacote => ({ nome, tipo: "inteiro", obrigatoria: true });
const d = (nome: string): ColunaDoPacote => ({ nome, tipo: "data" });
const D = (nome: string): ColunaDoPacote => ({ nome, tipo: "data", obrigatoria: true });
const B = (nome: string): ColunaDoPacote => ({ nome, tipo: "booleano", obrigatoria: true });

/** As colunas de cada tabela, na ordem do pacote. Os nomes são os da função `historico_gravar_parte`. */
export const COLUNAS_DO_PACOTE: Record<TabelaDoPacote, readonly ColunaDoPacote[]> = {
  movimentos: [
    T("conta", 120), D("data"), N("valor"), n("credito_planilha"), n("debito_planilha"), T("classe", 40),
    t("empresa", 120), t("sigla_planilha", 20), t("grupo", 40), t("cod", 60), i("competencia_trimestre"), i("competencia_ano"),
    t("plano_tipo", 10), t("plano_subtipo", 10), t("regional", 60), B("regional_todas"), t("regional_planilha", 60),
    t("job_chave", 160), t("job_nome", 160), t("job_coluna", 10), t("tipo_planilha", 120), t("descricao", 2000),
    t("fornecedor", 300), t("parcela", 60), t("documento", 500), t("observacao", 2000), t("contrapartida", 120),
    t("coluna_jobs", 160), t("coluna_evento", 160), t("coluna_reg", 60), t("coluna_reg_cmh", 60), t("dre_extra", 120),
    t("ano_comp", 120), T("aba", 120), I("linha"), T("digital", 64),
  ],
  notas: [
    T("empresa", 120), t("empresa_por", 40), T("estabelecimento", 120), T("numero", 40), T("situacao", 20), T("classe", 40),
    d("emissao"), i("competencia_trimestre"), i("competencia_ano"), d("vencimento"), d("recebimento"),
    n("valor"), n("deducao"), n("valor_tributavel"), n("iss"), n("pis"), n("cofins"), n("csll"), n("ir"),
    n("adicional_ir"), n("retencoes"), n("total_impostos"), t("job_chave", 160), t("job_nome", 160), t("coluna_job", 160),
    t("cliente", 200), t("municipio", 120), t("cnae", 60), t("obs", 300), t("observacao", 1000), T("aba", 120), I("linha"),
  ],
  jobs: [
    T("chave", 160), T("nome", 160), T("empresa", 120), T("aba", 120), I("linha"), I("ano"), t("trimestre", 2),
    t("projeto", 200), t("cliente_sigla", 20), t("cliente_planilha", 200), t("marca", 120), t("marca_planilha", 200),
    t("servico", 120), t("servico_planilha", 120), t("gp", 120), d("data_inicio"), t("regional", 60), B("regional_todas"),
    t("regional_planilha", 60), t("regional_por", 40), t("marcador", 40), t("status_planilha", 120),
    t("codigo_antigo", 60), t("job_codigo", 40), t("fora_do_resultado", 120), t("outras_abas", 500),
    { ...t("rateio_regional", 200), padrao: PARTES_DO_JOB }, n("imposto_teorico_percentual"), n("fee_percentual"),
  ],
  rateio: [I("ano"), i("trimestre"), T("empresa", 120), t("grupo", 40), T("regional", 60), N("percentual"), T("origem", 200)],
  saldos: [T("conta", 120), D("mes"), n("saldo_planilha"), n("movimento"), B("abertura")],
};

export type ValorDoPacote = string | number | boolean | null;
export type TabelaEmbalada = { colunas: string[]; linhas: ValorDoPacote[][] };

/** O cabeçalho: a carga, a planilha e o que o pacote declara — as linhas de cada
 *  tabela e, nos movimentos e nas notas, a soma do valor (texto com 2 casas). */
export type CabecalhoDoPacote = z.infer<typeof ESQUEMA_DO_CABECALHO>;

export type Pacote = CabecalhoDoPacote & { tabelas: Record<TabelaDoPacote, TabelaEmbalada> };

// ---------------------------------------------------------------- conferência

const DATA = /^\d{4}-\d{2}-\d{2}$/;

function esquemaDaColuna(c: ColunaDoPacote): z.ZodTypeAny {
  let s: z.ZodTypeAny;
  if (c.tipo === "texto") s = c.padrao ? z.string().max(c.max ?? 300).regex(c.padrao) : z.string().max(c.max ?? 300);
  else if (c.tipo === "numero") s = z.number().finite();
  else if (c.tipo === "inteiro") s = z.number().int();
  else if (c.tipo === "data") s = z.string().regex(DATA);
  else s = z.boolean();
  return c.obrigatoria ? s : s.nullable();
}

const ESQUEMAS = Object.fromEntries(
  TABELAS_DO_PACOTE.map((tabela) => [
    tabela,
    z.object(Object.fromEntries(COLUNAS_DO_PACOTE[tabela].map((c) => [c.nome, esquemaDaColuna(c)]))).strict(),
  ]),
) as unknown as Record<TabelaDoPacote, z.ZodTypeAny>;

/** As colunas que o pacote declara são as do contrato, na mesma ordem? */
export function colunasConferem(tabela: TabelaDoPacote, colunas: readonly string[]): boolean {
  const esperadas = COLUNAS_DO_PACOTE[tabela];
  return colunas.length === esperadas.length && esperadas.every((c, k) => c.nome === colunas[k]);
}

/**
 * Uma linha do pacote (valores na ordem das colunas) vira o objeto que a
 * função do banco recebe, ou a mensagem do primeiro campo que não serve.
 */
export function linhaComoObjeto(
  tabela: TabelaDoPacote,
  valores: readonly ValorDoPacote[],
): { ok: true; linha: Record<string, ValorDoPacote> } | { ok: false; message: string } {
  const colunas = COLUNAS_DO_PACOTE[tabela];
  if (!Array.isArray(valores) || valores.length !== colunas.length) {
    return { ok: false, message: `a linha tem ${Array.isArray(valores) ? valores.length : 0} campos, e ${NOME_DA_TABELA[tabela].toLowerCase()} têm ${colunas.length}` };
  }
  const objeto = Object.fromEntries(colunas.map((c, k) => [c.nome, valores[k]]));
  const lido = ESQUEMAS[tabela].safeParse(objeto);
  if (!lido.success) {
    const campo = lido.error.issues[0]?.path[0];
    return { ok: false, message: `o campo "${String(campo ?? "?")}" não tem o formato esperado` };
  }
  return { ok: true, linha: lido.data as Record<string, ValorDoPacote> };
}

const NUMERO_DE_LINHAS = z.number().int().min(0).max(1_000_000);
const SOMA = z.string().regex(/^-?\d+\.\d{2}$/);

export const ESQUEMA_DO_CABECALHO = z.object({
  formato: z.literal(FORMATO_DO_PACOTE),
  // `cauda` (A6): depois do corte, só os jobs até o 3T que não existem no
  // sistema. O pacote antigo, sem o campo, é de período.
  carga: z.object({
    nome: z.string().trim().min(1).max(80),
    de: z.string().regex(DATA),
    ate: z.string().regex(DATA),
    tipo: z.enum(["periodo", "cauda"]).default("periodo"),
  }),
  planilha: z.object({
    versao: z.string().regex(DATA),
    arquivo: z.string().trim().min(1).max(255),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    exportado_em: z.string().max(40).nullable(),
  }),
  esperado: z.object({
    movimentos: z.object({ linhas: NUMERO_DE_LINHAS, soma: SOMA }),
    notas: z.object({ linhas: NUMERO_DE_LINHAS, soma: SOMA }),
    jobs: z.object({ linhas: NUMERO_DE_LINHAS }),
    rateio: z.object({ linhas: NUMERO_DE_LINHAS }),
    saldos: z.object({ linhas: NUMERO_DE_LINHAS }),
  }),
});

/**
 * Lê o texto do arquivo: o cabeçalho conferido e as tabelas com as colunas do
 * contrato, ou a mensagem do que não serve. Não confere linha a linha — isso
 * se faz no servidor, parte por parte.
 */
export function lerPacote(texto: string): { ok: true; pacote: Pacote } | { ok: false; message: string } {
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return { ok: false, message: "O arquivo não é um pacote de carga (.json) válido." };
  }
  const cabecalho = ESQUEMA_DO_CABECALHO.safeParse(bruto);
  if (!cabecalho.success) {
    const formato = (bruto as { formato?: unknown } | null)?.formato;
    return {
      ok: false,
      message:
        formato === FORMATO_DO_PACOTE
          ? "O cabeçalho do pacote está incompleto. Gere o pacote de novo pelo script empacotar.ts."
          : "O arquivo não é um pacote de carga do histórico. Gere-o pelo script empacotar.ts.",
    };
  }
  const tabelas = (bruto as { tabelas?: Record<string, unknown> }).tabelas ?? {};
  for (const tabela of TABELAS_DO_PACOTE) {
    const tab = tabelas[tabela] as TabelaEmbalada | undefined;
    if (!tab || !Array.isArray(tab.colunas) || !Array.isArray(tab.linhas) || !colunasConferem(tabela, tab.colunas)) {
      return { ok: false, message: `A tabela de ${NOME_DA_TABELA[tabela].toLowerCase()} do pacote não tem as colunas esperadas.` };
    }
    if (tab.linhas.length !== cabecalho.data.esperado[tabela].linhas) {
      return { ok: false, message: `O pacote diz ${cabecalho.data.esperado[tabela].linhas} linhas de ${NOME_DA_TABELA[tabela].toLowerCase()} e traz ${tab.linhas.length}.` };
    }
  }
  return { ok: true, pacote: { ...cabecalho.data, tabelas: tabelas as Pacote["tabelas"] } };
}

// ---------------------------------------------------------------- partes

/** O limite do corpo da Server Action é 1 MB; a parte fica bem abaixo dele. */
export const BYTES_POR_PARTE = 600_000;
export const LINHAS_POR_PARTE = 2_000;

/** As linhas em partes de até `LINHAS_POR_PARTE` linhas e cerca de `BYTES_POR_PARTE` bytes de JSON. */
export function partesDaTabela<L>(linhas: readonly L[], bytes = BYTES_POR_PARTE, maxLinhas = LINHAS_POR_PARTE): L[][] {
  const partes: L[][] = [];
  let atual: L[] = [];
  let tamanho = 0;
  for (const linha of linhas) {
    const daLinha = new TextEncoder().encode(JSON.stringify(linha)).length + 1;
    if (atual.length > 0 && (atual.length >= maxLinhas || tamanho + daLinha > bytes)) {
      partes.push(atual);
      atual = [];
      tamanho = 0;
    }
    atual.push(linha);
    tamanho += daLinha;
  }
  if (atual.length > 0) partes.push(atual);
  return partes;
}

/** Soma com 2 casas, em centavos para não acumular erro de ponto flutuante. */
export function somaEmTexto(valores: readonly (number | null)[]): string {
  const centavos = valores.reduce<number>((total, v) => total + (v === null ? 0 : Math.round(v * 100)), 0);
  const sinal = centavos < 0 ? "-" : "";
  const abs = Math.abs(centavos);
  return `${sinal}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
