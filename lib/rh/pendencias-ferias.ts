/**
 * Classificação de pendências do histórico de férias de um colaborador.
 *
 * Função pura — recebe os períodos aquisitivos + lançamentos concluídos
 * do colaborador e devolve uma lista de pendências classificadas por nível
 * (crítica / alerta / info / ok).
 *
 * Nasceu na migração do histórico de 2023-2026 da planilha "FériasAtt":
 * alguns aquisitivos têm soma usufruto+abono maior que o direito legal
 * (30d), ou dois lançamentos idênticos cadastrados em duplicata, ou abonos
 * acima do teto legal de 10d. Em vez de bloquear a migração, o RH resolve
 * cada caso pela aba Pendências do /rh/ferias.
 *
 * Classificação (régua travada em 2026-11-13):
 *   Crítica:
 *     - saldo_estourado: usufruto + abono acumulado no aquisitivo passa
 *       dos dias_direito (ex: direito 30, consumido 60)
 *   Alerta:
 *     - duplicata_provavel: 2+ lançamentos iguais no aquisitivo
 *       (mesmo tipo, dias, data_inicio, data_fim)
 *     - abono_excessivo: soma de abonos > 10d no aquisitivo (teto legal)
 *   Info:
 *     - vencido_sem_usufruto: período concessivo encerrado sem nenhum
 *       dia gozado
 *
 * Esta função NÃO valida formato dos dados nem checa datas do intervalo
 * (isso é responsabilidade das CHECK no banco e do Zod nas actions).
 */

export type NivelPendenciaFerias = "critica" | "alerta" | "info" | "ok";

export type TipoPendenciaFerias =
  | "saldo_estourado"
  | "duplicata_provavel"
  | "abono_excessivo"
  | "vencido_sem_usufruto";

export type PendenciaFerias = {
  tipo: TipoPendenciaFerias;
  nivel: NivelPendenciaFerias;
  /** Rótulo do período aquisitivo no formato "AAAA/AAAA". */
  aquisitivo: string;
  /** UUID do período aquisitivo. */
  periodo_id: string;
  /** Mensagem humana em pt-BR, pronta pra exibir na UI. */
  descricao: string;
  /** UUIDs dos lançamentos envolvidos. Vazio quando a pendência é do
   *  próprio período (ex: vencido_sem_usufruto). */
  lancamentos_envolvidos: string[];
};

export type PendenciasFeriasColaborador = {
  /** Pior nível entre todos os itens. "ok" quando não há pendência. */
  nivel: NivelPendenciaFerias;
  itens: PendenciaFerias[];
  /** Quantas pendências de cada nível, pra badges na lista. */
  resumo: {
    criticas: number;
    alertas: number;
    infos: number;
  };
  total: number;
};

export type PeriodoParaPendencias = {
  id: string;
  aquisitivo_inicio: string;
  aquisitivo_fim: string;
  concessivo_fim: string;
  dias_direito: number;
};

export type LancamentoParaPendencias = {
  id: string;
  periodo_id: string | null;
  /** Reflete o enum ferias_lancamento_tipo do banco. */
  tipo:
    | "usufruto"
    | "abono_combinado"
    | "abono_avulso"
    | "abono_excepcional";
  dias: number;
  /** Só é > 0 quando tipo = abono_combinado (parte vendida do bloco). */
  dias_abono: number;
  data_inicio: string | null;
  data_fim: string | null;
};

const TETO_ABONO_LEGAL = 10;

function rotuloAquisitivo(p: PeriodoParaPendencias): string {
  return (
    p.aquisitivo_inicio.slice(0, 4) + "/" + p.aquisitivo_fim.slice(0, 4)
  );
}

/** Soma usufruto + abono (direto ou dentro de um abono_combinado) por período. */
function somarPorPeriodo(
  lancamentos: LancamentoParaPendencias[],
): Map<string, { usufruto: number; abono: number }> {
  const porPeriodo = new Map<string, { usufruto: number; abono: number }>();
  for (const l of lancamentos) {
    if (!l.periodo_id) continue;
    const prev =
      porPeriodo.get(l.periodo_id) ?? { usufruto: 0, abono: 0 };
    if (l.tipo === "usufruto") {
      prev.usufruto += l.dias;
    } else if (l.tipo === "abono_excepcional") {
      prev.abono += l.dias;
    } else if (l.tipo === "abono_combinado") {
      // dias = corridos + dias_abono; só a parte abono entra no teto
      prev.usufruto += l.dias - l.dias_abono;
      prev.abono += l.dias_abono;
    }
    // abono_avulso NÃO tem periodo_id (CHECK no banco garante), então
    // nunca chega até aqui — mesmo assim ignora pra ser explícito.
    porPeriodo.set(l.periodo_id, prev);
  }
  return porPeriodo;
}

/** Agrupa lançamentos por (periodo_id, tipo, dias, data_inicio, data_fim)
 *  pra detectar duplicatas exatas. */
function detectarDuplicatas(
  lancamentos: LancamentoParaPendencias[],
): Array<{ periodo_id: string; lancamentos: string[] }> {
  const buckets = new Map<string, LancamentoParaPendencias[]>();
  for (const l of lancamentos) {
    if (!l.periodo_id) continue;
    const chave = [
      l.periodo_id,
      l.tipo,
      l.dias,
      l.data_inicio ?? "null",
      l.data_fim ?? "null",
    ].join("|");
    const arr = buckets.get(chave) ?? [];
    arr.push(l);
    buckets.set(chave, arr);
  }
  const out: Array<{ periodo_id: string; lancamentos: string[] }> = [];
  for (const arr of buckets.values()) {
    if (arr.length >= 2) {
      out.push({
        periodo_id: arr[0].periodo_id!,
        lancamentos: arr.map((x) => x.id),
      });
    }
  }
  return out;
}

export function avaliarPendenciasFerias(input: {
  periodos: PeriodoParaPendencias[];
  lancamentos: LancamentoParaPendencias[];
  /** Data de referência pra marcar períodos vencidos. Default: hoje. */
  hoje?: Date;
}): PendenciasFeriasColaborador {
  const { periodos, lancamentos } = input;
  const hoje = input.hoje ?? new Date();
  const hojeISO = hoje.toISOString().slice(0, 10);

  const totaisPorPeriodo = somarPorPeriodo(lancamentos);
  const duplicatas = detectarDuplicatas(lancamentos);
  const periodoPorId = new Map(periodos.map((p) => [p.id, p]));

  const itens: PendenciaFerias[] = [];

  for (const p of periodos) {
    const rotulo = rotuloAquisitivo(p);
    const totais = totaisPorPeriodo.get(p.id) ?? { usufruto: 0, abono: 0 };
    const consumido = totais.usufruto + totais.abono;

    if (consumido > p.dias_direito) {
      const envolvidos = lancamentos
        .filter((l) => l.periodo_id === p.id)
        .map((l) => l.id);
      itens.push({
        tipo: "saldo_estourado",
        nivel: "critica",
        aquisitivo: rotulo,
        periodo_id: p.id,
        descricao:
          "Saldo excedido: consumido " +
          consumido +
          "d do direito de " +
          p.dias_direito +
          "d",
        lancamentos_envolvidos: envolvidos,
      });
    }

    if (totais.abono > TETO_ABONO_LEGAL) {
      const envolvidos = lancamentos
        .filter(
          (l) =>
            l.periodo_id === p.id &&
            (l.tipo === "abono_excepcional" || l.tipo === "abono_combinado"),
        )
        .map((l) => l.id);
      itens.push({
        tipo: "abono_excessivo",
        nivel: "alerta",
        aquisitivo: rotulo,
        periodo_id: p.id,
        descricao:
          "Abono de " +
          totais.abono +
          "d acima do teto legal de " +
          TETO_ABONO_LEGAL +
          "d",
        lancamentos_envolvidos: envolvidos,
      });
    }

    const venceu = p.concessivo_fim < hojeISO;
    if (venceu && totais.usufruto === 0 && totais.abono === 0) {
      itens.push({
        tipo: "vencido_sem_usufruto",
        nivel: "info",
        aquisitivo: rotulo,
        periodo_id: p.id,
        descricao:
          "Período vencido em " +
          p.concessivo_fim +
          " sem nenhum dia gozado",
        lancamentos_envolvidos: [],
      });
    }
  }

  for (const d of duplicatas) {
    const p = periodoPorId.get(d.periodo_id);
    if (!p) continue;
    itens.push({
      tipo: "duplicata_provavel",
      nivel: "alerta",
      aquisitivo: rotuloAquisitivo(p),
      periodo_id: d.periodo_id,
      descricao:
        d.lancamentos.length + " lançamentos idênticos — possível duplicata",
      lancamentos_envolvidos: d.lancamentos,
    });
  }

  const criticas = itens.filter((i) => i.nivel === "critica").length;
  const alertas = itens.filter((i) => i.nivel === "alerta").length;
  const infos = itens.filter((i) => i.nivel === "info").length;

  const nivel: NivelPendenciaFerias =
    criticas > 0
      ? "critica"
      : alertas > 0
        ? "alerta"
        : infos > 0
          ? "info"
          : "ok";

  return {
    nivel,
    itens,
    resumo: { criticas, alertas, infos },
    total: itens.length,
  };
}

/** Rótulo humano em pt-BR por tipo de pendência (usado em badges). */
export const ROTULO_PENDENCIA_FERIAS: Record<TipoPendenciaFerias, string> = {
  saldo_estourado: "Saldo excedido",
  duplicata_provavel: "Duplicata provável",
  abono_excessivo: "Abono acima do teto",
  vencido_sem_usufruto: "Vencido sem gozo",
};
