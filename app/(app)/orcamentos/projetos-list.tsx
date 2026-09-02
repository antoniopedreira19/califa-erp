"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Cliente, ProjetoStatus } from "@/lib/types";
import { ChaveMeusTodos } from "@/components/ui/chave-meus-todos";
import { projetoStatusLabel } from "@/lib/types";

export interface ProjetoRow {
  id: string;
  codigo: string;
  nome: string;
  campanha: string | null;
  /** GPs Responsáveis do projeto, por nome, ordenados. Substituíram a
   *  coluna Serviço em 02/09/2026: Serviço virou designação do job (037),
   *  e o que a lista de projetos precisa mostrar é quem responde por ele. */
  gps: string[];
  status: ProjetoStatus;
  cliente_id: string;
  cliente_nome: string | null;
  produto_id: string | null;
  produto_nome: string | null;
  /** Regionais do projeto, já ordenadas por nome. */
  regionais: { id: string; nome: string }[];
  data_inicio_prevista: string;
  /** Total de orçamentos do projeto, qualquer status (cancelados e
   *  recusados incluídos). As 3 contagens abaixo são o funil comercial —
   *  mutuamente exclusivas, semântica em `lib/calculos/funil.ts`. */
  orcamentos_count: number;
  /** Estágio "aprovado": aprovado sem job, ou job rejeitado pelo financeiro. */
  aprovados_count: number;
  /** Estágio "enviado": job aguardando abertura pelo financeiro. */
  enviados_count: number;
  /** Estágio "aberto": job aberto/em produção/encerrado. */
  abertos_count: number;
  created_at: string;
}

interface Props {
  projetos: ProjetoRow[];
  clientes: Pick<Cliente, "id" | "nome_fantasia">[];
  /** Projetos em que o usuário é responsável ou produtor de algum job —
   *  a regra de "Meus" desta lista. Vem pronta do servidor. */
  meusProjetoIds: string[];
}

function statusBadgeClasses(status: ProjetoStatus): string {
  return status === "ativo"
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : "bg-slate-100 text-slate-500 border-slate-200";
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** Ano do projeto = ano do início previsto, o mesmo que numera o código. */
function anoDoProjeto(p: ProjetoRow): string {
  return p.data_inicio_prevista.slice(0, 4);
}

/** Célula do funil: zero vira travessão discreto pra tabela não virar uma
 *  parede de zeros — o olho acha na hora onde há movimento. */
function CelulaFunil({ valor }: { valor: number }) {
  return (
    <td className="px-4 py-3 text-center tabular-nums">
      {valor === 0 ? <span className="text-muted-foreground">—</span> : valor}
    </td>
  );
}

export function ProjetosList({ projetos, clientes, meusProjetoIds }: Props) {
  const router = useRouter();
  // Meus é o padrão, igual à lista de Jobs: quem abre quer o próprio
  // trabalho, e "Todos" fica a um clique.
  const [meus, setMeus] = React.useState(true);
  const [busca, setBusca] = React.useState("");
  const [clienteFiltro, setClienteFiltro] = React.useState<string>("todos");
  const [produtoFiltro, setProdutoFiltro] = React.useState<string>("todos");
  const [regionalFiltro, setRegionalFiltro] = React.useState<string>("todas");
  const [anoFiltro, setAnoFiltro] = React.useState<string>("todos");
  const [statusFiltro, setStatusFiltro] = React.useState<string>("ativos");

  // As opções de Produto, Regional e Ano saem dos próprios projetos: o
  // dropdown só oferece o que de fato filtra alguma linha, e não custa
  // query extra.
  const produtosOpcoes = React.useMemo(() => {
    const mapa = new Map<string, string>();
    for (const p of projetos) {
      if (p.produto_id && p.produto_nome) mapa.set(p.produto_id, p.produto_nome);
    }
    return [...mapa.entries()]
      .map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [projetos]);

  const regionaisOpcoes = React.useMemo(() => {
    const mapa = new Map<string, string>();
    for (const p of projetos) {
      for (const r of p.regionais) mapa.set(r.id, r.nome);
    }
    return [...mapa.entries()]
      .map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [projetos]);

  const anosOpcoes = React.useMemo(() => {
    const anos = new Set(projetos.map(anoDoProjeto));
    return [...anos].sort((a, b) => b.localeCompare(a));
  }, [projetos]);

  const meusIds = React.useMemo(
    () => new Set(meusProjetoIds),
    [meusProjetoIds],
  );

  const filtrados = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return projetos.filter((p) => {
      if (meus && !meusIds.has(p.id)) return false;
      if (clienteFiltro !== "todos" && p.cliente_id !== clienteFiltro) return false;
      if (produtoFiltro !== "todos" && p.produto_id !== produtoFiltro) return false;
      if (
        regionalFiltro !== "todas" &&
        !p.regionais.some((r) => r.id === regionalFiltro)
      ) {
        return false;
      }
      if (anoFiltro !== "todos" && anoDoProjeto(p) !== anoFiltro) return false;
      if (statusFiltro === "ativos" && p.status !== "ativo") return false;
      if (statusFiltro === "arquivados" && p.status !== "arquivado") return false;
      if (q) {
        const hay = `${p.codigo} ${p.nome} ${p.campanha ?? ""} ${p.cliente_nome ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    projetos,
    meus,
    meusIds,
    busca,
    clienteFiltro,
    produtoFiltro,
    regionalFiltro,
    anoFiltro,
    statusFiltro,
  ]);

  return (
    <div className="space-y-4">
      {/* A chave "Meus/Todos" abre a barra, na mesma posição da lista de
          Jobs — o recorte é a primeira decisão de quem chega. */}
      <div className="flex flex-wrap items-center gap-3">
        <ChaveMeusTodos meus={meus} onChange={setMeus} />
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por código, nome, campanha ou cliente..."
            className="pl-9"
          />
        </div>
        <Select value={clienteFiltro} onValueChange={setClienteFiltro}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os clientes</SelectItem>
            {clientes.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.nome_fantasia}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={produtoFiltro} onValueChange={setProdutoFiltro}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            side="bottom"
            avoidCollisions={false}
            className="w-[--radix-select-trigger-width]"
          >
            <SelectItem value="todos">Todas as marcas</SelectItem>
            {produtosOpcoes.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={regionalFiltro} onValueChange={setRegionalFiltro}>
          <SelectTrigger className="w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as regionais</SelectItem>
            {regionaisOpcoes.map((r) => (
              <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={anoFiltro} onValueChange={setAnoFiltro}>
          <SelectTrigger className="w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os anos</SelectItem>
            {anosOpcoes.map((a) => (
              <SelectItem key={a} value={a}>{a}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFiltro} onValueChange={setStatusFiltro}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ativos">Ativos</SelectItem>
            <SelectItem value="arquivados">Arquivados</SelectItem>
            <SelectItem value="todos">Todos</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3 font-semibold">Código</th>
              <th className="px-4 py-3 font-semibold">Nome</th>
              <th className="px-4 py-3 font-semibold">Cliente</th>
              <th className="px-4 py-3 font-semibold">Marca</th>
              <th className="px-4 py-3 font-semibold">Regional</th>
              <th className="px-4 py-3 font-semibold">GP Responsável</th>
              <th className="px-4 py-3 font-semibold">Início</th>
              <th className="px-4 py-3 font-semibold text-center">Orçamentos</th>
              <th className="px-4 py-3 font-semibold text-center">Aprovados</th>
              <th className="px-4 py-3 font-semibold text-center">Enviados</th>
              <th className="px-4 py-3 font-semibold text-center">Abertos</th>
              <th className="px-4 py-3 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((p) => (
              <tr
                key={p.id}
                role="button"
                tabIndex={0}
                className="border-b border-border last:border-0 hover:bg-accent/40 transition-colors cursor-pointer focus-visible:outline-none focus-visible:bg-accent/40"
                onClick={() => router.push(`/orcamentos/${p.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    router.push(`/orcamentos/${p.id}`);
                  }
                }}
              >
                <td className="px-4 py-3 font-mono text-xs">
                  <Link
                    href={`/orcamentos/${p.id}`}
                    prefetch={false}
                    className="hover:text-california-red"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {p.codigo}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span className="font-medium">{p.nome}</span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{p.cliente_nome ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{p.produto_nome ?? "—"}</td>
                <td className="px-4 py-3">
                  {p.regionais.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    // Uma regional aparece inteira; a partir da segunda, o
                    // contador evita que a coluna estoure a linha.
                    <span className="inline-flex items-center gap-1">
                      <span className="text-muted-foreground">{p.regionais[0].nome}</span>
                      {p.regionais.length > 1 && (
                        <span
                          title={p.regionais.map((r) => r.nome).join(", ")}
                          className="inline-flex items-center rounded-full border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground"
                        >
                          +{p.regionais.length - 1}
                        </span>
                      )}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {p.gps.length === 0 ? (
                    "—"
                  ) : (
                    // Mesmo tratamento das regionais: o primeiro inteiro, e
                    // um contador a partir do segundo.
                    <span className="inline-flex items-center gap-1">
                      <span>{p.gps[0]}</span>
                      {p.gps.length > 1 && (
                        <span
                          title={p.gps.join(", ")}
                          className="inline-flex items-center rounded-full border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground"
                        >
                          +{p.gps.length - 1}
                        </span>
                      )}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{formatDate(p.data_inicio_prevista)}</td>
                <td className="px-4 py-3 text-center tabular-nums">{p.orcamentos_count}</td>
                <CelulaFunil valor={p.aprovados_count} />
                <CelulaFunil valor={p.enviados_count} />
                <CelulaFunil valor={p.abertos_count} />
                <td className="px-4 py-3">
                  <Badge className={cn("border", statusBadgeClasses(p.status))}>
                    {projetoStatusLabel(p.status)}
                  </Badge>
                </td>
              </tr>
            ))}
            {filtrados.length === 0 && (
              <tr>
                <td colSpan={12} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {meus
                    ? "Nenhum projeto com esse recorte. Você não é responsável nem produtor de nenhum job dos projetos que combinam com os filtros."
                    : "Nenhum projeto encontrado com esses filtros."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
