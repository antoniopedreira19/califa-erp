import type { DadosDosImpostos } from "./dados";

/** ESQUELETO (entrega 2 do fiscal): o agente de Impostos a Pagar substitui. */
export function AbaImpostos({ dados }: { dados: DadosDosImpostos }) {
  void dados;
  return <p className="text-sm text-muted-foreground">Os Impostos a Pagar entram nesta aba.</p>;
}
