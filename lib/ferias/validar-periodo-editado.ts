export type AquisitivoParaValidar = {
  id: string;
  aquisitivo_inicio: string; // YYYY-MM-DD
  data_limite_gozo: string;
  dias_direito: number;
  dias_ocupados_outros: number;
};

export type ResultadoValidacaoPeriodo =
  | { ok: true; dias: number }
  | { ok: false; message: string };

function diasCorridos(ini: string, fim: string): number {
  const msIni = Date.parse(ini + "T00:00:00Z");
  const msFim = Date.parse(fim + "T00:00:00Z");
  return Math.round((msFim - msIni) / 86400000) + 1;
}

export function validarPeriodoEditado(input: {
  data_inicio: string;
  data_fim: string;
  aquisitivo: AquisitivoParaValidar | null;
}): ResultadoValidacaoPeriodo {
  const { data_inicio, data_fim, aquisitivo } = input;

  if (data_fim < data_inicio) {
    return { ok: false, message: "Data de fim antes da data de início." };
  }

  const dias = diasCorridos(data_inicio, data_fim);

  if (aquisitivo) {
    if (
      data_inicio < aquisitivo.aquisitivo_inicio ||
      data_inicio > aquisitivo.data_limite_gozo
    ) {
      return {
        ok: false,
        message: "Data de início fora do aquisitivo escolhido.",
      };
    }
    const saldo = aquisitivo.dias_direito - aquisitivo.dias_ocupados_outros;
    if (dias > saldo) {
      return {
        ok: false,
        message: `Dias solicitados (${dias}) excedem o saldo do aquisitivo (${saldo}).`,
      };
    }
  }

  return { ok: true, dias };
}
