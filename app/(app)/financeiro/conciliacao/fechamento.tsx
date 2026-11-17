"use client";

/**
 * O fechamento da conciliação na tela (task 029, fase 4, decisão 205; por mês
 * desde a decisão 262, D10):
 *
 * - no Extrato e nos Títulos, a faixa "Os meses" no topo: os meses fechados
 *   (os 3 últimos, com cadeado), cada mês aberto até o de hoje (o reaberto
 *   em amarelo, com o motivo na dica) e "Reabrir <mês>" (ou "Fechar <mês> de
 *   novo", com a conta toda aberta);
 * - na Conciliação automática, a faixa sai: os meses fechados e o "Reabrir"
 *   ficam no começo da linha dos meses (`FechadosNaLinha`, montado pelo dia
 *   a dia), e o "Fechar <mês>" fica em cada mês aberto de lá;
 * - reabrir é mês a mês e pede o motivo, com pelo menos 10 caracteres: o mês
 *   anterior continua fechado se já tinha sido fechado alguma vez
 *   (`reabrir_mes_da_conciliacao`).
 *
 * As condições e a trava são do banco; a tela só mostra e chama.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCheck, Lock, Unlock } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDiaBr } from "@/lib/formatar-data-hora";
import { hojeEmSaoPauloIso } from "@/lib/calculos/janelas-pagamento";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { dataBR } from "@/components/financeiro/planilha-de-titulos/planilha";
import {
  continuaFechadoAoReabrir,
  diaMes,
  ehFimDoMes,
  fimDoMesAnterior,
  maiuscula,
  mesesDoFechamento,
  nomeDoMes,
  quemFechouOMes,
  reaberturaDoMes,
  textoDoRegistro,
  type FechamentoDaConta,
  type RegistroDoFechamento,
} from "@/lib/conciliacao/fechamento";
import { fecharConciliacao, reabrirMesDaConciliacao } from "./actions-fechamento";
import { InfoDica } from "./fila-da-conta";

type Aviso = { tom: "ok" | "erro"; texto: string };

/** "outubro"; o fechamento de antes do fechamento por mês, "o período até 19/10". */
const oMes = (ate: string) => (ehFimDoMes(ate) ? nomeDoMes(ate) : `o período até ${diaMes(ate)}`);
const semPontoFinal = (t: string | null) => String(t ?? "").replace(/[.\s]+$/, "");

/** Fechar e reabrir, com o aviso do resultado e a página relida. */
function useAcoesDoFechamento(contaId: string, contaNome: string) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [aviso, setAviso] = React.useState<Aviso | null>(null);

  React.useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 7000);
    return () => clearTimeout(t);
  }, [aviso]);

  function fechar(ate: string) {
    setAviso(null);
    startTransition(async () => {
      const r = await fecharConciliacao(contaId, ate);
      setAviso(
        r.ok
          ? {
              tom: "ok",
              texto: `${ehFimDoMes(ate) ? `${maiuscula(nomeDoMes(ate))} fechado` : `Conciliação fechada até ${dataBR(ate)}`} na ${contaNome}. Lançamento até ${dataBR(ate)} só muda reabrindo o mês.`,
            }
          : { tom: "erro", texto: r.message },
      );
      router.refresh();
    });
  }

  /** `depois` recebe a mensagem de erro, ou `null` quando reabriu. */
  function reabrir(motivo: string, ate: string, depois: (erro: string | null) => void) {
    startTransition(async () => {
      const r = await reabrirMesDaConciliacao(contaId, motivo);
      if (!r.ok) {
        depois(r.message);
        return;
      }
      depois(null);
      setAviso({
        tom: "ok",
        texto: `${maiuscula(oMes(ate))} reaberto${r.continuaFechadaAte ? `; ${nomeDoMes(r.continuaFechadaAte)} continua fechado` : ""}. O motivo ficou na auditoria.`,
      });
      router.refresh();
    });
  }

  const avisoNaTela = aviso && (
    <div
      role="status"
      className={cn(
        "fixed bottom-6 right-6 z-50 flex max-w-[600px] items-center gap-3 rounded-xl border px-4 py-3 shadow-elevated",
        aviso.tom === "ok" ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50",
      )}
    >
      {aviso.tom === "ok" ? (
        <CheckCheck className="h-4 w-4 shrink-0 text-emerald-700" />
      ) : (
        <AlertTriangle className="h-4 w-4 shrink-0 text-california-red" />
      )}
      <span className={cn("text-sm font-semibold", aviso.tom === "ok" ? "text-emerald-900" : "text-red-900")}>{aviso.texto}</span>
      <button
        type="button"
        onClick={() => setAviso(null)}
        aria-label="Fechar aviso"
        className={aviso.tom === "ok" ? "text-emerald-700 hover:text-emerald-900" : "text-california-red hover:text-red-900"}
      >
        ×
      </button>
    </div>
  );

  return { pending, fechar, reabrir, avisoNaTela };
}

/** O i do "Fechamento": o que o mês fechado trava e o histórico. */
function DetalheDoFechamento({ registros }: { registros: RegistroDoFechamento[] }) {
  return (
    <span className="block text-left text-xs normal-case">
      <span className="block">
        Mês fechado: o caixa desta conta até o fim dele não muda (o Extrato e o DFC). Baixa, cancelamento, estorno e troca de data ou de centro de custo pedem
        reabrir o mês. O DRE, por competência, tem fechamento próprio.
      </span>
      <span className="mt-1.5 block">Reabrir é mês a mês: o mês anterior continua fechado.</span>
      {registros.length > 0 && <span className="mt-2 block font-semibold">Histórico</span>}
      {[...registros].reverse().map((r) => (
        <span key={r.id} className="block">
          {textoDoRegistro(r)}
        </span>
      ))}
    </span>
  );
}

/** A dica do mês fechado: quem fechou e quando (o registro do "Reabrir" do mês seguinte não conta). */
function dicaDoFechado(registros: RegistroDoFechamento[], fim: string) {
  const r = quemFechouOMes(registros, fim);
  return `${maiuscula(nomeDoMes(fim))} de ${fim.slice(0, 4)} fechado${r ? ` em ${formatDiaBr(r.fechadoEm)} por ${r.fechadoPor}` : ""}.`;
}

// ---------------------------------------------------------------------------
// A faixa "Os meses", no Extrato e nos Títulos
// ---------------------------------------------------------------------------

export function FaixaDoFechamento({
  contaId,
  contaNome,
  bancoNome,
  fechamento,
}: {
  contaId: string;
  contaNome: string;
  bancoNome: string;
  fechamento: FechamentoDaConta;
}) {
  const { pending, fechar, reabrir, avisoNaTela } = useAcoesDoFechamento(contaId, contaNome);
  const [reabrindo, setReabrindo] = React.useState(false);
  const ultimo = fechamento.ultimo;
  if (!ultimo) return null;
  const ativo = fechamento.ativo;
  const { fechados, maisAntigos, parcialAte, abertos } = mesesDoFechamento(fechamento, hojeEmSaoPauloIso());

  // Fechar de novo só o mês inteiro: o fechamento antigo, por dia, fecha pelo mês na Conciliação automática.
  const botao = ativo ? (
    <button
      type="button"
      disabled={pending}
      onClick={() => setReabrindo(true)}
      className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-california-red/40 bg-white px-3 text-xs font-semibold text-california-red hover:bg-california-red/5 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Unlock className="h-3.5 w-3.5" />
      Reabrir {oMes(ativo.ate)}
    </button>
  ) : !ehFimDoMes(ultimo.ate) ? null : (
    <button
      type="button"
      disabled={pending}
      onClick={() => fechar(ultimo.ate)}
      title="Fecha de novo, se as linhas até lá estiverem conciliadas e o saldo bater."
      className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg bg-[#282828] px-3 text-xs font-semibold text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Lock className="h-3.5 w-3.5" />
      Fechar {oMes(ultimo.ate)} de novo
    </button>
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-300 bg-slate-100 px-4 py-2 text-slate-800">
        <span className="mr-1 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
          Fechamento
          <InfoDica texto={<DetalheDoFechamento registros={fechamento.registros} />} largura={440} />
        </span>
        {maisAntigos && <span className="text-xs text-slate-500">…</span>}
        {fechados.map((m) => (
          <span
            key={m}
            title={dicaDoFechado(fechamento.registros, m)}
            className="inline-flex h-7 items-center gap-1.5 rounded-md bg-slate-300/70 px-2.5 text-xs font-semibold text-slate-700"
          >
            <Lock className="h-3 w-3" />
            {maiuscula(nomeDoMes(m))}
          </span>
        ))}
        {parcialAte && (
          <span className="inline-flex h-7 items-center gap-1.5 rounded-md bg-slate-300/70 px-2.5 text-xs font-semibold text-slate-700">
            <Lock className="h-3 w-3" />
            Até {diaMes(parcialAte)}
          </span>
        )}
        {abertos.map((m) => {
          const r = reaberturaDoMes(fechamento.registros, m);
          return (
            <span
              key={m}
              title={
                r
                  ? `${maiuscula(nomeDoMes(m))} reaberto em ${formatDiaBr(String(r.reabertoEm))}${r.reabertoPor ? ` por ${r.reabertoPor}` : ""}: “${semPontoFinal(r.motivo)}”. Feche de novo pela Conciliação automática.`
                  : `${maiuscula(nomeDoMes(m))} de ${m.slice(0, 4)} ainda aberto: fecha pela Conciliação automática quando todos os dias estiverem conciliados.`
              }
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold",
                r ? "border-amber-300 bg-amber-50 text-amber-900" : "border-dashed border-slate-300 bg-white text-slate-700",
              )}
            >
              {r ? <Unlock className="h-3 w-3" /> : null}
              {maiuscula(nomeDoMes(m))}
              <span className="font-normal text-slate-500">{r ? "reaberto" : "aberto"}</span>
            </span>
          );
        })}
        <span className="flex-1" />
        {botao}
      </div>
      {reabrindo && ativo && (
        <ReabrirDialog
          continuaFechado={continuaFechadoAoReabrir(fechamento)}
          ate={ativo.ate}
          contaNome={contaNome}
          bancoNome={bancoNome}
          pending={pending}
          onFechar={() => setReabrindo(false)}
          onConfirmar={(motivo, depois) => reabrir(motivo, ativo.ate, depois)}
        />
      )}
      {avisoNaTela}
    </>
  );
}

// ---------------------------------------------------------------------------
// Na Conciliação automática: os meses fechados e o Reabrir, na linha dos meses
// ---------------------------------------------------------------------------

/** Os meses fechados (cadeado, os 3 últimos) e o "Reabrir" do último, no começo da linha dos meses. */
export function FechadosNaLinha({
  contaId,
  contaNome,
  bancoNome,
  fechamento,
}: {
  contaId: string;
  contaNome: string;
  bancoNome: string;
  fechamento: FechamentoDaConta;
}) {
  const { pending, reabrir, avisoNaTela } = useAcoesDoFechamento(contaId, contaNome);
  const [reabrindo, setReabrindo] = React.useState(false);
  const ativo = fechamento.ativo;
  if (!ativo) return avisoNaTela || null;
  const { fechados, maisAntigos, parcialAte } = mesesDoFechamento(fechamento, hojeEmSaoPauloIso());
  const continua = continuaFechadoAoReabrir(fechamento);
  const chip = "inline-flex h-8 items-center gap-1.5 rounded-lg bg-muted px-3 text-xs font-semibold text-muted-foreground";
  return (
    <>
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className="mr-1 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Fechamento
          <InfoDica texto={<DetalheDoFechamento registros={fechamento.registros} />} largura={440} />
        </span>
        {maisAntigos && <span className="text-xs text-muted-foreground">…</span>}
        {fechados.map((m) => (
          <span key={m} className={chip} title={dicaDoFechado(fechamento.registros, m)}>
            <Lock className="h-3.5 w-3.5" />
            {maiuscula(nomeDoMes(m))}
          </span>
        ))}
        {parcialAte && (
          <span className={chip}>
            <Lock className="h-3.5 w-3.5" />
            Até {diaMes(parcialAte)}
          </span>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => setReabrindo(true)}
          title={`Reabre só ${oMes(ativo.ate)}: ${continua ? `${nomeDoMes(continua)} continua fechado` : "nenhum mês antes dele foi fechado, e a conta fica toda aberta"}. Pede o motivo.`}
          className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-california-red/40 bg-white px-3 text-xs font-semibold text-california-red hover:bg-california-red/5 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Unlock className="h-3.5 w-3.5" />
          Reabrir {oMes(ativo.ate)}
        </button>
      </span>
      {reabrindo && (
        <ReabrirDialog
          continuaFechado={continua}
          ate={ativo.ate}
          contaNome={contaNome}
          bancoNome={bancoNome}
          pending={pending}
          onFechar={() => setReabrindo(false)}
          onConfirmar={(motivo, depois) => reabrir(motivo, ativo.ate, depois)}
        />
      )}
      {avisoNaTela}
    </>
  );
}

/** Na linha dos meses, o mês aberto que já foi fechado e reaberto: "reaberto", com o motivo na dica. */
export function SeloReaberto({ fim, registros }: { fim: string; registros: RegistroDoFechamento[] }) {
  const r = reaberturaDoMes(registros, fim);
  if (!r) return null;
  return (
    <span
      title={`${maiuscula(nomeDoMes(fim))} reaberto em ${formatDiaBr(String(r.reabertoEm))}${r.reabertoPor ? ` por ${r.reabertoPor}` : ""}: “${semPontoFinal(r.motivo)}”.`}
      className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800"
    >
      reaberto
    </span>
  );
}

// ---------------------------------------------------------------------------
// Reabrir o mês
// ---------------------------------------------------------------------------

function ReabrirDialog({
  continuaFechado,
  ate,
  contaNome,
  bancoNome,
  pending,
  onFechar,
  onConfirmar,
}: {
  /** O mês anterior, que continua fechado; nulo, a conta fica toda aberta. */
  continuaFechado: string | null;
  ate: string;
  contaNome: string;
  bancoNome: string;
  pending: boolean;
  onFechar: () => void;
  onConfirmar: (motivo: string, depois: (erro: string | null) => void) => void;
}) {
  const [motivo, setMotivo] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);
  const mes = ehFimDoMes(ate);
  const desde = mes ? ate.slice(0, 8) + "01" : null;
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Unlock className="h-4 w-4 text-california-red" />
            Reabrir {oMes(ate)}
          </DialogTitle>
          <DialogDescription>
            {contaNome}
            {bancoNome ? ` · ${bancoNome}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] leading-relaxed text-amber-900">
          Os lançamentos desta conta {desde ? `de ${dataBR(desde)} a ${dataBR(ate)}` : `até ${dataBR(ate)}`} voltam a aceitar baixa, cancelamento, estorno e troca de
          data ou de centro de custo.{" "}
          {continuaFechado
            ? `${maiuscula(nomeDoMes(continuaFechado))} e os meses antes dele continuam fechados.`
            : `Nenhum mês antes ${mes ? "dele" : "disso"} foi fechado: a conta fica toda aberta.`}{" "}
          {maiuscula(oMes(ate))} precisa ser fechado de novo. A reabertura, com o motivo, fica registrada na auditoria.
        </div>
        <div className="space-y-1">
          <label htmlFor="reabrir-motivo" className="text-xs font-semibold">
            Motivo <span className="text-california-red">*</span>
          </label>
          <textarea
            id="reabrir-motivo"
            value={motivo}
            onChange={(e) => {
              setMotivo(e.target.value);
              setErro(null);
            }}
            rows={3}
            placeholder="Ex.: a baixa do frete de 19/10 foi feita na conta errada"
            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:border-california-red focus:outline-none"
          />
        </div>
        <DialogFooter className="items-center gap-2">
          {erro && <p className="mr-auto text-xs font-semibold text-california-red">{erro}</p>}
          <button
            type="button"
            onClick={onFechar}
            className="inline-flex items-center justify-center rounded-lg border border-border bg-white px-3.5 py-2 text-sm font-semibold text-foreground hover:bg-muted/50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (motivo.trim().length < 10) {
                setErro("Explique o motivo (pelo menos 10 caracteres).");
                return;
              }
              onConfirmar(motivo.trim(), (e) => {
                if (e) setErro(e);
                else onFechar();
              });
            }}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-california-red px-3.5 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Reabrindo…" : `Reabrir ${oMes(ate)}`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
