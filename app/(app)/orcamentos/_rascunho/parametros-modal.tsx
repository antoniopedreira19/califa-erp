"use client";

import * as React from "react";
import { Lock, Save } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ALIQUOTAS_IMPOSTO,
  aliquotaParaValor,
  formatarAliquota,
  valorInicialAliquota,
} from "@/lib/impostos";
import type { ParametrosVersao } from "./tipos";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parametros: ParametrosVersao;
  onSalvar: (parametros: ParametrosVersao) => void;
  /** Nome do cliente do projeto, para o rótulo do campo travado. */
  clienteNome?: string;
  /** Orçamento internacional e quem edita sem `orcamentos.editar_impostos`:
   *  Impostos BR só de leitura (decisão do Tiago, 14/09/2026). A gravação
   *  recusa de novo. */
  travarImposto: boolean;
}

function paraEdicao(valor: number): string {
  return String(valor).replace(".", ",");
}

/**
 * Os impostos valem para TODAS as versões v1 criadas neste salvamento — no
 * orçamento do projeto os jobs são faturados sob as mesmas condições
 * comerciais.
 *
 * Moeda e taxa de câmbio saíram deste modal em 21/09/2026 (decisão 095): os
 * valores da planilha são sempre em reais. Os dois continuam no objeto de
 * parâmetros e atravessam o `salvar` pelo spread, sem que ninguém os edite.
 *
 * Honorários é a exceção: desde 11/08/2026 vem do cadastro do cliente e
 * não é digitável aqui. Nem planilha importada muda isso — o percentual do
 * cliente vence, e quem importou é avisado quando a planilha divergia.
 * Alterar só pelo "Editar" da tela da versão, e só como administrador.
 */
export function ParametrosModal({
  open,
  onOpenChange,
  parametros,
  onSalvar,
  clienteNome,
  travarImposto,
}: Props) {
  const [imposto, setImposto] = React.useState(
    valorInicialAliquota(parametros.percentual_imposto),
  );
  const [erro, setErro] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setImposto(valorInicialAliquota(parametros.percentual_imposto));
    setErro(null);
  }, [open, parametros]);

  function salvar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Alíquota em branco é permitida aqui: só a aprovação da versão exige uma
    // das opções. Sem escolha, preserva o que o rascunho já tinha.
    const impostoNum =
      imposto === "" ? parametros.percentual_imposto : Number(imposto);
    onSalvar({
      // Moeda, câmbio e os campos da cadeia internacional NÃO aparecem
      // neste modal, e por isso vêm por spread: reescrever o objeto campo a campo é como eles
      // seriam zerados por um formulário que nem sabe que existem
      // (decisão 072).
      ...parametros,
      // Honorários não é editável aqui: segue o que veio do cadastro.
      percentual_honorarios: parametros.percentual_honorarios,
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
              Valem para todos os orçamentos deste rascunho. Honorários vem
              do cadastro do cliente e não é editável aqui.
            </DialogDescription>
          </div>

          {erro && (
            <div className="border-y border-california-red/20 bg-california-red/5 px-7 py-2.5 text-xs text-california-red">
              {erro}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 px-7 pb-6 pt-1">
            <div className="space-y-2">
              <Label
                htmlFor="percentual_honorarios"
                className="flex items-center gap-1.5"
              >
                Honorários (%)
                <Lock className="h-3 w-3 text-muted-foreground" />
              </Label>
              <Input
                id="percentual_honorarios"
                value={paraEdicao(parametros.percentual_honorarios)}
                readOnly
                disabled
                className="bg-muted/50 text-muted-foreground"
              />
              <p className="text-[11px] leading-snug text-muted-foreground">
                Cadastro de {clienteNome ?? "cliente"}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="percentual_imposto">Impostos (%)</Label>
{travarImposto ? (
                <Input
                  value={`${paraEdicao(parametros.percentual_imposto)}%`}
                  readOnly
                  disabled
                  className="bg-muted/50 text-muted-foreground"
                />
              ) : (
                              <Select value={imposto} onValueChange={setImposto}>
                <SelectTrigger id="percentual_imposto">
                  <SelectValue placeholder="Selecione a alíquota" />
                </SelectTrigger>
                <SelectContent>
                  {ALIQUOTAS_IMPOSTO.map((a) => (
                    <SelectItem key={a} value={aliquotaParaValor(a)}>
                      {formatarAliquota(a)}%
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              )}
              {travarImposto && (
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Só administrador ou gerente de projeto altera os impostos de
                  orçamento internacional.
                </p>
              )}
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
