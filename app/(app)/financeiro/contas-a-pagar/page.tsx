import { redirect } from "next/navigation";
import { FileText, ChevronRight } from "lucide-react";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PedidosCompraList, type PPRow } from "./pedidos-compra-list";
import { ContasPagarTabs } from "./contas-pagar-tabs";
import { ContasAvulsasList, type AvulsaRow } from "./avulsas-list";
import { RecorrentesList, type RecorrenteRow } from "./recorrentes-list";
import type { PPStatus, ContaBancaria, PlanoContaTipo, PlanoContaSubtipo } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PedidosCompraFinanceiroPage() {
  const session = await requireSession();
  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    redirect("/home?reason=sem_permissao_financeira");
  }

  const supabase = createClient();

  const [
    { data, error },
    contasRes,
    tiposRes,
    subtiposRes,
    ppsPendentesCountRes,
    avulsasPendentesCountRes,
    avulsasRes,
    empresasRes,
    fornecedoresRes,
    clientesRes,
    jobsRes,
    recorrentesRes,
    recorrentesAtivasCountRes,
    regionaisRes,
  ] = await Promise.all([
    supabase
      .from("pedidos_compra")
      .select(
        `
        id, codigo, status, valor, quantidade, servico, especificacoes,
        prazo_pagamento, prazo_pagamento_financeiro, pdf_path, created_at,
        cancelada_em, motivo_cancelamento,
        rejeitada_em, motivo_rejeicao, pago_em,
        fornecedor:fornecedores(id, nome, razao_social),
        empresa:empresas(id, razao_social, nome_fantasia),
        cancelada_por_profile:profiles!cancelada_por(nome),
        emitida_por_profile:profiles!emitida_por(nome),
        rejeitada_por_profile:profiles!rejeitada_por(nome),
        pago_por_profile:profiles!pago_por(nome),
        job:jobs(
          id, codigo, nome,
          projeto:projetos(codigo, nome, cliente:clientes(nome_fantasia))
        ),
        anexos:pedidos_compra_anexos(id, arquivo_nome_original, arquivo_tamanho_bytes)
      `,
      )
      .eq("tenant_id", session.activeTenant.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("contas_bancarias")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .returns<ContaBancaria[]>(),
    supabase
      .from("plano_contas_tipos")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("ordem")
      .returns<PlanoContaTipo[]>(),
    supabase
      .from("plano_contas_subtipos")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome")
      .returns<PlanoContaSubtipo[]>(),
    supabase
      .from("pedidos_compra")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "em_avaliacao"),
    supabase
      .from("contas_avulsas")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "pendente"),
    // Contas avulsas (todos os status) — para a lista da aba
    supabase
      .from("contas_avulsas")
      .select(`
        id, descricao, valor, natureza, data_prevista_pagamento, status,
        pago_em, created_at,
        fornecedor:fornecedores(nome, razao_social),
        cliente:clientes(nome_fantasia, razao_social),
        job:jobs(codigo),
        empresa:empresas(razao_social, nome_fantasia),
        tipo:plano_contas_tipos!inner(codigo),
        subtipo:plano_contas_subtipos!inner(nome),
        anexos:contas_avulsas_anexos(id)
      `)
      .eq("tenant_id", session.activeTenant.id)
      .order("data_prevista_pagamento", { ascending: true })
      .order("created_at", { ascending: false }),
    // Empresas ativas (dropdown do drawer)
    supabase
      .from("empresas")
      .select("id, razao_social, nome_fantasia")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("razao_social"),
    // Fornecedores ativos (dropdown)
    supabase
      .from("fornecedores")
      .select("id, nome, razao_social")
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo")
      .order("nome"),
    // Clientes ativos (dropdown)
    supabase
      .from("clientes")
      .select("id, nome_fantasia, razao_social")
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo")
      .order("nome_fantasia"),
    // Jobs não cancelados — inclui cliente_id do projeto e regional_id do job
    // para auto-preencher cliente/rateio no drawer quando job é escolhido.
    supabase
      .from("jobs")
      .select("id, codigo, nome, regional_id, projeto:projetos!inner(cliente_id)")
      .eq("tenant_id", session.activeTenant.id)
      .neq("status", "cancelado")
      .order("created_at", { ascending: false })
      .limit(500),
    // Recorrências (todos os status)
    supabase
      .from("contas_avulsas_recorrentes")
      .select(`
        id, descricao, valor, frequencia,
        dia_do_mes, dia_quinzena_1, dia_quinzena_2, dia_do_ano_dia, dia_do_ano_mes,
        proxima_data, data_fim, ativo,
        fornecedor:fornecedores(nome, razao_social),
        empresa:empresas(razao_social, nome_fantasia),
        tipo:plano_contas_tipos!inner(codigo),
        subtipo:plano_contas_subtipos!inner(nome)
      `)
      .eq("tenant_id", session.activeTenant.id)
      .order("ativo", { ascending: false })
      .order("proxima_data", { ascending: true }),
    // Contagem de recorrências ativas
    supabase
      .from("contas_avulsas_recorrentes")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true),
    // Regionais (para o editor de rateio no drawer da avulsa)
    supabase
      .from("regionais")
      .select("id, nome, ativo")
      .eq("tenant_id", session.activeTenant.id)
      .order("nome"),
  ]);

  if (error) console.error("[financeiro.pp.list]", error.message);
  if (avulsasRes.error) console.error("[financeiro.avulsas.list]", avulsasRes.error.message);
  if (recorrentesRes.error) console.error("[financeiro.recorrentes.list]", recorrentesRes.error.message);

  const rows: PPRow[] = ((data ?? []) as unknown as Array<{
    id: string;
    codigo: string;
    status: PPStatus;
    valor: string | number;
    quantidade: string | number;
    servico: string;
    especificacoes: string | null;
    prazo_pagamento: string;
    prazo_pagamento_financeiro: string | null;
    pdf_path: string;
    created_at: string;
    cancelada_em: string | null;
    motivo_cancelamento: string | null;
    rejeitada_em: string | null;
    motivo_rejeicao: string | null;
    pago_em: string | null;
    fornecedor: { id: string; nome: string; razao_social: string | null } | null;
    empresa: { id: string; razao_social: string; nome_fantasia: string | null } | null;
    cancelada_por_profile: { nome: string } | null;
    emitida_por_profile: { nome: string } | null;
    rejeitada_por_profile: { nome: string } | null;
    pago_por_profile: { nome: string } | null;
    job: {
      id: string;
      codigo: string;
      nome: string;
      projeto: {
        codigo: string;
        nome: string;
        cliente: { nome_fantasia: string } | null;
      } | null;
    } | null;
    anexos: Array<{
      id: string;
      arquivo_nome_original: string;
      arquivo_tamanho_bytes: number;
    }>;
  }>).map((r) => ({
    id: r.id,
    codigo: r.codigo,
    status: r.status,
    valor: Number(r.valor),
    quantidade: Number(r.quantidade),
    servico: r.servico,
    especificacoes: r.especificacoes,
    prazo_pagamento: r.prazo_pagamento,
    prazo_pagamento_financeiro: r.prazo_pagamento_financeiro,
    pdf_path: r.pdf_path,
    created_at: r.created_at,
    cancelada_em: r.cancelada_em,
    motivo_cancelamento: r.motivo_cancelamento,
    rejeitada_em: r.rejeitada_em,
    motivo_rejeicao: r.motivo_rejeicao,
    rejeitada_por_nome: r.rejeitada_por_profile?.nome ?? null,
    pago_em: r.pago_em,
    pago_por_nome: r.pago_por_profile?.nome ?? null,
    fornecedor_id: r.fornecedor?.id ?? "",
    fornecedor_nome: r.fornecedor?.razao_social ?? r.fornecedor?.nome ?? "",
    empresa_id: r.empresa?.id ?? "",
    empresa_nome: r.empresa?.razao_social ?? r.empresa?.nome_fantasia ?? "",
    job_id: r.job?.id ?? "",
    job_codigo: r.job?.codigo ?? "",
    job_nome: r.job?.nome ?? "",
    projeto_codigo: r.job?.projeto?.codigo ?? null,
    projeto_nome: r.job?.projeto?.nome ?? null,
    cliente_nome: r.job?.projeto?.cliente?.nome_fantasia ?? null,
    cancelada_por_nome: r.cancelada_por_profile?.nome ?? null,
    emitida_por_nome: r.emitida_por_profile?.nome ?? null,
    anexos: r.anexos ?? [],
  }));

  // Mapeamento das contas avulsas para AvulsaRow
  const avulsasRows: AvulsaRow[] = ((avulsasRes.data ?? []) as unknown as Array<{
    id: string;
    descricao: string;
    valor: string | number;
    natureza: "entrada" | "saida";
    data_prevista_pagamento: string | null;
    status: "pendente" | "baixada";
    pago_em: string | null;
    created_at: string;
    fornecedor: { nome: string | null; razao_social: string | null } | null;
    cliente: { nome_fantasia: string | null; razao_social: string | null } | null;
    job: { codigo: string } | null;
    empresa: { razao_social: string | null; nome_fantasia: string | null } | null;
    tipo: { codigo: string } | null;
    subtipo: { nome: string } | null;
    anexos: Array<{ id: string }> | null;
  }>).map((r) => ({
    id: r.id,
    descricao: r.descricao,
    valor: Number(r.valor),
    natureza: r.natureza,
    data_prevista_pagamento: r.data_prevista_pagamento,
    status: r.status,
    fornecedor_nome: r.fornecedor?.razao_social ?? r.fornecedor?.nome ?? null,
    cliente_nome: r.cliente?.razao_social ?? r.cliente?.nome_fantasia ?? null,
    job_codigo: r.job?.codigo ?? null,
    empresa_nome: r.empresa?.razao_social ?? r.empresa?.nome_fantasia ?? "",
    tipo_codigo: r.tipo?.codigo ?? "",
    subtipo_nome: r.subtipo?.nome ?? "",
    anexos_count: r.anexos?.length ?? 0,
    pago_em: r.pago_em,
    created_at: r.created_at,
  }));

  // Mapeamento das recorrências para RecorrenteRow
  const recorrentesRows: RecorrenteRow[] = ((recorrentesRes.data ?? []) as unknown as Array<{
    id: string;
    descricao: string;
    valor: string | number;
    frequencia: "mensal" | "quinzenal" | "anual";
    dia_do_mes: number | null;
    dia_quinzena_1: number | null;
    dia_quinzena_2: number | null;
    dia_do_ano_dia: number | null;
    dia_do_ano_mes: number | null;
    proxima_data: string;
    data_fim: string | null;
    ativo: boolean;
    fornecedor: { nome: string | null; razao_social: string | null } | null;
    empresa: { razao_social: string | null; nome_fantasia: string | null } | null;
    tipo: { codigo: string } | null;
    subtipo: { nome: string } | null;
  }>).map((r) => ({
    id: r.id,
    descricao: r.descricao,
    valor: Number(r.valor),
    frequencia: r.frequencia,
    dia_do_mes: r.dia_do_mes,
    dia_quinzena_1: r.dia_quinzena_1,
    dia_quinzena_2: r.dia_quinzena_2,
    dia_do_ano_dia: r.dia_do_ano_dia,
    dia_do_ano_mes: r.dia_do_ano_mes,
    proxima_data: r.proxima_data,
    data_fim: r.data_fim,
    ativo: r.ativo,
    fornecedor_nome: r.fornecedor?.razao_social ?? r.fornecedor?.nome ?? null,
    empresa_nome: r.empresa?.razao_social ?? r.empresa?.nome_fantasia ?? "",
    tipo_codigo: r.tipo?.codigo ?? "",
    subtipo_nome: r.subtipo?.nome ?? "",
  }));

  // Listas para os dropdowns do drawer de conta avulsa
  const empresasList = (empresasRes.data ?? []).map((e: { id: string; razao_social: string | null; nome_fantasia: string | null }) => ({
    id: e.id,
    nome: e.razao_social ?? e.nome_fantasia ?? "",
  }));
  const fornecedoresList = (fornecedoresRes.data ?? []).map((f: { id: string; nome: string; razao_social: string | null }) => ({
    id: f.id,
    nome: f.razao_social ?? f.nome,
  }));
  const clientesList = (clientesRes.data ?? []).map((c: { id: string; nome_fantasia: string | null; razao_social: string | null }) => ({
    id: c.id,
    nome: c.razao_social ?? c.nome_fantasia ?? "",
  }));
  const jobsList = (jobsRes.data ?? []).map(
    (j: {
      id: string;
      codigo: string;
      nome: string;
      regional_id: string | null;
      projeto: { cliente_id: string } | { cliente_id: string }[] | null;
    }) => {
      // PostgREST embed self-referencial pode vir como array — normaliza.
      const proj = Array.isArray(j.projeto) ? j.projeto[0] : j.projeto;
      return {
        id: j.id,
        codigo: j.codigo,
        nome: j.nome,
        cliente_id: proj?.cliente_id ?? null,
        regional_id: j.regional_id ?? null,
      };
    },
  );

  const regionaisList = (regionaisRes.data ?? []).map(
    (r: { id: string; nome: string; ativo: boolean }) => ({
      id: r.id,
      nome: r.nome,
      ativo: r.ativo,
    }),
  );

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <header className="space-y-2">
        <nav className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link href="/financeiro" className="hover:text-california-red transition-colors">
            Financeiro
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-california-red">Contas a Pagar</span>
        </nav>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <FileText className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Contas a Pagar</h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Avalie os Pedidos de Compra emitidos pelos GPs e os lançamentos avulsos (aluguel, folha, impostos): ajuste o prazo, dê baixa ou rejeite com motivo justificado.
        </p>
      </header>

      <ContasPagarTabs
        pps={
          <PedidosCompraList
            rows={rows}
            contas={contasRes.data ?? []}
            tipos={tiposRes.data ?? []}
            subtipos={subtiposRes.data ?? []}
          />
        }
        ppsPendentesCount={ppsPendentesCountRes.count ?? 0}
        avulsas={
          <ContasAvulsasList
            rows={avulsasRows}
            tenantId={session.activeTenant.id}
            empresas={empresasList}
            tipos={tiposRes.data ?? []}
            subtipos={subtiposRes.data ?? []}
            fornecedores={fornecedoresList}
            clientes={clientesList}
            jobs={jobsList}
            regionais={regionaisList}
          />
        }
        avulsasPendentesCount={avulsasPendentesCountRes.count ?? 0}
        recorrentes={
          <RecorrentesList
            rows={recorrentesRows}
            tenantId={session.activeTenant.id}
            empresas={empresasList}
            tipos={tiposRes.data ?? []}
            subtipos={subtiposRes.data ?? []}
            fornecedores={fornecedoresList}
            clientes={clientesList}
            jobs={jobsList}
          />
        }
        recorrentesAtivasCount={recorrentesAtivasCountRes.count ?? 0}
      />
    </div>
  );
}
