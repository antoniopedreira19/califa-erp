"use client";

import { useState, useTransition, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { HeartPulse, Smile, Info } from "lucide-react";
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
import { DatePicker } from "@/components/ui/date-picker";
import { criarVinculo } from "@/lib/actions/beneficios/vinculos";
import type { BeneficioModoCusteio } from "@/lib/types";
import type { BeneficioCompleto } from "@/lib/queries/beneficios";
import {
  calcularPreviewVinculo,
  modosDisponiveisParaBeneficio,
} from "@/lib/beneficios/calcular-preview";
import { coresBeneficio } from "@/lib/beneficios/cores";

const MODO_META: Record<
  BeneficioModoCusteio,
  { label: string; descricao: string }
> = {
  rateado: {
    label: "Rateado 60/40",
    descricao: "Padrão. Empresa paga parte do titular; dependentes 100% colaborador.",
  },
  integral_empresa: {
    label: "Integral empresa",
    descricao: "Acordo individual. Empresa paga 100% do titular.",
  },
  integral_empresa_com_upgrade: {
    label: "Integral + upgrade",
    descricao:
      "Empresa cobre valor do plano base; colaborador paga a diferença.",
  },
};

const formatarBrl = (n: number) =>
  n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });

export function ModalNovoVinculo({
  open,
  onOpenChange,
  colaboradorId,
  beneficios,
  dataNascimentoTitular,
  ano,
  mes,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  colaboradorId: string;
  beneficios: BeneficioCompleto[];
  dataNascimentoTitular: string | null;
  ano: number;
  mes: number;
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

  // Modos disponíveis dependem do benefício escolhido
  const modosDisponiveis = useMemo(() => {
    if (!beneficioSelecionado) return [] as BeneficioModoCusteio[];
    return modosDisponiveisParaBeneficio(beneficioSelecionado);
  }, [beneficioSelecionado]);

  // Ajusta o modo se o atual não está disponível para o novo benefício
  useEffect(() => {
    if (!beneficioSelecionado) return;
    if (!modosDisponiveis.includes(modo)) {
      setModo(modosDisponiveis[0] ?? "rateado");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beneficioId]);

  // Preview — calcula só client-side, sem round-trip
  const preview = useMemo(() => {
    if (!beneficioSelecionado) return null;
    return calcularPreviewVinculo({
      beneficio: beneficioSelecionado,
      catalogoCompleto: beneficios,
      modo,
      dataNascimentoISO: dataNascimentoTitular,
      ano,
      mes,
    });
  }, [beneficioSelecionado, beneficios, modo, dataNascimentoTitular, ano, mes]);

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
            <Select value={beneficioId} onValueChange={setBeneficioId}>
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
                {modosDisponiveis.map((m) => (
                  <SelectItem key={m} value={m}>
                    {MODO_META[m].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {MODO_META[modo].descricao}
            </p>
          </div>

          {/* Preview contextual */}
          {beneficioSelecionado && (
            <PreviewContextual
              beneficio={beneficioSelecionado}
              preview={preview}
            />
          )}

          <div>
            <label
              htmlFor="novo-vinculo-data-inicio"
              className="mb-1 block text-xs font-medium text-foreground"
            >
              Data de início
            </label>
            <DatePicker
              name="data_inicio_vinculo"
              id="novo-vinculo-data-inicio"
              defaultValue={dataInicio}
              onDateChange={(d) =>
                setDataInicio(d ? d.toISOString().slice(0, 10) : "")
              }
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

/**
 * Bloco embaixo do seletor de modo que mostra:
 * - Idade do titular na competência
 * - Faixa resolvida (quando faixa_etaria)
 * - Valor cheio / empresa / colaborador
 */
function PreviewContextual({
  beneficio,
  preview,
}: {
  beneficio: BeneficioCompleto;
  preview: ReturnType<typeof calcularPreviewVinculo>;
}) {
  const cores = coresBeneficio(beneficio.tipo);
  const Icon = beneficio.tipo === "saude" ? HeartPulse : Smile;

  if (!preview) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Colaborador sem data de nascimento — não é possível calcular o valor
          agora. Preencha o cadastro para ver o custo real.
        </span>
      </div>
    );
  }

  const faixaLabel =
    beneficio.modelo_preco === "flat"
      ? "Valor único"
      : preview.faixa
      ? `Faixa ${preview.faixa.idade_min}${
          preview.faixa.idade_max === null
            ? "+"
            : "–" + preview.faixa.idade_max
        }`
      : "Faixa não cadastrada";

  const semValor =
    preview.valorCheio === null ||
    preview.valorEmpresa === null ||
    preview.valorColaborador === null;

  return (
    <div className={`rounded-md border p-3 ${cores.chip}`}>
      <div className="flex items-start gap-2">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${cores.icon}`} />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="text-xs">
            Titular com <strong>{preview.idade}</strong> anos na competência ·{" "}
            {faixaLabel}
            {preview.valorCheio !== null && (
              <>
                {" "}
                · Valor cheio{" "}
                <strong>{formatarBrl(preview.valorCheio)}</strong>
              </>
            )}
          </div>

          {semValor ? (
            <div className="rounded bg-background/60 p-2 text-xs text-muted-foreground">
              Faixa de preço não cadastrada para esta idade. Confira o catálogo.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded bg-background/60 p-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  California paga
                </div>
                <div className="text-base font-bold tabular-nums text-emerald-700">
                  {formatarBrl(preview.valorEmpresa!)}
                </div>
              </div>
              <div className="rounded bg-background/60 p-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Desconto folha
                </div>
                <div className="text-base font-bold tabular-nums text-amber-700">
                  {formatarBrl(preview.valorColaborador!)}
                </div>
              </div>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground">
            Valores do titular apenas, sem dependentes. Mês de referência: idade
            calculada no 1º dia da competência atual.
          </p>
        </div>
      </div>
    </div>
  );
}
