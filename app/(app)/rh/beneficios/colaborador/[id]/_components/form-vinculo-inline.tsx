"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { X } from "lucide-react";
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

export function FormVinculoInline({
  colaboradorId,
  beneficios,
}: {
  colaboradorId: string;
  beneficios: BeneficioOpcao[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
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

  const beneficioSelecionado = beneficios.find((b) => b.id === beneficioId);
  const upgradeDisponivel = Boolean(beneficioSelecionado?.beneficio_base_id);

  function fechar() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("novo");
    router.push(`${pathname}?${params.toString()}`);
  }

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
      const params = new URLSearchParams(searchParams.toString());
      params.delete("novo");
      router.push(`${pathname}?${params.toString()}`);
      router.refresh();
    });
  }

  return (
    <section className="rounded-xl border border-california-red/30 bg-california-red/5 p-5 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Novo vínculo de benefício
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Dependentes podem ser incluídos depois na aba Dependentes.
          </p>
        </div>
        <button
          type="button"
          onClick={fechar}
          disabled={pending}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Fechar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr_180px]">
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">
            Benefício
          </label>
          <Select
            value={beneficioId}
            onValueChange={(v) => {
              setBeneficioId(v);
              const b = beneficios.find((x) => x.id === v);
              if (modo === "integral_empresa_com_upgrade" && !b?.beneficio_base_id) {
                setModo("rateado");
              }
            }}
          >
            <SelectTrigger className="h-9">
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
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODOS.map((m) => {
                const desabilitado =
                  m.value === "integral_empresa_com_upgrade" && !upgradeDisponivel;
                return (
                  <SelectItem key={m.value} value={m.value} disabled={desabilitado}>
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
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-california-red/20"
          />
        </div>
      </div>

      <div className="mt-4">
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
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {erro}
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={fechar}
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
      </div>
    </section>
  );
}
