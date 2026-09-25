import { Briefcase } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listEmpresasAtivas } from "@/lib/data/empresas";
import { pode } from "@/lib/permissoes";
import { JOB_STATUS_ABERTO, jobStatusExibido } from "@/lib/types";
import {
  impedimentosDosJobs,
  podeEncerrar,
} from "@/lib/data/impedimentos-encerramento";
import { JobsList, type JobRow } from "./jobs-list";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

// TODO: filtro=chat_pendente — precisa join com jobs_chat_leituras; implementar em fase 2
// TODO: filtro=pps_rejeitadas — precisa join com pedidos_compra; implementar em fase 2
// TODO: filtro=minhas_pps — precisa join com pedidos_compra; implementar em fase 2

export default async function JobsPage({
  searchParams,
}: {
  searchParams?: { filtro?: string; empresa?: string; meus?: string };
}) {
  const session = await requireSession();
  const supabase = createClient();
  // `faturamento_proximo` e `faturamento_pronto` eram os links dos cards
  // de faturamento até 25/09/2026; os dois viraram "pendentes de envio"
  // (decisão 105) — o link antigo cai no filtro novo.
  const filtro =
    searchParams?.filtro === "faturamento_proximo" ||
    searchParams?.filtro === "faturamento_pronto"
      ? "faturamento_pendente"
      : searchParams?.filtro;

  const empresaFiltroIds: string[] =
    typeof searchParams?.empresa === "string" && searchParams.empresa.length > 0
      ? searchParams.empresa.split(",").filter((id) => id.length > 0)
      : session.activeEmpresas.map((e) => e.id);

  const activeEmpresasEfetivas =
    empresaFiltroIds.length > 0
      ? session.empresas.filter((e) => empresaFiltroIds.includes(e.id))
      : [];

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
      "id, codigo, nome, status, faturamento_enviado_em, valor_total, data_inicio_prevista, empresa_id, projeto_id, " +
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

  // Filtro multi-empresa
  if (empresaFiltroIds.length > 0) {
    jobsQuery = jobsQuery.in("empresa_id", empresaFiltroIds);
  }

  // Aplicar filtros de aterrissagem simples (status/data)
  if (filtro === "faturamento_pendente") {
    // Pendentes de envio para faturamento (decisão 105): a mesma régua dos
    // cards da home (`pendentesDeEnvioQuery`). O encerrado ainda fatura
    // (087); o carimbo do envio completo é do banco (094).
    jobsQuery = jobsQuery
      .in("status", ["aberto", "em_producao", "encerrado"])
      .gt("faturamento_previsto", 0.004)
      .is("faturamento_enviado_em", null);
  } else if (filtro === "realizado_pendente") {
    if (jobIdsComPendencia !== null && jobIdsComPendencia.length === 0) {
      // Nenhum job com pendência — força resultado vazio
      jobsQuery = jobsQuery.eq("id", "00000000-0000-0000-0000-000000000000");
    } else if (jobIdsComPendencia !== null && jobIdsComPendencia.length > 0) {
      jobsQuery = jobsQuery.in("id", jobIdsComPendencia);
    }
  }
  // Prontos pra encerrar (decisão 105): o job aberto que o botão "Enviar
  // job para encerramento" liberaria agora — a MESMA régua dele, em
  // `impedimentosDosJobs`. Aqui só o recorte de status; o resto é
  // conferido depois da lista, em memória.
  if (filtro === "encerrar_pronto") {
    jobsQuery = jobsQuery.in("status", JOB_STATUS_ABERTO);
  }
  // TODO: filtro=chat_pendente — join com jobs_chat_leituras; deixar sem filtro por ora
  // TODO: filtro=pps_rejeitadas — join com pedidos_compra; deixar sem filtro por ora
  // TODO: filtro=minhas_pps — join com pedidos_compra; deixar sem filtro por ora

  const [jobsRes, empresas] = await Promise.all([
    jobsQuery,
    listEmpresasAtivas(session.activeTenant.id),
  ]);

  if (jobsRes.error) console.error("[jobs.list]", jobsRes.error.message);

  // Segunda onda só com o filtro ligado: as pendências dependem dos ids
  // que a lista trouxe. Sete leituras em paralelo, qualquer que seja o
  // número de jobs (`docs/PERFORMANCE.md`).
  let linhas = (jobsRes.data ?? []) as any[];
  if (filtro === "encerrar_pronto" && linhas.length > 0) {
    const impedimentos = await impedimentosDosJobs(
      supabase,
      session.activeTenant.id,
      linhas.map((r) => r.id as string),
    );
    linhas = linhas.filter((r) => {
      const imp = impedimentos.get(r.id);
      return imp ? podeEncerrar(imp) : false;
    });
  }

  const podeAlternarMeusTodos = pode(session.activeRole, "listas.chave_meus_todos");

  const rows: JobRow[] = linhas.map((r: any) => ({
    id: r.id,
    codigo: r.codigo,
    nome: r.nome,
    // O selo e o filtro da lista usam o status exibido: "Em faturamento" é
    // o aberto com o envio completo (decisão 094).
    status: jobStatusExibido(r.status, r.faturamento_enviado_em ?? null),
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
      <PageHeader
        eyebrow="PRODUÇÃO"
        title="Jobs"
        description="Jobs vindos de orçamentos aprovados. Filtre por status e finalize os pendentes."
        icon={Briefcase}
        showEmpresaFilter
        empresas={session.empresasVisiveis}
        activeEmpresas={activeEmpresasEfetivas}
      />

      {rows.length === 0 && filtro === "faturamento_pendente" ? (
        <div className="rounded-2xl border border-border bg-card p-12 shadow-soft text-center max-w-2xl mx-auto">
          <h2 className="text-xl font-semibold">Nenhum job pendente de envio para faturamento</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Todo job aberto ou encerrado com faturamento previsto já foi enviado
            ao financeiro.
          </p>
        </div>
      ) : rows.length === 0 && filtro === "encerrar_pronto" ? (
        <div className="rounded-2xl border border-border bg-card p-12 shadow-soft text-center max-w-2xl mx-auto">
          <h2 className="text-xl font-semibold">Nenhum job pronto para encerrar</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Um job fica pronto quando não tem PP por pagar, verba sem prestação
            aprovada, BV por receber, item sem marcar que as PPs foram geradas
            nem save aguardando o financeiro.
          </p>
        </div>
      ) : rows.length === 0 ? (
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
          podeAlternarMeusTodos={podeAlternarMeusTodos}
          // O link diz de quem é a lista: `meus=1` abre no Meus; um filtro de
          // aterrissagem sem ele (o card do administrador, que conta a
          // empresa inteira) abre em Todos, para o número do card bater com
          // a lista. Sem filtro, o padrão de sempre (decisão 036).
          meusInicial={
            podeAlternarMeusTodos && (searchParams?.meus === "1" || !filtro)
          }
        />
      )}
    </div>
  );
}
