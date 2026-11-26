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
  Check,
  ChevronDown,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type {
  CadastroStatus,
  ColaboradorLocalizacao,
  GeneroIdentidade,
  TipoContratacao,
} from "@/lib/types";
import type {
  NivelPendencia,
  CampoCritico,
  CampoParcial,
} from "@/lib/rh/pendencias";
import {
  tipoContratacaoLabel,
  localizacaoLabel,
  generoIdentidadeLabel,
  COLABORADOR_LOCALIZACOES,
} from "@/lib/types";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

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
  localizacao: ColaboradorLocalizacao | null;
  genero_identidade: GeneroIdentidade | null;
  possui_filhos: boolean | null;
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

// Sentinel para o bucket "sem valor" em filtros multi-select.
const SEM = "__sem__";
// Sentinel do Hub no filtro de regionais (colaboradores com usa_rateio_empresa=true).
const HUB = "__hub__";

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const OPCOES_TIPO: { value: TipoContratacao; label: string }[] = [
  { value: "pj", label: "PJ" },
  { value: "clt_recibo", label: "CLT + Recibo" },
  { value: "clt", label: "CLT" },
  { value: "estagio", label: "Estágio" },
  { value: "socio", label: "Sócio" },
];

const OPCOES_STATUS: { value: CadastroStatus; label: string }[] = [
  { value: "ativo", label: "Ativos" },
  { value: "inativo", label: "Inativos" },
];

const OPCOES_GENERO: { value: GeneroIdentidade; label: string }[] = [
  "mulher_cis",
  "mulher_trans",
  "homem_cis",
  "homem_trans",
  "nao_binario",
  "outro",
  "prefiro_nao_informar",
].map((g) => ({
  value: g as GeneroIdentidade,
  label: generoIdentidadeLabel(g as GeneroIdentidade),
}));

const OPCOES_FILHO: { value: "sim" | "nao"; label: string }[] = [
  { value: "sim", label: "Com filho" },
  { value: "nao", label: "Sem filho" },
];

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

  // Catálogos derivados dos dados. Cargos ordenados alfabeticamente para
  // varredura visual; valores vazios/null ignorados.
  const cargosOpcoes = React.useMemo(() => {
    const set = new Set<string>();
    for (const c of colaboradores) {
      if (c.funcao && c.funcao.trim()) set.add(c.funcao.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [colaboradores]);

  // Ids/catálogos "universo" de cada filtro — base para o default "tudo
  // marcado = sem filtro".
  const todosCargos = cargosOpcoes;
  const todosTipos = React.useMemo(() => OPCOES_TIPO.map((o) => o.value), []);
  const todasEmpresas = React.useMemo(
    () => empresasOpcoes.map((e) => e.id),
    [empresasOpcoes],
  );
  const todasRegionais = React.useMemo(
    () => [HUB, ...regionaisOpcoes.map((r) => r.id)],
    [regionaisOpcoes],
  );
  const todasLocalizacoes = React.useMemo(
    () => [...COLABORADOR_LOCALIZACOES, SEM],
    [],
  );
  const todosGeneros = React.useMemo(
    () => [...OPCOES_GENERO.map((o) => o.value), SEM],
    [],
  );
  const todosFilhos = React.useMemo(
    () => [...OPCOES_FILHO.map((o) => o.value), SEM],
    [],
  );

  // Default "todos marcados" em cada filtro. Trocar o universo (ex.: lista
  // de empresas/cargos mudar de uma sessão para outra) não zera o estado:
  // os selecionados se mantêm, e novas opções entram marcadas automático.
  // Default: só Ativos. Inativos entram sob demanda via filtro — evita
  // poluir a lista (e os KPIs derivados) com quem já saiu da agência.
  const [status, setStatus] = React.useState<string[]>(["ativo"]);
  const [tipos, setTipos] = React.useState<string[]>(todosTipos);
  const [cargos, setCargos] = React.useState<string[]>(todosCargos);
  const [empresas, setEmpresas] = React.useState<string[]>(todasEmpresas);
  const [regionais, setRegionais] = React.useState<string[]>(todasRegionais);
  const [localizacoes, setLocalizacoes] =
    React.useState<string[]>(todasLocalizacoes);
  const [generos, setGeneros] = React.useState<string[]>(todosGeneros);
  const [filhos, setFilhos] = React.useState<string[]>(todosFilhos);

  // Novas opções do universo entram como marcadas (mantém semântica "tudo
  // marcado = sem filtro"); opções removidas somem.
  useReconciliarUniverso(cargos, setCargos, todosCargos);
  useReconciliarUniverso(empresas, setEmpresas, todasEmpresas);
  useReconciliarUniverso(regionais, setRegionais, todasRegionais);

  // Ocultos por padrão — decisão de UI pra evitar exposição acidental de
  // salários em telas compartilhadas. O RH clica no ícone da coluna Valor
  // pra revelar.
  const [salariosOcultos, setSalariosOcultos] = React.useState(true);

  // Regionais disponíveis no dropdown: quando pelo menos uma empresa está
  // filtrada (recorte efetivo), só mostra as regionais dela; Hub sempre.
  const empresaFiltroAtivo = empresas.length !== todasEmpresas.length;
  const regionaisOpcoesDisponiveis = React.useMemo(() => {
    const base = empresaFiltroAtivo
      ? regionaisOpcoes.filter((r) => empresas.includes(r.empresa_id))
      : regionaisOpcoes;
    return [{ id: HUB, nome: "Hub", empresa_id: "" }, ...base];
  }, [regionaisOpcoes, empresas, empresaFiltroAtivo]);

  const filtered = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    const statusSet = new Set(status);
    const tiposSet = new Set(tipos);
    const cargosSet = new Set(cargos);
    const empresasSet = new Set(empresas);
    const regionaisSet = new Set(regionais);
    const locSet = new Set(localizacoes);
    const genSet = new Set(generos);
    const filhosSet = new Set(filhos);

    return colaboradores.filter((c) => {
      if (!statusSet.has(c.status)) return false;
      if (!tiposSet.has(c.tipo_contratacao)) return false;
      if (!cargosSet.has(c.funcao)) return false;

      if (!empresasSet.has(c.empresa_id ?? "__null__")) {
        // Colaborador sem empresa só passa se "sem empresa" estiver marcado —
        // hoje tratamos empresa==null como "não casa com nenhuma opção
        // selecionada", então filtra fora quando o filtro está ativo.
        if (empresaFiltroAtivo) return false;
      }

      // Regional/Hub: casa se a regional id está marcada OU se é Hub e
      // HUB está marcado.
      if (c.usa_rateio_empresa) {
        if (!regionaisSet.has(HUB)) return false;
      } else if (c.regional_id) {
        if (!regionaisSet.has(c.regional_id)) return false;
      } else {
        // Sem regional e sem Hub: só passa se Hub está marcado (bucket
        // "não enquadrado"). Mantém compat com o filtro antigo que só
        // tinha Hub ou regional específica.
        if (!regionaisSet.has(HUB)) return false;
      }

      // Localização
      const locKey = c.localizacao ?? SEM;
      if (!locSet.has(locKey)) return false;

      // Gênero
      const genKey = c.genero_identidade ?? SEM;
      if (!genSet.has(genKey)) return false;

      // Filhos
      const filhoKey =
        c.possui_filhos === true ? "sim" : c.possui_filhos === false ? "nao" : SEM;
      if (!filhosSet.has(filhoKey)) return false;

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
    tipos,
    cargos,
    empresas,
    empresaFiltroAtivo,
    regionais,
    localizacoes,
    generos,
    filhos,
  ]);

  const totalFiltrado = React.useMemo(
    () => filtered.reduce((acc, c) => acc + (c.salario_vigente ?? 0), 0),
    [filtered],
  );

  return (
    <div className="space-y-4">
      {/* Linha de filtros: busca + N multi-select. A barra quebra conforme a
          largura — o PageHeader mantém as ações do topo. */}
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
        <FiltroMulti
          label="Status"
          opcoes={OPCOES_STATUS.map((o) => ({ value: o.value, label: o.label }))}
          selecionados={status}
          onChange={setStatus}
          largura="w-[130px]"
        />
        <FiltroMulti
          label="Cargo"
          opcoes={cargosOpcoes.map((c) => ({ value: c, label: c }))}
          selecionados={cargos}
          onChange={setCargos}
          largura="w-[170px]"
        />
        <FiltroMulti
          label="Tipo"
          opcoes={OPCOES_TIPO.map((o) => ({ value: o.value, label: o.label }))}
          selecionados={tipos}
          onChange={setTipos}
          largura="w-[150px]"
        />
        <FiltroMulti
          label="Empresa"
          opcoes={empresasOpcoes.map((e) => ({ value: e.id, label: e.nome }))}
          selecionados={empresas}
          onChange={setEmpresas}
          largura="w-[170px]"
        />
        <FiltroMulti
          label="Regional"
          opcoes={regionaisOpcoesDisponiveis.map((r) => ({
            value: r.id,
            label: r.nome,
          }))}
          selecionados={regionais}
          onChange={setRegionais}
          largura="w-[170px]"
        />
        <FiltroMulti
          label="Localização"
          opcoes={[
            ...COLABORADOR_LOCALIZACOES.map((l) => ({
              value: l,
              label: localizacaoLabel(l),
            })),
            { value: SEM, label: "Não informado" },
          ]}
          selecionados={localizacoes}
          onChange={setLocalizacoes}
          largura="w-[170px]"
        />
        <FiltroMulti
          label="Gênero"
          opcoes={[
            ...OPCOES_GENERO,
            { value: SEM, label: "Não informado" },
          ]}
          selecionados={generos}
          onChange={setGeneros}
          largura="w-[170px]"
        />
        <FiltroMulti
          label="Filhos"
          opcoes={[...OPCOES_FILHO, { value: SEM, label: "Não informado" }]}
          selecionados={filhos}
          onChange={setFilhos}
          largura="w-[140px]"
        />
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
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-40">
                  Regional
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-36">
                  Localização
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
                        className="uppercase hover:text-california-red transition-colors"
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
                    {c.usa_rateio_empresa
                      ? "Hub"
                      : c.regional_nome ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {c.localizacao ?? "—"}
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
                <td colSpan={4} />
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
 * Multi-select de filtro no padrão "tudo marcado = sem filtro". Mostra:
 *   - "{label}: Todos" quando tudo está marcado,
 *   - "{label}: {0 selecionados}" quando nada está marcado,
 *   - "{label}: {primeiro}" quando 1 está marcado,
 *   - "{label}: {N} selecionados" quando 2+ estão marcados.
 *
 * Inclui ações "Marcar todos" e "Limpar" no cabeçalho do popover. O
 * universo da lista é o conjunto de opções recebidas — não guarda estado
 * de "o que é universo" por fora, então novas opções do pai precisam ser
 * reconciliadas antes de chegar aqui (ver useReconciliarUniverso).
 */
function FiltroMulti({
  label,
  opcoes,
  selecionados,
  onChange,
  largura,
}: {
  label: string;
  opcoes: { value: string; label: string }[];
  selecionados: string[];
  onChange: (v: string[]) => void;
  largura: string;
}) {
  const [open, setOpen] = React.useState(false);
  const selSet = React.useMemo(() => new Set(selecionados), [selecionados]);
  const todasMarcadas =
    opcoes.length > 0 && opcoes.every((o) => selSet.has(o.value));
  const nenhumaMarcada = opcoes.every((o) => !selSet.has(o.value));

  const resumo = React.useMemo(() => {
    if (todasMarcadas) return "Todos";
    const marcados = opcoes.filter((o) => selSet.has(o.value));
    if (marcados.length === 0) return "Nenhum";
    if (marcados.length === 1) return marcados[0].label;
    return `${marcados.length} selecionados`;
  }, [opcoes, selSet, todasMarcadas]);

  function alternar(v: string) {
    if (selSet.has(v)) {
      onChange(selecionados.filter((x) => x !== v));
    } else {
      onChange([...selecionados, v]);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-9 items-center justify-between gap-1.5 rounded-lg border border-input bg-white px-2.5 text-[13px] text-foreground outline-none hover:border-california-red/40",
            !todasMarcadas && "border-california-red/40 bg-california-red/5",
            largura,
          )}
        >
          <span className="truncate text-left">
            <span className="font-medium text-muted-foreground">{label}:</span>{" "}
            <span>{resumo}</span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        avoidCollisions={false}
        className="w-[260px] p-0"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border p-2 text-xs">
          <button
            type="button"
            onClick={() => onChange(opcoes.map((o) => o.value))}
            disabled={todasMarcadas}
            className="rounded-md px-2 py-1 font-medium text-california-red hover:bg-california-red/5 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            Marcar todos
          </button>
          <button
            type="button"
            onClick={() => onChange([])}
            disabled={nenhumaMarcada}
            className="rounded-md px-2 py-1 font-medium text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
          >
            Limpar
          </button>
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          {opcoes.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              Nenhuma opção.
            </p>
          )}
          {opcoes.map((o) => {
            const marcado = selSet.has(o.value);
            return (
              <button
                type="button"
                key={o.value}
                onClick={() => alternar(o.value)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent",
                  marcado && "bg-accent/40",
                )}
              >
                <span
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    marcado
                      ? "border-california-red bg-california-red text-white"
                      : "border-border bg-white",
                  )}
                >
                  {marcado && <Check className="h-3 w-3" />}
                </span>
                <span className="truncate">{o.label}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Garante que o estado de um filtro reflita o universo atual: opções novas
 * entram marcadas (preserva "tudo marcado = sem filtro"); opções que saíram
 * do universo somem do estado.
 */
function useReconciliarUniverso(
  selecionados: string[],
  setSelecionados: (v: string[]) => void,
  universo: string[],
) {
  React.useEffect(() => {
    const selSet = new Set(selecionados);
    const univSet = new Set(universo);
    // Novas opções: entram marcadas.
    const novas = universo.filter((v) => !selSet.has(v));
    // Opções que sumiram: removidas do estado.
    const sobreviventes = selecionados.filter((v) => univSet.has(v));
    if (novas.length === 0 && sobreviventes.length === selecionados.length) {
      return;
    }
    setSelecionados([...sobreviventes, ...novas]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [universo]);
}

