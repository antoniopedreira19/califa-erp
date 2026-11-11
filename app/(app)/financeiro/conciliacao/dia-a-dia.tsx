"use client";

/**
 * A Conciliação automática dia a dia (decisão 253).
 *
 * A fila única da conta virou um dia por vez: a barra de dias (com o que
 * falta em cada um e o cadeado de fechar no dia sem pendências), o resumo do
 * dia e a tabela com as linhas do banco na ordem do extrato
 * (`dia-a-dia-tabela.tsx`). O fechamento é o de sempre (decisão 205): fechar
 * o dia D é fechar a conciliação até D.
 */

import * as React from "react";
import { CheckCheck, ChevronLeft, ChevronRight, Lock, Unlock } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { diasDaConta, motivoDeNaoFechar, type DiaDaConta } from "@/lib/conciliacao/dia-a-dia";
import { InfoDica, LinhaDeAvisos, LinhaDoArquivo, linhasComMutuo, type PropsDaFila } from "./fila-da-conta";
import { itensDoSistema, TabelaDeComposicoes, type AcoesDoDia } from "./dia-a-dia-tabela";
import { conciliarMisto } from "./actions-dia-a-dia";
import { fecharConciliacao } from "./actions-fechamento";
import { repactuarDataPagamento } from "../contas-a-pagar/actions-titulos";
import { repactuarPrevisaoRecebimento } from "../contas-a-receber/actions";

const moeda = formatBRL;
const r2 = (n: number) => Math.round(n * 100) / 100;
const ddmm = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");
const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const diaDaSemana = (iso: string) => SEMANA[new Date(iso + "T12:00:00Z").getUTCDay()];
const comSinal = (v: number) => (Math.round(v * 100) === 0 ? moeda(0) : `${v < 0 ? "− " : "+ "}${moeda(Math.abs(v))}`);

export function ConciliacaoDiaADia(p: PropsDaFila) {
  const { pending, rodar } = p;
  const conta = p.banco.conta.id;
  const resultados = React.useMemo(() => linhasComMutuo(p.secoes, p.conciliacao.resultados), [p.secoes, p.conciliacao.resultados]);
  const doSistema = React.useMemo(() => itensDoSistema(p), [p.conciliacao, p.banco, p.contexto]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Os dias ----
  // O último dia completo do extrato (o que o fechamento aceita): o que vem
  // depois dele está em andamento.
  const completoAte = p.condicoes?.ate ?? null;
  const dias = React.useMemo(() => {
    const entradas = [
      ...resultados.map((r) => ({ data: r.mov.data, linha: true, pendente: !r.resolvido })),
      // A baixa e a linha da planilha já realizadas que o banco não mostra
      // travam o dia; o título em aberto e a previsão, não.
      ...doSistema
        .filter((c) => !c.daLinha && (c.k === "baixa" || (c.k === "planilha" && !c.previsao)))
        .map((c) => ({ data: c.data, linha: false, pendente: true })),
    ];
    return diasDaConta(entradas, p.fechadaAte, completoAte);
  }, [resultados, doSistema, p.fechadaAte, completoAte]);
  const primeiroAberto = dias.find((d) => d.estado !== "fechado")?.data ?? dias[dias.length - 1]?.data ?? null;
  const [dia, setDia] = React.useState<string | null>(primeiroAberto);
  React.useEffect(() => setDia(primeiroAberto), [conta]); // eslint-disable-line react-hooks/exhaustive-deps
  // O dia escolhido saiu da lista (fechou): vai ao primeiro aberto.
  React.useEffect(() => {
    if (dia && !dias.some((d) => d.data === dia)) setDia(primeiroAberto);
  }, [dias, dia, primeiroAberto]);
  const atual = dias.find((d) => d.data === dia) ?? null;

  // ---- O resumo do dia ----
  const linhasDoDia = resultados.filter((r) => !dia || r.mov.data === dia);
  const semLinhaDoDia = doSistema.filter((c) => !c.daLinha && c.k === "baixa" && (!dia || c.data === dia));
  const noBanco = r2(linhasDoDia.filter((r) => r.resolvido?.estado !== "ignorado").reduce((s, r) => s + r.mov.valor, 0));
  const noSistema = r2(linhasDoDia.filter((r) => r.resolvido?.estado === "conciliado").reduce((s, r) => s + r.mov.valor, 0) + semLinhaDoDia.reduce((s, c) => s + c.valor, 0));
  const diferenca = r2(noBanco - noSistema);
  const resolvidas = linhasDoDia.filter((r) => r.resolvido).length;

  const fecharDia = (data: string) => {
    const seguinte = dias.find((d) => d.data > data)?.data ?? null;
    rodar(
      async () => {
        const res = await fecharConciliacao(conta, data);
        return res.ok ? { ok: true, mensagem: `Dia ${ddmm(data)} fechado: nada com data até ele muda sem reabrir.` } : res;
      },
      () => seguinte && setDia(seguinte),
    );
  };

  // ---- O que a tabela pede ao servidor ----
  const servidor: AcoesDoDia = React.useMemo(
    () => ({
      conciliarMisto: (linhaId, lancamentoIds, itens) => rodar(() => conciliarMisto({ linhaId, lancamentoIds, itens })),
      mudarDataDoTitulo: (l, data) =>
        rodar(async () => {
          if (l.lado === "receber") {
            const res = await repactuarPrevisaoRecebimento({ titulo_id: l.t.id, data_previsao_recebimento: data });
            return res.ok ? { ok: true, mensagem: `Previsão de recebimento alterada para ${ddmm(data)}.` } : { ok: false, message: res.message };
          }
          if (l.lado !== "pagar") return { ok: false, message: "A data deste título não muda por aqui." };
          const res = await repactuarDataPagamento({ origem: l.t.origem, id: l.t.id, data_pagamento: data });
          return res.ok ? { ok: true, mensagem: `Data prevista de pagamento alterada para ${ddmm(data)}.` } : { ok: false, message: res.message };
        }),
    }),
    [rodar],
  );

  return (
    <>
      <LinhaDoArquivo banco={p.banco} importar={p.importar} />
      <LinhaDeAvisos {...p} />

      <BarraDeDias dias={dias} dia={dia} setDia={setDia} fechadaAte={p.fechadaAte} onFechar={fecharDia} ocupado={pending} />

      {/* ---- O resumo do dia ---- */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl border border-border bg-card px-4 py-3">
        <div className="flex min-w-[150px] flex-col">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{dia ? "Dia" : "Período"}</span>
          <span className="text-base font-semibold">{dia ? `${diaDaSemana(dia)}, ${ddmm(dia)}` : "Todos os dias em aberto"}</span>
        </div>
        <Bloco rotulo="No banco" valor={comSinal(noBanco)} dica="A soma das linhas do banco neste dia." />
        <Bloco rotulo="No sistema" valor={comSinal(noSistema)} dica="A soma do que o sistema tem neste dia: o que já foi conciliado e as baixas ainda sem linha." />
        <Bloco
          rotulo="Diferença"
          valor={diferenca === 0 ? "Bate ✓" : moeda(Math.abs(diferenca))}
          cor={diferenca === 0 ? "text-emerald-700" : "text-california-red"}
          dica="Some quando cada linha do banco do dia tiver o seu lançamento, e cada baixa do dia a sua linha."
        />
        <div className="flex min-w-[190px] flex-col gap-1.5">
          <span className="text-xs font-semibold">
            <span className="font-mono">{resolvidas}</span> de <span className="font-mono">{linhasDoDia.length}</span> linhas conciliadas
          </span>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${linhasDoDia.length ? Math.round((resolvidas / linhasDoDia.length) * 100) : 0}%` }} />
          </div>
        </div>
        {pending && <span className="ml-auto text-xs font-semibold text-muted-foreground">Trabalhando…</span>}
      </div>

      {dia && atual?.estado === "pronto" && !motivoDeNaoFechar(dias, dia) && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <CheckCheck className="h-5 w-5 text-emerald-700" />
          <span className="flex-1">
            <strong>Tudo conciliado em {ddmm(dia)}.</strong> Confira os conciliados e feche o dia pelo cadeado dele, na barra de dias: depois de fechado, nada com essa data muda sem reabrir.
          </span>
        </div>
      )}

      <TabelaDeComposicoes p={p} dia={dia} itensDoSistema={doSistema} saldoBase={p.condicoes?.ate && typeof p.condicoes.saldo_banco === "number" ? { ate: p.condicoes.ate, saldo: p.condicoes.saldo_banco } : null} servidor={servidor} avisar={p.avisar} />

    </>
  );
}

// ---------------------------------------------------------------------------
// Peças
// ---------------------------------------------------------------------------

function Bloco({ rotulo, valor, cor, dica }: { rotulo: string; valor: string; cor?: string; dica: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
        {rotulo}
        <InfoDica texto={dica} />
      </span>
      <span className={cn("font-mono text-base font-semibold", cor)}>{valor}</span>
    </div>
  );
}

/** A barra de dias: um dia por vez, em ordem; o cadeado no lugar do número quando o dia não tem mais pendências. */
function BarraDeDias({
  dias,
  dia,
  setDia,
  fechadaAte,
  onFechar,
  ocupado,
}: {
  dias: DiaDaConta[];
  dia: string | null;
  setDia: (d: string | null) => void;
  fechadaAte: string | null;
  /** O cadeado de cada dia: fecha a conciliação até ele. */
  onFechar: (data: string) => void;
  ocupado: boolean;
}) {
  const k = dias.findIndex((d) => d.data === dia);
  const ir = (n: number) => {
    const alvo = dias[k + n];
    if (alvo) setDia(alvo.data);
  };
  const seta = "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-white text-muted-foreground hover:bg-muted disabled:opacity-40";
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
      {fechadaAte && (
        <span className="inline-flex h-9 items-center gap-2 rounded-lg bg-muted/60 px-3 text-xs font-semibold text-muted-foreground">
          <Lock className="h-3.5 w-3.5" />
          Fechado até {ddmm(fechadaAte)}
        </span>
      )}
      <button type="button" className={seta} disabled={k <= 0} onClick={() => ir(-1)} aria-label="Dia anterior">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
        {dias.map((d) => {
          const ativo = d.data === dia;
          const motivo = d.estado === "fechado" ? "Dia fechado" : motivoDeNaoFechar(dias, d.data);
          return (
            <div
              key={d.data}
              className={cn(
                "flex h-11 min-w-[104px] shrink-0 items-stretch rounded-lg border transition-colors",
                ativo ? "border-california-red bg-california-red/5" : "border-border bg-white hover:bg-muted/50",
                d.estado === "andamento" && !ativo && "border-dashed",
              )}
            >
              <button
                type="button"
                onClick={() => setDia(d.data)}
                aria-pressed={ativo}
                title={
                  d.estado === "fechado"
                    ? "Dia fechado"
                    : d.estado === "andamento"
                      ? "Em andamento: o extrato do dia ainda não está completo"
                      : d.estado === "pronto"
                        ? "Tudo conciliado: pronto para fechar"
                        : `${d.pendentes} ${d.pendentes === 1 ? "item" : "itens"} para resolver`
                }
                className={cn("flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg pl-3 text-left", d.estado !== "fechado" && d.pendentes > 0 ? "pr-3" : "pr-1")}
              >
                <span className="flex flex-col leading-tight">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{diaDaSemana(d.data)}</span>
                  <span className={cn("font-mono text-[13px] font-semibold", ativo && "text-california-red")}>{ddmm(d.data)}</span>
                </span>
                {/* Com pendências, só o número; o cadeado toma o lugar dele quando zera. */}
                {d.estado !== "fechado" && d.pendentes > 0 && (
                  <span className={cn("rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums", d.estado === "andamento" ? "bg-muted text-muted-foreground" : "bg-amber-100 text-amber-800")}>{d.pendentes}</span>
                )}
              </button>
              {d.estado === "fechado" ? (
                <span title="Dia fechado" className="flex w-9 items-center justify-center pr-1 text-muted-foreground">
                  <Lock className="h-3.5 w-3.5" />
                </span>
              ) : d.pendentes === 0 ? (
                <span className="flex items-center pr-2">
                  <button
                    type="button"
                    disabled={!!motivo || ocupado}
                    onClick={() => onFechar(d.data)}
                    title={motivo ?? `Fechar o dia ${ddmm(d.data)}: nada com data até ele muda sem reabrir.`}
                    aria-label={`Fechar o dia ${ddmm(d.data)}`}
                    className={cn(
                      "inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed",
                      motivo ? "text-muted-foreground/50" : "border border-border bg-white text-foreground hover:border-foreground/40 hover:bg-muted",
                    )}
                  >
                    {motivo ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                  </button>
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      <button type="button" className={seta} disabled={k < 0 || k >= dias.length - 1} onClick={() => ir(1)} aria-label="Próximo dia">
        <ChevronRight className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => setDia(null)}
        aria-pressed={dia === null}
        className={cn("inline-flex h-9 shrink-0 items-center rounded-lg border px-3 text-xs font-semibold", dia === null ? "border-california-red bg-california-red/5 text-california-red" : "border-border bg-white text-muted-foreground hover:bg-muted/50")}
      >
        Todos os dias
      </button>
    </div>
  );
}
