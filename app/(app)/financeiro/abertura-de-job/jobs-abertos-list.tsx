"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronRight, Search } from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import { competenciaLabel } from "@/lib/types";
import type { JobAberto } from "./dados-abertos";

const TODOS = "Todos";

interface GrupoProjeto {
  projetoId: string;
  codigo: string | null;
  nome: string | null;
  cliente: string | null;
  jobs: JobAberto[];
  total: number;
  aberto: boolean;
}

function formatDataBr(iso: string | null): string {
  if (!iso) return "—";
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  if (!ano || !mes || !dia) return "—";
  return `${dia}/${mes}/${ano}`;
}

/** Opções de um filtro, na ordem em que aparecem, sem repetir e sem vazio. */
function opcoesDe(linhas: JobAberto[], campo: (j: JobAberto) => string | null) {
  const vistos: string[] = [];
  for (const j of linhas) {
    const v = campo(j);
    if (v && !vistos.includes(v)) vistos.push(v);
  }
  return [TODOS, ...vistos.sort((a, b) => a.localeCompare(b, "pt-BR"))];
}

export function JobsAbertosList({ linhas }: { linhas: JobAberto[] }) {
  const router = useRouter();
  const [busca, setBusca] = React.useState("");
  const [regional, setRegional] = React.useState(TODOS);
  const [gp, setGp] = React.useState(TODOS);
  const [produto, setProduto] = React.useState(TODOS);
  const [ano, setAno] = React.useState(TODOS);
  const [dropAberto, setDropAberto] = React.useState<string | null>(null);
  // Grupos nascem abertos: guardamos os FECHADOS para não precisar semear
  // o state com os ids dos projetos no mount. Mesmo padrão de /jobs.
  const [fechados, setFechados] = React.useState<Set<string>>(new Set());

  const filtros = [
    {
      key: "regional",
      rotulo: "Regional",
      valor: regional,
      set: setRegional,
      opcoes: opcoesDe(linhas, (j) => j.regional_nome),
    },
    {
      key: "gp",
      rotulo: "GP responsável",
      valor: gp,
      set: setGp,
      opcoes: opcoesDe(linhas, (j) => j.responsavel_nome),
    },
    {
      key: "produto",
      rotulo: "Produto",
      valor: produto,
      set: setProduto,
      opcoes: opcoesDe(linhas, (j) => j.produto),
    },
    {
      key: "ano",
      rotulo: "Ano",
      valor: ano,
      set: setAno,
      // Ano da COMPETÊNCIA — o eixo contábil do financeiro, não o do
      // calendário do job.
      opcoes: opcoesDe(linhas, (j) =>
        j.competencia_ano ? String(j.competencia_ano) : null,
      ),
    },
  ];

  const grupos = React.useMemo<GrupoProjeto[]>(() => {
    const q = busca.trim().toLowerCase();
    const filtroAtivo =
      q !== "" ||
      regional !== TODOS ||
      gp !== TODOS ||
      produto !== TODOS ||
      ano !== TODOS;

    function combina(j: JobAberto): boolean {
      if (regional !== TODOS && j.regional_nome !== regional) return false;
      if (gp !== TODOS && j.responsavel_nome !== gp) return false;
      if (produto !== TODOS && j.produto !== produto) return false;
      if (ano !== TODOS && String(j.competencia_ano ?? "") !== ano) return false;
      if (q === "") return true;
      // Busca também pelo nome da produção: quem procura pode lembrar do
      // nome antigo, não do que o financeiro deu.
      return [j.codigo, j.nome, j.nome_producao]
        .join(" ")
        .toLowerCase()
        .includes(q);
    }

    const porProjeto = new Map<string, JobAberto[]>();
    for (const j of linhas) {
      const arr = porProjeto.get(j.projeto_id) ?? [];
      arr.push(j);
      porProjeto.set(j.projeto_id, arr);
    }

    const out: GrupoProjeto[] = [];
    for (const [projetoId, jobs] of porProjeto) {
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
        // Com filtro ativo o grupo abre sempre: fechado esconderia
        // justamente o job que o filtro encontrou.
        aberto: filtroAtivo ? true : !fechados.has(projetoId),
      });
    }
    return out.sort((a, b) =>
      (a.codigo ?? "").localeCompare(b.codigo ?? "", "pt-BR"),
    );
  }, [linhas, busca, regional, gp, produto, ano, fechados]);

  const visiveis = grupos.flatMap((g) => g.jobs);
  const totalVisivel = visiveis.reduce((s, j) => s + (j.valor_total ?? 0), 0);

  function toggleGrupo(id: string) {
    setFechados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {/* Filtros + busca */}
      <div className="flex flex-wrap items-center gap-2">
        {filtros.map((f) => {
          const ativo = f.valor !== TODOS;
          return (
            <div key={f.key} className="relative">
              <button
                type="button"
                onClick={() =>
                  setDropAberto(dropAberto === f.key ? null : f.key)
                }
                aria-expanded={dropAberto === f.key}
                className={cn(
                  "flex h-[38px] items-center justify-between gap-2 rounded-lg border bg-white px-3 text-[12.5px] font-medium transition-colors",
                  ativo
                    ? "border-california-red text-foreground"
                    : "border-border text-muted-foreground hover:border-[#d7d7d7]",
                )}
              >
                {ativo ? `${f.rotulo}: ${f.valor}` : f.rotulo}
                <ChevronRight className="h-3.5 w-3.5 rotate-90 text-muted-foreground" />
              </button>
              {dropAberto === f.key && (
                <>
                  {/* Clique fora fecha o menu sem precisar de listener global. */}
                  <button
                    type="button"
                    aria-label="Fechar filtro"
                    onClick={() => setDropAberto(null)}
                    className="fixed inset-0 z-10 cursor-default"
                  />
                  <div className="absolute left-0 top-11 z-20 min-w-[200px] rounded-xl border border-border bg-white p-1.5 shadow-elevated">
                    {f.opcoes.map((o) => (
                      <button
                        key={o}
                        type="button"
                        onClick={() => {
                          f.set(o);
                          setDropAberto(null);
                        }}
                        className={cn(
                          "block w-full rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-colors hover:bg-muted",
                          o === f.valor
                            ? "text-california-red"
                            : "text-foreground",
                        )}
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })}

        <div className="relative ml-auto flex items-center">
          <Search className="absolute left-3 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou código"
            className="h-[38px] w-64 rounded-lg border border-border bg-white pl-9 pr-3 text-[12.5px] outline-none focus:border-california-red/40"
          />
        </div>
      </div>

      {/* Resumo. Sem os totais de faturamento do design: não há dado que
          diga se um job foi faturado — entra com contas a receber. */}
      <div className="flex flex-wrap items-center gap-3.5 text-[12.5px] text-muted-foreground">
        <span>
          {visiveis.length === 1
            ? "1 job aberto"
            : `${visiveis.length} jobs abertos`}
        </span>
        <span className="h-3 w-px bg-[#dcdcdc]" />
        <span>
          Valor total{" "}
          <strong className="tabular-nums text-foreground">
            {formatCurrency(totalVisivel)}
          </strong>
        </span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full min-w-[1080px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/60 text-left text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
              <th className="w-8 px-2 py-3" aria-label="Expandir" />
              <th className="px-4 py-3 font-semibold">Código</th>
              <th className="px-4 py-3 font-semibold">Nome</th>
              <th className="px-4 py-3 font-semibold">Empresa</th>
              <th className="px-4 py-3 font-semibold">Cliente</th>
              <th className="px-4 py-3 font-semibold">GP responsável</th>
              <th className="px-4 py-3 font-semibold">Categoria</th>
              <th className="px-4 py-3 font-semibold">Competência</th>
              <th className="px-4 py-3 font-semibold">Abertura</th>
              <th className="px-4 py-3 text-right font-semibold">Valor total</th>
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
                    "cursor-pointer border-b border-border transition-colors hover:bg-[#f0eeee]/85 focus-visible:bg-[#f0eeee]/85 focus-visible:outline-none",
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
                        {formatCurrency(g.total)}
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
                      onClick={() => router.push(`/financeiro/jobs/${j.id}`)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          router.push(`/financeiro/jobs/${j.id}`);
                        }
                      }}
                      className="cursor-pointer border-b border-b-[#f4f2f2] transition-colors hover:bg-muted/70 focus-visible:bg-muted/70 focus-visible:outline-none"
                    >
                      {/* Calha da árvore: a vertical desce até o meio da
                          última linha e o traço encosta no código. */}
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
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-[#b3323c]">
                        {j.codigo}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium">{j.nome}</span>
                          {j.nome_producao !== j.nome && (
                            <span className="text-[11px] text-muted-foreground">
                              produção: {j.nome_producao}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {j.empresa_nome ? (
                          <span className="inline-flex items-center rounded-full border border-border bg-muted/80 px-2.5 py-0.5 text-[11px] font-medium text-foreground">
                            {j.empresa_nome}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {j.cliente_nome ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {j.responsavel_nome ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {j.categoria_nome ?? "—"}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {competenciaLabel(
                          j.competencia_trimestre,
                          j.competencia_ano,
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {formatDataBr(j.data_abertura_financeiro)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">
                        {formatCurrency(j.valor_total)}
                      </td>
                    </tr>
                  ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>

        {grupos.length === 0 && (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">
            {linhas.length === 0
              ? "Nenhum job aberto ainda. Abra um job na aba ao lado."
              : "Nenhum job aberto encontrado com esses filtros."}
          </p>
        )}
      </div>
    </div>
  );
}
