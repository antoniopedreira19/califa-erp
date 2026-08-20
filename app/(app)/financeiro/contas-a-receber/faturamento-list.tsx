"use client";

/**
 * Aba "Faturamento" (Tela 3.3) — o que ainda espera nota, e o que já saiu.
 *
 * Uma linha por PARCELA do envio: a produção diz, ao liberar o job, em
 * quantas notas ele será faturado. Cada parcela é faturada por sua
 * própria NF, total ou parcialmente.
 *
 * As notas já emitidas continuam aqui, em verde — clicar em `NF <número>`
 * reabre o mesmo formulário em modo somente leitura.
 *
 * Duas regras do protótipo moram nesta tela:
 *
 * 1. **Uma NF agrupada só cobre jobs de um mesmo cliente.** Com mais de
 *    um cliente na seleção o formulário NÃO abre — o erro aparece na
 *    própria barra de seleção, nomeando os clientes.
 * 2. **BV nunca entra em NF agrupada**, porque a contraparte dele é o
 *    fornecedor. O checkbox da linha fica desabilitado.
 */

import * as React from "react";
import {
  AlertCircle,
  Building2,
  Check,
  FileCheck2,
  FileText,
  Hourglass,
  Info,
  Layers,
  Plus,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlanoContaTipo, PlanoContaSubtipo } from "@/lib/types";
import { FaturarDrawer, type DrawerState } from "./faturar-drawer";
import {
  ContatosCobrancaInline,
  type ContatoCobranca,
} from "@/components/financeiro/contatos-cobranca";

// ---------------------------------------------------------------------------
// Tipos das linhas
// ---------------------------------------------------------------------------

export interface FaturamentoPendenteRow {
  origem_tipo: "job" | "bv";
  origem_id: string;
  /** Parcela do envio que esta linha representa. Nulo em BV. */
  envio_parcela_id: string | null;
  empresa_id: string;
  codigo: string | null;
  descricao: string;
  cliente_id: string | null;
  fornecedor_id: string | null;
  contraparte_nome: string;
  /** Valor desta parcela. */
  valor_previsto: number;
  valor_ja_faturado: number;
  /** Saldo desta parcela. */
  saldo: number;
  /** Soma dos saldos de TODAS as parcelas do job — o "total do job". */
  saldo_job: number;
  parcela_numero: number;
  parcela_total: number;
  data_prevista: string | null;
  /** Quem cobrar quando esta parcela virar nota (docs/decisions/012).
   *  Vazio em BV, que não tem job, e nos jobs anteriores a 17/08/2026. */
  contatos: ContatoCobranca[];
}

export interface FaturadoRow {
  faturamento_id: string;
  numero_nf: string;
  data_emissao: string;
  valor_total: number;
  descricao: string;
  anexo_nf_path: string;
  empresa_id: string;
  origem_tipo: "job" | "bv" | "avulso";
  contraparte_nome: string;
  cliente_id: string | null;
  qtd_parcelas: number;
  primeiro_vencimento: string | null;
  /** As parcelas de recebimento que a nota realmente gerou, em ordem.
   *  O formulário em modo leitura mostra ESTAS — antes ele montava uma
   *  parcela sintética com o total da NF, e uma nota 2× aparecia como
   *  1× (corrigido em 18/08/2026). */
  parcelas: Array<{ numero: number; valor: number; data_vencimento: string }>;
  itens: Array<{
    origem_tipo: "job" | "bv" | "avulso";
    codigo: string;
    descricao: string;
    valor: number;
  }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function chaveLinha(r: FaturamentoPendenteRow): string {
  return r.envio_parcela_id ?? `${r.origem_tipo}:${r.origem_id}`;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

interface Props {
  pendentes: FaturamentoPendenteRow[];
  faturados: FaturadoRow[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  empresas: Array<{ id: string; nome: string }>;
  clientes: Array<{ id: string; nome: string }>;
  fornecedores: Array<{ id: string; nome: string }>;
  jobs: Array<{ id: string; codigo: string; nome: string }>;
  proximoNf: string;
}

export function FaturamentoList({
  pendentes,
  faturados,
  tipos,
  subtipos,
  empresas,
  clientes,
  fornecedores,
  jobs,
  proximoNf,
}: Props) {
  const [drawer, setDrawer] = React.useState<DrawerState | null>(null);
  const [modoSelecao, setModoSelecao] = React.useState(false);
  const [sel, setSel] = React.useState<Record<string, boolean>>({});
  const [erroTitulo, setErroTitulo] = React.useState<string | null>(null);
  const [erroDetalhe, setErroDetalhe] = React.useState<string | null>(null);
  const [filtroContraparte, setFiltroContraparte] = React.useState("todos");
  const [busca, setBusca] = React.useState("");
  const [toast, setToast] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  function limparErro() {
    setErroTitulo(null);
    setErroDetalhe(null);
  }

  // Chips por contraparte. BV aparece sob o FORNECEDOR, rotulado, porque é
  // dele que a nota cobra.
  const chips = React.useMemo(() => {
    const contagem = new Map<string, number>();
    for (const p of pendentes) {
      const nome =
        p.origem_tipo === "bv" ? `${p.contraparte_nome} (fornecedor)` : p.contraparte_nome;
      contagem.set(nome, (contagem.get(nome) ?? 0) + 1);
    }
    return [
      { chave: "todos", rotulo: "Todos os clientes", n: pendentes.length },
      ...Array.from(contagem, ([rotulo, n]) => ({ chave: rotulo, rotulo, n })),
    ];
  }, [pendentes]);

  function rotuloContraparte(p: FaturamentoPendenteRow): string {
    return p.origem_tipo === "bv"
      ? `${p.contraparte_nome} (fornecedor)`
      : p.contraparte_nome;
  }

  const q = busca.trim().toLowerCase();

  const visiveis = React.useMemo(
    () =>
      pendentes.filter((p) => {
        if (filtroContraparte !== "todos" && rotuloContraparte(p) !== filtroContraparte) {
          return false;
        }
        if (!q) return true;
        return `${p.codigo ?? ""} ${p.descricao} ${p.contraparte_nome}`
          .toLowerCase()
          .includes(q);
      }),
    [pendentes, filtroContraparte, q],
  );

  const faturadosVisiveis = React.useMemo(
    () =>
      faturados.filter((f) => {
        if (filtroContraparte !== "todos" && f.contraparte_nome !== filtroContraparte) {
          return false;
        }
        if (!q) return true;
        return `${f.numero_nf} ${f.contraparte_nome} ${f.descricao} ${f.itens
          .map((i) => i.codigo)
          .join(" ")}`
          .toLowerCase()
          .includes(q);
      }),
    [faturados, filtroContraparte, q],
  );

  const selecionados = React.useMemo(
    () => pendentes.filter((p) => sel[chaveLinha(p)]),
    [pendentes, sel],
  );
  const clientesSelecionados = React.useMemo(
    () => Array.from(new Set(selecionados.map((p) => p.contraparte_nome))),
    [selecionados],
  );
  const misto = clientesSelecionados.length > 1;
  const totalSelecionado = selecionados.reduce((s, p) => s + p.saldo, 0);

  // BV não é agrupável — o checkbox nem aparece habilitado.
  const agrupaveis = visiveis.filter((p) => p.origem_tipo === "job");
  const todosMarcados =
    agrupaveis.length > 0 && agrupaveis.every((p) => sel[chaveLinha(p)]);

  const totalAFaturar = pendentes.reduce((s, p) => s + p.saldo, 0);

  function alternarLinha(p: FaturamentoPendenteRow) {
    limparErro();
    setSel((atual) => {
      const k = chaveLinha(p);
      const proximo = { ...atual };
      if (proximo[k]) delete proximo[k];
      else proximo[k] = true;
      return proximo;
    });
  }

  function alternarTodos() {
    limparErro();
    if (todosMarcados) {
      setSel({});
      return;
    }
    const proximo: Record<string, boolean> = {};
    for (const p of agrupaveis) proximo[chaveLinha(p)] = true;
    setSel(proximo);
  }

  function faturarSelecionados() {
    limparErro();
    if (selecionados.length === 0) {
      setErroTitulo("Nenhum job selecionado");
      setErroDetalhe("Marque os jobs que devem entrar na mesma nota fiscal.");
      return;
    }
    const bvs = selecionados.filter((p) => p.origem_tipo === "bv");
    if (bvs.length > 0) {
      setErroTitulo("BV não entra em NF agrupada");
      setErroDetalhe(
        `${bvs.map((p) => p.codigo ?? p.descricao).join(", ")} tem o fornecedor como ` +
          "contraparte e precisa ser faturado individualmente.",
      );
      return;
    }
    if (misto) {
      setErroTitulo("Não é possível agrupar jobs de clientes diferentes");
      setErroDetalhe(
        `A seleção tem ${clientesSelecionados.length} clientes ` +
          `(${clientesSelecionados.join(", ")}). Uma nota fiscal cobre apenas jobs ` +
          "de um mesmo cliente — desmarque os jobs dos outros clientes para continuar.",
      );
      return;
    }
    setDrawer({ modo: "origem", linhas: selecionados });
  }

  return (
    <div className="space-y-4">
      {/* Chips de cliente + busca + ações */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <Chip
              key={c.chave}
              ativo={filtroContraparte === c.chave}
              onClick={() => setFiltroContraparte(c.chave)}
              label={c.rotulo}
              count={c.n}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por job, cliente ou descrição"
              className="w-[270px] rounded-lg border border-border bg-white py-1.5 pl-8 pr-3 text-xs focus:border-california-red/40 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setModoSelecao((v) => !v);
              setSel({});
              limparErro();
            }}
            className={cn(
              "inline-flex items-center gap-2 whitespace-nowrap rounded-lg border px-3.5 py-2 text-xs font-semibold transition-colors",
              modoSelecao
                ? "border-california-red bg-california-red/10 text-california-red"
                : "border-border bg-white text-foreground hover:border-border/80",
            )}
          >
            <Layers className="h-3.5 w-3.5" />
            {modoSelecao ? "Sair do agrupamento" : "Faturamento Agrupado"}
          </button>
          <button
            type="button"
            onClick={() => setDrawer({ modo: "avulso" })}
            className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg bg-california-red px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-california-red-hover"
          >
            <Plus className="h-3.5 w-3.5" />
            Faturamento avulso
          </button>
        </div>
      </div>

      {/* Faixa de resumo */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <Hourglass className="h-3.5 w-3.5 text-california-red" />
        <span className="whitespace-nowrap text-xs text-muted-foreground">A faturar</span>
        <span className="font-mono text-sm font-bold tabular-nums">
          {formatMoney(totalAFaturar)}
        </span>
      </div>

      {/* Tabela */}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full min-w-[1120px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              {modoSelecao && (
                <th className="w-[38px] py-3 pl-4">
                  <button
                    type="button"
                    onClick={alternarTodos}
                    title="Selecionar todos os visíveis"
                    className={cn(
                      "flex h-[19px] w-[19px] items-center justify-center rounded-md border transition-colors",
                      todosMarcados
                        ? "border-california-red bg-california-red text-white"
                        : "border-border bg-white text-transparent",
                    )}
                  >
                    <Check className="h-3 w-3" />
                  </button>
                </th>
              )}
              <th className="w-[70px] px-4 py-3 font-semibold">Origem</th>
              <th className="min-w-[300px] px-4 py-3 font-semibold">Job / descrição</th>
              <th className="min-w-[150px] px-4 py-3 font-semibold">Cliente</th>
              <th className="px-4 py-3 text-right font-semibold">Valor</th>
              <th className="px-4 py-3 text-right font-semibold">Já faturado</th>
              <th className="px-4 py-3 text-right font-semibold">Saldo a faturar</th>
              <th className="w-[72px] px-3 py-3 font-semibold">Parcela</th>
              <th className="w-[110px] px-4 py-3 font-semibold">Vencimento</th>
              <th className="w-[110px] px-4 py-3 text-right font-semibold">Ação</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.length === 0 && faturadosVisiveis.length === 0 && (
              <tr>
                <td
                  colSpan={modoSelecao ? 10 : 9}
                  className="px-4 py-12 text-center text-sm text-muted-foreground"
                >
                  Nada aguardando faturamento com esses filtros.
                </td>
              </tr>
            )}

            {visiveis.map((p) => {
              const k = chaveLinha(p);
              const marcado = !!sel[k];
              const agrupavel = p.origem_tipo === "job";
              return (
                <tr
                  key={k}
                  className={cn(
                    "border-b border-border transition-colors last:border-0 hover:bg-accent/40",
                    marcado && "bg-california-red/[0.05]",
                    modoSelecao && !agrupavel && "opacity-55",
                  )}
                >
                  {modoSelecao && (
                    <td className="py-3 pl-4">
                      <button
                        type="button"
                        disabled={!agrupavel}
                        onClick={() => alternarLinha(p)}
                        title={
                          agrupavel ? "Incluir nesta NF" : "BV é faturado individualmente"
                        }
                        className={cn(
                          "flex h-[19px] w-[19px] items-center justify-center rounded-md border transition-colors",
                          marcado
                            ? "border-california-red bg-california-red text-white"
                            : agrupavel
                              ? "border-border bg-white text-transparent"
                              : "cursor-not-allowed border-border bg-muted text-transparent",
                        )}
                      >
                        <Check className="h-3 w-3" />
                      </button>
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <ChipOrigem tipo={p.origem_tipo} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-semibold">{p.descricao}</span>
                      {p.codigo && (
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {p.codigo}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <div className="flex flex-col gap-1">
                      <span className="text-muted-foreground">
                        {p.contraparte_nome}
                      </span>
                      {/* Quem cobrar, ao lado de quem é cobrado — é aqui
                          que a nota nasce (docs/decisions/012). */}
                      <ContatosCobrancaInline contatos={p.contatos} />
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {formatMoney(p.valor_previsto)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-muted-foreground/80">
                    {formatMoney(p.valor_ja_faturado)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="font-bold tabular-nums">
                        {formatMoney(p.saldo_job)}
                      </span>
                      <span className="text-[10.5px] text-muted-foreground">
                        total do job
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-muted-foreground">
                    {p.parcela_numero}/{p.parcela_total}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">
                    {formatDate(p.data_prevista)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        limparErro();
                        setDrawer({ modo: "origem", linhas: [p] });
                      }}
                      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-white px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors hover:border-california-red hover:text-california-red"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Faturar
                    </button>
                  </td>
                </tr>
              );
            })}

            {faturadosVisiveis.map((f) => (
              <tr
                key={f.faturamento_id}
                className="border-b border-border bg-emerald-50/35 transition-colors last:border-0"
              >
                {modoSelecao && (
                  <td className="py-3 pl-4">
                    <span
                      title="Faturamento já emitido"
                      className="flex h-[19px] w-[19px] cursor-not-allowed items-center justify-center rounded-md border border-border bg-muted"
                    />
                  </td>
                )}
                <td className="px-4 py-3">
                  <span className="inline-flex items-center whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                    Faturado
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-semibold">
                      {f.itens.map((i) => i.descricao.split(" — ")[0]).join(" + ")}
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {f.itens.map((i) => i.codigo).join(", ")}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {f.contraparte_nome}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {formatMoney(f.valor_total)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-muted-foreground/80">
                  {formatMoney(f.valor_total)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-muted-foreground">
                  —
                </td>
                <td className="px-3 py-3 font-mono text-xs text-muted-foreground">
                  {f.qtd_parcelas > 1 ? `${f.qtd_parcelas}x` : "1/1"}
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">
                  {formatDate(f.primeiro_vencimento)}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    title="Ver formulário e NF anexada"
                    onClick={() => setDrawer({ modo: "leitura", nota: f })}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 font-mono text-[11.5px] font-bold text-emerald-700 transition-colors hover:bg-emerald-100"
                  >
                    <FileCheck2 className="h-3.5 w-3.5" />
                    NF {f.numero_nf}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="flex items-start gap-2 text-xs text-muted-foreground text-pretty">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Uma NF agrupada só pode conter jobs de um{" "}
          <strong className="font-semibold text-foreground">mesmo cliente</strong>. BVs
          são faturados individualmente porque a contraparte é o fornecedor.
        </span>
      </p>

      {/* Barra do Faturamento Agrupado — fixa no rodapé, no mesmo padrão da
          barra de ações do job (`jobs/[jobId]/barra-acoes-job.tsx`). Vivia
          acima da tabela, onde saía de vista assim que a lista rolava: o
          usuário marcava as linhas de baixo sem enxergar o total nem o
          botão. Aqui ela acompanha a rolagem.

          Precisa ser o último elemento COM ALTURA da lista para o
          `sticky bottom-0` grudar — o drawer e o toast que vêm depois são
          posicionados por cima e não ocupam espaço no fluxo.

          O fundo branco opaco é obrigatório: o tom vermelho de 4% que a
          barra tinha é transparente demais e a tabela apareceria por baixo
          dela ao rolar. A tinta vermelha vem numa camada interna. */}
      {modoSelecao && (
        <div className="sticky bottom-0 z-20 -mx-1 overflow-hidden rounded-t-2xl border border-b-0 border-california-red/35 bg-white/95 shadow-[0_-4px_16px_-8px_rgba(0,0,0,0.12)] backdrop-blur">
          {/* O erro fica ACIMA da linha de ações: numa barra de rodapé quem
              encosta na borda de baixo tem de ser o botão. */}
          {erroTitulo && (
            <div className="flex items-start gap-2.5 border-b border-california-red/30 bg-california-red/[0.09] px-5 py-3 text-xs text-california-red">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div className="flex flex-col gap-0.5">
                <span className="font-bold">{erroTitulo}</span>
                <span className="text-california-red/85">{erroDetalhe}</span>
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3.5 bg-california-red/[0.04] px-5 py-2.5">
            <span className="flex items-center gap-2 whitespace-nowrap text-xs font-semibold">
              <Layers className="h-3.5 w-3.5 text-california-red" />
              Faturamento Agrupado
            </span>
            <div className="h-4 w-px bg-california-red/25" />
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              {selecionados.length} selecionado(s)
            </span>
            <span className="whitespace-nowrap font-mono text-sm font-bold tabular-nums">
              {formatMoney(totalSelecionado)}
            </span>
            {clientesSelecionados.length > 0 && (
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                  misto
                    ? "border-red-200 bg-red-50 text-california-red"
                    : "border-border bg-white text-muted-foreground",
                )}
              >
                <Building2 className="h-3 w-3" />
                {misto
                  ? `${clientesSelecionados.length} clientes diferentes`
                  : clientesSelecionados[0]}
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setSel({});
                  limparErro();
                }}
                className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
              >
                Limpar
              </button>
              <button
                type="button"
                onClick={faturarSelecionados}
                className={cn(
                  "inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-xs font-semibold text-white transition-colors",
                  selecionados.length === 0
                    ? "bg-california-red/45"
                    : "bg-california-red hover:bg-california-red-hover",
                )}
              >
                <FileText className="h-3.5 w-3.5" />
                Faturar selecionados
              </button>
            </div>
          </div>
        </div>
      )}

      {drawer && (
        <FaturarDrawer
          state={drawer}
          onClose={() => setDrawer(null)}
          onEmitida={(msg) => {
            setDrawer(null);
            setSel({});
            setModoSelecao(false);
            setToast(msg);
          }}
          tipos={tipos}
          subtipos={subtipos}
          empresas={empresas}
          clientes={clientes}
          fornecedores={fornecedores}
          jobs={jobs}
          proximoNf={proximoNf}
        />
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-elevated"
        >
          <FileCheck2 className="h-4 w-4 shrink-0 text-emerald-700" />
          <span className="text-sm font-semibold text-emerald-900">{toast}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-emerald-700 hover:text-emerald-900"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Peças pequenas
// ---------------------------------------------------------------------------

function ChipOrigem({ tipo }: { tipo: "job" | "bv" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        tipo === "bv"
          ? "border-violet-200 bg-violet-50 text-violet-700"
          : "border-border bg-muted text-muted-foreground",
      )}
    >
      {tipo === "bv" ? "BV" : "Job"}
    </span>
  );
}

function Chip({
  ativo,
  onClick,
  label,
  count,
}: {
  ativo: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        ativo
          ? "border-california-red bg-california-red/10 text-california-red"
          : "border-border bg-white text-muted-foreground hover:bg-muted/50",
      )}
    >
      {label}
      <span
        className={cn(
          "font-semibold tabular-nums",
          ativo ? "text-california-red" : "text-muted-foreground/70",
        )}
      >
        {count}
      </span>
    </button>
  );
}
