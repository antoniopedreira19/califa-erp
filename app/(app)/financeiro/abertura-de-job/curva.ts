/**
 * Curva de desembolso: em que datas o custo previsto do job sai do caixa.
 *
 * Funções puras, compartilhadas entre o formulário (client) e a Server
 * Action (server). A ação NÃO confia na conta do navegador — refaz a
 * soma daqui com o custo previsto lido do banco.
 *
 * Datas circulam sempre como `yyyy-mm-dd` e a aritmética usa UTC, para
 * o dia não escorregar conforme o fuso de quem executa.
 */

import { TOLERANCIA_CURVA } from "@/lib/validations/abertura-financeiro";

export interface CurvaLinha {
  /** Só para a key do React — não vai para o banco. */
  id: string;
  data: string;
  valor: number;
}

const DIA_MS = 86_400_000;

export function isoParaUtc(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const [ano, mes, dia] = iso.slice(0, 10).split("-").map(Number);
  if (!ano || !mes || !dia) return null;
  const ms = Date.UTC(ano, mes - 1, dia);
  return Number.isNaN(ms) ? null : ms;
}

export function utcParaIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

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
 * Curva sugerida: parcelas iguais, espaçadas entre o início e o fim do
 * job. Sem período no job, cai para intervalos de 30 dias a partir de
 * hoje — melhor que não sugerir nada e deixar o campo vazio.
 */
export function sugerirCurva(
  total: number,
  inicio: string | null | undefined,
  fim: string | null | undefined,
  hojeIso: string,
): CurvaLinha[] {
  const n = quantasParcelas(total);
  const valores = dividirEmParcelas(total, n);

  const inicioMs = isoParaUtc(inicio) ?? isoParaUtc(hojeIso) ?? Date.now();
  const fimMs = isoParaUtc(fim) ?? inicioMs + n * 30 * DIA_MS;
  const span = Math.max(fimMs - inicioMs, 0);

  return valores.map((valor, i) => ({
    id: `curva-${i + 1}`,
    // i+1 sobre n+1 distribui as datas DENTRO do período, sem colar a
    // primeira no início nem a última no fim do job.
    data: utcParaIso(inicioMs + Math.round((span * (i + 1)) / (n + 1))),
    valor,
  }));
}

/** Próxima data sugerida ao clicar em "Adicionar data": 15 dias depois. */
export function proximaDataSugerida(
  linhas: CurvaLinha[],
  inicio: string | null | undefined,
  hojeIso: string,
): string {
  const ultima = linhas[linhas.length - 1];
  const baseMs =
    isoParaUtc(ultima?.data) ?? isoParaUtc(inicio) ?? isoParaUtc(hojeIso)!;
  return utcParaIso(baseMs + 15 * DIA_MS);
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
