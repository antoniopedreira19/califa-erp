/**
 * Que parte de uma previsão do job já foi consumida — e por isso não
 * pode mais ser mexida na edição do registro da abertura.
 *
 * ---------------------------------------------------------------------
 * A regra (Tiago, 20/08/2026)
 * ---------------------------------------------------------------------
 *
 * "Sempre consumir o saldo da parcela mais próxima, e a lógica permanece
 * a mesma. Só será congelado o que for consumido, e só será consumido o
 * saldo da parcela mais próxima."
 *
 * Ou seja: o consumo anda em ordem de data, da parcela mais próxima para
 * a mais distante, e para exatamente onde o total consumido acaba. A
 * parcela que ficar no meio do caminho PARTE em duas — a fatia consumida
 * (congelada) e o resto (livre). Congelar a parcela inteira travaria
 * dinheiro que ninguém gastou.
 *
 * `pedidos_compra` não tem coluna apontando para a linha da curva, e
 * `titulos_receber` não aponta para a parcela de recebimento: o vínculo
 * é sempre por TOTAL consumido, e a distribuição é derivada aqui. Por
 * isso este cálculo mora num lugar só — a tela desenha as linhas
 * travadas com ele, e a Server Action valida com ele. Duas implementações
 * dessa regra divergiriam no primeiro centavo.
 *
 * Vale igual para a curva de custo (consumo = PPs emitidas) e para a
 * previsão de recebimento (consumo = notas emitidas).
 */

/** Centavos, para a soma não escorregar em float. */
function centavos(n: number): number {
  return Math.round(n * 100);
}

export interface LinhaPrevisao {
  data_prevista: string;
  valor: number;
}

export interface LinhaPrevisaoSplit extends LinhaPrevisao {
  /** true = já consumida por PP/nota. Data e valor não podem mudar. */
  congelada: boolean;
}

/**
 * Reparte a previsão guardada em linhas congeladas e linhas livres.
 *
 * As linhas entram em ordem de data (a mais próxima primeiro) e o
 * consumo é aplicado nessa ordem. A linha que o consumo alcança pela
 * metade vira DUAS linhas na mesma data: a fatia congelada e o resto.
 *
 * A soma das congeladas é sempre `min(consumido, total da previsão)`.
 */
export function repartirPrevisao(
  linhas: LinhaPrevisao[],
  consumido: number,
): LinhaPrevisaoSplit[] {
  const ordenadas = [...linhas].sort((a, b) =>
    a.data_prevista.localeCompare(b.data_prevista),
  );

  let restante = Math.max(0, centavos(consumido));
  const saida: LinhaPrevisaoSplit[] = [];

  for (const linha of ordenadas) {
    const valor = centavos(linha.valor);

    if (restante <= 0) {
      saida.push({ ...linha, congelada: false });
      continue;
    }

    if (valor <= restante) {
      // Consumo cobre a linha inteira.
      saida.push({ ...linha, congelada: true });
      restante -= valor;
      continue;
    }

    // Consumo para no meio desta linha: parte em congelada + livre.
    saida.push({
      data_prevista: linha.data_prevista,
      valor: restante / 100,
      congelada: true,
    });
    saida.push({
      data_prevista: linha.data_prevista,
      valor: (valor - restante) / 100,
      congelada: false,
    });
    restante = 0;
  }

  return saida;
}

/** Só a parte congelada, na ordem em que ela precisa aparecer. */
export function parteCongelada(
  linhas: LinhaPrevisao[],
  consumido: number,
): LinhaPrevisao[] {
  return repartirPrevisao(linhas, consumido)
    .filter((l) => l.congelada)
    .map(({ data_prevista, valor }) => ({ data_prevista, valor }));
}

/**
 * A previsão editada respeita o que já foi consumido?
 *
 * Aplica o MESMO caminhamento na previsão que chegou do formulário e
 * compara a fatia congelada dela com a fatia congelada da previsão
 * guardada. Se as duas batem — mesmas datas, mesmos valores, mesma ordem
 * — nada do que já foi gasto mudou de lugar, e o resto era saldo livre.
 *
 * Não confere o total: quem faz isso é `curvaFecha`, que já roda na
 * abertura e continua rodando na edição.
 */
export function edicaoRespeitaConsumido(
  guardada: LinhaPrevisao[],
  editada: LinhaPrevisao[],
  consumido: number,
): boolean {
  if (consumido <= 0) return true;

  const antes = parteCongelada(guardada, consumido);
  const depois = parteCongelada(editada, consumido);

  if (antes.length !== depois.length) return false;

  return antes.every(
    (l, i) =>
      l.data_prevista === depois[i].data_prevista &&
      centavos(l.valor) === centavos(depois[i].valor),
  );
}
