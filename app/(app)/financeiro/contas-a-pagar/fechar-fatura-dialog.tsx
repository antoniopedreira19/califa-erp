"use client";

/**
 * Fechar a fatura do cartão.
 *
 * A tela mostra os dois números lado a lado — o que o sistema somou e o que
 * o banco cobrou — porque a diferença entre eles é o assunto inteiro do
 * fechamento. IOF, anuidade e juros aparecem em toda fatura e ninguém os
 * lança; sem um lugar para eles, a fatura nunca bateria com o extrato.
 *
 * Por isso o campo de plano de contas do ajuste só aparece quando há
 * diferença — e aí ele é obrigatório, porque um ajuste sem classificação
 * some do DRE.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CreditCard } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { formatCurrency, cn } from "@/lib/utils";
import type { PlanoContaTipo, PlanoContaSubtipo } from "@/lib/types";
import { fecharFaturaCartao } from "./actions-fatura-cartao";

export interface FaturaAberta {
  id: string;
  codigo: string;
  cartao_credito_id: string;
  competencia_fechamento: string;
  data_vencimento: string;
  /** Soma dos itens que estão nesta fatura. */
  soma_itens: number;
  qtd_itens: number;
}

interface Props {
  fatura: FaturaAberta | null;
  cartaoNome: string;
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  onOpenChange: (aberto: boolean) => void;
}

function formatData(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/** Aceita "1.234,56" e "1234.56" — o financeiro digita dos dois jeitos. */
function paraNumero(raw: string): number | null {
  const s = raw.trim();
  if (s === "") return null;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : null;
}

export function FecharFaturaDialog({
  fatura,
  cartaoNome,
  tipos,
  subtipos,
  onOpenChange,
}: Props) {
  const router = useRouter();
  const [valorTexto, setValorTexto] = React.useState("");
  const [tipoId, setTipoId] = React.useState("");
  const [subtipoId, setSubtipoId] = React.useState("");
  const [descricao, setDescricao] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);
  const [salvando, setSalvando] = React.useState(false);

  React.useEffect(() => {
    if (fatura) {
      // Abre com o valor do sistema: na fatura sem IOF nem anuidade ele já
      // é o valor certo, e o financeiro só confere e confirma.
      setValorTexto(String(fatura.soma_itens.toFixed(2)).replace(".", ","));
      setTipoId("");
      setSubtipoId("");
      setDescricao("");
      setErro(null);
    }
  }, [fatura]);

  const valorCobrado = paraNumero(valorTexto);
  const diferenca =
    fatura && valorCobrado !== null ? valorCobrado - fatura.soma_itens : 0;
  const temDiferenca = Math.abs(diferenca) > 0.005;

  const subtiposDoTipo = React.useMemo(
    () => subtipos.filter((s) => s.tipo_id === tipoId),
    [subtipos, tipoId],
  );

  // Zero e negativo passam: com estorno maior que as compras do mês a
  // fatura é credora e o banco não cobra nada (29/08/2026).
  const credora = valorCobrado !== null && valorCobrado <= 0;

  const podeFechar =
    fatura !== null &&
    valorCobrado !== null &&
    (!temDiferenca || (tipoId !== "" && subtipoId !== "")) &&
    !salvando;

  async function confirmar() {
    if (!fatura || valorCobrado === null) return;
    setSalvando(true);
    setErro(null);

    const r = await fecharFaturaCartao({
      fatura_id: fatura.id,
      valor_cobrado: valorCobrado,
      ajuste_tipo_id: temDiferenca ? tipoId : null,
      ajuste_subtipo_id: temDiferenca ? subtipoId : null,
      ajuste_descricao: descricao.trim() || null,
    });

    setSalvando(false);
    if (!r.ok) {
      setErro(r.message);
      return;
    }
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={fatura !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-[520px] overflow-y-auto">
        {fatura && (
          <>
            <DialogHeader>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-lg bg-california-red/10 p-2">
                  <CreditCard className="h-4.5 w-4.5 text-california-red" />
                </div>
                <div className="min-w-0">
                  <DialogTitle className="text-[19px]">
                    Fechar fatura
                  </DialogTitle>
                  <DialogDescription className="pt-1.5 text-[13px] leading-relaxed">
                    <span className="font-mono font-semibold text-[#b3323c]">
                      {fatura.codigo}
                    </span>{" "}
                    · {cartaoNome} · fecha em{" "}
                    {formatData(fatura.competencia_fechamento)}, vence em{" "}
                    {formatData(fatura.data_vencimento)}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-4 pt-1">
              <div className="rounded-xl border border-border px-3.5 py-3">
                <div className="flex items-center justify-between py-1">
                  <span className="text-[12.5px] text-muted-foreground">
                    Soma dos itens ({fatura.qtd_itens})
                  </span>
                  <span className="font-mono text-[13px] font-semibold">
                    {formatCurrency(fatura.soma_itens)}
                  </span>
                </div>
                {valorCobrado !== null && (
                  <div className="flex items-center justify-between border-t border-border py-1 pt-2">
                    <span className="text-[12.5px] text-muted-foreground">
                      Diferença
                    </span>
                    <span
                      className={cn(
                        "font-mono text-[13px] font-bold",
                        !temDiferenca
                          ? "text-muted-foreground"
                          : diferenca > 0
                            ? "text-[#c2410c]"
                            : "text-[#047857]",
                      )}
                    >
                      {diferenca === 0
                        ? formatCurrency(0)
                        : `${diferenca > 0 ? "+" : "−"}${formatCurrency(Math.abs(diferenca))}`}
                    </span>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="valor_cobrado">
                  Valor cobrado pelo banco *
                </Label>
                <Input
                  id="valor_cobrado"
                  inputMode="decimal"
                  value={valorTexto}
                  onChange={(e) => setValorTexto(e.target.value)}
                  placeholder="0,00"
                  className="font-mono"
                />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  O total da fatura como ele veio do banco. Vem preenchido com
                  a soma dos itens — corrija se o banco cobrou outro valor.
                  Negativo é válido: significa que o cartão ficou credor.
                </p>
              </div>

              {temDiferenca && (
                <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
                  <p className="text-[12.5px] leading-relaxed text-amber-900">
                    A diferença de{" "}
                    <strong className="font-mono font-semibold">
                      {formatCurrency(Math.abs(diferenca))}
                    </strong>{" "}
                    vira um lançamento próprio. Classifique-a — é o IOF, a
                    anuidade, o juro ou uma compra que ninguém lançou.
                  </p>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor="ajuste_tipo">Tipo *</Label>
                      <select
                        id="ajuste_tipo"
                        value={tipoId}
                        onChange={(e) => {
                          setTipoId(e.target.value);
                          setSubtipoId("");
                        }}
                        className="h-10 w-full rounded-lg border border-border bg-white px-2 text-sm outline-none focus:border-california-red"
                      >
                        <option value="">Selecione…</option>
                        {tipos.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.codigo} · {t.nome}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="ajuste_subtipo">Subtipo *</Label>
                      <select
                        id="ajuste_subtipo"
                        value={subtipoId}
                        disabled={tipoId === ""}
                        onChange={(e) => setSubtipoId(e.target.value)}
                        className="h-10 w-full rounded-lg border border-border bg-white px-2 text-sm outline-none focus:border-california-red disabled:bg-muted/40"
                      >
                        <option value="">Selecione…</option>
                        {subtiposDoTipo.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.codigo} · {s.nome}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="ajuste_descricao">
                      Descrição do ajuste
                    </Label>
                    <Input
                      id="ajuste_descricao"
                      value={descricao}
                      onChange={(e) => setDescricao(e.target.value)}
                      maxLength={200}
                      placeholder="Ex.: IOF e anuidade"
                    />
                  </div>
                </div>
              )}

              {credora ? (
                <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-[11.5px] leading-relaxed text-emerald-900">
                  Fatura credora: os estornos cobriram as compras e não há o
                  que pagar. Ela <strong>não desce</strong> para Títulos a
                  Pagar — o crédito fica na conta do cartão e abate a próxima
                  fatura, como a operadora faz.
                </p>
              ) : (
                <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                  Fechar transforma cada item num lançamento na conta do
                  cartão, com o plano de contas dele, e faz a fatura descer
                  para Títulos a Pagar como um título único. Depois disso ela
                  não recebe mais compra.
                </p>
              )}

              {erro && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-california-red/30 bg-california-red/5 px-3 py-2.5"
                >
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none text-california-red" />
                  <span className="text-[12px] text-foreground">{erro}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  disabled={salvando}
                  className="inline-flex items-center rounded-lg border border-border bg-white px-3.5 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-[#d7d7d7] hover:text-foreground disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmar}
                  disabled={!podeFechar}
                  className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-california-red-hover disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <CreditCard className="h-3.5 w-3.5" />
                  {salvando ? "Fechando…" : "Fechar fatura"}
                </button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
