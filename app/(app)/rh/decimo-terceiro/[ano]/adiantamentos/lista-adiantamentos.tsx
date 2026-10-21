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
  lancarAdiantamentoDecimoTerceiro,
  excluirAdiantamentoDecimoTerceiro,
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
  conta_avulsa_id: string | null;
}

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
    if (!confirm("Excluir este adiantamento? A conta avulsa no financeiro continua existindo e precisa ser cancelada à parte, se já tiver sido lançada.")) {
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
                <th className="px-4 py-3 text-center font-medium">Lançado</th>
                <th className="px-4 py-3 text-center font-medium w-10"></th>
              </tr>
            </thead>
            <tbody>
              {adiantamentos.map((a) => (
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
                  <td className="px-4 py-3 text-center">
                    {a.conta_avulsa_id ? (
                      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        enviado
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                        falhou
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {podeEditar && (
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
                    )}
                  </td>
                </tr>
              ))}
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
  const [enviando, setEnviando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

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
          Gera lançamento no financeiro como Despesa com Pessoal · 13° Salário
          e abate automaticamente da 1ª parcela quando a folha for calculada.
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
            <Label htmlFor="valor">Valor (R$)</Label>
            <Input
              id="valor"
              type="number"
              step="0.01"
              min="0.01"
              placeholder="0,00"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              disabled={enviando}
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
