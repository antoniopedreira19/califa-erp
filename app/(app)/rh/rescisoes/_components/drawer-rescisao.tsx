"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Send, RefreshCw, Info, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  rescisaoStatusLabel,
  tipoContratacaoLabel,
} from "@/lib/types";
import {
  atualizarAjusteRescisao,
  recalcularRescisao,
  enviarRescisaoAoFinanceiro,
} from "../actions";
import type { RescisaoLinha } from "./rescisoes-view";

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function DrawerRescisao({
  linha,
  onOpenChange,
}: {
  linha: RescisaoLinha | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [salvando, startSalvar] = React.useTransition();
  const [recalculando, startRecalcular] = React.useTransition();
  const [enviando, startEnviar] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [ajusteValor, setAjusteValor] = React.useState("0");
  const [ajusteMotivo, setAjusteMotivo] = React.useState("");

  React.useEffect(() => {
    if (linha) {
      setAjusteValor(
        linha.ajuste_valor > 0 ? linha.ajuste_valor.toFixed(2) : "",
      );
      setAjusteMotivo(linha.ajuste_motivo ?? "");
      setErro(null);
    }
  }, [linha]);

  if (!linha) return null;

  const podeEditar = linha.status === "rascunho";
  const temSnapshot = linha.salario_vigente != null;
  const ajusteNum = Number(ajusteValor.replace(",", ".") || "0");
  const liquidoCalc =
    (linha.total_bruto ?? 0) - (Number.isFinite(ajusteNum) ? ajusteNum : 0);

  function salvarAjuste() {
    setErro(null);
    startSalvar(async () => {
      const r = await atualizarAjusteRescisao({
        rescisao_id: linha!.id,
        ajuste_valor: Number.isFinite(ajusteNum) ? ajusteNum : 0,
        ajuste_motivo: ajusteMotivo.trim() || null,
      });
      if (!r.ok) {
        setErro(r.message);
        return;
      }
      router.refresh();
    });
  }

  function recalcular() {
    setErro(null);
    startRecalcular(async () => {
      const r = await recalcularRescisao(linha!.id);
      if (!r.ok) {
        setErro(r.message);
        return;
      }
      router.refresh();
    });
  }

  function enviar() {
    setErro(null);
    // Antes de enviar, grava o ajuste atual se mudou.
    const ajusteMudou =
      Number(linha!.ajuste_valor ?? 0) !== (Number.isFinite(ajusteNum) ? ajusteNum : 0) ||
      (linha!.ajuste_motivo ?? "") !== ajusteMotivo.trim();
    startEnviar(async () => {
      if (ajusteMudou) {
        const upd = await atualizarAjusteRescisao({
          rescisao_id: linha!.id,
          ajuste_valor: Number.isFinite(ajusteNum) ? ajusteNum : 0,
          ajuste_motivo: ajusteMotivo.trim() || null,
        });
        if (!upd.ok) {
          setErro(upd.message);
          return;
        }
      }
      const r = await enviarRescisaoAoFinanceiro(linha!.id);
      if (!r.ok) {
        setErro(r.message);
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  const busy = salvando || recalculando || enviando;

  return (
    <Dialog open={!!linha} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="uppercase">{linha.colaborador.nome}</DialogTitle>
          <DialogDescription>
            {tipoContratacaoLabel(linha.colaborador.tipo_contratacao)} · Admissão{" "}
            {formatarData(linha.colaborador.data_admissao)} · Desligamento{" "}
            {formatarData(linha.data_rescisao)}
          </DialogDescription>
        </DialogHeader>

        {!temSnapshot ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 flex gap-3">
            <AlertCircle className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-900">
                Cálculo pendente
              </p>
              <p className="text-sm text-amber-800 mt-1">
                Esta rescisão nasceu sem salário vigente registrado. Cadastre o
                salário do colaborador e clique em Recalcular pra montar o
                cálculo.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl bg-muted/40 p-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Salário vigente
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {brl.format(linha.salario_vigente ?? 0)}
              </p>
            </div>

            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2">Verba</th>
                    <th className="text-center px-4 py-2">Quantidade</th>
                    <th className="text-right px-4 py-2">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <LinhaVerba
                    rotulo="Saldo de salário"
                    qtd={`${linha.saldo_salario_dias ?? 0} dias`}
                    valor={linha.saldo_salario_valor ?? 0}
                  />
                  <LinhaVerba
                    rotulo="Férias"
                    qtd={`${linha.avos_ferias ?? 0} avós`}
                    valor={linha.valor_ferias ?? 0}
                    dica="Regra dos avós: 12 por período + proporcional do atual (≥ 15 dias)."
                  />
                  <LinhaVerba
                    rotulo="1/3 férias"
                    qtd=""
                    valor={linha.valor_um_terco_ferias ?? 0}
                  />
                  <LinhaVerba
                    rotulo="13º proporcional"
                    qtd={`${linha.avos_decimo ?? 0} meses`}
                    valor={linha.valor_decimo_terceiro ?? 0}
                  />
                </tbody>
                <tfoot>
                  <tr className="bg-muted/30 font-medium">
                    <td className="px-4 py-2" colSpan={2}>
                      Subtotal bruto
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {brl.format(linha.total_bruto ?? 0)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="rounded-xl border border-border p-4 space-y-3">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Ajuste manual (desconto)
                </p>
                {!podeEditar && (
                  <span className="text-xs text-muted-foreground">
                    · bloqueado
                  </span>
                )}
              </div>
              <div className="grid gap-3 md:grid-cols-[180px_1fr]">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">
                    Valor a deduzir
                  </label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    placeholder="0,00"
                    value={ajusteValor}
                    onChange={(e) => setAjusteValor(e.target.value)}
                    disabled={!podeEditar || busy}
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">
                    Motivo
                  </label>
                  <Input
                    placeholder="ex: plano de saúde, TotalPass, adiantamento..."
                    value={ajusteMotivo}
                    onChange={(e) => setAjusteMotivo(e.target.value)}
                    disabled={!podeEditar || busy}
                    maxLength={180}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5" />
                Entra como subtração no líquido. Benefícios recorrentes ainda
                viram tema do subsistema de Benefícios — por enquanto é manual.
              </p>
            </div>

            <div className="rounded-xl bg-california-red/5 border border-california-red/20 p-4">
              <div className="flex items-baseline justify-between">
                <p className="text-sm font-semibold uppercase">
                  Total líquido
                </p>
                <p className="text-2xl font-bold tabular-nums text-california-red">
                  {brl.format(liquidoCalc)}
                </p>
              </div>
            </div>
          </div>
        )}

        {linha.status === "enviada_financeiro" && (
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
            Enviada ao financeiro{" "}
            {linha.enviada_em && (
              <>
                em{" "}
                <span className="tabular-nums">
                  {formatarDataHora(linha.enviada_em)}
                </span>
              </>
            )}
            .{" "}
            <Link
              href="/financeiro/contas-a-pagar?tab=people"
              prefetch={false}
              className="font-medium underline underline-offset-2"
            >
              Ver na aba People de Contas a Pagar
            </Link>
          </div>
        )}

        {linha.status === "paga" && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            Rescisão paga{" "}
            {linha.paga_em && (
              <>
                em{" "}
                <span className="tabular-nums">
                  {formatarDataHora(linha.paga_em)}
                </span>
              </>
            )}
            .
          </div>
        )}

        {linha.status === "cancelada" && (
          <div className="rounded-lg border border-muted bg-muted/30 p-3 text-sm text-muted-foreground">
            Cancelada — colaborador foi reativado antes do envio.
          </div>
        )}

        {erro && (
          <div className="rounded-lg border border-california-red/30 bg-california-red/5 p-3 text-sm text-california-red flex gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            {erro}
          </div>
        )}

        {podeEditar && (
          <div className="flex items-center justify-between gap-2 pt-2 flex-wrap">
            <Button
              type="button"
              variant="outline"
              onClick={recalcular}
              disabled={busy}
              className="gap-1.5"
            >
              {recalculando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Recalcular
            </Button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={salvarAjuste}
                disabled={busy || !temSnapshot}
              >
                {salvando ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Salvar rascunho"
                )}
              </Button>
              <Button
                type="button"
                onClick={enviar}
                disabled={busy || !temSnapshot || liquidoCalc <= 0}
                className="gap-1.5 bg-california-red hover:bg-california-red/90"
              >
                {enviando ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Enviar ao financeiro
              </Button>
            </div>
          </div>
        )}

        {!podeEditar && (
          <div className="text-xs text-muted-foreground text-right">
            Status: {rescisaoStatusLabel(linha.status)}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LinhaVerba({
  rotulo,
  qtd,
  valor,
  dica,
}: {
  rotulo: string;
  qtd: string;
  valor: number;
  dica?: string;
}) {
  return (
    <tr>
      <td className="px-4 py-3">
        <p>{rotulo}</p>
        {dica && <p className="text-xs text-muted-foreground mt-0.5">{dica}</p>}
      </td>
      <td className="px-4 py-3 text-center text-muted-foreground">{qtd}</td>
      <td className="px-4 py-3 text-right font-medium tabular-nums">
        {brl.format(valor)}
      </td>
    </tr>
  );
}

function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  if (!ano || !mes || !dia) return iso;
  return `${dia}/${mes}/${ano}`;
}

function formatarDataHora(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString("pt-BR") +
    " às " +
    d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  );
}
