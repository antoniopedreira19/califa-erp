import type ExcelJS from "exceljs";
import { nomeDoMes, rotuloMes } from "@/lib/calculos/meses-trimestre";
import {
  BLACK,
  BLUE_GROUP,
  BLUE_HEADER,
  BORDER,
  COLUNA_ID,
  escreverFechamento,
  escreverGrupos,
  escreverTituloDeSecao,
  FORMATO_MOEDA,
  MARCA_MES,
  MARCA_RESUMO,
  marcasDaSecao,
  prepararAbaOrcamento,
  WHITE,
  type GrupoDaAba,
  type OpcoesDaAba,
} from "./planilha-orcamento";

/**
 * A planilha do orçamento mensal — Fee e Always On (decisão 078).
 *
 * O layout do nacional (PLANILHA, ITEM, R$, QT, D/M, TT, tipo e os ids
 * ocultos), com uma diferença pedida pelo Tiago em 15/09/2026: **cada mês é
 * um bloco com o seu fechamento**, até o "FATURAMENTO DE OUTUBRO" — o valor
 * que o envio daquele mês leva para o financeiro, como na aba SUL da
 * planilha interna. No fim, o **resumo do trimestre** lista o faturamento
 * de cada mês e soma.
 *
 * Várias seções (exportação do projeto) só com outros mensais, e cada
 * orçamento pode ser de um trimestre: cada seção traz os seus meses, e o
 * resumo nomeia o orçamento de cada linha.
 *
 * Marcas na coluna oculta H: `orc:|v:` no título da seção (ou na linha 1 da
 * versão única), `mes:2026-10-01` no título do mês, `grp:` e `it:` como no
 * nacional, e `resumo:` no título do resumo — onde a leitura termina.
 */

export interface MesDaAba {
  /** Primeiro dia do mês, `YYYY-MM-01`. */
  mes: string;
  grupos: GrupoDaAba[];
}

export interface SecaoDaAbaMensal {
  /** Título da seção; ausente na versão única. */
  titulo?: string;
  /** Como o orçamento aparece no resumo quando há mais de uma seção. */
  rotuloNoResumo?: string;
  orcamentoId?: string;
  versaoId?: string;
  percentualHonorarios: number;
  percentualImposto: number;
  meses: MesDaAba[];
}

export interface DadosDaAbaMensal {
  identificacao: string;
  clienteNome: string;
  titulo: string;
  secoes: SecaoDaAbaMensal[];
}

/** Os meses da versão com os seus grupos, na ordem do calendário. Grupo sem
 *  mês não entra — num orçamento mensal ele não deveria existir. */
export function mesesDaVersaoParaAba<G extends GrupoDaAba & { mesId: string | null }>(
  meses: { id: string; mes: string }[],
  grupos: G[],
): MesDaAba[] {
  return [...meses]
    .sort((a, b) => a.mes.localeCompare(b.mes))
    .map((m) => ({
      mes: m.mes,
      grupos: grupos
        .filter((g) => g.mesId === m.id)
        .map(({ id, nome, itens }) => ({ id, nome, itens })),
    }));
}

function pintarLinha(
  row: ExcelJS.Row,
  { escura, negrito }: { escura: boolean; negrito: boolean },
) {
  row.height = 20;
  for (let col = 1; col <= 7; col++) {
    const cell = row.getCell(col);
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: escura ? BLUE_HEADER : BLUE_GROUP },
    };
    cell.border = BORDER;
    cell.font = {
      name: "Calibri",
      size: 11,
      bold: negrito,
      color: { argb: escura ? WHITE : BLACK },
    };
    cell.alignment =
      col === 5 || col === 6
        ? { horizontal: "right", vertical: "middle" }
        : { vertical: "middle" };
    if (col === 6) cell.numFmt = FORMATO_MOEDA;
  }
}

export function adicionarAbaOrcamentoMensal(
  wb: ExcelJS.Workbook,
  nomeAba: string,
  dados: DadosDaAbaMensal,
  opcoes: OpcoesDaAba = {},
): ExcelJS.Worksheet {
  const formulas = opcoes.formulas === true;
  const F = "F";

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

  const variasSecoes = dados.secoes.length > 1;
  const resumo: { rotulo: string; linha: number; valor: number }[] = [];

  for (const secao of dados.secoes) {
    const tituloDaSecao =
      secao.titulo !== undefined
        ? escreverTituloDeSecao(ws, secao.titulo, marcasDaSecao(secao))
        : null;
    const faturamentosDaSecao: { linha: number; valor: number }[] = [];

    const meses = [...secao.meses].sort((a, b) => a.mes.localeCompare(b.mes));
    for (const mes of meses) {
      const tituloDoMes = escreverTituloDeSecao(
        ws,
        rotuloMes(mes.mes).toUpperCase(),
        `${MARCA_MES}${mes.mes}`,
      );
      // O título do mês não mostra valor: o faturamento dele está no
      // fechamento logo abaixo.
      ws.getCell(tituloDoMes.number, 6).value = null;

      const r = escreverGrupos(ws, mes.grupos, formulas);
      const ultima = r.ultima ?? tituloDoMes.number;
      const fechamento = escreverFechamento(ws, {
        secoes: [
          {
            grupos: mes.grupos,
            percentualHonorarios: secao.percentualHonorarios,
            percentualImposto: secao.percentualImposto,
          },
        ],
        faixas: [
          {
            de: tituloDoMes.number,
            ate: ultima,
            percentualHonorarios: Number(secao.percentualHonorarios ?? 0),
            percentualImposto: Number(secao.percentualImposto ?? 0),
          },
        ],
        conteudo: r.primeira !== null ? { de: tituloDoMes.number, ate: ultima } : null,
        formulas,
        rotuloFaturamento: `FATURAMENTO DE ${nomeDoMes(mes.mes).toUpperCase()}`,
      });
      ws.addRow([]);

      faturamentosDaSecao.push({
        linha: fechamento.linhaFaturamento,
        valor: fechamento.faturamento,
      });
      resumo.push({
        rotulo:
          variasSecoes && secao.rotuloNoResumo
            ? `${secao.rotuloNoResumo} · ${rotuloMes(mes.mes)}`
            : rotuloMes(mes.mes),
        linha: fechamento.linhaFaturamento,
        valor: fechamento.faturamento,
      });
    }

    // O título da seção mostra o faturamento do orçamento: a soma dos meses.
    if (tituloDaSecao) {
      const total = faturamentosDaSecao.reduce((s, f) => s + f.valor, 0);
      const ref = ws.getCell(tituloDaSecao.number, 6);
      ref.value =
        formulas && faturamentosDaSecao.length > 0
          ? {
              formula: faturamentosDaSecao.map((f) => `${F}${f.linha}`).join("+"),
              result: total,
            }
          : total;
    }
  }

  // -------- Resumo --------
  const tituloResumo = ws.addRow([
    variasSecoes ? "RESUMO" : "RESUMO DO TRIMESTRE",
    "",
    "",
    "",
    "",
    "",
    "",
  ]);
  ws.getCell(tituloResumo.number, COLUNA_ID).value = `${MARCA_RESUMO}trimestre`;
  pintarLinha(tituloResumo, { escura: true, negrito: true });

  for (const linha of resumo) {
    const row = ws.addRow(["", "", "", "", linha.rotulo, linha.valor, ""]);
    pintarLinha(row, { escura: false, negrito: false });
    if (formulas) {
      row.getCell(6).value = { formula: `${F}${linha.linha}`, result: linha.valor };
    }
  }

  const total = resumo.reduce((s, l) => s + l.valor, 0);
  const totalRow = ws.addRow([
    "",
    "",
    "",
    "",
    variasSecoes ? "FATURAMENTO TOTAL" : "FATURAMENTO DO TRIMESTRE",
    total,
    "",
  ]);
  pintarLinha(totalRow, { escura: true, negrito: true });
  if (formulas && resumo.length > 0) {
    totalRow.getCell(6).value = {
      formula: resumo.map((l) => `${F}${l.linha}`).join("+"),
      result: total,
    };
  }

  return ws;
}
