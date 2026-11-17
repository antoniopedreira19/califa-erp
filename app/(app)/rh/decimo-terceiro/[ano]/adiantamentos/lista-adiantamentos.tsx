"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import {
  lancarAdiantamentoDecimoTerceiro,
  excluirAdiantamentoDecimoTerceiro,
  calcularTreizeBrutoEsperado,
} from "../../actions";

export interface AdiantamentoRow {
  id: string;
  colaborador_id: string;
  colaborador_nome: string;
  colaborador_funcao: string;
  colaborador_tipo: string;
  data: string;
  valor: number;
  obs: string | null;
  integral: boolean;
  folha_pagamento_id: string | null;
  folha_status: string | null;
  tem_nf: boolean;
}

// ---------------------------------------------------------------------------
// Deriva o status visual do adiantamento com base no estado da folha e NF
//
// Legado = sem folha vinculada (pagamento foi feito antes do ERP entrar em
// vigor pra California). Nesses casos, se o adiantamento foi integral,
// mostramos "Pago — integral" pra explicar por que o colaborador sumiu
// da folha de 13º. Senão, só "Pago" cinza.

function derivarStatusAdiantamento(
  folha_status: string | null,
  tem_nf: boolean,
  tipo_contratacao: string,
  integral: boolean,
): { label: string; variant: "pago" | "pago_integral" | "aguardando_nf" | "aguardando_aprovacao" | "aprovado" } {
  if (!folha_status) {
    return integral
      ? { label: "Pago — integral", variant: "pago_integral" }
      : { label: "Pago", variant: "pago" };
  }
  if (folha_status === "paga") return { label: "Pago", variant: "pago" };
  if (folha_status === "aprovada") return { label: "Aprovado — a pagar", variant: "aprovado" };
  // status === 'enviada' (ou 'pendente_correcao' tratado como enviada)
  if (!tem_nf && ["pj", "mei", "clt_recibo"].includes(tipo_contratacao)) {
    return { label: "Aguardando NF", variant: "aguardando_nf" };
  }
  return { label: "Aguardando aprovação", variant: "aguardando_aprovacao" };
}

const variantClasses: Record<ReturnType<typeof derivarStatusAdiantamento>["variant"], string> = {
  pago: "bg-zinc-100 text-zinc-500",
  pago_integral: "bg-zinc-100 text-zinc-600 ring-1 ring-zinc-300",
  aguardando_nf: "bg-amber-50 text-amber-700",
  aguardando_aprovacao: "bg-blue-50 text-blue-700",
  aprovado: "bg-emerald-50 text-emerald-700",
};

export interface ColabOpcao {
  id: string;
  nome: string;
  tipo_contratacao: string;
}

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function formatarData(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

interface Props {
  ano: number;
  adiantamentos: AdiantamentoRow[];
  colaboradores: ColabOpcao[];
  podeEditar: boolean;
}

export function ListaAdiantamentos({
  ano,
  adiantamentos,
  colaboradores,
  podeEditar,
}: Props) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [excluindoId, setExcluindoId] = React.useState<string | null>(null);

  async function handleExcluir(adiantamentoId: string) {
    if (!confirm("Excluir este adiantamento? A linha no financeiro será removida automaticamente se ainda não estiver aprovada.")) {
      return;
    }
    setExcluindoId(adiantamentoId);
    const res = await excluirAdiantamentoDecimoTerceiro(adiantamentoId);
    setExcluindoId(null);
    if (!res.ok) {
      alert(res.message);
      return;
    }
    router.refresh();
  }

  return (
    <>
      <div className="flex items-center justify-end">
        {podeEditar && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover transition-all"
              >
                <Plus className="h-4 w-4" />
                Novo adiantamento
              </button>
            </DialogTrigger>
            <NovoAdiantamentoDialogContent
              ano={ano}
              colaboradores={colaboradores}
              onClose={() => setDialogOpen(false)}
            />
          </Dialog>
        )}
      </div>

      {adiantamentos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-10 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhum adiantamento registrado em {ano}.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Data</th>
                <th className="px-4 py-3 text-left font-medium">Colaborador</th>
                <th className="px-4 py-3 text-right font-medium">Valor</th>
                <th className="px-4 py-3 text-left font-medium">Observação</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-center font-medium w-10"></th>
              </tr>
            </thead>
            <tbody>
              {adiantamentos.map((a) => {
                const status = derivarStatusAdiantamento(a.folha_status, a.tem_nf, a.colaborador_tipo, a.integral);
                const bloqueadoAprovado = a.folha_status === "aprovada" || a.folha_status === "paga";
                const bloqueadoNf = a.tem_nf && a.folha_status === "enviada";
                const excluirBloqueado = bloqueadoAprovado || bloqueadoNf;
                const tooltipExcluir = bloqueadoAprovado
                  ? "Adiantamento já aprovado pelo financeiro — cancele o título em contas a pagar primeiro."
                  : bloqueadoNf
                    ? "Colaborador já anexou NF — remova a NF antes de excluir."
                    : null;

                return (
                  <tr key={a.id} className="border-t border-border">
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">
                      {formatarData(a.data)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{a.colaborador_nome}</div>
                      <div className="text-xs text-muted-foreground">
                        {a.colaborador_funcao}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-california-red">
                      {brl.format(a.valor)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {a.obs ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${variantClasses[status.variant]}`}
                      >
                        {status.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {podeEditar && (
                        excluirBloqueado ? (
                          <TooltipProvider delayDuration={200}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center justify-center rounded-full p-1.5 text-muted-foreground/40 cursor-not-allowed">
                                  <Trash2 className="h-4 w-4" />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="max-w-[260px] text-center">
                                {tooltipExcluir}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleExcluir(a.id)}
                            disabled={excluindoId === a.id}
                            aria-label="Excluir"
                            className="inline-flex items-center justify-center rounded-full hover:bg-destructive/10 p-1.5 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                          >
                            {excluindoId === a.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function NovoAdiantamentoDialogContent({
  ano,
  colaboradores,
  onClose,
}: {
  ano: number;
  colaboradores: ColabOpcao[];
  onClose: () => void;
}) {
  const router = useRouter();
  const hoje = new Date().toISOString().slice(0, 10);
  const [colabId, setColabId] = React.useState<string>("");
  const [data, setData] = React.useState<string>(hoje);
  const [valor, setValor] = React.useState<string>("");
  const [obs, setObs] = React.useState<string>("");
  const [integral, setIntegral] = React.useState(false);
  const [carregandoBruto, setCarregandoBruto] = React.useState(false);
  const [enviando, setEnviando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  // Quando marca "integral" + tem colaborador escolhido: busca o 13º bruto
  // esperado e preenche o campo valor automaticamente. Mantém o campo
  // readonly enquanto a flag estiver ligada. Erro do servidor desmarca
  // o checkbox e exibe a mensagem.
  React.useEffect(() => {
    if (!integral || !colabId) return;
    let cancelado = false;
    setCarregandoBruto(true);
    setErro(null);
    calcularTreizeBrutoEsperado({ colaborador_id: colabId, ano })
      .then((res) => {
        if (cancelado) return;
        if (!res.ok) {
          setIntegral(false);
          setErro(res.message);
          setValor("");
        } else {
          setValor(res.bruto.toFixed(2));
        }
      })
      .finally(() => {
        if (!cancelado) setCarregandoBruto(false);
      });
    return () => {
      cancelado = true;
    };
  }, [integral, colabId, ano]);

  async function handleSalvar() {
    setErro(null);
    if (!colabId) {
      setErro("Escolha um colaborador.");
      return;
    }
    const valorNum = Number(valor.replace(",", "."));
    if (!Number.isFinite(valorNum) || valorNum <= 0) {
      setErro("Valor inválido.");
      return;
    }
    setEnviando(true);
    const res = await lancarAdiantamentoDecimoTerceiro({
      ano,
      colaborador_id: colabId,
      data,
      valor: valorNum,
      obs: obs.trim() === "" ? null : obs.trim(),
      integral,
    });
    setEnviando(false);
    if (!res.ok) {
      setErro(res.message);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Novo adiantamento de 13º</DialogTitle>
        <DialogDescription>
          Cria linha no financeiro aguardando aprovação e abate automaticamente
          da 1ª parcela quando a folha for calculada.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="colab">Colaborador</Label>
          <Select value={colabId} onValueChange={setColabId}>
            <SelectTrigger id="colab">
              <SelectValue placeholder="Escolha o colaborador" />
            </SelectTrigger>
            <SelectContent>
              {colaboradores.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
          <Checkbox
            id="integral"
            checked={integral}
            onCheckedChange={(v) => setIntegral(v === true)}
            disabled={enviando || !colabId}
            className="mt-0.5"
          />
          <div className="space-y-0.5">
            <Label htmlFor="integral" className="cursor-pointer text-sm font-medium">
              Pagamento integral do 13º
            </Label>
            <p className="text-xs text-muted-foreground">
              Quita o 13º inteiro. O colaborador não participa da folha deste ano.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="data">Data do adiantamento</Label>
            <Input
              id="data"
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              disabled={enviando}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="valor">
              Valor (R$)
              {integral && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  (preenchido automaticamente)
                </span>
              )}
            </Label>
            <Input
              id="valor"
              type="number"
              step="0.01"
              min="0.01"
              placeholder={carregandoBruto ? "Calculando…" : "0,00"}
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              disabled={enviando || carregandoBruto}
              readOnly={integral}
              className={integral ? "bg-muted cursor-not-allowed" : undefined}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="obs">Observação (opcional)</Label>
          <textarea
            id="obs"
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            disabled={enviando}
            rows={2}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-california-red/30"
          />
        </div>

        {erro && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{erro}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={enviando}
            className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSalvar}
            disabled={enviando}
            className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red/90 transition-colors disabled:opacity-50"
          >
            {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
            Lançar
          </button>
        </div>
      </div>
    </DialogContent>
  );
}
