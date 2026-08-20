import { redirect } from "next/navigation";
import { FileText, ChevronRight } from "lucide-react";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PedidosCompraList, type PPRow } from "./pedidos-compra-list";
import { ContasPagarTabs } from "./contas-pagar-tabs";
import { TitulosPagarList, type TituloRow } from "./titulos-pagar-list";
import { RecorrentesList, type RecorrenteRow } from "./recorrentes-list";
import type { PPStatus, PlanoContaTipo, PlanoContaSubtipo, ContaBancaria, FormaPagamento, BandeiraCartao } from "@/lib/types";

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
    avulsasRes,
    baixasRes,
    empresasRes,
    fornecedoresRes,
    clientesRes,
    jobsRes,
    recorrentesRes,
    recorrentesAtivasCountRes,
    regionaisRes,
    cartoesRes,
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
        anexos:pedidos_compra_anexos(id, arquivo_nome_original, arquivo_tamanho_bytes),
        parcelas:pedidos_compra_parcelas(
          id, numero, data_vencimento, data_pagamento, data_pagamento_primeira,
          valor, pago_em
        )
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
      .order("codigo")
      .returns<PlanoContaTipo[]>(),
    supabase
      .from("plano_contas_subtipos")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("codigo")
      .returns<PlanoContaSubtipo[]>(),
    supabase
      .from("pedidos_compra")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "em_avaliacao"),
    // Contas avulsas (todos os status) — viram títulos de origem AVULSO ou
    // RECORRÊNCIA na aba unificada, conforme `recorrente_id`.
    supabase
      .from("contas_avulsas")
      .select(`
        id, descricao, valor, natureza, data_prevista_pagamento,
        data_pagamento, data_pagamento_primeira, status,
        pago_em, created_at, empresa_id, recorrente_id,
        plano_conta_tipo_id, plano_conta_subtipo_id,
        forma_pagamento, cartao_credito_id,
        fornecedor:fornecedores(nome, razao_social),
        job:jobs(codigo)
      `)
      .eq("tenant_id", session.activeTenant.id)
      .order("data_prevista_pagamento", { ascending: true })
      .order("created_at", { ascending: false }),
    // Baixas já realizadas — só o que a linha paga exibe no subtítulo
    // ("Pago em X · conta · centro de custo"). Sem embed pesado: três
    // nomes e nada mais.
    supabase
      .from("lancamentos_financeiros")
      .select(`
        pedido_compra_parcela_id, conta_avulsa_id, data_movimento,
        conta:contas_bancarias(nome, banco),
        tipo:plano_contas_tipos(codigo),
        subtipo:plano_contas_subtipos(nome)
      `)
      .eq("tenant_id", session.activeTenant.id)
      .in("origem", ["pp_baixa", "avulsa_baixa"]),
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
    // Cartões de crédito ativos (para o drawer de conta avulsa e Task 10)
    supabase
      .from("cartoes_credito")
      .select("id, nome, banco, bandeira, ultimos_4_digitos, dia_vencimento_fatura")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome"),
  ]);

  if (error) console.error("[financeiro.pp.list]", error.message);
  if (avulsasRes.error) console.error("[financeiro.avulsas.list]", avulsasRes.error.message);
  if (baixasRes.error) console.error("[financeiro.baixas.list]", baixasRes.error.message);
  if (recorrentesRes.error) console.error("[financeiro.recorrentes.list]", recorrentesRes.error.message);
  if (cartoesRes.error) console.error("[financeiro.cartoes.list]", cartoesRes.error.message);

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
    parcelas: Array<{
      id: string;
      numero: number;
      data_vencimento: string;
      data_pagamento: string | null;
      data_pagamento_primeira: string | null;
      valor: string | number;
      pago_em: string | null;
    }> | null;
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
    // Ordenadas aqui: o embed do PostgREST não garante ordem, e a lista
    // e o drawer mostram "1/3, 2/3, 3/3" na sequência.
    parcelas: (r.parcelas ?? [])
      .map((p) => ({
        id: p.id,
        numero: p.numero,
        data_vencimento: p.data_vencimento,
        data_pagamento: p.data_pagamento,
        data_pagamento_primeira: p.data_pagamento_primeira,
        valor: Number(p.valor),
        pago_em: p.pago_em,
      }))
      .sort((a, b) => a.numero - b.numero),
  }));

  // -------------------------------------------------------------------
  // Títulos a pagar — a visão unificada
  // -------------------------------------------------------------------
  //
  // Não há tabela de títulos (decisão do plano: nada de tabela-espelho).
  // A lista nasce da união de duas fontes já existentes, agregadas aqui
  // no servidor:
  //   • parcelas de PP aprovada ou paga → origem `pp`
  //   • `contas_avulsas` → `avulso` ou `recorrencia`, conforme
  //     `recorrente_id` (a recorrência materializa ocorrências ali)

  type BaixaInfo = { pago_em: string; conta: string; centro: string };

  const baixaPorParcela = new Map<string, BaixaInfo>();
  const baixaPorAvulsa = new Map<string, BaixaInfo>();

  for (const l of (baixasRes.data ?? []) as unknown as Array<{
    pedido_compra_parcela_id: string | null;
    conta_avulsa_id: string | null;
    data_movimento: string;
    conta: { nome: string | null; banco: string | null } | null;
    tipo: { codigo: string } | null;
    subtipo: { nome: string } | null;
  }>) {
    const info: BaixaInfo = {
      pago_em: l.data_movimento,
      conta: l.conta?.nome
        ? `${l.conta.nome}${l.conta.banco ? ` · ${l.conta.banco}` : ""}`
        : "—",
      centro:
        l.tipo?.codigo && l.subtipo?.nome
          ? `${l.tipo.codigo} · ${l.subtipo.nome}`
          : "—",
    };
    if (l.pedido_compra_parcela_id) baixaPorParcela.set(l.pedido_compra_parcela_id, info);
    if (l.conta_avulsa_id) baixaPorAvulsa.set(l.conta_avulsa_id, info);
  }

  const titulos: TituloRow[] = [];

  for (const pp of rows) {
    // PP em avaliação ainda não é dinheiro a sair — vive só na aba de PPs.
    // Rejeitada e cancelada, idem.
    if (pp.status !== "aprovada" && pp.status !== "pago") continue;
    const total = pp.parcelas.length;
    for (const par of pp.parcelas) {
      const baixa = baixaPorParcela.get(par.id);
      titulos.push({
        id: par.id,
        origem: "pp",
        origem_label: pp.codigo,
        descricao: pp.servico,
        fornecedor_nome: pp.fornecedor_nome || "—",
        job_codigo: pp.job_codigo || "—",
        data_pagamento: par.data_pagamento,
        venc_original: par.data_vencimento,
        data_pagamento_primeira: par.data_pagamento_primeira,
        valor: par.valor,
        parcela_numero: par.numero,
        parcela_total: total,
        status: par.pago_em ? "pago" : "a_pagar",
        empresa_id: pp.empresa_id,
        // A PP não carrega plano de contas — o financeiro escolhe na baixa.
        plano_conta_tipo_id: null,
        plano_conta_subtipo_id: null,
        pago_em: par.pago_em,
        conta_nome: baixa?.conta ?? null,
        centro_nome: baixa?.centro ?? null,
        // Parcelas de PP herdam forma_pagamento/cartao_credito_id da PP-pai
        // quando a PP tiver esses campos. Por ora, PPs não têm forma_pagamento
        // na query — ficam null aqui. Task 10 consumirá esses campos para
        // separar cartões da aba comum.
        forma_pagamento: null,
        cartao_credito_id: null,
      });
    }
  }

  for (const a of (avulsasRes.data ?? []) as unknown as Array<{
    id: string;
    descricao: string;
    valor: string | number;
    data_prevista_pagamento: string | null;
    data_pagamento: string | null;
    data_pagamento_primeira: string | null;
    status: "aprovada" | "baixada";
    pago_em: string | null;
    empresa_id: string;
    recorrente_id: string | null;
    plano_conta_tipo_id: string;
    plano_conta_subtipo_id: string;
    forma_pagamento: FormaPagamento | null;
    cartao_credito_id: string | null;
    fornecedor: { nome: string | null; razao_social: string | null } | null;
    job: { codigo: string } | null;
  }>) {
    const baixa = baixaPorAvulsa.get(a.id);
    titulos.push({
      id: a.id,
      origem: a.recorrente_id ? "recorrencia" : "avulso",
      origem_label: a.recorrente_id ? "RECORRÊNCIA" : "AVULSO",
      descricao: a.descricao,
      fornecedor_nome: a.fornecedor?.razao_social ?? a.fornecedor?.nome ?? "—",
      job_codigo: a.job?.codigo ?? "—",
      data_pagamento: a.data_pagamento ?? a.data_prevista_pagamento,
      venc_original: a.data_prevista_pagamento,
      data_pagamento_primeira: a.data_pagamento_primeira,
      valor: Number(a.valor),
      parcela_numero: 1,
      parcela_total: 1,
      status: a.status === "baixada" ? "pago" : "a_pagar",
      empresa_id: a.empresa_id,
      // Sugestão do centro de custo: o plano escolhido na criação.
      plano_conta_tipo_id: a.plano_conta_tipo_id,
      plano_conta_subtipo_id: a.plano_conta_subtipo_id,
      pago_em: a.pago_em,
      conta_nome: baixa?.conta ?? null,
      centro_nome: baixa?.centro ?? null,
      forma_pagamento: a.forma_pagamento,
      cartao_credito_id: a.cartao_credito_id,
    });
  }

  const titulosAPagarCount = titulos.filter((t) => t.status === "a_pagar").length;

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

  const cartoesList = (cartoesRes.data ?? []).map(
    (c: {
      id: string;
      nome: string;
      banco: string;
      bandeira: string;
      ultimos_4_digitos: string;
      dia_vencimento_fatura: number;
    }) => ({
      id: c.id,
      nome: c.nome,
      banco: c.banco,
      // O PostgREST retorna o enum como string — a coluna é do tipo
      // `bandeira_cartao` que corresponde a `BandeiraCartao` no TS.
      bandeira: c.bandeira as BandeiraCartao,
      ultimos_4_digitos: c.ultimos_4_digitos,
      dia_vencimento_fatura: c.dia_vencimento_fatura,
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
        <p className="text-sm text-muted-foreground max-w-2xl text-pretty">
          Pedidos de Produção, títulos a pagar e recorrências que envolvem
          dinheiro a sair. Aprove e rejeite os PPs; dê baixa nos títulos para
          enviá-los à conciliação.
        </p>
      </header>

      <ContasPagarTabs
        pps={<PedidosCompraList rows={rows} />}
        ppsPendentesCount={ppsPendentesCountRes.count ?? 0}
        titulos={
          <TitulosPagarList
            rows={titulos}
            modo="a_pagar"
            tenantId={session.activeTenant.id}
            contas={contasRes.data ?? []}
            tipos={tiposRes.data ?? []}
            subtipos={subtiposRes.data ?? []}
            empresas={empresasList}
            fornecedores={fornecedoresList}
            clientes={clientesList}
            jobs={jobsList}
            regionais={regionaisList}
            cartoes={cartoesList}
          />
        }
        titulosAPagarCount={titulosAPagarCount}
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
            regionais={regionaisList}
            cartoes={cartoesList}
          />
        }
        recorrentesAtivasCount={recorrentesAtivasCountRes.count ?? 0}
        titulosPagos={
          <TitulosPagarList
            rows={titulos}
            modo="pagos"
            tenantId={session.activeTenant.id}
            contas={contasRes.data ?? []}
            tipos={tiposRes.data ?? []}
            subtipos={subtiposRes.data ?? []}
            empresas={empresasList}
            fornecedores={fornecedoresList}
            clientes={clientesList}
            jobs={jobsList}
            regionais={regionaisList}
            cartoes={cartoesList}
          />
        }
      />
    </div>
  );
}
