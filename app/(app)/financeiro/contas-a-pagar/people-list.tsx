"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, ChevronDown, ChevronRight, Search, XCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PeopleAprovarItem, TipoContratacao } from "@/lib/types";
import { tipoContratacaoLabel } from "@/lib/types";
import type { ColaboradorPagamento } from "@/lib/financeiro/colaboradores-pagamento";
import { RevisarFolhaDrawer } from "./revisar-folha-drawer";
import type { FolhaLinhaFinanceiro } from "./people-list-types";

type OrdenacaoColuna = "nome" | "valor" | null;
type OrdenacaoDirecao = "asc" | "desc";

// Sentinel usado no Select pra representar "sem filtro" — Radix Select nao
// aceita SelectItem value="" (crasha).
const SEM_FILTRO = "__sem_filtro__";

const ESCOPO_OPCOES: {
  valor: PeopleAprovarItem["escopo_tipo"];
  label: string;
}[] = [
  { valor: "folha_mensal", label: "Folha" },
  { valor: "ferias_usufruto", label: "Férias" },
  { valor: "ferias_abono", label: "Abono" },
  { valor: "decimo_terceiro_p1", label: "13º 1ª parcela" },
  { valor: "decimo_terceiro_p2", label: "13º 2ª parcela" },
  { valor: "decimo_terceiro_adiantamento", label: "13º adiantamento" },
];

const NOMES_MES = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

// ---------------------------------------------------------------------------
// Helpers de badge
// ---------------------------------------------------------------------------

type BadgeVariant = "azul" | "verde" | "amarelo" | "roxo";

function badgeVariantParaEscopo(
  escopo: PeopleAprovarItem["escopo_tipo"],
): BadgeVariant {
  switch (escopo) {
    case "folha_mensal":       return "azul";
    case "ferias_usufruto":    return "verde";
    case "ferias_abono":       return "amarelo";
    case "decimo_terceiro_p1": return "roxo";
    case "decimo_terceiro_p2": return "roxo";
    case "decimo_terceiro_adiantamento": return "roxo";
  }
}

function labelEscopoTipo(escopo: PeopleAprovarItem["escopo_tipo"]): string {
  switch (escopo) {
    case "folha_mensal":       return "Folha";
    case "ferias_usufruto":    return "Férias";
    case "ferias_abono":       return "Abono";
    case "decimo_terceiro_p1": return "13º P1";
    case "decimo_terceiro_p2": return "13º P2";
    case "decimo_terceiro_adiantamento": return "13º Adiantamento";
  }
}

function BadgeTipo({
  variante,
  texto,
}: {
  variante: BadgeVariant;
  texto: string;
}) {
  const cls: Record<BadgeVariant, string> = {
    azul:    "bg-blue-100 text-blue-800",
    verde:   "bg-emerald-100 text-emerald-800",
    amarelo: "bg-amber-100 text-amber-800",
    roxo:    "bg-violet-100 text-violet-800",
  };
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${cls[variante]}`}
    >
      {texto}
    </span>
  );
}

function BadgeContratacao({ tipo }: { tipo: TipoContratacao }) {
  const clt = tipo === "clt" || tipo === "estagio";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-semibold ${
        clt
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-border text-muted-foreground"
      }`}
    >
      {tipoContratacaoLabel(tipo)}
    </span>
  );
}

function BadgeNf({ anexada }: { anexada: boolean }) {
  if (anexada) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
        <CheckCircle2 className="h-3 w-3" />
        Anexada
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-california-red/10 px-2 py-0.5 text-xs font-medium text-california-red">
      <XCircle className="h-3 w-3" />
      Pendente
    </span>
  );
}

function formatBRL(v: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(v);
}

function competenciaLabel(ano: number | null, mes: number | null): string {
  if (!ano || !mes) return "—";
  return `${NOMES_MES[mes - 1]}/${ano}`;
}

type AlocacaoItem = {
  id: string;
  empresa_id: string;
  regional_id: string;
  percentual: string;
  empresa_nome: string;
  regional_nome: string;
  usa_rateio_empresa: boolean;
};

/**
 * Colapsa a lista de alocações por empresa, respeitando o modo de rateio.
 * - Empresa em modo "rateio da empresa" (Hub): vira 1 linha "Empresa · Hub (soma%)".
 * - Empresa com regionais explícitas: continua N linhas, uma por regional.
 */
function agruparAlocacaoParaExibicao(items: AlocacaoItem[]): Array<
  | { kind: "hub"; empresa_id: string; empresa_nome: string; percentualTotal: number }
  | {
      kind: "detalhado";
      empresa_id: string;
      empresa_nome: string;
      linhas: Array<{ regional_nome: string; percentual: string }>;
    }
> {
  const porEmpresa = new Map<
    string,
    {
      empresa_id: string;
      empresa_nome: string;
      usa_rateio_empresa: boolean;
      linhas: Array<{ regional_nome: string; percentual: string }>;
      percentualTotal: number;
    }
  >();
  for (const a of items) {
    const grupo = porEmpresa.get(a.empresa_id) ?? {
      empresa_id: a.empresa_id,
      empresa_nome: a.empresa_nome,
      usa_rateio_empresa: a.usa_rateio_empresa,
      linhas: [],
      percentualTotal: 0,
    };
    grupo.linhas.push({ regional_nome: a.regional_nome, percentual: a.percentual });
    grupo.percentualTotal += Number(a.percentual) || 0;
    porEmpresa.set(a.empresa_id, grupo);
  }
  return Array.from(porEmpresa.values()).map((g) =>
    g.usa_rateio_empresa
      ? {
          kind: "hub" as const,
          empresa_id: g.empresa_id,
          empresa_nome: g.empresa_nome,
          percentualTotal: g.percentualTotal,
        }
      : {
          kind: "detalhado" as const,
          empresa_id: g.empresa_id,
          empresa_nome: g.empresa_nome,
          linhas: g.linhas,
        },
  );
}

function CelulaAlocacao({ alocacoes }: { alocacoes: AlocacaoItem[] }) {
  if (alocacoes.length === 0) {
    return <span className="text-muted-foreground/50">—</span>;
  }
  const grupos = agruparAlocacaoParaExibicao(alocacoes);
  return (
    <div className="flex flex-col gap-0.5">
      {grupos.map((g) =>
        g.kind === "hub" ? (
          <span key={g.empresa_id} className="whitespace-nowrap">
            {g.empresa_nome} · Hub
            <span className="ml-1 text-muted-foreground/70 tabular-nums">
              ({g.percentualTotal.toFixed(0)}%)
            </span>
          </span>
        ) : (
          g.linhas.map((l, idx) => (
            <span key={`${g.empresa_id}-${idx}`} className="whitespace-nowrap">
              {g.empresa_nome} · {l.regional_nome}
              <span className="ml-1 text-muted-foreground/70 tabular-nums">
                ({Number(l.percentual).toFixed(0)}%)
              </span>
            </span>
          ))
        ),
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conversão PeopleAprovarItem → FolhaLinhaFinanceiro para o drawer
// ---------------------------------------------------------------------------

function toFolhaLinha(
  item: PeopleAprovarItem,
  colab: ColaboradorPagamento | undefined,
  alocacoes: AlocacaoItem[],
): FolhaLinhaFinanceiro {
  const fallbackColab: ColaboradorPagamento = colab ?? {
    id: item.colaborador_id,
    nome: "—",
    funcao: item.funcao ?? "—",
    tipo_contratacao: item.tipo_contratacao,
    status: "ativo",
    cpf: null,
    cnpj: null,
    razao_social: null,
    pix_tipo: null,
    pix_chave: null,
    banco_codigo: null,
    banco_nome: null,
    agencia: null,
    agencia_dv: null,
    conta: null,
    conta_dv: null,
    tipo_conta: null,
  };
  return {
    id: item.linha_id,
    competencia_ano: item.competencia_ano ?? 0,
    competencia_mes: item.competencia_mes ?? 0,
    salario_base: item.valor != null ? String(item.valor) : "0",
    status: "enviada",
    motivo_pendencia: null,
    origem: item.origem ?? "california",
    nf: item.nf_anexada && item.nf_anexo_id && item.nf_arquivo_nome && item.nf_uploaded_at
      ? {
          id: item.nf_anexo_id,
          arquivo_nome: item.nf_arquivo_nome,
          uploaded_at: item.nf_uploaded_at,
        }
      : null,
    colaborador: fallbackColab,
    alocacoes,
  };
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export function PeopleList({
  items,
  colaboradores,
  alocacoesPorFolha,
  empresas,
  regionais,
}: {
  items: PeopleAprovarItem[];
  /** Objeto colaborador_id → ColaboradorPagamento (serializado do Map do servidor). */
  colaboradores: Record<string, ColaboradorPagamento>;
  /** Alocações das folhas mensais, keyed by folha_id. Férias/abono ficam vazios. */
  alocacoesPorFolha: Record<string, AlocacaoItem[]>;
  empresas: { id: string; nome_fantasia: string }[];
  regionais: { id: string; nome: string; empresa_id: string }[];
}) {
  const [revisandoId, setRevisandoId] = React.useState<string | null>(null);

  // Grupos híbridos (colab × escopo × competência com +1 parte) começam
  // recolhidos. Expandido mantém a chave do grupo no Set.
  const [expandidos, setExpandidos] = React.useState<Set<string>>(new Set());
  function alternarExpansao(chave: string) {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(chave)) next.delete(chave);
      else next.add(chave);
      return next;
    });
  }

  // Filtros
  const [busca, setBusca] = React.useState("");
  const [filtroTipo, setFiltroTipo] = React.useState<string>("");
  const [filtroFuncao, setFiltroFuncao] = React.useState<string>("");
  const [filtroEmpresa, setFiltroEmpresa] = React.useState<string>("");
  const [filtroRegional, setFiltroRegional] = React.useState<string>("");

  // Ordenação
  const [ordenacao, setOrdenacao] = React.useState<{
    coluna: OrdenacaoColuna;
    direcao: OrdenacaoDirecao;
  }>({ coluna: null, direcao: "asc" });

  function alternarOrdenacao(coluna: Exclude<OrdenacaoColuna, null>) {
    setOrdenacao((atual) => {
      if (atual.coluna !== coluna) return { coluna, direcao: "asc" };
      if (atual.direcao === "asc") return { coluna, direcao: "desc" };
      return { coluna: null, direcao: "asc" };
    });
  }

  // Funções únicas presentes nos items — pro dropdown dinâmico.
  const funcoesDisponiveis = React.useMemo(() => {
    const set = new Set<string>();
    for (const i of items) {
      if (i.funcao) set.add(i.funcao);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [items]);

  // Regionais filtradas pela empresa selecionada (se houver).
  const regionaisFiltradas = React.useMemo(() => {
    if (!filtroEmpresa) return regionais;
    return regionais.filter((r) => r.empresa_id === filtroEmpresa);
  }, [regionais, filtroEmpresa]);

  // Se trocar empresa e a regional selecionada não pertencer, limpa.
  React.useEffect(() => {
    if (!filtroRegional) return;
    const existe = regionaisFiltradas.some((r) => r.id === filtroRegional);
    if (!existe) setFiltroRegional("");
  }, [filtroRegional, regionaisFiltradas]);

  const itemsFiltrados = React.useMemo(() => {
    const buscaNormalizada = busca.trim().toLowerCase();
    const filtrados = items.filter((item) => {
      if (filtroTipo && item.escopo_tipo !== filtroTipo) return false;
      if (filtroFuncao && item.funcao !== filtroFuncao) return false;

      const alocacoes = alocacoesPorFolha[item.linha_id] ?? [];
      if (filtroEmpresa) {
        const temEmpresa = alocacoes.some(
          (a) => a.empresa_id === filtroEmpresa,
        );
        if (!temEmpresa) return false;
      }
      if (filtroRegional) {
        const temRegional = alocacoes.some(
          (a) => a.regional_id === filtroRegional,
        );
        if (!temRegional) return false;
      }

      if (buscaNormalizada) {
        const nome = (colaboradores[item.colaborador_id]?.nome ?? "").toLowerCase();
        if (!nome.includes(buscaNormalizada)) return false;
      }
      return true;
    });

    if (ordenacao.coluna) {
      const fator = ordenacao.direcao === "asc" ? 1 : -1;
      filtrados.sort((a, b) => {
        if (ordenacao.coluna === "nome") {
          const na = colaboradores[a.colaborador_id]?.nome ?? "";
          const nb = colaboradores[b.colaborador_id]?.nome ?? "";
          return na.localeCompare(nb, "pt-BR") * fator;
        }
        if (ordenacao.coluna === "valor") {
          const va = a.valor != null ? Number(a.valor) : 0;
          const vb = b.valor != null ? Number(b.valor) : 0;
          return (va - vb) * fator;
        }
        return 0;
      });
    }

    return filtrados;
  }, [
    items,
    busca,
    filtroTipo,
    filtroFuncao,
    filtroEmpresa,
    filtroRegional,
    alocacoesPorFolha,
    colaboradores,
    ordenacao,
  ]);

  const linhaRevisando = React.useMemo(() => {
    if (!revisandoId) return null;
    const item = items.find((i) => i.linha_id === revisandoId);
    if (!item) return null;
    const alocacoes = alocacoesPorFolha[item.linha_id] ?? [];
    return toFolhaLinha(item, colaboradores[item.colaborador_id], alocacoes);
  }, [revisandoId, items, colaboradores, alocacoesPorFolha]);

  // Agrupa linhas que representam o mesmo pagamento em partes diferentes
  // (híbrido CLT+Recibo tem 2 folhas no 13º: uma CLT, outra PJ). Grupos de 1
  // linha são o caso comum. Dentro do grupo, CLT vem primeiro, PJ (california)
  // depois.
  const grupos = React.useMemo(() => {
    const map = new Map<string, PeopleAprovarItem[]>();
    for (const it of itemsFiltrados) {
      const chave = `${it.colaborador_id}|${it.escopo_tipo}|${it.competencia_ano ?? 0}|${it.competencia_mes ?? 0}`;
      const list = map.get(chave) ?? [];
      list.push(it);
      map.set(chave, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (a.origem === b.origem) return 0;
        if (a.origem === "california") return 1;
        return -1;
      });
    }
    return Array.from(map.entries()).map(([chave, items]) => ({ chave, items }));
  }, [itemsFiltrados]);

  function renderLinhaPagamento(
    item: PeopleAprovarItem,
    modo: "unica" | "filha",
  ) {
    const colab = colaboradores[item.colaborador_id];
    const nomeColab = colab?.nome ?? "—";
    const variante = badgeVariantParaEscopo(item.escopo_tipo);
    const is13 =
      item.escopo_tipo === "decimo_terceiro_p1" ||
      item.escopo_tipo === "decimo_terceiro_p2" ||
      item.escopo_tipo === "decimo_terceiro_adiantamento";

    const tipoTexto = is13 ? item.label : labelEscopoTipo(item.escopo_tipo);
    // Na filha, substitui o badge do escopo por "Parte CLT" / "Parte PJ":
    // o escopo já está na linha-pai, não precisa repetir. Deixa a coluna
    // compacta o suficiente pra caber em w-56.
    const ehParteCalifornia = item.origem === "california";

    const alocacoesLinha = alocacoesPorFolha[item.linha_id] ?? [];

    // Espelha a regra do server (actions-folhas.ts: exigeNf):
    //   folha_mensal + origem california + pj/mei/clt_recibo → NF.
    //   decimo_terceiro_adiantamento + origem california + pj/mei/clt_recibo → NF.
    //   Férias (usufruto/abono) → NF.
    //   CLT puro / sócio / estagio e parcelas 13° p1/p2 → não exigem.
    const exigeNfLinha =
      (item.escopo_tipo === "folha_mensal" ||
        item.escopo_tipo === "decimo_terceiro_adiantamento") &&
      item.origem === "california" &&
      ["pj", "mei", "clt_recibo"].includes(item.tipo_contratacao);
    const exigeNfFerias =
      item.escopo_tipo === "ferias_usufruto" ||
      item.escopo_tipo === "ferias_abono";
    const exigeNfParaUI = exigeNfLinha || exigeNfFerias;

    const bloqueado = exigeNfParaUI && !item.nf_anexada;
    const tooltipBloqueado = bloqueado
      ? "Aguardando o colaborador anexar a NF."
      : null;

    const ehFilha = modo === "filha";

    return (
      <tr
        key={item.linha_id}
        className={`border-b border-border last:border-0 ${
          ehFilha ? "bg-muted/30" : ""
        }`}
      >
        <td className={`px-4 py-3 ${ehFilha ? "pl-10" : ""}`}>
          {ehFilha ? (
            <span
              className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${
                ehParteCalifornia
                  ? "border-blue-200 bg-blue-50 text-blue-800"
                  : "border-amber-200 bg-amber-50 text-amber-800"
              }`}
            >
              {ehParteCalifornia ? "Parte PJ" : "Parte CLT"}
            </span>
          ) : (
            <BadgeTipo variante={variante} texto={tipoTexto} />
          )}
        </td>
        <td className="px-4 py-3 tabular-nums text-muted-foreground">
          {competenciaLabel(item.competencia_ano, item.competencia_mes)}
        </td>
        <td className="px-4 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{nomeColab}</span>
          </div>
          <div className="text-xs text-muted-foreground">{item.label}</div>
        </td>
        <td className="px-4 py-3">
          <BadgeContratacao tipo={item.tipo_contratacao} />
        </td>
        <td className="px-4 py-3 text-xs text-muted-foreground">
          <CelulaAlocacao alocacoes={alocacoesLinha} />
        </td>
        <td className="px-4 py-3">
          <BadgeNf anexada={item.nf_anexada} />
        </td>
        <td className="px-4 py-3 text-right tabular-nums font-semibold">
          {item.valor != null ? formatBRL(Number(item.valor)) : "—"}
        </td>
        <td className="px-4 py-3 text-center">
          {bloqueado ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-block">
                  <button
                    type="button"
                    disabled
                    aria-disabled="true"
                    className="rounded-lg border border-border bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground opacity-50 cursor-not-allowed"
                  >
                    Revisar
                  </button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="left">{tooltipBloqueado}</TooltipContent>
            </Tooltip>
          ) : (
            <button
              type="button"
              onClick={() => setRevisandoId(item.linha_id)}
              className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors"
            >
              Revisar
            </button>
          )}
        </td>
      </tr>
    );
  }

  function renderLinhaHibridoPai(
    grupo: { chave: string; items: PeopleAprovarItem[] },
    expandido: boolean,
  ) {
    const first = grupo.items[0];
    const colab = colaboradores[first.colaborador_id];
    const nomeColab = colab?.nome ?? "—";
    const variante = badgeVariantParaEscopo(first.escopo_tipo);
    const is13 =
      first.escopo_tipo === "decimo_terceiro_p1" ||
      first.escopo_tipo === "decimo_terceiro_p2" ||
      first.escopo_tipo === "decimo_terceiro_adiantamento";
    const tipoTexto = is13 ? first.label : labelEscopoTipo(first.escopo_tipo);

    const valorTotal = grupo.items.reduce(
      (acc, i) => acc + (i.valor != null ? Number(i.valor) : 0),
      0,
    );
    // Pra NF do pai: só "Anexada" se TODAS as partes que exigem NF foram anexadas.
    const todasAnexadas = grupo.items.every((i) => i.nf_anexada);

    // Alocação do pai usa a do primeiro item: na prática as partes do híbrido
    // compartilham o mesmo rateio (mesmo colaborador, mesma competência).
    const alocacoesLinha = alocacoesPorFolha[first.linha_id] ?? [];

    return (
      <tr
        key={grupo.chave}
        className="border-b border-border last:border-0 cursor-pointer hover:bg-muted/20"
        onClick={() => alternarExpansao(grupo.chave)}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            {expandido ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <BadgeTipo variante={variante} texto={tipoTexto} />
          </div>
        </td>
        <td className="px-4 py-3 tabular-nums text-muted-foreground">
          {competenciaLabel(first.competencia_ano, first.competencia_mes)}
        </td>
        <td className="px-4 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{nomeColab}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {first.label} · {grupo.items.length} partes
          </div>
        </td>
        <td className="px-4 py-3">
          <BadgeContratacao tipo={first.tipo_contratacao} />
        </td>
        <td className="px-4 py-3 text-xs text-muted-foreground">
          <CelulaAlocacao alocacoes={alocacoesLinha} />
        </td>
        <td className="px-4 py-3">
          <BadgeNf anexada={todasAnexadas} />
        </td>
        <td className="px-4 py-3 text-right tabular-nums font-semibold">
          {formatBRL(valorTotal)}
        </td>
        <td className="px-4 py-3 text-center text-xs font-medium text-muted-foreground">
          {expandido ? "Recolher" : "Ver partes"}
        </td>
      </tr>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border py-16 text-center">
        <p className="text-sm text-muted-foreground">
          Nenhum pagamento aguardando ação. Quando o RH enviar, aparece aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Barra de filtros */}
      <div className="flex flex-wrap items-end gap-3">
        <CampoFiltro rotulo="Buscar" className="min-w-[240px] flex-1">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Nome do colaborador"
              className="pl-9"
            />
          </div>
        </CampoFiltro>

        <CampoFiltro rotulo="Tipo" className="min-w-[160px]">
          <Select
            value={filtroTipo || SEM_FILTRO}
            onValueChange={(v) => setFiltroTipo(v === SEM_FILTRO ? "" : v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SEM_FILTRO}>Todos</SelectItem>
              {ESCOPO_OPCOES.map((o) => (
                <SelectItem key={o.valor} value={o.valor}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CampoFiltro>

        <CampoFiltro rotulo="Função" className="min-w-[180px]">
          <Select
            value={filtroFuncao || SEM_FILTRO}
            onValueChange={(v) => setFiltroFuncao(v === SEM_FILTRO ? "" : v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SEM_FILTRO}>Todas</SelectItem>
              {funcoesDisponiveis.map((f) => (
                <SelectItem key={f} value={f}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CampoFiltro>

        <CampoFiltro rotulo="Empresa" className="min-w-[180px]">
          <Select
            value={filtroEmpresa || SEM_FILTRO}
            onValueChange={(v) => setFiltroEmpresa(v === SEM_FILTRO ? "" : v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SEM_FILTRO}>Todas</SelectItem>
              {empresas.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.nome_fantasia}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CampoFiltro>

        <CampoFiltro rotulo="Regional" className="min-w-[160px]">
          <Select
            value={filtroRegional || SEM_FILTRO}
            onValueChange={(v) => setFiltroRegional(v === SEM_FILTRO ? "" : v)}
            disabled={regionaisFiltradas.length === 0}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SEM_FILTRO}>Todas</SelectItem>
              {regionaisFiltradas.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CampoFiltro>

        <span className="ml-auto pb-2 text-xs text-muted-foreground tabular-nums">
          {itemsFiltrados.length} de {items.length}
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground w-56">
                Tipo
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground w-28">
                Competência
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                <ColunaOrdenavel
                  rotulo="Colaborador"
                  coluna="nome"
                  ordenacao={ordenacao}
                  onClick={() => alternarOrdenacao("nome")}
                />
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground w-20">
                Contratação
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground w-56">
                Alocação
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground w-24">
                NF
              </th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground w-32">
                <ColunaOrdenavel
                  rotulo="Valor"
                  coluna="valor"
                  ordenacao={ordenacao}
                  onClick={() => alternarOrdenacao("valor")}
                  alinhamento="right"
                />
              </th>
              <th className="px-4 py-3 text-center font-medium text-muted-foreground w-24">
                Ação
              </th>
            </tr>
          </thead>
          <tbody>
            {itemsFiltrados.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-12 text-center text-sm text-muted-foreground"
                >
                  Nenhum pagamento encontrado com os filtros atuais.
                </td>
              </tr>
            )}
            {grupos.map((grupo) => {
              if (grupo.items.length === 1) {
                return renderLinhaPagamento(grupo.items[0], "unica");
              }
              const expandido = expandidos.has(grupo.chave);
              return (
                <React.Fragment key={grupo.chave}>
                  {renderLinhaHibridoPai(grupo, expandido)}
                  {expandido &&
                    grupo.items.map((item) =>
                      renderLinhaPagamento(item, "filha"),
                    )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {linhaRevisando && (
        <RevisarFolhaDrawer
          linha={linhaRevisando}
          empresas={empresas}
          regionais={regionais}
          open={!!linhaRevisando}
          onOpenChange={(next) => {
            if (!next) setRevisandoId(null);
          }}
        />
      )}
    </div>
  );
}

function CampoFiltro({
  rotulo,
  className,
  children,
}: {
  rotulo: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-1 ${className ?? ""}`}>
      <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {rotulo}
      </label>
      {children}
    </div>
  );
}

function ColunaOrdenavel({
  rotulo,
  coluna,
  ordenacao,
  onClick,
  alinhamento,
}: {
  rotulo: string;
  coluna: Exclude<OrdenacaoColuna, null>;
  ordenacao: { coluna: OrdenacaoColuna; direcao: OrdenacaoDirecao };
  onClick: () => void;
  alinhamento?: "right";
}) {
  const ativa = ordenacao.coluna === coluna;
  const Icone = !ativa ? ArrowUpDown : ordenacao.direcao === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground transition-colors ${
        alinhamento === "right" ? "flex-row-reverse" : ""
      }`}
    >
      {rotulo}
      <Icone
        className={`h-3 w-3 ${ativa ? "text-foreground" : "text-muted-foreground/60"}`}
      />
    </button>
  );
}
