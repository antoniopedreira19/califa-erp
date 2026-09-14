/**
 * As duas previsões da abertura do job:
 *
 *   * curva de desembolso — em que datas o custo previsto SAI do caixa;
 *   * previsão de recebimento — em que datas o faturamento previsto
 *     ENTRA no caixa (seção no fim do arquivo).
 *
 * Funções puras, compartilhadas entre o formulário (client) e a Server
 * Action (server). A ação NÃO confia na conta do navegador — refaz as
 * somas daqui com os totais lidos do banco.
 *
 * Datas circulam sempre como `yyyy-mm-dd` e a aritmética usa UTC, para
 * o dia não escorregar conforme o fuso de quem executa.
 */

import { TOLERANCIA_CURVA } from "@/lib/validations/abertura-financeiro";
import {
  ehJanelaDePagamento,
  isoParaUtc,
  janelaSeguinte,
  proximaJanelaDePagamento,
  utcParaIso,
} from "@/lib/calculos/janelas-pagamento";

export interface CurvaLinha {
  /** Só para a key do React — não vai para o banco. */
  id: string;
  data: string;
  valor: number;
}

/** Linha da previsão de recebimento. `mes` só existe no job mensal — Fee
 *  e Always On (decisão 078): o mês de referência daquela entrada. */
export interface RecebimentoLinha extends CurvaLinha {
  mes: string | null;
}

const DIA_MS = 86_400_000;

// As datas e as janelas de pagamento moram em `lib/calculos/janelas-pagamento.ts`
// desde 14/09/2026 (decisão 077): o prazo da PP passou a obedecer às mesmas
// janelas, e duas cópias da regra divergiriam na primeira correção. Seguem
// exportadas daqui para quem já importava de `curva`.
export {
  ehJanelaDePagamento,
  isoParaUtc,
  janelaSeguinte,
  proximaJanelaDePagamento,
  utcParaIso,
};

/** Arredonda para centavos — dinheiro nunca circula com cauda binária. */
export function emCentavos(n: number): number {
  return Math.round(n * 100) / 100;
}

export function somaCurva(linhas: { valor: number }[]): number {
  return emCentavos(linhas.reduce((s, l) => s + (l.valor || 0), 0));
}

/** A curva fecha com o total (dentro da tolerância do centavo)? */
export function curvaFecha(linhas: { valor: number }[], total: number): boolean {
  return Math.abs(somaCurva(linhas) - emCentavos(total)) < TOLERANCIA_CURVA;
}

/**
 * Divide o total em n parcelas iguais, jogando a sobra de centavos na
 * última. Sem isso, 3 × R$ 173.323,80 fica R$ 0,01 abaixo do total e a
 * curva nunca fecha.
 */
export function dividirEmParcelas(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = emCentavos(total / n);
  const valores = Array.from({ length: n }, () => base);
  valores[n - 1] = emCentavos(total - base * (n - 1));
  return valores;
}

/** Reaplica a divisão igual mantendo as datas que já estavam na tela. */
export function redistribuirIgualmente(
  linhas: CurvaLinha[],
  total: number,
): CurvaLinha[] {
  const valores = dividirEmParcelas(total, linhas.length);
  return linhas.map((l, i) => ({ ...l, valor: valores[i] ?? 0 }));
}

// ---------- Janelas de pagamento ----------
//
// Dia 08 e dia 20; fim de semana passa para a segunda. A regra (e o aviso
// de que feriado ainda não é tratado) está em `lib/calculos/janelas-pagamento.ts`.

/** Todas as janelas dentro de [inicioIso, fimIso], em ordem. */
function janelasNoPeriodo(inicioIso: string, fimIso: string): string[] {
  const fimMs = isoParaUtc(fimIso);
  if (fimMs === null) return [];
  const janelas: string[] = [];
  let cursor = proximaJanelaDePagamento(inicioIso);
  // 60 janelas = ~2,5 anos de job; backstop contra loop infinito.
  while (janelas.length < 60) {
    const ms = isoParaUtc(cursor);
    if (ms === null || ms > fimMs) break;
    janelas.push(cursor);
    cursor = janelaSeguinte(cursor);
  }
  return janelas;
}

/**
 * Quantas datas sugerir para um custo. Job pequeno sai num pagamento só;
 * job grande espalha. É só um ponto de partida — quem abre edita.
 */
function quantasParcelas(total: number): number {
  if (total < 50_000) return 1;
  if (total < 200_000) return 2;
  return 3;
}

/**
 * Curva sugerida: parcelas iguais, nas janelas de pagamento (08/20) do
 * período do job — espaçadas dentro da lista de janelas disponíveis.
 * Período sem janela nenhuma (job curto entre dois dias de pagamento)
 * cai na primeira janela depois do início. Custo zero não tem curva.
 */
export function sugerirCurva(
  total: number,
  inicio: string | null | undefined,
  fim: string | null | undefined,
  hojeIso: string,
): CurvaLinha[] {
  if (total <= 0) return [];

  const inicioIso = inicio ?? hojeIso;
  const disponiveis = fim ? janelasNoPeriodo(inicioIso, fim) : [];
  // Sem janela no período: a primeira janela viável depois do início.
  if (disponiveis.length === 0) {
    disponiveis.push(proximaJanelaDePagamento(inicioIso));
  }

  const n = Math.min(quantasParcelas(total), disponiveis.length);
  const valores = dividirEmParcelas(total, n);

  // Espalha os índices pela lista de janelas: 1 parcela pega a primeira,
  // 2 pegam primeira e última, 3 pegam primeira, meio e última.
  const indices =
    n === 1
      ? [0]
      : valores.map((_, i) =>
          Math.round((i * (disponiveis.length - 1)) / (n - 1)),
        );

  return valores.map((valor, i) => ({
    id: `curva-${i + 1}`,
    data: disponiveis[indices[i]],
    valor,
  }));
}

/** Ao clicar em "Adicionar data": a janela seguinte à última da curva. */
export function proximaDataSugerida(
  linhas: CurvaLinha[],
  inicio: string | null | undefined,
  hojeIso: string,
): string {
  const ultima = linhas[linhas.length - 1];
  if (ultima?.data) return janelaSeguinte(ultima.data);
  return proximaJanelaDePagamento(inicio ?? hojeIso);
}

// ---------- Previsão de recebimento ----------
//
// Entrada de dinheiro NÃO segue as janelas de pagamento (dias 08 e 20):
// aquelas são o calendário com que a California paga fornecedor. Quem
// manda aqui é o cliente — a primeira parcela nasce da data prevista de
// faturamento que a produção informou no envio do job, e as seguintes
// caem 30 dias depois da anterior, como no protótipo. Tudo editável.

/**
 * Previsão sugerida: uma única parcela com o faturamento previsto
 * inteiro, na data prevista de faturamento. Faturamento previsto zero
 * (job 100% pago direto pelo cliente ao fornecedor) não tem previsão.
 */
export function sugerirRecebimento(
  total: number,
  dataFaturamento: string | null | undefined,
  hojeIso: string,
): RecebimentoLinha[] {
  if (total <= 0) return [];
  return [
    {
      id: "recebimento-1",
      data: (dataFaturamento ?? hojeIso).slice(0, 10),
      valor: emCentavos(total),
      mes: null,
    },
  ];
}

/** Ao clicar em "Adicionar parcela": 30 dias depois da última. */
export function proximaDataRecebimento(
  linhas: CurvaLinha[],
  dataFaturamento: string | null | undefined,
  hojeIso: string,
): string {
  const ultima = linhas[linhas.length - 1];
  const base = isoParaUtc(ultima?.data ?? dataFaturamento ?? hojeIso);
  if (base === null) return hojeIso;
  return utcParaIso(base + 30 * DIA_MS);
}

/** Trimestre (1-4) de uma data ISO. Base da sugestão de competência. */
export function trimestreDe(iso: string): number {
  const mes = Number(iso.slice(5, 7));
  return Math.floor((mes - 1) / 3) + 1;
}

/** A data está fora da competência escolhida? O design sinaliza essas. */
export function foraDaCompetencia(
  dataIso: string,
  trimestre: number,
  ano: number,
): boolean {
  if (!dataIso || dataIso.length < 10) return false;
  const anoData = Number(dataIso.slice(0, 4));
  if (anoData !== ano) return true;
  return trimestreDe(dataIso) !== trimestre;
}

/**
 * A data está fora de TODAS as competências do rateio? Com o job rateado
 * (decisão 055), uma data de previsão só é "fora" quando não cai em
 * nenhum dos trimestres reconhecidos. Lista vazia não marca nada.
 */
export function foraDoRateio(
  dataIso: string,
  competencias: { trimestre: number; ano: number }[],
): boolean {
  if (competencias.length === 0) return false;
  return competencias.every((c) =>
    foraDaCompetencia(dataIso, c.trimestre, c.ano),
  );
}
