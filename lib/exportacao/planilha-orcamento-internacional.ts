import type ExcelJS from "exceljs";
import {
  calcularTotaisVersao,
  type ParametrosInternacionais,
} from "@/lib/calculos/versao-totais";
import {
  AZUL_IDENT,
  AZUL_ORCADO,
  COLUNA_CONSUMIDO,
  COLUNA_ID,
  MARCA_GRUPO,
  MARCA_ITEM,
  MARCA_ORCAMENTO,
  MARCA_VERSAO,
  nomeDeAbaSeguro,
  type SecaoDaAba,
} from "./planilha-orcamento";

/**
 * A planilha do orçamento INTERNACIONAL que vai para o cliente (decisão
 * 072, 14/09/2026).
 *
 * **O layout é o da planilha que a California já usa** ("Modelo de
 * planilha interna - Internacional 2026.xlsx", bloco ORÇADO), por decisão
 * do Tiago — colunas, ordem e rótulos:
 *
 *   A SHEET · B ITEM · C TT <moeda> · D BRL · E QT · F D/M · G TT BRL
 *
 * e o fechamento em C..E (rótulo), F (moeda) e G (BRL): TOTAL, FEE,
 * INT TAXES, TOTAL RECEBIDO EXTERIOR, INT TRANSACTION COSTS, BRAZILIAN
 * TAXES e INVOICING; uma linha "USD · BRL" em amarelo embaixo, e o câmbio
 * (cotação com a data, COMPRA, VENDA) no rodapé, em A/B.
 *
 * O que ficou da exportação nacional, e por quê:
 * - **Sem coluna TIPO nem SUB-TOTAL por tipo** — o modelo não tem, e o
 *   tipo continua gravado no ERP.
 * - **"(−) PAGO COM CRÉDITO DE SALDO ANTERIOR" só quando houver crédito**,
 *   entre o TOTAL e o FEE: sem ela o TOTAL não fecha à vista com o
 *   INVOICING. Sem save, a planilha é a do modelo.
 * - **Ids ocultos nas colunas H e I**, nas mesmas posições da nacional.
 *   Não aparecem, e são o que a importação vai precisar para casar cada
 *   linha de volta.
 * - **O fechamento é o lado `cliente`** de `calcularTotaisVersao`, como na
 *   nacional (decisão 041): linha em save entra, crédito sai.
 *
 * **A coluna da moeda é o TT BRL ÷ COMPRA** da linha — a mesma conta da
 * tela da versão (`moeda-estrangeira.ts`). Sem taxa de compra gravada, a
 * coluna fica vazia em vez de dividir por zero.
 *
 * **Fórmulas.** TT BRL, subtotais, TOTAL, crédito, a coluna da moeda e o
 * INVOICING são sempre fórmula. FEE, INT TAXES, TOTAL RECEBIDO EXTERIOR e
 * BRAZILIAN TAXES só viram fórmula quando a conta do modelo é EXATAMENTE a
 * do ERP: todos os itens entram em fee, impostos e valor do job (sem a
 * coluna TIPO não há como a fórmula saber quais ficam de fora) e as taxas
 * são as mesmas em todas as seções. Fora disso saem como valor calculado
 * pelo ERP — um número certo parado é melhor que uma fórmula errada viva.
 */

// Tons do modelo, um por parte (decisão 088): o amarelo do INVOICING e da
// linha USD · BRL e o creme da cotação saíram a pedido do Tiago em
// 17/09/2026 — o destaque do fechamento já vem do negrito e da faixa.
const AZUL = AZUL_ORCADO;
const BRANCO = "FFFFFFFF";
const PRETO = "FF000000";
const BORDA: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFCCCCCC" } },
  bottom: { style: "thin", color: { argb: "FFCCCCCC" } },
  left: { style: "thin", color: { argb: "FFCCCCCC" } },
  right: { style: "thin", color: { argb: "FFCCCCCC" } },
};

/** Os formatos da planilha modelo. */
const FORMATO_BRL = "[$R$ -416]#,##0.00";
const FORMATO_TAXA = "0.0000";

export interface SecaoDaAbaInternacional extends SecaoDaAba {
  /** Os parâmetros da cadeia internacional desta versão. */
  internacional: ParametrosInternacionais;
}

/** O câmbio do arquivo. Um só: a exportação de vários orçamentos recusa
 *  moeda ou compra diferentes antes de chegar aqui. */
export interface CambioDaAba {
  /** Código ISO — "USD", "GBP". */
  moeda: string;
  /** Taxa de COMPRA, a que converte. `null` sem câmbio gravado. */
  compra: number | null;
  /** Cotação do dia, a VENDA e a data da cotação: só registro no rodapé.
   *  `null` quando a versão não tem, ou quando os orçamentos do arquivo
   *  divergem nelas — melhor sem a linha do que com a de um só deles. */
  cotacao: number | null;
  venda: number | null;
  /** `yyyy-mm-dd`. */
  data: string | null;
}

export interface DadosDaAbaInternacional {
  /** Faixa azul da linha 1 (A1:G1). */
  nome: string;
  cambio: CambioDaAba;
  secoes: SecaoDaAbaInternacional[];
}

type NumeroDoBanco = number | string | null | undefined;

function numeroOuNull(v: NumeroDoBanco): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** O câmbio de UMA versão, como o arquivo o recebe. Moeda vazia cai em
 *  USD, que é a moeda com que toda versão internacional nasce. */
export function cambioDaVersao(v: {
  moeda_estrangeira: string | null;
  cambio_compra: NumeroDoBanco;
  cambio_cotacao: NumeroDoBanco;
  cambio_venda: NumeroDoBanco;
  cambio_data: string | null;
}): CambioDaAba {
  return {
    moeda: (v.moeda_estrangeira ?? "").trim().toUpperCase() || "USD",
    compra: numeroOuNull(v.cambio_compra),
    cotacao: numeroOuNull(v.cambio_cotacao),
    venda: numeroOuNull(v.cambio_venda),
    data: v.cambio_data,
  };
}

/** O câmbio de VÁRIAS versões que já têm a mesma moeda e a mesma compra.
 *  O que não for igual em todas fica `null`. */
export function cambioComum(cambios: CambioDaAba[]): CambioDaAba {
  const [primeiro] = cambios;
  const igual = <K extends keyof CambioDaAba>(k: K): CambioDaAba[K] | null =>
    cambios.every((c) => c[k] === primeiro[k]) ? primeiro[k] : null;
  return {
    moeda: primeiro.moeda,
    compra: primeiro.compra,
    cotacao: igual("cotacao"),
    venda: igual("venda"),
    data: igual("data"),
  };
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

/** Como o rodapé do modelo chama a cotação: "Dolar 02/06/26", "Libra 10/09". */
export function nomeDaMoeda(codigo: string): string {
  switch (codigo) {
    case "USD":
      return "Dólar";
    case "GBP":
      return "Libra";
    case "EUR":
      return "Euro";
    default:
      return codigo;
  }
}

/** `2026-06-02` → `02/06/26`, sem passar por fuso. */
function dataCurta(iso: string | null): string {
  if (!iso) return "";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return a && m && d ? `${d}/${m}/${a.slice(2)}` : "";
}

/** Percentual como o Excel lê: ponto decimal, sem zeros à direita. */
function numeroExcel(n: number): string {
  return String(Number(n.toFixed(6)));
}

/** A mesma guarda da exportação nacional sobre a taxa do gross-up. */
function taxaDe(percentual: number): number {
  return Math.max(0, Math.min(0.9999, percentual / 100));
}

function definirFormula(
  ws: ExcelJS.Worksheet,
  ref: string,
  formula: string,
  result: number,
) {
  ws.getCell(ref).value = { formula, result };
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
  },
) {
  if (opcoes.fundo) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opcoes.fundo } };
  }
  cell.font = {
    name: "Calibri",
    size: opcoes.tamanho ?? 11,
    bold: opcoes.negrito ?? false,
    color: { argb: opcoes.cor ?? PRETO },
  };
  if (opcoes.formato) cell.numFmt = opcoes.formato;
  cell.alignment = { vertical: "middle", horizontal: opcoes.horizontal };
  cell.border = BORDA;
}

/** Tolerância de "é a mesma base" — meio centavo. */
const MESMO_VALOR = 0.005;

/**
 * Escreve a aba internacional no workbook e a devolve. Mesma assinatura da
 * nacional (`adicionarAbaOrcamento`), para as rotas só escolherem qual.
 */
export function adicionarAbaOrcamentoInternacional(
  wb: ExcelJS.Workbook,
  nomeAba: string,
  dados: DadosDaAbaInternacional,
  opcoes: { formulas?: boolean } = {},
): ExcelJS.Worksheet {
  const formulas = opcoes.formulas === true;
  const { cambio } = dados;
  const compra = cambio.compra !== null && cambio.compra > 0 ? cambio.compra : null;
  const formatoMoeda = formatoDaMoeda(cambio.moeda);

  const ws = wb.addWorksheet(nomeDeAbaSeguro(nomeAba), {
    views: [{ state: "frozen", ySplit: 2 }],
  });

  ws.columns = [
    { header: "", key: "sheet", width: 32 }, // A · grupo
    { header: "", key: "item", width: 52 }, // B · descrição
    { header: "", key: "ttMoeda", width: 16 }, // C · total na moeda
    { header: "", key: "brl", width: 16 }, // D · valor unitário BRL
    { header: "", key: "qt", width: 8 }, // E
    { header: "", key: "dm", width: 8 }, // F
    { header: "", key: "ttBrl", width: 18 }, // G · total BRL
    { header: "", key: "id", width: 2 }, // H · id oculto
    { header: "", key: "consumido", width: 2 }, // I · crédito consumido, oculto
  ];
  ws.getColumn(COLUNA_ID).hidden = true;
  ws.getColumn(COLUNA_CONSUMIDO).hidden = true;

  // Células da moeda: preenchidas no fim, quando a linha da COMPRA existe.
  const celulasDaMoeda: { linha: number; coluna: "C" | "F"; brl: number }[] = [];

  // -------- Linha 1: nome --------
  // A faixa do nome é a identificação da planilha, e usa o tom das colunas
  // PLANILHA e ITEM. A internacional do cliente segue sem "Cliente:" e sem
  // a linha ORÇAMENTO, como a decisão 072 definiu.
  ws.getRow(1).values = [dados.nome, "", "", "", "", "", ""];
  ws.mergeCells("A1:G1");
  ws.getRow(1).height = 22;
  pintar(ws.getCell("A1"), { fundo: AZUL_IDENT, negrito: true, cor: BRANCO, tamanho: 12 });
  const unica = dados.secoes.length === 1 ? dados.secoes[0] : null;
  if (unica && unica.titulo === undefined && unica.orcamentoId) {
    ws.getCell(1, COLUNA_ID).value = [
      `${MARCA_ORCAMENTO}${unica.orcamentoId}`,
      unica.versaoId ? `${MARCA_VERSAO}${unica.versaoId}` : "",
    ]
      .filter(Boolean)
      .join("|");
  }

  // -------- Linha 2: cabeçalho das colunas --------
  const header = ws.getRow(2);
  header.values = ["SHEET", "ITEM", `TT ${cambio.moeda}`, "BRL", "QT", "D/M", "TT BRL"];
  header.height = 20;
  for (let col = 1; col <= 7; col++) {
    pintar(header.getCell(col), {
      fundo: col <= 2 ? AZUL_IDENT : AZUL,
      negrito: true,
      cor: BRANCO,
      horizontal: col <= 2 ? "left" : "center",
    });
  }

  // -------- Seções, grupos e itens --------
  const todasAsLinhasDeGrupo: number[] = [];
  let primeiraLinha: number | null = null;
  let ultimaLinha: number | null = null;

  for (const secao of dados.secoes) {
    const linhasDeGrupo: number[] = [];
    let subtotalSecao = 0;
    let linhaDaSecao: number | null = null;

    if (secao.titulo !== undefined) {
      const marcasSecao = [
        secao.orcamentoId ? `${MARCA_ORCAMENTO}${secao.orcamentoId}` : "",
        secao.versaoId ? `${MARCA_VERSAO}${secao.versaoId}` : "",
      ]
        .filter(Boolean)
        .join("|");
      const sRow = ws.addRow([secao.titulo, "", null, "", "", "", 0, marcasSecao]);
      sRow.height = 22;
      for (let col = 1; col <= 7; col++) {
        pintar(sRow.getCell(col), {
          fundo: AZUL,
          negrito: true,
          cor: BRANCO,
          formato: col === 3 ? formatoMoeda : col === 7 ? FORMATO_BRL : undefined,
          horizontal: col === 3 || col === 7 ? "right" : undefined,
        });
      }
      linhaDaSecao = sRow.number;
      primeiraLinha ??= sRow.number;
      ultimaLinha = sRow.number;
    }

    for (const grupo of secao.grupos) {
      const subtotalGrupo = grupo.itens.reduce((s, i) => s + i.total_orcado, 0);
      subtotalSecao += subtotalGrupo;

      const gRow = ws.addRow([
        grupo.nome,
        "",
        null,
        "",
        "",
        "",
        subtotalGrupo,
        grupo.id ? `${MARCA_GRUPO}${grupo.id}` : "",
      ]);
      gRow.height = 20;
      for (let col = 1; col <= 7; col++) {
        pintar(gRow.getCell(col), {
          fundo: col <= 2 ? AZUL_IDENT : AZUL,
          negrito: true,
          cor: BRANCO,
          formato: col === 3 ? formatoMoeda : col === 7 ? FORMATO_BRL : undefined,
          horizontal: col === 3 || col === 7 ? "right" : undefined,
        });
      }
      celulasDaMoeda.push({ linha: gRow.number, coluna: "C", brl: subtotalGrupo });
      linhasDeGrupo.push(gRow.number);
      todasAsLinhasDeGrupo.push(gRow.number);
      primeiraLinha ??= gRow.number;
      ultimaLinha = gRow.number;

      const primeiroItem = gRow.number + 1;
      for (const it of grupo.itens) {
        const row = ws.addRow([
          // A coluna A repete o grupo em cada item (decisão 088).
          grupo.nome,
          it.item,
          null,
          it.valor_unitario_orcado,
          it.quantidade_orcada,
          it.dias_meses_orcado,
          it.total_orcado,
          it.id ? `${MARCA_ITEM}${it.id}` : "",
          // Mesma guarda da nacional: consumo nem passa do total nem é
          // negativo, e linha em save não consome.
          it.em_save
            ? 0
            : Math.min(Math.max(Number(it.save_consumido ?? 0), 0), it.total_orcado),
        ]);
        row.height = 18;
        for (let col = 1; col <= 7; col++) {
          pintar(row.getCell(col), {
            tamanho: 10,
            formato: col === 3 ? formatoMoeda : col === 4 || col === 7 ? FORMATO_BRL : undefined,
            horizontal:
              col === 3 || col === 4 || col === 7
                ? "right"
                : col === 5 || col === 6
                  ? "center"
                  : undefined,
          });
        }
        if (formulas) {
          const r = row.number;
          definirFormula(ws, `G${r}`, `D${r}*E${r}*F${r}`, it.total_orcado);
        }
        celulasDaMoeda.push({ linha: row.number, coluna: "C", brl: it.total_orcado });
        ultimaLinha = row.number;
      }

      if (formulas && grupo.itens.length > 0) {
        const ultimoItem = primeiroItem + grupo.itens.length - 1;
        definirFormula(
          ws,
          `G${gRow.number}`,
          `SUM(G${primeiroItem}:G${ultimoItem})`,
          subtotalGrupo,
        );
      }
    }

    if (linhaDaSecao !== null) {
      if (formulas && linhasDeGrupo.length > 0) {
        definirFormula(
          ws,
          `G${linhaDaSecao}`,
          linhasDeGrupo.map((r) => `G${r}`).join("+"),
          subtotalSecao,
        );
      } else {
        ws.getCell(`G${linhaDaSecao}`).value = subtotalSecao;
      }
      celulasDaMoeda.push({ linha: linhaDaSecao, coluna: "C", brl: subtotalSecao });
    }
  }

  // -------- Fechamento --------
  // Cada seção fecha pela sua cadeia e o arquivo soma — como a nacional e
  // a visão agregada. O lado `cliente` (decisão 041).
  let subtotalGeral = 0;
  let creditoUsado = 0;
  let fee = 0;
  let intTaxes = 0;
  let recebidoExterior = 0;
  let itc = 0;
  let impostoBr = 0;
  let invoicing = 0;
  // A conta do modelo (FEE = TOTAL × %, INT TAXES e BRAZILIAN TAXES em
  // gross-up sobre a linha de cima) só é a do ERP quando TODO o líquido do
  // TOTAL entra em fee, impostos e valor do job.
  let cadeiaDoModelo = true;
  for (const secao of dados.secoes) {
    const t = calcularTotaisVersao(
      secao.grupos.flatMap((g) => g.itens),
      Number(secao.percentualHonorarios ?? 0),
      Number(secao.percentualImposto ?? 0),
      secao.internacional,
    );
    const c = t.cliente;
    const liquido = t.subtotalGeral - t.save.totalSaveUsado;
    const baseImpostoDosTipos = c.baseIntTaxes - c.honorarios;
    if (
      Math.abs(c.baseHonorarios - liquido) > MESMO_VALOR ||
      Math.abs(c.principal - liquido) > MESMO_VALOR ||
      Math.abs(baseImpostoDosTipos - liquido) > MESMO_VALOR
    ) {
      cadeiaDoModelo = false;
    }
    subtotalGeral += t.subtotalGeral;
    creditoUsado += t.save.totalSaveUsado;
    fee += c.honorarios;
    intTaxes += c.intTaxes;
    recebidoExterior += c.principal + c.honorarios + c.intTaxes;
    itc += c.intTransactionCosts;
    impostoBr += c.imposto;
    invoicing += c.total;
  }
  const temCredito = creditoUsado > 0;

  const unicoPercentual = (valores: number[]) =>
    new Set(valores.map((v) => numeroExcel(v))).size <= 1;
  const pctFee = dados.secoes.map((s) => Number(s.percentualHonorarios ?? 0));
  const pctIntTaxes = dados.secoes.map((s) => s.internacional.percentualIntTaxes);
  const pctImposto = dados.secoes.map((s) => Number(s.percentualImposto ?? 0));
  const formulasDaCadeia =
    formulas &&
    cadeiaDoModelo &&
    unicoPercentual(pctFee) &&
    unicoPercentual(pctIntTaxes) &&
    unicoPercentual(pctImposto);

  ws.addRow([]);

  type Chave =
    | "total"
    | "credito"
    | "fee"
    | "intTaxes"
    | "recebido"
    | "itc"
    | "impostoBr"
    | "invoicing";
  const linhasDoFechamento: { chave: Chave; rotulo: string; valor: number }[] = [
    { chave: "total", rotulo: "TOTAL", valor: subtotalGeral },
    ...(temCredito
      ? [
          {
            chave: "credito" as const,
            rotulo: "(−) PAGO COM CRÉDITO DE SALDO ANTERIOR",
            valor: -creditoUsado,
          },
        ]
      : []),
    { chave: "fee", rotulo: "FEE", valor: fee },
    { chave: "intTaxes", rotulo: "INT TAXES", valor: intTaxes },
    { chave: "recebido", rotulo: "TOTAL RECEBIDO EXTERIOR", valor: recebidoExterior },
    { chave: "itc", rotulo: "INT TRANSACTION COSTS", valor: itc },
    { chave: "impostoBr", rotulo: "BRAZILIAN TAXES", valor: impostoBr },
    { chave: "invoicing", rotulo: "INVOICING", valor: invoicing },
  ];

  const linha = {} as Record<Chave, number>;
  for (const l of linhasDoFechamento) {
    const row = ws.addRow(["", "", l.rotulo, "", "", null, l.valor]);
    row.height = 20;
    ws.mergeCells(`A${row.number}:B${row.number}`);
    ws.mergeCells(`C${row.number}:E${row.number}`);
    pintar(row.getCell(1), { fundo: AZUL_IDENT });
    pintar(row.getCell(3), { fundo: AZUL, negrito: true, cor: BRANCO, horizontal: "left" });
    pintar(row.getCell(6), {
      fundo: AZUL,
      negrito: true,
      cor: BRANCO,
      formato: formatoMoeda,
      horizontal: "right",
    });
    pintar(row.getCell(7), {
      fundo: AZUL,
      negrito: true,
      cor: BRANCO,
      formato: FORMATO_BRL,
      horizontal: "right",
    });
    celulasDaMoeda.push({ linha: row.number, coluna: "F", brl: l.valor });
    linha[l.chave] = row.number;
  }

  // Só as duas células da legenda ficam pintadas, como o Tiago pediu em
  // 17/09/2026 — o resto da linha fica limpo.
  const legenda = ws.addRow(["", "", "", "", "", cambio.moeda, "BRL"]);
  for (const col of [6, 7]) {
    pintar(legenda.getCell(col), {
      fundo: AZUL,
      negrito: true,
      cor: BRANCO,
      horizontal: "center",
    });
  }

  // -------- Câmbio --------
  ws.addRow([]);
  if (cambio.cotacao !== null) {
    const r = ws.addRow([`${nomeDaMoeda(cambio.moeda)} ${dataCurta(cambio.data)}`.trim(), cambio.cotacao]);
    pintar(r.getCell(1), {});
    pintar(r.getCell(2), { formato: FORMATO_TAXA, horizontal: "right" });
  }
  const linhaCompra = ws.addRow(["COMPRA", compra ?? ""]);
  pintar(linhaCompra.getCell(1), {});
  pintar(linhaCompra.getCell(2), { formato: FORMATO_TAXA, horizontal: "right" });
  if (cambio.venda !== null) {
    const r = ws.addRow(["VENDA", cambio.venda]);
    pintar(r.getCell(1), {});
    pintar(r.getCell(2), { formato: FORMATO_TAXA, horizontal: "right" });
  }

  // -------- A coluna da moeda --------
  if (compra !== null) {
    for (const c of celulasDaMoeda) {
      const ref = `${c.coluna}${c.linha}`;
      if (formulas) {
        definirFormula(ws, ref, `G${c.linha}/$B$${linhaCompra.number}`, c.brl / compra);
      } else {
        ws.getCell(ref).value = c.brl / compra;
      }
    }
  }

  // -------- Fórmulas do fechamento --------
  if (formulas) {
    if (todasAsLinhasDeGrupo.length > 0) {
      definirFormula(
        ws,
        `G${linha.total}`,
        todasAsLinhasDeGrupo.map((r) => `G${r}`).join("+"),
        subtotalGeral,
      );
    }
    if (temCredito && primeiraLinha !== null && ultimaLinha !== null) {
      definirFormula(
        ws,
        `G${linha.credito}`,
        `-SUM($I$${primeiraLinha}:$I$${ultimaLinha})`,
        -creditoUsado,
      );
    }

    if (formulasDaCadeia) {
      const liquido = temCredito
        ? `(G${linha.total}+G${linha.credito})`
        : `G${linha.total}`;
      const tIntTaxes = numeroExcel(taxaDe(pctIntTaxes[0] ?? 0));
      const tImposto = numeroExcel(taxaDe(pctImposto[0] ?? 0));
      definirFormula(
        ws,
        `G${linha.fee}`,
        `${liquido}*${numeroExcel(pctFee[0] ?? 0)}/100`,
        fee,
      );
      definirFormula(
        ws,
        `G${linha.intTaxes}`,
        `(${liquido}+G${linha.fee})*${tIntTaxes}/(1-${tIntTaxes})`,
        intTaxes,
      );
      // Com a linha de crédito entre o TOTAL e o FEE a soma já sai líquida.
      definirFormula(
        ws,
        `G${linha.recebido}`,
        `SUM(G${linha.total}:G${linha.intTaxes})`,
        recebidoExterior,
      );
      definirFormula(
        ws,
        `G${linha.impostoBr}`,
        `G${linha.recebido}*${tImposto}/(1-${tImposto})`,
        impostoBr,
      );
    }

    definirFormula(
      ws,
      `G${linha.invoicing}`,
      `SUM(G${linha.recebido}:G${linha.impostoBr})`,
      invoicing,
    );
  }

  return ws;
}
