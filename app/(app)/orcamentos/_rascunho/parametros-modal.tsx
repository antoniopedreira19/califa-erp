"use client";

import * as React from "react";
import { Save } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ParametrosVersao } from "./tipos";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parametros: ParametrosVersao;
  onSalvar: (parametros: ParametrosVersao) => void;
}

/** Aceita "19,53" e "19.53". */
function parseNumero(raw: string): number | null {
  const s = raw.trim();
  if (s === "") return null;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : null;
}

function paraEdicao(valor: number): string {
  return String(valor).replace(".", ",");
}

/**
 * Moeda, câmbio e percentuais valem para TODAS as versões v1 criadas neste
 * salvamento — no orçamento do projeto os jobs são faturados sob as mesmas
 * condições comerciais. A exceção é o job importado: o % de honorários
 * negociado dentro da planilha vence o daqui, só naquele orçamento.
 */
export function ParametrosModal({
  open,
  onOpenChange,
  parametros,
  onSalvar,
}: Props) {
  const [moeda, setMoeda] = React.useState(parametros.moeda);
  const [taxa, setTaxa] = React.useState(paraEdicao(parametros.taxa_cambio));
  const [honorarios, setHonorarios] = React.useState(
    paraEdicao(parametros.percentual_honorarios),
  );
  const [imposto, setImposto] = React.useState(
    paraEdicao(parametros.percentual_imposto),
  );
  const [erro, setErro] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setMoeda(parametros.moeda);
    setTaxa(paraEdicao(parametros.taxa_cambio));
    setHonorarios(paraEdicao(parametros.percentual_honorarios));
    setImposto(paraEdicao(parametros.percentual_imposto));
    setErro(null);
  }, [open, parametros]);

  function salvar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const taxaNum = parseNumero(taxa);
    const honorariosNum = parseNumero(honorarios);
    const impostoNum = parseNumero(imposto);

    if (taxaNum === null || taxaNum <= 0) {
      setErro("Taxa de câmbio precisa ser maior que zero.");
      return;
    }
    if (
      honorariosNum === null ||
      honorariosNum < 0 ||
      honorariosNum > 100 ||
      impostoNum === null ||
      impostoNum < 0 ||
      impostoNum > 100
    ) {
      setErro("Percentuais precisam estar entre 0 e 100.");
      return;
    }
    if (moeda.trim().length !== 3) {
      setErro("Informe a moeda em três letras (BRL, USD, EUR).");
      return;
    }

    onSalvar({
      moeda: moeda.trim().toUpperCase(),
      taxa_cambio: taxaNum,
      percentual_honorarios: honorariosNum,
      percentual_imposto: impostoNum,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 overflow-hidden p-0">
        <form onSubmit={salvar}>
          <div className="px-7 pb-4 pt-6">
            <DialogTitle className="text-lg font-bold tracking-tight">
              Parâmetros das versões
            </DialogTitle>
            <DialogDescription className="mt-1.5 text-[13px]">
              Valem para todos os orçamentos deste rascunho. Planilha
              importada com honorários próprios mantém o percentual dela.
            </DialogDescription>
          </div>

          {erro && (
            <div className="border-y border-california-red/20 bg-california-red/5 px-7 py-2.5 text-xs text-california-red">
              {erro}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 px-7 pb-6 pt-1">
            <div className="space-y-2">
              <Label htmlFor="moeda">Moeda</Label>
              <Input
                id="moeda"
                value={moeda}
                maxLength={3}
                onChange={(e) => setMoeda(e.target.value.toUpperCase())}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="taxa_cambio">Taxa de câmbio</Label>
              <Input
                id="taxa_cambio"
                value={taxa}
                onChange={(e) => setTaxa(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="percentual_honorarios">Honorários (%)</Label>
              <Input
                id="percentual_honorarios"
                value={honorarios}
                onChange={(e) => setHonorarios(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="percentual_imposto">Impostos (%)</Label>
              <Input
                id="percentual_imposto"
                value={imposto}
                onChange={(e) => setImposto(e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t border-border px-7 py-4">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-xl border border-border bg-white px-5 py-2.5 text-[13.5px] font-semibold text-foreground transition-colors hover:bg-accent"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-xl bg-california-red px-5 py-2.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-california-red-hover"
            >
              <Save className="h-4 w-4" />
              Aplicar
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
