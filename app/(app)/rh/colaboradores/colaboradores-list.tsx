"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, GraduationCap, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CadastroStatus, TipoContratacao } from "@/lib/types";
import { tipoContratacaoLabel } from "@/lib/types";

export type ColaboradorRow = {
  id: string;
  nome: string;
  tipo_contratacao: TipoContratacao;
  funcao: string;
  status: CadastroStatus;
  data_admissao: string;
  data_encerramento: string | null;
  nivel_codigo: string | null;
};

type StatusFiltro = "ativos" | "inativos" | "todos";
type TipoFiltro = "todos" | TipoContratacao;

export function ColaboradoresList({
  colaboradores,
  niveisAtivosCount,
}: {
  colaboradores: ColaboradorRow[];
  niveisAtivosCount: number;
}) {
  const router = useRouter();
  const [busca, setBusca] = React.useState("");
  const [status, setStatus] = React.useState<StatusFiltro>("ativos");
  const [tipo, setTipo] = React.useState<TipoFiltro>("todos");

  const filtered = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return colaboradores.filter((c) => {
      if (status === "ativos" && c.status !== "ativo") return false;
      if (status === "inativos" && c.status !== "inativo") return false;
      if (tipo !== "todos" && c.tipo_contratacao !== tipo) return false;
      if (!q) return true;
      return (
        c.nome.toLowerCase().includes(q) ||
        c.funcao.toLowerCase().includes(q) ||
        (c.nivel_codigo ?? "").toLowerCase().includes(q)
      );
    });
  }, [colaboradores, busca, status, tipo]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-md min-w-[240px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, função ou nível..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={status}
          onValueChange={(v) => setStatus(v as StatusFiltro)}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ativos">Ativos</SelectItem>
            <SelectItem value="inativos">Inativos</SelectItem>
            <SelectItem value="todos">Todos</SelectItem>
          </SelectContent>
        </Select>
        <Select value={tipo} onValueChange={(v) => setTipo(v as TipoFiltro)}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Tipo de contratação" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os tipos</SelectItem>
            <SelectItem value="pj">PJ</SelectItem>
            <SelectItem value="mei">MEI</SelectItem>
            <SelectItem value="clt_recibo">CLT + Recibo</SelectItem>
            <SelectItem value="clt">CLT</SelectItem>
            <SelectItem value="estagio">Estágio</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/rh/colaboradores/niveis"
            prefetch={false}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-semibold text-foreground shadow-sm hover:border-california-red/30 hover:text-california-red transition-all"
          >
            <GraduationCap className="h-4 w-4" />
            Níveis
            {niveisAtivosCount > 0 && (
              <span className="ml-1 text-xs font-medium text-muted-foreground">
                ({niveisAtivosCount})
              </span>
            )}
          </Link>
          <Link
            href="/rh/colaboradores/novo"
            prefetch={false}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover hover:shadow-brand transition-all"
          >
            <Plus className="h-4 w-4" />
            Novo colaborador
          </Link>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhum colaborador corresponde aos filtros.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Nome
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Função
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-24">
                  Nível
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-32">
                  Contratação
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-32">
                  Admissão
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-32">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => router.push(`/rh/colaboradores/${c.id}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      router.push(`/rh/colaboradores/${c.id}`);
                    }
                  }}
                  className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-muted/50"
                >
                  <td className="px-4 py-3 font-medium">
                    <Link
                      href={`/rh/colaboradores/${c.id}`}
                      prefetch={false}
                      onClick={(e) => e.stopPropagation()}
                      className="hover:text-california-red transition-colors"
                    >
                      {c.nome}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {c.funcao}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {c.nivel_codigo ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {tipoContratacaoLabel(c.tipo_contratacao)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground tabular-nums">
                    {formatarData(c.data_admissao)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                        c.status === "ativo"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          c.status === "ativo"
                            ? "bg-emerald-500"
                            : "bg-muted-foreground"
                        }`}
                      />
                      {c.status === "ativo" ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatarData(iso: string): string {
  // "2026-09-16" → "16/09/2026"
  const [ano, mes, dia] = iso.split("-");
  if (!ano || !mes || !dia) return iso;
  return `${dia}/${mes}/${ano}`;
}
