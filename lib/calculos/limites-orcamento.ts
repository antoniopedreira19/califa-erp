import type { AppRole } from "@/lib/types";

/** Valores monetários já são de centavos; a folga evita ruído binário. */
export function acimaDoOrcado(custo: number, orcado: number): boolean {
  return custo - orcado > 0.005;
}

/**
 * Resultado geral é percentual sobre o valor do job, antes de formatar.
 * O vermelho das telas segue os 20% da decisão 204; o mínimo que leva a
 * versão ao Comitê é o das regras (`RegrasDoComite.resultadoMinimo`).
 */
export function rentabilidadeAbaixoDoMinimo(resultadoGeral: number | null, minimo = 20): boolean {
  return resultadoGeral !== null && resultadoGeral < minimo - 1e-9;
}

/**
 * As regras do Comitê de Aprovações (decisão 223), espelho de
 * `public.comite_config`. Sem linha no banco, valem os padrões, que
 * reproduzem a decisão 204: resultado mínimo de 20%, planejado e realizado
 * acima do orçado, linha vermelha fora, sem tolerância e o administrador
 * aprovando direto na tela.
 */
export interface RegrasDoComite {
  resultadoLigado: boolean;
  resultadoMinimo: number;
  planejadoLigado: boolean;
  ppLigado: boolean;
  linhasVermelhas: boolean;
  toleranciaLigada: boolean;
  toleranciaValor: number;
  toleranciaPct: number;
  adminDireto: boolean;
}

export const REGRAS_PADRAO_DO_COMITE: RegrasDoComite = {
  resultadoLigado: true,
  resultadoMinimo: 20,
  planejadoLigado: true,
  ppLigado: true,
  linhasVermelhas: false,
  toleranciaLigada: false,
  toleranciaValor: 0,
  toleranciaPct: 0,
  adminDireto: true,
};

/** Formato do Resultado geral do cabeçalho da versão: uma casa, vírgula. */
export function formatarPercentualDoComite(n: number): string {
  return `${(Math.round(n * 10) / 10).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

/** O retrato da versão que o Comitê aprovou (`comite_pedidos.snapshot`). */
export interface RetratoDaVersao {
  itensAcima: number;
  resultadoGeral: number | null;
}

/**
 * Os motivos que levam a versão ao Comitê, em frases para a barra e o
 * pedido. Vazio quando nenhuma regra ligada pega. O serviço Interno
 * (decisão 105) fica fora: só tem F · Interno, e o resultado geral é
 * sempre 0%.
 */
export function motivosDaVersaoNoComite(
  regras: RegrasDoComite,
  retrato: RetratoDaVersao,
  interno: boolean,
): string[] {
  if (interno) return [];
  const motivos: string[] = [];
  if (regras.planejadoLigado && retrato.itensAcima > 0) {
    motivos.push(
      retrato.itensAcima === 1
        ? "há 1 item com planejado acima do orçado"
        : `há ${retrato.itensAcima} itens com planejado acima do orçado`,
    );
  }
  if (regras.resultadoLigado && rentabilidadeAbaixoDoMinimo(retrato.resultadoGeral, regras.resultadoMinimo)) {
    motivos.push(
      `o resultado geral está em ${formatarPercentualDoComite(retrato.resultadoGeral!)}, abaixo do mínimo de ${formatarPercentualDoComite(regras.resultadoMinimo)}`,
    );
  }
  return motivos;
}

/**
 * Volta ao Comitê só se piorar (Tiago, 27/10/2026): o último pedido
 * aprovado do orçamento cobre a versão enquanto ela não tiver mais itens
 * com planejado acima do orçado nem Resultado geral menor.
 */
export function versaoCobertaPeloComite(aprovado: RetratoDaVersao | null, atual: RetratoDaVersao): boolean {
  if (!aprovado) return false;
  if (atual.itensAcima > aprovado.itensAcima) return false;
  if (atual.resultadoGeral === null || aprovado.resultadoGeral === null) return true;
  return atual.resultadoGeral >= aprovado.resultadoGeral - 1e-9;
}

/** Quem aprova direto na tela, sem o Comitê. */
export function aprovaDiretoSemComite(papel: AppRole, regras: RegrasDoComite): boolean {
  return papel === "administrador" && regras.adminDireto;
}

/**
 * A PP precisa do Comitê? O realizado acumulado do item, com esta PP,
 * passa do orçado — fora a linha vermelha (orçado zero por definição),
 * que só vai com a regra dela ligada, e o excesso pequeno, quando a
 * tolerância está ligada e ele fica abaixo dos dois limites.
 */
export function ppPassaDoOrcadoNoComite(
  regras: RegrasDoComite,
  realizadoComAPP: number,
  orcado: number,
  linhaVermelha: boolean,
): boolean {
  if (!regras.ppLigado) return false;
  if (linhaVermelha && !regras.linhasVermelhas) return false;
  const excesso = Math.round((realizadoComAPP - orcado) * 100) / 100;
  if (excesso <= 0.005) return false;
  if (
    regras.toleranciaLigada &&
    excesso <= regras.toleranciaValor + 0.005 &&
    excesso <= (orcado * regras.toleranciaPct) / 100 + 0.005
  ) {
    return false;
  }
  return true;
}

/** Volta ao Comitê só se a PP ficar mais cara que o valor aprovado. */
export function ppCobertaPeloComite(valorAprovado: number | null, valor: number): boolean {
  return valorAprovado !== null && valorAprovado >= valor - 0.005;
}

/**
 * A recusa da geração ou edição da PP sem o Comitê. `null` libera: quem
 * aprova direto, a regra que não pega ou a aprovação do Comitê que cobre o
 * valor. Mesma conta do gatilho `pp_confere_orcado_na_geracao`.
 */
export function bloqueioGeracaoPPPeloComite(args: {
  papel: AppRole;
  regras: RegrasDoComite;
  realizadoComAPP: number;
  orcado: number;
  linhaVermelha: boolean;
  valor: number;
  valorAprovado: number | null;
}): string | null {
  if (aprovaDiretoSemComite(args.papel, args.regras)) return null;
  if (!ppPassaDoOrcadoNoComite(args.regras, args.realizadoComAPP, args.orcado, args.linhaVermelha)) return null;
  if (ppCobertaPeloComite(args.valorAprovado, args.valor)) return null;
  return "Esta PP precisa da aprovação do Comitê de Aprovações: o realizado acumulado do item ultrapassa o orçado. Salve a PP a emitir e solicite a aprovação.";
}
