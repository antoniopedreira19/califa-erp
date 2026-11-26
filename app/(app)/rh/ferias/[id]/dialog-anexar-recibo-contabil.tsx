"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Paperclip } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  anexarReciboContabilFolhaFerias,
  gerarUrlUploadReciboContabil,
} from "../actions-pagamentos";

export function DialogAnexarReciboContabil({
  aberto,
  folhaId,
  valorBasePreview,
  rotulo,
  onFechar,
}: {
  aberto: boolean;
  folhaId: string;
  valorBasePreview: number | null;
  rotulo: string;
  onFechar: () => void;
}) {
  const router = useRouter();
  const [arquivo, setArquivo] = React.useState<File | null>(null);
  const [valor, setValor] = React.useState<string>("");
  const [erro, setErro] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  // Reseta quando o dialog abre com uma folha diferente.
  // Nota: não pré-preenchemos o valor com salario_base pq ele é o BRUTO
  // calculado pelo sistema — o líquido do recibo (com IR + INSS) é o que o
  // RH precisa digitar. Mostramos o bruto só como referência no helper text.
  React.useEffect(() => {
    if (aberto) {
      setArquivo(null);
      setValor("");
      setErro(null);
    }
  }, [aberto, folhaId]);

  function handleAnexar() {
    setErro(null);
    const valorNum = Number(valor);
    if (!arquivo) {
      setErro("Selecione o PDF do recibo.");
      return;
    }
    if (arquivo.type !== "application/pdf") {
      setErro("Arquivo precisa ser PDF.");
      return;
    }
    const DEZ_MB = 10 * 1024 * 1024;
    if (arquivo.size > DEZ_MB) {
      setErro("PDF muito grande (máx. 10 MB).");
      return;
    }
    if (!Number.isFinite(valorNum) || valorNum <= 0) {
      setErro("Informe o valor líquido do recibo.");
      return;
    }

    startTransition(async () => {
      const res1 = await gerarUrlUploadReciboContabil({ folha_id: folhaId });
      if (!res1.ok) {
        setErro(res1.message);
        return;
      }

      try {
        const put = await fetch(res1.signed_url, {
          method: "PUT",
          body: arquivo,
          headers: { "Content-Type": "application/pdf" },
        });
        if (!put.ok) {
          setErro("Falha ao enviar PDF ao bucket (" + put.status + ").");
          return;
        }
      } catch (e) {
        setErro(
          "Falha ao enviar PDF ao bucket: " +
            (e instanceof Error ? e.message : String(e)),
        );
        return;
      }

      const res2 = await anexarReciboContabilFolhaFerias({
        folha_id: folhaId,
        valor_liquido: valorNum,
        anexo_url: res1.path,
      });
      if (!res2.ok) {
        setErro(res2.message);
        return;
      }

      onFechar();
      router.refresh();
    });
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && !pending && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{rotulo}</DialogTitle>
          <DialogDescription>
            Anexe o PDF que a contabilidade enviou e informe o valor líquido
            que o financeiro vai pagar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="pdf-recibo">PDF do recibo</Label>
            <input
              id="pdf-recibo"
              type="file"
              accept="application/pdf"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-muted file:px-3 file:py-1.5 file:text-xs file:font-medium hover:file:bg-muted/80"
            />
            {arquivo && (
              <p className="text-[11px] text-muted-foreground truncate">
                {arquivo.name} ({Math.round(arquivo.size / 1024)} KB)
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="valor-liquido">Valor líquido (R$)</Label>
            <Input
              id="valor-liquido"
              type="number"
              step="0.01"
              min="0.01"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder="0,00"
              className="font-mono"
            />
            <p className="text-[11px] text-muted-foreground">
              Valor que o financeiro vai pagar efetivamente, já com desconto
              de IR e INSS.
              {valorBasePreview != null && (
                <>
                  {" "}Bruto calculado: R${" "}
                  {valorBasePreview.toLocaleString("pt-BR", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                  .
                </>
              )}
            </p>
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
            onClick={onFechar}
            disabled={pending}
            className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleAnexar}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white hover:bg-california-red/90 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Paperclip className="h-4 w-4" />
            {pending ? "Anexando..." : "Anexar"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
