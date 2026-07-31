import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FolderTree, Download } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  versaoStatusLabel,
  type VersaoOrcamento,
  type VersaoOrcamentoGrupo,
  type VersaoOrcamentoItem,
  type Categoria,
} from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { calcularTotaisVersao } from "@/lib/calculos/versao-totais";
import { GruposSection } from "./grupos-section";
import { NovoGrupoDrawer } from "./novo-grupo-drawer";
import { TotaisCard } from "./totais-card";
import { VersaoEditorDrawer } from "./versao-editor-drawer";
import { AprovacaoActions } from "./aprovacao-actions";
import {
  BannersEstado,
  FluxoAbertura,
  type JobExistente,
} from "./fluxo-abertura";

export const dynamic = "force-dynamic";

function statusBadgeClasses(status: VersaoOrcamento["status"]): string {
  switch (status) {
    case "rascunho":
      return "bg-muted text-muted-foreground border-border";
    case "em_revisao":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "enviada_cliente":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "aprovada":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "reprovada":
      return "bg-rose-50 text-rose-700 border-rose-200";
    case "substituida":
      return "bg-slate-100 text-slate-600 border-slate-200";
    case "cancelada":
      return "bg-slate-100 text-slate-500 border-slate-200";
  }
}

export default async function VersaoDetailPage({
  params,
}: {
  params: { projetoId: string; orcId: string; versaoId: string };
}) {
  const session = await requireSession();
  const supabase = createClient();

  const [
    versaoRes,
    orcRes,
    gruposRes,
    itensRes,
    categoriasRes,
    jobRes,
    regionaisRes,
    cidadesRes,
  ] = await Promise.all([
    supabase
      .from("versoes_orcamento")
      .select("*")
      .eq("id", params.versaoId)
      .eq("orcamento_id", params.orcId)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle<VersaoOrcamento>(),
    supabase
      .from("orcamentos")
      .select(
        "id, codigo, nome, status, projeto_id, data_inicio_prevista, data_fim_prevista",
      )
      .eq("id", params.orcId)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle<{
        id: string;
        codigo: string;
        nome: string;
        status: string;
        projeto_id: string;
        data_inicio_prevista: string | null;
        data_fim_prevista: string | null;
      }>(),
    supabase
      .from("versoes_orcamento_grupos")
      .select("*")
      .eq("versao_orcamento_id", params.versaoId)
      .eq("tenant_id", session.activeTenant.id)
      .order("ordem", { ascending: true })
      .returns<VersaoOrcamentoGrupo[]>(),
    supabase
      .from("versoes_orcamento_itens")
      .select("*")
      .eq("versao_orcamento_id", params.versaoId)
      .eq("tenant_id", session.activeTenant.id)
      .order("ordem", { ascending: true })
      .returns<VersaoOrcamentoItem[]>(),
    supabase
      .from("categorias")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .order("nome", { ascending: true })
      .returns<Categoria[]>(),
    supabase
      .from("jobs")
      .select(
        "id, codigo, nome, produto, cidade, regional_id, data_inicio_prevista, data_fim_prevista, data_prevista_faturamento, observacoes",
      )
      .eq("orcamento_id", params.orcId)
      .eq("tenant_id", session.activeTenant.id)
      .neq("status", "cancelado")
      .maybeSingle<JobExistente>(),
    supabase
      .from("regionais")
      .select("id, nome")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome"),
    // Primeiras cidades do cadastro. A busca completa roda no servidor,
    // sob demanda — ver `buscarCidades` em abertura-actions.
    supabase
      .from("cidades")
      .select("id, nome")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome")
      .limit(30),
  ]);

  if (versaoRes.error) console.error("[versao.detail]", versaoRes.error.message);
  if (gruposRes.error) console.error("[versao.grupos]", gruposRes.error.message);
  if (itensRes.error) console.error("[versao.itens]", itensRes.error.message);
  if (categoriasRes.error) console.error("[versao.categorias]", categoriasRes.error.message);

  const job = jobRes.data ?? null;
  const temJobAtivo = job !== null;

  const versao = versaoRes.data;
  const orcamento = orcRes.data;
  if (!versao || !orcamento) notFound();

  const grupos = (gruposRes.data ?? []) as VersaoOrcamentoGrupo[];
  const categorias = (categoriasRes.data ?? []) as Categoria[];
  const itens: VersaoOrcamentoItem[] = (itensRes.data ?? []).map((it: any) => ({
    ...it,
    valor_unitario_orcado: Number(it.valor_unitario_orcado ?? 0),
    quantidade_orcada: Number(it.quantidade_orcada ?? 1),
    dias_meses_orcado: Number(it.dias_meses_orcado ?? 1),
    total_orcado: Number(it.total_orcado ?? 0),
    valor_unitario_planejado: Number(it.valor_unitario_planejado ?? 0),
    quantidade_planejada: Number(it.quantidade_planejada ?? 0),
    dias_meses_planejado: Number(it.dias_meses_planejado ?? 0),
    total_planejado: Number(it.total_planejado ?? 0),
  }));

  // Agrupa itens por grupo_id para passar para cada GrupoCard.
  const itensPorGrupo = new Map<string, VersaoOrcamentoItem[]>();
  for (const g of grupos) itensPorGrupo.set(g.id, []);
  for (const it of itens) {
    const list = itensPorGrupo.get(it.grupo_id);
    if (list) list.push(it);
  }

  const readOnly = versao.status === "aprovada" || versao.status === "cancelada";

  // Segunda onda: depende de orcamento.projeto_id, por isso não entra no
  // Promise.all acima. Só o fluxo de abertura consome esses dados.
  const [projetoRes, jobsCountRes] = await Promise.all([
    supabase
      .from("projetos")
      .select("id, codigo, nome, cliente_id, cliente:clientes(id, nome_fantasia), responsavel:profiles!responsavel_id(nome)")
      .eq("id", orcamento.projeto_id)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle(),
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id),
  ]);

  const projetoRaw = projetoRes.data as any;
  const clienteId: string = projetoRaw?.cliente_id ?? "";
  const clienteNome: string = projetoRaw?.cliente?.nome_fantasia ?? "—";
  const responsavelNome: string = projetoRaw?.responsavel?.nome ?? "—";
  const projetoNome: string = projetoRaw?.nome ?? "—";
  const projetoCodigo: string = projetoRaw?.codigo ?? "—";

  const produtosRes = clienteId
    ? await supabase
        .from("cliente_produtos")
        .select("id, nome, codigo")
        .eq("cliente_id", clienteId)
        .eq("tenant_id", session.activeTenant.id)
        .eq("ativo", true)
        .order("codigo")
    : { data: [], error: null };

  if (produtosRes.error) {
    console.error("[versao.produtos]", produtosRes.error.message);
  }

  const totais = calcularTotaisVersao(
    itens,
    Number(versao.percentual_honorarios),
    Number(versao.percentual_imposto),
  );
  const custoPlanejado = itens.reduce(
    (s, it) => s + Number(it.total_planejado ?? 0),
    0,
  );

  const cidadesIniciais = (cidadesRes.data ?? []) as { id: string; nome: string }[];
  const regionais = (regionaisRes.data ?? []) as { id: string; nome: string }[];

  // Preview do código: o definitivo é gerado no insert. Serve só pra tela
  // não mostrar campo vazio — se outro job entrar antes, o número muda.
  const proximoCodigoJob = `JOB-${((jobsCountRes.count ?? 0) + 1)
    .toString()
    .padStart(4, "0")}`;

  const cidadeDoJob = job?.cidade
    ? cidadesIniciais.find((c) => c.nome === job.cidade) ?? {
        id: "",
        nome: job.cidade,
      }
    : null;

  const inicialModal = {
    nome: job?.nome ?? orcamento.nome,
    produtoId:
      (job?.produto
        ? (produtosRes.data ?? []).find((p: any) => p.nome === job.produto)?.id
        : undefined) ?? "",
    cidade: cidadeDoJob,
    regionalId: job?.regional_id ?? "",
    dataInicio: job?.data_inicio_prevista ?? orcamento.data_inicio_prevista ?? "",
    dataFim: job?.data_fim_prevista ?? orcamento.data_fim_prevista ?? "",
    dataFaturamento: job?.data_prevista_faturamento ?? "",
    observacoes: job?.observacoes ?? "",
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <Link
          href={`/orcamentos/${params.projetoId}/${orcamento.id}`}
          prefetch={false}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para {orcamento.codigo} · {orcamento.nome}
        </Link>

        <div className="mt-3 flex flex-wrap items-baseline gap-3">
          <p className="font-mono text-xs font-semibold text-muted-foreground">
            v{versao.numero_versao}
          </p>
          <h1 className="text-3xl font-bold tracking-tight">
            {versao.nome ?? `Versão ${versao.numero_versao}`}
          </h1>
          <Badge className={cn("border", statusBadgeClasses(versao.status))}>
            {versaoStatusLabel(versao.status)}
          </Badge>
          <VersaoEditorDrawer
            versao={versao}
            disabled={versao.status === "aprovada"}
            disabledReason={
              versao.status === "aprovada"
                ? "Versão aprovada não pode ser editada."
                : undefined
            }
          />
          <AprovacaoActions
            versaoId={versao.id}
            status={versao.status}
            temJobAtivo={temJobAtivo}
          />
          <a
            href={`/api/orcamentos/${params.projetoId}/${params.orcId}/versoes/${versao.id}/export`}
            title="Baixar planilha XLSX"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground hover:border-california-red/40 hover:text-california-red transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Exportar
          </a>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>
            <span className="text-foreground/60">Moeda:</span>{" "}
            <span className="text-foreground font-medium">{versao.moeda}</span>
          </span>
          {Number(versao.taxa_cambio) !== 1 && (
            <>
              <span aria-hidden className="text-border">·</span>
              <span>
                <span className="text-foreground/60">Câmbio:</span>{" "}
                <span className="text-foreground font-medium">
                  {Number(versao.taxa_cambio)}
                </span>
              </span>
            </>
          )}
          <span aria-hidden className="text-border">·</span>
          <span>
            <span className="text-foreground/60">Honorários:</span>{" "}
            <span className="text-foreground font-medium">
              {Number(versao.percentual_honorarios).toString().replace(".", ",")}%
            </span>
          </span>
          <span aria-hidden className="text-border">·</span>
          <span>
            <span className="text-foreground/60">Impostos:</span>{" "}
            <span className="text-foreground font-medium">
              {Number(versao.percentual_imposto).toString().replace(".", ",")}%
            </span>
          </span>
        </div>
      </div>

      <BannersEstado
        versaoLabel={`v${versao.numero_versao}`}
        aprovada={versao.status === "aprovada"}
        job={job}
        jobHref={job ? `/jobs/${job.id}` : null}
      />

      {/* Barra de ação — Novo grupo */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <FolderTree className="h-4 w-4 text-california-red" />
          <span>
            {grupos.length} {grupos.length === 1 ? "grupo" : "grupos"} ·{" "}
            {itens.length} {itens.length === 1 ? "item" : "itens"} no total
          </span>
        </div>
        {!readOnly && (
          <div className="flex items-center gap-2">
            <NovoGrupoDrawer versaoId={versao.id} />
          </div>
        )}
      </div>

      {/* Grupos + Totais dividem a mesma calha: é o que faz as colunas
          Total / Rentab. / % do card de Totais caírem exatamente sob as
          mesmas colunas dos cards de grupo. O pr reserva a trilha de ações
          (Remover), que fica fora do frame de cada card. */}
      <div className={cn("space-y-6", !readOnly && "pr-12")}>
        {grupos.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-12 text-center">
            <FolderTree className="h-10 w-10 text-muted-foreground/50 mx-auto mb-4" />
            <p className="text-sm text-muted-foreground">
              Nenhum grupo ainda. Crie o primeiro grupo para começar a adicionar itens.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Exemplos: Equipe, Ativação, Staff, Logística...
            </p>
          </div>
        ) : (
          <GruposSection
            secoes={grupos.map((g) => ({
              grupo: g,
              itens: itensPorGrupo.get(g.id) ?? [],
            }))}
            moeda={versao.moeda}
            readOnly={readOnly}
            categorias={categorias}
          />
        )}

        <TotaisCard
          grupos={grupos}
          itens={itens}
          percentualHonorarios={Number(versao.percentual_honorarios)}
          percentualImposto={Number(versao.percentual_imposto)}
          moeda={versao.moeda}
        />
      </div>

      <FluxoAbertura
        versaoId={versao.id}
        versaoLabel={`v${versao.numero_versao}`}
        versaoStatus={versao.status}
        orcamentoCodigo={orcamento.codigo}
        jobHref={job ? `/jobs/${job.id}` : null}
        qtdGrupos={grupos.length}
        qtdItens={itens.length}
        custoPlanejado={custoPlanejado}
        faturamento={totais.faturamento}
        moeda={versao.moeda}
        clienteId={clienteId}
        clienteNome={clienteNome}
        responsavelNome={responsavelNome}
        proximoCodigoJob={proximoCodigoJob}
        projetoNome={projetoNome}
        projetoCodigo={projetoCodigo}
        produtos={(produtosRes.data ?? []) as { id: string; nome: string; codigo: string }[]}
        regionais={regionais}
        cidadesIniciais={cidadesIniciais}
        inicial={inicialModal}
        job={job}
      />
    </div>
  );
}
