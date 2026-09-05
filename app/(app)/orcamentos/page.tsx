import Link from "next/link";
import { FolderKanban, Plus, FileText, Tags } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { escolherJobDoFunil, estagioFunil } from "@/lib/calculos/funil";
import type { Cliente, JobStatus, OrcamentoStatus, Projeto } from "@/lib/types";
import { pode } from "@/lib/permissoes";
import { EmptyState } from "@/components/empty-state";
import { ProjetosList, type ProjetoRow } from "./projetos-list";

export const dynamic = "force-dynamic";

export default async function ProjetosPage({
  searchParams,
}: {
  searchParams?: { filtro?: string };
}) {
  const session = await requireSession();
  const supabase = createClient();
  const filtro = searchParams?.filtro;

  const [projRes, clientesRes] = await Promise.all([
    supabase
      .from("projetos")
      .select(
        "id, codigo, nome, campanha, status, cliente_id, produto_id, " +
          "data_inicio_prevista, created_at, " +
          // Descrição do projeto: alimenta o cartão do ícone na coluna
          // Nome (handoff "Descritivos nas Listas", 04/09/2026). É texto
          // curto — média de 80 caracteres, teto de 600 — e vem junto da
          // linha em vez de abrir uma segunda query.
          "descricao, " +
          // Vínculos do recorte "Meus" (decisão 036, ampliada em
          // 02/09/2026): designado OU criador.
          "responsavel_id, created_by, " +
          "cliente:clientes(id, nome_fantasia), " +
          "produto:cliente_produtos(id, nome), " +
          "categoria:categorias_dominio(nome)",
      )
      .eq("tenant_id", session.activeTenant.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("clientes")
      .select("id, nome_fantasia")
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo")
      .order("nome_fantasia"),
  ]);

  if (projRes.error) console.error("[projetos.page]", projRes.error.message);
  if (clientesRes.error) console.error("[projetos.clientes]", clientesRes.error.message);

  const projetosBrutos = ((projRes.data ?? []) as any[]);
  const projetoIds = projetosBrutos.map((p) => p.id);

  // Contagens agregadas de orçamentos por projeto (SEM embed pesado).
  // total = todos os orçamentos, qualquer status; as 3 colunas do funil
  // (Aprovados / Enviados / Abertos) são mutuamente exclusivas e vêm de
  // `estagioFunil` — a mesma função que rotula as linhas no detalhe do
  // projeto (lib/calculos/funil.ts).
  const orcamentosCountMap = new Map<string, number>();
  const aprovadosCountMap = new Map<string, number>();
  const enviadosCountMap = new Map<string, number>();
  const abertosCountMap = new Map<string, number>();
  // Regionais do projeto: N:N, então vêm numa query própria em vez de
  // embed na listagem (o embed devolveria a linha do projeto repetida).
  const regionaisMap = new Map<string, { id: string; nome: string }[]>();
  /**
   * Projetos do recorte "Meus" — decisão 036, ampliada pelo Tiago em
   * 02/09/2026: **qualquer usuário associado ao projeto ou a um orçamento
   * dentro dele**, seja como designado ou como criador.
   *
   * São sete vínculos, e basta UM:
   * - projeto: `responsavel_id`, `created_by`, `projeto_responsaveis`
   * - orçamento: `gp_responsavel_id`, `produtor_id`, `created_by`
   * - versão do orçamento: `created_by`
   *
   * O vínculo por JOB (responsável/produtor) continua valendo por cima
   * disso. Ele era a regra inteira até 01/09 e hoje é redundante na base
   * — todo projeto que ele alcança já vem por outro vínculo —, mas sair
   * dele tiraria projetos de quem só está no job, e a mudança era para
   * ampliar o recorte, não para estreitar.
   */
  const meusProjetoIds = new Set<string>();
  /** GPs Responsáveis de cada projeto, por nome. A coluna Serviço saiu da
   *  lista em 02/09/2026 e deu lugar a esta: Serviço passou a ser
   *  designação do job (037), e quem a lista precisa mostrar é quem
   *  responde pelo projeto. */
  const gpsPorProjeto = new Map<string, string[]>();
  for (const p of projetosBrutos) {
    if (p.responsavel_id === session.profile.id || p.created_by === session.profile.id) {
      meusProjetoIds.add(p.id);
    }
  }

  if (projetoIds.length > 0) {
    const [orcsRes, jobsRes, vinculosRes, responsaveisRes, versoesMinhasRes] =
      await Promise.all([
      (() => {
        // Filtro de aterrissagem da home: orcamentos por status/data
        let q = supabase
          .from("orcamentos")
          .select(
            "id, projeto_id, status, gp_responsavel_id, produtor_id, created_by, updated_at",
          )
          .in("projeto_id", projetoIds)
          .eq("tenant_id", session.activeTenant.id);
        if (filtro === "aguardando_aprovacao") {
          q = q.eq("status", "em_revisao");
        } else if (filtro === "parados") {
          const ha15 = new Date();
          ha15.setDate(ha15.getDate() - 15);
          const ha15iso = ha15.toISOString().slice(0, 10);
          q = q
            .in("status", ["rascunho", "em_revisao"])
            .lt("updated_at", ha15iso);
        }
        return q;
      })(),
      supabase
        .from("jobs")
        // `projeto_id`, `responsavel_id` e `produtor_id` entram para o
        // recorte "Meus" da lista — aproveitando esta query em vez de
        // abrir uma segunda (ver docs/PERFORMANCE.md).
        .select(
          "orcamento_id, status, created_at, projeto_id, responsavel_id, produtor_id",
        )
        .in("projeto_id", projetoIds)
        .eq("tenant_id", session.activeTenant.id),
      supabase
        .from("projeto_regionais")
        .select("projeto_id, regional:regionais(id, nome)")
        .in("projeto_id", projetoIds)
        .eq("tenant_id", session.activeTenant.id),
      // As duas pontas do recorte "Meus" que não cabem nas queries acima.
      // Ambas já filtradas por MIM: voltam poucas linhas, e não uma
      // varredura para depois descartar no cliente.
      // Uma consulta só: alimenta a coluna GP Responsável E o recorte
      // "Meus". Filtrar por mim aqui pediria uma segunda ida ao banco para
      // a coluna, e são poucas linhas (uma por vínculo de projeto).
      supabase
        .from("projeto_responsaveis")
        .select("projeto_id, profile_id, papel, profile:profiles(nome)")
        .in("projeto_id", projetoIds)
        .eq("tenant_id", session.activeTenant.id),
      supabase
        .from("versoes_orcamento")
        .select("orcamento_id")
        .eq("created_by", session.profile.id)
        .eq("tenant_id", session.activeTenant.id),
    ]);
    if (jobsRes.error) console.error("[projetos.jobs]", jobsRes.error.message);

    // Jobs por orçamento — quase sempre 1; com mais de um, o funil olha o
    // não-cancelado mais recente (escolherJobDoFunil).
    const jobsPorOrcamento = new Map<string, { status: JobStatus; created_at: string }[]>();
    for (const j of ((jobsRes.data ?? []) as any[])) {
      const atuais = jobsPorOrcamento.get(j.orcamento_id) ?? [];
      atuais.push({ status: j.status as JobStatus, created_at: j.created_at });
      jobsPorOrcamento.set(j.orcamento_id, atuais);
      if (
        j.projeto_id &&
        (j.responsavel_id === session.profile.id ||
          j.produtor_id === session.profile.id)
      ) {
        meusProjetoIds.add(j.projeto_id);
      }
    }

    // A versão sabe o orçamento, não o projeto — este mapa faz a ponte.
    const projetoPorOrcamento = new Map<string, string>();

    for (const o of ((orcsRes.data ?? []) as any[])) {
      projetoPorOrcamento.set(o.id, o.projeto_id);
      if (
        o.gp_responsavel_id === session.profile.id ||
        o.produtor_id === session.profile.id ||
        o.created_by === session.profile.id
      ) {
        meusProjetoIds.add(o.projeto_id);
      }
      orcamentosCountMap.set(o.projeto_id, (orcamentosCountMap.get(o.projeto_id) ?? 0) + 1);
      const jobStatus = escolherJobDoFunil(jobsPorOrcamento.get(o.id) ?? []);
      const estagio = estagioFunil(o.status as OrcamentoStatus, jobStatus);
      if (estagio === "aprovado") {
        aprovadosCountMap.set(o.projeto_id, (aprovadosCountMap.get(o.projeto_id) ?? 0) + 1);
      } else if (estagio === "enviado") {
        enviadosCountMap.set(o.projeto_id, (enviadosCountMap.get(o.projeto_id) ?? 0) + 1);
      } else if (estagio === "aberto") {
        abertosCountMap.set(o.projeto_id, (abertosCountMap.get(o.projeto_id) ?? 0) + 1);
      }
      // "orcamento" e "cancelado" ficam fora do funil: contam só no total.
    }

    for (const v of ((responsaveisRes.data ?? []) as any[])) {
      if (!v.projeto_id) continue;
      // Qualquer vínculo — GP ou equipe — faz o projeto ser "meu" (036).
      if (v.profile_id === session.profile.id) meusProjetoIds.add(v.projeto_id);
      // A coluna mostra só os GPs; membros de equipe não respondem por ele.
      if (v.papel !== "equipe" && v.profile?.nome) {
        const atuais = gpsPorProjeto.get(v.projeto_id) ?? [];
        if (!atuais.includes(v.profile.nome)) atuais.push(v.profile.nome);
        gpsPorProjeto.set(v.projeto_id, atuais);
      }
    }

    for (const v of ((versoesMinhasRes.data ?? []) as any[])) {
      const projetoId = projetoPorOrcamento.get(v.orcamento_id);
      if (projetoId) meusProjetoIds.add(projetoId);
    }

    for (const v of ((vinculosRes.data ?? []) as any[])) {
      if (!v.regional) continue;
      const atuais = regionaisMap.get(v.projeto_id) ?? [];
      atuais.push({ id: v.regional.id, nome: v.regional.nome });
      regionaisMap.set(v.projeto_id, atuais);
    }
    for (const lista of regionaisMap.values()) {
      lista.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    }
  }

  // Quando há filtro de aterrissagem, mostrar só projetos com orçamentos
  // que bateram o filtro (orcamentosCountMap só tem projetos do orcsRes filtrado).
  const projetosVisiveis =
    filtro === "parados" || filtro === "aguardando_aprovacao"
      ? projetosBrutos.filter((p) => (orcamentosCountMap.get(p.id) ?? 0) > 0)
      : projetosBrutos;

  const projetos: ProjetoRow[] = projetosVisiveis.map((p) => ({
    id: p.id,
    codigo: p.codigo,
    nome: p.nome,
    campanha: p.campanha,
    descricao: p.descricao ?? null,
    gps: (gpsPorProjeto.get(p.id) ?? []).sort((a, b) =>
      a.localeCompare(b, "pt-BR"),
    ),
    status: p.status as Projeto["status"],
    cliente_id: p.cliente_id,
    cliente_nome: p.cliente?.nome_fantasia ?? null,
    produto_id: p.produto_id,
    produto_nome: p.produto?.nome ?? null,
    regionais: regionaisMap.get(p.id) ?? [],
    data_inicio_prevista: p.data_inicio_prevista,
    orcamentos_count: orcamentosCountMap.get(p.id) ?? 0,
    aprovados_count: aprovadosCountMap.get(p.id) ?? 0,
    enviados_count: enviadosCountMap.get(p.id) ?? 0,
    abertos_count: abertosCountMap.get(p.id) ?? 0,
    created_at: p.created_at,
  }));

  const clientes = (clientesRes.data ?? []) as Pick<Cliente, "id" | "nome_fantasia">[];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">
            Comercial
          </p>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-california-red/10 p-2">
              <FileText className="h-5 w-5 text-california-red" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Projetos &amp; Orçamentos</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Cada projeto agrupa os orçamentos de uma iniciativa do cliente.
            Clique num projeto para ver seus orçamentos e versões.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/orcamentos/categorias"
            prefetch={false}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-semibold text-foreground shadow-sm hover:border-california-red/30 hover:text-california-red transition-all"
          >
            <Tags className="h-4 w-4" />
            Categorias
          </Link>
          <Link
            href="/orcamentos/novo"
            prefetch={false}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover hover:shadow-brand transition-all"
          >
            <Plus className="h-4 w-4" />
            Novo projeto
          </Link>
        </div>
      </header>

      {projetos.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="Nenhum projeto ainda"
          description="Crie um projeto para começar a organizar seus orçamentos por iniciativa."
          action={
            <Link
              href="/orcamentos/novo"
              prefetch={false}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white hover:bg-california-red-hover transition-colors"
            >
              <Plus className="h-4 w-4" />
              Criar projeto
            </Link>
          }
        />
      ) : (
        <ProjetosList
          projetos={projetos}
          clientes={clientes}
          meusProjetoIds={Array.from(meusProjetoIds)}
          podeAlternarMeusTodos={pode(session.activeRole, "listas.chave_meus_todos")}
        />
      )}
    </div>
  );
}
