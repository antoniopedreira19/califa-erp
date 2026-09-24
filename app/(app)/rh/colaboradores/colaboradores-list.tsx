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
  salario_vigente: number | null;
  empresa_id: string | null;
  empresa_nome: string | null;
  regional_id: string | null;
  regional_nome: string | null;
  usa_rateio_empresa: boolean;
};

export type EmpresaOpcao = { id: string; nome: string };
export type RegionalOpcao = { id: string; nome: string; empresa_id: string };

type StatusFiltro = "ativos" | "inativos" | "todos";
type TipoFiltro = "todos" | TipoContratacao;

// Sentinel para "todas" (Radix Select não aceita value="").
const TODAS = "__todas__";
// Sentinel para "somente Hub" no filtro de regional (colaboradores com toggle
// usa_rateio_empresa=true).
const HUB = "__hub__";

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function ColaboradoresList({
  colaboradores,
  niveisAtivosCount,
  empresasOpcoes,
  regionaisOpcoes,
}: {
  colaboradores: ColaboradorRow[];
  niveisAtivosCount: number;
  empresasOpcoes: EmpresaOpcao[];
  regionaisOpcoes: RegionalOpcao[];
}) {
  const router = useRouter();
  const [busca, setBusca] = React.useState("");
  const [status, setStatus] = React.useState<StatusFiltro>("ativos");
  const [tipo, setTipo] = React.useState<TipoFiltro>("todos");
  const [empresaFiltro, setEmpresaFiltro] = React.useState<string>(TODAS);
  const [regionalFiltro, setRegionalFiltro] = React.useState<string>(TODAS);

  // Regionais disponíveis no dropdown: quando uma empresa está selecionada,
  // só as regionais dela; senão, todas do tenant. Hub aparece sempre.
  const regionaisFiltradas = React.useMemo(() => {
    if (empresaFiltro === TODAS) return regionaisOpcoes;
    return regionaisOpcoes.filter((r) => r.empresa_id === empresaFiltro);
  }, [regionaisOpcoes, empresaFiltro]);

  // Se a regional selecionada não pertence à empresa nova, zera pra "Todas".
  React.useEffect(() => {
    if (regionalFiltro === TODAS || regionalFiltro === HUB) return;
    const ainda = regionaisFiltradas.some((r) => r.id === regionalFiltro);
    if (!ainda) setRegionalFiltro(TODAS);
  }, [regionaisFiltradas, regionalFiltro]);

  const filtered = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return colaboradores.filter((c) => {
      if (status === "ativos" && c.status !== "ativo") return false;
      if (status === "inativos" && c.status !== "inativo") return false;
      if (tipo !== "todos" && c.tipo_contratacao !== tipo) return false;
      if (empresaFiltro !== TODAS && c.empresa_id !== empresaFiltro) return false;
      if (regionalFiltro === HUB) {
        if (!c.usa_rateio_empresa) return false;
      } else if (regionalFiltro !== TODAS) {
        if (c.regional_id !== regionalFiltro) return false;
      }
      if (!q) return true;
      return (
        c.nome.toLowerCase().includes(q) ||
        c.funcao.toLowerCase().includes(q) ||
        (c.empresa_nome ?? "").toLowerCase().includes(q) ||
        (c.regional_nome ?? "").toLowerCase().includes(q)
      );
    });
  }, [colaboradores, busca, status, tipo, empresaFiltro, regionalFiltro]);

  // Rodapé do card: total do que está filtrado. Ajuda a perceber quanto
  // "vale" o recorte da tela quando o usuário filtra por empresa/regional.
  const totalFiltrado = React.useMemo(
    () => filtered.reduce((acc, c) => acc + (c.salario_vigente ?? 0), 0),
    [filtered],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-md min-w-[240px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, função, empresa ou regional..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={status}
          onValueChange={(v) => setStatus(v as StatusFiltro)}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            side="bottom"
            avoidCollisions={false}
            className="max-h-[min(20rem,var(--radix-select-content-available-height))]"
          >
            <SelectItem value="ativos">Ativos</SelectItem>
            <SelectItem value="inativos">Inativos</SelectItem>
            <SelectItem value="todos">Todos</SelectItem>
          </SelectContent>
        </Select>
        <Select value={tipo} onValueChange={(v) => setTipo(v as TipoFiltro)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Tipo de contratação" />
          </SelectTrigger>
          <SelectContent
            side="bottom"
            avoidCollisions={false}
            className="max-h-[min(20rem,var(--radix-select-content-available-height))]"
          >
            <SelectItem value="todos">Todos os tipos</SelectItem>
            <SelectItem value="pj">PJ</SelectItem>
            <SelectItem value="mei">MEI</SelectItem>
            <SelectItem value="clt_recibo">CLT + Recibo</SelectItem>
            <SelectItem value="clt">CLT</SelectItem>
            <SelectItem value="estagio">Estágio</SelectItem>
            <SelectItem value="socio">Sócio</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={empresaFiltro}
          onValueChange={(v) => setEmpresaFiltro(v)}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Empresa" />
          </SelectTrigger>
          <SelectContent
            side="bottom"
            avoidCollisions={false}
            className="max-h-[min(20rem,var(--radix-select-content-available-height))]"
          >
            <SelectItem value={TODAS}>Todas as empresas</SelectItem>
            {empresasOpcoes.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={regionalFiltro}
          onValueChange={(v) => setRegionalFiltro(v)}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Regional" />
          </SelectTrigger>
          <SelectContent
            side="bottom"
            avoidCollisions={false}
            className="max-h-[min(20rem,var(--radix-select-content-available-height))]"
          >
            <SelectItem value={TODAS}>Todas as regionais</SelectItem>
            <SelectItem value={HUB}>Hub</SelectItem>
            {regionaisFiltradas.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.nome}
              </SelectItem>
            ))}
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
        <div className="rounded-2xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhum colaborador corresponde aos filtros.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Nome
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Função
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground w-32">
                  Valor
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-28">
                  Contrato
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-64">
                  Alocação
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
                  className={`cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-muted/50 ${
                    c.status === "inativo" ? "opacity-60" : ""
                  }`}
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
                    {c.status === "inativo" && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        (inativo)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {c.funcao}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">
                    {c.salario_vigente != null
                      ? brl.format(c.salario_vigente)
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {tipoContratacaoLabel(c.tipo_contratacao)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatarAlocacao(c)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-border bg-muted/30">
              <tr>
                <td
                  colSpan={2}
                  className="px-4 py-3 text-xs font-medium text-muted-foreground"
                >
                  {filtered.length}{" "}
                  {filtered.length === 1 ? "colaborador" : "colaboradores"}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold">
                  {brl.format(totalFiltrado)}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function formatarAlocacao(c: ColaboradorRow): string {
  if (!c.empresa_nome) return "—";
  if (c.usa_rateio_empresa) return `${c.empresa_nome} · Hub`;
  if (c.regional_nome) return `${c.empresa_nome} · ${c.regional_nome}`;
  return c.empresa_nome;
}
