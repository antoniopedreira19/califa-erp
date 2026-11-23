"use client";

/**
 * O período fechado da conciliação no popup de baixa (decisão 205; o
 * protótipo, `BaixaDialog` com `fechadoAte`): com a conciliação da conta
 * fechada, a baixa com data até o fechamento mostra o aviso vermelho e não
 * confirma. O banco recusa de qualquer jeito (o gatilho dos lançamentos);
 * aqui o popup avisa antes de chamar.
 *
 * A leitura vai pelo cliente do navegador, e não por Server Action: as
 * actions vão uma de cada vez, e a busca das retenções da aprovação, que
 * trava o Confirmar, não pode esperar por esta. A RLS só mostra os
 * fechamentos a admin e financeiro — os únicos que dão baixa (decisão 197).
 */

import * as React from "react";
import { History, Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { noPeriodoFechado } from "@/lib/conciliacao/fechamento";

/** Até quando cada conta está fechada; vazio enquanto lê ou sem fechamento. */
export function useFechamentosDasContas(): Record<string, string> {
  const [fechados, setFechados] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    let vivo = true;
    createClient()
      .from("conciliacao_fechamentos")
      .select("conta_bancaria_id, ate")
      .eq("ativo", true)
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) {
          console.error("[baixa.periodo_fechado]", error.message);
          return;
        }
        setFechados(
          Object.fromEntries(
            ((data ?? []) as Array<{ conta_bancaria_id: string; ate: string }>).map((f) => [f.conta_bancaria_id, f.ate]),
          ),
        );
      });
    return () => {
      vivo = false;
    };
  }, []);
  return fechados;
}

/**
 * A conta e a data da baixa caem no período fechado? Devolve até quando.
 *
 * `inicio` é o dia em que a conta começa no sistema (decisão 270): o
 * fechamento trava do início até a data dele, e a data antes do início é do
 * período do histórico — o banco também a deixa passar (`_exige_periodo_aberto`).
 */
export function usePeriodoFechado(
  contaId: string | null | undefined,
  data: string | null | undefined,
  inicio: string | null = null,
): string | null {
  const fechados = useFechamentosDasContas();
  const ate = contaId ? (fechados[contaId] ?? null) : null;
  return noPeriodoFechado(data, ate) && !antesDoInicioDaConta(data, inicio) ? ate : null;
}

/** O dia em que a conta começa no sistema (`saldo_inicial_data`); nulo sem conta. */
export function inicioDaConta(
  contas: Array<{ id: string; saldo_inicial_data?: string | null }>,
  contaId: string | null | undefined,
): string | null {
  if (!contaId) return null;
  return contas.find((c) => c.id === contaId)?.saldo_inicial_data ?? null;
}

/** A data da baixa é de antes de a conta começar no sistema? (Decisão 270.) */
export function antesDoInicioDaConta(data: string | null | undefined, inicio: string | null | undefined): boolean {
  return !!data && !!inicio && data.slice(0, 10) < inicio.slice(0, 10);
}

function dataBR(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/** O erro do Confirmar (protótipo, `BaixaDialog`). */
export function erroDoPeriodoFechado(ate: string): string {
  return `Período fechado até ${dataBR(ate)}: use uma data depois, ou reabra a conciliação.`;
}

/** O aviso vermelho do popup (protótipo, `BaixaDialog`). */
export function AvisoDoPeriodoFechado({ ate, contaNome }: { ate: string; contaNome: string | null }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900">
      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        A conciliação {contaNome ? `da ${contaNome}` : "desta conta"} está fechada até {dataBR(ate)}. Baixa com data até lá só
        entra reabrindo o mês, na Conciliação.
      </span>
    </div>
  );
}

/**
 * A faixa âmbar da baixa com data antes do início da conta (decisão 270; a
 * opção "Faixa no topo" do protótipo). A baixa grava: o lançamento fica antes
 * do saldo inicial, fora do saldo e da conciliação, e espera a conciliação do
 * histórico com a linha da planilha.
 */
export function AvisoAntesDoInicio({ inicio, recebimento = false }: { inicio: string; recebimento?: boolean }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
      <History className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        {recebimento ? "Recebimento" : "Pagamento"} antes do início da conta no sistema ({dataBR(inicio)}): a baixa vai
        para o período antes do início e não muda o saldo nem a conciliação.
      </span>
    </div>
  );
}
