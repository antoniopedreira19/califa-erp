import type ExcelJS from "exceljs";
import { nomeDoMes, rotuloMes } from "@/lib/calculos/meses-trimestre";
import {
  AZUL_IDENT,
  AZUL_ORCADO,
  BORDER,
  CINZA_MES,
  COLUNA_ID,
  escreverFaixa,
  escreverFaixaECabecalho,
  escreverFechamento,
  escreverGrupos,
  escreverTituloDeSecao,
  FORMATO_MOEDA,
  MARCA_MES,
  MARCA_RESUMO,
  marcasDaSecao,
  prepararAbaOrcamento,
  WHITE,
  type FaixaDaSecao,
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


export function adicionarAbaOrcamentoMensal(
  wb: ExcelJS.Workbook,
  nomeAba: string,
  dados: DadosDaAbaMensal,
  opcoes: OpcoesDaAba = {},
): ExcelJS.Worksheet {
  const formulas = opcoes.formulas === true;
  const F = "F";

  const unica = dados.secoes.length === 1 ? dados.secoes[0] : null;
  // A faixa e o cabeçalho não ficam no topo: no mensal eles vêm dentro de
  // cada mês, embaixo da linha do mês (decisão 088, como a aba SUL).
  const ws = prepararAbaOrcamento(
    wb,
    nomeAba,
    {
      identificacao: dados.identificacao,
      clienteNome: dados.clienteNome,
      titulo: dados.titulo,
      marcaDaLinha1:
        unica && unica.titulo === undefined && unica.orcamentoId
          ? marcasDaSecao(unica)
          : undefined,
    },
    false,
  );

  const variasSecoes = dados.secoes.length > 1;
  // O resumo do trimestre soma as linhas de SUB-TOTAL de cada mês, e as
  // taxas de cada mês entram como faixa própria — é o que evita o SUMIF
  // contar duas vezes o fechamento que já existe dentro de cada bloco.
  const faixasDosMeses: FaixaDaSecao[] = [];
  const subtotaisDosMeses: Record<string, number[]> = {};
  let primeiraLinhaDoArquivo: number | null = null;
  let ultimaLinhaDoArquivo: number | null = null;

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
        CINZA_MES,
      );
      // O título do mês não mostra valor: o faturamento dele está no
      // fechamento logo abaixo.
      ws.getCell(tituloDoMes.number, 6).value = null;
      // Faixa e cabeçalho abaixo do mês, como na aba SUL.
      escreverFaixaECabecalho(ws);

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
      faixasDosMeses.push({
        de: tituloDoMes.number,
        ate: ultima,
        percentualHonorarios: Number(secao.percentualHonorarios ?? 0),
        percentualImposto: Number(secao.percentualImposto ?? 0),
      });
      for (const [letra, linha] of Object.entries(fechamento.linhasSubtotal)) {
        (subtotaisDosMeses[letra] ??= []).push(linha);
      }
      primeiraLinhaDoArquivo ??= tituloDoMes.number;
      ultimaLinhaDoArquivo = ultima;
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
  // O resumo fecha por custo, como o card "Totais do trimestre" da tela
  // (decisão 088). As linhas de cada mês saíram: o valor do mês já está no
  // fechamento do próprio bloco.
  const tituloResumo = escreverTituloDeSecao(
    ws,
    variasSecoes ? "RESUMO" : "RESUMO DO TRIMESTRE",
    `${MARCA_RESUMO}trimestre`,
    CINZA_MES,
  );
  ws.getCell(tituloResumo.number, 6).value = null;
  escreverFaixa(ws);

  escreverFechamento(ws, {
    secoes: dados.secoes.map((secao) => ({
      grupos: secao.meses.flatMap((mes) => mes.grupos),
      percentualHonorarios: secao.percentualHonorarios,
      percentualImposto: secao.percentualImposto,
    })),
    faixas: faixasDosMeses,
    conteudo:
      primeiraLinhaDoArquivo !== null && ultimaLinhaDoArquivo !== null
        ? { de: primeiraLinhaDoArquivo, ate: ultimaLinhaDoArquivo }
        : null,
    formulas,
    rotuloFaturamento: variasSecoes
      ? "FATURAMENTO TOTAL"
      : "FATURAMENTO DO TRIMESTRE",
    subtotaisPorLinhas: subtotaisDosMeses,
  });

  return ws;
}
