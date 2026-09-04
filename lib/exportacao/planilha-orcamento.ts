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

// Paleta California pra bater visualmente com o app.
const BLUE_HEADER = "FF4A7CB8"; // azul da linha de header do template
const BLUE_GROUP = "FF9BB8DE"; // azul claro dos grupos e subtotais
const WHITE = "FFFFFFFF";
const BLACK = "FF000000";
const BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFCCCCCC" } },
  bottom: { style: "thin", color: { argb: "FFCCCCCC" } },
  left: { style: "thin", color: { argb: "FFCCCCCC" } },
  right: { style: "thin", color: { argb: "FFCCCCCC" } },
};

const FORMATO_MOEDA = '"R$" #,##0.00';

/** Coluna escondida com o id da linha. */
export const COLUNA_ID = 8; // H
/** Coluna escondida com o quanto da linha é pago com crédito de save de
 *  outro job — a base da linha "(−) pago com crédito" do fechamento. */
export const COLUNA_CONSUMIDO = 9; // I
export const MARCA_ORCAMENTO = "orc:";
export const MARCA_VERSAO = "v:";
export const MARCA_GRUPO = "grp:";
export const MARCA_ITEM = "it:";

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

/** `F12+F15+F18` — as linhas de SUB-TOTAL dos tipos com a alavanca. Com
 *  crédito consumido na planilha cada parcela vira `(F12-SUMIF(…))`, a
 *  base líquida do tipo. */
function somaDosSubtotais(
  linhaDoTipo: Record<TipoCusto, number>,
  alavanca: keyof RegraTipoCusto,
  credito: Faixa | null,
): string {
  return tiposCom(alavanca)
    .map((t) =>
      credito
        ? `(${F}${linhaDoTipo[t]}-${consumidoDoTipo(credito, t)})`
        : `${F}${linhaDoTipo[t]}`,
    )
    .join("+");
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
  ws.getRow(1).values = [
    dados.identificacao,
    `Cliente: ${dados.clienteNome}`,
    dados.titulo,
    "",
    "",
    "",
    "",
  ];
  ws.mergeCells("A1:B1");
  ws.mergeCells("C1:G1");
  ws.getRow(1).height = 22;
  ws.getRow(1).eachCell((cell) => {
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: BLACK } };
    cell.alignment = { vertical: "middle" };
  });
  // Exportação de versão única: a seção não tem linha de título, então
  // os ids do orçamento e da versão vão na coluna oculta da linha 1 — é
  // de lá que a importação do projeto os lê.
  const unica = dados.secoes.length === 1 ? dados.secoes[0] : null;
  if (unica && unica.titulo === undefined && unica.orcamentoId) {
    ws.getCell(1, COLUNA_ID).value = [
      `${MARCA_ORCAMENTO}${unica.orcamentoId}`,
      unica.versaoId ? `${MARCA_VERSAO}${unica.versaoId}` : "",
    ]
      .filter(Boolean)
      .join("|");
  }

  // -------- Linha 2: título "ORÇAMENTO" merged em C..F --------
  ws.getRow(2).values = ["", "", "ORÇAMENTO", "", "", "", ""];
  ws.mergeCells("C2:F2");
  ws.getRow(2).height = 20;
  const cellOrc = ws.getCell("C2");
  cellOrc.alignment = { horizontal: "center", vertical: "middle" };
  cellOrc.font = { name: "Calibri", size: 12, bold: true, color: { argb: WHITE } };
  cellOrc.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: BLUE_HEADER },
  };

  // -------- Linha 3: header das colunas --------
  const header = ws.getRow(3);
  header.values = ["PLANILHA", "ITEM", "R$", "QT", "D/M", "TT", ""];
  header.height = 20;
  header.eachCell((cell, col) => {
    cell.font = {
      name: "Calibri",
      size: 11,
      bold: true,
      color: { argb: col >= 3 && col <= 7 ? WHITE : BLACK },
    };
    cell.alignment = { vertical: "middle", horizontal: col === 1 || col === 2 ? "left" : "center" };
    if (col >= 3 && col <= 7) {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: BLUE_HEADER },
      };
    }
    cell.border = BORDER;
  });

  // -------- Seções, grupos e itens --------
  // Faixa com conteúdo (da primeira linha de seção/grupo à última linha
  // de item), para as fórmulas do fechamento. As linhas de seção e de
  // grupo têm a coluna do tipo vazia, então o SUMIF só pega item.
  let primeiraLinha: number | null = null;
  let ultimaLinha: number | null = null;

  interface FaixaDaSecao {
    de: number;
    ate: number;
    percentualHonorarios: number;
    percentualImposto: number;
  }
  const faixas: FaixaDaSecao[] = [];

  for (const secao of dados.secoes) {
    const inicioSecao = ws.rowCount + 1;
    const linhasDeGrupo: number[] = [];
    let subtotalSecao = 0;

    if (secao.titulo !== undefined) {
      const marcas = [
        secao.orcamentoId ? `${MARCA_ORCAMENTO}${secao.orcamentoId}` : "",
        secao.versaoId ? `${MARCA_VERSAO}${secao.versaoId}` : "",
      ]
        .filter(Boolean)
        .join("|");
      const sRow = ws.addRow([secao.titulo, "", "", "", "", 0, "", marcas]);
      sRow.height = 22;
      for (let col = 1; col <= 7; col++) {
        const cell = sRow.getCell(col);
        cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: WHITE } };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: BLUE_HEADER },
        };
        cell.border = BORDER;
        cell.alignment =
          col === 6
            ? { horizontal: "right", vertical: "middle" }
            : { vertical: "middle" };
        if (col === 6) cell.numFmt = FORMATO_MOEDA;
      }
      primeiraLinha ??= sRow.number;
      ultimaLinha = sRow.number;
    }

    for (const grupo of secao.grupos) {
      const subtotalGrupo = grupo.itens.reduce((s, i) => s + i.total_orcado, 0);
      subtotalSecao += subtotalGrupo;

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
        cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: BLACK } };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: BLUE_GROUP },
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
      primeiraLinha ??= gRow.number;
      ultimaLinha = gRow.number;

      const primeiroItem = gRow.number + 1;
      for (const it of grupo.itens) {
        const row = ws.addRow([
          "",
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
        ultimaLinha = row.number;
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

    if (secao.titulo !== undefined) {
      // Subtotal da seção: a soma das linhas de grupo dela.
      const sRef = `${F}${inicioSecao}`;
      if (formulas && linhasDeGrupo.length > 0) {
        definirFormula(
          ws,
          sRef,
          linhasDeGrupo.map((r) => `${F}${r}`).join("+"),
          subtotalSecao,
        );
      } else {
        ws.getCell(sRef).value = subtotalSecao;
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
  for (const secao of dados.secoes) {
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
    faixas[0]?.percentualHonorarios ?? dados.secoes[0]?.percentualHonorarios ?? 0;
  const impPct =
    faixas[0]?.percentualImposto ?? dados.secoes[0]?.percentualImposto ?? 0;

  // 1 linha vazia
  ws.addRow([]);

  type LinhaResumo = {
    chave: "tipo" | "total" | "credito" | "imposto" | "honorarios" | "faturamento";
    label: string;
    value: number;
    tipo?: TipoCusto;
    bold?: boolean;
    faturamento?: boolean;
  };
  const summaryRows: LinhaResumo[] = [
    ...TIPOS_CUSTO.map<LinhaResumo>((t) => ({
      chave: "tipo",
      label: `SUB-TOTAL ${t}`,
      value: subtotaisPorTipo[t],
      tipo: t,
    })),
    { chave: "total", label: "TOTAL", value: subtotalGeral, bold: true },
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
      // Com taxas diferentes entre os orçamentos não há UM percentual a
      // mostrar — o rótulo fica sem ele, e a fórmula soma parcela a parcela.
      label: honorariosUniforme
        ? `HONORÁRIOS ${honorPct.toString().replace(".", ",")}%`
        : "HONORÁRIOS",
      value: honorarios,
    },
    {
      chave: "faturamento",
      label: "FATURAMENTO",
      value: valorJob,
      bold: true,
      faturamento: true,
    },
  ];

  const linhaDoTipo = {} as Record<TipoCusto, number>;
  let linhaTotal = 0;
  let linhaCredito = 0;
  let linhaImposto = 0;
  let linhaHonorarios = 0;
  let linhaFaturamento = 0;

  for (const r of summaryRows) {
    const row = ws.addRow(["", "", "", "", r.label, r.value, r.tipo ?? ""]);
    row.height = 20;
    for (let col = 1; col <= 7; col++) {
      const cell = row.getCell(col);
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: BLUE_GROUP },
      };
      cell.border = BORDER;
      cell.font = {
        name: "Calibri",
        size: 11,
        bold: r.bold || r.faturamento || false,
        color: { argb: r.faturamento ? WHITE : BLACK },
      };
      if (r.faturamento) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: BLUE_HEADER },
        };
      }
      if (col === 5) {
        cell.alignment = { horizontal: "right", vertical: "middle" };
      } else if (col === 6) {
        cell.alignment = { horizontal: "right", vertical: "middle" };
        cell.numFmt = FORMATO_MOEDA;
      } else if (col === 7) {
        cell.alignment = { horizontal: "center", vertical: "middle" };
      } else {
        cell.alignment = { vertical: "middle" };
      }
    }

    switch (r.chave) {
      case "tipo":
        linhaDoTipo[r.tipo!] = row.number;
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
    const temConteudo = primeiraLinha !== null && ultimaLinha !== null;
    const faixaToda = temConteudo
      ? { de: primeiraLinha!, ate: ultimaLinha! }
      : null;

    // SUB-TOTAL por tipo: soma dos TT cujo tipo (coluna G) é a letra,
    // na planilha inteira.
    if (faixaToda) {
      const tipos = `$${G}$${faixaToda.de}:$${G}$${faixaToda.ate}`;
      const totais = `$${F}$${faixaToda.de}:$${F}$${faixaToda.ate}`;
      for (const t of TIPOS_CUSTO) {
        definirFormula(
          ws,
          `${F}${linhaDoTipo[t]}`,
          `SUMIF(${tipos},"${t}",${totais})`,
          subtotaisPorTipo[t],
        );
      }
    }

    // TOTAL: soma dos SUB-TOTAIS.
    const primeiroSub = linhaDoTipo[TIPOS_CUSTO[0]];
    const ultimoSub = linhaDoTipo[TIPOS_CUSTO[TIPOS_CUSTO.length - 1]];
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
    const baseHonorarios = somaDosSubtotais(linhaDoTipo, "honorarios", credito);
    if (honorariosUniforme) {
      if (baseHonorarios) {
        definirFormula(
          ws,
          `${F}${linhaHonorarios}`,
          `(${baseHonorarios})*${numeroExcel(honorPct)}/100`,
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
          somaDosSubtotais(linhaDoTipo, "imposto", credito),
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
    const principal = somaDosSubtotais(linhaDoTipo, "valorJob", credito);
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

  return ws;
}
