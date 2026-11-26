import { lancamentoEnviavel } from "./lancamento-enviavel";
import type { FolhaMin, NfMin } from "./lancamento-enviavel";

export function hintAprovado(
  lancamentoId: string,
  folhas: FolhaMin[],
  nfs: NfMin[],
): string {
  const resultado = lancamentoEnviavel(lancamentoId, folhas, nfs);
  if (resultado.ok) return "Pronto pra enviar ao financeiro.";

  const faltaRecibo = resultado.falta.some((f) => f.startsWith("Recibo"));
  const faltaNf = resultado.falta.some((f) => f.startsWith("NF"));

  if (faltaRecibo && faltaNf) {
    return "Aguardando RH anexar recibo e colaborador anexar NF.";
  }
  if (faltaRecibo) return "Aguardando RH anexar o recibo da contabilidade.";
  if (faltaNf) return "Aguardando colaborador anexar a NF.";

  return "Aguardando documentos.";
}
