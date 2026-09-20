"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Trash2, CheckCircle2, XCircle } from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DrawerContent,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { MoedaInput } from "@/components/ui/moeda-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Empresa } from "@/lib/types";
import { folhaLinhaStatusLabel } from "@/lib/types";
import {
  aprovarLinhaFolha,
  reprovarLinhaFolha,
} from "./actions-folhas";
import type { FolhaLinhaFinanceiro } from "./folhas-pagar-list";

type AlocEdit = {
  key: string;
  empresa_id: string;
  regional_id: string;
  percentual: string;
};

export function RevisarFolhaDrawer({
  linha,
  empresas,
  regionais,
  open,
  onOpenChange,
}: {
  linha: FolhaLinhaFinanceiro;
  empresas: Pick<Empresa, "id" | "nome_fantasia">[];
  regionais: { id: string; nome: string; empresa_id: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [alocacoes, setAlocacoes] = React.useState<AlocEdit[]>([]);
  const [modoReprova, setModoReprova] = React.useState(false);
  const [motivoReprova, setMotivoReprova] = React.useState("");
  const [salarioBase, setSalarioBase] = React.useState<string>("");

  React.useEffect(() => {
    if (!open) return;
    setError(null);
    setModoReprova(false);
    setMotivoReprova("");
    setSalarioBase(linha.salario_base);
    setAlocacoes(
      linha.alocacoes.map((a, i) => ({
        key: `${a.id}-${i}`,
        empresa_id: a.empresa_id,
        regional_id: a.regional_id,
        percentual: String(a.percentual),
      })),
    );
  }, [open, linha]);

  const podeAgir = linha.status === "enviada";

  const soma = alocacoes.reduce(
    (acc, a) => acc + (Number(String(a.percentual).replace(",", ".")) || 0),
    0,
  );
  const somaOk = Math.abs(soma - 100) < 0.01;

  function atualizar(index: number, patch: Partial<AlocEdit>) {
    setAlocacoes((prev) =>
      prev.map((a, i) => (i === index ? { ...a, ...patch } : a)),
    );
  }
  function adicionar() {
    setAlocacoes((prev) => [
      ...prev,
      {
        key: `new-${Date.now()}`,
        empresa_id: "",
        regional_id: "",
        percentual: "",
      },
    ]);
  }
  function remover(index: number) {
    setAlocacoes((prev) => prev.filter((_, i) => i !== index));
  }

  function handleAprovar() {
    setError(null);
    if (!podeAgir) return;
    if (!somaOk) {
      setError(`Soma precisa dar 100 (atual: ${soma.toFixed(2)}).`);
      return;
    }
    if (alocacoes.some((a) => !a.empresa_id || !a.regional_id)) {
      setError("Toda alocação precisa de empresa e regional.");
      return;
    }
    if (!salarioBase) {
      setError("Valor obrigatório.");
      return;
    }

    startTransition(async () => {
      const res = await aprovarLinhaFolha(linha.id, {
        salario_base: salarioBase,
        alocacoes: alocacoes.map((a) => ({
          empresa_id: a.empresa_id,
          regional_id: a.regional_id,
          percentual: (
            Math.round(Number(String(a.percentual).replace(",", ".")) * 100) /
            100
          ).toFixed(2),
        })),
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  function handleReprovar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (motivoReprova.trim().length < 3) {
      setError("Escreva o motivo (mínimo 3 caracteres).");
      return;
    }

    startTransition(async () => {
      const res = await reprovarLinhaFolha(linha.id, motivoReprova.trim());
      if (!res.ok) {
        setError(res.message);
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>{linha.colaborador.nome}</DialogTitle>
          <DialogDescription>
            {linha.colaborador.funcao} · Status atual:{" "}
            <span className="font-semibold text-foreground">
              {folhaLinhaStatusLabel(linha.status)}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {!podeAgir && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                {linha.status === "pendente_correcao"
                  ? "Aguardando o RH corrigir e reenviar. Não há ação sua neste momento."
                  : `Linha em status ${folhaLinhaStatusLabel(linha.status)} — sem ação disponível.`}
                {linha.status === "pendente_correcao" &&
                  linha.motivo_pendencia && (
                    <div className="mt-2">
                      <strong>Motivo que você registrou:</strong>{" "}
                      {linha.motivo_pendencia}
                    </div>
                  )}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="salario_base">Valor da folha</Label>
              <MoedaInput
                key={linha.id + linha.salario_base}
                id="salario_base"
                defaultValue={linha.salario_base}
                disabled={!podeAgir || modoReprova}
                onCentavosChange={(centavos) => {
                  if (!centavos) {
                    setSalarioBase("");
                    return;
                  }
                  const inteiros = centavos.slice(0, -2) || "0";
                  const dec = centavos.slice(-2).padStart(2, "0");
                  setSalarioBase(`${inteiros}.${dec}`);
                }}
              />
              <p className="text-xs text-muted-foreground">
                Se você mudar o valor, a próxima folha do colaborador vai
                nascer com este valor (propaga pra Camada 1).
              </p>
            </div>

            <div className="space-y-2">
              <Label>Alocação da folha</Label>
              <div className="space-y-2">
                {alocacoes.map((a, i) => {
                  const regionaisDaEmpresa = regionais
                    .filter((r) => r.empresa_id === a.empresa_id)
                    .sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR"));
                  return (
                    <div
                      key={a.key}
                      className="grid gap-2 rounded-lg border border-border p-3 md:grid-cols-[1fr_1fr_120px_auto]"
                    >
                      <Select
                        value={a.empresa_id}
                        onValueChange={(v) =>
                          atualizar(i, { empresa_id: v, regional_id: "" })
                        }
                        disabled={!podeAgir || modoReprova}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Empresa" />
                        </SelectTrigger>
                        <SelectContent>
                          {empresas.map((e) => (
                            <SelectItem key={e.id} value={e.id}>
                              {e.nome_fantasia}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={a.regional_id}
                        onValueChange={(v) => atualizar(i, { regional_id: v })}
                        disabled={!podeAgir || modoReprova || !a.empresa_id}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Regional" />
                        </SelectTrigger>
                        <SelectContent>
                          {regionaisDaEmpresa.map((r) => (
                            <SelectItem key={r.id} value={r.id}>
                              {r.nome}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="relative">
                        <Input
                          value={a.percentual}
                          onChange={(e) =>
                            atualizar(i, { percentual: e.target.value })
                          }
                          disabled={!podeAgir || modoReprova}
                          placeholder="0,00"
                          className="pr-7"
                          inputMode="decimal"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                          %
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => remover(i)}
                        disabled={
                          !podeAgir || modoReprova || alocacoes.length === 1
                        }
                        className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-california-red transition-colors disabled:opacity-30"
                        title="Remover"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
              {podeAgir && !modoReprova && (
                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={adicionar}
                    className="text-xs font-medium text-california-red hover:underline"
                  >
                    + Adicionar alocação
                  </button>
                  <p
                    className={`text-xs font-medium ${
                      somaOk ? "text-emerald-600" : "text-california-red"
                    }`}
                  >
                    Soma: {soma.toFixed(2)}%
                  </p>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Ao aprovar, cada linha de alocação vira um título em{" "}
                &ldquo;Títulos a Pagar&rdquo; com o valor rateado.
              </p>
            </div>

            {modoReprova && podeAgir && (
              <form onSubmit={handleReprovar} className="space-y-2">
                <Label htmlFor="motivo">Motivo da pendência</Label>
                <Input
                  id="motivo"
                  autoFocus
                  required
                  maxLength={500}
                  value={motivoReprova}
                  onChange={(e) => setMotivoReprova(e.target.value)}
                  placeholder="Ex.: PIX errado, salário fora do combinado"
                />
                <p className="text-xs text-muted-foreground">
                  O RH vai receber este motivo, corrigir e reenviar.
                </p>
              </form>
            )}

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-california-red/20 bg-california-red/5 px-3 py-2 text-xs text-california-red">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border p-4">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              Fechar
            </button>

            {podeAgir && (
              <div className="flex items-center gap-2">
                {modoReprova ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setModoReprova(false)}
                      className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
                    >
                      Voltar
                    </button>
                    <button
                      type="button"
                      onClick={handleReprovar as any}
                      disabled={pending || motivoReprova.trim().length < 3}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red/90 disabled:opacity-50 transition-colors"
                    >
                      <XCircle className="h-4 w-4" />
                      Enviar reprovação
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setModoReprova(true)}
                      disabled={pending}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-california-red/30 bg-white px-4 py-2 text-sm font-semibold text-california-red hover:bg-california-red/5 disabled:opacity-50 transition-colors"
                    >
                      <XCircle className="h-4 w-4" />
                      Reprovar
                    </button>
                    <button
                      type="button"
                      onClick={handleAprovar}
                      disabled={pending || !somaOk}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {pending ? "Aprovando..." : "Aprovar"}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </DrawerContent>
    </Dialog>
  );
}
