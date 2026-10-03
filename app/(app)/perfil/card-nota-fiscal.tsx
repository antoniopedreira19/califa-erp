import { ReceiptText } from "lucide-react";
import { CardBase, EmBreve } from "./card-base";
import type { TipoContratacao } from "@/lib/types";

type Props = {
  tipoContratacao: TipoContratacao;
};

/**
 * Placeholder — fluxo de anexar NF do mês vinculada à folha ainda
 * não existe. Só faz sentido pra PJ e CLT recibo (quem emite NF
 * própria pra pagamento). CLT comum não aparece.
 */
export function CardNotaFiscal({ tipoContratacao }: Props) {
  if (tipoContratacao !== "pj" && tipoContratacao !== "clt_recibo") {
    return null;
  }

  return (
    <CardBase titulo="Nota fiscal do mês" icon={ReceiptText} variante="placeholder">
      <EmBreve texto="Em breve você poderá anexar a NF do mês diretamente aqui, vinculada à folha de pagamento vigente." />
    </CardBase>
  );
}
