"use client";
// Pausar, Reativar, Encerrar e Excluir (decisão 272). Pausar e Encerrar
// perguntam o que fazer com o título que já nasceu e está em aberto (a conta
// avulsa não tem status cancelado: o título sai pelo Excluir, com as mesmas
// travas). O Excluir só aparece na recorrência que nunca gerou título.
import * as React from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  encerrarContaRecorrente,
  excluirContaRecorrente,
  pausarContaRecorrente,
  reativarContaRecorrente,
} from "../actions-recorrentes";
import { brl, dia, proximasDatas, type Recorrencia } from "./dados";

export type Desativar = "pausar" | "encerrar" | "excluir" | "reativar";

export function DialogoDeDesativar({
  rec,
  qual,
  onFechar,
}: {
  rec: Recorrencia | null;
  qual: Desativar | null;
  /** `feito`: a mensagem do que aconteceu (vazio = só fechou). */
  onFechar: (feito?: string) => void;
}) {
  const abertos = rec ? rec.titulos.filter((t) => !t.pago && !t.travado) : [];
  const [excluir, setExcluir] = React.useState<string[]>([]);
  const [ultimo, setUltimo] = React.useState<string>("nenhum");
  const [erro, setErro] = React.useState<string | null>(null);
  const [pendente, startTransition] = React.useTransition();
  // Encerrar: o último vencimento que ainda vale ("nenhum" = exclui os em aberto).
  const opcoes = rec ? [...new Set([...abertos.map((t) => t.vencimento), ...proximasDatas(rec, rec.proxima_data, 3, rec.data_fim)])] : [];
  React.useEffect(() => {
    setExcluir([]);
    setErro(null);
    setUltimo(abertos.length ? abertos[abertos.length - 1].vencimento : "nenhum");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec?.id, qual]);

  if (!rec || !qual) return null;

  const excluidosNoEncerrar = ultimo === "nenhum" ? abertos : abertos.filter((t) => t.vencimento > ultimo);

  function confirmar() {
    if (!rec || !qual) return;
    setErro(null);
    startTransition(async () => {
      if (qual === "pausar") {
        const r = await pausarContaRecorrente(rec.id, excluir);
        if (!r.ok) return setErro(r.message);
        onFechar(
          `${rec.codigo} pausada.${excluir.length ? ` ${excluir.length === 1 ? "1 título em aberto excluído" : `${excluir.length} títulos em aberto excluídos`}.` : ""}`,
        );
      } else if (qual === "reativar") {
        const r = await reativarContaRecorrente(rec.id);
        if (!r.ok) return setErro(r.message);
        onFechar(`${rec.codigo} reativada.`);
      } else if (qual === "encerrar") {
        const r = await encerrarContaRecorrente(rec.id, ultimo === "nenhum" ? null : ultimo, excluidosNoEncerrar.map((t) => t.id));
        if (!r.ok) return setErro(r.message);
        onFechar(`${rec.codigo} encerrada${ultimo === "nenhum" ? "" : ` depois do vencimento de ${dia(ultimo)}`}.`);
      } else {
        const r = await excluirContaRecorrente(rec.id);
        if (!r.ok) return setErro(r.message);
        onFechar(`${rec.codigo} excluída.`);
      }
    });
  }

  const titulo = { pausar: "Pausar", encerrar: "Encerrar", excluir: "Excluir", reativar: "Reativar" }[qual];
  const texto = {
    pausar: "Para de gerar títulos até alguém reativar. Use quando o custo volta depois (contrato suspenso, férias coletivas).",
    encerrar: "O custo acabou: a recorrência fica no histórico, com os títulos já pagos, e não gera mais nada depois do último vencimento.",
    excluir: "Esta recorrência nunca gerou título: ela é apagada de vez.",
    reativar: "Volta a gerar títulos a partir do próximo vencimento. O que venceu enquanto estava parada não é gerado.",
  }[qual];

  return (
    <Dialog open onOpenChange={(o) => !o && !pendente && onFechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {titulo} {rec.codigo}?
          </DialogTitle>
          <DialogDescription>
            {rec.descricao} · {brl(rec.valor)}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{texto}</p>

        {qual === "pausar" && abertos.length > 0 && (
          <div className="space-y-2 rounded-xl border border-border p-3">
            <p className="text-sm font-medium">Já nasceram e estão em aberto:</p>
            {abertos.map((t) => (
              <label key={t.id} className="flex cursor-pointer items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-california-red"
                    checked={excluir.includes(t.id)}
                    onChange={(e) => setExcluir((c) => (e.target.checked ? [...c, t.id] : c.filter((x) => x !== t.id)))}
                  />
                  Excluir também o <span className="font-mono">{t.codigo}</span> · {dia(t.vencimento)}
                </span>
                <span className="font-mono text-xs">{brl(t.valor)}</span>
              </label>
            ))}
            <p className="text-xs text-muted-foreground">Sem marcar, o título continua em Títulos a Pagar para ser pago.</p>
          </div>
        )}

        {qual === "encerrar" && (
          <div className="space-y-2">
            <Label htmlFor="rec-ultimo">Último vencimento a pagar</Label>
            <Select value={ultimo} onValueChange={setUltimo}>
              <SelectTrigger id="rec-ultimo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {opcoes.map((d) => {
                  const t = abertos.find((x) => x.vencimento === d);
                  return (
                    <SelectItem key={d} value={d}>
                      {dia(d)} {t ? `· ${t.codigo} (já nasceu)` : "· ainda é previsão"}
                    </SelectItem>
                  );
                })}
                <SelectItem value="nenhum">Nenhum: não paga mais nada</SelectItem>
              </SelectContent>
            </Select>
            <p className={cn("text-xs", excluidosNoEncerrar.length ? "text-california-red" : "text-muted-foreground")}>
              {excluidosNoEncerrar.length
                ? `Exclui ${excluidosNoEncerrar.length === 1 ? "o título em aberto" : "os títulos em aberto"} ${excluidosNoEncerrar
                    .map((t) => `${t.codigo} (${dia(t.vencimento)})`)
                    .join(", ")}.`
                : ultimo === "nenhum"
                  ? "Nenhum título em aberto para excluir."
                  : `O ${dia(ultimo)} ainda é pago; depois dele, nada.`}
            </p>
          </div>
        )}

        {erro && <p className="text-sm text-california-red">{erro}</p>}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => onFechar()}
            disabled={pendente}
            className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-60"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={pendente}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-60",
              qual === "reativar" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-california-red hover:bg-california-red-hover",
            )}
          >
            {pendente ? "Aguarde…" : titulo}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
