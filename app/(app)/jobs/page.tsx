import { Briefcase } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listEmpresasAtivas } from "@/lib/data/empresas";
import { pode } from "@/lib/permissoes";
import { JobsList, type JobRow } from "./jobs-list";

export const dynamic = "force-dynamic";

// TODO: filtro=faturamento_pronto — precisa lógica combinada de status + faturamento_previsto; implementar em fase 2
// TODO: filtro=encerrar_pronto — precisa join com jobs_envio_faturamento; implementar em fase 2
// TODO: filtro=chat_pendente — precisa join com jobs_chat_leituras; implementar em fase 2
// TODO: filtro=pps_rejeitadas — precisa join com pedidos_compra; implementar em fase 2
// TODO: filtro=minhas_pps — precisa join com pedidos_compra; implementar em fase 2

export default async function JobsPage({
  searchParams,
}: {
  searchParams?: { filtro?: string };
}) {
  const session = await requireSession();
  const supabase = createClient();
  const filtro = searchParams?.filtro;

  // Para filtro=realizado_pendente precisamos dos IDs dos jobs com pendência
  // antes de montar a query principal.
  let jobIdsComPendencia: string[] | null = null;
  if (filtro === "realizado_pendente") {
    const { data: comPendencia } = await supabase
      .from("jobs_itens_realizado")
      .select("job_id")
      .eq("tenant_id", session.activeTenant.id)
      .is("total_realizado", null);
    const ids = Array.from(
      new Set(
        (comPendencia ?? [])
          .map((r: { job_id: string | null }) => r.job_id)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    // Guarda null significa "não aplicar este filtro"; array vazio = forçar zero rows
    jobIdsComPendencia = ids;
  }

  // Query base de jobs
  let jobsQuery = supabase
    .from("jobs")
    .select(
      "id, codigo, nome, status, valor_total, data_inicio_prevista, empresa_id, projeto_id, " +
        // Produto e Regional saem do PRÓPRIO job, não do projeto (decisão
        // do Tiago, 01/09/2026): os dois divergem na base — o JOB-0003 é
        // "Ativação de marca" num projeto "Pevetech".
        "produto, regional_id, responsavel_id, " +
        // Os dois descritivos que a lista mostra em cartão (handoff
        // "Descritivos nas Listas", 04/09/2026): o do job na linha e o
        // do projeto na faixa do grupo. Texto curto — tetos de 500 e
        // 600 caracteres — e já vem no embed que a lista faz de todo
        // jeito, sem query nova.
        "observacoes, " +
        "regional:regionais(nome), " +
        "projeto:projetos(codigo, nome, descricao, cliente:clientes(nome_fantasia)), " +
        "responsavel:profiles!responsavel_id(nome), " +
        "empresa:empresas(id, razao_social, nome_fantasia)",
    )
    .eq("tenant_id", session.activeTenant.id)
    .order("codigo", { ascending: true });

  // Aplicar filtros de aterrissagem simples (status/data)
  if (filtro === "faturamento_proximo") {
    const hoje = new Date().toISOString().slice(0, 10);
    const em7 = new Date();
    em7.setDate(em7.getDate() + 7);
    const em7iso = em7.toISOString().slice(0, 10);
    jobsQuery = jobsQuery
      .eq("status", "aberto")
      .gte("data_prevista_faturamento", hoje)
      .lte("data_prevista_faturamento", em7iso);
  } else if (filtro === "realizado_pendente") {
    if (jobIdsComPendencia !== null && jobIdsComPendencia.length === 0) {
      // Nenhum job com pendência — força resultado vazio
      jobsQuery = jobsQuery.eq("id", "00000000-0000-0000-0000-000000000000");
    } else if (jobIdsComPendencia !== null && jobIdsComPendencia.length > 0) {
      jobsQuery = jobsQuery.in("id", jobIdsComPendencia);
    }
  }
  // TODO: filtro=faturamento_pronto — precisa lógica combinada; deixar sem filtro por ora (link funciona, retorna lista completa)
  // TODO: filtro=encerrar_pronto — join com jobs_envio_faturamento; deixar sem filtro por ora
  // TODO: filtro=chat_pendente — join com jobs_chat_leituras; deixar sem filtro por ora
  // TODO: filtro=pps_rejeitadas — join com pedidos_compra; deixar sem filtro por ora
  // TODO: filtro=minhas_pps — join com pedidos_compra; deixar sem filtro por ora

  const [jobsRes, empresas] = await Promise.all([
    jobsQuery,
    listEmpresasAtivas(session.activeTenant.id),
  ]);

  if (jobsRes.error) console.error("[jobs.list]", jobsRes.error.message);

  const rows: JobRow[] = (jobsRes.data ?? []).map((r: any) => ({
    id: r.id,
    codigo: r.codigo,
    nome: r.nome,
    status: r.status,
    valor_total: r.valor_total !== null ? Number(r.valor_total) : null,
    data_inicio_prevista: r.data_inicio_prevista,
    projeto_id: r.projeto_id,
    produto: r.produto ?? null,
    regional_id: r.regional_id ?? null,
    regional_nome: r.regional?.nome ?? null,
    responsavel_id: r.responsavel_id ?? null,
    observacoes: r.observacoes ?? null,
    projeto_codigo: r.projeto?.codigo ?? null,
    projeto_nome: r.projeto?.nome ?? null,
    projeto_descricao: r.projeto?.descricao ?? null,
    cliente_nome: r.projeto?.cliente?.nome_fantasia ?? null,
    responsavel_nome: r.responsavel?.nome ?? null,
    empresa_id: r.empresa_id ?? null,
    empresa_nome: r.empresa?.nome_fantasia ?? r.empresa?.razao_social ?? null,
  }));

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">
          Operação
        </p>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <Briefcase className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Jobs</h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Todos os jobs criados. Aprovados pelo financeiro liberam a gestão do
          realizado.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-12 shadow-soft text-center max-w-2xl mx-auto">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-california-red/10 text-california-red">
            <Briefcase className="h-6 w-6" />
          </div>
          <h2 className="mt-6 text-xl font-semibold">Nenhum job criado ainda</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Aprove uma versão de orçamento e crie um job pelo drawer no
            orçamento aprovado.
          </p>
        </div>
      ) : (
        <JobsList
          rows={rows}
          empresas={empresas}
          usuarioId={session.profile.id}
          podeAlternarMeusTodos={pode(session.activeRole, "listas.chave_meus_todos")}
        />
      )}
    </div>
  );
}
