import { Receipt } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { calcularStatusFaturamento } from "@/lib/relatorios/faturamento-status";
import { parseFiltros } from "./parse-filtros";
import { FiltrosCliente } from "./filtros-cliente";
import { TabelaFaturamento, type LinhaFaturamento } from "./tabela-faturamento";
// Reusos do relatório de rentabilidade — mesma fonte de dados (view) e
// mesmas dimensões (cache warm compartilhado).
import { carregarLinhas } from "../rentabilidade/carregar-linhas";
import { carregarDimensoesRelatorio } from "../rentabilidade/carregar-dimensoes";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function FaturamentoPage({ searchParams }: Props) {
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

  const [linhasVw, dimensoes] = await Promise.all([
    carregarLinhas(supabase, tenantId, filtros.ano, filtrosComDefault),
    carregarDimensoesRelatorio(tenantId),
  ]);

  // Converte linhas da view em linhas prontas pra tabela: computa saldo e
  // status, e mantém só os campos que a UI usa (payload menor pro client).
  const linhasBase: LinhaFaturamento[] = linhasVw.map((l) => {
    const valorJob = l.faturamento_previsto;
    const valorFat = l.faturamento_realizado;
    const saldo = valorJob - valorFat;
    return {
      job_id: l.job_id,
      job_codigo: l.job_codigo,
      job_nome: l.job_nome,
      valor_job: valorJob,
      valor_faturado: valorFat,
      saldo,
      status: calcularStatusFaturamento(valorJob, valorFat),
      data_abertura: l.data_abertura_financeiro,
    };
  });

  // Filtros pós-agregação (a view não sabe de status e o mínimo atua no job).
  const linhasFiltradas = linhasBase.filter((l) => {
    if (
      filtros.statusList.length > 0 &&
      !filtros.statusList.includes(l.status)
    ) {
      return false;
    }
    if (
      filtros.faturamentoMinimo !== null &&
      l.valor_job < filtros.faturamentoMinimo
    ) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="RELATÓRIOS"
        title={`Faturamento de Jobs ${filtros.ano}`}
        description="Compara o valor do job (contratado) com o valor efetivamente faturado. Data de referência: abertura financeira do job."
        icon={Receipt}
        showEmpresaFilter
        empresas={session.empresasVisiveis}
        activeEmpresas={activeEmpresasEfetivas}
      />

      <FiltrosCliente
        filtros={filtros}
        clientes={dimensoes.clientes}
        marcas={dimensoes.marcas}
        empresas={dimensoes.empresas}
        regionais={dimensoes.regionais}
      />

      <TabelaFaturamento linhas={linhasFiltradas} />
    </div>
  );
}
