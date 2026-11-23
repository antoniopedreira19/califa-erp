"use client";
// O selo de status do título e o "Lançar a conta" (decisão 272).
// Na conta que varia, o título nasce com o valor estimado e "Aguardando
// conta"; quando a fatura chega, alguém lança o valor real, o vencimento e o
// documento, e o título passa a "A pagar".
import * as React from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DocumentoDoAnexoField } from "@/components/financeiro/documento-do-anexo-field";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DocumentoDoAnexo, DocumentoTipo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { lancarContaDoTitulo } from "../actions-recorrentes";
import { CampoDoArquivo, desfazerEnvio, enviarArquivo } from "./documento";
import { ROTULO_DO_ESTADO, brl, type Estado, type Recorrencia, type TituloDaRecorrencia } from "./dados";

const COR: Record<Estado, string> = {
  aguardando: "border-amber-300 bg-amber-50 text-amber-800",
  previsto: "border-border bg-muted/50 text-muted-foreground",
  a_pagar: "border-blue-200 bg-blue-50 text-blue-700",
  atrasado: "border-california-red/30 bg-california-red/5 text-california-red",
  sem_extrato: "border-border bg-muted/60 text-muted-foreground",
  a_conciliar: "border-emerald-300 bg-white text-emerald-700",
  pago: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

/** O selo do status, com a explicação na dica. */
export function Selo({ e, dica }: { e: Estado; dica?: string }) {
  const s = (
    <span className={cn("inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider", COR[e])}>
      {ROTULO_DO_ESTADO[e]}
    </span>
  );
  if (!dica) return s;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{s}</TooltipTrigger>
      <TooltipContent className="max-w-xs">{dica}</TooltipContent>
    </Tooltip>
  );
}

/** Valor digitado em reais ("1.874,32" ou "1874.32") para número. */
function lerValor(v: string): number {
  const t = v.trim();
  if (!t) return NaN;
  return Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
}

export function LancarConta({
  rec,
  titulo,
  tenantId,
  onFechar,
  onLancada,
}: {
  rec: Pick<Recorrencia, "codigo" | "descricao"> | null;
  titulo: TituloDaRecorrencia | null;
  tenantId: string;
  onFechar: () => void;
  onLancada: (mensagem: string) => void;
}) {
  const [arquivo, setArquivo] = React.useState<File | null>(null);
  const [doc, setDoc] = React.useState<DocumentoDoAnexo>({ tipo: "fatura", numero: null });
  const [valor, setValor] = React.useState("");
  const [venc, setVenc] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);
  const [pendente, setPendente] = React.useState(false);
  React.useEffect(() => {
    setArquivo(null);
    setDoc({ tipo: "fatura", numero: null });
    setValor("");
    setVenc(titulo?.vencimento ?? "");
    setErro(null);
  }, [titulo?.id, titulo?.vencimento]);

  if (!rec || !titulo) return null;
  const t = titulo;
  const v = lerValor(valor);
  const dif = v > 0 ? Math.round((v - t.valor) * 100) / 100 : 0;

  async function salvar() {
    if (!arquivo) return setErro("Anexe a fatura ou o boleto.");
    if (!doc.tipo) return setErro("Escolha o tipo do documento.");
    if (!(v > 0)) return setErro("Informe o valor da conta.");
    if (!venc) return setErro("Informe o vencimento.");
    setErro(null);
    setPendente(true);
    const envio = await enviarArquivo(tenantId, arquivo);
    if (!envio.ok) {
      setPendente(false);
      return setErro(envio.message);
    }
    const r = await lancarContaDoTitulo(t.id, {
      valor: v,
      vencimento: venc,
      anexo: { ...envio.arquivo, tipo: doc.tipo as DocumentoTipo, numero: doc.numero?.trim() || null },
    });
    setPendente(false);
    if (!r.ok) {
      await desfazerEnvio(envio.arquivo.path);
      return setErro(r.message);
    }
    onLancada(`Conta lançada: ${t.codigo} passa a ${brl(v)}, a pagar.`);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pendente && onFechar()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Lançar a conta</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{rec.codigo}</span> · {rec.descricao} · <span className="whitespace-nowrap font-mono">{t.codigo}</span>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Fatura ou boleto *</Label>
            <CampoDoArquivo arquivo={arquivo} onEscolher={setArquivo} />
          </div>
          <div className="space-y-1.5">
            <Label>Tipo e número *</Label>
            <DocumentoDoAnexoField valor={doc} onChange={setDoc} descricaoArquivo={arquivo?.name ?? "conta"} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="conta-valor">Valor da conta (R$) *</Label>
              <Input
                id="conta-valor"
                inputMode="decimal"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder={t.valor.toFixed(2).replace(".", ",")}
              />
              <p className="text-xs text-muted-foreground">
                Estimado: {brl(t.valor)}
                {v > 0 && Math.abs(dif) >= 0.005 && (
                  <span className={cn("ml-1 font-semibold", dif > 0 ? "text-amber-800" : "text-emerald-700")}>
                    ({dif > 0 ? "+" : ""}
                    {brl(dif)})
                  </span>
                )}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="conta-venc">Vencimento *</Label>
              <Input id="conta-venc" type="date" value={venc} onChange={(e) => setVenc(e.target.value)} />
            </div>
          </div>
          {erro && <p className="text-sm text-california-red">{erro}</p>}
        </div>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onFechar}
            disabled={pendente}
            className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={salvar}
            disabled={pendente}
            className="rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-california-red-hover disabled:opacity-60"
          >
            {pendente ? "Lançando…" : "Lançar a conta"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
