"use client";

/**
 * Estornar uma compra do cartão.
 *
 * A tela não pergunta plano de contas, job nem fornecedor: tudo isso vem
 * da compra, copiado pelo banco. Estorno com plano diferente do da compra
 * não se anula no DRE, e anular é a razão de ele existir — então não há o
 * que escolher aqui.
 *
 * Sobram três coisas: quanto, quando, e por quê.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Undo2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";
import { estornarCompraCartao } from "./actions-estorno-cartao";

export interface CompraParaEstorno {
  id: string;
  /** `AV-00001` ou o rótulo da origem. */
  codigo: string;
  descricao: string;
  valor: number;
  /** Quanto desta compra já foi estornado antes. */
  estornado: number;
}

interface Props {
  compra: CompraParaEstorno | null;
  onOpenChange: (aberto: boolean) => void;
  onSucesso: (mensagem: string) => void;
}

/** Aceita "1.234,56" e "1234.56" — o financeiro digita dos dois jeitos. */
function paraNumero(raw: string): number | null {
  const s = raw.trim();
  if (s === "") return null;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : null;
}

function hojeISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${dia}`;
}

export function EstornarCompraDialog({ compra, onOpenChange, onSucesso }: Props) {
  const router = useRouter();
  const [valorTexto, setValorTexto] = React.useState("");
  const [data, setData] = React.useState("");
  const [descricao, setDescricao] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);
  const [salvando, setSalvando] = React.useState(false);

  const disponivel = compra ? compra.valor - compra.estornado : 0;

  React.useEffect(() => {
    if (compra) {
      // Abre com o que sobra: o estorno total é o caso comum, e o
      // parcial é a exceção que se digita.
      setValorTexto(disponivel.toFixed(2).replace(".", ","));
      setData(hojeISO());
      setDescricao("");
      setErro(null);
    }
    // `disponivel` deriva de `compra`; não precisa entrar na lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compra]);

  const valor = paraNumero(valorTexto);
  const passaDoTeto = valor !== null && valor > disponivel + 0.005;

  const podeEstornar =
    compra !== null &&
    valor !== null &&
    valor > 0 &&
    !passaDoTeto &&
    data !== "" &&
    !salvando;

  async function confirmar() {
    if (!compra || valor === null) return;
    setSalvando(true);
    setErro(null);

    const r = await estornarCompraCartao({
      compra_id: compra.id,
      valor,
      data_estorno: data || null,
      descricao: descricao.trim() || null,
    });

    setSalvando(false);
    if (!r.ok) {
      setErro(r.message);
      return;
    }
    onOpenChange(false);
    onSucesso(
      `Estorno de ${formatCurrency(valor)} lançado — ele abate a fatura aberta do cartão.`,
    );
    router.refresh();
  }

  return (
    <Dialog open={compra !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-[520px] overflow-y-auto">
        {compra && (
          <>
            <DialogHeader>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-lg bg-emerald-50 p-2">
                  <Undo2 className="h-4.5 w-4.5 text-emerald-700" />
                </div>
                <div className="min-w-0">
                  <DialogTitle className="text-[19px]">
                    Estornar compra
                  </DialogTitle>
                  <DialogDescription className="pt-1.5 text-[13px] leading-relaxed">
                    <span className="font-mono font-semibold text-[#b3323c]">
                      {compra.codigo}
                    </span>{" "}
                    · {compra.descricao}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-4 pt-1">
              <div className="rounded-xl border border-border px-3.5 py-3">
                <div className="flex items-center justify-between py-1">
                  <span className="text-[12.5px] text-muted-foreground">
                    Valor da compra
                  </span>
                  <span className="font-mono text-[13px] font-semibold">
                    {formatCurrency(compra.valor)}
                  </span>
                </div>
                {compra.estornado > 0 && (
                  <div className="flex items-center justify-between border-t border-border py-1 pt-2">
                    <span className="text-[12.5px] text-muted-foreground">
                      Já estornado
                    </span>
                    <span className="font-mono text-[13px] font-semibold text-[#047857]">
                      {formatCurrency(compra.estornado)}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-border py-1 pt-2">
                  <span className="text-[12.5px] text-muted-foreground">
                    Ainda dá para estornar
                  </span>
                  <span className="font-mono text-[13px] font-bold">
                    {formatCurrency(disponivel)}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="valor_estorno">Valor do estorno *</Label>
                <Input
                  id="valor_estorno"
                  inputMode="decimal"
                  value={valorTexto}
                  onChange={(e) => setValorTexto(e.target.value)}
                  placeholder="0,00"
                  className="font-mono"
                />
                {passaDoTeto ? (
                  <p className="text-[11px] leading-relaxed text-california-red">
                    Passa do que sobra desta compra ({formatCurrency(disponivel)}).
                  </p>
                ) : (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Vem preenchido com o total. Se a operadora devolveu só
                    parte, corrija.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="data_estorno">Data do estorno *</Label>
                <Input
                  id="data_estorno"
                  type="date"
                  value={data}
                  onChange={(e) => setData(e.target.value)}
                />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  O dia em que o crédito caiu. É ele que decide em qual
                  fatura o estorno entra.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="descricao_estorno">Descrição</Label>
                <Input
                  id="descricao_estorno"
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  maxLength={200}
                  placeholder="Ex.: devolução do equipamento"
                />
              </div>

              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                O estorno herda empresa, plano de contas, job, fornecedor e
                cliente desta compra — é assim que os dois se anulam no
                DRE. Ele entra na fatura aberta do cartão e abate o total
                dela. A compra, e as parcelas já pagas, continuam como
                estão.
              </p>

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
                  disabled={!podeEstornar}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  {salvando ? "Lançando…" : "Lançar estorno"}
                </button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
