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
 *
 * A seleção é a da baixa em lote (`components/financeiro/baixa-em-lote.tsx`),
 * com as mesmas regras de quem entra nas listas e a conta aberta já
 * escolhida no diálogo.
 *
 * Impostos a Pagar (módulo fiscal, entrega 2): os impostos em aberto entram
 * como no protótipo aprovado — o chip "Imposto", o valor com "−", o filtro
 * "Impostos" —, e "Baixar" abre a MESMA baixa da aba Impostos a Pagar
 * (`BaixaImpostoDialog`), com a conta da conciliação já escolhida.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, CreditCard, Info, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { BaixaTituloDialog } from "@/components/financeiro/baixa-titulo-dialog";
import {
  BaixaEmLoteDialog,
  BarraDeSelecao,
  CaixaDaLinha,
  CaixaDoCabecalho,
  ChipTipo,
  elegivelDoLote,
  useSelecao,
  type TituloParaLote,
} from "@/components/financeiro/baixa-em-lote";
import { lerCompetencia, rotuloCurto } from "@/lib/cartoes/competencia";
import { BaixaRecebimentoDialog } from "../contas-a-receber/baixa-recebimento-dialog";
import { darBaixaTitulo as darBaixaTituloAPagar } from "../contas-a-pagar/actions-titulos";
import { darBaixaTitulo as darBaixaTituloAReceber } from "../contas-a-receber/actions";
import { darBaixaRecebimentoAvulso } from "../contas-a-receber/actions-recebimento-avulso";
import { BaixaImpostoDialog } from "../fiscal/impostos/dialogos";
import type { DadosDaAbaTitulos } from "./titulos-dados";
import {
  alvoDaBaixaAPagar,
  alvoDaBaixaAReceber,
  faltaPagar,
  faltaReceber,
} from "./alvos-da-baixa";
import {
  casaVencimento,
  montarLinhas,
  type FiltroVencimento,
  type Lado,
  type Linha,
} from "./linhas-da-aba";

// ---------------------------------------------------------------------------
// Datas e dinheiro
// ---------------------------------------------------------------------------

/** Hoje em ISO local — `toISOString` volta em UTC e erra o dia à noite. */
function hojeIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

type FiltroTipo = "todos" | Lado;

const CHIPS_TIPO: Array<{ key: FiltroTipo; label: string }> = [
  { key: "todos", label: "Todos" },
  { key: "pagar", label: "A pagar" },
  { key: "receber", label: "A receber" },
  { key: "imposto", label: "Impostos" },
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

  const linhas = React.useMemo(
    () => montarLinhas(dados.aPagar, dados.aReceber, dados.empresas, dados.impostos),
    [dados],
  );

  // As contagens dos tipos seguem a busca e o vencimento, não o tipo (como
  // as origens em Títulos a Pagar): o número é "quantas linhas apareceriam
  // se eu clicasse aqui".
  const base = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return linhas.filter(
      (l) => casaVencimento(l.vencimento, vencimento, hoje) && (!q || l.busca.includes(q)),
    );
  }, [linhas, busca, vencimento, hoje]);

  const contagem: Record<FiltroTipo, number> = {
    todos: base.length,
    pagar: base.filter((l) => l.lado === "pagar").length,
    receber: base.filter((l) => l.lado === "receber").length,
    imposto: base.filter((l) => l.lado === "imposto").length,
  };
  const filtrados = tipo === "todos" ? base : base.filter((l) => l.lado === tipo);

  // A baixa em lote, como nas listas: a seleção vale para o que está na
  // tela (filtros valendo), e o título que some do filtro, ou que foi
  // baixado, sai dela sozinho. Uma origem por lote (revisão da decisão
  // 140, 05/10/2026): a pagar, a receber e imposto nunca se misturam, e
  // dentro de cada lado vale o chip de origem das listas.
  const elegiveis = filtrados.flatMap((l) =>
    l.motivoForaDoLote === null && l.lote ? [elegivelDoLote(l.lote)] : [],
  );
  const selecao = useSelecao(elegiveis);
  const [loteAberto, setLoteAberto] = React.useState(false);
  const selecionados = filtrados
    .filter((l) => selecao.marcado(l.chave))
    .map((l) => l.lote)
    .filter((t): t is TituloParaLote => t !== null);

  // ---- A baixa de UM título: a baixa real do lado dele ----

  const baixandoPagar = baixando?.lado === "pagar" ? baixando.t : null;
  const baixandoReceber = baixando?.lado === "receber" ? baixando.t : null;
  const baixandoImposto = baixando?.lado === "imposto" ? baixando.t : null;
  // As contas da baixa do imposto (as da aba, que já vêm sem cartão).
  const contasDoImposto = React.useMemo(
    () =>
      dados.contas.map((c) => ({
        id: c.id,
        nome: c.nome,
        banco: c.banco,
        empresa_contabil_id: c.empresa_contabil_id,
      })),
    [dados.contas],
  );

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
                {/* Marca todos os que a aba mostra e aceitam a baixa em lote
                    — da origem já marcada. */}
                <CaixaDoCabecalho {...selecao.cabecalho} />
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
              const motivoLote = l.motivoForaDoLote ?? selecao.foraDaOrigem(l.chave);
              const noLote = motivoLote === null;
              const marcado = selecao.marcado(l.chave);
              return (
                <tr
                  key={l.chave}
                  // O clique na linha marca e desmarca, como na remessa CNAB
                  // — marcar não baixa nada. A baixa de um título é o botão
                  // "Baixar".
                  onClick={noLote ? () => selecao.alternar(l.chave) : undefined}
                  className={cn(
                    "border-b border-border transition-colors last:border-0 hover:bg-accent/40",
                    noLote && "cursor-pointer",
                    marcado && "bg-california-red/[0.04]",
                  )}
                >
                  {/* Desligada, com o motivo no título, no que não entra no
                      lote (o título vai também na célula: caixa desligada
                      nem sempre mostra o próprio). */}
                  <td
                    className="py-3 pl-4 pr-1 text-center"
                    title={motivoLote ?? undefined}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (noLote) selecao.alternar(l.chave);
                    }}
                  >
                    <CaixaDaLinha
                      marcado={marcado}
                      onAlternar={() => selecao.alternar(l.chave)}
                      disponivel={noLote}
                      motivo={motivoLote ?? undefined}
                    />
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
                    <ChipTipo tipo={l.lado} />
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

      {/* A barra da seleção — quantos títulos, o que sai e o que entra, e
          "Dar baixa" —, e o diálogo do lote, com a conta aberta escolhida. */}
      <BarraDeSelecao
        itens={selecionados}
        onLimpar={selecao.limpar}
        onBaixar={() => setLoteAberto(true)}
      />
      <BaixaEmLoteDialog
        open={loteAberto}
        onOpenChange={setLoteAberto}
        itens={selecionados}
        contas={dados.contas}
        tipos={dados.tipos}
        subtipos={dados.subtipos}
        // A conta-espelho do cartão, aberta por link direto, não é conta
        // de baixa: aí o lote abre sem conta, como as baixas de um título.
        contaPadrao={dados.contas.some((c) => c.id === contaId) ? contaId : null}
        tenantId={dados.tenantId}
        nomesDasPJs={dados.nomesDasPJs}
        onConcluido={(mensagem) => {
          selecao.limpar();
          setToast(mensagem);
        }}
      />

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

      {/* Imposto: a baixa de Impostos a Pagar, com a conta aberta. */}
      {baixandoImposto && (
        <BaixaImpostoDialog
          imposto={baixandoImposto}
          contas={contasDoImposto}
          nomesDasPJs={dados.nomesDasPJs}
          tenantId={dados.tenantId}
          contaInicial={contaId}
          onClose={fechar}
          onBaixado={({ pago_em, conta_bancaria_id }) => {
            fechar();
            setToast(avisoDaBaixa(conta_bancaria_id, pago_em));
            router.refresh();
          }}
        />
      )}

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
