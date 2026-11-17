"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search,
  Eye,
  EyeOff,
  AlertCircle,
  BadgeCheck,
  Circle,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CadastroStatus, TipoContratacao } from "@/lib/types";
import type {
  NivelPendencia,
  CampoCritico,
  CampoParcial,
} from "@/lib/rh/pendencias";
import { ROTULO_CRITICO, ROTULO_PARCIAL } from "@/lib/rh/pendencias";
import { tipoContratacaoLabel } from "@/lib/types";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
  pendencia_nivel: NivelPendencia;
  pendencia_total: number;
  pendencia_criticas: CampoCritico[];
  pendencia_parciais: CampoParcial[];
  /** Tem login no sistema (user_id != null). */
  tem_acesso: boolean;
  /** Já preencheu o wizard de boas-vindas. */
  perfil_completado: boolean;
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
  empresasOpcoes,
  regionaisOpcoes,
}: {
  colaboradores: ColaboradorRow[];
  empresasOpcoes: EmpresaOpcao[];
  regionaisOpcoes: RegionalOpcao[];
}) {
  const router = useRouter();
  const [busca, setBusca] = React.useState("");
  const [status, setStatus] = React.useState<StatusFiltro>("ativos");
  const [tipo, setTipo] = React.useState<TipoFiltro>("todos");
  const [cargoFiltro, setCargoFiltro] = React.useState<string>(TODAS);
  const [empresaFiltro, setEmpresaFiltro] = React.useState<string>(TODAS);
  const [regionalFiltro, setRegionalFiltro] = React.useState<string>(TODAS);

  // Cargos distintos presentes no banco. Ordenação alfabética para
  // facilitar a varredura visual; valores vazios/null são ignorados.
  const cargosOpcoes = React.useMemo(() => {
    const set = new Set<string>();
    for (const c of colaboradores) {
      if (c.funcao && c.funcao.trim()) set.add(c.funcao.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [colaboradores]);
  // Ocultos por padrão — decisão de UI pra evitar exposição acidental de
  // salários em telas compartilhadas. O RH clica no ícone da coluna Valor
  // pra revelar.
  const [salariosOcultos, setSalariosOcultos] = React.useState(true);

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
      if (cargoFiltro !== TODAS && c.funcao !== cargoFiltro) return false;
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
  }, [
    colaboradores,
    busca,
    status,
    tipo,
    cargoFiltro,
    empresaFiltro,
    regionalFiltro,
  ]);

  // Rodapé do card: total do que está filtrado. Ajuda a perceber quanto
  // "vale" o recorte da tela quando o usuário filtra por empresa/regional.
  const totalFiltrado = React.useMemo(
    () => filtered.reduce((acc, c) => acc + (c.salario_vigente ?? 0), 0),
    [filtered],
  );

  return (
    <div className="space-y-4">
      {/* Filtros em linha única: busca + 5 selects.
          Ordem: Busca | Status | Cargo | Tipo | Empresa | Regionais.
          Ações (Níveis + Novo colaborador) ficam no PageHeader, alinhadas
          com o título. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex items-center">
          <Search className="absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar colaborador..."
            className="h-9 w-56 rounded-lg border border-border bg-white pl-[30px] pr-3 text-xs text-foreground outline-none focus:border-california-red/40"
          />
        </div>
        <Select
          value={status}
          onValueChange={(v) => setStatus(v as StatusFiltro)}
        >
          <SelectTrigger className="h-9 w-[110px] px-2.5 text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            side="bottom"
            avoidCollisions={false}
            className="w-[--radix-select-trigger-width]"
          >
            <SelectItem value="ativos">Ativos</SelectItem>
            <SelectItem value="inativos">Inativos</SelectItem>
            <SelectItem value="todos">Todos</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={cargoFiltro}
          onValueChange={(v) => setCargoFiltro(v)}
        >
          <SelectTrigger className="h-9 w-[180px] px-2.5 text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            side="bottom"
            avoidCollisions={false}
            className="w-[--radix-select-trigger-width]"
          >
            <SelectItem value={TODAS}>Todos os cargos</SelectItem>
            {cargosOpcoes.map((cargo) => (
              <SelectItem key={cargo} value={cargo}>
                {cargo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={tipo} onValueChange={(v) => setTipo(v as TipoFiltro)}>
          <SelectTrigger className="h-9 w-[150px] px-2.5 text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            side="bottom"
            avoidCollisions={false}
            className="w-[--radix-select-trigger-width]"
          >
            <SelectItem value="todos">Todos os tipos</SelectItem>
            <SelectItem value="pj">PJ</SelectItem>
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
          <SelectTrigger className="h-9 w-[170px] px-2.5 text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            side="bottom"
            avoidCollisions={false}
            className="w-[--radix-select-trigger-width]"
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
          <SelectTrigger className="h-9 w-[160px] px-2.5 text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            side="bottom"
            avoidCollisions={false}
            className="w-[--radix-select-trigger-width]"
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
                  <span className="inline-flex items-center gap-1.5">
                    Valor
                    <button
                      type="button"
                      onClick={() => setSalariosOcultos((v) => !v)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                      aria-label={
                        salariosOcultos ? "Mostrar salários" : "Esconder salários"
                      }
                      title={
                        salariosOcultos ? "Mostrar salários" : "Esconder salários"
                      }
                    >
                      {salariosOcultos ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </span>
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
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        href={`/rh/colaboradores/${c.id}`}
                        prefetch={false}
                        onClick={(e) => e.stopPropagation()}
                        className="hover:text-california-red transition-colors"
                      >
                        {c.nome}
                      </Link>
                      {c.tem_acesso &&
                        c.tipo_contratacao !== "socio" &&
                        (c.perfil_completado ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                className="inline-flex items-center text-sky-600 cursor-help"
                                onClick={(e) => e.stopPropagation()}
                                aria-label="Formulário preenchido"
                              >
                                <BadgeCheck className="h-4 w-4 fill-sky-100" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" align="start">
                              Formulário preenchido
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                className="inline-flex items-center text-california-red cursor-help"
                                onClick={(e) => e.stopPropagation()}
                                aria-label="Formulário pendente"
                              >
                                <AlertCircle className="h-4 w-4" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" align="start">
                              Formulário pendente
                            </TooltipContent>
                          </Tooltip>
                        ))}
                      {c.status === "inativo" && (
                        <span className="text-xs text-muted-foreground">
                          (inativo)
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {c.funcao}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">
                    {c.salario_vigente == null
                      ? "—"
                      : salariosOcultos
                        ? "R$ ●●●●●●"
                        : brl.format(c.salario_vigente)}
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
                  {salariosOcultos ? "R$ ●●●●●●" : brl.format(totalFiltrado)}
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

/**
 * Conteúdo do tooltip da pendência: separa críticas (impedem
 * pagamento) das parciais (cadastro incompleto). Cada campo aparece
 * com bullet colorido pra digitalização rápida.
 */
function PendenciaTooltipConteudo({
  criticas,
  parciais,
}: {
  criticas: CampoCritico[];
  parciais: CampoParcial[];
}) {
  return (
    <div className="min-w-[220px] p-3 space-y-2.5">
      {criticas.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <AlertCircle className="h-3.5 w-3.5 text-california-red" />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-california-red">
              Impedem pagamento
            </span>
          </div>
          <ul className="space-y-1">
            {criticas.map((campo) => (
              <li
                key={campo}
                className="flex items-center gap-2 text-xs text-foreground"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-california-red shrink-0" />
                {ROTULO_CRITICO[campo]}
              </li>
            ))}
          </ul>
        </div>
      )}
      {criticas.length > 0 && parciais.length > 0 && (
        <div className="border-t border-border" />
      )}
      {parciais.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Circle className="h-3.5 w-3.5 text-amber-600" />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
              Cadastro incompleto
            </span>
          </div>
          <ul className="space-y-1">
            {parciais.map((campo) => (
              <li
                key={campo}
                className="flex items-center gap-2 text-xs text-foreground"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                {ROTULO_PARCIAL[campo]}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
