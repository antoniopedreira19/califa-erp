"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search,
  GraduationCap,
  Plus,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
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
};

export type EmpresaOpcao = { id: string; nome: string };
export type RegionalOpcao = { id: string; nome: string; empresa_id: string };

type StatusFiltro = "ativos" | "inativos" | "todos";
type TipoFiltro = "todos" | TipoContratacao;
// Segmentado em 3: Todos / Com pendências / Sem pendências. O detalhe
// de qual campo está pendente aparece no tooltip do selo na linha —
// não precisa separar críticas de parciais no filtro.
type PendenciaFiltro = "todos" | "pendentes" | "sem_pendencias";

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
  const [pendenciaFiltro, setPendenciaFiltro] =
    React.useState<PendenciaFiltro>("todos");
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
      if (empresaFiltro !== TODAS && c.empresa_id !== empresaFiltro) return false;
      if (regionalFiltro === HUB) {
        if (!c.usa_rateio_empresa) return false;
      } else if (regionalFiltro !== TODAS) {
        if (c.regional_id !== regionalFiltro) return false;
      }
      if (pendenciaFiltro === "pendentes" && c.pendencia_nivel === "completo")
        return false;
      if (pendenciaFiltro === "sem_pendencias" && c.pendencia_nivel !== "completo")
        return false;
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
    empresaFiltro,
    regionalFiltro,
    pendenciaFiltro,
  ]);

  // Contagem de qualquer pendência (crítica ou parcial). Usada como
  // badge do toggle "Só pendentes".
  const contagemPendentes = React.useMemo(
    () =>
      colaboradores.filter((c) => c.pendencia_nivel !== "completo").length,
    [colaboradores],
  );

  // Rodapé do card: total do que está filtrado. Ajuda a perceber quanto
  // "vale" o recorte da tela quando o usuário filtra por empresa/regional.
  const totalFiltrado = React.useMemo(
    () => filtered.reduce((acc, c) => acc + (c.salario_vigente ?? 0), 0),
    [filtered],
  );

  return (
    <div className="space-y-4">
      {/* Filtros em 2 linhas à esquerda + ações agrupadas à direita.
          Linha 1: 4 selects + busca. Linha 2: toggle de pendências.
          Ações (Níveis + Novo colaborador) ficam num bloco separado
          na direita, alinhadas ao topo pra visualmente serem "outra
          coisa" (ação != filtro). */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
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
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TogglePendencias
              valor={pendenciaFiltro}
              onChange={setPendenciaFiltro}
              contagemPendentes={contagemPendentes}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/rh/colaboradores/niveis"
            prefetch={false}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 text-[13px] font-semibold text-foreground shadow-sm hover:border-california-red/30 hover:text-california-red transition-all"
          >
            <GraduationCap className="h-3.5 w-3.5" />
            Níveis
            {niveisAtivosCount > 0 && (
              <span className="text-xs font-medium text-muted-foreground">
                ({niveisAtivosCount})
              </span>
            )}
          </Link>
          <Link
            href="/rh/colaboradores/novo"
            prefetch={false}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-california-red px-3.5 text-[13px] font-semibold text-white shadow-sm hover:bg-california-red-hover hover:shadow-brand transition-all"
          >
            <Plus className="h-3.5 w-3.5" />
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
                      {c.pendencia_nivel === "critica" && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              className="inline-flex items-center gap-1 rounded-full bg-california-red/10 px-2 py-0.5 text-[10px] font-medium text-california-red cursor-help"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <AlertCircle className="h-3 w-3" />
                              Pendência
                            </span>
                          </TooltipTrigger>
                          <TooltipContent
                            side="bottom"
                            align="start"
                            className="max-w-[280px] p-0"
                          >
                            <PendenciaTooltipConteudo
                              criticas={c.pendencia_criticas}
                              parciais={c.pendencia_parciais}
                            />
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {c.pendencia_nivel === "parcial" && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800 cursor-help"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Circle className="h-3 w-3" />
                              Incompleto
                            </span>
                          </TooltipTrigger>
                          <TooltipContent
                            side="bottom"
                            align="start"
                            className="max-w-[280px] p-0"
                          >
                            <PendenciaTooltipConteudo
                              criticas={c.pendencia_criticas}
                              parciais={c.pendencia_parciais}
                            />
                          </TooltipContent>
                        </Tooltip>
                      )}
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

/**
 * Toggle segmentado com 3 opções: Todos / Com pendências / Sem
 * pendências. Segue o formato do ChaveMeusTodos (pílula em fundo cinza
 * claro) pra manter a gramática das listas do sistema consistente.
 * Padding do botão é px-3 (menor que o padrão px-3.5) porque 3
 * posições ocupam mais espaço que 2 e a barra de filtros já é densa.
 */
function TogglePendencias({
  valor,
  onChange,
  contagemPendentes,
}: {
  valor: PendenciaFiltro;
  onChange: (v: PendenciaFiltro) => void;
  contagemPendentes: number;
}) {
  return (
    <div
      role="group"
      aria-label="Filtro de pendências"
      className="inline-flex flex-none items-center gap-0.5 rounded-full bg-[#f1f0ec] p-[3px]"
    >
      <BotaoPill ativo={valor === "todos"} onClick={() => onChange("todos")}>
        Todos
      </BotaoPill>
      <BotaoPill
        ativo={valor === "pendentes"}
        onClick={() => onChange("pendentes")}
      >
        <AlertCircle className="h-3 w-3" aria-hidden="true" />
        Com pendências
        {contagemPendentes > 0 && (
          <span
            className={`ml-0.5 text-[10px] font-medium ${
              valor === "pendentes"
                ? "text-california-red"
                : "text-muted-foreground"
            }`}
          >
            ({contagemPendentes})
          </span>
        )}
      </BotaoPill>
      <BotaoPill
        ativo={valor === "sem_pendencias"}
        onClick={() => onChange("sem_pendencias")}
      >
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
        Sem pendências
      </BotaoPill>
    </div>
  );
}

function BotaoPill({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={onClick}
      className={
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-[5px] text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-california-red/30 " +
        (ativo
          ? "bg-white font-semibold text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
          : "bg-transparent font-medium text-[#8a8a8a] hover:text-foreground")
      }
    >
      {children}
    </button>
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
