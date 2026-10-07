import type { NfJanela } from "@/lib/types";

/**
 * Decide a janela de pagamento de uma NF pela data de upload.
 *
 * Regra: upload com uploadedAt <= dia 25 do mês da competência às 23:59:59.999
 * em America/Sao_Paulo (UTC-3) → janela de salários (dia 03 do mês seguinte).
 * Depois disso → janela de fornecedores (dia 08 do mês seguinte).
 *
 * Spec: docs/superpowers/specs/2026-10-07-folha-anexo-nf.md (D4)
 */
export function janelaDaNf(input: {
  uploadedAt: string;
  competenciaAno: number;
  competenciaMes: number;
}): NfJanela {
  const upload = new Date(input.uploadedAt);
  // Deadline: 25/MM/AAAA 23:59:59.999 BRT == 26/MM/AAAA 02:59:59.999 UTC
  const deadline = new Date(
    Date.UTC(input.competenciaAno, input.competenciaMes - 1, 26, 2, 59, 59, 999),
  );

  const noPrazo = upload.getTime() <= deadline.getTime();

  const proximoMes = input.competenciaMes === 12 ? 1 : input.competenciaMes + 1;
  const anoDoPagamento =
    input.competenciaMes === 12 ? input.competenciaAno + 1 : input.competenciaAno;
  const dia = noPrazo ? 3 : 8;

  const data_prevista = `${anoDoPagamento}-${String(proximoMes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;

  return {
    janela: noPrazo ? "salarios" : "fornecedores",
    data_prevista,
  };
}
