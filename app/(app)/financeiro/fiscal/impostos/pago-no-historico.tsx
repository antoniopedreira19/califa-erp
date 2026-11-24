"use client";

/**
 * Paga no histórico (decisão 277, entrega 3, opção A aprovada pelo Tiago em
 * 23/11/2026): a guia paga fora do sistema, com o pagamento já no histórico
 * da planilha — que é por onde o DRE e o fluxo de caixa contam. O imposto sai
 * de A pagar sem lançamento nenhum (dar baixa contaria a saída duas vezes);
 * guarda a data e a conta, e o DARF e o comprovante são opcionais.
 *
 * - `PagoNoHistoricoDialog`: o diálogo da aba Impostos a Pagar.
 * - `CamposDoPagoNoHistorico`: data, conta e a conferência, para outro
 *   diálogo embutir (a Guia da contabilidade, na Apuração).
 * - `ConferenciaDoHistorico`: as linhas de imposto do histórico na conta e
 *   no dia, agrupadas pela descrição, com o grupo que soma o valor da guia.
 */

import * as React from "react";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle2, History } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { CampoAnexo, useCampoDeAnexo } from "@/components/financeiro/anexo-de-imposto";
import type { GrupoDoHistorico } from "@/lib/fiscal/pago-no-historico";
import { linhasDoHistoricoNoDia, marcarImpostoPagoNoHistorico } from "./actions";
import type { ContaDaBaixaDeImposto, ImpostoDaLista } from "./dados";
import { Erro, Resumo, br, hojeIso, moeda } from "./dialogos";

/** A conta sugerida: a única conta ativa da PJ da guia; mais de uma, nenhuma. */
export function contaSugerida(contas: ContaDaBaixaDeImposto[], pjId: string): string {
  const daPJ = contas.filter((c) => c.empresa_contabil_id === pjId);
  return daPJ.length === 1 ? daPJ[0].id : "";
}

/** A data sugerida: o vencimento, se já passou; senão, hoje. */
export function dataSugerida(vencimento: string): string {
  const hoje = hojeIso();
  return vencimento <= hoje ? vencimento : hoje;
}

// ---------------------------------------------------------------------------
// A conferência
// ---------------------------------------------------------------------------

export function ConferenciaDoHistorico({
  contaId,
  contaNome,
  data,
  valor,
}: {
  contaId: string;
  contaNome: string | null;
  data: string;
  valor: number;
}) {
  const [estado, setEstado] = React.useState<
    { tipo: "vazio" } | { tipo: "lendo" } | { tipo: "erro"; mensagem: string } | { tipo: "pronto"; grupos: GrupoDoHistorico[] }
  >({ tipo: "vazio" });

  React.useEffect(() => {
    if (!contaId || !data || !(valor > 0)) {
      setEstado({ tipo: "vazio" });
      return;
    }
    let vivo = true;
    setEstado({ tipo: "lendo" });
    linhasDoHistoricoNoDia({ conta_bancaria_id: contaId, data, valor })
      .catch(() => ({ ok: false as const, message: "Não foi possível ler o histórico da planilha." }))
      .then((res) => {
        if (!vivo) return;
        setEstado(res.ok ? { tipo: "pronto", grupos: res.grupos } : { tipo: "erro", mensagem: res.message });
      });
    return () => {
      vivo = false;
    };
  }, [contaId, data, valor]);

  if (estado.tipo === "vazio") {
    return (
      <p className="rounded-xl border border-dashed border-border px-3.5 py-2.5 text-[12px] text-muted-foreground">
        Escolha a data e a conta para conferir o pagamento no histórico da planilha.
      </p>
    );
  }
  if (estado.tipo === "lendo") {
    return <p className="rounded-xl border border-border px-3.5 py-2.5 text-[12px] text-muted-foreground">Lendo o histórico...</p>;
  }
  if (estado.tipo === "erro") {
    return <p className="rounded-xl border border-border px-3.5 py-2.5 text-[12px] text-california-red">{estado.mensagem}</p>;
  }

  const { grupos } = estado;
  if (grupos.length === 0) {
    return (
      <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
        <span>
          Nenhuma linha de imposto no histórico da planilha {contaNome ? `em ${contaNome} ` : ""}em {br(data)}. Confira a data e
          a conta: se o pagamento não estiver no histórico, marcar como paga tira a saída do DRE e do fluxo de caixa. Nesse
          caso, dê baixa.
        </span>
      </div>
    );
  }
  const bate = grupos.some((g) => g.bate);
  const mostrados = grupos.slice(0, 8);
  return (
    <div className="rounded-xl border border-border">
      <p className="border-b border-border px-3 py-2 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
        No histórico da planilha{contaNome ? ` · ${contaNome}` : ""} · {br(data)}
      </p>
      <table className="w-full table-fixed text-[12px]">
        <colgroup>
          <col />
          <col style={{ width: "26%" }} />
          <col style={{ width: "22%" }} />
        </colgroup>
        <tbody>
          {mostrados.map((g) => (
            <tr
              key={g.descricao}
              className={cn("border-b border-border/70 last:border-0", g.bate && "bg-emerald-50")}
            >
              <td className="px-3 py-1.5">
                <span className="line-clamp-2 break-words" title={g.descricao}>
                  {g.descricao}
                </span>
              </td>
              <td className="px-2 py-1.5 text-[11px] text-muted-foreground">
                <span className="line-clamp-2" title={g.tipos.join(", ")}>
                  {g.linhas} {g.linhas === 1 ? "linha" : "linhas"}
                  {g.tipos.length ? ` · ${g.tipos.join(", ")}` : ""}
                </span>
              </td>
              <td className="px-3 py-1.5 text-right font-mono">
                {moeda(g.total)}
                {g.bate && (
                  <span className="mt-0.5 flex items-center justify-end gap-1 font-sans text-[10.5px] font-semibold text-emerald-700">
                    <CheckCircle2 className="h-3 w-3" />
                    bate com a guia
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {grupos.length > mostrados.length && (
        <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          e mais {grupos.length - mostrados.length} {grupos.length - mostrados.length === 1 ? "grupo" : "grupos"} de imposto
          neste dia.
        </p>
      )}
      {!bate && (
        <p className="flex items-start gap-1.5 border-t border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
          Nenhum grupo soma {moeda(valor)}. Confira com a planilha antes de marcar.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data, conta e conferência (embutidos em outro diálogo)
// ---------------------------------------------------------------------------

export function CamposDoPagoNoHistorico({
  contas,
  pjId,
  pjNome,
  nomesDasPJs,
  valor,
  data,
  onData,
  conta,
  onConta,
  faltando,
}: {
  contas: ContaDaBaixaDeImposto[];
  pjId: string | null;
  pjNome: string | null;
  nomesDasPJs: Record<string, string>;
  valor: number;
  data: string;
  onData: (d: string) => void;
  conta: string;
  onConta: (c: string) => void;
  faltando?: Set<string>;
}) {
  const escolhida = contas.find((c) => c.id === conta) ?? null;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 items-start gap-3">
        <div className="space-y-1">
          <label className="text-xs font-semibold">
            Data do pagamento <span className="text-california-red">*</span>
          </label>
          <DatePicker
            name="pago_em_historico"
            defaultValue={data}
            onDateChange={(d) => onData(d ? format(d, "yyyy-MM-dd") : "")}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold">
            Conta que pagou <span className="text-california-red">*</span>
          </label>
          <Select value={conta || undefined} onValueChange={onConta}>
            <SelectTrigger className={cn(faltando?.has("conta") && !escolhida && "border-california-red")}>
              <SelectValue placeholder="Selecione a conta..." />
            </SelectTrigger>
            <SelectContent>
              {contas.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">Nenhuma conta bancária ativa.</div>
              ) : (
                contas.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nome} · {c.banco}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          {escolhida && pjId && escolhida.empresa_contabil_id !== pjId && (
            <p className="flex items-center gap-1 text-[11px] font-medium text-amber-700">
              <AlertTriangle className="h-3 w-3 flex-none" />
              A guia é da {pjNome ?? "outra empresa"} e a conta é da {nomesDasPJs[escolhida.empresa_contabil_id] ?? "outra empresa"}.
            </p>
          )}
        </div>
      </div>
      <ConferenciaDoHistorico contaId={conta} contaNome={escolhida?.nome ?? null} data={data} valor={valor} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// O diálogo da aba Impostos a Pagar
// ---------------------------------------------------------------------------

export function PagoNoHistoricoDialog({
  imposto: t,
  contas,
  nomesDasPJs,
  tenantId,
  onClose,
  onFeito,
}: {
  imposto: ImpostoDaLista;
  contas: ContaDaBaixaDeImposto[];
  nomesDasPJs: Record<string, string>;
  tenantId: string;
  onClose: () => void;
  onFeito: (mensagem: string) => void;
}) {
  const [pending, startTransition] = React.useTransition();
  const [data, setData] = React.useState(() => dataSugerida(t.vencimento));
  const [conta, setConta] = React.useState(() => contaSugerida(contas, t.empresa_contabil_id));
  const guia = useCampoDeAnexo(t.guia_path);
  const comprovante = useCampoDeAnexo(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [faltando, setFaltando] = React.useState<Set<string>>(new Set());

  function fechar() {
    if (pending) return;
    guia.descartarEnviados();
    comprovante.descartarEnviados();
    onClose();
  }

  function confirmar() {
    const falta = new Set<string>();
    if (!data) falta.add("data");
    if (!conta) falta.add("conta");
    setFaltando(falta);
    if (falta.has("data")) return setErro("Informe a data do pagamento.");
    if (falta.has("conta")) return setErro("Selecione a conta que pagou a guia.");
    if (data > hojeIso()) return setErro("A data do pagamento no histórico não pode ser depois de hoje.");
    setErro(null);
    const nomeDaConta = contas.find((c) => c.id === conta)?.nome ?? "";
    startTransition(async () => {
      const res = await marcarImpostoPagoNoHistorico({
        imposto_id: t.id,
        pago_em: data,
        conta_bancaria_id: conta,
        guia_path: guia.path === t.guia_path ? null : guia.path,
        comprovante_path: comprovante.path,
        valor_confirmado: t.valor,
      }).catch(() => ({ ok: false as const, message: "Não foi possível marcar como paga. Tente novamente." }));
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      guia.confirmar();
      comprovante.confirmar();
      onFeito(
        `Paga no histórico: ${moeda(t.valor)} em ${br(data)}, ${nomeDaConta}. Nenhum lançamento foi criado; o pagamento conta pelo histórico da planilha.`,
      );
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-california-red" />
            Marcar como paga no histórico
          </DialogTitle>
          <DialogDescription className="sr-only">
            A guia paga fora do sistema, com o pagamento no histórico da planilha: data, conta e, se houver, a guia e o
            comprovante.
          </DialogDescription>
        </DialogHeader>
        <Resumo t={t} />
        <p className="rounded-xl border border-border bg-muted/40 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
          Para a guia paga fora do sistema, que já está no histórico da planilha: é por lá que o DRE e o fluxo de caixa contam
          o pagamento. O imposto sai de A pagar e <b className="text-foreground">nenhum lançamento é criado</b> (dar baixa
          contaria a saída duas vezes).
        </p>
        {erro && <Erro>{erro}</Erro>}
        <div className="space-y-3">
          <CamposDoPagoNoHistorico
            contas={contas}
            pjId={t.empresa_contabil_id}
            pjNome={t.pj}
            nomesDasPJs={nomesDasPJs}
            valor={t.valor}
            data={data}
            onData={(d) => {
              setData(d);
              setErro(null);
            }}
            conta={conta}
            onConta={(c) => {
              setConta(c);
              setErro(null);
            }}
            faltando={faltando}
          />
          <div className="grid grid-cols-2 gap-3">
            <CampoAnexo
              rotulo="Guia (opcional)"
              path={guia.path}
              onChange={guia.trocar}
              tenantId={tenantId}
              pasta="guias"
              dica={t.guia_path && guia.path === t.guia_path ? "Anexada na aprovação." : undefined}
              aceita="PDF"
            />
            <CampoAnexo
              rotulo="Comprovante (opcional)"
              path={comprovante.path}
              onChange={comprovante.trocar}
              tenantId={tenantId}
              pasta="comprovantes"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={fechar}
            disabled={pending}
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-50"
          >
            <History className="h-4 w-4" />
            {pending ? "Marcando..." : "Marcar como paga no histórico"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
