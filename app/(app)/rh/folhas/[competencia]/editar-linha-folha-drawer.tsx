"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, AlertTriangle, Calculator, Trash2 } from "lucide-react";
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
import { editarLinhaFolhaRh, enviarLinhaFolha } from "../actions";
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
  beneficiosAplicado,
  open,
  onOpenChange,
}: {
  linha: FolhaLinha;
  empresas: Pick<Empresa, "id" | "nome_fantasia">[];
  regionais: { id: string; nome: string; empresa_id: string }[];
  podeEditar: boolean;
  beneficiosAplicado: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [valor, setValor] = React.useState<string>("");
  const [alocacoes, setAlocacoes] = React.useState<LinhaEdit[]>([]);

  // Edição bloqueada quando benefícios aplicados numa linha PJ. Pra editar,
  // Kika precisa Desaplicar benefícios pelo card da folha.
  const edicaoBloqueadaPorBeneficios =
    beneficiosAplicado && linha.origem === "california";

  const modoEdicao =
    podeEditar &&
    !edicaoBloqueadaPorBeneficios &&
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
          <DialogTitle className="uppercase">{linha.colaborador.nome}</DialogTitle>
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

            {edicaoBloqueadaPorBeneficios && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  Benefícios aplicados nesta competência. Para editar valores PJ,
                  desaplique os benefícios no card da folha PJ primeiro.
                </span>
              </div>
            )}
            {!modoEdicao && !edicaoBloqueadaPorBeneficios && (
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Esta linha está em <strong>{folhaLinhaStatusLabel(linha.status)}</strong> e não pode ser editada pelo RH agora.
              </div>
            )}

            <CalculoBreakdown linha={linha} />

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

          <div className="flex items-center justify-between gap-3 border-t border-border p-4">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              {modoEdicao ? "Cancelar" : "Fechar"}
            </button>
            {modoEdicao && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    startTransition(async () => {
                      const res = await enviarLinhaFolha(linha.id);
                      if (!res.ok) {
                        setError(res.message);
                        return;
                      }
                      onOpenChange(false);
                      router.refresh();
                    });
                  }}
                  disabled={pending}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-600 bg-white px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 transition-colors"
                >
                  Enviar pro financeiro
                </button>
                <button
                  type="submit"
                  disabled={pending || !somaOk}
                  className="rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white hover:bg-california-red/90 disabled:opacity-50 transition-colors"
                >
                  {pending ? "Salvando..." : "Salvar"}
                </button>
              </div>
            )}
          </div>
        </form>
      </DrawerContent>
    </Dialog>
  );
}

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/**
 * Bloco visual de breakdown do cálculo da linha: Contratual → Férias → Desc
 * benefícios → Líquido. Só aparece quando há algum ajuste (férias OU
 * desconto). Estilo inspirado no módulo de férias (bordas suaves, grid
 * base + composição linha a linha + total destacado).
 */
function CalculoBreakdown({ linha }: { linha: FolhaLinha }) {
  // Só PJ (origem california) tem breakdown; CLT vem líquido da contabilidade.
  if (linha.origem !== "california") return null;

  const liquido = Number(linha.salario_base);
  const desconto = Number(linha.desconto_beneficios);
  const diasFerias = linha.dias_ferias_mes;
  const contratual = linha.salario_contratual;

  const temDesconto = desconto > 0;
  const temFerias = diasFerias > 0;

  // Nada a exibir: sem férias E sem desconto.
  if (!temDesconto && !temFerias) return null;

  // Precisa do contratual pra calcular desconto de férias.
  const brutoMes = liquido + desconto;
  const temBreakdownFerias =
    temFerias && contratual !== null && contratual > brutoMes;
  const descontoFerias = temBreakdownFerias
    ? (contratual as number) - brutoMes
    : 0;
  const diario = contratual !== null ? contratual / 30 : null;

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Calculator className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Cálculo do mês
        </h3>
      </div>

      {/* Base: contratual + diário */}
      {contratual !== null && (
        <div className="grid grid-cols-2 gap-3 text-xs mb-3 pb-3 border-b border-border">
          <div>
            <p className="text-muted-foreground">Salário contratual</p>
            <p className="font-mono font-semibold text-sm mt-0.5">
              {brl.format(contratual)}
            </p>
          </div>
          {diario !== null && temBreakdownFerias && (
            <div>
              <p className="text-muted-foreground">Diário (/ 30)</p>
              <p className="font-mono font-semibold text-sm mt-0.5">
                {brl.format(diario)}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Composição */}
      <div className="space-y-1.5 text-sm">
        {temBreakdownFerias && (
          <>
            <LinhaCalculo
              label={`Férias (${diasFerias} dia${diasFerias === 1 ? "" : "s"} × diário)`}
              valor={-descontoFerias}
              cor="amber"
            />
            <LinhaCalculo
              label="Bruto do mês (pós-férias)"
              valor={brutoMes}
              sutil
            />
          </>
        )}
        {!temBreakdownFerias && (
          <LinhaCalculo
            label={temFerias ? `Bruto do mês` : "Bruto"}
            valor={brutoMes}
            sutil
          />
        )}
        {temDesconto && (
          <LinhaCalculo
            label="Benefícios (operadora)"
            valor={-desconto}
            cor="vermelho"
          />
        )}
      </div>

      {/* Líquido final */}
      <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-foreground">
          Líquido a pagar
        </span>
        <span className="font-mono text-lg font-bold text-foreground">
          {brl.format(liquido)}
        </span>
      </div>
    </div>
  );
}

function LinhaCalculo({
  label,
  valor,
  cor,
  sutil,
}: {
  label: string;
  valor: number;
  cor?: "vermelho" | "amber";
  sutil?: boolean;
}) {
  const corTexto =
    cor === "vermelho"
      ? "text-california-red"
      : cor === "amber"
        ? "text-amber-700"
        : sutil
          ? "text-muted-foreground"
          : "text-foreground";
  const sinal = valor < 0 ? "−" : "";
  const abs = Math.abs(valor);
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={sutil ? "text-foreground/70" : "text-foreground/80"}>
        {label}
      </span>
      <span className={`font-mono font-semibold ${corTexto}`}>
        {sinal}
        {brl.format(abs)}
      </span>
    </div>
  );
}
