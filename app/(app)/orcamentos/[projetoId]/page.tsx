import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText, Layers } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listActiveMembers } from "@/lib/data/members";
import { listEmpresasAtivas } from "@/lib/data/empresas";
import { escolherJobDoFunil, estagioFunil } from "@/lib/calculos/funil";
import {
  calcularTotaisVersao,
  type ItemParaTotais,
} from "@/lib/calculos/versao-totais";
import type {
  CategoriaDominio,
  Cliente,
  JobStatus,
  Orcamento,
  Profile,
  Projeto,
  Regional,
  TipoCusto,
} from "@/lib/types";
import { projetoStatusLabel } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ProjetoEditorDrawer } from "../projeto-editor-drawer";
import type { ProdutoOption } from "../projeto-form";
import { NovoOrcamentoMenu } from "./novo-orcamento-menu";
import { OrcamentosList, type OrcamentoRow } from "./orcamentos-list";

export const dynamic = "force-dynamic";

function projetoBadgeClasses(status: Projeto["status"]): string {
  return status === "ativo"
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : "bg-slate-100 text-slate-500 border-slate-200";
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export default async function ProjetoDetailPage({
  params,
}: {
  params: { projetoId: string };
}) {
  const session = await requireSession();
  const supabase = createClient();

  const [projRes, orcsRes, clientesRes, responsaveis, regionaisRes, categoriasProjRes, empresas, produtosRes, vinculosRegRes, vinculosRespRes] = await Promise.all([
    supabase
      .from("projetos")
      .select(
        "id, tenant_id, empresa_id, codigo, nome, campanha, status, cliente_id, produto_id, responsavel_id, regional_id, cidade_id, categoria_id, data_inicio_prevista, data_fim_prevista, descricao, created_by, created_at, updated_at, cliente:clientes(id, nome_fantasia), produto:cliente_produtos(id, nome), empresa:empresas(id, razao_social, nome_fantasia)",
      )
      .eq("id", params.projetoId)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle(),
    supabase
      .from("orcamentos")
      .select(
        // `!categoria_id` é obrigatório desde 02/09/2026: `orcamentos` passou
        // a ter DUAS FKs para `categorias_dominio` (categoria e servico), e
        // sem desambiguar o PostgREST recusa o embed e devolve zero linhas.
        "id, codigo, nome, status, versao_aprovada_id, produtor_id, data_inicio_prevista, data_fim_prevista, created_at, " +
          "categoria:categorias_dominio!categoria_id(nome), " +
          "servico:categorias_dominio!servico_id(nome)",
      )
      .eq("projeto_id", params.projetoId)
      .eq("tenant_id", session.activeTenant.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("clientes")
      .select("id, nome_fantasia, codigo_curto")
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo")
      .order("nome_fantasia"),
    listActiveMembers(session.activeTenant.id),
    supabase
      .from("regionais")
      .select("id, nome")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome"),
    supabase
      .from("categorias_dominio")
      .select("id, nome")
      .eq("tenant_id", session.activeTenant.id)
      .eq("escopo", "projeto")
      .eq("ativo", true)
      .order("nome"),
    listEmpresasAtivas(session.activeTenant.id),
    supabase
      .from("cliente_produtos")
      .select("id, nome, codigo, cliente_id")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("codigo"),
    supabase
      .from("projeto_regionais")
      .select("regional_id, regional:regionais(id, nome)")
      .eq("projeto_id", params.projetoId)
      .eq("tenant_id", session.activeTenant.id),
    supabase
      .from("projeto_responsaveis")
      .select("profile_id, papel, profile:profiles(id, nome)")
      .eq("projeto_id", params.projetoId)
      .eq("tenant_id", session.activeTenant.id),
  ]);

  if (projRes.error) console.error("[projeto.detail]", projRes.error.message);
  const raw = projRes.data as any;
  if (!raw) notFound();

  const projeto: Projeto = {
    id: raw.id,
    tenant_id: raw.tenant_id,
    empresa_id: raw.empresa_id,
    codigo: raw.codigo,
    nome: raw.nome,
    campanha: raw.campanha,
    status: raw.status,
    cliente_id: raw.cliente_id,
    produto_id: raw.produto_id,
    responsavel_id: raw.responsavel_id,
    regional_id: raw.regional_id,
    cidade_id: raw.cidade_id,
    categoria_id: raw.categoria_id,
    data_inicio_prevista: raw.data_inicio_prevista,
    data_fim_prevista: raw.data_fim_prevista,
    descricao: raw.descricao,
    created_by: raw.created_by,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };
  const clienteNome: string | null = raw.cliente?.nome_fantasia ?? null;
  const produtoNome: string | null = raw.produto?.nome ?? null;
  const empresaNome: string | null = raw.empresa?.nome_fantasia ?? raw.empresa?.razao_social ?? null;

  const regionais = (regionaisRes.data ?? []) as Pick<Regional, "id" | "nome">[];
  const produtos = (produtosRes.data ?? []) as ProdutoOption[];
  const categoriasProjeto = (categoriasProjRes.data ?? []) as Pick<CategoriaDominio, "id" | "nome">[];

  // Regionais e responsáveis do projeto: alimentam o cabeçalho, o editor
  // e — importante — as opções de Regional e GP no formulário do orçamento.
  const regionaisDoProjeto = ((vinculosRegRes.data ?? []) as any[])
    .filter((v) => v.regional)
    .map((v) => ({ id: v.regional.id as string, nome: v.regional.nome as string }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  const vinculosResp = (vinculosRespRes.data ?? []) as any[];

  // GPs são papel `gp`; papel `equipe` são os acréscimos manuais. Linhas
  // antigas nasceram todas como `gp` no backfill da migration.
  const responsaveisDoProjeto = vinculosResp
    .filter((v) => v.profile && v.papel !== "equipe")
    .map((v) => ({ id: v.profile.id as string, nome: v.profile.nome as string }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")) as Pick<Profile, "id" | "nome">[];

  const equipeManualDoProjeto = vinculosResp
    .filter((v) => v.profile && v.papel === "equipe")
    .map((v) => v.profile.id as string);

  // Produtores dos orçamentos entram na Equipe travados (decisão 037).
  const produtoresDosOrcamentos = Array.from(
    new Set(
      ((orcsRes.data ?? []) as any[])
        .map((o) => o.produtor_id as string | null)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const orcamentosBrutos = (orcsRes.data ?? []) as any[];
  const orcamentoIds = orcamentosBrutos.map((o) => o.id);

  // Versões (contagem + escolha da versão-alvo do valor) e jobs (estágio
  // do funil) por orçamento — queries paralelas e leves, sem embed.
  const versoesCountMap = new Map<string, number>();
  type VersaoLeve = {
    id: string;
    orcamento_id: string;
    numero_versao: number;
    percentual_honorarios: number;
    percentual_imposto: number;
    created_at: string;
  };
  const versoesPorOrcamento = new Map<string, VersaoLeve[]>();
  const jobsPorOrcamento = new Map<string, { status: JobStatus; created_at: string }[]>();
  // Valor do job por orçamento: versão APROVADA quando existir; senão a
  // mais recente (número em negociação). Sem versão → null (travessão).
  const valorJobMap = new Map<string, number>();

  if (orcamentoIds.length > 0) {
    const [versoesRes, jobsRes] = await Promise.all([
      supabase
        .from("versoes_orcamento")
        .select("id, orcamento_id, numero_versao, percentual_honorarios, percentual_imposto, created_at")
        .in("orcamento_id", orcamentoIds)
        .eq("tenant_id", session.activeTenant.id),
      supabase
        .from("jobs")
        .select("orcamento_id, status, created_at")
        .in("orcamento_id", orcamentoIds)
        .eq("tenant_id", session.activeTenant.id),
    ]);
    if (versoesRes.error) console.error("[projeto.versoes]", versoesRes.error.message);
    if (jobsRes.error) console.error("[projeto.jobs]", jobsRes.error.message);

    for (const v of ((versoesRes.data ?? []) as VersaoLeve[])) {
      versoesCountMap.set(v.orcamento_id, (versoesCountMap.get(v.orcamento_id) ?? 0) + 1);
      const atuais = versoesPorOrcamento.get(v.orcamento_id) ?? [];
      atuais.push(v);
      versoesPorOrcamento.set(v.orcamento_id, atuais);
    }
    for (const j of ((jobsRes.data ?? []) as any[])) {
      const atuais = jobsPorOrcamento.get(j.orcamento_id) ?? [];
      atuais.push({ status: j.status as JobStatus, created_at: j.created_at });
      jobsPorOrcamento.set(j.orcamento_id, atuais);
    }

    // Versão-alvo de cada orçamento (aprovada > mais recente)…
    const versaoAlvoPorOrcamento = new Map<string, VersaoLeve>();
    for (const o of orcamentosBrutos) {
      const versoes = versoesPorOrcamento.get(o.id) ?? [];
      if (versoes.length === 0) continue;
      const aprovada = o.versao_aprovada_id
        ? versoes.find((v) => v.id === o.versao_aprovada_id)
        : undefined;
      const alvo =
        aprovada ??
        [...versoes].sort(
          (a, b) =>
            b.numero_versao - a.numero_versao ||
            b.created_at.localeCompare(a.created_at),
        )[0];
      versaoAlvoPorOrcamento.set(o.id, alvo);
    }

    // …e os itens SÓ dessas versões, no mínimo necessário pro cálculo.
    const versaoAlvoIds = [...versaoAlvoPorOrcamento.values()].map((v) => v.id);
    if (versaoAlvoIds.length > 0) {
      const { data: itens, error: itensErr } = await supabase
        .from("versoes_orcamento_itens")
        .select("versao_orcamento_id, tipo_custo, total_orcado, em_save, save_consumido")
        .in("versao_orcamento_id", versaoAlvoIds)
        .eq("tenant_id", session.activeTenant.id);
      if (itensErr) console.error("[projeto.itens]", itensErr.message);

      const itensPorVersao = new Map<string, ItemParaTotais[]>();
      for (const it of ((itens ?? []) as any[])) {
        const atuais = itensPorVersao.get(it.versao_orcamento_id) ?? [];
        atuais.push({
          tipo_custo: it.tipo_custo,
          total_orcado: Number(it.total_orcado ?? 0),
          em_save: it.em_save === true,
          save_consumido: Number(it.save_consumido ?? 0),
        });
        itensPorVersao.set(it.versao_orcamento_id, atuais);
      }

      for (const [orcId, versao] of versaoAlvoPorOrcamento) {
        // A MESMA definição de "Valor do job" do fechamento da versão
        // (calcularTotaisVersao): principal com valorJob + honorários + imposto.
        const totais = calcularTotaisVersao(
          itensPorVersao.get(versao.id) ?? [],
          Number(versao.percentual_honorarios ?? 0),
          Number(versao.percentual_imposto ?? 0),
        );
        valorJobMap.set(orcId, totais.valorJob);
      }
    }
  }

  const orcamentos: OrcamentoRow[] = orcamentosBrutos.map((o) => ({
    id: o.id,
    codigo: o.codigo,
    nome: o.nome,
    categoria_nome: o.categoria?.nome ?? null,
    servico_nome: o.servico?.nome ?? null,
    estagio: estagioFunil(
      o.status as Orcamento["status"],
      escolherJobDoFunil(jobsPorOrcamento.get(o.id) ?? []),
    ),
    data_inicio_prevista: o.data_inicio_prevista,
    data_fim_prevista: o.data_fim_prevista,
    valor_job: valorJobMap.get(o.id) ?? null,
    versoes_count: versoesCountMap.get(o.id) ?? 0,
    created_at: o.created_at,
  }));

  const clientes = (clientesRes.data ?? []) as Pick<
    Cliente,
    "id" | "nome_fantasia" | "codigo_curto"
  >[];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <Link
          href="/orcamentos"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para projetos
        </Link>

        <div className="mt-3">
          <p className="font-mono text-xs font-semibold text-muted-foreground">
            {projeto.codigo}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{projeto.nome}</h1>
            <Badge className={cn("border", projetoBadgeClasses(projeto.status))}>
              {projetoStatusLabel(projeto.status)}
            </Badge>
            <ProjetoEditorDrawer
              projeto={projeto}
              empresas={empresas}
              clientes={clientes}
              responsaveis={responsaveis}
              regionais={regionais}
              produtos={produtos}
              categorias={categoriasProjeto}
              regionaisSelecionadas={regionaisDoProjeto.map((r) => r.id)}
              responsaveisSelecionados={responsaveisDoProjeto.map((r) => r.id)}
              equipeSelecionada={equipeManualDoProjeto}
              produtoresDosOrcamentos={produtoresDosOrcamentos}
            />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>
              <span className="text-foreground/60">Cliente:</span>{" "}
              <span className="text-foreground font-medium">{clienteNome ?? "—"}</span>
            </span>
            {produtoNome && (
              <>
                <span aria-hidden className="text-border">·</span>
                <span>
                  <span className="text-foreground/60">Marca:</span>{" "}
                  <span className="text-foreground font-medium">{produtoNome}</span>
                </span>
              </>
            )}
            <span aria-hidden className="text-border">·</span>
            <span>
              <span className="text-foreground/60">
                {responsaveisDoProjeto.length > 1 ? "Responsáveis:" : "Responsável:"}
              </span>{" "}
              <span className="text-foreground font-medium">
                {responsaveisDoProjeto.length > 0
                  ? responsaveisDoProjeto.map((r) => r.nome).join(", ")
                  : "—"}
              </span>
            </span>
            <span aria-hidden className="text-border">·</span>
            <span>
              <span className="text-foreground/60">Empresa:</span>{" "}
              <span className="text-foreground font-medium">{empresaNome ?? "—"}</span>
            </span>
            {regionaisDoProjeto.length > 0 && (
              <>
                <span aria-hidden className="text-border">·</span>
                <span>
                  <span className="text-foreground/60">
                    {regionaisDoProjeto.length > 1 ? "Regionais:" : "Regional:"}
                  </span>{" "}
                  <span className="text-foreground font-medium">
                    {regionaisDoProjeto.map((r) => r.nome).join(", ")}
                  </span>
                </span>
              </>
            )}
            <span aria-hidden className="text-border">·</span>
            <span>
              <span className="text-foreground/60">Período:</span>{" "}
              <span className="text-foreground font-medium">
                {formatDate(projeto.data_inicio_prevista)}
                {projeto.data_fim_prevista
                  ? ` — ${formatDate(projeto.data_fim_prevista)}`
                  : ""}
              </span>
            </span>
            {/* "Serviço" saiu do resumo do projeto em 02/09/2026 (037): ele
                virou designação do JOB, e cada orçamento tem o seu — mostrar
                um só aqui, vindo da coluna legada `projetos.categoria_id`,
                contradiria a tabela logo abaixo. Ele agora vive numa coluna
                dela. */}
            {projeto.campanha && (
              <>
                <span aria-hidden className="text-border">·</span>
                <span>
                  <span className="text-foreground/60">Campanha:</span>{" "}
                  <span className="text-foreground font-medium">{projeto.campanha}</span>
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-soft">
        <div className="flex items-center justify-between border-b border-border p-6">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-california-red" />
            <div>
              <h2 className="text-lg font-semibold leading-none tracking-tight">
                Orçamentos do projeto
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Cada orçamento corresponde a um entregável (peça) e gera um job próprio quando aprovado.
              </p>
            </div>
          </div>
          <div className="flex flex-none items-center gap-3">
            {orcamentos.length > 0 && (
              <Link
                href={`/orcamentos/${projeto.id}/agregado`}
                prefetch={false}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
              >
                <Layers className="h-4 w-4" />
                Visão agregada
              </Link>
            )}
            <NovoOrcamentoMenu projetoId={projeto.id} />
          </div>
        </div>
        <div className="p-6">
          <OrcamentosList projetoId={projeto.id} orcamentos={orcamentos} />
        </div>
      </div>
    </div>
  );
}
