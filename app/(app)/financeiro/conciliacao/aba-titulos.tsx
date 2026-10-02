"use client";

/**
 * A aba Títulos da conciliação de uma conta (pedido do Tiago em
 * 02/10/2026): "tudo que está no contas a pagar e no contas a receber
 * aguardando baixa, para que seja possível dar baixa ali mesmo selecionando
 * a conta bancária". A aba é a mesma para todas as contas — a conta só se
 * define na baixa —, e a conta aberta na conciliação já vem escolhida nela.
 *
 * Os títulos chegam prontos do servidor (`titulos-dados.ts`), no tipo das
 * listas reais. "Baixar" abre a baixa REAL de cada lado — o
 * `BaixaTituloDialog` de Contas a Pagar e o `BaixaRecebimentoDialog` de
 * Contas a Receber, com o mesmo `alvo` que as listas montam
 * (`alvos-da-baixa.ts`) — e confirma pelas mesmas Server Actions, com as
 * travas de permissão delas.
 *
 * Desenho do protótipo aprovado: vencimento (Vencidos · Até hoje · Próximos
 * 7 dias · Todos, abrindo em Todos), busca e tipo com contagem, e a tabela
 * com a seleção, o tipo, o título, a contraparte, a empresa, o job e o
 * valor — o que entra na conta em verde, com "+", o que sai com "−".
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, CreditCard, Info, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { BaixaTituloDialog } from "@/components/financeiro/baixa-titulo-dialog";
import { lerCompetencia, rotuloCurto } from "@/lib/cartoes/competencia";
import { BaixaRecebimentoDialog } from "../contas-a-receber/baixa-recebimento-dialog";
import { darBaixaTitulo as darBaixaTituloAPagar } from "../contas-a-pagar/actions-titulos";
import { darBaixaTitulo as darBaixaTituloAReceber } from "../contas-a-receber/actions";
import { darBaixaRecebimentoAvulso } from "../contas-a-receber/actions-recebimento-avulso";
import type { TituloRow as TituloAPagar } from "../contas-a-pagar/titulos-pagar-list";
import type { TituloRow as TituloAReceber } from "../contas-a-receber/titulos-list";
import type { DadosDaAbaTitulos } from "./titulos-dados";
import {
  alvoDaBaixaAPagar,
  alvoDaBaixaAReceber,
  faltaPagar,
  faltaReceber,
} from "./alvos-da-baixa";

// ---------------------------------------------------------------------------
// A linha da aba
// ---------------------------------------------------------------------------

type Lado = "pagar" | "receber";

interface LinhaBase {
  /** Única entre os dois lados. */
  chave: string;
  /** A pagar: a data de pagamento vigente (a que a lista ordena e
   *  repactua). A receber: o vencimento da nota (o da inadimplência). */
  vencimento: string | null;
  titulo: string;
  referencia: string;
  contraparte: string;
  empresa: string;
  job: { codigo: string; titulo: string } | null;
  /** O que falta: o valor menos as baixas já feitas (decisão 125). */
  aberto: number;
  valor: number;
  baixado: number;
  /** Com baixa e ainda faltando. */
  parcial: boolean;
  /** O dinheiro ENTRA na conta: o a receber, e o estorno de verba (que
   *  mora em Contas a Pagar, mas é dinheiro voltando). */
  entra: boolean;
  busca: string;
}

type Linha =
  | (LinhaBase & { lado: "pagar"; t: TituloAPagar })
  | (LinhaBase & { lado: "receber"; t: TituloAReceber });

/** "PP-00127", "Lançamento avulso"… e a parcela, quando há mais de uma. */
function referenciaAPagar(t: TituloAPagar): string {
  const origem =
    t.origem === "pp"
      ? t.origem_label
      : t.origem === "recorrencia"
        ? "Recorrência"
        : t.origem === "desembolso"
          ? `Desembolso ${t.origem_label}`
          : t.origem === "pp_devolucao_verba"
            ? `Estorno de verba ${t.origem_label.replace(/^ESTORNO /, "")}`
            : t.origem === "fatura_cartao"
              ? `Fatura de cartão ${t.origem_label}`
              : t.origem === "folha"
                ? "Folha de pagamento"
                : "Lançamento avulso";
  return t.parcela_total > 1 ? `${origem} · parcela ${t.parcela_numero}/${t.parcela_total}` : origem;
}

function linhaAPagar(t: TituloAPagar, empresas: Record<string, string>): Linha {
  const aberto = faltaPagar(t);
  const titulo = t.descricao;
  const referencia = referenciaAPagar(t);
  const contraparte = t.fornecedor_nome || "—";
  const empresa = empresas[t.empresa_id] ?? "—";
  const job = t.job_codigo && t.job_codigo !== "—" ? { codigo: t.job_codigo, titulo: t.job_nome } : null;
  return {
    lado: "pagar",
    t,
    chave: `pagar:${t.origem}:${t.id}`,
    vencimento: t.data_pagamento,
    titulo,
    referencia,
    contraparte,
    empresa,
    job,
    aberto,
    valor: t.valor,
    baixado: t.baixado,
    parcial: t.baixas.length > 0 && aberto > 0.004,
    entra: t.origem === "pp_devolucao_verba",
    busca: [titulo, referencia, contraparte, empresa, t.job_codigo, t.job_nome, t.origem_label]
      .join(" ")
      .toLowerCase(),
  };
}

function linhaAReceber(t: TituloAReceber, empresas: Record<string, string>): Linha {
  const aberto = faltaReceber(t);
  const nota = t.origem === "nf";
  const titulo = nota
    ? `NF ${t.fat_numero_nf}${t.total_parcelas > 1 ? ` · parcela ${t.numero_parcela}/${t.total_parcelas}` : ""}`
    : t.fat_descricao;
  const referencia = nota
    ? t.fat_descricao
    : `${t.codigo_avulsa ?? "—"} · ${t.origem === "rendimento" ? "Rendimento" : "Recebimento avulso"}`;
  const empresa = empresas[t.empresa_id] ?? "—";
  const job =
    t.jobs.length > 0
      ? {
          codigo: t.jobs.length > 1 ? `${t.jobs[0].codigo} +${t.jobs.length - 1}` : t.jobs[0].codigo,
          titulo: t.jobs_cobertos.join(" · "),
        }
      : null;
  return {
    lado: "receber",
    t,
    chave: `receber:${t.origem}:${t.id}`,
    vencimento: t.data_vencimento,
    titulo,
    referencia,
    contraparte: t.contraparte_nome,
    empresa,
    job,
    aberto,
    valor: t.valor,
    baixado: t.baixado,
    parcial: t.baixas.length > 0 && aberto > 0.004,
    entra: true,
    busca: [titulo, referencia, t.contraparte_nome, empresa, ...t.jobs_cobertos, t.codigo_avulsa ?? ""]
      .join(" ")
      .toLowerCase(),
  };
}

// ---------------------------------------------------------------------------
// Datas e dinheiro
// ---------------------------------------------------------------------------

/** Hoje em ISO local — `toISOString` volta em UTC e erra o dia à noite. */
function hojeIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function somaDias(iso: string, dias: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const base = new Date(y, m - 1, d + dias);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------

type FiltroVencimento = "vencidos" | "ate_hoje" | "proximos_7" | "todos";
type FiltroTipo = "todos" | Lado;

const CHIPS_TIPO: Array<{ key: FiltroTipo; label: string }> = [
  { key: "todos", label: "Todos" },
  { key: "pagar", label: "A pagar" },
  { key: "receber", label: "A receber" },
];

// ---------------------------------------------------------------------------
// O componente
// ---------------------------------------------------------------------------

export function AbaTitulos({
  dados,
  contaId,
  dataDe,
  dataAte,
}: {
  dados: DadosDaAbaTitulos;
  /** A conta aberta na conciliação: vem escolhida na baixa. */
  contaId: string;
  /** O período aberto no Extrato, para o aviso de onde o movimento foi
   *  parar depois da baixa. */
  dataDe: string;
  dataAte: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [vencimento, setVencimento] = React.useState<FiltroVencimento>("todos");
  const [tipo, setTipo] = React.useState<FiltroTipo>("todos");
  const [busca, setBusca] = React.useState("");
  const [baixando, setBaixando] = React.useState<Linha | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const hoje = hojeIso();
  const limite = somaDias(hoje, 7);

  const linhas = React.useMemo(
    () =>
      [
        ...dados.aPagar.map((t) => linhaAPagar(t, dados.empresas)),
        ...dados.aReceber.map((t) => linhaAReceber(t, dados.empresas)),
      ].sort(
        (a, b) =>
          (a.vencimento ?? "9999-12-31").localeCompare(b.vencimento ?? "9999-12-31") ||
          a.lado.localeCompare(b.lado) ||
          a.titulo.localeCompare(b.titulo, "pt-BR"),
      ),
    [dados],
  );

  // As contagens dos tipos seguem a busca e o vencimento, não o tipo (como
  // as origens em Títulos a Pagar): o número é "quantas linhas apareceriam
  // se eu clicasse aqui".
  const base = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return linhas.filter((l) => {
      const v = l.vencimento;
      const casaVencimento =
        vencimento === "vencidos"
          ? v !== null && v < hoje
          : vencimento === "ate_hoje"
            ? v !== null && v <= hoje
            : vencimento === "proximos_7"
              ? v !== null && v >= hoje && v <= limite
              : true;
      return casaVencimento && (!q || l.busca.includes(q));
    });
  }, [linhas, busca, vencimento, hoje, limite]);

  const contagem: Record<FiltroTipo, number> = {
    todos: base.length,
    pagar: base.filter((l) => l.lado === "pagar").length,
    receber: base.filter((l) => l.lado === "receber").length,
  };
  const filtrados = tipo === "todos" ? base : base.filter((l) => l.lado === tipo);

  // A seleção, para a baixa em lote.
  const [selecionados, setSelecionados] = React.useState<Set<string>>(() => new Set());
  const visiveis = filtrados.map((l) => l.chave);
  const chaveVisiveis = visiveis.join("|");
  // Título que saiu da lista (baixado, filtrado) sai da seleção.
  React.useEffect(() => {
    setSelecionados((prev) => {
      const n = new Set([...prev].filter((c) => visiveis.includes(c)));
      return n.size === prev.size ? prev : n;
    });
    // `visiveis` muda a cada renderização; o que decide é a chave.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveVisiveis]);
  const marcados = visiveis.filter((c) => selecionados.has(c));
  const todosMarcados = visiveis.length > 0 && marcados.length === visiveis.length;
  const algunsMarcados = marcados.length > 0 && !todosMarcados;
  function alternar(chave: string) {
    setSelecionados((prev) => {
      const n = new Set(prev);
      if (n.has(chave)) n.delete(chave);
      else n.add(chave);
      return n;
    });
  }
  function alternarTodos() {
    setSelecionados(todosMarcados ? new Set() : new Set(visiveis));
  }

  // ---- A baixa de UM título: a baixa real do lado dele ----

  const baixandoPagar = baixando?.lado === "pagar" ? baixando.t : null;
  const baixandoReceber = baixando?.lado === "receber" ? baixando.t : null;

  /** Onde o movimento foi parar, para o aviso depois da baixa. */
  function avisoDaBaixa(contaEscolhidaId: string | null, data: string): string {
    if (contaEscolhidaId !== contaId) {
      const outra = dados.contas.find((c) => c.id === contaEscolhidaId);
      return `Baixa registrada na conta ${outra?.nome ?? "escolhida"}, em ${formatDate(data)}: o movimento está no extrato dela.`;
    }
    if (data < dataDe || data > dataAte) {
      return `Baixa registrada em ${formatDate(data)}, fora do período aberto: o movimento está no Extrato desse período.`;
    }
    return `Baixa registrada. O movimento já está no Extrato desta conta, em ${formatDate(data)}.`;
  }

  function fechar() {
    setBaixando(null);
    setErro(null);
  }

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5" />
        Tudo que aguarda baixa no financeiro — igual para todas as contas. A conta escolhida acima já vem marcada
        na baixa.
      </p>

      {/* Linha 1: vencimento — como o Status de Títulos a Pagar. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Vencimento
        </span>
        <StatusChip ativo={vencimento === "vencidos"} onClick={() => setVencimento("vencidos")} label="Vencidos" />
        <StatusChip ativo={vencimento === "ate_hoje"} onClick={() => setVencimento("ate_hoje")} label="Até hoje" />
        <StatusChip
          ativo={vencimento === "proximos_7"}
          onClick={() => setVencimento("proximos_7")}
          label="Próximos 7 dias"
        />
        <StatusChip ativo={vencimento === "todos"} onClick={() => setVencimento("todos")} label="Todos" />
      </div>

      {/* Linha 2: busca e o tipo, com contagem — como a busca e as origens
          de Títulos a Pagar. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por título, contraparte, empresa ou job..."
            className="w-full rounded-lg border border-border bg-white py-2 pl-9 pr-3 text-sm focus:border-california-red focus:outline-none"
          />
        </div>
        {CHIPS_TIPO.map((c) => (
          <Chip
            key={c.key}
            ativo={tipo === c.key}
            onClick={() => setTipo(c.key)}
            label={c.label}
            count={contagem[c.key]}
          />
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-center text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="w-[3%] py-3 pl-4 pr-1 font-semibold">
                <CaixaDoCabecalho
                  todos={todosMarcados}
                  alguns={algunsMarcados}
                  onAlternar={alternarTodos}
                  disponivel={filtrados.length > 0}
                />
              </th>
              <th className="w-[8%] px-2 py-3 font-semibold">Vencimento</th>
              <th className="w-[8%] px-2 py-3 font-semibold">Tipo</th>
              <th className="w-[24%] px-3 py-3 text-left font-semibold">Título</th>
              <th className="w-[17%] px-3 py-3 text-left font-semibold">Contraparte</th>
              <th className="w-[10%] px-3 py-3 text-left font-semibold">Empresa</th>
              <th className="w-[11%] px-2 py-3 text-left font-semibold">Job</th>
              <th className="w-[12%] px-3 py-3 text-right font-semibold">Valor</th>
              <th className="w-[7%] px-3 py-3 font-semibold">Ação</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  {linhas.length === 0
                    ? "Nenhum título aguardando baixa."
                    : "Nenhum título encontrado com esses filtros."}
                </td>
              </tr>
            )}
            {filtrados.map((l) => {
              const vencido = l.vencimento !== null && l.vencimento < hoje;
              const marcado = selecionados.has(l.chave);
              return (
                <tr
                  key={l.chave}
                  onClick={() => alternar(l.chave)}
                  className={cn(
                    "cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-accent/40",
                    marcado && "bg-california-red/[0.04]",
                  )}
                >
                  <td className="py-3 pl-4 pr-1 text-center">
                    <CaixaDaLinha marcado={marcado} onAlternar={() => alternar(l.chave)} />
                  </td>
                  <td className="px-2 py-3 text-center">
                    <span
                      className={cn(
                        "whitespace-nowrap font-mono text-xs",
                        vencido && "font-semibold text-california-red",
                      )}
                    >
                      {formatDate(l.vencimento)}
                    </span>
                  </td>
                  <td className="px-2 py-3 text-center">
                    <ChipTipo lado={l.lado} />
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="break-words font-semibold">{l.titulo}</span>
                      {l.referencia && !l.titulo.startsWith(l.referencia) && (
                        <span className="line-clamp-2 text-[11px] text-muted-foreground" title={l.referencia}>
                          {l.referencia}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    <span className="block truncate" title={l.contraparte}>
                      {l.contraparte}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    <span className="block truncate" title={l.empresa}>
                      {l.empresa}
                    </span>
                  </td>
                  <td className="px-2 py-3 text-xs text-muted-foreground">
                    {l.job ? (
                      <span className="block truncate font-mono" title={l.job.titulo || l.job.codigo}>
                        {l.job.codigo}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td
                    className={cn(
                      "whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums",
                      l.entra && "text-emerald-700",
                    )}
                  >
                    {l.entra ? "+ " : "− "}
                    {formatMoney(l.aberto)}
                    {/* Parcial (decisão 125): o valor é o que falta, e a
                        linha diz de quanto. */}
                    {l.parcial && (
                      <span className="block text-[10.5px] font-medium text-sky-700">
                        {l.lado === "receber" ? "recebido" : "pago"} {formatMoney(l.baixado)} de{" "}
                        {formatMoney(l.valor)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setErro(null);
                        setBaixando(l);
                      }}
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-emerald-600 px-2 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-emerald-700"
                    >
                      <CreditCard className="h-3 w-3" />
                      Baixar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* A pagar: a baixa real de Contas a Pagar, com a conta aberta. */}
      <BaixaTituloDialog
        open={baixandoPagar !== null}
        onOpenChange={(o) => {
          if (!o) fechar();
        }}
        alvo={baixandoPagar ? alvoDaBaixaAPagar(baixandoPagar, dados.ultimasRetencoesPagar) : null}
        contas={dados.contas}
        tipos={dados.tipos}
        subtipos={dados.subtipos}
        cartoes={dados.cartoes}
        formaPlanejada={baixandoPagar?.forma_pagamento ?? baixandoPagar?.forma_prevista ?? null}
        cartaoPlanejadoId={baixandoPagar?.cartao_credito_id ?? baixandoPagar?.cartao_previsto_id ?? null}
        pending={pending}
        erro={erro}
        contaInicial={contaId}
        onConfirm={(payload) => {
          const alvo = baixandoPagar;
          if (!alvo) return;
          startTransition(async () => {
            const res = await darBaixaTituloAPagar({ origem: alvo.origem, id: alvo.id, ...payload });
            if (!res.ok) {
              setErro(res.message);
              return;
            }
            fechar();
            if (payload.forma_pagamento === "cartao_credito") {
              // No cartão nada sai da conta: o item entra numa fatura, e a
              // fatura vem do SERVIDOR (a da data pode já ter fechado).
              const cartao = dados.cartoes.find((c) => c.id === payload.cartao_credito_id) ?? null;
              const competencia = res.fatura
                ? lerCompetencia(res.fatura.competencia_fechamento.slice(0, 7))
                : null;
              setToast(
                res.fatura
                  ? `Confirmado no cartão · ${formatMoney(alvo.valor)} entrou na fatura${competencia ? ` de ${rotuloCurto(competencia)}` : ""}${cartao ? ` do ${cartao.nome}` : ""} (${res.fatura.codigo}). Nada sai da conta bancária agora.`
                  : "Baixa registrada no cartão: o item entra na fatura, e nada sai da conta bancária agora.",
              );
            } else {
              const retido =
                payload.retencoes.reduce((acc, r) => acc + Math.round(r.valor * 100), 0) / 100;
              const resta = Math.round((faltaPagar(alvo) - payload.valor_baixa) * 100) / 100;
              setToast(
                avisoDaBaixa(payload.conta_bancaria_id, payload.pago_em) +
                  (retido > 0 ? ` ${formatMoney(retido)} retidos, a recolher.` : "") +
                  (resta > 0.004 ? ` Faltam ${formatMoney(resta)}.` : ""),
              );
            }
            router.refresh();
          });
        }}
      />

      {/* A receber: a baixa real de Contas a Receber, com a conta aberta. */}
      <BaixaRecebimentoDialog
        open={baixandoReceber !== null}
        onOpenChange={(o) => {
          if (!o) fechar();
        }}
        alvo={baixandoReceber ? alvoDaBaixaAReceber(baixandoReceber, dados.ultimasRetencoesReceber, hoje) : null}
        contas={dados.contas}
        tipos={dados.tipos}
        subtipos={dados.subtipos}
        pending={pending}
        erro={erro}
        contaInicial={contaId}
        onConfirm={(payload) => {
          const alvo = baixandoReceber;
          if (!alvo) return;
          startTransition(async () => {
            const res =
              alvo.origem === "nf"
                ? await darBaixaTituloAReceber({ titulo_id: alvo.id, ...payload })
                : await darBaixaRecebimentoAvulso({ conta_avulsa_id: alvo.conta_avulsa_id, ...payload });
            if (!res.ok) {
              setErro(res.message);
              return;
            }
            fechar();
            const retido =
              payload.retencoes.reduce((acc, r) => acc + Math.round(r.valor * 100), 0) / 100;
            const resta = Math.round((faltaReceber(alvo) - payload.valor_baixa) * 100) / 100;
            setToast(
              avisoDaBaixa(payload.conta_bancaria_id, payload.pago_em) +
                (retido > 0 ? ` ${formatMoney(retido)} de impostos retidos.` : "") +
                (resta > 0.004 ? ` Faltam ${formatMoney(resta)}.` : ""),
            );
            router.refresh();
          });
        }}
      />

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 flex max-w-[560px] items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-elevated"
        >
          <CheckCheck className="h-4 w-4 shrink-0 text-emerald-700" />
          <span className="text-sm font-semibold text-emerald-900">{toast}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Fechar aviso"
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

const CHIP_TIPO: Record<Lado, { classe: string; rotulo: string }> = {
  pagar: { classe: "bg-rose-50 text-rose-700", rotulo: "A pagar" },
  receber: { classe: "bg-emerald-50 text-emerald-700", rotulo: "A receber" },
};

function ChipTipo({ lado }: { lado: Lado }) {
  return (
    <span
      className={cn(
        "inline-block whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold",
        CHIP_TIPO[lado].classe,
      )}
    >
      {CHIP_TIPO[lado].rotulo}
    </span>
  );
}

/** A caixa da linha — a mesma da remessa CNAB. */
function CaixaDaLinha({ marcado, onAlternar }: { marcado: boolean; onAlternar: () => void }) {
  return (
    <input
      type="checkbox"
      checked={marcado}
      title={marcado ? "Tirar da seleção" : "Selecionar para dar baixa em lote"}
      aria-label="Selecionar para dar baixa em lote"
      onChange={onAlternar}
      onClick={(e) => e.stopPropagation()}
      className="h-4 w-4 cursor-pointer accent-california-red"
    />
  );
}

/** A caixa do cabeçalho: marca todos os títulos visíveis. */
function CaixaDoCabecalho({
  todos,
  alguns,
  onAlternar,
  disponivel,
}: {
  todos: boolean;
  alguns: boolean;
  onAlternar: () => void;
  disponivel: boolean;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = alguns;
  }, [alguns]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={todos}
      disabled={!disponivel}
      title={todos ? "Tirar todos da seleção" : "Selecionar todos"}
      aria-label="Selecionar todos"
      onChange={onAlternar}
      className="h-4 w-4 cursor-pointer accent-california-red disabled:cursor-not-allowed disabled:opacity-40"
    />
  );
}

/** O chip de status de Títulos a Pagar. */
function StatusChip({ ativo, onClick, label }: { ativo: boolean; onClick: () => void; label: string }) {
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

/** O chip de origem de Títulos a Pagar, com a contagem. */
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
      <span className={cn("tabular-nums", ativo ? "text-white/85" : "text-muted-foreground/70")}>{count}</span>
    </button>
  );
}
