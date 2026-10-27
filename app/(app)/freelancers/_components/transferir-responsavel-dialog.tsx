"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, AlertCircle, CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { transferirResponsavelFreelancer } from "../actions";

export interface ResponsavelOption {
  id: string;
  nome: string;
}

interface Props {
  freelancerId: string;
  freelancerNome: string;
  responsavelAtualId: string | null;
  responsavelAtualNome: string | null;
  responsaveisDisponiveis: ResponsavelOption[];
}

export function TransferirResponsavelDialog({
  freelancerId,
  freelancerNome,
  responsavelAtualId,
  responsavelAtualNome,
  responsaveisDisponiveis,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [novoId, setNovoId] = React.useState<string>("");
  const [loading, setLoading] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  const opcoes = responsaveisDisponiveis.filter(
    (g) => g.id !== responsavelAtualId,
  );
  const novoNome = opcoes.find((g) => g.id === novoId)?.nome;

  function reset() {
    setOpen(false);
    setNovoId("");
    setErro(null);
    setDone(false);
  }

  async function handleConfirmar() {
    if (!novoId) {
      setErro("Selecione um responsável.");
      return;
    }
    setErro(null);
    setLoading(true);
    const res = await transferirResponsavelFreelancer(freelancerId, novoId);
    setLoading(false);
    if (!res.ok) {
      setErro(res.message);
      return;
    }
    setDone(true);
    router.refresh();
    setTimeout(() => reset(), 1600);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!loading) {
          if (v) {
            setOpen(true);
          } else {
            reset();
          }
        }
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1.5 text-[11px] font-semibold text-foreground hover:border-california-red/40 hover:text-california-red transition-all"
        >
          <ArrowLeftRight className="h-3 w-3" />
          Transferir responsável
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Transferir responsável</DialogTitle>
          <DialogDescription>
            Muda o dono da relação com {freelancerNome}. Contratos individuais
            seguem com os responsáveis próprios — essa mudança não os afeta.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="flex flex-col items-center text-center gap-3 py-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 ring-1 ring-emerald-600/20">
              <CheckCircle2 className="h-6 w-6 text-emerald-600" />
            </div>
            <div>
              <p className="font-semibold text-foreground">
                Transferência concluída
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {freelancerNome} agora é de {novoNome}.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="rounded-xl bg-muted/40 border border-border/60 px-3 py-2.5 text-xs text-muted-foreground">
              <p>
                <span className="font-semibold text-foreground">
                  {freelancerNome}
                </span>{" "}
                está com{" "}
                <span className="font-semibold text-foreground">
                  {responsavelAtualNome ?? "nenhum responsável"}
                </span>
                .
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="novo-resp">Novo responsável</Label>
              <select
                id="novo-resp"
                value={novoId}
                onChange={(e) => setNovoId(e.target.value)}
                disabled={loading}
                className="flex h-10 w-full rounded-md border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-california-red/30 focus:border-california-red disabled:opacity-60"
              >
                <option value="">Selecione...</option>
                {opcoes.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.nome}
                  </option>
                ))}
              </select>
              {opcoes.length === 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Nenhum outro responsável ativo disponível.
                </p>
              )}
            </div>

            {erro && (
              <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-3 py-2.5 text-sm text-california-red">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{erro}</span>
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={reset}
                disabled={loading}
              >
                Cancelar
              </Button>
              <Button
                onClick={handleConfirmar}
                disabled={loading || !novoId || opcoes.length === 0}
              >
                {loading ? "Transferindo..." : "Confirmar transferência"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
