/**
 * Agregacao de rentabilidade entre multiplos jobs do mesmo projeto.
 *
 * Grupos existem por versao de orcamento (cada job tem sua versao), entao
 * "Producao" no job A e "Producao" no job B sao registros distintos com o
 * mesmo nome. Agregamos por nome normalizado (trim + toLowerCase) e
 * exibimos o nome mais recente encontrado (por created_at do grupo).
 */

export type LinhaGrupoProjeto = {
  chaveNormalizada: string;
  nomeExibicao: string;
  orcado: number;
  planejado: number;
  realizado: number;
};

export type JobParaAgregar = {
  grupos: { id: string; nome: string; created_at: string }[];
  itens: {
    id: string;
    grupo_id: string;
    total_orcado: number | string | null;
    total_planejado: number | string | null;
  }[];
  realizadosPorItemId: Map<string, { total_realizado: number | string | null }>;
};

function normalizar(nome: string): string {
  return nome.trim().toLowerCase();
}

function toNumber(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function agregarRentabilidadePorProjeto(
  jobs: JobParaAgregar[],
  ordenarPor: "nome" | "primeiroEncontro" = "nome",
): {
  linhas: LinhaGrupoProjeto[];
  total: Omit<LinhaGrupoProjeto, "chaveNormalizada" | "nomeExibicao">;
} {
  type Acumulador = {
    chaveNormalizada: string;
    nomeMaisRecente: string;
    createdAtMaisRecente: string;
    orcado: number;
    planejado: number;
    realizado: number;
  };
  const mapa = new Map<string, Acumulador>();

  for (const job of jobs) {
    for (const grupo of job.grupos) {
      const chave = normalizar(grupo.nome);
      const itensDoGrupo = job.itens.filter((i) => i.grupo_id === grupo.id);

      const orcadoGrp = itensDoGrupo.reduce(
        (s, i) => s + toNumber(i.total_orcado),
        0,
      );
      const planejadoGrp = itensDoGrupo.reduce(
        (s, i) => s + toNumber(i.total_planejado),
        0,
      );
      const realizadoGrp = itensDoGrupo.reduce((s, i) => {
        const r = job.realizadosPorItemId.get(i.id);
        return s + toNumber(r?.total_realizado);
      }, 0);

      const atual = mapa.get(chave);
      if (!atual) {
        mapa.set(chave, {
          chaveNormalizada: chave,
          nomeMaisRecente: grupo.nome,
          createdAtMaisRecente: grupo.created_at,
          orcado: orcadoGrp,
          planejado: planejadoGrp,
          realizado: realizadoGrp,
        });
      } else {
        atual.orcado += orcadoGrp;
        atual.planejado += planejadoGrp;
        atual.realizado += realizadoGrp;
        if (grupo.created_at > atual.createdAtMaisRecente) {
          atual.nomeMaisRecente = grupo.nome;
          atual.createdAtMaisRecente = grupo.created_at;
        }
      }
    }
  }

  const linhasBase = Array.from(mapa.values()).map((a) => ({
    chaveNormalizada: a.chaveNormalizada,
    nomeExibicao: a.nomeMaisRecente,
    orcado: a.orcado,
    planejado: a.planejado,
    realizado: a.realizado,
  }));

  const linhas: LinhaGrupoProjeto[] =
    ordenarPor === "nome"
      ? linhasBase.sort((a, b) => a.nomeExibicao.localeCompare(b.nomeExibicao))
      : linhasBase;

  const total = linhas.reduce(
    (acc, l) => ({
      orcado: acc.orcado + l.orcado,
      planejado: acc.planejado + l.planejado,
      realizado: acc.realizado + l.realizado,
    }),
    { orcado: 0, planejado: 0, realizado: 0 },
  );

  return { linhas, total };
}
