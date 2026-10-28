"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AlocacaoVigenteSnapshot } from "@/lib/types";
import {
  validarInputPacote,
  type InputPacote,
} from "@/lib/alocacao/validar-input-pacote";
import { alterarAlocacao } from "./actions-alocacao";

// ─── Tipos internos ───────────────────────────────────────────────────────────

type ItemRegional = {
  regional_id: string;
  percentual_regional: number;
};

type ItemEmpresa = {
  /** id temporário para React key — não vai ao banco */
  _key: string;
  empresa_id: string;
  percentual_empresa: number;
  usa_rateio_empresa: boolean;
  regionais: (ItemRegional & { _key: string })[];
};

// ─── Props ───────────────────────────────────────────────────────────────────

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  colaboradorId: string;
  snapshotAtual: AlocacaoVigenteSnapshot | null;
  empresas: Array<{ id: string; nome_fantasia: string | null }>;
  regionaisPorEmpresa: Record<string, Array<{ id: string; nome: string }>>;
  onSucesso?: () => void;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

let _keyCounter = 0;
function newKey() {
  return String(++_keyCounter);
}

function itemVazio(): ItemEmpresa {
  return {
    _key: newKey(),
    empresa_id: "",
    percentual_empresa: 100,
    usa_rateio_empresa: false,
    regionais: [],
  };
}

/** Inicializa itens a partir do snapshot vigente, ou retorna 1 item vazio. */
function itensDoSnapshot(
  snapshot: AlocacaoVigenteSnapshot | null,
): ItemEmpresa[] {
  if (!snapshot || snapshot.itens.length === 0) return [itemVazio()];
  return snapshot.itens.map((item) => ({
    _key: newKey(),
    empresa_id: item.empresa_id,
    percentual_empresa: Number(item.percentual_empresa),
    usa_rateio_empresa: item.usa_rateio_empresa,
    regionais: item.regionais.map((reg) => ({
      _key: newKey(),
      regional_id: reg.regional_id,
      percentual_regional: Number(reg.percentual_regional),
    })),
  }));
}

/** Converte os itens internos para o shape que `validarInputPacote` aceita. */
function toInputPacote(itens: ItemEmpresa[]): InputPacote {
  return {
    itens: itens.map((item) => ({
      empresa_id: item.empresa_id,
      percentual_empresa: item.percentual_empresa,
      usa_rateio_empresa: item.usa_rateio_empresa,
      regionais: item.regionais.map((reg) => ({
        regional_id: reg.regional_id,
        percentual_regional: reg.percentual_regional,
      })),
    })),
  };
}

/** Soma dos percentuais de empresa arredondada a 2 casas. */
function somaEmpresas(itens: ItemEmpresa[]): number {
  return itens.reduce((acc, it) => acc + it.percentual_empresa, 0);
}

/** Soma dos percentuais regionais de um item. */
function somaRegionais(item: ItemEmpresa): number {
  return item.regionais.reduce((acc, r) => acc + r.percentual_regional, 0);
}

// ─── Subcomponente: toggle visual ────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${
        checked ? "bg-california-red" : "bg-muted-foreground/30"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transform transition-transform ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

// ─── Componente principal ────────────────────────────────────────────────────

export function ModalAlterarAlocacao({
  open,
  onOpenChange,
  colaboradorId,
  snapshotAtual,
  empresas,
  regionaisPorEmpresa,
  onSucesso,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);

  const [itens, setItens] = React.useState<ItemEmpresa[]>(() =>
    itensDoSnapshot(snapshotAtual),
  );
  const [dataMudanca, setDataMudanca] = React.useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [motivo, setMotivo] = React.useState<string>("");

  // Reinicializa o estado sempre que o modal for aberto
  React.useEffect(() => {
    if (!open) return;
    setItens(itensDoSnapshot(snapshotAtual));
    setDataMudanca(new Date().toISOString().slice(0, 10));
    setMotivo("");
    setErro(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Validação em tempo real ──────────────────────────────────────────────
  const validacao = validarInputPacote(toInputPacote(itens));
  const podeSubmeter = validacao.ok && Boolean(dataMudanca);

  const totalEmpresas = somaEmpresas(itens);
  const empresasOk = Math.abs(totalEmpresas - 100) <= 0.01;

  // ── Mutações de estado ───────────────────────────────────────────────────

  function atualizarItem(index: number, patch: Partial<ItemEmpresa>) {
    setItens((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }

  function adicionarEmpresa() {
    setItens((prev) => [...prev, itemVazio()]);
  }

  function removerEmpresa(index: number) {
    setItens((prev) => prev.filter((_, i) => i !== index));
  }

  function atualizarRegional(
    itemIndex: number,
    regIndex: number,
    patch: Partial<ItemRegional>,
  ) {
    setItens((prev) =>
      prev.map((item, i) => {
        if (i !== itemIndex) return item;
        return {
          ...item,
          regionais: item.regionais.map((reg, j) =>
            j === regIndex ? { ...reg, ...patch } : reg,
          ),
        };
      }),
    );
  }

  function adicionarRegional(itemIndex: number) {
    setItens((prev) =>
      prev.map((item, i) => {
        if (i !== itemIndex) return item;
        return {
          ...item,
          regionais: [
            ...item.regionais,
            {
              _key: newKey(),
              regional_id: "",
              percentual_regional: 0,
            },
          ],
        };
      }),
    );
  }

  function removerRegional(itemIndex: number, regIndex: number) {
    setItens((prev) =>
      prev.map((item, i) => {
        if (i !== itemIndex) return item;
        return {
          ...item,
          regionais: item.regionais.filter((_, j) => j !== regIndex),
        };
      }),
    );
  }

  function toggleRateio(itemIndex: number, on: boolean) {
    setItens((prev) =>
      prev.map((item, i) => {
        if (i !== itemIndex) return item;
        return {
          ...item,
          usa_rateio_empresa: on,
          // Ao ligar o rateio, limpa as regionais (regra 3)
          regionais: on ? [] : item.regionais,
        };
      }),
    );
  }

  // ── Submit ───────────────────────────────────────────────────────────────

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);

    if (!podeSubmeter) {
      if (!validacao.ok) {
        setErro(validacao.erros.join("; "));
      } else {
        setErro("Informe a data de mudança.");
      }
      return;
    }

    startTransition(async () => {
      const res = await alterarAlocacao(colaboradorId, {
        data_mudanca: dataMudanca,
        motivo: motivo || null,
        itens: toInputPacote(itens).itens,
      });

      if (!res.ok) {
        setErro(res.message);
        return;
      }

      onOpenChange(false);
      onSucesso?.();
      router.refresh();
    });
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Alterar alocação</DialogTitle>
          <DialogDescription>
            Fecha a vigente no dia anterior à data de mudança e abre este novo
            pacote.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* ── Lista de empresas ─────────────────────────────────────── */}
          <div className="space-y-3">
            {itens.map((item, itemIndex) => {
              const regionaisDaEmpresa = item.empresa_id
                ? (regionaisPorEmpresa[item.empresa_id] ?? [])
                : [];
              const somaReg = somaRegionais(item);
              const regsOk = item.usa_rateio_empresa
                ? true
                : Math.abs(somaReg - 100) <= 0.01;

              return (
                <div
                  key={item._key}
                  className="rounded-xl border border-border bg-muted/10 p-4 space-y-3"
                >
                  {/* Linha empresa + % + remover */}
                  <div className="flex items-end gap-2">
                    <div className="flex-1 space-y-1.5">
                      <Label className="text-xs">Empresa</Label>
                      <Select
                        value={item.empresa_id || "__placeholder__"}
                        onValueChange={(v) =>
                          atualizarItem(itemIndex, {
                            empresa_id: v === "__placeholder__" ? "" : v,
                            // Reseta regionais ao mudar empresa
                            regionais: [],
                            usa_rateio_empresa: false,
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione a empresa" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__placeholder__" disabled>
                            Selecione a empresa
                          </SelectItem>
                          {empresas.map((e) => (
                            <SelectItem key={e.id} value={e.id}>
                              {e.nome_fantasia ?? e.id}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="w-24 space-y-1.5">
                      <Label className="text-xs">% empresa</Label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.01}
                        value={item.percentual_empresa}
                        onChange={(e) =>
                          atualizarItem(itemIndex, {
                            percentual_empresa: Number(e.target.value),
                          })
                        }
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                    </div>

                    {itens.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removerEmpresa(itemIndex)}
                        className="mb-0.5 rounded-md p-2 text-muted-foreground hover:text-california-red hover:bg-california-red/5 transition-colors"
                        aria-label="Remover empresa"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {/* Toggle "Usar rateio da empresa" */}
                  {item.empresa_id && (
                    <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                      <div>
                        <p className="text-xs font-medium">
                          Usar rateio da empresa
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          Quando ativo, usa o rateio anual configurado — sem
                          regionais.
                        </p>
                      </div>
                      <Toggle
                        checked={item.usa_rateio_empresa}
                        onChange={(v) => toggleRateio(itemIndex, v)}
                      />
                    </div>
                  )}

                  {/* Sub-lista regionais (somente quando toggle OFF) */}
                  {item.empresa_id && !item.usa_rateio_empresa && (
                    <div className="space-y-2 pl-2 border-l-2 border-muted">
                      {item.regionais.map((reg, regIndex) => (
                        <div key={reg._key} className="flex items-end gap-2">
                          <div className="flex-1 space-y-1.5">
                            <Label className="text-xs">Regional</Label>
                            <Select
                              value={reg.regional_id || "__placeholder__"}
                              onValueChange={(v) =>
                                atualizarRegional(itemIndex, regIndex, {
                                  regional_id:
                                    v === "__placeholder__" ? "" : v,
                                })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Selecione a regional" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__placeholder__" disabled>
                                  Selecione a regional
                                </SelectItem>
                                {regionaisDaEmpresa.map((r) => (
                                  <SelectItem key={r.id} value={r.id}>
                                    {r.nome}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="w-24 space-y-1.5">
                            <Label className="text-xs">% regional</Label>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={0.01}
                              value={reg.percentual_regional}
                              onChange={(e) =>
                                atualizarRegional(itemIndex, regIndex, {
                                  percentual_regional: Number(e.target.value),
                                })
                              }
                              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            />
                          </div>

                          <button
                            type="button"
                            onClick={() => removerRegional(itemIndex, regIndex)}
                            className="mb-0.5 rounded-md p-2 text-muted-foreground hover:text-california-red hover:bg-california-red/5 transition-colors"
                            aria-label="Remover regional"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}

                      {/* Indicador soma regionais */}
                      {item.regionais.length > 0 && (
                        <p
                          className={`text-xs font-medium ${
                            regsOk
                              ? "text-emerald-600"
                              : "text-california-red"
                          }`}
                        >
                          Soma regionais: {somaReg.toFixed(2)}%
                          {!regsOk && " — deve ser 100%"}
                        </p>
                      )}

                      <button
                        type="button"
                        onClick={() => adicionarRegional(itemIndex)}
                        className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors border border-dashed border-muted-foreground/30"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        + regional
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Botão + empresa */}
            <button
              type="button"
              onClick={adicionarEmpresa}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors border border-dashed border-muted-foreground/30"
            >
              <Plus className="h-3.5 w-3.5" />
              + empresa
            </button>
          </div>

          {/* ── Rodapé ───────────────────────────────────────────────── */}
          <div
            className={`rounded-lg border px-4 py-3 ${
              empresasOk
                ? "border-emerald-200 bg-emerald-50/50"
                : "border-california-red/30 bg-california-red/5"
            }`}
          >
            <p
              className={`text-sm font-semibold ${
                empresasOk ? "text-emerald-700" : "text-california-red"
              }`}
            >
              Soma empresas: {totalEmpresas.toFixed(2)}%
              {empresasOk ? " ✓" : " — deve ser 100%"}
            </p>
            {!validacao.ok && (
              <ul className="mt-1 space-y-0.5">
                {validacao.erros.map((e, i) => (
                  <li key={i} className="text-xs text-california-red">
                    {e}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── Data e motivo ────────────────────────────────────────── */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Data da mudança</Label>
              <DatePicker
                name="data_mudanca_visual"
                defaultValue={dataMudanca}
                onDateChange={(d) =>
                  setDataMudanca(d ? d.toISOString().slice(0, 10) : "")
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label>
                Motivo{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  (opcional)
                </span>
              </Label>
              <input
                type="text"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ex.: mudança de contrato"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          </div>

          {/* Erro de ação do servidor */}
          {erro && (
            <div className="flex items-start gap-2 rounded-lg border border-california-red/20 bg-california-red/5 px-3 py-2 text-xs text-california-red">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{erro}</span>
            </div>
          )}

          {/* Botões */}
          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!podeSubmeter || pending}
              className="rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red/90 disabled:opacity-50 transition-colors"
            >
              {pending ? "Salvando..." : "Confirmar mudança"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
