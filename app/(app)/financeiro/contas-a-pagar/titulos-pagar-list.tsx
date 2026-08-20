"use client";

/**
 * Aba "Títulos a Pagar" (Tela 3.2) — a visão única de tudo que é pagável.
 *
 * O que entra aqui vem de duas tabelas, unificado no server component:
 * parcela de PP aprovada, lançamento avulso e ocorrência de recorrência.
 * O que a aba FAZ é uma coisa só: dar baixa e repactuar data. Aprovar e
 * rejeitar PP continua na aba de Pedidos de Produção — é a regra que o
 * protótipo escreve no rodapé e que o aviso ao pé da tabela repete.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
  CalendarClock,
  CheckCheck,
  CreditCard,
  Eye,
  Info,
  Pencil,
  Plus,
  Search,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DatePicker } from "@/components/ui/date-picker";
import type {
  ContaBancaria,
  OrigemTitulo,
  PlanoContaTipo,
  PlanoContaSubtipo,
  TituloPagarStatus,
} from "@/lib/types";
import { ContaAvulsaDrawer } from "./conta-avulsa-drawer";
import {
  BaixaTituloDialog,
  type BaixaTituloAlvo,
} from "@/components/financeiro/baixa-titulo-dialog";
import {
  BaixaRegistradaDialog,
  type BaixaRegistradaAlvo,
} from "@/components/financeiro/baixa-registrada-dialog";
import {
  EditarDataPagamentoDialog,
  type EditarDataAlvo,
} from "./editar-data-pagamento-dialog";
import {
  darBaixaTitulo,
  estornarBaixaTitulo,
  repactuarDataPagamento,
} from "./actions-titulos";

// ---------------------------------------------------------------------------
// Tipo da linha
// ---------------------------------------------------------------------------

export interface TituloRow {
  /** Id da parcela (origem `pp`) ou da conta avulsa (demais origens). */
  id: string;
  origem: OrigemTitulo;
  /** `PP-00005`, `AVULSO` ou `RECORRÊNCIA` — o chip da coluna Origem. */
  origem_label: string;
  descricao: string;
  fornecedor_nome: string;
  job_codigo: string;
  /** Data vigente de pagamento — o que a tela ordena e soma. */
  data_pagamento: string | null;
  /** Prazo negociado pela produção (PP) ou informado na criação (avulsa). */
  venc_original: string | null;
  data_pagamento_primeira: string | null;
  valor: number;
  parcela_numero: number;
  parcela_total: number;
  status: TituloPagarStatus;
  empresa_id: string;
  plano_conta_tipo_id: string | null;
  plano_conta_subtipo_id: string | null;
  pago_em: string | null;
  conta_nome: string | null;
  centro_nome: string | null;
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

/** Data de hoje em ISO local — não usar `toISOString`, que volta em UTC. */
function hojeISO(): string {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

function somaDiasISO(iso: string, dias: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const base = new Date(y, m - 1, d + dias);
  const mes = String(base.getMonth() + 1).padStart(2, "0");
  const dia = String(base.getDate()).padStart(2, "0");
  return `${base.getFullYear()}-${mes}-${dia}`;
}

const CHIP_ORIGEM: Array<{ key: "todas" | OrigemTitulo; label: string }> = [
  { key: "todas", label: "Todas as origens" },
  { key: "pp", label: "PPs" },
  { key: "avulso", label: "Avulsos" },
  { key: "recorrencia", label: "Recorrências" },
];

/** Cores do chip de origem — copiadas do protótipo. */
function origemChipClass(origem: OrigemTitulo): string {
  switch (origem) {
    case "pp":
      return "border-border bg-muted text-muted-foreground";
    case "avulso":
      return "border-violet-200 bg-violet-50 text-violet-700";
    case "recorrencia":
      return "border-blue-200 bg-blue-50 text-blue-700";
  }
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

interface Props {
  /** Base bruta — o componente filtra por `modo` internamente. */
  rows: TituloRow[];
  /**
   * `a_pagar`: mostra só o que ainda tem que sair; botão de lançamento
   * avulso, botão "Baixar" e resumo de caixa a sair.
   * `pagos`: histórico do que já saiu; sem criação, sem baixa; só
   * conferência via "Conciliação".
   */
  modo: "a_pagar" | "pagos";
  tenantId: string;
  contas: ContaBancaria[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
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

export function TitulosPagarList({
  rows: rowsBruto,
  modo,
  tenantId,
  contas,
  tipos,
  subtipos,
  empresas,
  fornecedores,
  clientes,
  jobs,
  regionais,
}: Props) {
  // Cada aba enxerga só o próprio conjunto — evita cascata de condicionais
  // no resto do componente.
  const rows = React.useMemo(
    () =>
      rowsBruto.filter((r) =>
        modo === "a_pagar" ? r.status === "a_pagar" : r.status === "pago",
      ),
    [rowsBruto, modo],
  );
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const [filtroOrigem, setFiltroOrigem] = React.useState<"todas" | OrigemTitulo>("todas");
  const [busca, setBusca] = React.useState("");
  // Filtro de período — só usado no modo `pagos`. Filtra por `pago_em`
  // (ISO local). Datas vazias = sem limite naquele lado.
  const [dataDe, setDataDe] = React.useState<string>("");
  const [dataAte, setDataAte] = React.useState<string>("");

  const [baixando, setBaixando] = React.useState<TituloRow | null>(null);
  /** Título JÁ PAGO aberto para conferência — e para estornar, se for o
   *  caso. Clicar na linha paga é o que o abre (18/08/2026). */
  const [conferindo, setConferindo] = React.useState<TituloRow | null>(null);
  const [editando, setEditando] = React.useState<TituloRow | null>(null);
  const [erroAcao, setErroAcao] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  /**
   * "Criar e dar baixa": o lançamento é criado primeiro e a baixa vem
   * logo atrás. Como a linha nova só existe depois que o `router.refresh()`
   * do drawer volta do servidor, guardamos o id e abrimos a baixa assim
   * que ela aparece em `rows`.
   */
  const [baixarAposCriar, setBaixarAposCriar] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!baixarAposCriar) return;
    const nova = rows.find((r) => r.origem !== "pp" && r.id === baixarAposCriar);
    if (!nova) return;
    setBaixarAposCriar(null);
    setErroAcao(null);
    setBaixando(nova);
  }, [rows, baixarAposCriar]);

  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // O chip de origem conta respeitando a busca e o período ativos: o
  // número é literalmente "quantas linhas apareceriam se eu clicasse
  // aqui".
  const casaBusca = React.useCallback(
    (r: TituloRow, q: string) =>
      !q ||
      r.descricao.toLowerCase().includes(q) ||
      r.fornecedor_nome.toLowerCase().includes(q) ||
      r.job_codigo.toLowerCase().includes(q) ||
      r.origem_label.toLowerCase().includes(q),
    [],
  );

  // Filtro de período só se aplica no modo `pagos`, por `pago_em`. No modo
  // `a_pagar` os dois inputs de data ficam ocultos, então retorna true.
  const casaPeriodo = React.useCallback(
    (r: TituloRow) => {
      if (modo !== "pagos") return true;
      if (!dataDe && !dataAte) return true;
      const p = r.pago_em ?? "";
      if (!p) return false;
      if (dataDe && p < dataDe) return false;
      if (dataAte && p > dataAte) return false;
      return true;
    },
    [modo, dataDe, dataAte],
  );

  const contagemOrigem = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    const base = rows.filter((r) => casaBusca(r, q) && casaPeriodo(r));
    return {
      todas: base.length,
      pp: base.filter((r) => r.origem === "pp").length,
      avulso: base.filter((r) => r.origem === "avulso").length,
      recorrencia: base.filter((r) => r.origem === "recorrencia").length,
    };
  }, [rows, busca, casaBusca, casaPeriodo]);

  const filtrados = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (filtroOrigem !== "todas" && r.origem !== filtroOrigem) return false;
        if (!casaPeriodo(r)) return false;
        return casaBusca(r, q);
      })
      .sort((a, b) => {
        // Em "a pagar", o próximo vencimento vem primeiro; em "pagos", o
        // mais recente vem primeiro (histórico decrescente).
        if (modo === "pagos") {
          const paA = a.pago_em ?? "0000-00-00";
          const paB = b.pago_em ?? "0000-00-00";
          return paB.localeCompare(paA);
        }
        return (a.data_pagamento ?? "9999-12-31").localeCompare(
          b.data_pagamento ?? "9999-12-31",
        );
      });
  }, [rows, filtroOrigem, busca, casaBusca, casaPeriodo, modo]);

  // Faixa de resumo — sempre sobre a base inteira do modo, não sobre o
  // filtro: é panorama do caixa, não recorte da busca. O corte de "mês"
  // segue o mês corrente local (America/Sao_Paulo).
  const resumo = React.useMemo(() => {
    const hoje = hojeISO();
    if (modo === "a_pagar") {
      const limite = somaDiasISO(hoje, 7);
      return {
        emAberto: rows.reduce((s, r) => s + r.valor, 0),
        semana: rows
          .filter(
            (r) =>
              r.data_pagamento && r.data_pagamento >= hoje && r.data_pagamento <= limite,
          )
          .reduce((s, r) => s + r.valor, 0),
        pagosHoje: 0,
        pagosMes: 0,
        totalPago: 0,
      };
    }
    const mesAtual = hoje.slice(0, 7);
    // "Total pago" reflete o filtro de período (é o número que interessa
    // quando o usuário está recortando um intervalo). "Hoje" e "Este mês"
    // são atalhos absolutos e ignoram o período.
    return {
      emAberto: 0,
      semana: 0,
      pagosHoje: rows.filter((r) => r.pago_em === hoje).reduce((s, r) => s + r.valor, 0),
      pagosMes: rows
        .filter((r) => (r.pago_em ?? "").slice(0, 7) === mesAtual)
        .reduce((s, r) => s + r.valor, 0),
      totalPago: rows.filter((r) => casaPeriodo(r)).reduce((s, r) => s + r.valor, 0),
    };
  }, [rows, modo, casaPeriodo]);

  const alvoBaixa: BaixaTituloAlvo | null = baixando
    ? {
        titulo: baixando.descricao,
        origem:
          baixando.origem === "pp"
            ? `Pedido de produção ${baixando.origem_label}`
            : baixando.origem === "recorrencia"
              ? `Recorrência · ${baixando.descricao}`
              : "Lançamento avulso",
        parcela: `${baixando.parcela_numero}/${baixando.parcela_total}`,
        vencimento: baixando.data_pagamento,
        valor: baixando.valor,
        empresaId: baixando.empresa_id,
        planoContaTipoId: baixando.plano_conta_tipo_id,
        planoContaSubtipoId: baixando.plano_conta_subtipo_id,
      }
    : null;

  const alvoConferencia: BaixaRegistradaAlvo | null = conferindo
    ? {
        titulo: conferindo.descricao,
        origem:
          conferindo.origem === "pp"
            ? `Pedido de produção ${conferindo.origem_label}`
            : conferindo.origem === "recorrencia"
              ? `Recorrência · ${conferindo.descricao}`
              : "Lançamento avulso",
        parcela: `${conferindo.parcela_numero}/${conferindo.parcela_total}`,
        valor: conferindo.valor,
        pagoEm: conferindo.pago_em,
        contaNome: conferindo.conta_nome,
        centroNome: conferindo.centro_nome,
        dataPagamento: conferindo.data_pagamento,
        vencOriginal: conferindo.venc_original,
      }
    : null;

  const alvoEdicao: EditarDataAlvo | null = editando
    ? {
        titulo: editando.descricao,
        origem:
          editando.origem === "pp"
            ? `${editando.origem_label} · ${editando.parcela_numero}/${editando.parcela_total}`
            : editando.origem_label,
        vencOriginal: editando.venc_original,
        primeiraData: editando.data_pagamento_primeira,
        dataAtual: editando.data_pagamento,
      }
    : null;

  return (
    <div className="space-y-4">
      {/* Filtros + busca + botão — tudo numa linha, padrão da aba
          Recorrências. No modo `pagos`, o filtro de período dobra pra
          próxima linha via flex-wrap se não couber. */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {CHIP_ORIGEM.map((c) => (
            <Chip
              key={c.key}
              ativo={filtroOrigem === c.key}
              onClick={() => setFiltroOrigem(c.key)}
              label={c.label}
              count={contagemOrigem[c.key]}
            />
          ))}

          <div className="relative ml-auto min-w-[240px] max-w-md flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por título, fornecedor ou job..."
              className="w-full rounded-lg border border-border bg-white py-2 pl-9 pr-3 text-sm focus:border-california-red focus:outline-none"
            />
          </div>
        </div>

        {modo === "a_pagar" && (
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
            onCriadaParaBaixa={(id) => {
              setFiltroOrigem("todas");
              setBusca("");
              setBaixarAposCriar(id);
            }}
            trigger={
              <button
                type="button"
                className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-california-red-hover"
              >
                <Plus className="h-4 w-4" />
                Lançamento Avulso
              </button>
            }
          />
        )}
      </div>

      {/* Faixa de resumo — panorama do caixa por modo */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card px-4 py-3">
        {modo === "a_pagar" ? (
          <>
            <ResumoItem
              icone={<Wallet className="h-3.5 w-3.5 text-california-red" />}
              label="Em aberto"
              valor={resumo.emAberto}
            />
            <div className="h-5 w-px bg-border" />
            <ResumoItem
              icone={<CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />}
              label="Vencendo em 7 dias"
              valor={resumo.semana}
            />
          </>
        ) : (
          <>
            <ResumoItem
              icone={<CheckCheck className="h-3.5 w-3.5 text-emerald-700" />}
              label="Pagos hoje"
              valor={resumo.pagosHoje}
            />
            <div className="h-5 w-px bg-border" />
            <ResumoItem
              icone={<CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />}
              label="Pagos este mês"
              valor={resumo.pagosMes}
            />
            <div className="h-5 w-px bg-border" />
            <ResumoItem
              icone={<Wallet className="h-3.5 w-3.5 text-muted-foreground" />}
              label="Total pago (filtro)"
              valor={resumo.totalPago}
            />
            {/* Filtro de período — ancorado à direita do card. Cada
                DatePicker traz seu próprio X pra limpar. */}
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Pago em
              </span>
              <div className="w-[160px]">
                <DatePicker
                  name="pago_em_de"
                  defaultValue={dataDe}
                  placeholder="De"
                  onDateChange={(d) => setDataDe(d ? format(d, "yyyy-MM-dd") : "")}
                  className="h-9 px-3 text-xs"
                />
              </div>
              <span className="text-xs text-muted-foreground">até</span>
              <div className="w-[160px]">
                <DatePicker
                  name="pago_em_ate"
                  defaultValue={dataAte}
                  placeholder="Até"
                  onDateChange={(d) => setDataAte(d ? format(d, "yyyy-MM-dd") : "")}
                  className="h-9 px-3 text-xs"
                />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Tabela — table-fixed para caber no max-w-7xl sem scroll horizontal.
          Larguras em % para escalar com o container; Título e Fornecedor
          absorvem sobra e truncam quando precisa. */}
      <div className="rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-center text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="w-[10%] px-2 py-3 font-semibold">Data Pgto.</th>
              <th className="w-[8%] px-2 py-3 font-semibold">Venc. Orig.</th>
              <th className="w-[21%] px-3 py-3 font-semibold">Título</th>
              <th className="w-[15%] px-3 py-3 font-semibold">Fornecedor</th>
              <th className="w-[8%] px-2 py-3 font-semibold">Job</th>
              <th className="w-[9%] px-2 py-3 font-semibold">Origem</th>
              <th className="w-[9%] px-3 py-3 font-semibold">Valor</th>
              <th className="w-[6%] px-2 py-3 font-semibold">Parcela</th>
              <th className="w-[7%] px-2 py-3 font-semibold">Status</th>
              <th className="w-[7%] px-3 py-3 font-semibold">Ação</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  {rows.length === 0
                    ? modo === "a_pagar"
                      ? "Nenhum título a pagar ainda. Aprove um Pedido de Produção ou crie um lançamento avulso."
                      : "Nenhum título pago ainda. Baixas registradas aparecerão aqui."
                    : "Nenhum título encontrado com esses filtros."}
                </td>
              </tr>
            )}
            {filtrados.map((r) => {
              const repactuado =
                r.venc_original !== null &&
                r.data_pagamento !== null &&
                r.venc_original !== r.data_pagamento;
              const pago = r.status === "pago";
              return (
                <tr
                  key={`${r.origem}-${r.id}`}
                  // Título pago abre a baixa registrada ao clique, como o
                  // Tiago pediu em 18/08/2026. Em aberto a linha não é
                  // clicável: as ações dele são os botões próprios (lápis
                  // e "Baixar"), e um clique solto não pode disparar
                  // pagamento.
                  onClick={pago ? () => {
                    setErroAcao(null);
                    setConferindo(r);
                  } : undefined}
                  className={cn(
                    "border-b border-border transition-colors last:border-0 hover:bg-accent/40",
                    pago && "cursor-pointer",
                  )}
                >
                  <td className="px-2 py-3">
                    <div className="flex items-center justify-center gap-1.5">
                      {!pago && (
                        <button
                          type="button"
                          title="Editar data de pagamento"
                          onClick={(e) => {
                            e.stopPropagation();
                            setErroAcao(null);
                            setEditando(r);
                          }}
                          className="inline-flex h-5 w-5 flex-none items-center justify-center rounded border border-border bg-white text-muted-foreground transition-colors hover:border-california-red hover:text-california-red"
                        >
                          <Pencil className="h-2.5 w-2.5" />
                        </button>
                      )}
                      <span
                        className={cn(
                          "whitespace-nowrap font-mono text-xs",
                          repactuado && "font-semibold text-california-red",
                        )}
                      >
                        {formatDate(r.data_pagamento)}
                      </span>
                    </div>
                  </td>
                  <td className="px-2 py-3 text-center">
                    <span
                      className={cn(
                        "whitespace-nowrap font-mono text-xs",
                        repactuado ? "text-amber-800" : "text-muted-foreground",
                      )}
                    >
                      {formatDate(r.venc_original)}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="break-words font-semibold">{r.descricao}</span>
                      {pago && (
                        <span className="text-[11px] text-muted-foreground">
                          Pago em {formatDate(r.pago_em)} · {r.conta_nome ?? "—"} ·{" "}
                          {r.centro_nome ?? "—"}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    <span className="block truncate" title={r.fornecedor_nome}>
                      {r.fornecedor_nome}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-3 text-center font-mono text-xs text-muted-foreground">
                    {r.job_codigo}
                  </td>
                  <td className="px-2 py-3 text-center">
                    <span
                      className={cn(
                        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                        origemChipClass(r.origem),
                      )}
                    >
                      {r.origem_label}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums">
                    {formatMoney(r.valor)}
                  </td>
                  <td className="px-2 py-3 text-center font-mono text-xs text-muted-foreground">
                    {r.parcela_numero}/{r.parcela_total}
                  </td>
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
                  <td className="px-3 py-3 text-center">
                    {pago ? (
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
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setErroAcao(null);
                          setBaixando(r);
                        }}
                        className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-emerald-600 px-2 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-emerald-700"
                      >
                        <CreditCard className="h-3 w-3" />
                        Baixar
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5" />
        {modo === "a_pagar"
          ? "Nesta aba só é possível dar baixa. A aprovação e a rejeição continuam na aba de Pedidos de Produção."
          : "Histórico de títulos já pagos. Clique numa linha para conferir a baixa e, se preciso, estornar."}
      </p>

      <BaixaTituloDialog
        open={baixando !== null}
        onOpenChange={(o) => {
          if (!o) {
            setBaixando(null);
            setErroAcao(null);
          }
        }}
        alvo={alvoBaixa}
        contas={contas}
        tipos={tipos}
        subtipos={subtipos}
        pending={pending}
        erro={erroAcao}
        onConfirm={(payload) => {
          const alvo = baixando;
          if (!alvo) return;
          startTransition(async () => {
            const res = await darBaixaTitulo({
              origem: alvo.origem,
              id: alvo.id,
              ...payload,
            });
            if (!res.ok) {
              setErroAcao(res.message);
              return;
            }
            setBaixando(null);
            setErroAcao(null);
            setToast(
              `Baixa registrada · ${formatMoney(alvo.valor)} enviado para a conciliação.`,
            );
            router.refresh();
          });
        }}
      />

      <BaixaRegistradaDialog
        open={conferindo !== null}
        onOpenChange={(o) => {
          if (!o) {
            setConferindo(null);
            setErroAcao(null);
          }
        }}
        alvo={alvoConferencia}
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
            setToast(
              `Baixa estornada · ${formatMoney(alvo.valor)} devolvido para "A pagar".`,
            );
            router.refresh();
          });
        }}
      />

      <EditarDataPagamentoDialog
        open={editando !== null}
        onOpenChange={(o) => {
          if (!o) {
            setEditando(null);
            setErroAcao(null);
          }
        }}
        alvo={alvoEdicao}
        pending={pending}
        erro={erroAcao}
        onSalvar={(novaData) => {
          const alvo = editando;
          if (!alvo) return;
          startTransition(async () => {
            const res = await repactuarDataPagamento({
              origem: alvo.origem,
              id: alvo.id,
              data_pagamento: novaData,
            });
            if (!res.ok) {
              setErroAcao(res.message);
              return;
            }
            setEditando(null);
            setErroAcao(null);
            setToast(`Data de pagamento atualizada para ${formatDate(novaData)}.`);
            router.refresh();
          });
        }}
      />

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-elevated"
        >
          <CheckCheck className="h-4 w-4 shrink-0 text-emerald-700" />
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
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
        ativo
          ? "border-california-red bg-california-red text-white"
          : "border-border bg-white text-muted-foreground hover:border-california-red/50",
      )}
    >
      {label}
      <span
        className={cn(
          "tabular-nums",
          ativo ? "text-white/85" : "text-muted-foreground/70",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function ResumoItem({
  icone,
  label,
  valor,
}: {
  icone: React.ReactNode;
  label: string;
  valor: number;
}) {
  return (
    <div className="flex items-center gap-2.5">
      {icone}
      <span className="whitespace-nowrap text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-sm font-bold tabular-nums">
        {formatMoney(valor)}
      </span>
    </div>
  );
}
