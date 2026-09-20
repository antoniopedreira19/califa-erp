import type ExcelJS from "exceljs";
import {
  AZUL_IDENT,
  AZUL_ORCADO,
  BORDER,
  CINZA_MES,
  FORMATO_MOEDA,
  LARANJA_REALIZADO,
  VERDE_PLANEJADO,
  WHITE,
  nomeDeAbaSeguro,
  MARCA_GRUPO,
  MARCA_ITEM,
  MARCA_MES,
  MARCA_ORCAMENTO,
  MARCA_RESUMO,
  MARCA_VERSAO,
  LINHAS_SUBTOTAL,
  type GrupoDaAba,
  type ItemDaAba,
} from "./planilha-orcamento";
import { nomeDoMes, rotuloMes } from "@/lib/calculos/meses-trimestre";
import type { TipoCusto } from "@/lib/types";

/**
 * A planilha INTERNA (decisão 088): a mesma planilha do cliente com os
 * blocos PLANEJADO e, no job, REALIZADO à direita.
 *
 * O layout é o do "Modelo Planilha interna.xlsx" que a agência usa:
 *
 *   A..G  ORÇAMENTO — as colunas da planilha do cliente
 *   H..L  PLANEJADO — R$ · QT · D/M · TT · RENTABILIDADE
 *   M..Q  REALIZADO — R$ · QT · D/M · TT · RENTABILIDADE (só no job)
 *
 * Decisões que moram aqui, todas do Tiago (16 e 17/09/2026):
 *
 * - **Sem faturamento previsto.** O fechamento termina no VALOR DO JOB e,
 *   quando há save, no VALOR AJUSTADO (SAVE) — o que o cliente paga pelo
 *   job: `valor do job + save gerado − save consumido`. As três linhas de
 *   save só existem quando o caso existe.
 * - **Um tom por parte**, o mesmo da planilha do cliente.
 * - **Posições do modelo no fechamento**: SUB-TOTAL (planejado) e TOTAL
 *   (realizado) na primeira linha; % RENTABILIDADE na linha do IMPOSTO;
 *   RESULTADO OPERACIONAL na de HONORÁRIOS; % RESULTADO GERAL na do VALOR
 *   DO JOB. Toda linha do fechamento fica pintada, inclusive as vazias.
 * - **Sublinhas do realizado**: cada PP não cancelada, a verba devolvida e
 *   o BV confirmado entram numa linha abaixo do item, em itálico e
 *   agrupadas (o botão de recolher do Excel fica na linha do item).
 * - **Rentabilidade em todos os itens**, inclusive nos que ainda não têm
 *   realizado — eles aparecem com realizado R$ 0,00, como na tela.
 *
 * A planilha do job **não volta pelo Importar**: a marca `interna:job` na
 * coluna oculta da linha 1 é o que os leitores usam para recusá-la. A de
 * orçamento volta, e por isso mantém os ids de cada linha.
 */

/** Colunas A..G, como a planilha do cliente. */
const COL_TT_ORCADO = 6;
/** H..L. */
const COL_PLAN_RS = 8;
const COL_PLAN_TT = 11;
const COL_PLAN_RENTAB = 12;
/** M..Q. */
const COL_REAL_RS = 13;
const COL_REAL_TT = 16;
const COL_REAL_RENTAB = 17;

const FORMATO_PCT = "0.0%";

/** Prefixo da marca da linha 1, que é como os parsers acham a coluna
 *  oculta da interna — ela não fica na H, que aqui é do PLANEJADO. */
export const MARCA_INTERNA = "interna:";
export const MARCA_INTERNA_ORCAMENTO = "interna:orcamento";
export const MARCA_INTERNA_JOB = "interna:job";

export type MarcaDaInterna =
  | typeof MARCA_INTERNA_ORCAMENTO
  | typeof MARCA_INTERNA_JOB;

/** Uma linha abaixo do item, dentro do bloco REALIZADO. */
export interface SublinhaRealizado {
  /** "PP-00024 · Pago · Antonio", "(−) Verba devolvida · PP-00058". */
  rotulo: string;
  /** Negativo na verba devolvida e no BV. */
  valor: number;
  /** Coluna oculta: `pp:<id>`, `devolucao:<id>`, `bv:<id>`. */
  marca: string;
  /** R$ · QT · D/M da PP. Ausente nas linhas de dedução. */
  unitario?: { valor: number; quantidade: number; diasMeses: number } | null;
}

export interface ItemInterno extends ItemDaAba {
  valor_unitario_planejado?: number | null;
  quantidade_planejada?: number | null;
  dias_meses_planejado?: number | null;
  total_planejado?: number | null;
  /** Só no job. */
  realizado?: {
    /** R$ · QT · D/M quando o item tem uma PP só, ou espelha o orçado. */
    valorUnitario: number | null;
    quantidade: number | null;
    diasMeses: number | null;
    /** O TT da linha, já na visão Líquido (− BV). */
    total: number;
    /** Em `A` e `D` o realizado espelha o orçado: o TT vira `=F<linha>`. */
    espelhaOrcado: boolean;
    sublinhas: SublinhaRealizado[];
    /** Há BV lançado que ainda não conta — vira nota na célula. */
    bvNaoEmitido?: boolean;
  } | null;
  /** Nasceu na errata e não tem orçado nem planejado. */
  linha_vermelha?: boolean | null;
}

export interface GrupoInterno extends GrupoDaAba {
  itens: ItemInterno[];
}

/** Um mês da planilha mensal. */
export interface MesInterno {
  mes: string;
  grupos: GrupoInterno[];
}

/** O fechamento de um conjunto de itens, já calculado pelo ERP. */
export interface FechamentoInterno {
  subtotaisPorTipo: Record<TipoCusto, number>;
  subtotalGeral: number;
  /** Custo das linhas em save — a linha "(−) LINHAS EM SAVE". */
  linhasEmSave: number;
  honorarios: number;
  percentualHonorarios: number | null;
  imposto: number;
  percentualImposto: number;
  valorDoJob: number;
  /** A cadeia internacional, quando o orçamento é internacional. */
  internacional?: {
    fee: number;
    intTaxes: number;
    percentualIntTaxes: number;
    recebidoExterior: number;
    intTransactionCosts: number;
    impostoBr: number;
  } | null;
  /** Save: cada um só entra quando existe. */
  saveGerado: number;
  saveConsumido: number;
  valorAjustado: number;
  /** Planejado e realizado do mesmo conjunto. */
  planejado: LadoInterno;
  realizado?: LadoInterno | null;
}

export interface LadoInterno {
  /** Soma do bloco (custo). */
  total: number;
  rentabilidade: number;
  percentualRentabilidade: number | null;
  resultadoOperacional: number | null;
  percentualResultadoGeral: number | null;
}

export interface SecaoInterna {
  titulo?: string;
  orcamentoId?: string;
  versaoId?: string;
  grupos?: GrupoInterno[];
  /** No mensal, os grupos vêm dentro dos meses. */
  meses?: MesInterno[];
  /** Fechamento da seção inteira (ou do trimestre, no mensal). */
  fechamento: FechamentoInterno;
  /** Fechamento de cada mês, na ordem de `meses`. */
  fechamentoDoMes?: FechamentoInterno[];
}

export interface DadosDaAbaInterna {
  identificacao: string;
  clienteNome: string;
  titulo: string;
  marca: MarcaDaInterna;
  /** `internacional` troca as colunas do orçado e a cadeia do fechamento. */
  modelo: "nacional" | "internacional" | "mensal";
  /** Só no internacional. */
  moeda?: string;
  cambioCompra?: number | null;
  cambio?: {
    cotacao: number | null;
    venda: number | null;
    data: string | null;
    nomeDaMoeda: string;
  } | null;
  secoes: SecaoInterna[];
  /** Fechamento TOTAL do arquivo, quando ele tem mais de um orçamento: um
   *  resumo no fim, depois dos fechamentos de cada um (pedido do Tiago em
   *  17/09/2026, no molde do resumo do trimestre). Some com uma seção só. */
  fechamentoTotal?: FechamentoInterno | null;
  /** O job traz realizado; a versão do orçamento, não. */
  comRealizado: boolean;
}

function pintar(
  cell: ExcelJS.Cell,
  opcoes: {
    fundo?: string;
    negrito?: boolean;
    cor?: string;
    tamanho?: number;
    formato?: string;
    horizontal?: "left" | "center" | "right";
    italico?: boolean;
  } = {},
) {
  if (opcoes.fundo) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opcoes.fundo } };
  }
  cell.font = {
    name: "Calibri",
    size: opcoes.tamanho ?? 11,
    bold: opcoes.negrito ?? false,
    italic: opcoes.italico ?? false,
    color: { argb: opcoes.cor ?? "FF000000" },
  };
  if (opcoes.formato) cell.numFmt = opcoes.formato;
  cell.alignment = { vertical: "middle", horizontal: opcoes.horizontal };
  cell.border = BORDER;
}

function numero(v: number | string | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function definirFormula(
  ws: ExcelJS.Worksheet,
  linha: number,
  coluna: number,
  formula: string,
  resultado: number,
) {
  ws.getCell(linha, coluna).value = { formula, result: resultado };
}

/** `2026-06-02` → `02/06/26`, sem passar por fuso. */
function dataCurta(iso: string | null): string {
  if (!iso) return "";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return a && m && d ? `${d}/${m}/${a.slice(2)}` : "";
}

function formatoDaMoeda(codigo: string): string {
  switch (codigo) {
    case "USD":
      return "[$$]#,##0.00";
    case "GBP":
      return "[$£]#,##0.00";
    case "EUR":
      return "[$€]#,##0.00";
    default:
      return `"${codigo} "#,##0.00`;
  }
}

/** Escreve a aba interna e a devolve. */
export function adicionarAbaInterna(
  wb: ExcelJS.Workbook,
  nomeAba: string,
  dados: DadosDaAbaInterna,
): ExcelJS.Worksheet {
  const internacional = dados.modelo === "internacional";
  const comRealizado = dados.comRealizado;
  const ultimaVisivel = comRealizado ? COL_REAL_RENTAB : COL_PLAN_RENTAB;
  const colunaId = ultimaVisivel + 1;
  const colunaConsumido = ultimaVisivel + 2;
  const formatoMoedaEstrangeira = formatoDaMoeda(dados.moeda ?? "USD");
  const compra =
    dados.cambioCompra !== null && dados.cambioCompra !== undefined && dados.cambioCompra > 0
      ? dados.cambioCompra
      : null;

  const ws = wb.addWorksheet(nomeDeAbaSeguro(nomeAba, "Interna"), {
    views: [{ state: "frozen", ySplit: 3 }],
  });
  // Recolher as sublinhas com o botão na linha do ITEM, e não embaixo do
  // grupo (`summaryBelow: false`) — o Tiago pediu poder minimizá-las.
  ws.properties.outlineProperties = { summaryBelow: false, summaryRight: false };

  const larguras = [
    32, 52, internacional ? 16 : 15, 8, 8, 16, 6, // A..G
    15, 8, 8, 16, 18, // H..L planejado
    ...(comRealizado ? [15, 8, 8, 16, 18] : []), // M..Q realizado
    2, 2, // ids ocultos
  ];
  ws.columns = larguras.map((width) => ({ header: "", width }));
  ws.getColumn(colunaId).hidden = true;
  ws.getColumn(colunaConsumido).hidden = true;

  // -------- Linha 1: identificação --------
  // `ws.columns` já cria a linha 1; escrever nela em vez de `addRow` é o
  // que mantém a identificação no topo.
  const ident = ws.getRow(1);
  ident.values = [dados.identificacao, `Cliente: ${dados.clienteNome}`, dados.titulo];
  ident.height = 22;
  ws.mergeCells(1, 3, 1, ultimaVisivel);
  for (let col = 1; col <= ultimaVisivel; col++) {
    pintar(ident.getCell(col), { negrito: true });
  }
  const unica = dados.secoes.length === 1 ? dados.secoes[0] : null;
  ident.getCell(colunaId).value = [
    dados.marca,
    unica && unica.titulo === undefined && unica.orcamentoId
      ? `${MARCA_ORCAMENTO}${unica.orcamentoId}`
      : "",
    unica && unica.titulo === undefined && unica.versaoId
      ? `${MARCA_VERSAO}${unica.versaoId}`
      : "",
  ]
    .filter(Boolean)
    .join("|");

  // ---------------------------------------------------------------- faixas
  function escreverFaixas() {
    const faixa = ws.addRow([]);
    faixa.height = 20;
    ws.mergeCells(faixa.number, 1, faixa.number, 2);
    ws.mergeCells(faixa.number, 3, faixa.number, 7);
    ws.mergeCells(faixa.number, COL_PLAN_RS, faixa.number, COL_PLAN_RENTAB);
    faixa.getCell(3).value = "ORÇAMENTO";
    faixa.getCell(COL_PLAN_RS).value = "PLANEJADO";
    if (comRealizado) {
      ws.mergeCells(faixa.number, COL_REAL_RS, faixa.number, COL_REAL_RENTAB);
      faixa.getCell(COL_REAL_RS).value = "REALIZADO";
    }
    for (let col = 1; col <= ultimaVisivel; col++) {
      pintar(faixa.getCell(col), {
        fundo: fundoDaColuna(col),
        negrito: true,
        cor: WHITE,
        tamanho: 12,
        horizontal: col >= 3 ? "center" : undefined,
      });
    }
    return faixa;
  }

  function escreverCabecalho() {
    const cab = ws.addRow([]);
    cab.height = 20;
    const rotulos: [number, string][] = internacional
      ? [
          [1, "SHEET"],
          [2, "ITEM"],
          [3, `TT ${dados.moeda ?? "USD"}`],
          [4, "BRL"],
          [5, "QT"],
          [6, "D/M"],
          [7, "TT BRL"],
        ]
      : [
          [1, "PLANILHA"],
          [2, "ITEM"],
          [3, "R$"],
          [4, "QT"],
          [5, "D/M"],
          [6, "TT"],
        ];
    for (const [col, texto] of rotulos) cab.getCell(col).value = texto;
    cab.getCell(COL_PLAN_RS).value = "R$";
    cab.getCell(COL_PLAN_RS + 1).value = "QT";
    cab.getCell(COL_PLAN_RS + 2).value = "D/M";
    cab.getCell(COL_PLAN_TT).value = "TT";
    cab.getCell(COL_PLAN_RENTAB).value = "RENTABILIDADE";
    if (comRealizado) {
      cab.getCell(COL_REAL_RS).value = "R$";
      cab.getCell(COL_REAL_RS + 1).value = "QT";
      cab.getCell(COL_REAL_RS + 2).value = "D/M";
      cab.getCell(COL_REAL_TT).value = "TT";
      cab.getCell(COL_REAL_RENTAB).value = "RENTABILIDADE";
    }
    for (let col = 1; col <= ultimaVisivel; col++) {
      pintar(cab.getCell(col), {
        fundo: fundoDaColuna(col),
        negrito: true,
        cor: WHITE,
        horizontal: col <= 2 ? "left" : "center",
      });
    }
    return cab;
  }

  function fundoDaColuna(col: number): string {
    if (col <= 2) return AZUL_IDENT;
    if (col <= 7) return AZUL_ORCADO;
    if (col <= COL_PLAN_RENTAB) return VERDE_PLANEJADO;
    return LARANJA_REALIZADO;
  }

  /** Faixa de título (seção, mês ou resumo), atravessando a planilha. */
  function escreverTitulo(texto: string, marca: string, cor: string) {
    const row = ws.addRow([texto]);
    row.height = 22;
    ws.mergeCells(row.number, 1, row.number, ultimaVisivel);
    pintar(row.getCell(1), { fundo: cor, negrito: true, cor: WHITE, tamanho: 12 });
    if (marca) row.getCell(colunaId).value = marca;
    return row;
  }

  // ---------------------------------------------------------------- itens
  interface LinhasDoGrupo {
    linhasDeItem: number[];
    linhaDoGrupo: number;
  }

  function escreverGrupo(grupo: GrupoInterno): LinhasDoGrupo {
    const gRow = ws.addRow([grupo.nome]);
    gRow.height = 20;
    gRow.getCell(colunaId).value = grupo.id ? `${MARCA_GRUPO}${grupo.id}` : "";
    for (let col = 1; col <= ultimaVisivel; col++) {
      pintar(gRow.getCell(col), {
        // Na linha de grupo o nome fica no tom do ORÇADO, e não no das
        // colunas PLANILHA e ITEM — é assim na planilha do cliente e foi
        // o que o Tiago pediu em 17/09/2026.
        fundo: col <= 2 ? AZUL_ORCADO : fundoDaColuna(col),
        negrito: true,
        cor: WHITE,
        formato:
          col === COL_TT_ORCADO ||
          col === COL_PLAN_TT ||
          col === COL_PLAN_RENTAB ||
          col === COL_REAL_TT ||
          col === COL_REAL_RENTAB
            ? FORMATO_MOEDA
            : col === 3 && internacional
              ? formatoMoedaEstrangeira
              : undefined,
        horizontal:
          col === COL_TT_ORCADO ||
          col === COL_PLAN_TT ||
          col === COL_PLAN_RENTAB ||
          col === COL_REAL_TT ||
          col === COL_REAL_RENTAB ||
          (col === 3 && internacional)
            ? "right"
            : undefined,
      });
    }

    const linhasDeItem: number[] = [];
    for (const item of grupo.itens) {
      linhasDeItem.push(escreverItem(grupo, item));
    }
    return { linhaDoGrupo: gRow.number, linhasDeItem };
  }

  function escreverItem(grupo: GrupoInterno, item: ItemInterno): number {
    const row = ws.addRow([]);
    row.height = 18;
    const r = row.number;
    const emSave = Boolean(item.em_save);
    const vermelha = Boolean(item.linha_vermelha);

    // ---- A..G, o orçado
    row.getCell(1).value = grupo.nome;
    row.getCell(2).value = item.item;
    if (!vermelha) {
      if (internacional) {
        row.getCell(4).value = item.valor_unitario_orcado;
        row.getCell(5).value = item.quantidade_orcada;
        row.getCell(6).value = item.dias_meses_orcado;
        definirFormula(ws, r, 7, `D${r}*E${r}*F${r}`, item.total_orcado);
        if (compra) {
          definirFormula(ws, r, 3, `G${r}/$B$${linhaDaCompra ?? 1}`, item.total_orcado / compra);
        }
      } else {
        row.getCell(3).value = item.valor_unitario_orcado;
        row.getCell(4).value = item.quantidade_orcada;
        row.getCell(5).value = item.dias_meses_orcado;
        definirFormula(ws, r, 6, `C${r}*D${r}*E${r}`, item.total_orcado);
      }
    }
    if (!internacional) row.getCell(7).value = item.tipo_custo;

    // ---- H..L, o planejado. Linha em save não tem custo neste job.
    const colTtOrcado = internacional ? 7 : COL_TT_ORCADO;
    if (!emSave) {
      row.getCell(COL_PLAN_RS).value = numero(item.valor_unitario_planejado);
      row.getCell(COL_PLAN_RS + 1).value = numero(item.quantidade_planejada);
      row.getCell(COL_PLAN_RS + 2).value = numero(item.dias_meses_planejado);
      definirFormula(
        ws,
        r,
        COL_PLAN_TT,
        `H${r}*I${r}*J${r}`,
        numero(item.total_planejado),
      );
      if (!vermelha) {
        definirFormula(
          ws,
          r,
          COL_PLAN_RENTAB,
          `${colunaLetra(colTtOrcado)}${r}-K${r}`,
          item.total_orcado - numero(item.total_planejado),
        );
      }
    }

    // ---- M..Q, o realizado
    if (comRealizado && !emSave && item.realizado) {
      const real = item.realizado;
      if (real.valorUnitario !== null) row.getCell(COL_REAL_RS).value = real.valorUnitario;
      if (real.quantidade !== null) row.getCell(COL_REAL_RS + 1).value = real.quantidade;
      if (real.diasMeses !== null) row.getCell(COL_REAL_RS + 2).value = real.diasMeses;
      const somaDasSublinhas = real.sublinhas.length > 0;
      if (real.espelhaOrcado) {
        // `A` e `D` espelham o orçado; o BV, se houver, entra na sublinha.
        const refs = [`${colunaLetra(colTtOrcado)}${r}`];
        for (let i = 1; i <= real.sublinhas.length; i++) refs.push(`P${r + i}`);
        definirFormula(ws, r, COL_REAL_TT, refs.join("+"), real.total);
      } else if (somaDasSublinhas) {
        definirFormula(
          ws,
          r,
          COL_REAL_TT,
          `SUM(P${r + 1}:P${r + real.sublinhas.length})`,
          real.total,
        );
      } else {
        row.getCell(COL_REAL_TT).value = real.total;
      }
      definirFormula(
        ws,
        r,
        COL_REAL_RENTAB,
        `${colunaLetra(colTtOrcado)}${r}-P${r}`,
        item.total_orcado - real.total,
      );
      if (real.bvNaoEmitido) {
        ws.getCell(r, COL_REAL_TT).note =
          "BV não emitido: há BV lançado que ainda não conta no realizado.";
      }
    }

    // ---- pintura da linha
    for (let col = 1; col <= ultimaVisivel; col++) {
      const cell = row.getCell(col);
      pintar(cell, {
        tamanho: 10,
        formato: formatoDaCelula(col),
        horizontal: alinhamentoDaCelula(col),
      });
      if (vermelha) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4CCCC" } };
      } else if (emSave) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
      }
    }
    if (emSave) {
      ws.getCell(r, 2).note =
        "Em save: faturada neste orçamento, com o serviço em outro job.";
    }
    if (vermelha) {
      ws.getCell(r, 2).note = "Linha vermelha, nascida de errata: só realizado.";
    }

    row.getCell(colunaId).value = item.id ? `${MARCA_ITEM}${item.id}` : "";
    row.getCell(colunaConsumido).value = item.em_save
      ? 0
      : Math.min(Math.max(numero(item.save_consumido), 0), item.total_orcado);

    // ---- sublinhas do realizado
    if (comRealizado && item.realizado) {
      for (const sub of item.realizado.sublinhas) {
        escreverSublinha(sub);
      }
    }
    return r;
  }

  function escreverSublinha(sub: SublinhaRealizado) {
    const row = ws.addRow([]);
    row.height = 17;
    const r = row.number;
    row.outlineLevel = 1;
    row.getCell(2).value = `↳ ${sub.rotulo}`;
    if (sub.unitario) {
      row.getCell(COL_REAL_RS).value = sub.unitario.valor;
      row.getCell(COL_REAL_RS + 1).value = sub.unitario.quantidade;
      row.getCell(COL_REAL_RS + 2).value = sub.unitario.diasMeses;
      definirFormula(ws, r, COL_REAL_TT, `M${r}*N${r}*O${r}`, sub.valor);
    } else {
      row.getCell(COL_REAL_TT).value = sub.valor;
    }
    for (let col = 1; col <= ultimaVisivel; col++) {
      pintar(row.getCell(col), {
        tamanho: 10,
        italico: true,
        cor: "FF5E5E5E",
        formato: formatoDaCelula(col),
        horizontal: alinhamentoDaCelula(col),
      });
    }
    row.getCell(colunaId).value = sub.marca;
  }

  function formatoDaCelula(col: number): string | undefined {
    if (internacional && col === 3) return formatoMoedaEstrangeira;
    if (internacional && (col === 4 || col === 7)) return FORMATO_MOEDA;
    if (!internacional && (col === 3 || col === 6)) return FORMATO_MOEDA;
    if (
      col === COL_PLAN_RS ||
      col === COL_PLAN_TT ||
      col === COL_PLAN_RENTAB ||
      col === COL_REAL_RS ||
      col === COL_REAL_TT ||
      col === COL_REAL_RENTAB
    ) {
      return FORMATO_MOEDA;
    }
    return undefined;
  }

  function alinhamentoDaCelula(col: number): "left" | "center" | "right" | undefined {
    if (col === 1 || col === 2) return undefined;
    const centro = internacional ? [5, 6] : [4, 5];
    if (centro.includes(col)) return "center";
    if ([COL_PLAN_RS + 1, COL_PLAN_RS + 2, COL_REAL_RS + 1, COL_REAL_RS + 2].includes(col)) {
      return "center";
    }
    if (col === 7 && !internacional) return "center";
    return "right";
  }

  function colunaLetra(col: number): string {
    return String.fromCharCode(64 + col);
  }

  // ------------------------------------------------------------ fechamento
  interface LinhaDeFechamento {
    rotulo: string;
    valor: number;
    /** Letra do tipo, na coluna G. */
    letra?: string;
    /** Percentual sozinho na coluna E (honorários e fee). */
    pct?: number | null;
    /** Só no internacional: a mesma linha na moeda estrangeira. */
    emMoeda?: boolean;
    /** Linha sem rótulo nem valor, só para o bloco lateral fechar. */
    vazia?: boolean;
  }

  /**
   * O fechamento de um conjunto — a seção, o mês ou o trimestre.
   *
   * Devolve as linhas do TOTAL e do VALOR DO JOB, que o mensal usa para
   * somar os meses no resumo.
   */
  function escreverFechamento(
    f: FechamentoInterno,
    opcoes: {
      rotuloValorDoJob: string;
      /** Linhas de SUB-TOTAL de cada mês, para o resumo somar. */
      subtotaisPorLinhas?: Record<string, number[]>;
      /** Faixa dos itens, para o SUMIF por tipo. */
      conteudo?: { de: number; ate: number } | null;
      /** Linhas de grupo, para o planejado e o realizado somarem. */
      linhasDeGrupo?: number[];
    },
  ): { linhaTotal: number; linhaValorDoJob: number; linhasSubtotal: Record<string, number> } {
    const temSave = f.linhasEmSave > 0;
    const temGerado = f.saveGerado > 0;
    const temConsumido = f.saveConsumido > 0;
    const temAjustado = temGerado || temConsumido;

    const linhas: LinhaDeFechamento[] = [];
    if (!internacional) {
      for (const l of LINHAS_SUBTOTAL) {
        linhas.push({
          rotulo: `SUB-TOTAL ${l.letra}`,
          valor: l.tipos.reduce((s, t) => s + (f.subtotaisPorTipo[t] ?? 0), 0),
          letra: l.letra,
        });
      }
    }
    linhas.push({ rotulo: "TOTAL", valor: f.subtotalGeral, emMoeda: true });
    if (temSave) {
      linhas.push({
        rotulo: "(−) LINHAS EM SAVE",
        valor: -f.linhasEmSave,
        emMoeda: true,
      });
    }
    if (internacional && f.internacional) {
      linhas.push(
        {
          rotulo: "FEE",
          valor: f.internacional.fee,
          pct: f.percentualHonorarios !== null ? f.percentualHonorarios / 100 : null,
          emMoeda: true,
        },
        { rotulo: "INT TAXES", valor: f.internacional.intTaxes, emMoeda: true },
        {
          rotulo: "TOTAL RECEBIDO EXTERIOR",
          valor: f.internacional.recebidoExterior,
          emMoeda: true,
        },
        {
          rotulo: "INT TRANSACTION COSTS",
          valor: f.internacional.intTransactionCosts,
          emMoeda: true,
        },
        { rotulo: "BRAZILIAN TAXES", valor: f.internacional.impostoBr, emMoeda: true },
      );
    } else {
      linhas.push(
        { rotulo: "IMPOSTO", valor: f.imposto },
        {
          rotulo: "HONORÁRIOS",
          valor: f.honorarios,
          pct: f.percentualHonorarios !== null ? f.percentualHonorarios / 100 : null,
        },
      );
    }
    linhas.push({ rotulo: opcoes.rotuloValorDoJob, valor: f.valorDoJob, emMoeda: true });
    if (temGerado) {
      linhas.push({ rotulo: "(+) SAVE GERADO", valor: f.saveGerado, emMoeda: true });
    }
    if (temConsumido) {
      linhas.push({ rotulo: "(−) SAVE CONSUMIDO", valor: -f.saveConsumido, emMoeda: true });
    }
    if (temAjustado) {
      linhas.push({
        rotulo: "VALOR AJUSTADO (SAVE)",
        valor: f.valorAjustado,
        emMoeda: true,
      });
    }
    // No internacional o % RESULTADO GERAL fica na linha DEPOIS do valor,
    // como na aba INTERNA USD. Sem save não há linha nenhuma ali, e o
    // fechamento ganha uma linha vazia só para ela.
    if (internacional && !temAjustado) {
      linhas.push({ rotulo: "", valor: 0, vazia: true });
    }

    // As posições do modelo: o planejado e o realizado começam na primeira
    // linha e terminam na do valor do job.
    const iTotal = linhas.findIndex((l) => l.rotulo === "TOTAL");
    const iValorDoJob = linhas.findIndex((l) => l.rotulo === opcoes.rotuloValorDoJob);
    const iRentab = internacional
      ? linhas.findIndex((l) => l.rotulo === "BRAZILIAN TAXES")
      : linhas.findIndex((l) => l.rotulo === "IMPOSTO");
    const iResultado = internacional
      ? iValorDoJob
      : linhas.findIndex((l) => l.rotulo === "HONORÁRIOS");
    const iGeral = internacional ? iValorDoJob + 1 : iValorDoJob;
    const iTopo = 0;

    const linhasSubtotal: Record<string, number> = {};
    let linhaTotal = 0;
    let linhaValorDoJob = 0;
    let linhaEmSave = 0;
    let linhaHonorarios = 0;
    let linhaGerado = 0;
    let linhaConsumido = 0;
    const numeroDaLinha: number[] = [];

    linhas.forEach((l, i) => {
      const row = ws.addRow([]);
      row.height = 20;
      const r = row.number;
      numeroDaLinha[i] = r;
      ws.mergeCells(r, 1, r, 2);
      if (l.pct !== null && l.pct !== undefined) {
        ws.mergeCells(r, 3, r, 4);
        row.getCell(5).value = l.pct;
        row.getCell(5).numFmt = "0%";
      } else {
        ws.mergeCells(r, 3, r, 5);
      }
      if (!l.vazia) {
        row.getCell(3).value = l.rotulo;
        row.getCell(internacional ? 7 : 6).value = l.valor;
      }
      if (internacional && l.emMoeda && !l.vazia && compra) {
        definirFormula(ws, r, 6, `G${r}/$B$${linhaDaCompra ?? 1}`, l.valor / compra);
      }
      if (l.letra) row.getCell(7).value = l.letra;

      for (let col = 1; col <= 7; col++) {
        pintar(row.getCell(col), {
          fundo: col <= 2 ? AZUL_IDENT : AZUL_ORCADO,
          negrito: true,
          cor: WHITE,
          formato:
            col === 6 && internacional
              ? formatoMoedaEstrangeira
              : col === 6 || col === 7
                ? col === 7 && !internacional
                  ? undefined
                  : FORMATO_MOEDA
                : undefined,
          horizontal:
            col === 3 ? "right" : col === 5 || col === 7 ? "center" : col === 6 ? "right" : undefined,
        });
      }
      if (!internacional) {
        ws.getCell(r, 6).numFmt = FORMATO_MOEDA;
        ws.getCell(r, 6).alignment = { horizontal: "right", vertical: "middle" };
      }

      if (l.rotulo === "TOTAL") linhaTotal = r;
      if (l.rotulo === opcoes.rotuloValorDoJob) linhaValorDoJob = r;
      if (l.rotulo === "(−) LINHAS EM SAVE") linhaEmSave = r;
      if (l.rotulo === "HONORÁRIOS" || l.rotulo === "FEE") linhaHonorarios = r;
      if (l.rotulo === "(+) SAVE GERADO") linhaGerado = r;
      if (l.rotulo === "(−) SAVE CONSUMIDO") linhaConsumido = r;
      if (l.letra) linhasSubtotal[l.letra] = r;
    });

    // ---- blocos do planejado e do realizado, nas posições do modelo
    const colTt = internacional ? 7 : 6;
    const baseRentab = temSave
      ? `(${colunaLetra(colTt)}${linhaTotal}+${colunaLetra(colTt)}${linhaEmSave})`
      : `${colunaLetra(colTt)}${linhaTotal}`;

    function escreverLado(
      lado: LadoInterno,
      colRs: number,
      colTtLado: number,
      colRentab: number,
      rotuloTopo: string,
      fundo: string,
      linhasDeGrupo: number[],
    ) {
      for (let i = 0; i < linhas.length; i++) {
        const r = numeroDaLinha[i];
        for (let col = colRs; col <= colRentab; col++) {
          pintar(ws.getCell(r, col), { fundo, negrito: true, cor: WHITE });
        }
        if (i === iTopo) {
          ws.mergeCells(r, colRs, r, colTtLado - 1);
          ws.getCell(r, colRs).value = rotuloTopo;
          ws.getCell(r, colRs).alignment = { horizontal: "right", vertical: "middle" };
          if (linhasDeGrupo.length > 0) {
            definirFormula(
              ws,
              r,
              colTtLado,
              linhasDeGrupo.map((g) => `${colunaLetra(colTtLado)}${g}`).join("+"),
              lado.total,
            );
            definirFormula(
              ws,
              r,
              colRentab,
              linhasDeGrupo.map((g) => `${colunaLetra(colRentab)}${g}`).join("+"),
              lado.rentabilidade,
            );
          } else {
            ws.getCell(r, colTtLado).value = lado.total;
            ws.getCell(r, colRentab).value = lado.rentabilidade;
          }
          ws.getCell(r, colTtLado).numFmt = FORMATO_MOEDA;
          ws.getCell(r, colRentab).numFmt = FORMATO_MOEDA;
          ws.getCell(r, colTtLado).alignment = { horizontal: "right", vertical: "middle" };
          ws.getCell(r, colRentab).alignment = { horizontal: "right", vertical: "middle" };
        } else if (i === iRentab || i === iResultado || i === iGeral) {
          ws.mergeCells(r, colRs, r, colRentab - 1);
          const rotulo =
            i === iRentab
              ? "% RENTABILIDADE"
              : i === iResultado
                ? "RESULTADO OPERACIONAL"
                : "% RESULTADO GERAL";
          ws.getCell(r, colRs).value = rotulo;
          ws.getCell(r, colRs).alignment = { horizontal: "right", vertical: "middle" };
          const alvo = ws.getCell(r, colRentab);
          alvo.alignment = { horizontal: "right", vertical: "middle" };
          if (i === iRentab) {
            alvo.numFmt = FORMATO_PCT;
            definirFormula(
              ws,
              r,
              colRentab,
              `IFERROR(${colunaLetra(colRentab)}${numeroDaLinha[iTopo]}/${baseRentab},0)`,
              (lado.percentualRentabilidade ?? 0) / 100,
            );
          } else if (i === iResultado) {
            alvo.numFmt = FORMATO_MOEDA;
            definirFormula(
              ws,
              r,
              colRentab,
              `${colunaLetra(colRentab)}${numeroDaLinha[iTopo]}+${colunaLetra(colTt)}${linhaHonorarios}`,
              lado.resultadoOperacional ?? 0,
            );
          } else {
            alvo.numFmt = FORMATO_PCT;
            definirFormula(
              ws,
              r,
              colRentab,
              `IFERROR(${colunaLetra(colRentab)}${numeroDaLinha[iResultado]}/${colunaLetra(colTt)}${linhaValorDoJob},0)`,
              (lado.percentualResultadoGeral ?? 0) / 100,
            );
          }
        }
      }
    }

    escreverLado(
      f.planejado,
      COL_PLAN_RS,
      COL_PLAN_TT,
      COL_PLAN_RENTAB,
      "SUB-TOTAL",
      VERDE_PLANEJADO,
      opcoes.linhasDeGrupo ?? [],
    );
    if (comRealizado && f.realizado) {
      escreverLado(
        f.realizado,
        COL_REAL_RS,
        COL_REAL_TT,
        COL_REAL_RENTAB,
        "TOTAL",
        LARANJA_REALIZADO,
        opcoes.linhasDeGrupo ?? [],
      );
    }

    // ---- fórmulas do orçado
    if (!internacional) {
      if (opcoes.subtotaisPorLinhas) {
        for (const l of LINHAS_SUBTOTAL) {
          const refs = (opcoes.subtotaisPorLinhas[l.letra] ?? []).map((r) => `F${r}`);
          if (refs.length > 0) {
            definirFormula(
              ws,
              linhasSubtotal[l.letra],
              6,
              refs.join("+"),
              l.tipos.reduce((s, t) => s + (f.subtotaisPorTipo[t] ?? 0), 0),
            );
          }
        }
      } else if (opcoes.conteudo) {
        const tipos = `$G$${opcoes.conteudo.de}:$G$${opcoes.conteudo.ate}`;
        const totais = `$F$${opcoes.conteudo.de}:$F$${opcoes.conteudo.ate}`;
        for (const l of LINHAS_SUBTOTAL) {
          definirFormula(
            ws,
            linhasSubtotal[l.letra],
            6,
            l.tipos.map((t) => `SUMIF(${tipos},"${t}",${totais})`).join("+"),
            l.tipos.reduce((s, t) => s + (f.subtotaisPorTipo[t] ?? 0), 0),
          );
        }
      }
      const letras = LINHAS_SUBTOTAL.map((l) => linhasSubtotal[l.letra]);
      if (letras.length > 0) {
        definirFormula(
          ws,
          linhaTotal,
          6,
          `SUM(F${letras[0]}:F${letras[letras.length - 1]})`,
          f.subtotalGeral,
        );
      }
    } else if (opcoes.linhasDeGrupo && opcoes.linhasDeGrupo.length > 0) {
      definirFormula(
        ws,
        linhaTotal,
        7,
        opcoes.linhasDeGrupo.map((g) => `G${g}`).join("+"),
        f.subtotalGeral,
      );
    }

    // ---- valor ajustado: a soma das três células, como o design mostra
    if (temAjustado) {
      const partes = [`${colunaLetra(colTt)}${linhaValorDoJob}`];
      if (linhaGerado) partes.push(`${colunaLetra(colTt)}${linhaGerado}`);
      if (linhaConsumido) partes.push(`${colunaLetra(colTt)}${linhaConsumido}`);
      definirFormula(
        ws,
        numeroDaLinha[linhas.length - 1],
        colTt,
        partes.join("+"),
        f.valorAjustado,
      );
    }

    return { linhaTotal, linhaValorDoJob, linhasSubtotal };
  }

  // ---------------------------------------------------------------- corpo
  let linhaDaCompra: number | null = null;
  // A linha da COMPRA fica no rodapé, e as fórmulas da coluna da moeda
  // apontam para ela: reservamos o número agora e escrevemos no fim.
  if (internacional && compra) {
    linhaDaCompra = null; // definido no rodapé, antes das fórmulas serem lidas
  }

  escreverFaixas();
  escreverCabecalho();

  // Para o resumo do fim: as linhas de SUB-TOTAL e as de grupo de cada
  // orçamento, que é o que as fórmulas do total somam.
  const subtotaisDasSecoes: Record<string, number[]> = {};
  const gruposDoArquivo: number[] = [];
  const guardarSubtotais = (linhas: Record<string, number>) => {
    for (const [letra, linha] of Object.entries(linhas)) {
      (subtotaisDasSecoes[letra] ??= []).push(linha);
    }
  };

  for (const secao of dados.secoes) {
    if (secao.titulo !== undefined) {
      escreverTitulo(
        secao.titulo,
        [
          secao.orcamentoId ? `${MARCA_ORCAMENTO}${secao.orcamentoId}` : "",
          secao.versaoId ? `${MARCA_VERSAO}${secao.versaoId}` : "",
        ]
          .filter(Boolean)
          .join("|"),
        AZUL_ORCADO,
      );
    }

    if (dados.modelo === "mensal" && secao.meses) {
      const subtotaisDosMeses: Record<string, number[]> = {};
      const gruposDoTrimestre: number[] = [];
      secao.meses.forEach((mes, i) => {
        escreverTitulo(
          rotuloMes(mes.mes).toUpperCase(),
          `${MARCA_MES}${mes.mes}`,
          CINZA_MES,
        );
        escreverFaixas();
        escreverCabecalho();
        const linhasDeGrupo: number[] = [];
        const primeira = ws.rowCount + 1;
        for (const grupo of mes.grupos) {
          const g = escreverGrupo(grupo);
          linhasDeGrupo.push(g.linhaDoGrupo);
          fecharGrupo(g);
        }
        const ultima = ws.rowCount;
        const fechamentoDoMes = secao.fechamentoDoMes?.[i];
        if (fechamentoDoMes) {
          const res = escreverFechamento(fechamentoDoMes, {
            rotuloValorDoJob: `VALOR DO JOB DE ${nomeDoMes(mes.mes).toUpperCase()}`,
            conteudo: linhasDeGrupo.length > 0 ? { de: primeira, ate: ultima } : null,
            linhasDeGrupo,
          });
          for (const [letra, linha] of Object.entries(res.linhasSubtotal)) {
            (subtotaisDosMeses[letra] ??= []).push(linha);
          }
        }
        gruposDoTrimestre.push(...linhasDeGrupo);
        ws.addRow([]);
      });

      escreverTitulo("RESUMO DO TRIMESTRE", `${MARCA_RESUMO}trimestre`, CINZA_MES);
      escreverFaixas();
      guardarSubtotais(
        escreverFechamento(secao.fechamento, {
          rotuloValorDoJob: "VALOR DO JOB DO TRIMESTRE",
          subtotaisPorLinhas: subtotaisDosMeses,
          linhasDeGrupo: gruposDoTrimestre,
        }).linhasSubtotal,
      );
      gruposDoArquivo.push(...gruposDoTrimestre);
      continue;
    }

    const linhasDeGrupo: number[] = [];
    const primeira = ws.rowCount + 1;
    for (const grupo of secao.grupos ?? []) {
      const g = escreverGrupo(grupo);
      linhasDeGrupo.push(g.linhaDoGrupo);
      fecharGrupo(g);
    }
    const ultima = ws.rowCount;
    ws.addRow([]);
    guardarSubtotais(
      escreverFechamento(secao.fechamento, {
        rotuloValorDoJob: "VALOR DO JOB",
        conteudo: linhasDeGrupo.length > 0 ? { de: primeira, ate: ultima } : null,
        linhasDeGrupo,
      }).linhasSubtotal,
    );
    gruposDoArquivo.push(...linhasDeGrupo);
  }

  // ---- resumo do arquivo: só com mais de um orçamento
  if (dados.fechamentoTotal && dados.secoes.length > 1) {
    ws.addRow([]);
    escreverTitulo("RESUMO", `${MARCA_RESUMO}arquivo`, CINZA_MES);
    escreverFaixas();
    escreverFechamento(dados.fechamentoTotal, {
      rotuloValorDoJob: "VALOR DO JOB TOTAL",
      subtotaisPorLinhas: subtotaisDasSecoes,
      linhasDeGrupo: gruposDoArquivo,
    });
  }

  // ---- rodapé do câmbio (internacional)
  if (internacional) {
    ws.addRow([]);
    const legenda = ws.addRow([]);
    legenda.getCell(6).value = dados.moeda ?? "USD";
    legenda.getCell(7).value = "BRL";
    for (const col of [6, 7]) {
      pintar(legenda.getCell(col), {
        fundo: AZUL_ORCADO,
        negrito: true,
        cor: WHITE,
        horizontal: "center",
      });
    }
    ws.addRow([]);
    if (dados.cambio?.cotacao) {
      const r = ws.addRow([
        `${dados.cambio.nomeDaMoeda} ${dataCurta(dados.cambio.data)}`.trim(),
        dados.cambio.cotacao,
      ]);
      pintar(r.getCell(2), { formato: "0.0000", horizontal: "right" });
    }
    const rCompra = ws.addRow(["COMPRA", compra ?? ""]);
    pintar(rCompra.getCell(2), { formato: "0.0000", horizontal: "right" });
    linhaDaCompra = rCompra.number;
    if (dados.cambio?.venda) {
      const r = ws.addRow(["VENDA", dados.cambio.venda]);
      pintar(r.getCell(2), { formato: "0.0000", horizontal: "right" });
    }
    // As fórmulas da coluna da moeda foram escritas com a linha da compra
    // ainda desconhecida: agora que ela existe, elas são reescritas.
    corrigirReferenciaDaCompra(ws, rCompra.number);
  }

  return ws;

  function fecharGrupo(g: LinhasDoGrupo) {
    const { linhaDoGrupo, linhasDeItem } = g;
    if (linhasDeItem.length === 0) return;
    const colTt = internacional ? 7 : 6;
    const somaDe = (col: number) =>
      linhasDeItem.map((r) => `${colunaLetra(col)}${r}`).join("+");
    definirFormula(
      ws,
      linhaDoGrupo,
      colTt,
      somaDe(colTt),
      somaDasCelulas(ws, linhasDeItem, colTt),
    );
    definirFormula(
      ws,
      linhaDoGrupo,
      COL_PLAN_TT,
      somaDe(COL_PLAN_TT),
      somaDasCelulas(ws, linhasDeItem, COL_PLAN_TT),
    );
    definirFormula(
      ws,
      linhaDoGrupo,
      COL_PLAN_RENTAB,
      somaDe(COL_PLAN_RENTAB),
      somaDasCelulas(ws, linhasDeItem, COL_PLAN_RENTAB),
    );
    if (comRealizado) {
      definirFormula(
        ws,
        linhaDoGrupo,
        COL_REAL_TT,
        somaDe(COL_REAL_TT),
        somaDasCelulas(ws, linhasDeItem, COL_REAL_TT),
      );
      definirFormula(
        ws,
        linhaDoGrupo,
        COL_REAL_RENTAB,
        somaDe(COL_REAL_RENTAB),
        somaDasCelulas(ws, linhasDeItem, COL_REAL_RENTAB),
      );
    }
    if (internacional && compra) {
      definirFormula(
        ws,
        linhaDoGrupo,
        3,
        `G${linhaDoGrupo}/$B$${linhaDaCompra ?? 1}`,
        somaDasCelulas(ws, linhasDeItem, 7) / compra,
      );
    }
  }
}

/** O valor em cache de uma soma de células — o ExcelJS não recalcula. */
function somaDasCelulas(
  ws: ExcelJS.Worksheet,
  linhas: number[],
  col: number,
): number {
  let total = 0;
  for (const r of linhas) {
    const v = ws.getCell(r, col).value as
      | number
      | { result?: number }
      | null
      | undefined;
    if (typeof v === "number") total += v;
    else if (v && typeof v === "object" && typeof v.result === "number") total += v.result;
  }
  return total;
}

/**
 * Reescreve `$B$1` pela linha real da COMPRA nas fórmulas da coluna da
 * moeda. Elas são escritas enquanto o rodapé ainda não existe, e é aqui
 * que passam a apontar para a célula certa.
 */
function corrigirReferenciaDaCompra(ws: ExcelJS.Worksheet, linha: number) {
  ws.eachRow((row) => {
    row.eachCell((cell) => {
      const v = cell.value as { formula?: string; result?: number } | null;
      if (v && typeof v === "object" && typeof v.formula === "string" && v.formula.includes("$B$1")) {
        cell.value = {
          formula: v.formula.replace(/\$B\$1(?![0-9])/g, `$B$${linha}`),
          result: v.result,
        };
      }
    });
  });
}
