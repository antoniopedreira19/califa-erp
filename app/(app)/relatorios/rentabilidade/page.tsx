import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { agruparEComputar } from "@/lib/relatorios/rentabilidade";
import { parseFiltros } from "./parse-filtros";
import { carregarLinhas } from "./carregar-linhas";
import { FiltrosCliente } from "./filtros-cliente";
import { TabelaRentabilidade } from "./tabela-rentabilidade";
import { TabelaComparativo } from "./tabela-comparativo";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function RentabilidadePage({ searchParams }: Props) {
  const session = await requireSession();
  const params = await searchParams;
  const filtros = parseFiltros(params);
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  // Dimensoes pra rotular grupos e alimentar dropdowns.
  const [
    linhasPeriodoA,
    linhasPeriodoB,
    clientesRes,
    marcasRes,
    empresasRes,
    regionaisRes,
  ] = await Promise.all([
    carregarLinhas(supabase, tenantId, filtros.ano, filtros),
    filtros.compararAno !== null
      ? carregarLinhas(supabase, tenantId, filtros.compararAno, filtros)
      : Promise.resolve(null),
    supabase
      .from("clientes")
      .select("id, nome_fantasia, razao_social")
      .eq("tenant_id", tenantId)
      .eq("status", "ativo"),
    supabase
      .from("cliente_produtos")
      .select("id, nome, cliente_id")
      .eq("tenant_id", tenantId)
      .eq("ativo", true),
    supabase
      .from("empresas")
      .select("id, nome_fantasia, razao_social")
      .eq("tenant_id", tenantId)
      .eq("ativo", true),
    supabase
      .from("regionais")
      .select("id, nome")
      .eq("tenant_id", tenantId)
      .eq("ativo", true),
  ]);

  const nomeCliente = (
    c: { nome_fantasia: string | null; razao_social: string },
  ) => c.nome_fantasia ?? c.razao_social;

  const clientesById = new Map(
    (clientesRes.data ?? []).map((c) => [c.id, nomeCliente(c)]),
  );
  const marcasById = new Map(
    (marcasRes.data ?? []).map((m) => [m.id, m.nome as string]),
  );
  const jobsById = new Map(
    linhasPeriodoA.map((l) => [l.job_id, `${l.job_codigo} · ${l.job_nome}`]),
  );

  const resolveRotulo = (chave: string): string => {
    if (filtros.visao === "cliente") return clientesById.get(chave) ?? "(sem cliente)";
    if (filtros.visao === "marca") return marcasById.get(chave) ?? "(sem marca)";
    return jobsById.get(chave) ?? chave;
  };

  // Filtra pelo modo (Realizado esconde jobs sem NF — spec §3.4).
  const filtrarPorModo = (linhas: typeof linhasPeriodoA) =>
    filtros.modo === "realizado"
      ? linhas.filter((l) => l.faturamento_realizado > 0)
      : linhas;

  const gruposA = agruparEComputar(
    filtrarPorModo(linhasPeriodoA),
    filtros.visao,
    filtros.modo,
    resolveRotulo,
  );

  // Grupos do 2o periodo pro comparativo (se houver).
  const gruposB = linhasPeriodoB
    ? agruparEComputar(
        filtrarPorModo(linhasPeriodoB),
        filtros.visao,
        filtros.modo,
        resolveRotulo,
      )
    : null;

  // Aplica faturamentoMinimo (filtro no grupo, nao no job — spec §3.6).
  // No comparativo, a semantica e "cliente entra se fatA >= min OR fatB >= min":
  // caso contrario o bloco B mostra clientes que fatmin excluiria e os dados
  // ficam incoerentes entre os dois periodos (fix I2 do review).
  const chavesQuePassam =
    filtros.faturamentoMinimo !== null
      ? new Set<string>([
          ...gruposA
            .filter((g) => g.bases.faturamento >= filtros.faturamentoMinimo!)
            .map((g) => g.chave),
          ...(gruposB ?? [])
            .filter((g) => g.bases.faturamento >= filtros.faturamentoMinimo!)
            .map((g) => g.chave),
        ])
      : null;

  const gruposFiltradosA = chavesQuePassam
    ? gruposA.filter((g) => chavesQuePassam.has(g.chave))
    : gruposA;

  const gruposFiltradosB =
    gruposB && chavesQuePassam
      ? gruposB.filter((g) => chavesQuePassam.has(g.chave))
      : gruposB;

  const totalBases = {
    faturamento: gruposFiltradosA.reduce((s, g) => s + g.bases.faturamento, 0),
    imposto: gruposFiltradosA.reduce((s, g) => s + g.bases.imposto, 0),
    custo: gruposFiltradosA.reduce((s, g) => s + g.bases.custo, 0),
    bv: gruposFiltradosA.reduce((s, g) => s + g.bases.bv, 0),
  };

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">
          Relatórios · Rentabilidade
        </p>
        <h1 className="text-3xl font-bold tracking-tight">
          Rentabilidade de Jobs {filtros.ano}
          {filtros.compararAno !== null && ` vs ${filtros.compararAno}`}
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Faturamento, resultado operacional e rentabilidade por cliente, marca ou job.
          Data de referência: abertura financeira do job.
        </p>
      </header>

      <FiltrosCliente
        filtros={filtros}
        clientes={(clientesRes.data ?? []).map((c) => ({
          id: c.id,
          nome: nomeCliente(c),
        }))}
        marcas={(marcasRes.data ?? []).map((m) => ({
          id: m.id,
          nome: m.nome,
          clienteId: m.cliente_id,
        }))}
        empresas={(empresasRes.data ?? []).map((e) => ({
          id: e.id,
          nome: e.nome_fantasia ?? e.razao_social,
        }))}
        regionais={(regionaisRes.data ?? []).map((r) => ({
          id: r.id,
          nome: r.nome,
        }))}
      />

      {gruposFiltradosB ? (
        <TabelaComparativo
          visao={filtros.visao}
          gruposA={gruposFiltradosA}
          gruposB={gruposFiltradosB}
          anoA={filtros.ano}
          anoB={filtros.compararAno!}
        />
      ) : (
        <TabelaRentabilidade
          visao={filtros.visao}
          modo={filtros.modo}
          grupos={gruposFiltradosA}
          totalBases={totalBases}
        />
      )}
    </div>
  );
}
