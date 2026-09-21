/**
 * A coluna "% do valor do job" do bloco "Composto por" — no card de Totais
 * do orçamento e no `PainelResultado` do job e das visões agregadas.
 *
 * Largura fixa e alinhada à direita: as duas linhas do bloco têm valores de
 * tamanhos diferentes, e sem isso as porcentagens não caem uma sob a outra.
 * Sem número (`null`) o espaço continua reservado, para o valor em reais da
 * linha não andar para a direita.
 *
 * Os números vêm de `composicaoDoResultadoGeral`, que já entrega uma casa.
 */
export function PercentualDoJob({ valor }: { valor: number | null }) {
  return (
    <span className="ml-3 inline-block w-[3.25rem] text-right">
      {valor === null ? "" : `${valor.toFixed(1).replace(".", ",")}%`}
    </span>
  );
}
