"use client";

/**
 * Aba "Cartão" — agrupa por cartão de crédito os títulos com
 * `forma_pagamento === 'cartao_credito'`. Filtro de status interno (padrão
 * "A pagar", com opções "Pagos" e "Todos").
 *
 * Responsabilidades:
 * - Filtro de status (a_pagar | pago | todos).
 * - Filtrar por cartão (dropdown) e por período (`data_pagamento`).
 * - Agrupar em seções por `cartao_credito_id`.
 * - Seleção múltipla APENAS de títulos "a pagar", limitada a UM cartão por
 *   vez — trocar de cartão limpa a seleção e exibe aviso.
 * - Barra sticky no rodapé quando há seleção → abre `BaixaLoteCartaoDialog`.
 * - Linhas pagas: sem checkbox, chip "Pago" e clique abre a conferência da
 *   baixa (`BaixaRegistradaDialog`), com estorno se preciso.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, CreditCard, Eye, Info, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import type {
  ContaBancaria,
  PlanoContaTipo,
  PlanoContaSubtipo,
  OrigemTitulo,
} from "@/lib/types";
import type { CartaoOption } from "@/components/financeiro/forma-pagamento-field";
import type { TituloRow } from "./titulos-pagar-list";
import {
  BaixaLoteCartaoDialog,
  type TituloSelecionado,
} from "./baixa-lote-cartao-dialog";
import {
  BaixaRegistradaDialog,
  type BaixaRegistradaAlvo,
} from "@/components/financeiro/baixa-registrada-dialog";
import { estornarBaixaTitulo } from "./actions-titulos";
import { ContaAvulsaDrawer } from "./conta-avulsa-drawer";

type StatusFiltro = "a_pagar" | "pago" | "todos";

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

function hojeISO(): string {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** Retorna o primeiro e último dia do mês corrente em ISO. */
function limitesMesAtual(): { de: string; ate: string } {
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = agora.getMonth(); // 0-indexed
  const primeiro = new Date(ano, mes, 1);
  const ultimo = new Date(ano, mes + 1, 0);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { de: fmt(primeiro), ate: fmt(ultimo) };
}

/** Retorna o primeiro e último dia do próximo mês em ISO. */
function limitesMesProximo(): { de: string; ate: string } {
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = agora.getMonth(); // 0-indexed
  const primeiro = new Date(ano, mes + 1, 1);
  const ultimo = new Date(ano, mes + 2, 0);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { de: fmt(primeiro), ate: fmt(ultimo) };
}

/** Formata nome legível do cartão: nome + bandeira + últimos 4. */
function nomeCartao(c: CartaoOption): string {
  return `${c.nome} · •••• ${c.ultimos_4_digitos}`;
}

/** Chip de origem — mesmo padrão do titulos-pagar-list. */
function origemChipClass(origem: OrigemTitulo): string {
  switch (origem) {
    case "pp":
      return "border-border bg-muted text-muted-foreground";
    case "avulso":
      return "border-violet-200 bg-violet-50 text-violet-700";
    case "recorrencia":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "desembolso":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "fatura_cartao":
      // Grafite: a fatura não é uma despesa nova, é o agregado do que já
      // foi classificado item a item no fechamento.
      return "border-slate-300 bg-slate-100 text-slate-700";
    case "pp_devolucao_verba":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
}

function origemLabel(r: TituloRow): string {
  return r.origem_label;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  /** Títulos já filtrados a_pagar + cartao_credito — vêm prontos do server. */
  rows: TituloRow[];
  /** Cartões ativos — para filtro e para nome/bandeira do grupo. */
  cartoes: CartaoOption[];
  contas: ContaBancaria[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  /** Daqui para baixo, só o que o drawer de conta avulsa precisa para o
   *  atalho "Lançar pagamento" (28/08/2026). */
  tenantId: string;
  empresas: Array<{ id: string; nome: string }>;
  fornecedores: Array<{ id: string; nome: string }>;
  clientes: Array<{ id: string; nome: string }>;
  jobs: Array<{
    id: string;
    codigo: string;
    nome: string;
    cliente_id: string | null;
    regional_id: string | null;
  }>;
  regionais: Array<{ id: string; nome: string; ativo: boolean }>;
}

// ---------------------------------------------------------------------------
// Sub-componente: cabeçalho da seção do cartão
// ---------------------------------------------------------------------------

interface GrupoHeaderProps {
  cartao: CartaoOption;
  titulos: TituloRow[];
  selecionados: Set<string>;
  onToggleTodos: (cartaoId: string, titulosDoGrupo: TituloRow[]) => void;
  cartaoSelecionadoAtual: string | null;
}

function GrupoCartaoHeader({
  cartao,
  titulos,
  selecionados,
  onToggleTodos,
  cartaoSelecionadoAtual,
}: GrupoHeaderProps) {
  const totalGrupo = titulos.reduce((s, t) => s + t.valor, 0);
  const totalTitulos = titulos.length;
  // "Selecionar todos" considera só os a pagar — pagos não entram no bulk.
  const aPagar = titulos.filter((t) => t.status === "a_pagar");
  const temAlgumSelecionavel = aPagar.length > 0;
  const todosSelecionados =
    temAlgumSelecionavel && aPagar.every((t) => selecionados.has(t.id));
  const algunsSelecionados =
    !todosSelecionados && aPagar.some((t) => selecionados.has(t.id));

  const outroCartaoSelecionado =
    cartaoSelecionadoAtual !== null && cartaoSelecionadoAtual !== cartao.id;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3">
      {/* Checkbox "selecionar todos a pagar deste cartão" */}
      <input
        type="checkbox"
        checked={todosSelecionados}
        ref={(el) => {
          if (el) el.indeterminate = algunsSelecionados;
        }}
        onChange={() => onToggleTodos(cartao.id, titulos)}
        disabled={outroCartaoSelecionado || !temAlgumSelecionavel}
        className="h-4 w-4 cursor-pointer accent-california-red disabled:cursor-not-allowed disabled:opacity-40"
        title={
          !temAlgumSelecionavel
            ? "Nenhum título a pagar neste grupo"
            : outroCartaoSelecionado
              ? "Limpe a seleção do outro cartão antes de selecionar aqui"
              : "Selecionar todos a pagar deste cartão"
        }
      />

      <CreditCard className="h-4 w-4 shrink-0 text-muted-foreground" />

      <div className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold">{cartao.nome}</span>
        <span className="text-xs text-muted-foreground">
          •••• {cartao.ultimos_4_digitos} · {cartao.bandeira.toUpperCase()}
        </span>
      </div>

      <div className="flex items-center gap-4 text-right">
        <span className="text-xs text-muted-foreground">
          {totalTitulos} título{totalTitulos !== 1 ? "s" : ""}
        </span>
        <span className="font-mono font-bold tabular-nums">
          {formatMoney(totalGrupo)}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export function TitulosCartaoList({
  rows: rowsBruto,
  cartoes,
  contas,
  tipos,
  subtipos,
  tenantId,
  empresas,
  fornecedores,
  clientes,
  jobs,
  regionais,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  // Filtro de status — padrão "a pagar".
  const [statusFiltro, setStatusFiltro] = React.useState<StatusFiltro>("a_pagar");
  const rows = React.useMemo(
    () =>
      rowsBruto.filter((r) =>
        statusFiltro === "todos" ? true : r.status === statusFiltro,
      ),
    [rowsBruto, statusFiltro],
  );

  // Filtros
  const [filtroCartaoId, setFiltroCartaoId] = React.useState<string>("__todos__");
  const [dataDe, setDataDe] = React.useState<string>("");
  const [dataAte, setDataAte] = React.useState<string>("");

  // Título pago aberto para conferência de baixa (e estorno).
  const [conferindo, setConferindo] = React.useState<TituloRow | null>(null);
  const [erroAcao, setErroAcao] = React.useState<string | null>(null);

  // Seleção — Map<cartaoId, Set<tituloId>>
  // Invariante: no máximo 1 cartão com Set não-vazio.
  const [selecao, setSelecao] = React.useState<Map<string, Set<string>>>(new Map());
  const [avisoTroca, setAvisoTroca] = React.useState<string | null>(null);
  const [toastSucesso, setToastSucesso] = React.useState<string | null>(null);

  // Modal de baixa em lote
  const [modalAberto, setModalAberto] = React.useState(false);

  // Auto-esconder aviso após 4s
  React.useEffect(() => {
    if (!avisoTroca) return;
    const t = setTimeout(() => setAvisoTroca(null), 4000);
    return () => clearTimeout(t);
  }, [avisoTroca]);

  // Auto-esconder toast de sucesso após 4s
  React.useEffect(() => {
    if (!toastSucesso) return;
    const t = setTimeout(() => setToastSucesso(null), 4000);
    return () => clearTimeout(t);
  }, [toastSucesso]);

  // Limpa seleção quando o filtro de status muda — evita seleção órfã de
  // linhas que somem do recorte visível.
  React.useEffect(() => {
    setSelecao(new Map());
  }, [statusFiltro]);

  // ---------------------------------------------------------------------------
  // Filtros em memória
  // ---------------------------------------------------------------------------

  const rowsFiltradas = React.useMemo(() => {
    return rows.filter((r) => {
      // Filtro de cartão
      if (filtroCartaoId !== "__todos__" && r.cartao_credito_id !== filtroCartaoId) {
        return false;
      }
      // Filtro de data (data_pagamento)
      const dp = r.data_pagamento ?? "";
      if (dataDe && dp && dp < dataDe) return false;
      if (dataAte && dp && dp > dataAte) return false;
      return true;
    });
  }, [rows, filtroCartaoId, dataDe, dataAte]);

  // ---------------------------------------------------------------------------
  // Agrupamento por cartão
  // ---------------------------------------------------------------------------

  const grupos = React.useMemo(() => {
    const mapa = new Map<string, TituloRow[]>();
    for (const r of rowsFiltradas) {
      const cid = r.cartao_credito_id ?? "__sem_cartao__";
      const lista = mapa.get(cid) ?? [];
      lista.push(r);
      mapa.set(cid, lista);
    }
    // Ordena grupos: mais títulos primeiro.
    return Array.from(mapa.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [rowsFiltradas]);

  // Total global (após filtro)
  const totalGlobal = React.useMemo(
    () => rowsFiltradas.reduce((s, r) => s + r.valor, 0),
    [rowsFiltradas],
  );

  // ---------------------------------------------------------------------------
  // Estado da seleção — cartão ativo e ids selecionados
  // ---------------------------------------------------------------------------

  /** O único cartão que tem seleção ativa (ou null se vazio). */
  const cartaoSelecionadoId = React.useMemo<string | null>(() => {
    for (const [cid, ids] of selecao.entries()) {
      if (ids.size > 0) return cid;
    }
    return null;
  }, [selecao]);

  const idsSelecionados: Set<string> = React.useMemo(
    () => (cartaoSelecionadoId ? (selecao.get(cartaoSelecionadoId) ?? new Set()) : new Set()),
    [selecao, cartaoSelecionadoId],
  );

  const titulosSelecionadosRows = React.useMemo<TituloRow[]>(() => {
    if (!cartaoSelecionadoId) return [];
    const grupo = grupos.find(([cid]) => cid === cartaoSelecionadoId)?.[1] ?? [];
    return grupo.filter((r) => idsSelecionados.has(r.id));
  }, [cartaoSelecionadoId, grupos, idsSelecionados]);

  const titulosSelecionados: TituloSelecionado[] = React.useMemo(
    () =>
      titulosSelecionadosRows.map((r) => ({
        origem: r.origem,
        id: r.id,
        descricao: r.descricao,
        valor: r.valor,
      })),
    [titulosSelecionadosRows],
  );

  const totalSelecionado = titulosSelecionados.reduce((s, t) => s + t.valor, 0);

  // ---------------------------------------------------------------------------
  // Handlers de seleção
  // ---------------------------------------------------------------------------

  /**
   * Toggle de um título individual.
   * Se o título pertence a um cartão DIFERENTE do atual, limpa a seleção
   * anterior e avisa o usuário.
   */
  function handleToggleTitulo(cartaoId: string, tituloId: string) {
    setSelecao((prev) => {
      const next = new Map(prev);

      // Há outro cartão selecionado?
      let cartaoAtual: string | null = null;
      for (const [cid, ids] of next.entries()) {
        if (ids.size > 0) { cartaoAtual = cid; break; }
      }

      if (cartaoAtual !== null && cartaoAtual !== cartaoId) {
        // Limpar seleção anterior
        next.set(cartaoAtual, new Set());
        setAvisoTroca("Seleção do cartão anterior descartada. Agora selecionando neste cartão.");
      }

      const ids = new Set(next.get(cartaoId) ?? []);
      if (ids.has(tituloId)) {
        ids.delete(tituloId);
      } else {
        ids.add(tituloId);
      }
      next.set(cartaoId, ids);
      return next;
    });
  }

  /**
   * Toggle "selecionar todos" de um grupo — considera SÓ os títulos "a pagar"
   * do grupo. Pagos ficam de fora (não têm o que baixar de novo).
   * Mesma regra de cartão único: se havia outro cartão selecionado, descarta.
   */
  function handleToggleTodos(cartaoId: string, titulosDoGrupo: TituloRow[]) {
    setSelecao((prev) => {
      const next = new Map(prev);

      let cartaoAtual: string | null = null;
      for (const [cid, ids] of next.entries()) {
        if (ids.size > 0) { cartaoAtual = cid; break; }
      }

      if (cartaoAtual !== null && cartaoAtual !== cartaoId) {
        next.set(cartaoAtual, new Set());
        setAvisoTroca("Seleção do cartão anterior descartada.");
      }

      const aPagarDoGrupo = titulosDoGrupo.filter((t) => t.status === "a_pagar");
      if (aPagarDoGrupo.length === 0) return next;
      const idsAtual = next.get(cartaoId) ?? new Set<string>();
      const todosSelecionados = aPagarDoGrupo.every((t) => idsAtual.has(t.id));

      if (todosSelecionados) {
        next.set(cartaoId, new Set());
      } else {
        next.set(cartaoId, new Set(aPagarDoGrupo.map((t) => t.id)));
      }
      return next;
    });
  }

  function limparSelecao() {
    setSelecao(new Map());
  }

  // ---------------------------------------------------------------------------
  // Atalhos de data
  // ---------------------------------------------------------------------------

  function aplicarEsteMes() {
    const { de, ate } = limitesMesAtual();
    setDataDe(de);
    setDataAte(ate);
  }

  function aplicarProximoMes() {
    const { de, ate } = limitesMesProximo();
    setDataDe(de);
    setDataAte(ate);
  }

  // ---------------------------------------------------------------------------
  // Cartão selecionado — nome para a barra sticky
  // ---------------------------------------------------------------------------

  const cartaoSelecionado: CartaoOption | null = React.useMemo(() => {
    if (!cartaoSelecionadoId) return null;
    return cartoes.find((c) => c.id === cartaoSelecionadoId) ?? null;
  }, [cartaoSelecionadoId, cartoes]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-4">
      {/* Filtro de status — chip principal. Padrão "A pagar". */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Status
        </span>
        <StatusChip
          ativo={statusFiltro === "a_pagar"}
          onClick={() => setStatusFiltro("a_pagar")}
          label="A pagar"
        />
        <StatusChip
          ativo={statusFiltro === "pago"}
          onClick={() => setStatusFiltro("pago")}
          label="Pagos"
        />
        <StatusChip
          ativo={statusFiltro === "todos"}
          onClick={() => setStatusFiltro("todos")}
          label="Todos"
        />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Barra de filtros                                                     */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Dropdown de cartão */}
        <div className="min-w-[220px]">
          <Select
            value={filtroCartaoId}
            onValueChange={(v) => setFiltroCartaoId(v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Filtrar por cartão..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__todos__">Todos os cartões</SelectItem>
              {cartoes.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {nomeCartao(c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Lançar pagamento — a despesa que NASCE no cartão.
            Uma assinatura, uma compra sem pedido anterior: no sistema ela
            é uma conta avulsa como qualquer outra, e ganha código `AV-`.
            O atalho existe só para quem está olhando a fatura não ter que
            reencontrar o cartão na mão (28/08/2026).

            Com "Todos os cartões" o drawer abre sem pré-seleção — não dá
            para adivinhar em qual cartão a compra caiu. */}
        <ContaAvulsaDrawer
          mode="criar"
          tenantId={tenantId}
          empresas={empresas}
          tipos={tipos}
          subtipos={subtipos}
          fornecedores={fornecedores}
          clientes={clientes}
          jobs={jobs}
          regionais={regionais}
          cartoes={cartoes}
          cartaoPreSelecionadoId={
            filtroCartaoId === "__todos__" ? undefined : filtroCartaoId
          }
          trigger={
            <button
              type="button"
              className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-california-red-hover"
            >
              <Plus className="h-4 w-4" />
              Lançar pagamento
            </button>
          }
        />

        {/* Filtro de data De */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">De</span>
          <input
            type="date"
            value={dataDe}
            onChange={(e) => setDataDe(e.target.value)}
            className="rounded-lg border border-border bg-white px-3 py-2 text-sm focus:border-california-red focus:outline-none"
          />
        </div>

        {/* Filtro de data Até */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Até</span>
          <input
            type="date"
            value={dataAte}
            onChange={(e) => setDataAte(e.target.value)}
            className="rounded-lg border border-border bg-white px-3 py-2 text-sm focus:border-california-red focus:outline-none"
          />
        </div>

        {/* Atalhos de período */}
        <button
          type="button"
          onClick={aplicarEsteMes}
          className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-california-red/50 hover:text-california-red"
        >
          Este mês
        </button>
        <button
          type="button"
          onClick={aplicarProximoMes}
          className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-california-red/50 hover:text-california-red"
        >
          Próximo mês
        </button>

        {/* Limpar filtros de data (quando preenchidos) */}
        {(dataDe || dataAte) && (
          <button
            type="button"
            onClick={() => { setDataDe(""); setDataAte(""); }}
            className="text-xs text-california-red underline-offset-2 hover:underline"
          >
            Limpar datas
          </button>
        )}

        {/* Totalizador global */}
        <div className="ml-auto flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2">
          <span className="text-xs text-muted-foreground">
            {statusFiltro === "a_pagar"
              ? "Total a pagar:"
              : statusFiltro === "pago"
                ? "Total pago:"
                : "Total (filtro):"}
          </span>
          <span className="font-mono text-sm font-bold tabular-nums">
            {formatMoney(totalGlobal)}
          </span>
          <span className="text-xs text-muted-foreground">
            ({rowsFiltradas.length} título{rowsFiltradas.length !== 1 ? "s" : ""})
          </span>
        </div>
      </div>

      {/* Aviso de troca de cartão */}
      {avisoTroca && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <Info className="h-4 w-4 shrink-0" />
          {avisoTroca}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Estado vazio                                                          */}
      {/* ------------------------------------------------------------------ */}
      {rowsFiltradas.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card py-16 text-center text-sm text-muted-foreground shadow-soft">
          {rowsBruto.length === 0
            ? "Nenhum título de cartão. Crie um lançamento avulso com forma de pagamento Cartão de Crédito."
            : statusFiltro === "a_pagar"
              ? "Nenhum título de cartão a pagar no período."
              : statusFiltro === "pago"
                ? "Nenhum título de cartão pago no período."
                : "Nenhum título de cartão no período."}
        </div>
      ) : (
        /* ------------------------------------------------------------------ */
        /* Grupos por cartão                                                    */
        /* ------------------------------------------------------------------ */
        <div className="space-y-6">
          {grupos.map(([cartaoId, titulosGrupo]) => {
            const cartao = cartoes.find((c) => c.id === cartaoId);
            // Se não encontrou o cartão nos ativos, usa fallback.
            const cartaoInfo: CartaoOption = cartao ?? {
              id: cartaoId,
              nome: "Cartão não identificado",
              banco: "—",
              bandeira: "outra",
              ultimos_4_digitos: "????",
              dia_vencimento_fatura: 0,
            };

            const idsDoGrupo = selecao.get(cartaoId) ?? new Set<string>();

            return (
              <div key={cartaoId} className="space-y-2">
                {/* Cabeçalho do grupo */}
                <GrupoCartaoHeader
                  cartao={cartaoInfo}
                  titulos={titulosGrupo}
                  selecionados={idsDoGrupo}
                  onToggleTodos={handleToggleTodos}
                  cartaoSelecionadoAtual={cartaoSelecionadoId}
                />

                {/* Tabela do grupo */}
                <div className="rounded-2xl border border-border bg-card shadow-soft">
                  <table className="w-full table-fixed text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30 text-center text-[11px] uppercase tracking-wider text-muted-foreground">
                        <th className="w-[3%] px-2 py-3" />
                        <th className="w-[9%] px-2 py-3 font-semibold text-left">Origem</th>
                        <th className="w-[22%] px-3 py-3 font-semibold text-left">Descrição</th>
                        <th className="w-[16%] px-3 py-3 font-semibold text-left">Fornecedor</th>
                        <th className="w-[7%] px-2 py-3 font-semibold">Job</th>
                        <th className="w-[10%] px-2 py-3 font-semibold">Vencimento</th>
                        <th className="w-[7%] px-2 py-3 font-semibold">Status</th>
                        <th className="w-[10%] px-3 py-3 font-semibold text-right">Valor</th>
                        <th className="w-[6%] px-2 py-3 font-semibold">Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {titulosGrupo
                        .sort((a, b) => {
                          // A pagar antes dos pagos; dentro de cada grupo,
                          // por data (pagos mais recente primeiro).
                          if (a.status !== b.status) {
                            return a.status === "a_pagar" ? -1 : 1;
                          }
                          if (a.status === "pago") {
                            return (b.pago_em ?? "").localeCompare(a.pago_em ?? "");
                          }
                          return (a.data_pagamento ?? "9999-12-31").localeCompare(
                            b.data_pagamento ?? "9999-12-31",
                          );
                        })
                        .map((r) => {
                          const pago = r.status === "pago";
                          const selecionado = idsDoGrupo.has(r.id);
                          return (
                            <tr
                              key={`${r.origem}-${r.id}`}
                              onClick={() => {
                                if (pago) {
                                  setErroAcao(null);
                                  setConferindo(r);
                                } else {
                                  handleToggleTitulo(cartaoId, r.id);
                                }
                              }}
                              className={cn(
                                "cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-accent/40",
                                selecionado && "bg-emerald-50 hover:bg-emerald-50",
                              )}
                            >
                              {/* Checkbox — pagos não são selecionáveis. */}
                              <td className="px-2 py-3 text-center">
                                {!pago && (
                                  <input
                                    type="checkbox"
                                    checked={selecionado}
                                    onChange={() => handleToggleTitulo(cartaoId, r.id)}
                                    onClick={(e) => e.stopPropagation()}
                                    className="h-4 w-4 cursor-pointer accent-california-red"
                                  />
                                )}
                              </td>
                              {/* Origem */}
                              <td className="px-2 py-3">
                                <span
                                  className={cn(
                                    "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                                    origemChipClass(r.origem),
                                  )}
                                >
                                  {origemLabel(r)}
                                </span>
                              </td>
                              {/* Descrição */}
                              <td className="px-3 py-3">
                                <div className="flex min-w-0 flex-col gap-0.5">
                                  <span className="break-words font-semibold">
                                    {r.descricao}
                                    {r.parcela_total > 1 && (
                                      <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                                        ({r.parcela_numero}/{r.parcela_total})
                                      </span>
                                    )}
                                  </span>
                                  {pago && (
                                    <span className="text-[11px] text-muted-foreground">
                                      Pago em {formatDate(r.pago_em)} · {r.conta_nome ?? "—"}
                                    </span>
                                  )}
                                </div>
                              </td>
                              {/* Fornecedor */}
                              <td className="px-3 py-3 text-xs text-muted-foreground">
                                <span className="block truncate" title={r.fornecedor_nome}>
                                  {r.fornecedor_nome}
                                </span>
                              </td>
                              {/* Job */}
                              <td className="whitespace-nowrap px-2 py-3 text-center font-mono text-xs text-muted-foreground">
                                {r.job_codigo}
                              </td>
                              {/* Vencimento */}
                              <td className="whitespace-nowrap px-2 py-3 text-center font-mono text-xs">
                                {formatDate(r.data_pagamento)}
                              </td>
                              {/* Status */}
                              <td className="px-2 py-3 text-center">
                                <span
                                  className={cn(
                                    "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                                    pago
                                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                      : "border-[#fde68a] bg-[#fffbeb] text-[#92400e]",
                                  )}
                                >
                                  {pago ? "Pago" : "A pagar"}
                                </span>
                              </td>
                              {/* Valor */}
                              <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums">
                                {formatMoney(r.valor)}
                              </td>
                              {/* Ação */}
                              <td className="px-2 py-3 text-center">
                                {pago && (
                                  <button
                                    type="button"
                                    title="Ver a baixa registrada — e estornar, se preciso"
                                    aria-label="Ver baixa registrada"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setErroAcao(null);
                                      setConferindo(r);
                                    }}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-california-red hover:text-california-red"
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Informação de rodapé                                                 */}
      {/* ------------------------------------------------------------------ */}
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5" />
        Selecione os títulos de um cartão e clique em &ldquo;Baixar&rdquo; para registrar o pagamento da fatura.
        Somente títulos do mesmo cartão podem ser baixados juntos.
      </p>

      {/* ------------------------------------------------------------------ */}
      {/* Barra sticky no rodapé — aparece quando há seleção                  */}
      {/* ------------------------------------------------------------------ */}
      {idsSelecionados.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-white px-6 py-3 shadow-elevated">
          <div className="mx-auto flex max-w-7xl items-center gap-4">
            <CreditCard className="h-5 w-5 shrink-0 text-emerald-700" />
            <span className="flex-1 text-sm">
              <strong>{idsSelecionados.size}</strong> título
              {idsSelecionados.size !== 1 ? "s" : ""} selecionado
              {idsSelecionados.size !== 1 ? "s" : ""} de{" "}
              <strong>
                {cartaoSelecionado ? nomeCartao(cartaoSelecionado) : "cartão desconhecido"}
              </strong>{" "}
              — Total{" "}
              <strong className="text-emerald-700">{formatMoney(totalSelecionado)}</strong>
            </span>
            <button
              type="button"
              onClick={limparSelecao}
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
            >
              Limpar seleção
            </button>
            <button
              type="button"
              onClick={() => setModalAberto(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
            >
              <CreditCard className="h-4 w-4" />
              Baixar
            </button>
          </div>
        </div>
      )}

      {/* Espaço extra no rodapé quando a barra sticky está visível */}
      {idsSelecionados.size > 0 && <div className="h-16" />}

      {/* ------------------------------------------------------------------ */}
      {/* Modal de baixa em lote                                               */}
      {/* ------------------------------------------------------------------ */}
      <BaixaLoteCartaoDialog
        open={modalAberto}
        onOpenChange={(o) => {
          if (!o) setModalAberto(false);
        }}
        cartaoNome={
          cartaoSelecionado ? nomeCartao(cartaoSelecionado) : "Cartão desconhecido"
        }
        cartaoId={cartaoSelecionadoId ?? ""}
        titulosSelecionados={titulosSelecionados}
        contas={contas}
        tipos={tipos}
        subtipos={subtipos}
        onSucesso={() => {
          setModalAberto(false);
          limparSelecao();
          const n = titulosSelecionados.length;
          setToastSucesso(
            `Baixa registrada — ${n} título${n !== 1 ? "s" : ""} enviado${n !== 1 ? "s" : ""} para a conciliação.`,
          );
          router.refresh();
        }}
      />

      {/* Dialog de conferência da baixa (para linhas pagas). Espelha o
          padrão do titulos-pagar-list: ver e, se preciso, estornar. */}
      <BaixaRegistradaDialog
        open={conferindo !== null}
        onOpenChange={(o) => {
          if (!o) {
            setConferindo(null);
            setErroAcao(null);
          }
        }}
        alvo={
          conferindo
            ? ({
                titulo: conferindo.descricao,
                origem:
                  conferindo.origem === "pp"
                    ? `Pedido de produção ${conferindo.origem_label}`
                    : conferindo.origem === "recorrencia"
                      ? `Recorrência · ${conferindo.descricao}`
                      : conferindo.origem === "desembolso"
                        ? `Desembolso ${conferindo.origem_label}`
                        : "Lançamento avulso",
                parcela: `${conferindo.parcela_numero}/${conferindo.parcela_total}`,
                valor: conferindo.valor,
                pagoEm: conferindo.pago_em,
                contaNome: conferindo.conta_nome,
                centroNome: conferindo.centro_nome,
                dataPagamento: conferindo.data_pagamento,
                vencOriginal: conferindo.venc_original,
              } as BaixaRegistradaAlvo)
            : null
        }
        pending={pending}
        erro={erroAcao}
        onEstornar={(motivo) => {
          const alvo = conferindo;
          if (!alvo) return;
          startTransition(async () => {
            const res = await estornarBaixaTitulo({
              origem: alvo.origem,
              id: alvo.id,
              motivo,
            });
            if (!res.ok) {
              setErroAcao(res.message);
              return;
            }
            setConferindo(null);
            setErroAcao(null);
            setToastSucesso(
              `Baixa estornada · ${formatMoney(alvo.valor)} devolvido para "A pagar".`,
            );
            router.refresh();
          });
        }}
      />

      {/* Toast de sucesso */}
      {toastSucesso && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-elevated"
        >
          <CheckCheck className="h-4 w-4 shrink-0 text-emerald-700" />
          <span className="text-sm font-semibold text-emerald-900">{toastSucesso}</span>
          <button
            type="button"
            onClick={() => setToastSucesso(null)}
            className="text-emerald-700 hover:text-emerald-900"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function StatusChip({
  ativo,
  onClick,
  label,
}: {
  ativo: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
        ativo
          ? "border-california-red bg-california-red text-white"
          : "border-border bg-white text-muted-foreground hover:border-california-red/50",
      )}
    >
      {label}
    </button>
  );
}
