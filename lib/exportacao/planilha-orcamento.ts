import type ExcelJS from "exceljs";
import {
  calcularTotaisVersao,
  REGRAS_TIPO_CUSTO,
  TIPOS_CUSTO,
  type RegraTipoCusto,
} from "@/lib/calculos/versao-totais";
import type { TipoCusto } from "@/lib/types";

/**
 * A aba de orçamento que vai para o cliente — o formato ORÇADO, no
 * modelo da planilha oficial da agência.
 *
 * Nasceu dentro da rota de exportação da versão
 * (`app/api/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/export`) e
 * saiu de lá em 03/09/2026, quando a página do projeto e a visão agregada
 * ganharam a exportação de VÁRIOS orçamentos num arquivo só: uma aba por
 * orçamento, cada aba idêntica à exportação de orçamento único. Ter o
 * gerador num lugar é o que garante o "idêntica" — as duas rotas montam o
 * workbook e chamam isto para cada aba.
 *
 * O bloco de totais é o lado BRUTO do fechamento (decisão 028): a planilha
 * do cliente mostra o orçamento como foi fechado, sem a mecânica interna
 * do save. Em orçamento sem save é exatamente a conta de sempre.
 *
 * Com `formulas: true` as células calculadas — TT de cada item, subtotal
 * de grupo, SUB-TOTAL por tipo, TOTAL, IMPOSTO, HONORÁRIOS e
 * FATURAMENTO — saem como fórmula do Excel, com o resultado já calculado
 * gravado como valor em cache. O cache importa: quem lê o arquivo sem
 * recalcular (o nosso próprio parser de importação, por exemplo) enxerga
 * o número, e o Excel recalcula ao abrir de qualquer forma. As fórmulas
 * seguem a mesma matriz `REGRAS_TIPO_CUSTO` do fechamento — os tipos que
 * entram em cada linha são derivados dela, não escritos à mão.
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

export interface ItemDaAba {
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
  nome: string;
  itens: ItemDaAba[];
}

export interface DadosDaAba {
  /** Código do orçamento — vai na célula A1 com o nome. */
  codigo: string;
  /** Nome do job (orcamentos.nome). */
  nome: string;
  clienteNome: string;
  /** Título da versão, como `nomeVersao()` produz. Célula C1. */
  tituloVersao: string;
  percentualHonorarios: number;
  percentualImposto: number;
  grupos: GrupoDaAba[];
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

/** Referências `F12+F15+F18` das linhas de SUB-TOTAL dos tipos em que a
 *  alavanca está ligada. Vazio quando nenhum tipo liga a alavanca. */
function somaDasLinhasDeTipo(
  linhaDoTipo: Record<TipoCusto, number>,
  alavanca: keyof RegraTipoCusto,
  coluna: string,
): string {
  return TIPOS_CUSTO.filter((t) => REGRAS_TIPO_CUSTO[t][alavanca])
    .map((t) => `${coluna}${linhaDoTipo[t]}`)
    .join("+");
}

type ValorOuFormula = number | { formula: string; result: number };

/**
 * Escreve uma aba completa no workbook e a devolve.
 *
 * O layout (A..G) é o da planilha oficial: PLANILHA, ITEM, R$, QT, D/M,
 * TT e o tipo de custo. Três linhas de cabeçalho congeladas, um bloco por
 * grupo, e o fechamento no fim.
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

  // Larguras (A..G)
  ws.columns = [
    { header: "", key: "planilha", width: 32 }, // A · nome do grupo
    { header: "", key: "item", width: 52 }, // B · descrição do item
    { header: "", key: "rs", width: 15 }, // C · valor unitário
    { header: "", key: "qt", width: 8 }, // D · qtd
    { header: "", key: "dm", width: 8 }, // E · dias/mês
    { header: "", key: "tt", width: 16 }, // F · total
    { header: "", key: "tipo", width: 6 }, // G · tipo A/B/C/D
  ];

  // -------- Linha 1: cabeçalho de identificação do orçamento --------
  ws.getRow(1).values = [
    `${dados.codigo} · ${dados.nome}`,
    `Cliente: ${dados.clienteNome}`,
    dados.tituloVersao,
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

  // -------- Linhas dos grupos + itens --------
  // Faixa de linhas com conteúdo, para as fórmulas de SUB-TOTAL por tipo:
  // da primeira linha de grupo à última linha de item. As linhas de grupo
  // têm a coluna do tipo vazia, então o SUMIF só pega item.
  let primeiraLinhaDeConteudo: number | null = null;
  let ultimaLinhaDeConteudo: number | null = null;

  for (const grupo of dados.grupos) {
    const subtotalGrupo = grupo.itens.reduce((s, i) => s + i.total_orcado, 0);

    // Linha do grupo — o subtotal vira fórmula depois, quando as linhas
    // dos itens já existem e dá para saber a faixa.
    const gRow = ws.addRow([grupo.nome, "", "", "", "", subtotalGrupo, ""]);
    gRow.height = 20;
    gRow.eachCell((cell, col) => {
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
    });
    primeiraLinhaDeConteudo ??= gRow.number;
    ultimaLinhaDeConteudo = gRow.number;

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
      ]);
      row.height = 18;
      row.eachCell((cell, col) => {
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
      });
      if (formulas) {
        const r = row.number;
        row.getCell(6).value = {
          formula: `C${r}*D${r}*E${r}`,
          result: it.total_orcado,
        };
      }
      ultimaLinhaDeConteudo = row.number;
    }

    if (formulas && grupo.itens.length > 0) {
      const ultimoItem = primeiroItem + grupo.itens.length - 1;
      gRow.getCell(6).value = {
        formula: `SUM(F${primeiroItem}:F${ultimoItem})`,
        result: subtotalGrupo,
      };
    }
  }

  // -------- Bloco de totais no final --------
  const honorPct = Number(dados.percentualHonorarios ?? 0);
  const impPct = Number(dados.percentualImposto ?? 0);
  // A planilha enviada ao cliente segue mostrando só o VALOR DO JOB, no
  // rótulo FATURAMENTO que ela sempre teve: é o total que o cliente se
  // compromete a gastar. A quebra entre o que a California emite nota e o
  // que ele paga direto ao fornecedor é leitura interna (decisão do Tiago
  // em 11/08/2026) e não entra neste arquivo.
  //
  // O lado BRUTO, e não o do job: a planilha do cliente mostra o orçamento
  // como ele foi fechado, sem a mecânica interna do save. Num orçamento
  // com linhas em save o "valor do job" desce (elas saem do valor do job)
  // e o arquivo sairia com um TOTAL de itens que não bate com o
  // FATURAMENTO logo abaixo — no orçamento de save inteiro sairia zerado.
  // `bruto` roda a MESMA conta sobre o total orçado cheio, então em
  // qualquer orçamento sem save o arquivo é byte a byte o de sempre.
  const itensParaTotais = dados.grupos.flatMap((g) => g.itens);
  const { subtotaisPorTipo, subtotalGeral, bruto } = calcularTotaisVersao(
    itensParaTotais,
    honorPct,
    impPct,
  );
  const honorarios = bruto.honorarios;
  const imposto = bruto.imposto;
  const valorJob = bruto.total;

  // 1 linha vazia
  ws.addRow([]);

  // As linhas do fechamento são escritas em duas passadas: primeiro os
  // valores (que já decidem a linha de cada uma), depois as fórmulas —
  // IMPOSTO referencia HONORÁRIOS, que vem abaixo dele.
  type LinhaResumo = {
    chave: "tipo" | "total" | "imposto" | "honorarios" | "faturamento";
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
    { chave: "imposto", label: "IMPOSTO", value: imposto },
    {
      chave: "honorarios",
      label: `HONORÁRIOS ${honorPct.toString().replace(".", ",")}%`,
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
  let linhaImposto = 0;
  let linhaHonorarios = 0;
  let linhaFaturamento = 0;

  for (const r of summaryRows) {
    const row = ws.addRow(["", "", "", "", r.label, r.value, r.tipo ?? ""]);
    row.height = 20;
    row.eachCell((cell, col) => {
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
    });

    switch (r.chave) {
      case "tipo":
        linhaDoTipo[r.tipo!] = row.number;
        break;
      case "total":
        linhaTotal = row.number;
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
    const F = letra(6);
    const G = letra(7);
    const temConteudo =
      primeiraLinhaDeConteudo !== null && ultimaLinhaDeConteudo !== null;

    const definir = (linha: number, formula: string, result: number) => {
      ws.getCell(`${F}${linha}`).value = { formula, result } as ValorOuFormula;
    };

    // SUB-TOTAL por tipo: soma dos TT cujo tipo (coluna G) é a letra.
    for (const t of TIPOS_CUSTO) {
      if (!temConteudo) continue;
      const faixaTipo = `$${G}$${primeiraLinhaDeConteudo}:$${G}$${ultimaLinhaDeConteudo}`;
      const faixaTT = `$${F}$${primeiraLinhaDeConteudo}:$${F}$${ultimaLinhaDeConteudo}`;
      definir(
        linhaDoTipo[t],
        `SUMIF(${faixaTipo},"${t}",${faixaTT})`,
        subtotaisPorTipo[t],
      );
    }

    // TOTAL: soma dos SUB-TOTAIS.
    const primeiroSub = linhaDoTipo[TIPOS_CUSTO[0]];
    const ultimoSub = linhaDoTipo[TIPOS_CUSTO[TIPOS_CUSTO.length - 1]];
    definir(linhaTotal, `SUM(${F}${primeiroSub}:${F}${ultimoSub})`, subtotalGeral);

    // HONORÁRIOS: % sobre os tipos com a alavanca `honorarios`.
    const baseHonorarios = somaDasLinhasDeTipo(linhaDoTipo, "honorarios", F);
    if (baseHonorarios) {
      definir(
        linhaHonorarios,
        `(${baseHonorarios})*${honorPct}/100`,
        honorarios,
      );
    }

    // IMPOSTO: gross-up sobre (tipos com a alavanca `imposto` + honorários).
    // Mesma conta de `fecharLado`: base × taxa ÷ (1 − taxa).
    const taxa = Math.max(0, Math.min(0.9999, impPct / 100));
    const baseImposto = somaDasLinhasDeTipo(linhaDoTipo, "imposto", F);
    if (taxa > 0) {
      const partes = [baseImposto, `${F}${linhaHonorarios}`].filter(Boolean);
      definir(
        linhaImposto,
        `(${partes.join("+")})*${taxa}/(1-${taxa})`,
        imposto,
      );
    }

    // FATURAMENTO: principal (alavanca `valorJob`) + honorários + imposto.
    const principal = somaDasLinhasDeTipo(linhaDoTipo, "valorJob", F);
    const partesFat = [
      principal,
      `${F}${linhaHonorarios}`,
      `${F}${linhaImposto}`,
    ].filter(Boolean);
    definir(linhaFaturamento, partesFat.join("+"), valorJob);
  }

  return ws;
}
