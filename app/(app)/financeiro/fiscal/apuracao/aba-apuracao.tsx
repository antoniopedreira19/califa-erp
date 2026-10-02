import type { DadosDaApuracao } from "./dados";

/** ESQUELETO (entrega 2 do fiscal): o agente da Apuração substitui. */
export function AbaApuracao({ dados }: { dados: DadosDaApuracao }) {
  void dados;
  return <p className="text-sm text-muted-foreground">A Apuração entra nesta aba.</p>;
}
