"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { criarVinculo } from "@/lib/actions/beneficios/vinculos";
import type { BeneficioModoCusteio, BeneficioTipo } from "@/lib/types";

type BeneficioOpcao = {
  id: string;
  nome: string;
  tipo: BeneficioTipo;
  beneficio_base_id: string | null;
};

const MODOS: Array<{
  value: BeneficioModoCusteio;
  label: string;
  descricao: string;
}> = [
  {
    value: "rateado",
    label: "Rateado 60/40",
    descricao:
      "Padrão. Empresa paga 60% do titular (saúde); dependentes 100% colaborador.",
  },
  {
    value: "integral_empresa",
    label: "Integral empresa",
    descricao: "Acordo individual. Empresa paga 100% do titular.",
  },
  {
    value: "integral_empresa_com_upgrade",
    label: "Integral + upgrade",
    descricao:
      "Empresa cobre o valor do plano base (ex.: Direto); colaborador paga a diferença.",
  },
];

export function ModalNovoVinculo({
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
  const [beneficioId, setBeneficioId] = useState<string>(
    beneficios[0]?.id ?? "",
  );
  const [modo, setModo] = useState<BeneficioModoCusteio>("rateado");
  const [dataInicio, setDataInicio] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [observacao, setObservacao] = useState<string>("");

  // Reset no abrir
  useEffect(() => {
    if (!open) return;
    setBeneficioId(beneficios[0]?.id ?? "");
    setModo("rateado");
    setDataInicio(new Date().toISOString().slice(0, 10));
    setObservacao("");
    setErro(null);
  }, [open, beneficios]);

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
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Novo benefício</DialogTitle>
          <DialogDescription>
            Dependentes podem ser incluídos depois na aba Dependentes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">
              Benefício
            </label>
            <Select
              value={beneficioId}
              onValueChange={(v) => {
                setBeneficioId(v);
                const b = beneficios.find((x) => x.id === v);
                if (
                  modo === "integral_empresa_com_upgrade" &&
                  !b?.beneficio_base_id
                ) {
                  setModo("rateado");
                }
              }}
            >
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {beneficios.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.nome} ({b.tipo === "saude" ? "Saúde" : "Dental"})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">
              Modo de custeio
            </label>
            <Select
              value={modo}
              onValueChange={(v) => setModo(v as BeneficioModoCusteio)}
            >
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODOS.map((m) => {
                  const desabilitado =
                    m.value === "integral_empresa_com_upgrade" &&
                    !upgradeDisponivel;
                  return (
                    <SelectItem
                      key={m.value}
                      value={m.value}
                      disabled={desabilitado}
                    >
                      {m.label}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {MODOS.find((m) => m.value === modo)?.descricao}
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">
              Data de início
            </label>
            <input
              type="date"
              value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)}
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-california-red/20"
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
              className="w-full resize-none rounded-md border border-border bg-background p-2 text-sm focus:outline-none focus:ring-2 focus:ring-california-red/20"
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
