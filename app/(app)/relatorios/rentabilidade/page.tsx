import { BarChart3 } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import {
  agruparEComputar,
  type GrupoRentabilidade,
} from "@/lib/relatorios/rentabilidade";
import type { LinhaJobRentabilidade } from "@/lib/types";
import { parseFiltros } from "./parse-filtros";
import { carregarLinhas } from "./carregar-linhas";
import { carregarDimensoesRelatorio } from "./carregar-dimensoes";
import { FiltrosCliente } from "./filtros-cliente";
import { ModoProvider } from "./modo-provider";
import { SecaoTabela } from "./secao-tabela";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Encapsula agrupar+filtrar por modo pros DOIS modos. Roda depois que o
 * server já tem as linhas do período. Retorna grupos e totais prontos
 * pra cliente escolher no modo toggle (P7).
 */
function computarPorModo(
  linhas: LinhaJobRentabilidade[],
  visao: Parameters<typeof agruparEComputar>[1],
  resolveRotulo: (chave: string) => string,
) {
  const gruposPrevisto = agruparEComputar(linhas, visao, "previsto", resolveRotulo);
  const linhasComFat = linhas.filter((l) => l.faturamento_realizado > 0);
  const gruposRealizado = agruparEComputar(
    linhasComFat,
    visao,
    "realizado",
    resolveRotulo,
  );

  const somarBases = (grupos: GrupoRentabilidade[]) => ({
    faturamento: grupos.reduce((s, g) => s + g.bases.faturamento, 0),
    imposto: grupos.reduce((s, g) => s + g.bases.imposto, 0),
    custo: grupos.reduce((s, g) => s + g.bases.custo, 0),
    bv: grupos.reduce((s, g) => s + g.bases.bv, 0),
  });

  return {
    grupos: { previsto: gruposPrevisto, realizado: gruposRealizado },
    totais: {
      previsto: somarBases(gruposPrevisto),
      realizado: somarBases(gruposRealizado),
    },
  };
}

/**
 * Aplica `faturamentoMinimo` mantendo a semântica original: o filtro
 * atua no GRUPO (spec §3.6). Como agora computamos os dois modos, o
 * filtro roda em cada modo separadamente — cliente que passa em previsto
 * mas não em realizado pode aparecer/sumir ao trocar o toggle, o que é
 * consistente com a definição "faturamento do grupo >= min".
 */
function filtrarPorFaturamentoMinimo(
  gruposPorModo: { previsto: GrupoRentabilidade[]; realizado: GrupoRentabilidade[] },
  minimo: number | null,
): { previsto: GrupoRentabilidade[]; realizado: GrupoRentabilidade[] } {
  if (minimo === null) return gruposPorModo;
  return {
    previsto: gruposPorModo.previsto.filter(
      (g) => g.bases.faturamento >= minimo,
    ),
    realizado: gruposPorModo.realizado.filter(
      (g) => g.bases.faturamento >= minimo,
    ),
  };
}

/**
 * Interseção de chaves entre A e B com regra "aparece em pelo menos um".
 * Idem à lógica que existia antes, agora aplicada por modo.
 */
function filtrarComparativo(
  gruposA: { previsto: GrupoRentabilidade[]; realizado: GrupoRentabilidade[] },
  gruposB: { previsto: GrupoRentabilidade[]; realizado: GrupoRentabilidade[] },
  minimo: number | null,
) {
  if (minimo === null) return { gruposA, gruposB };

  const passaEm = (grupos: GrupoRentabilidade[]) =>
    new Set(
      grupos.filter((g) => g.bases.faturamento >= minimo).map((g) => g.chave),
    );

  const chavesPrevisto = new Set<string>([
    ...passaEm(gruposA.previsto),
    ...passaEm(gruposB.previsto),
  ]);
  const chavesRealizado = new Set<string>([
    ...passaEm(gruposA.realizado),
    ...passaEm(gruposB.realizado),
  ]);

  const filtrar = (
    grupos: { previsto: GrupoRentabilidade[]; realizado: GrupoRentabilidade[] },
  ) => ({
    previsto: grupos.previsto.filter((g) => chavesPrevisto.has(g.chave)),
    realizado: grupos.realizado.filter((g) => chavesRealizado.has(g.chave)),
  });

  return { gruposA: filtrar(gruposA), gruposB: filtrar(gruposB) };
}

export default async function RentabilidadePage({ searchParams }: Props) {
  const session = await requireSession();
  const params = await searchParams;
  const filtros = parseFiltros(params);
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  // Empresas ativas como default: se nenhuma empresa foi explicitamente filtrada
  // via URL, pré-filtra pelas empresas ativas no topbar (multi-empresa).
  const empresaFiltroIds: string[] =
    filtros.empresasIds.length > 0
      ? filtros.empresasIds
      : session.activeEmpresas.map((e) => e.id);

  const activeEmpresasEfetivas =
    empresaFiltroIds.length > 0
      ? session.empresas.filter((e) => empresaFiltroIds.includes(e.id))
      : [];

  const filtrosComDefault = {
    ...filtros,
    empresasIds: empresaFiltroIds,
  };

  // As linhas da view dependem dos filtros e do período — não são cached.
  // As dimensões (clientes, marcas, empresas, regionais) mudam raro —
  // vêm de cache com TTL de 5 min (P2 do diagnóstico de perf).
  const [linhasPeriodoA, linhasPeriodoB, dimensoes] = await Promise.all([
    carregarLinhas(supabase, tenantId, filtros.ano, filtrosComDefault),
    filtros.compararAno !== null
      ? carregarLinhas(supabase, tenantId, filtros.compararAno, filtrosComDefault)
      : Promise.resolve(null),
    carregarDimensoesRelatorio(tenantId),
  ]);

  const clientesById = new Map(dimensoes.clientes.map((c) => [c.id, c.nome]));
  const marcasById = new Map(dimensoes.marcas.map((m) => [m.id, m.nome]));
  const jobsById = new Map(
    linhasPeriodoA.map((l) => [l.job_id, `${l.job_codigo} · ${l.job_nome}`]),
  );

  const resolveRotulo = (chave: string): string => {
    if (filtros.visao === "cliente") return clientesById.get(chave) ?? "(sem cliente)";
    if (filtros.visao === "marca") return marcasById.get(chave) ?? "(sem marca)";
    return jobsById.get(chave) ?? chave;
  };

  const computadoA = computarPorModo(linhasPeriodoA, filtros.visao, resolveRotulo);
  const computadoB = linhasPeriodoB
    ? computarPorModo(linhasPeriodoB, filtros.visao, resolveRotulo)
    : null;

  // faturamentoMinimo aplicado APÓS agregação (spec §3.6). No comparativo,
  // semântica "cliente aparece se fat >= min em A OU B" (fix I2 do review).
  const gruposFiltrados = computadoB
    ? filtrarComparativo(
        computadoA.grupos,
        computadoB.grupos,
        filtros.faturamentoMinimo,
      )
    : {
        gruposA: filtrarPorFaturamentoMinimo(
          computadoA.grupos,
          filtros.faturamentoMinimo,
        ),
        gruposB: null,
      };

  // Totais recalculados sobre grupos filtrados.
  const somarBases = (grupos: GrupoRentabilidade[]) => ({
    faturamento: grupos.reduce((s, g) => s + g.bases.faturamento, 0),
    imposto: grupos.reduce((s, g) => s + g.bases.imposto, 0),
    custo: grupos.reduce((s, g) => s + g.bases.custo, 0),
    bv: grupos.reduce((s, g) => s + g.bases.bv, 0),
  });
  const totalBasesA = {
    previsto: somarBases(gruposFiltrados.gruposA.previsto),
    realizado: somarBases(gruposFiltrados.gruposA.realizado),
  };

  return (
    <ModoProvider modoInicial={filtros.modo}>
      <div className="space-y-6">
        <PageHeader
          eyebrow="RELATÓRIOS"
          title={`Rentabilidade de Jobs ${filtros.ano}${filtros.compararAno !== null ? ` vs ${filtros.compararAno}` : ""}`}
          description="Faturamento, resultado operacional e rentabilidade por cliente, marca ou job. Data de referência: abertura financeira do job."
          icon={BarChart3}
          showEmpresaFilter
          empresas={session.empresas}
          activeEmpresas={activeEmpresasEfetivas}
        />

        <FiltrosCliente
          filtros={filtros}
          clientes={dimensoes.clientes}
          marcas={dimensoes.marcas}
          empresas={dimensoes.empresas}
          regionais={dimensoes.regionais}
        />

        <SecaoTabela
          visao={filtros.visao}
          gruposA={gruposFiltrados.gruposA}
          totalBasesA={totalBasesA}
          gruposB={gruposFiltrados.gruposB}
          anoA={filtros.ano}
          anoB={filtros.compararAno}
        />
      </div>
    </ModoProvider>
  );
}
