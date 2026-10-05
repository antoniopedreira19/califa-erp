"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { criarVinculo } from "@/lib/actions/beneficios/vinculos";
import type { BeneficioModoCusteio } from "@/lib/types";

const MODOS: Array<{ value: BeneficioModoCusteio; label: string; descricao: string }> = [
  {
    value: "rateado",
    label: "Rateado 60/40",
    descricao: "Padrão. Empresa paga 60% do titular (saúde); dependentes 100% colaborador.",
  },
  {
    value: "integral_empresa",
    label: "Integral empresa",
    descricao: "Acordo individual. Empresa paga 100% do titular. Dependentes seguem 100% colaborador.",
  },
  {
    value: "integral_empresa_com_upgrade",
    label: "Integral + upgrade",
    descricao: "Empresa cobre o valor do plano base (ex.: Direto); colaborador paga a diferença (ex.: Especial − Direto).",
  },
];

type BeneficioOpcao = {
  id: string;
  nome: string;
  tipo: "saude" | "dental";
  beneficio_base_id: string | null;
};

export function FormVinculo({
  open,
  onOpenChange,
  colaboradorId,
  beneficios,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  colaboradorId: string;
  beneficios: BeneficioOpcao[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [beneficioId, setBeneficioId] = useState<string>(beneficios[0]?.id ?? "");
  const [modo, setModo] = useState<BeneficioModoCusteio>("rateado");
  const [dataInicio, setDataInicio] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [observacao, setObservacao] = useState<string>("");

  const beneficioSelecionado = beneficios.find((b) => b.id === beneficioId);
  const upgradeDisponivel = Boolean(beneficioSelecionado?.beneficio_base_id);

  function submeter() {
    setErro(null);
    start(async () => {
      const res = await criarVinculo({
        colaboradorId,
        beneficioId,
        modoCusteio: modo,
        dataInicio,
        observacao: observacao || null,
      });
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Novo vínculo de benefício</DialogTitle>
          <DialogDescription>
            Vincule o colaborador a um plano. Dependentes podem ser incluídos depois na aba &quot;Dependentes&quot;.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Benefício</label>
            <select
              value={beneficioId}
              onChange={(e) => {
                setBeneficioId(e.target.value);
                const b = beneficios.find((b) => b.id === e.target.value);
                if (modo === "integral_empresa_com_upgrade" && !b?.beneficio_base_id) {
                  setModo("rateado");
                }
              }}
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-california-red/20"
            >
              {beneficios.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nome} ({b.tipo === "saude" ? "Saúde" : "Dental"})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Modo de custeio</label>
            <div className="space-y-2">
              {MODOS.map((m) => {
                const desabilitado = m.value === "integral_empresa_com_upgrade" && !upgradeDisponivel;
                return (
                  <label
                    key={m.value}
                    className={`flex gap-3 rounded-md border p-3 text-sm transition-colors ${
                      modo === m.value
                        ? "border-california-red bg-california-red/5"
                        : "border-border hover:bg-muted/30"
                    } ${desabilitado ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    <input
                      type="radio"
                      checked={modo === m.value}
                      disabled={desabilitado}
                      onChange={() => setModo(m.value)}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="font-medium">{m.label}</div>
                      <div className="text-xs text-muted-foreground">{m.descricao}</div>
                      {desabilitado && (
                        <div className="mt-1 text-xs text-amber-700">
                          Benefício escolhido não é um upgrade de outro plano.
                        </div>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Data de início</label>
            <input
              type="date"
              value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-california-red/20"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">
              Observação (opcional)
            </label>
            <textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              rows={2}
              maxLength={500}
              className="w-full rounded-md border border-border bg-background p-2 text-sm focus:outline-none focus:ring-2 focus:ring-california-red/20"
            />
          </div>

          {erro && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              {erro}
            </div>
          )}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={pending}
            className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={submeter}
            disabled={pending || !beneficioId}
            className="rounded-md bg-california-red px-4 py-2 text-sm font-medium text-white hover:bg-california-red/90 disabled:opacity-50"
          >
            {pending ? "Salvando…" : "Vincular"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
