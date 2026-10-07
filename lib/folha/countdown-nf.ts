export interface CountdownNf {
  /** Dias calendáricos até o dia 25 do mês da competência. Negativo se vencido. */
  diasRestantes: number;
  vencido: boolean;
  mensagem: string;
}

/**
 * Conta dias até o prazo de envio da NF (dia 25 do mês da competência,
 * em America/Sao_Paulo). Spec: docs/superpowers/specs/2026-10-07-folha-anexo-nf.md
 */
export function diasAtePrazoNf(input: {
  hoje: Date;
  competenciaAno: number;
  competenciaMes: number;
}): CountdownNf {
  const hoje = input.hoje;
  // Normaliza "hoje" para meia-noite BRT (ignora horário) para contagem calendárica.
  const hojeBrtMidnight = Date.UTC(
    hoje.getUTCFullYear(),
    hoje.getUTCMonth(),
    hoje.getUTCDate(),
  );
  // Dia 25 (prazo). Em UTC: dia 25 00:00 UTC do mesmo mês.
  const prazo = Date.UTC(input.competenciaAno, input.competenciaMes - 1, 25);
  const diffMs = prazo - hojeBrtMidnight;
  const diasRestantes = Math.round(diffMs / (1000 * 60 * 60 * 24));

  const vencido = diasRestantes < 0;

  const mmSeguinte = String(
    input.competenciaMes === 12 ? 1 : input.competenciaMes + 1,
  ).padStart(2, "0");

  let mensagem: string;
  if (vencido) {
    mensagem = `Prazo vencido — pagamento vai pra janela de fornecedores (08/${mmSeguinte}).`;
  } else if (diasRestantes === 0) {
    mensagem = `Último dia pra entrar na janela de salários (03/${mmSeguinte}).`;
  } else if (diasRestantes === 1) {
    mensagem = "Falta 1 dia para o prazo.";
  } else {
    mensagem = `Faltam ${diasRestantes} dias para o prazo (até 25/${String(
      input.competenciaMes,
    ).padStart(2, "0")}).`;
  }

  return { diasRestantes, vencido, mensagem };
}
