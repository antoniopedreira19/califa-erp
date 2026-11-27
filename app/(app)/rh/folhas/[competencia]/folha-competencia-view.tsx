"use client";

import * as React from "react";
import {
  Search,
  AlertCircle,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Palmtree,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type {
  Empresa,
  FolhaLinhaStatus,
  FolhaOrigem,
  TipoContratacao,
} from "@/lib/types";
import { folhaLinhaStatusLabel, tipoContratacaoLabel } from "@/lib/types";
import { EditarLinhaFolhaDrawer } from "./editar-linha-folha-drawer";

type TipoFiltro = "todos" | TipoContratacao;
type OrigemFiltro = "todas" | FolhaOrigem;
const SENTINEL_TODOS_TIPOS = "todos";
const SENTINEL_TODAS_ORIGENS = "todas";
const ORDEM_TIPO: TipoContratacao[] = [
  "pj",
  "mei",
  "clt_recibo",
  "clt",
  "estagio",
  "socio",
];

/** Item renderizado na coluna Alocação. "hub" = colaborador segue o rateio
 *  padrão da empresa daquele ano (compacto). "regional" = linha específica. */
export type AlocacaoDisplay =
  | { tipo: "hub"; empresa_nome: string }
  | {
      tipo: "regional";
      empresa_nome: string;
      regional_nome: string;
      percentual: string;
    };

export type FolhaLinha = {
  id: string;
  salario_base: string;
  /** Desconto de benefícios aplicado (string de numeric; "0" quando não há). */
  desconto_beneficios: string;
  status: FolhaLinhaStatus;
  origem: FolhaOrigem;
  motivo_pendencia: string | null;
  colaborador: {
    id: string;
    nome: string;
    cpf: string | null;
    funcao: string;
    tipo_contratacao: TipoContratacao;
    nivel_codigo: string | null;
  };
  alocacoes: {
    id: string;
    empresa_id: string;
    regional_id: string;
    percentual: string;
    empresa_nome: string;
    regional_nome: string;
  }[];
  /** Alocações já formatadas pra exibição (com detecção de rateio padrão → Hub).
   *  Computado no server. */
  alocacoes_display: AlocacaoDisplay[];
  /** NF anexada pra (colab, competência)? Só relevante quando a linha
   *  exige NF (origem=california + tipo in pj/mei/clt_recibo). */
  tem_nf: boolean;
  /** Dias de férias que caíram no mês e foram descontados do salário.
   *  0 quando o colaborador não teve férias nesse mês. */
  dias_ferias_mes: number;
};

export type ContagemStatus = Record<
  Exclude<FolhaLinhaStatus, "cancelada_rescisao">,
  number
>;

// `cancelada_rescisao` nunca é exibido nessa tela — a query do servidor
// filtra na origem. Mantido fora das abas pra não aparecer na nav.
type StatusFiltro = "todos" | Exclude<FolhaLinhaStatus, "cancelada_rescisao">;
const SENTINEL_TODAS_REGIONAIS = "__todas__";

const TABS: Array<{ key: StatusFiltro; label: string }> = [
  { key: "todos", label: "Todos" },
  { key: "rascunho", label: "Rascunho" },
  { key: "enviada", label: "Enviada" },
  { key: "pendente_correcao", label: "Pendente" },
  { key: "aprovada", label: "Aprovada" },
  { key: "paga", label: "Paga" },
];

export function FolhaCompetenciaView({
  linhas,
  empresas: _empresas,
  regionais,
  contagem,
  podeEditar,
  beneficiosAplicado,
}: {
  linhas: FolhaLinha[];
  empresas: Pick<Empresa, "id" | "nome_fantasia">[];
  regionais: { id: string; nome: string; empresa_id: string }[];
  contagem: ContagemStatus;
  podeEditar: boolean;
  beneficiosAplicado: boolean;
}) {
  const [busca, setBusca] = React.useState("");
  const [tab, setTab] = React.useState<StatusFiltro>("todos");
  const [regionalId, setRegionalId] = React.useState<string>(
    SENTINEL_TODAS_REGIONAIS,
  );
  const [tipo, setTipo] = React.useState<TipoFiltro>("todos");
  const [origem, setOrigem] = React.useState<OrigemFiltro>("todas");
  const [somenteFerias, setSomenteFerias] = React.useState(false);
  const [linhaEditando, setLinhaEditando] = React.useState<FolhaLinha | null>(
    null,
  );
  // Ordenação da tabela. Default: nome do colaborador em ordem alfabética (asc).
  // Clique no cabeçalho alterna asc → desc → asc da mesma coluna, ou troca de coluna.
  const [ordenacao, setOrdenacao] = React.useState<{
    coluna: "nome" | "valor";
    direcao: "asc" | "desc";
  }>({ coluna: "nome", direcao: "asc" });

  const alternarOrdenacao = (coluna: "nome" | "valor") => {
    setOrdenacao((atual) =>
      atual.coluna === coluna
        ? { coluna, direcao: atual.direcao === "asc" ? "desc" : "asc" }
        : { coluna, direcao: coluna === "nome" ? "asc" : "desc" },
    );
  };

  // Só os tipos que efetivamente aparecem nessa competência vão pro seletor,
  // com a contagem — espelha o padrão da aba Folhas em Contas a Pagar.
  const tiposPresentes = React.useMemo(() => {
    const presentes = new Set(linhas.map((l) => l.colaborador.tipo_contratacao));
    return ORDEM_TIPO.filter((t) => presentes.has(t));
  }, [linhas]);

  const totalEmFerias = React.useMemo(
    () => linhas.filter((l) => l.dias_ferias_mes > 0).length,
    [linhas],
  );

  const filtradas = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    const resultado = linhas.filter((l) => {
      if (tab !== "todos" && l.status !== tab) return false;
      if (tipo !== "todos" && l.colaborador.tipo_contratacao !== tipo)
        return false;
      if (origem !== "todas" && l.origem !== origem) return false;
      if (somenteFerias && l.dias_ferias_mes <= 0) return false;
      if (
        regionalId !== SENTINEL_TODAS_REGIONAIS &&
        !l.alocacoes.some((a) => a.regional_id === regionalId)
      ) {
        return false;
      }
      if (!q) return true;
      return (
        l.colaborador.nome.toLowerCase().includes(q) ||
        l.colaborador.funcao.toLowerCase().includes(q)
      );
    });

    const sinal = ordenacao.direcao === "asc" ? 1 : -1;
    const ordenadas = [...resultado].sort((a, b) => {
      if (ordenacao.coluna === "nome") {
        return (
          sinal *
          a.colaborador.nome.localeCompare(b.colaborador.nome, "pt-BR", {
            sensitivity: "base",
          })
        );
      }
      return sinal * (Number(a.salario_base) - Number(b.salario_base));
    });
    return ordenadas;
  }, [linhas, busca, tab, tipo, origem, regionalId, somenteFerias, ordenacao]);

  const contagemPorTab: Record<StatusFiltro, number> = {
    todos: linhas.length,
    rascunho: contagem.rascunho,
    enviada: contagem.enviada,
    aprovada: contagem.aprovada,
    pendente_correcao: contagem.pendente_correcao,
    paga: contagem.paga,
  };

  if (linhas.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card py-16 text-center">
        <p className="text-sm text-muted-foreground">
          Nenhuma linha nesta competência.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Filtrar por status"
        className="flex items-center gap-1 border-b border-border"
      >
        {TABS.map((t) => (
          <TabButton
            key={t.key}
            active={tab === t.key}
            onClick={() => setTab(t.key)}
            count={contagemPorTab[t.key]}
            tomBadge={
              t.key === "pendente_correcao" && contagemPorTab[t.key] > 0
                ? "vermelho"
                : t.key === "paga" && contagemPorTab[t.key] > 0
                  ? "verde"
                  : undefined
            }
          >
            {t.label}
          </TabButton>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-md min-w-[240px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou função..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={tipo} onValueChange={(v) => setTipo(v as TipoFiltro)}>
          <SelectTrigger className="w-56" aria-label="Tipo de contratação">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SENTINEL_TODOS_TIPOS}>
              Todas as contratações
            </SelectItem>
            {tiposPresentes.map((t) => (
              <SelectItem key={t} value={t}>
                {tipoContratacaoLabel(t)} (
                {linhas.filter((l) => l.colaborador.tipo_contratacao === t).length}
                )
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={origem}
          onValueChange={(v) => setOrigem(v as OrigemFiltro)}
        >
          <SelectTrigger className="w-44" aria-label="Origem da linha">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SENTINEL_TODAS_ORIGENS}>
              Origem: Todas ({linhas.length})
            </SelectItem>
            <SelectItem value="california">
              Origem: PJ ({linhas.filter((l) => l.origem === "california").length})
            </SelectItem>
            <SelectItem value="contabilidade">
              Origem: CLT ({linhas.filter((l) => l.origem === "contabilidade").length})
            </SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={regionalId}
          onValueChange={(v) => setRegionalId(v)}
        >
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SENTINEL_TODAS_REGIONAIS}>
              Todas as regionais
            </SelectItem>
            {regionais.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          type="button"
          onClick={() => setSomenteFerias((v) => !v)}
          disabled={totalEmFerias === 0}
          aria-pressed={somenteFerias}
          title={
            totalEmFerias === 0
              ? "Nenhum colaborador em férias nesta competência"
              : somenteFerias
                ? "Mostrar todos os colaboradores"
                : "Mostrar apenas quem teve desconto por férias"
          }
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-california-red/40",
            somenteFerias
              ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
              : "border-border bg-background text-muted-foreground hover:text-foreground",
            totalEmFerias === 0 && "cursor-not-allowed opacity-50 hover:bg-background",
          )}
        >
          <Palmtree className="h-4 w-4" />
          Em férias
          <span
            className={cn(
              "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold",
              somenteFerias
                ? "bg-amber-600 text-white"
                : "bg-muted text-muted-foreground",
            )}
          >
            {totalEmFerias}
          </span>
        </button>
        <span className="ml-auto text-xs text-muted-foreground">
          Mostrando {filtradas.length} de {linhas.length}
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                <ColunaOrdenavel
                  rotulo="Colaborador"
                  coluna="nome"
                  alinhamento="left"
                  ordenacao={ordenacao}
                  onToggle={alternarOrdenacao}
                />
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Alocação
              </th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground w-40">
                <ColunaOrdenavel
                  rotulo="Valor"
                  coluna="valor"
                  alinhamento="right"
                  ordenacao={ordenacao}
                  onToggle={alternarOrdenacao}
                />
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground w-32">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {filtradas.map((l) => (
              <tr
                key={l.id}
                onClick={() => setLinhaEditando(l)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setLinhaEditando(l);
                  }
                }}
                className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-muted/50"
              >
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium uppercase">{l.colaborador.nome}</span>
                    <SeloFluxo
                      tipo={l.colaborador.tipo_contratacao}
                      origem={l.origem}
                    />
                    {l.colaborador.tipo_contratacao === "clt_recibo" && (
                      <SeloHibrido />
                    )}
                    <SeloNfAnexada
                      exigeNf={
                        l.origem === "california" &&
                        ["pj", "mei", "clt_recibo"].includes(
                          l.colaborador.tipo_contratacao,
                        )
                      }
                      temNf={l.tem_nf}
                    />
                    {l.dias_ferias_mes > 0 && (
                      <SeloFerias dias={l.dias_ferias_mes} />
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {l.colaborador.funcao}
                    {" · "}
                    {tipoContratacaoLabel(l.colaborador.tipo_contratacao)}
                  </div>
                  {l.colaborador.cpf && (
                    <div className="text-[11px] font-mono text-muted-foreground mt-0.5">
                      {formatarCpf(l.colaborador.cpf)}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {l.alocacoes_display.map((a, i) =>
                    a.tipo === "hub" ? (
                      <div key={`${a.empresa_nome}-${i}`}>
                        {a.empresa_nome} ·{" "}
                        <span className="font-medium">Hub</span>
                      </div>
                    ) : (
                      <div key={`${a.empresa_nome}-${a.regional_nome}-${i}`}>
                        {a.empresa_nome} · {a.regional_nome} ·{" "}
                        <span className="tabular-nums font-medium">
                          {Number(a.percentual).toFixed(2).replace(".", ",")}%
                        </span>
                      </div>
                    ),
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  <ValorCell
                    liquido={Number(l.salario_base)}
                    desconto={Number(l.desconto_beneficios)}
                    origem={l.origem}
                    linhaId={l.id}
                  />
                </td>
                <td className="px-4 py-3">
                  <BadgeStatus status={l.status} />
                  {l.status === "pendente_correcao" && l.motivo_pendencia && (
                    <div className="mt-1 flex items-start gap-1 text-[10px] text-california-red">
                      <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                      <span>{l.motivo_pendencia}</span>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {filtradas.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-8 text-center text-sm text-muted-foreground"
                >
                  Nenhuma linha corresponde aos filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {linhaEditando && (
        <EditarLinhaFolhaDrawer
          linha={linhaEditando}
          empresas={_empresas}
          regionais={regionais}
          podeEditar={podeEditar}
          beneficiosAplicado={beneficiosAplicado}
          open={!!linhaEditando}
          onOpenChange={(next) => {
            if (!next) setLinhaEditando(null);
          }}
        />
      )}
    </div>
  );
}

/** Cabeçalho de coluna ordenável. Mostra ArrowUpDown neutro quando a coluna
 *  não está ativa; ArrowUp/ArrowDown em vermelho California quando está. */
function ColunaOrdenavel({
  rotulo,
  coluna,
  alinhamento,
  ordenacao,
  onToggle,
}: {
  rotulo: string;
  coluna: "nome" | "valor";
  alinhamento: "left" | "right";
  ordenacao: { coluna: "nome" | "valor"; direcao: "asc" | "desc" };
  onToggle: (coluna: "nome" | "valor") => void;
}) {
  const ativa = ordenacao.coluna === coluna;
  const Icone = ativa
    ? ordenacao.direcao === "asc"
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;
  const ariaSort = ativa
    ? ordenacao.direcao === "asc"
      ? "ascending"
      : "descending"
    : "none";
  return (
    <button
      type="button"
      onClick={() => onToggle(coluna)}
      aria-sort={ariaSort}
      className={cn(
        "inline-flex items-center gap-1.5 font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:text-california-red",
        alinhamento === "right" && "flex-row-reverse",
        ativa ? "text-california-red" : "text-muted-foreground",
      )}
    >
      <span>{rotulo}</span>
      <Icone className="h-3.5 w-3.5" />
    </button>
  );
}

function TabButton({
  active,
  onClick,
  count,
  tomBadge,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count?: number;
  tomBadge?: "vermelho" | "verde";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 whitespace-nowrap px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors focus-visible:outline-none focus-visible:text-california-red",
        active
          ? "border-california-red text-california-red"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      {count !== undefined && count > 0 && (
        <span
          className={cn(
            "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold",
            active
              ? "bg-california-red text-white"
              : tomBadge === "vermelho"
                ? "bg-california-red/10 text-california-red"
                : tomBadge === "verde"
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-muted text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/** Rótulo + cor de um pagamento, derivado de (tipo contratual, origem da linha).
 *
 *  Azul (origem california, gerada pela California):
 *    - pj, mei → PJ
 *    - clt_recibo → Recibo (parte RPA do híbrido)
 *
 *  Verde (origem contabilidade, importada do PDF):
 *    - clt → CLT
 *    - clt_recibo → CLT (parte CLT do híbrido)
 *    - estagio → Estagiário
 *    - socio → Sócio
 */
function rotuloFluxo(
  tipo: TipoContratacao,
  origem: FolhaOrigem,
): { label: string; tom: "azul" | "verde" } {
  if (origem === "california") {
    if (tipo === "clt_recibo") return { label: "Recibo", tom: "azul" };
    return { label: "PJ", tom: "azul" };
  }
  // origem === "contabilidade"
  if (tipo === "estagio") return { label: "Estagiário", tom: "verde" };
  if (tipo === "socio") return { label: "Sócio", tom: "verde" };
  return { label: "CLT", tom: "verde" };
}

function SeloFluxo({
  tipo,
  origem,
}: {
  tipo: TipoContratacao;
  origem: FolhaOrigem;
}) {
  const { label, tom } = rotuloFluxo(tipo, origem);
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0 text-[10px] font-semibold ${
        tom === "azul"
          ? "bg-blue-100 text-blue-800"
          : "bg-emerald-100 text-emerald-800"
      }`}
      title={`${tipoContratacaoLabel(tipo)} · ${
        origem === "california"
          ? "gerada pela California"
          : "importada da contabilidade"
      }`}
    >
      {label}
    </span>
  );
}

function SeloHibrido() {
  return (
    <span
      className="inline-flex items-center rounded-full border border-border px-1.5 py-0 text-[10px] font-semibold text-muted-foreground"
      title="Colaborador CLT + Recibo (híbrido): parte do salário vai como Recibo (RPA) e parte como CLT."
    >
      Híbrido
    </span>
  );
}

/** Indicador de dias de férias descontados no mês. O salário_base já veio
 *  reduzido pelo ratio (30 - dias) / 30 na função `gerar_folha_da_competencia`
 *  — este selo apenas sinaliza que isso aconteceu. */
function SeloFerias({ dias }: { dias: number }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0 text-[10px] font-semibold text-amber-800"
      title={`Colaborador teve ${dias} dia${dias === 1 ? "" : "s"} de férias no mês. Salário foi descontado proporcionalmente.`}
    >
      <Palmtree className="h-3 w-3" />
      Férias · {dias}d
    </span>
  );
}

/** Indica se o colaborador já anexou NF da competência. Verde = anexada;
 *  cinza = pendente. Só renderiza quando a linha exige NF. */
function SeloNfAnexada({
  exigeNf,
  temNf,
}: {
  exigeNf: boolean;
  temNf: boolean;
}) {
  if (!exigeNf) return null;
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0 text-[10px] font-semibold ${
        temNf
          ? "bg-emerald-100 text-emerald-800"
          : "bg-muted text-muted-foreground"
      }`}
      title={temNf ? "NF anexada" : "NF ainda não anexada"}
    >
      NF {temNf ? "✓" : "—"}
    </span>
  );
}

function BadgeStatus({ status }: { status: FolhaLinhaStatus }) {
  // `cancelada_rescisao` nunca deveria chegar aqui — a query da folha
  // mensal filtra na origem — mas o tipo exige o mapa completo.
  const cores: Record<FolhaLinhaStatus, string> = {
    rascunho: "bg-muted text-muted-foreground",
    enviada: "bg-blue-50 text-blue-700",
    aprovada: "bg-emerald-50 text-emerald-700",
    pendente_correcao: "bg-california-red/10 text-california-red",
    paga: "bg-emerald-600 text-white",
    cancelada_rescisao: "bg-muted text-muted-foreground line-through",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${cores[status]}`}
    >
      {folhaLinhaStatusLabel(status)}
    </span>
  );
}

/** Formata CPF só-dígitos pra "xxx.xxx.xxx-xx". */
function formatarCpf(cpf: string): string {
  const d = cpf.replace(/\D/g, "");
  if (d.length !== 11) return cpf;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

const brlFmt = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/** Célula do Valor. Sem desconto: um valor só, grande. Com desconto: 3 linhas
 *  (bruto, desconto em vermelho, líquido em negrito). */
function ValorCell({
  liquido,
  desconto,
  origem,
  linhaId,
}: {
  liquido: number;
  desconto: number;
  origem: FolhaOrigem;
  linhaId: string;
}) {
  // Breakdown bruto/desc/líquido só em linhas PJ (origem california). CLT já vem
  // líquido da contabilidade; se vier desconto > 0 em CLT, é bug de dado — log
  // warning e renderiza só o valor simples.
  const temDescontoEfetivo = desconto > 0 && origem === "california";
  const temDescontoInvalido = desconto > 0 && origem !== "california";

  if (temDescontoInvalido) {
    console.warn(
      "[folha-view] linha CLT com desconto_beneficios > 0 — não esperado",
      { linhaId, desconto },
    );
  }

  if (!temDescontoEfetivo) {
    return <span className="font-semibold">{brlFmt.format(liquido)}</span>;
  }
  const bruto = liquido + desconto;
  return (
    <div className="space-y-0.5 text-right">
      <div className="text-xs text-muted-foreground">
        Bruto <span className="tabular-nums">{brlFmt.format(bruto)}</span>
      </div>
      <div className="text-xs text-california-red">
        Desc. <span className="tabular-nums">−{brlFmt.format(desconto)}</span>
      </div>
      <div className="font-semibold">
        <span className="text-[10px] text-muted-foreground mr-1">Líquido</span>
        <span className="tabular-nums">{brlFmt.format(liquido)}</span>
      </div>
    </div>
  );
}
