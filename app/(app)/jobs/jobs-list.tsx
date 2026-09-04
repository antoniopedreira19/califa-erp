"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronRight, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChaveMeusTodos } from "@/components/ui/chave-meus-todos";
import { cn } from "@/lib/utils";
import { jobStatusLabel, type JobStatus } from "@/lib/types";

export interface JobRow {
  id: string;
  codigo: string;
  nome: string;
  status: JobStatus;
  valor_total: number | null;
  data_inicio_prevista: string | null;
  projeto_id: string;
  /** Produto e Regional do PRÓPRIO job — não do projeto. Divergem na
   *  base, e é o do job que descreve o trabalho desta linha. */
  produto: string | null;
  regional_id: string | null;
  regional_nome: string | null;
  responsavel_id: string | null;
  projeto_codigo: string | null;
  projeto_nome: string | null;
  cliente_nome: string | null;
  responsavel_nome: string | null;
  empresa_id: string | null;
  empresa_nome: string | null;
}

const STATUS_FILTROS: JobStatus[] = [
  "aguardando_abertura",
  "rejeitado_financeiro",
  "aberto",
  "encerrado",
  "cancelado",
];

function statusBadgeClasses(status: JobStatus): string {
  switch (status) {
    case "aberto":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "em_producao":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "encerrado":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "cancelado":
      return "bg-slate-100 text-slate-500 border-slate-200";
    case "aguardando_abertura":
      return "bg-yellow-50 text-yellow-700 border-yellow-200";
    case "rejeitado_financeiro":
      return "bg-red-50 text-red-700 border-red-200";
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatMoney(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

interface GrupoProjeto {
  projetoId: string;
  codigo: string | null;
  nome: string | null;
  cliente: string | null;
  jobs: JobRow[];
  total: number;
  aberto: boolean;
}

export function JobsList({
  rows,
  empresas,
  usuarioId,
  podeAlternarMeusTodos = true,
}: {
  rows: JobRow[];
  empresas: { id: string; razao_social: string; nome_fantasia: string | null }[];
  /** Quem está logado — define o recorte "Meus". */
  usuarioId: string;
  /**
   * Se `false`, a chave "Meus/Todos" nao aparece e o filtro `meus`
   * comeca em `false` (mostra todos os jobs que o RLS deixou passar).
   * Usado pro Freelancer, que so ve jobs onde participa da equipe do
   * projeto — RLS ja fez esse recorte, entao filtrar por
   * `responsavel_id` na tela retornaria zero. Fonte-verdade da regra:
   * `lib/permissoes.ts`, recurso `listas.chave_meus_todos`.
   */
  podeAlternarMeusTodos?: boolean;
}) {
  const router = useRouter();
  // Meus é o padrão pra quem pode alternar — quem abre a lista quer o
  // próprio trabalho. Freelancer nao pode alternar; comeca em "todos" e
  // conta com o filtro do RLS.
  const [meus, setMeus] = React.useState(podeAlternarMeusTodos);
  // Status virou seleção ÚNICA (design 01/09/2026). Eram cinco pílulas
  // combináveis; ocupavam a barra inteira e não deixavam espaço para
  // Produto e Regional.
  const [statusFiltro, setStatusFiltro] = React.useState<string>("todos");
  const [produtoFiltro, setProdutoFiltro] = React.useState<string>("todos");
  const [regionalFiltro, setRegionalFiltro] = React.useState<string>("todas");
  const [busca, setBusca] = React.useState("");
  // Grupos nascem abertos, como no design. Guardamos os FECHADOS pra não
  // precisar semear o state com os ids dos projetos no mount.
  const [fechadosIds, setFechadosIds] = React.useState<Set<string>>(new Set());
  const [empresaFiltro, setEmpresaFiltro] = React.useState<string>("todas");

  /** Produtos e regionais que EXISTEM nos jobs desta tela — oferecer
   *  opção que não filtra nada é convite a um resultado vazio. */
  const produtosOpcoes = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.produto?.trim()) set.add(r.produto.trim());
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [rows]);

  const regionaisOpcoes = React.useMemo(() => {
    const mapa = new Map<string, string>();
    for (const r of rows) {
      if (r.regional_id && r.regional_nome) mapa.set(r.regional_id, r.regional_nome);
    }
    return Array.from(mapa, ([id, nome]) => ({ id, nome })).sort((a, b) =>
      a.nome.localeCompare(b.nome, "pt-BR"),
    );
  }, [rows]);

  const gruposPorProjeto = React.useMemo(() => {
    const map = new Map<string, JobRow[]>();
    for (const r of rows) {
      const arr = map.get(r.projeto_id) ?? [];
      arr.push(r);
      map.set(r.projeto_id, arr);
    }
    return map;
  }, [rows]);

  const grupos = React.useMemo<GrupoProjeto[]>(() => {
    const q = busca.trim().toLowerCase();
    // "Meus" também conta como filtro ativo: com ele ligado o grupo tem
    // que abrir, senão esconde justamente o job que sobrou.
    const filtroAtivo =
      meus ||
      statusFiltro !== "todos" ||
      produtoFiltro !== "todos" ||
      regionalFiltro !== "todas" ||
      q !== "" ||
      empresaFiltro !== "todas";

    function combina(r: JobRow): boolean {
      if (meus && r.responsavel_id !== usuarioId) return false;
      if (statusFiltro !== "todos" && r.status !== statusFiltro) return false;
      if (produtoFiltro !== "todos" && (r.produto?.trim() ?? "") !== produtoFiltro)
        return false;
      if (regionalFiltro !== "todas" && r.regional_id !== regionalFiltro)
        return false;
      if (empresaFiltro !== "todas" && r.empresa_id !== empresaFiltro)
        return false;
      if (q === "") return true;
      return (
        r.codigo.toLowerCase().includes(q) || r.nome.toLowerCase().includes(q)
      );
    }

    // Projetos ordenados pelo menor código de job do grupo.
    const ordenados = Array.from(gruposPorProjeto.entries())
      .map(([projetoId, jobsDoGrupo]) => ({
        projetoId,
        jobs: [...jobsDoGrupo].sort((a, b) => a.codigo.localeCompare(b.codigo)),
      }))
      .sort((a, b) => a.jobs[0].codigo.localeCompare(b.jobs[0].codigo));

    const out: GrupoProjeto[] = [];

    for (const { projetoId, jobs } of ordenados) {
      const visiveis = jobs.filter(combina);
      if (visiveis.length === 0) continue;

      const primeiro = jobs[0];
      out.push({
        projetoId,
        codigo: primeiro.projeto_codigo,
        nome: primeiro.projeto_nome,
        cliente: primeiro.cliente_nome,
        jobs: visiveis,
        total: visiveis.reduce((s, j) => s + (j.valor_total ?? 0), 0),
        // Com filtro ativo o grupo abre sempre: fechado ele esconderia
        // justamente o job que o filtro encontrou.
        aberto: filtroAtivo ? true : !fechadosIds.has(projetoId),
      });
    }

    return out;
  }, [
    gruposPorProjeto,
    meus,
    usuarioId,
    statusFiltro,
    produtoFiltro,
    regionalFiltro,
    busca,
    empresaFiltro,
    fechadosIds,
  ]);

  function toggleGrupo(id: string) {
    setFechadosIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {/* Meus/Todos · Status · Produto · Regional · Empresa · busca.
          A chave vem primeiro nas duas listas; os três Selects do meio
          substituíram as pílulas de status, que ocupavam a barra inteira. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <ChaveMeusTodos
            meus={meus}
            onChange={setMeus}
            visivel={podeAlternarMeusTodos}
          />
          <Select value={statusFiltro} onValueChange={setStatusFiltro}>
            <SelectTrigger
              className={cn(
                "h-9 w-[190px] px-2.5 text-[13px]",
                statusFiltro !== "todos" && "border-california-red",
              )}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              side="bottom"
              avoidCollisions={false}
              className="w-[--radix-select-trigger-width]"
            >
              <SelectItem value="todos">Todos os status</SelectItem>
              {STATUS_FILTROS.map((s) => (
                <SelectItem key={s} value={s}>
                  {jobStatusLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {produtosOpcoes.length > 0 && (
            <Select value={produtoFiltro} onValueChange={setProdutoFiltro}>
              <SelectTrigger
                className={cn(
                  "h-9 w-[180px] px-2.5 text-[13px]",
                  produtoFiltro !== "todos" && "border-california-red",
                )}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                side="bottom"
                avoidCollisions={false}
                className="w-[--radix-select-trigger-width]"
              >
                <SelectItem value="todos">Todas as marcas</SelectItem>
                {produtosOpcoes.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {regionaisOpcoes.length > 0 && (
            <Select value={regionalFiltro} onValueChange={setRegionalFiltro}>
              <SelectTrigger
                className={cn(
                  "h-9 w-[175px] px-2.5 text-[13px]",
                  regionalFiltro !== "todas" && "border-california-red",
                )}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                side="bottom"
                avoidCollisions={false}
                className="w-[--radix-select-trigger-width]"
              >
                <SelectItem value="todas">Todas as regionais</SelectItem>
                {regionaisOpcoes.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="flex items-center gap-2">
          {empresas.length > 0 && (
            <Select value={empresaFiltro} onValueChange={setEmpresaFiltro}>
              <SelectTrigger className="h-9 w-[180px] px-2.5 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                side="bottom"
                avoidCollisions={false}
                className="w-[--radix-select-trigger-width]"
              >
                <SelectItem value="todas">Todas as empresas</SelectItem>
                {empresas.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.nome_fantasia ?? e.razao_social}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="relative flex items-center">
            <Search className="absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome ou código"
              className="w-64 rounded-lg border border-border bg-white py-2 pl-[30px] pr-3 text-xs text-foreground outline-none focus:border-california-red/40"
            />
          </div>
        </div>
      </div>

      {/* Tabela */}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full min-w-[1320px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/60 text-left text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              <th className="w-8 px-2 py-3" aria-label="Expandir" />
              <th className="px-4 py-3 font-semibold">Código</th>
              <th className="px-4 py-3 font-semibold">Nome</th>
              <th className="px-4 py-3 text-center font-semibold">Empresa</th>
              <th className="px-4 py-3 font-semibold">Projeto</th>
              <th className="px-4 py-3 font-semibold">Marca</th>
              <th className="px-4 py-3 font-semibold">Regional</th>
              <th className="px-4 py-3 font-semibold">Cliente</th>
              <th className="px-4 py-3 font-semibold">Responsável</th>
              <th className="px-4 py-3 text-center font-semibold">Início</th>
              <th className="px-4 py-3 text-right font-semibold">Valor total</th>
              <th className="px-4 py-3 text-center font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {grupos.map((g) => (
              <React.Fragment key={g.projetoId}>
                <tr
                  role="button"
                  tabIndex={0}
                  aria-expanded={g.aberto}
                  onClick={() => toggleGrupo(g.projetoId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleGrupo(g.projetoId);
                    }
                  }}
                  className={cn(
                    "cursor-pointer border-b border-border transition-colors hover:bg-[#f0eeee]/85 focus-visible:outline-none focus-visible:bg-[#f0eeee]/85",
                    g.aberto ? "bg-muted/90" : "bg-muted/40",
                  )}
                >
                  <td colSpan={10} className="p-0">
                    <div className="grid grid-cols-[32px_1fr_auto_auto_auto] items-center gap-4 py-[11px] pl-2 pr-4">
                      <div className="flex items-center justify-center">
                        <span
                          className={cn(
                            "flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-transform duration-150",
                            g.aberto && "rotate-90",
                          )}
                        >
                          <ChevronRight className="h-4 w-4" />
                        </span>
                      </div>
                      <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                        <span className="font-mono text-xs font-semibold text-[#b3323c]">
                          {g.codigo ?? "—"}
                        </span>
                        <span className="text-[13.5px] font-semibold">
                          {g.nome ?? "Projeto"}
                        </span>
                        <span className="h-3 w-px bg-[#dcdcdc]" />
                        <span className="text-xs text-muted-foreground">
                          {g.cliente ?? "—"}
                        </span>
                      </div>
                      <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
                        {g.jobs.length === 1 ? "1 job" : `${g.jobs.length} jobs`}
                      </span>
                      <span className="whitespace-nowrap text-[13px] font-bold tabular-nums">
                        {formatMoney(g.total)}
                      </span>
                      <Link
                        href={`/jobs/projeto/${g.projetoId}`}
                        prefetch={false}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.06em] text-california-red hover:text-california-red/80"
                      >
                        Visão agregada
                        <ArrowRight className="h-3 w-3" />
                      </Link>
                    </div>
                  </td>
                </tr>

                {g.aberto &&
                  g.jobs.map((j, i) => (
                    <tr
                      key={j.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => router.push(`/jobs/${j.id}?from=jobs`)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          router.push(`/jobs/${j.id}?from=jobs`);
                        }
                      }}
                      className="cursor-pointer border-b border-b-[#f4f2f2] transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:bg-muted/70"
                    >
                      {/* Calha da árvore: vertical desce até o meio da última
                          linha, e o traço horizontal encosta no código. */}
                      <td className="relative w-8 px-2 py-3">
                        <span
                          aria-hidden="true"
                          className="absolute left-[23px] top-0 w-px bg-[#dad7d7]"
                          style={{
                            height: i === g.jobs.length - 1 ? "50%" : "100%",
                          }}
                        />
                        <span
                          aria-hidden="true"
                          className="absolute left-6 top-1/2 h-px w-[9px] bg-[#dad7d7]"
                        />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        <Link
                          href={`/jobs/${j.id}?from=jobs`}
                          prefetch={false}
                          className="text-california-red hover:text-california-red/80"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {j.codigo}
                        </Link>
                      </td>
                      <td className="px-4 py-3 font-medium">{j.nome}</td>
                      <td className="px-4 py-3 text-center">
                        {j.empresa_nome ? (
                          <span className="inline-flex items-center whitespace-nowrap rounded-full border border-border bg-muted/80 px-2.5 py-0.5 text-[11px] font-medium text-foreground">
                            {j.empresa_nome}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <span className="font-mono text-xs">
                          {j.projeto_codigo}
                        </span>{" "}
                        <span>{j.projeto_nome ?? ""}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                        {j.produto?.trim() ? j.produto : "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                        {j.regional_nome ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                        {j.cliente_nome ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                        {j.responsavel_nome ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-center text-muted-foreground">
                        {formatDate(j.data_inicio_prevista)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">
                        {formatMoney(j.valor_total)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-center">
                        <Badge
                          className={cn(
                            "whitespace-nowrap border",
                            statusBadgeClasses(j.status),
                          )}
                        >
                          {jobStatusLabel(j.status)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>

        {grupos.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            <p className="text-sm font-semibold">Nenhum job com esse recorte</p>
            <p className="text-xs text-muted-foreground">
              {meus
                ? "Você não é responsável por nenhum job que combine com os filtros."
                : "Nenhum job combina com os filtros escolhidos."}
            </p>
            <button
              type="button"
              onClick={() => {
                setMeus(false);
                setStatusFiltro("todos");
                setProdutoFiltro("todos");
                setRegionalFiltro("todas");
                setEmpresaFiltro("todas");
                setBusca("");
              }}
              className="mt-1 rounded-lg border border-border bg-white px-3.5 py-1.5 text-xs font-semibold hover:border-california-red/40 hover:text-california-red"
            >
              Ver todos os jobs
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
