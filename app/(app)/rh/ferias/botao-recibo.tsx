"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileText, Download, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { gerarRecibo, obterUrlRecibo } from "./actions";

type FormatoRecibo = "ferias" | "abono" | "combinado";

type Props = {
  lancamentoId: string;
  temRecibo: boolean;
  tipoLancamento:
    | "usufruto"
    | "abono_combinado"
    | "abono_avulso"
    | "abono_excepcional";
  /** Se true, mostra só "Baixar recibo" (não oferece opção de gerar). */
  somenteLeitura?: boolean;
};

export function BotaoRecibo({
  lancamentoId,
  temRecibo,
  tipoLancamento,
  somenteLeitura,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [geradorAberto, setGeradorAberto] = React.useState(false);
  const [formato, setFormato] = React.useState<FormatoRecibo>(
    sugestaoFormato(tipoLancamento),
  );
  const [erro, setErro] = React.useState<string | null>(null);

  function baixar() {
    setErro(null);
    startTransition(async () => {
      const res = await obterUrlRecibo(lancamentoId);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      window.open(res.url, "_blank");
    });
  }

  function gerarEBaixar() {
    setErro(null);
    startTransition(async () => {
      const resGerar = await gerarRecibo({
        lancamento_id: lancamentoId,
        formato,
      });
      if (!resGerar.ok) {
        setErro(resGerar.message);
        return;
      }
      const resUrl = await obterUrlRecibo(lancamentoId);
      if (!resUrl.ok) {
        setErro(resUrl.message);
        return;
      }
      setGeradorAberto(false);
      window.open(resUrl.url, "_blank");
      router.refresh();
    });
  }

  if (temRecibo && somenteLeitura) {
    return (
      <button
        type="button"
        onClick={baixar}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
      >
        <Download className="h-3.5 w-3.5" />
        {pending ? "Abrindo..." : "Baixar recibo"}
      </button>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2">
        {temRecibo && (
          <button
            type="button"
            onClick={baixar}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-2.5 py-1 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            Baixar
          </button>
        )}
        <button
          type="button"
          onClick={() => setGeradorAberto(true)}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-lg border border-california-red bg-white px-2.5 py-1 text-xs font-medium text-california-red hover:bg-california-red/5 transition-colors disabled:opacity-50"
        >
          <FileText className="h-3.5 w-3.5" />
          {temRecibo ? "Regerar recibo" : "Gerar recibo"}
        </button>
      </div>

      <Dialog
        open={geradorAberto}
        onOpenChange={(o) => {
          setGeradorAberto(o);
          if (!o) setErro(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Gerar recibo (PJ)</DialogTitle>
            <DialogDescription>
              Escolhe o formato. O PDF é salvo e disponibilizado pro
              colaborador na página de perfil.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="formato-recibo">Formato</Label>
              <Select
                value={formato}
                onValueChange={(v) => setFormato(v as FormatoRecibo)}
              >
                <SelectTrigger id="formato-recibo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ferias">
                    Só férias (recibo de usufruto)
                  </SelectItem>
                  <SelectItem value="abono">
                    Só abono (recibo de abono)
                  </SelectItem>
                  <SelectItem value="combinado">
                    Combinado (férias + abono)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {erro && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                {erro}
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={() => setGeradorAberto(false)}
              className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={gerarEBaixar}
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white hover:bg-california-red/90 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FileText className="h-4 w-4" />
              {pending ? "Gerando..." : "Gerar e baixar"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function sugestaoFormato(
  tipo: Props["tipoLancamento"],
): FormatoRecibo {
  switch (tipo) {
    case "usufruto":
      return "ferias";
    case "abono_combinado":
      return "combinado";
    case "abono_avulso":
    case "abono_excepcional":
      return "abono";
  }
}
