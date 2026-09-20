import type ExcelJS from "exceljs";
import {
  calcularTotaisVersao,
  REGRAS_TIPO_CUSTO,
  TIPOS_CUSTO,
  type RegraTipoCusto,
} from "@/lib/calculos/versao-totais";
import type { TipoCusto } from "@/lib/types";

/**
 * A planilha de orçamento que vai para o cliente — o formato ORÇADO, no
 * modelo da planilha oficial da agência.
 *
 * Nasceu dentro da rota de exportação da versão
 * (`app/api/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/export`) e
 * saiu de lá em 03/09/2026, quando a página do projeto e a visão agregada
 * ganharam a exportação de VÁRIOS orçamentos numa **planilha única**
 * (decisão 041): os orçamentos marcados entram em sequência, cada um
 * numa seção com título, e o fechamento no fim é um só — para o cliente
 * é um orçamento; para a agência, continuam sendo N. A exportação de
 * versão única é o caso de uma seção sem título.
 *
 * O bloco de totais é o lado CLIENTE do fechamento (decisão 041,
 * 04/09/2026): as linhas em save entram — o cliente paga por elas agora —
 * e o que é pago com crédito de outro job sai, numa linha própria
 * "(−) pago com crédito de saldo anterior" entre o TOTAL e o IMPOSTO, para
 * a conta fechar à vista. Em orçamento sem save é exatamente a conta de
 * sempre.
 *
 * **Fórmulas.** Com `formulas: true` as células calculadas — TT de cada
 * item, subtotal de grupo e de seção, SUB-TOTAL por tipo, TOTAL, IMPOSTO,
 * HONORÁRIOS e FATURAMENTO — saem como fórmula do Excel, com o resultado
 * já calculado gravado como valor em cache. O cache importa: quem lê o
 * arquivo sem recalcular (o nosso parser de importação, por exemplo)
 * enxerga o número, e o Excel recalcula ao abrir de qualquer forma. As
 * fórmulas seguem a mesma matriz `REGRAS_TIPO_CUSTO` do fechamento — os
 * tipos que entram em cada linha são derivados dela, não escritos à mão.
 * Quando as seções têm percentuais diferentes de honorários ou imposto,
 * HONORÁRIOS e IMPOSTO viram a soma de uma parcela por seção, cada uma
 * com a sua taxa; iguais, é a fórmula direta sobre os SUB-TOTAIS.
 *
 * **Ids ocultos.** A coluna H, escondida, carrega o id de cada linha
 * (`orc:` no título da seção, `grp:` no grupo, `it:` no item). É com ela
 * que a importação da mesma planilha (decisão 041) casa cada linha com a
 * linha da versão — e sabe o que é novo e o que foi apagado — mesmo
 * depois de o cliente editar descrições ou reordenar.
 */

// Paleta da planilha modelo (decisão 088): UM tom por parte, o mesmo na
// faixa, no cabeçalho, no subtotal do grupo e no fechamento. Antes o azul
// tinha duas versões — escura no cabeçalho e clara nas linhas —, e o Tiago
// pediu o tom único do modelo em 17/09/2026.
export const AZUL_IDENT = "FF3C78D8"; // colunas PLANILHA e ITEM
export const AZUL_ORCADO = "FF6D9EEB"; // bloco do orçado
export const VERDE_PLANEJADO = "FF6AA84F"; // bloco do planejado (interna)
export const LARANJA_REALIZADO = "FFE69138"; // bloco do realizado (interna)
export const CINZA_MES = "FF434343"; // faixa do mês, como a aba SUL
export const WHITE = "FFFFFFFF";
export const BLACK = "FF000000";
export const BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFCCCCCC" } },
  bottom: { style: "thin", color: { argb: "FFCCCCCC" } },
  left: { style: "thin", color: { argb: "FFCCCCCC" } },
  right: { style: "thin", color: { argb: "FFCCCCCC" } },
};

export const FORMATO_MOEDA = '"R$" #,##0.00';

/** Coluna escondida com o id da linha. */
export const COLUNA_ID = 8; // H
/** Coluna escondida com o quanto da linha é pago com crédito de save de
 *  outro job — a base da linha "(−) pago com crédito" do fechamento. */
export const COLUNA_CONSUMIDO = 9; // I
export const MARCA_ORCAMENTO = "orc:";
export const MARCA_VERSAO = "v:";
export const MARCA_GRUPO = "grp:";
export const MARCA_ITEM = "it:";
/** Mês do modelo mensal (decisão 078): `mes:2026-10-01` no título do bloco
 *  do mês. Pela DATA, e não pelo id do mês — o id muda de uma versão para
 *  outra, e a planilha exportada da v1 precisa casar com os meses da v2. */
export const MARCA_MES = "mes:";
/** Início do resumo da planilha mensal — encerra a leitura. */
export const MARCA_RESUMO = "resumo:";

export interface ItemDaAba {
  /** Id do item na versão — vai na coluna oculta. */
  id?: string;
  item: string;
  tipo_custo: TipoCusto;
  valor_unitario_orcado: number;
  quantidade_orcada: number;
  dias_meses_orcado: number;
  total_orcado: number;
  em_save?: boolean | null;
  save_consumido?: number | string | null;
}

export interface GrupoDaAba {
  /** Id do grupo na versão — vai na coluna oculta. */
  id?: string;
  nome: string;
  itens: ItemDaAba[];
}

/** Um orçamento dentro da planilha. */
export interface SecaoDaAba {
  /** Linha de título da seção (fundo azul escuro). Ausente na exportação
   *  de versão única, que não tem seção visível. */
  titulo?: string;
  /** Ids do orçamento e da versão exportada — coluna oculta do título. */
  orcamentoId?: string;
  versaoId?: string;
  percentualHonorarios: number;
  percentualImposto: number;
  grupos: GrupoDaAba[];
}

export interface DadosDaAba {
  /** Célula A1 — "código · nome". */
  identificacao: string;
  clienteNome: string;
  /** Célula C1 — título da versão, ou "Orçamento · data" no consolidado. */
  titulo: string;
  secoes: SecaoDaAba[];
}

export interface OpcoesDaAba {
  /** Células calculadas como fórmula do Excel (com cache do resultado). */
  formulas?: boolean;
}

/** Nome de aba válido no Excel: sem `\ / ? * [ ] :`, até 31 caracteres. */
export function nomeDeAbaSeguro(nome: string, fallback = "Orçamento"): string {
  const limpo = nome.replace(/[\\/?*[\]:]/g, "-").trim();
  const curto = limpo.slice(0, 31).trim();
  return curto.length > 0 ? curto : fallback;
}

/** Nome de arquivo sem os caracteres que o `Content-Disposition` e os
 *  sistemas de arquivo recusam — o código do projeto tem barra. */
export function nomeDeArquivoSeguro(nome: string): string {
  return nome.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
}

/** Letra da coluna (1 → A). */
function letra(col: number): string {
  return String.fromCharCode(64 + col);
}

const F = letra(6);
const G = letra(7);
const I = letra(COLUNA_CONSUMIDO);

interface Faixa {
  de: number;
  ate: number;
}

/** Tipos em que a alavanca está ligada. */
function tiposCom(alavanca: keyof RegraTipoCusto): TipoCusto[] {
  return TIPOS_CUSTO.filter((t) => REGRAS_TIPO_CUSTO[t][alavanca]);
}

/** `SUMIF($G$4:$G$10,"A",$I$4:$I$10)` — o crédito consumido pelas
 *  linhas de um tipo dentro de uma faixa. */
function consumidoDoTipo(faixa: Faixa, t: TipoCusto): string {
  return `SUMIF($${G}$${faixa.de}:$${G}$${faixa.ate},"${t}",$${I}$${faixa.de}:$${I}$${faixa.ate})`;
}

/**
 * As linhas de SUB-TOTAL do fechamento (decisão 088).
 *
 * `A` e `AR` dividem a linha porque produzem o MESMO valor do job: as
 * alavancas `valorJob`, `honorarios` e `imposto` são iguais nos dois, e a
 * planilha não mostra mais o faturamento previsto, que é onde eles
 * divergem. `F` e `FI` ficam separados porque o FI não gera honorário — e
 * aí o valor do job muda (pedido do Tiago em 17/09/2026: "se o valor do
 * job muda, precisamos mantê-los separados, para que a planilha seja
 * auditável").
 */
export const LINHAS_SUBTOTAL = [
  { letra: "A", tipos: ["A", "AR"] },
  { letra: "B", tipos: ["B"] },
  { letra: "C", tipos: ["C"] },
  { letra: "D", tipos: ["D"] },
  { letra: "F", tipos: ["F"] },
  { letra: "FI", tipos: ["FI"] },
] as const satisfies ReadonlyArray<{ letra: string; tipos: readonly TipoCusto[] }>;

// Guarda de exaustividade: tipo novo que ninguém encaixar numa linha
// sumiria do fechamento sem avisar. Aqui vira erro de compilação.
type TipoForaDoSubtotal = Exclude<
  TipoCusto,
  (typeof LINHAS_SUBTOTAL)[number]["tipos"][number]
>;
const _todosOsTiposNoSubtotal: TipoForaDoSubtotal extends never
  ? true
  : ["Falta tipo em LINHAS_SUBTOTAL"] = true;
void _todosOsTiposNoSubtotal;

/** Linha do fechamento onde cada letra caiu. */
export type LinhaDoSubtotal = Record<string, number>;

/** `F12+F15+F18` — as linhas de SUB-TOTAL cujos tipos TÊM a alavanca. Com
 *  crédito consumido na planilha cada parcela vira `(F12-SUMIF(…))`, a
 *  base líquida da linha. Linha com tipos divergentes na alavanca cai no
 *  SUMIF por tipo, que não depende do agrupamento. */
export function somaDosSubtotais(
  linhaDaLetra: LinhaDoSubtotal,
  alavanca: keyof RegraTipoCusto,
  credito: Faixa | null,
  faixaToda: Faixa | null = null,
): string {
  const partes: string[] = [];
  for (const linha of LINHAS_SUBTOTAL) {
    const comAlavanca = linha.tipos.filter((t) => REGRAS_TIPO_CUSTO[t][alavanca]);
    if (comAlavanca.length === 0) continue;
    if (comAlavanca.length === linha.tipos.length) {
      const base = `${F}${linhaDaLetra[linha.letra]}`;
      partes.push(
        credito
          ? `(${base}-(${linha.tipos.map((t) => consumidoDoTipo(credito, t)).join("+")}))`
          : base,
      );
    } else if (faixaToda) {
      // Nunca acontece com as linhas de hoje; existe para um tipo novo
      // não sair calado do fechamento.
      for (const t of comAlavanca) {
        const cheio = `SUMIF($${G}$${faixaToda.de}:$${G}$${faixaToda.ate},"${t}",$${F}$${faixaToda.de}:$${F}$${faixaToda.ate})`;
        partes.push(credito ? `(${cheio}-${consumidoDoTipo(credito, t)})` : cheio);
      }
    }
  }
  return partes.join("+");
}

/** `SUMIF($G$4:$G$10,"A",$F$4:$F$10)+…` — o orçado dos tipos com a
 *  alavanca dentro de uma faixa de linhas (uma seção), líquido do
 *  crédito consumido quando ele existe. */
function somaNaFaixa(
  faixa: Faixa,
  alavanca: keyof RegraTipoCusto,
  comCredito: boolean,
): string {
  const tipos = `$${G}$${faixa.de}:$${G}$${faixa.ate}`;
  const totais = `$${F}$${faixa.de}:$${F}$${faixa.ate}`;
  return tiposCom(alavanca)
    .map((t) => {
      const cheio = `SUMIF(${tipos},"${t}",${totais})`;
      return comCredito ? `(${cheio}-${consumidoDoTipo(faixa, t)})` : cheio;
    })
    .join("+");
}

function taxaDe(percentualImposto: number): number {
  return Math.max(0, Math.min(0.9999, percentualImposto / 100));
}

/** Percentual como o Excel lê: ponto decimal, sem zeros à direita. */
function numeroExcel(n: number): string {
  return String(Number(n.toFixed(6)));
}

function definirFormula(
  ws: ExcelJS.Worksheet,
  ref: string,
  formula: string,
  result: number,
) {
  ws.getCell(ref).value = { formula, result };
}

/**
 * Escreve uma aba completa no workbook e a devolve.
 *
 * O layout (A..G, mais H oculta) é o da planilha oficial: PLANILHA, ITEM,
 * R$, QT, D/M, TT e o tipo de custo. Três linhas de cabeçalho congeladas,
 * uma seção por orçamento (título opcional), um bloco por grupo, e o
 * fechamento único no fim.
 */
export function adicionarAbaOrcamento(
  wb: ExcelJS.Workbook,
  nomeAba: string,
  dados: DadosDaAba,
  opcoes: OpcoesDaAba = {},
): ExcelJS.Worksheet {
  const formulas = opcoes.formulas === true;

  const unica = dados.secoes.length === 1 ? dados.secoes[0] : null;
  const ws = prepararAbaOrcamento(wb, nomeAba, {
    identificacao: dados.identificacao,
    clienteNome: dados.clienteNome,
    titulo: dados.titulo,
    marcaDaLinha1:
      unica && unica.titulo === undefined && unica.orcamentoId
        ? marcasDaSecao(unica)
        : undefined,
  });

  // -------- Seções, grupos e itens --------
  // Faixa com conteúdo (da primeira linha de seção/grupo à última linha
  // de item), para as fórmulas do fechamento. As linhas de seção e de
  // grupo têm a coluna do tipo vazia, então o SUMIF só pega item.
  let primeiraLinha: number | null = null;
  let ultimaLinha: number | null = null;
  const faixas: FaixaDaSecao[] = [];

  for (const secao of dados.secoes) {
    const inicioSecao = ws.rowCount + 1;

    if (secao.titulo !== undefined) {
      const sRow = escreverTituloDeSecao(ws, secao.titulo, marcasDaSecao(secao));
      primeiraLinha ??= sRow.number;
      ultimaLinha = sRow.number;
    }

    const r = escreverGrupos(ws, secao.grupos, formulas);
    if (r.primeira !== null) {
      primeiraLinha ??= r.primeira;
      ultimaLinha = r.ultima;
    }

    if (secao.titulo !== undefined) {
      // Subtotal da seção: a soma das linhas de grupo dela.
      const sRef = `${F}${inicioSecao}`;
      if (formulas && r.linhasDeGrupo.length > 0) {
        definirFormula(
          ws,
          sRef,
          r.linhasDeGrupo.map((r) => `${F}${r}`).join("+"),
          r.subtotal,
        );
      } else {
        ws.getCell(sRef).value = r.subtotal;
      }
    }

    if (ws.rowCount >= inicioSecao) {
      faixas.push({
        de: inicioSecao,
        ate: ws.rowCount,
        percentualHonorarios: Number(secao.percentualHonorarios ?? 0),
        percentualImposto: Number(secao.percentualImposto ?? 0),
      });
    }
  }

  escreverFechamento(ws, {
    secoes: dados.secoes,
    faixas,
    conteudo:
      primeiraLinha !== null && ultimaLinha !== null
        ? { de: primeiraLinha, ate: ultimaLinha }
        : null,
    formulas,
  });

  return ws;
}

// ---------------------------------------------------------------------------
// As peças da aba — compartilhadas com a planilha mensal (decisão 078), que
// repete grupos e fechamento uma vez por mês.

/** Faixa de linhas de uma seção (ou de um mês), com os percentuais dela. */
export interface FaixaDaSecao {
  de: number;
  ate: number;
  percentualHonorarios: number;
  percentualImposto: number;
}

/** `orc:<id>|v:<id>` — a coluna oculta do título da seção. */
export function marcasDaSecao(secao: {
  orcamentoId?: string;
  versaoId?: string;
}): string {
  return [
    secao.orcamentoId ? `${MARCA_ORCAMENTO}${secao.orcamentoId}` : "",
    secao.versaoId ? `${MARCA_VERSAO}${secao.versaoId}` : "",
  ]
    .filter(Boolean)
    .join("|");
}

/** A aba com as colunas e as três linhas de cabeçalho congeladas. */
export function prepararAbaOrcamento(
  wb: ExcelJS.Workbook,
  nomeAba: string,
  cabecalho: {
    identificacao: string;
    clienteNome: string;
    titulo: string;
    /** Ids da versão única, na coluna oculta da linha 1. */
    marcaDaLinha1?: string;
  },
  /** A faixa e o cabeçalho logo abaixo da identificação. A planilha
   *  mensal passa `false`: lá eles vêm depois da linha de cada mês. */
  comFaixaECabecalho = true,
): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(nomeDeAbaSeguro(nomeAba), {
    views: [{ state: "frozen", ySplit: 3 }],
  });

  // Larguras (A..H)
  ws.columns = [
    { header: "", key: "planilha", width: 32 }, // A · nome do grupo
    { header: "", key: "item", width: 52 }, // B · descrição do item
    { header: "", key: "rs", width: 15 }, // C · valor unitário
    { header: "", key: "qt", width: 8 }, // D · qtd
    { header: "", key: "dm", width: 8 }, // E · dias/mês
    { header: "", key: "tt", width: 16 }, // F · total
    { header: "", key: "tipo", width: 6 }, // G · tipo A/B/C/D
    { header: "", key: "id", width: 2 }, // H · id oculto
    { header: "", key: "consumido", width: 2 }, // I · crédito consumido, oculto
  ];
  ws.getColumn(COLUNA_ID).hidden = true;
  ws.getColumn(COLUNA_CONSUMIDO).hidden = true;

  // -------- Linha 1: cabeçalho de identificação --------
  // A1 e B1 NÃO são mescladas: o Tiago pediu a linha mostrando o job e o
  // cliente (17/09/2026), e a mesclagem antiga escondia o "Cliente:".
  ws.getRow(1).values = [
    cabecalho.identificacao,
    `Cliente: ${cabecalho.clienteNome}`,
    cabecalho.titulo,
    "",
    "",
    "",
    "",
  ];
  ws.mergeCells("C1:G1");
  ws.getRow(1).height = 22;
  ws.getRow(1).eachCell((cell) => {
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: BLACK } };
    cell.alignment = { vertical: "middle" };
  });
  // Exportação de versão única: a seção não tem linha de título, então
  // os ids do orçamento e da versão vão na coluna oculta da linha 1 — é
  // de lá que a importação do projeto os lê.
  if (cabecalho.marcaDaLinha1) {
    ws.getCell(1, COLUNA_ID).value = cabecalho.marcaDaLinha1;
  }

  if (comFaixaECabecalho) escreverFaixaECabecalho(ws);

  return ws;
}

/**
 * A faixa "ORÇAMENTO" e o cabeçalho das colunas, nesta ordem.
 *
 * Ficam numa função própria porque a planilha mensal os repete em cada
 * mês, logo abaixo da linha do mês — é o desenho da aba SUL, aprovado pelo
 * Tiago em 17/09/2026. A e B ganham o tom das colunas PLANILHA e ITEM,
 * como no modelo: a faixa atravessa a planilha, sem buraco branco à
 * esquerda.
 */
export function escreverFaixaECabecalho(ws: ExcelJS.Worksheet): void {
  escreverFaixa(ws);
  escreverCabecalhoColunas(ws);
}

/** Só a faixa "ORÇAMENTO". O resumo do trimestre usa ela sem o cabeçalho:
 *  lá não há itens para nomear colunas. */
export function escreverFaixa(ws: ExcelJS.Worksheet): ExcelJS.Row {
  const faixa = ws.addRow(["", "", "ORÇAMENTO", "", "", "", ""]);
  faixa.height = 20;
  ws.mergeCells(`A${faixa.number}:B${faixa.number}`);
  ws.mergeCells(`C${faixa.number}:F${faixa.number}`);
  for (let col = 1; col <= 7; col++) {
    const cell = faixa.getCell(col);
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: col <= 2 ? AZUL_IDENT : AZUL_ORCADO },
    };
    cell.border = BORDER;
    if (col === 3) {
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.font = { name: "Calibri", size: 12, bold: true, color: { argb: WHITE } };
    }
  }
  return faixa;
}

/** Só o cabeçalho das colunas. */
export function escreverCabecalhoColunas(ws: ExcelJS.Worksheet): ExcelJS.Row {
  const header = ws.addRow(["PLANILHA", "ITEM", "R$", "QT", "D/M", "TT", ""]);
  header.height = 20;
  for (let col = 1; col <= 7; col++) {
    const cell = header.getCell(col);
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: WHITE } };
    cell.alignment = {
      vertical: "middle",
      horizontal: col === 1 || col === 2 ? "left" : "center",
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: col <= 2 ? AZUL_IDENT : AZUL_ORCADO },
    };
    cell.border = BORDER;
  }
  return header;
}

/** Linha de título em faixa azul-escura, com as marcas na coluna oculta.
 *  É o título da seção (um orçamento) e, na planilha mensal, o do mês. */
export function escreverTituloDeSecao(
  ws: ExcelJS.Worksheet,
  titulo: string,
  marcas: string,
  /** Tom da faixa. O mês da planilha mensal usa o cinza da aba SUL. */
  cor: string = AZUL_ORCADO,
): ExcelJS.Row {
  const sRow = ws.addRow([titulo, "", "", "", "", 0, "", marcas]);
  sRow.height = 22;
  for (let col = 1; col <= 7; col++) {
    const cell = sRow.getCell(col);
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: WHITE } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: cor },
    };
    cell.border = BORDER;
    cell.alignment =
      col === 6
        ? { horizontal: "right", vertical: "middle" }
        : { vertical: "middle" };
    if (col === 6) cell.numFmt = FORMATO_MOEDA;
  }
  return sRow;
}

/** Grupos e itens em sequência. Devolve as linhas de grupo, a primeira e a
 *  última linha escritas e o subtotal. */
export function escreverGrupos(
  ws: ExcelJS.Worksheet,
  grupos: GrupoDaAba[],
  formulas: boolean,
): {
  linhasDeGrupo: number[];
  primeira: number | null;
  ultima: number | null;
  subtotal: number;
} {
  const linhasDeGrupo: number[] = [];
  let primeira: number | null = null;
  let ultima: number | null = null;
  let subtotal = 0;

  for (const grupo of grupos) {
    const subtotalGrupo = grupo.itens.reduce((s, i) => s + i.total_orcado, 0);
    subtotal += subtotalGrupo;

    const gRow = ws.addRow([
      grupo.nome,
      "",
      "",
      "",
      "",
      subtotalGrupo,
      "",
      grupo.id ? `${MARCA_GRUPO}${grupo.id}` : "",
    ]);
    gRow.height = 20;
    for (let col = 1; col <= 7; col++) {
      const cell = gRow.getCell(col);
      cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: WHITE } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: AZUL_ORCADO },
      };
      cell.border = BORDER;
      if (col === 6) {
        cell.numFmt = FORMATO_MOEDA;
        cell.alignment = { horizontal: "right", vertical: "middle" };
      } else {
        cell.alignment = { vertical: "middle" };
      }
    }
    linhasDeGrupo.push(gRow.number);
    primeira ??= gRow.number;
    ultima = gRow.number;

    const primeiroItem = gRow.number + 1;
    for (const it of grupo.itens) {
      const row = ws.addRow([
        // A coluna A repete o grupo em cada item (decisão 088): é o formato
        // do modelo que a agência usa, e a importação lê os dois — com
        // texto na A ela agrupa por ele; vazia, herda o grupo anterior.
        grupo.nome,
        it.item,
        it.valor_unitario_orcado,
        it.quantidade_orcada,
        it.dias_meses_orcado,
        it.total_orcado,
        it.tipo_custo,
        it.id ? `${MARCA_ITEM}${it.id}` : "",
        // Consumo não passa do total nem é negativo — a mesma guarda
        // de `calcularTotaisVersao`. Linha em save não consome.
        it.em_save
          ? 0
          : Math.min(
              Math.max(Number(it.save_consumido ?? 0), 0),
              it.total_orcado,
            ),
      ]);
      row.height = 18;
      for (let col = 1; col <= 7; col++) {
        const cell = row.getCell(col);
        cell.font = { name: "Calibri", size: 10, color: { argb: BLACK } };
        cell.border = BORDER;
        cell.alignment = { vertical: "middle" };
        if (col === 3 || col === 6) {
          cell.numFmt = FORMATO_MOEDA;
          cell.alignment = { horizontal: "right", vertical: "middle" };
        } else if (col === 4 || col === 5) {
          cell.alignment = { horizontal: "center", vertical: "middle" };
        } else if (col === 7) {
          cell.alignment = { horizontal: "center", vertical: "middle" };
          cell.font = { name: "Calibri", size: 10, bold: true };
        }
      }
      if (formulas) {
        const r = row.number;
        definirFormula(ws, `${F}${r}`, `C${r}*D${r}*E${r}`, it.total_orcado);
      }
      ultima = row.number;
    }

    if (formulas && grupo.itens.length > 0) {
      const ultimoItem = primeiroItem + grupo.itens.length - 1;
      definirFormula(
        ws,
        `${F}${gRow.number}`,
        `SUM(${F}${primeiroItem}:${F}${ultimoItem})`,
        subtotalGrupo,
      );
    }
  }

  return { linhasDeGrupo, primeira, ultima, subtotal };
}

/**
 * Uma linha do fechamento, no formato do modelo (decisão 088): rótulo
 * mesclado em C..E alinhado à direita, valor em F, letra do tipo em G, e
 * todas as células pintadas — A e B no tom das colunas PLANILHA e ITEM, o
 * resto no tom do orçado.
 *
 * Na linha de HONORÁRIOS o rótulo ocupa C..D e o percentual fica sozinho
 * na E, como a planilha modelo — é de lá que a importação lê a taxa.
 */
export function escreverLinhaFechamento(
  ws: ExcelJS.Worksheet,
  {
    label,
    valor,
    letra,
    pct,
  }: { label: string; valor: number; letra?: string; pct?: number | null },
): ExcelJS.Row {
  const row = ws.addRow(["", "", label, "", "", valor, letra ?? ""]);
  row.height = 20;
  const r = row.number;
  ws.mergeCells(`A${r}:B${r}`);
  if (pct !== null && pct !== undefined) {
    ws.mergeCells(`C${r}:D${r}`);
    row.getCell(5).value = pct;
    row.getCell(5).numFmt = "0%";
  } else {
    ws.mergeCells(`C${r}:E${r}`);
  }
  for (let col = 1; col <= 7; col++) {
    const cell = row.getCell(col);
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: col <= 2 ? AZUL_IDENT : AZUL_ORCADO },
    };
    cell.border = BORDER;
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: WHITE } };
    cell.alignment =
      col === 3
        ? { horizontal: "right", vertical: "middle" }
        : col === 5 || col === 7
          ? { horizontal: "center", vertical: "middle" }
          : col === 6
            ? { horizontal: "right", vertical: "middle" }
            : { vertical: "middle" };
    if (col === 6) cell.numFmt = FORMATO_MOEDA;
  }
  return row;
}

/**
 * O fechamento: SUB-TOTAL por tipo, TOTAL, crédito, IMPOSTO, HONORÁRIOS e
 * FATURAMENTO, com fórmulas sobre a faixa de conteúdo. Na planilha mensal
 * roda uma vez por mês, com o rótulo "FATURAMENTO DE OUTUBRO".
 */
export function escreverFechamento(
  ws: ExcelJS.Worksheet,
  {
    secoes,
    faixas,
    conteudo,
    formulas,
    rotuloFaturamento = "FATURAMENTO",
    subtotaisPorLinhas,
  }: {
    secoes: Pick<SecaoDaAba, "grupos" | "percentualHonorarios" | "percentualImposto">[];
    faixas: FaixaDaSecao[];
    /** Da primeira linha de título/grupo à última de item; `null` sem conteúdo. */
    conteudo: Faixa | null;
    formulas: boolean;
    rotuloFaturamento?: string;
    /** Linhas de SUB-TOTAL a somar em cada letra, no lugar do SUMIF sobre
     *  a faixa. O resumo do trimestre usa isto: somando as linhas de
     *  SUB-TOTAL de cada mês, o SUMIF não conta duas vezes o fechamento
     *  que já existe dentro de cada bloco. */
    subtotaisPorLinhas?: Record<string, number[]>;
  },
): {
  linhaFaturamento: number;
  faturamento: number;
  /** Onde cada SUB-TOTAL caiu — o resumo do trimestre soma estas linhas. */
  linhasSubtotal: LinhaDoSubtotal;
} {
  // -------- Bloco de totais no final --------
  // A planilha enviada ao cliente segue mostrando só o VALOR DO JOB, no
  // rótulo FATURAMENTO que ela sempre teve: é o total que o cliente se
  // compromete a gastar. A quebra entre o que a California emite nota e o
  // que ele paga direto ao fornecedor é leitura interna (decisão do Tiago
  // em 11/08/2026) e não entra neste arquivo.
  //
  // O lado CLIENTE (decisão 041, 04/09/2026), e não o do job nem o bruto:
  // a linha em save ENTRA — o cliente paga por ela agora, mesmo que o
  // serviço fique para outro projeto — e o que é pago com crédito de
  // outro job SAI, porque ele já pagou lá e cobrar de novo seria cobrar
  // duas vezes. Os itens continuam listados cheios; o abatimento aparece
  // numa linha própria entre o TOTAL e o IMPOSTO, para a conta fechar à
  // vista. Sem save é exatamente a conta de sempre.
  //
  // Com várias seções, cada uma fecha com os SEUS percentuais e o
  // arquivo soma os fechamentos — é o que a visão agregada faz.
  const subtotaisPorTipo = Object.fromEntries(
    TIPOS_CUSTO.map((t) => [t, 0]),
  ) as Record<TipoCusto, number>;
  let subtotalGeral = 0;
  let creditoUsado = 0;
  let honorarios = 0;
  let imposto = 0;
  let valorJob = 0;
  for (const secao of secoes) {
    const totais = calcularTotaisVersao(
      secao.grupos.flatMap((g) => g.itens),
      Number(secao.percentualHonorarios ?? 0),
      Number(secao.percentualImposto ?? 0),
    );
    for (const t of TIPOS_CUSTO) subtotaisPorTipo[t] += totais.subtotaisPorTipo[t];
    subtotalGeral += totais.subtotalGeral;
    creditoUsado += totais.save.totalSaveUsado;
    honorarios += totais.cliente.honorarios;
    imposto += totais.cliente.imposto;
    valorJob += totais.cliente.total;
  }
  const temCredito = creditoUsado > 0;

  const percentuaisHonorarios = Array.from(
    new Set(faixas.map((f) => numeroExcel(f.percentualHonorarios))),
  );
  const percentuaisImposto = Array.from(
    new Set(faixas.map((f) => numeroExcel(f.percentualImposto))),
  );
  const honorariosUniforme = percentuaisHonorarios.length <= 1;
  const impostoUniforme = percentuaisImposto.length <= 1;
  const honorPct =
    faixas[0]?.percentualHonorarios ?? secoes[0]?.percentualHonorarios ?? 0;
  const impPct =
    faixas[0]?.percentualImposto ?? secoes[0]?.percentualImposto ?? 0;

  // 1 linha vazia
  ws.addRow([]);

  type LinhaResumo = {
    chave: "tipo" | "total" | "credito" | "imposto" | "honorarios" | "faturamento";
    label: string;
    value: number;
    letra?: string;
    /** Percentual sozinho na coluna E, como o modelo faz nos honorários. */
    pct?: number | null;
  };
  const summaryRows: LinhaResumo[] = [
    ...LINHAS_SUBTOTAL.map<LinhaResumo>((l) => ({
      chave: "tipo",
      label: `SUB-TOTAL ${l.letra}`,
      value: l.tipos.reduce((s, t) => s + subtotaisPorTipo[t], 0),
      letra: l.letra,
    })),
    { chave: "total", label: "TOTAL", value: subtotalGeral },
    // Só quando há crédito consumido: é a linha que explica por que o
    // FATURAMENTO fica abaixo do TOTAL. Sem consumo ela não aparece.
    ...(temCredito
      ? [
          {
            chave: "credito" as const,
            label: "(−) PAGO COM CRÉDITO DE SALDO ANTERIOR",
            value: -creditoUsado,
          },
        ]
      : []),
    { chave: "imposto", label: "IMPOSTO", value: imposto },
    {
      chave: "honorarios",
      label: "HONORÁRIOS",
      value: honorarios,
      // Com taxas diferentes entre os orçamentos não há UM percentual a
      // mostrar — a célula fica vazia, e a fórmula soma parcela a parcela.
      pct: honorariosUniforme ? honorPct / 100 : null,
    },
    {
      chave: "faturamento",
      label: rotuloFaturamento,
      value: valorJob,
    },
  ];

  const linhaDaLetra: LinhaDoSubtotal = {};
  let linhaTotal = 0;
  let linhaCredito = 0;
  let linhaImposto = 0;
  let linhaHonorarios = 0;
  let linhaFaturamento = 0;

  for (const r of summaryRows) {
    const row = escreverLinhaFechamento(ws, {
      label: r.label,
      valor: r.value,
      letra: r.letra,
      pct: r.pct ?? null,
    });

    switch (r.chave) {
      case "tipo":
        linhaDaLetra[r.letra!] = row.number;
        break;
      case "total":
        linhaTotal = row.number;
        break;
      case "credito":
        linhaCredito = row.number;
        break;
      case "imposto":
        linhaImposto = row.number;
        break;
      case "honorarios":
        linhaHonorarios = row.number;
        break;
      case "faturamento":
        linhaFaturamento = row.number;
        break;
    }
  }

  if (formulas) {
    const faixaToda = conteudo;

    // SUB-TOTAL por tipo: soma dos TT cujo tipo (coluna G) é a letra,
    // na planilha inteira — ou a soma das linhas indicadas, no resumo.
    if (subtotaisPorLinhas) {
      for (const l of LINHAS_SUBTOTAL) {
        const refs = (subtotaisPorLinhas[l.letra] ?? []).map((r) => `${F}${r}`);
        if (refs.length > 0) {
          definirFormula(
            ws,
            `${F}${linhaDaLetra[l.letra]}`,
            refs.join("+"),
            l.tipos.reduce((acc, tipo) => acc + subtotaisPorTipo[tipo], 0),
          );
        }
      }
    } else if (faixaToda) {
      const tipos = `$${G}$${faixaToda.de}:$${G}$${faixaToda.ate}`;
      const totais = `$${F}$${faixaToda.de}:$${F}$${faixaToda.ate}`;
      for (const l of LINHAS_SUBTOTAL) {
        definirFormula(
          ws,
          `${F}${linhaDaLetra[l.letra]}`,
          l.tipos.map((t) => `SUMIF(${tipos},"${t}",${totais})`).join("+"),
          l.tipos.reduce((s, t) => s + subtotaisPorTipo[t], 0),
        );
      }
    }

    // TOTAL: soma dos SUB-TOTAIS.
    const primeiroSub = linhaDaLetra[LINHAS_SUBTOTAL[0].letra];
    const ultimoSub = linhaDaLetra[LINHAS_SUBTOTAL[LINHAS_SUBTOTAL.length - 1].letra];
    definirFormula(
      ws,
      `${F}${linhaTotal}`,
      `SUM(${F}${primeiroSub}:${F}${ultimoSub})`,
      subtotalGeral,
    );

    // (−) crédito: a coluna oculta de consumo somada, com sinal trocado.
    const credito: Faixa | null = temCredito && faixaToda ? faixaToda : null;
    if (credito) {
      definirFormula(
        ws,
        `${F}${linhaCredito}`,
        `-SUM($${I}$${credito.de}:$${I}$${credito.ate})`,
        -creditoUsado,
      );
    }

    // HONORÁRIOS: % sobre os tipos com a alavanca `honorarios`, líquidos
    // do crédito consumido. Taxa única → direto sobre os SUB-TOTAIS;
    // taxas diferentes → uma parcela por seção, cada uma com a sua.
    const honorariosDaSecao = (f: FaixaDaSecao) =>
      `(${somaNaFaixa(f, "honorarios", temCredito)})*${numeroExcel(f.percentualHonorarios)}/100`;
    const baseHonorarios = somaDosSubtotais(
      linhaDaLetra,
      "honorarios",
      credito,
      faixaToda,
    );
    if (honorariosUniforme) {
      if (baseHonorarios) {
        // A taxa está na célula E da própria linha, como no modelo.
        definirFormula(
          ws,
          `${F}${linhaHonorarios}`,
          `(${baseHonorarios})*E${linhaHonorarios}`,
          honorarios,
        );
      }
    } else {
      definirFormula(
        ws,
        `${F}${linhaHonorarios}`,
        faixas.map(honorariosDaSecao).join("+"),
        honorarios,
      );
    }

    // IMPOSTO: gross-up sobre (tipos com a alavanca `imposto` + honorários).
    // Mesma conta de `fecharLado`: base × taxa ÷ (1 − taxa).
    if (honorariosUniforme && impostoUniforme) {
      const taxa = taxaDe(impPct);
      if (taxa > 0) {
        const partes = [
          somaDosSubtotais(linhaDaLetra, "imposto", credito, faixaToda),
          `${F}${linhaHonorarios}`,
        ].filter(Boolean);
        definirFormula(
          ws,
          `${F}${linhaImposto}`,
          `(${partes.join("+")})*${numeroExcel(taxa)}/(1-${numeroExcel(taxa)})`,
          imposto,
        );
      }
    } else {
      const parcelas = faixas
        .filter((f) => taxaDe(f.percentualImposto) > 0)
        .map((f) => {
          const taxa = numeroExcel(taxaDe(f.percentualImposto));
          const base = [somaNaFaixa(f, "imposto", temCredito), honorariosDaSecao(f)]
            .filter(Boolean)
            .join("+");
          return `(${base})*${taxa}/(1-${taxa})`;
        });
      if (parcelas.length > 0) {
        definirFormula(
          ws,
          `${F}${linhaImposto}`,
          parcelas.join("+"),
          imposto,
        );
      }
    }

    // FATURAMENTO: principal (alavanca `valorJob`, líquido do crédito) +
    // honorários + imposto.
    const principal = somaDosSubtotais(linhaDaLetra, "valorJob", credito, faixaToda);
    const partesFat = [
      principal,
      `${F}${linhaHonorarios}`,
      `${F}${linhaImposto}`,
    ].filter(Boolean);
    definirFormula(
      ws,
      `${F}${linhaFaturamento}`,
      partesFat.join("+"),
      valorJob,
    );
  }

  return { linhaFaturamento, faturamento: valorJob, linhasSubtotal: linhaDaLetra };
}
