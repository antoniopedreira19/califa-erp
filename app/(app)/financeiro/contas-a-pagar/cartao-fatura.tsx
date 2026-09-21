"use client";

/**
 * Dentro do cartão (decisão 093, entrega 2): a fatura de uma competência
 * como extrato. Cabeçalho de uma linha — voltar para a capa, seletor de
 * cartão (com a fatura em curso de cada um), setas de competência,
 * calendário de faturas com o ano dentro, status da fatura — e, à
 * direita, Lançar pagamento, Exportar e Fechar/Reabrir. Embaixo, os
 * quatro números da fatura e a tabela.
 *
 * As anteriores, inclusive as pagas, ficam acessíveis pelo calendário e
 * pelas setas: a aba antiga escondia a fatura assim que ela era paga.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Download,
  Unlock,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { CartaoOption } from "@/components/financeiro/forma-pagamento-field";
import type { PlanoContaTipo, PlanoContaSubtipo } from "@/lib/types";
import {
  BaixaRegistradaDialog,
  type BaixaRegistradaAlvo,
} from "@/components/financeiro/baixa-registrada-dialog";
import {
  MESES_CURTOS_LISTA,
  chaveCompetencia,
  lerCompetencia,
  rotuloCompetencia,
  rotuloCurto,
  somarMeses,
} from "@/lib/cartoes/competencia";
import type { TituloRow } from "./titulos-pagar-list";
import { estornarBaixaTitulo } from "./actions-titulos";
import { ReabrirFaturaDialog } from "./reabrir-fatura-dialog";
import {
  EstornarCompraDialog,
  type CompraParaEstorno,
} from "./estornar-compra-dialog";
import { FecharFaturaDialog, type FaturaDoCartao } from "./fechar-fatura-dialog";
import { FaturaExtrato, chaveDoTitulo } from "./fatura-extrato";
import { ChipStatus, subtituloDoCartao } from "./cartao-capa";
import type { CartaoDaCapa, FaturaTela } from "./cartao-tab";

export function CartaoFatura({
  cartoes,
  capa,
  tela,
  faturasDoCartao,
  titulos,
  tipos,
  subtipos,
  regionais,
  pending,
  onVoltar,
  onTrocarCartao,
  onTrocarCompetencia,
  lancarPagamento,
}: {
  cartoes: CartaoOption[];
  capa: CartaoDaCapa[];
  tela: FaturaTela;
  faturasDoCartao: FaturaDoCartao[];
  titulos: TituloRow[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  regionais: Array<{ id: string; nome: string; ativo: boolean; empresa_id: string }>;
  pending: boolean;
  onVoltar: () => void;
  onTrocarCartao: (cartaoId: string) => void;
  onTrocarCompetencia: (competencia: string) => void;
  lancarPagamento: React.ReactNode;
}) {
  const router = useRouter();
  const [pendingAcao, startTransition] = React.useTransition();

  const cartao = cartoes.find((c) => c.id === tela.cartaoId) ?? null;
  const competencia = lerCompetencia(tela.competencia)!;
  const extrato = tela.extrato;
  const fatura = extrato?.fatura ?? null;
  // A soma que o fechamento usa vem da faixa já calculada na página; é
  // ela que o dialog de fechar recebe.
  const faturaDoCartao = fatura ? faturasDoCartao.find((f) => f.id === fatura.id) ?? null : null;

  const titulosPorChave = React.useMemo(() => {
    const mapa = new Map<string, TituloRow>();
    for (const t of titulos) {
      const chave = chaveDoTitulo(t);
      if (chave) mapa.set(chave, t);
    }
    return mapa;
  }, [titulos]);

  const [conferindo, setConferindo] = React.useState<TituloRow | null>(null);
  const [erroAcao, setErroAcao] = React.useState<string | null>(null);
  const [estornando, setEstornando] = React.useState<CompraParaEstorno | null>(null);
  const [fechando, setFechando] = React.useState<FaturaDoCartao | null>(null);
  const [reabrindo, setReabrindo] = React.useState<FaturaDoCartao | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const kpis = extrato?.kpis ?? null;

  return (
    <div
      className={cn("space-y-4 transition-opacity", pending && "opacity-60")}
      aria-busy={pending || undefined}
    >
      {/* ---------------------------------------------------------------- */}
      {/* Cabeçalho de uma linha                                             */}
      {/* ---------------------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onVoltar}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Cartões
        </button>

        <div className="min-w-[300px]">
          <Select value={tela.cartaoId} onValueChange={onTrocarCartao}>
            <SelectTrigger aria-label="Cartão" className="h-10">
              <span className="inline-flex items-center gap-2 truncate">
                <CreditCard className="h-4 w-4 shrink-0 text-muted-foreground" />
                <SelectValue placeholder="Escolha o cartão…" />
              </span>
            </SelectTrigger>
            <SelectContent>
              {capa.map((c) => (
                <SelectItem key={c.cartao.id} value={c.cartao.id}>
                  <span className="inline-flex w-full items-baseline justify-between gap-4">
                    <span>
                      <span className="font-semibold">{c.cartao.nome}</span>
                      <span className="text-muted-foreground"> · {subtituloDoCartao(c)}</span>
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {c.emCurso ? formatCurrency(c.emCurso.total) : "—"}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Competência anterior"
            onClick={() => onTrocarCompetencia(chaveCompetencia(somarMeses(competencia, -1)))}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-white text-muted-foreground transition-colors hover:border-california-red/50 hover:text-california-red"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[150px] text-center text-[15px] font-semibold">
            {rotuloCompetencia(competencia)}
          </span>
          <button
            type="button"
            aria-label="Próxima competência"
            onClick={() => onTrocarCompetencia(chaveCompetencia(somarMeses(competencia, 1)))}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-white text-muted-foreground transition-colors hover:border-california-red/50 hover:text-california-red"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <CalendarioDeFaturas
            faturas={tela.faturas}
            competencia={tela.competencia}
            onEscolher={onTrocarCompetencia}
          />
        </div>

        {fatura ? (
          <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono font-semibold text-[#b3323c]">{fatura.codigo}</span>
            <ChipStatus status={fatura.status} />
            {fatura.status === "aberta" && (
              <span>
                fecha {formatDate(fatura.competencia_fechamento)} · vence{" "}
                {formatDate(fatura.data_vencimento)}
              </span>
            )}
            {fatura.status === "fechada" && (
              <span>
                vence {formatDate(fatura.data_vencimento)} · aguardando baixa em Títulos a
                Pagar
              </span>
            )}
            {fatura.status === "paga" && (
              <span>
                paga em {extrato?.pagamento ? formatDate(extrato.pagamento.data) : "—"}
                {extrato?.pagamento?.conta_nome ? ` · ${extrato.pagamento.conta_nome}` : ""}
              </span>
            )}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">sem fatura nesta competência</span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {lancarPagamento}
          {fatura ? (
            <a
              href={`/api/financeiro/cartao/faturas/${fatura.id}/export`}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-california-red hover:text-california-red"
            >
              <Download className="h-3.5 w-3.5" />
              Exportar
            </a>
          ) : (
            <span className="inline-flex cursor-not-allowed items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground/60">
              <Download className="h-3.5 w-3.5" />
              Exportar
            </span>
          )}
          {faturaDoCartao?.status === "aberta" && (
            <button
              type="button"
              onClick={() => setFechando(faturaDoCartao)}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-california-red bg-white px-3 py-2 text-xs font-semibold text-california-red transition-colors hover:bg-california-red/[0.06]"
            >
              <CreditCard className="h-3.5 w-3.5" />
              Fechar fatura
            </button>
          )}
          {faturaDoCartao?.status === "fechada" && (
            <button
              type="button"
              onClick={() => setReabrindo(faturaDoCartao)}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-california-red hover:text-california-red"
            >
              <Unlock className="h-3.5 w-3.5" />
              Reabrir fatura
            </button>
          )}
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Números e tabela                                                   */}
      {/* ---------------------------------------------------------------- */}
      {!extrato || !kpis ? (
        <div className="rounded-2xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {cartao ? cartao.nome : "Este cartão"} não tem fatura de{" "}
            <span className="font-semibold text-foreground">{rotuloCurto(competencia)}</span>.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            A fatura nasce com o primeiro pagamento confirmado no cartão para essa
            competência. Use as setas ou o calendário para ver as outras.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Compras no período" valor={kpis.compras} />
            <Kpi label="Estornos" valor={kpis.estornos} tone="entrada" />
            <Kpi
              label="Ajustes do fechamento"
              valor={kpis.ajustes}
              rodape={
                kpis.pendentes !== 0
                  ? `+ ${formatCurrency(kpis.pendentes)} que entram no fechamento`
                  : undefined
              }
            />
            <Kpi
              label="Total da fatura"
              valor={kpis.total}
              tone="saida"
              rodape={
                fatura?.status !== "aberta" && fatura?.valor_cobrado !== null
                  ? `cobrado pelo banco: ${formatCurrency(fatura?.valor_cobrado ?? 0)}`
                  : undefined
              }
            />
          </div>

          <FaturaExtrato
            itens={extrato.itens}
            titulosPorChave={titulosPorChave}
            onVerBaixa={(t) => {
              setErroAcao(null);
              setConferindo(t);
            }}
            onEstornarCompra={(t) =>
              setEstornando({
                // A cabeça, nunca a parcela.
                id: t.compra_id,
                codigo: t.origem_label,
                descricao:
                  t.parcela_total > 1
                    ? `${t.descricao} (compra em ${t.parcela_total}x)`
                    : t.descricao,
                valor: t.compra_total,
                estornado: t.estornado,
              })
            }
          />
        </>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Diálogos                                                           */}
      {/* ---------------------------------------------------------------- */}
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
                subtipoNome: conferindo.subtipo_nome,
                dataPagamento: conferindo.data_pagamento,
                vencOriginal: conferindo.venc_original,
                viaCartao: conferindo.forma_pagamento === "cartao_credito",
              } as BaixaRegistradaAlvo)
            : null
        }
        pending={pendingAcao}
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
              `Baixa estornada · ${formatCurrency(alvo.valor)} saiu da fatura e voltou para "A pagar".`,
            );
            router.refresh();
          });
        }}
      />

      <EstornarCompraDialog
        compra={estornando}
        onOpenChange={(aberto) => !aberto && setEstornando(null)}
        onSucesso={setToast}
      />

      <FecharFaturaDialog
        fatura={fechando}
        cartaoNome={cartao?.nome ?? "Cartão"}
        tipos={tipos}
        subtipos={subtipos}
        regionais={regionais}
        onOpenChange={(aberto) => !aberto && setFechando(null)}
      />

      <ReabrirFaturaDialog
        fatura={reabrindo}
        onOpenChange={(aberto) => !aberto && setReabrindo(null)}
        onSucesso={setToast}
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

/**
 * O calendário de faturas: um ano por vez, doze meses, o valor da fatura
 * em cada mês que tem uma. Salta direto para a competência escolhida —
 * inclusive uma sem fatura, que abre vazia.
 */
function CalendarioDeFaturas({
  faturas,
  competencia,
  onEscolher,
}: {
  faturas: FaturaTela["faturas"];
  competencia: string;
  onEscolher: (competencia: string) => void;
}) {
  const atual = lerCompetencia(competencia)!;
  const [ano, setAno] = React.useState(atual.ano);
  const [aberto, setAberto] = React.useState(false);

  React.useEffect(() => {
    setAno(atual.ano);
  }, [atual.ano]);

  const porChave = new Map(faturas.map((f) => [f.competencia, f]));

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-california-red/50 hover:text-california-red"
        >
          <CalendarDays className="h-3.5 w-3.5" />
          Faturas
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[330px] p-0">
        <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-2">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
            Faturas
          </span>
          <span className="inline-flex items-center gap-2 text-xs">
            <button
              type="button"
              aria-label="Ano anterior"
              onClick={() => setAno((a) => a - 1)}
              className="rounded px-1 text-muted-foreground hover:text-foreground"
            >
              ‹
            </button>
            <span className="font-mono font-semibold">{ano}</span>
            <button
              type="button"
              aria-label="Próximo ano"
              onClick={() => setAno((a) => a + 1)}
              className="rounded px-1 text-muted-foreground hover:text-foreground"
            >
              ›
            </button>
          </span>
        </div>
        <div className="grid grid-cols-4 gap-1.5 p-3">
          {MESES_CURTOS_LISTA.map((nome, i) => {
            const chave = chaveCompetencia({ ano, mes: i + 1 });
            const f = porChave.get(chave);
            const on = chave === competencia;
            return (
              <button
                key={chave}
                type="button"
                onClick={() => {
                  setAberto(false);
                  onEscolher(chave);
                }}
                title={f ? `${f.codigo} · ${f.status}` : "Sem fatura"}
                className={cn(
                  "rounded-lg border px-1 py-1.5 text-center text-[11.5px] transition-colors",
                  on
                    ? "border-california-red bg-california-red font-semibold text-white"
                    : f
                      ? "border-border bg-white hover:border-california-red/50"
                      : "border-border/60 bg-muted/30 text-muted-foreground/60 hover:border-border",
                )}
              >
                {nome}
                <span
                  className={cn(
                    "block font-mono text-[10px]",
                    on ? "text-white/85" : "text-muted-foreground",
                  )}
                >
                  {f ? formatCompacto(f.total) : " "}
                </span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Kpi({
  label,
  valor,
  tone,
  rodape,
}: {
  label: string;
  valor: number;
  tone?: "entrada" | "saida";
  rodape?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 font-mono text-lg font-semibold",
          tone === "entrada" && "text-emerald-700",
          tone === "saida" && "text-california-red",
        )}
      >
        {formatCurrency(valor)}
      </p>
      {rodape && <p className="mt-1 text-[11px] text-muted-foreground">{rodape}</p>}
    </div>
  );
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** "3.480" — o valor sem centavos, para caber na célula do calendário. */
function formatCompacto(n: number): string {
  return Math.round(n).toLocaleString("pt-BR");
}
