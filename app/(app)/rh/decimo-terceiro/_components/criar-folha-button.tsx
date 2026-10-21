"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, AlertCircle } from "lucide-react";
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
import { criarFolhaDecimoTerceiro } from "../actions";

interface Props {
  anoSugerido: number;
}

export function CriarFolhaButton({ anoSugerido }: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [ano, setAno] = React.useState<string>(String(anoSugerido));
  const [enviando, setEnviando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  async function handleCriar() {
    setErro(null);
    const anoNum = Number(ano);
    if (!Number.isInteger(anoNum) || anoNum < 2020 || anoNum > 2100) {
      setErro("Informe um ano entre 2020 e 2100.");
      return;
    }
    setEnviando(true);
    const res = await criarFolhaDecimoTerceiro(anoNum);
    setEnviando(false);
    if (!res.ok) {
      setErro(res.message);
      return;
    }
    setOpen(false);
    router.push(`/rh/decimo-terceiro/${anoNum}`);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover hover:shadow-brand transition-all"
        >
          <Plus className="h-4 w-4" />
          Criar folha de 13º
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Criar folha de 13º do ano</DialogTitle>
          <DialogDescription>
            O sistema puxa todos os colaboradores CLT, CLT recibo, PJ e MEI
            ativos no ano, grava um snapshot (salário, data de admissão,
            empresa) e calcula avos, parcelas e descontos. Estágio e sócio
            ficam de fora.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ano-13">Ano da folha</Label>
            <Input
              id="ano-13"
              type="number"
              min={2020}
              max={2100}
              value={ano}
              onChange={(e) => setAno(e.target.value)}
              disabled={enviando}
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
              onClick={() => setOpen(false)}
              disabled={enviando}
              className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleCriar}
              disabled={enviando}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red/90 transition-colors disabled:opacity-50"
            >
              {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
              Criar folha de {ano}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
