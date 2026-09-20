"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Trash2 } from "lucide-react";
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
import { editarLinhaFolhaRh } from "../actions";
import type { FolhaLinha } from "./folha-competencia-view";

type LinhaEdit = {
  key: string;
  empresa_id: string;
  regional_id: string;
  percentual: string;
};

export function EditarLinhaFolhaDrawer({
  linha,
  empresas,
  regionais,
  podeEditar,
  open,
  onOpenChange,
}: {
  linha: FolhaLinha;
  empresas: Pick<Empresa, "id" | "nome_fantasia">[];
  regionais: { id: string; nome: string; empresa_id: string }[];
  podeEditar: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [valor, setValor] = React.useState<string>("");
  const [alocacoes, setAlocacoes] = React.useState<LinhaEdit[]>([]);

  const modoEdicao =
    podeEditar &&
    (linha.status === "rascunho" || linha.status === "pendente_correcao");

  React.useEffect(() => {
    if (!open) return;
    setError(null);
    // valor: MoedaInput usa defaultValue não-controlado; passo via key
    setValor(linha.salario_base);
    setAlocacoes(
      linha.alocacoes.map((a, i) => ({
        key: `${a.id}-${i}`,
        empresa_id: a.empresa_id,
        regional_id: a.regional_id,
        percentual: String(a.percentual),
      })),
    );
  }, [open, linha]);

  const soma = alocacoes.reduce(
    (acc, a) => acc + (Number(String(a.percentual).replace(",", ".")) || 0),
    0,
  );
  const somaOk = Math.abs(soma - 100) < 0.01;

  function atualizar(index: number, patch: Partial<LinhaEdit>) {
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

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!modoEdicao) return;

    const formData = new FormData(e.currentTarget);
    const salarioBase = formData.get("salario_base")?.toString() ?? "";

    if (!salarioBase) {
      setError("Informe o valor da folha.");
      return;
    }
    if (!somaOk) {
      setError(`Soma dos percentuais precisa dar 100 (atual: ${soma.toFixed(2)}).`);
      return;
    }
    if (alocacoes.some((a) => !a.empresa_id || !a.regional_id)) {
      setError("Toda alocação precisa de empresa e regional.");
      return;
    }

    startTransition(async () => {
      const res = await editarLinhaFolhaRh(linha.id, {
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>{linha.colaborador.nome}</DialogTitle>
          <DialogDescription>
            {linha.colaborador.funcao}
            {linha.colaborador.nivel_codigo
              ? ` · Nível ${linha.colaborador.nivel_codigo}`
              : ""}{" "}
            · Status atual:{" "}
            <span className="font-semibold text-foreground">
              {folhaLinhaStatusLabel(linha.status)}
            </span>
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {linha.status === "pendente_correcao" && linha.motivo_pendencia && (
              <div className="flex items-start gap-2 rounded-lg border border-california-red/30 bg-california-red/5 p-3 text-sm text-california-red">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold">Motivo da pendência</p>
                  <p>{linha.motivo_pendencia}</p>
                </div>
              </div>
            )}

            {!modoEdicao && (
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Esta linha está em <strong>{folhaLinhaStatusLabel(linha.status)}</strong> e não pode ser editada pelo RH agora.
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="salario_base">Valor da folha</Label>
              <MoedaInput
                key={linha.id + linha.salario_base}
                id="salario_base"
                name="salario_base"
                defaultValue={linha.salario_base}
                disabled={!modoEdicao}
              />
              <p className="text-xs text-muted-foreground">
                Valor exato que será pago neste mês. Substitui o vigente do
                colaborador só nesta folha.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Alocação da folha</Label>
              <div className="space-y-2">
                {alocacoes.map((a, i) => {
                  const regionaisDaEmpresa = regionais
                    .filter((r) => r.empresa_id === a.empresa_id)
                    .sort((x, y) =>
                      x.nome.localeCompare(y.nome, "pt-BR"),
                    );
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
                        disabled={!modoEdicao}
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
                        disabled={!modoEdicao || !a.empresa_id}
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
                          disabled={!modoEdicao}
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
                        disabled={!modoEdicao || alocacoes.length === 1}
                        className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-california-red transition-colors disabled:opacity-30"
                        title="Remover"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
              {modoEdicao && (
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
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-california-red/20 bg-california-red/5 px-3 py-2 text-xs text-california-red">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-border p-4">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              {modoEdicao ? "Cancelar" : "Fechar"}
            </button>
            {modoEdicao && (
              <button
                type="submit"
                disabled={pending || !somaOk}
                className="rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white hover:bg-california-red/90 disabled:opacity-50 transition-colors"
              >
                {pending ? "Salvando..." : "Salvar"}
              </button>
            )}
          </div>
        </form>
      </DrawerContent>
    </Dialog>
  );
}
