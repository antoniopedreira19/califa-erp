"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HeartPulse, Smile, AlertTriangle } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { VinculoDoColaborador } from "@/lib/queries/beneficios";
import type { BeneficioModoCusteio } from "@/lib/types";
import { coresBeneficio } from "@/lib/beneficios/cores";
import {
  editarVinculo,
  encerrarVinculo,
  excluirVinculo,
  mudarModoCusteio,
} from "@/lib/actions/beneficios/vinculos";

const MODO_LABEL: Record<BeneficioModoCusteio, string> = {
  rateado: "Rateado 60/40",
  integral_empresa: "Integral empresa",
  integral_empresa_com_upgrade: "Integral + upgrade",
};

const formatarData = (iso: string) => {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
};

export function TabVinculos({
  vinculos,
  colaboradorTemCpf,
  colaboradorTemDataNasc,
}: {
  vinculos: VinculoDoColaborador[];
  colaboradorTemCpf: boolean;
  colaboradorTemDataNasc: boolean;
}) {
  const ativos = vinculos.filter((v) => v.data_fim === null);
  const encerrados = vinculos.filter((v) => v.data_fim !== null);

  const faltaCadastro = !colaboradorTemCpf || !colaboradorTemDataNasc;

  return (
    <div className="space-y-5">
      {faltaCadastro && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            Este colaborador precisa de{" "}
            {!colaboradorTemCpf && !colaboradorTemDataNasc
              ? "CPF e data de nascimento"
              : !colaboradorTemCpf
              ? "CPF"
              : "data de nascimento"}{" "}
            preenchido no cadastro antes de vincular um benefício.
          </div>
        </div>
      )}

      {ativos.length === 0 && encerrados.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center text-sm text-muted-foreground">
          Nenhum vínculo cadastrado. Clique em “Novo Benefício” no topo.
        </div>
      )}

      {ativos.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Ativos ({ativos.length})
          </h3>
          <div className="space-y-2">
            {ativos.map((v) => (
              <LinhaVinculo key={v.id} vinculo={v} ativo />
            ))}
          </div>
        </section>
      )}

      {encerrados.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Encerrados / anteriores
          </h3>
          <div className="space-y-2">
            {encerrados.map((v) => (
              <LinhaVinculo key={v.id} vinculo={v} ativo={false} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function LinhaVinculo({
  vinculo,
  ativo,
}: {
  vinculo: VinculoDoColaborador;
  ativo: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mostrarMudar, setMostrarMudar] = useState(false);
  const [mostrarEditar, setMostrarEditar] = useState(false);
  const [novoModo, setNovoModo] = useState<BeneficioModoCusteio>(
    vinculo.modo_custeio,
  );
  const [dataInicio, setDataInicio] = useState(vinculo.data_inicio);
  const [dataFim, setDataFim] = useState<string>(vinculo.data_fim ?? "");
  const [observacao, setObservacao] = useState(vinculo.observacao ?? "");
  const Icon = vinculo.beneficio_tipo === "saude" ? HeartPulse : Smile;
  const cores = coresBeneficio(vinculo.beneficio_tipo);

  function encerrar() {
    if (!confirm(`Encerrar vínculo com ${vinculo.beneficio_nome} na data de hoje?`)) {
      return;
    }
    start(async () => {
      const hoje = new Date().toISOString().slice(0, 10);
      const res = await encerrarVinculo({
        vinculoId: vinculo.id,
        dataFim: hoje,
      });
      if (!res.ok) {
        alert(res.message);
        return;
      }
      router.refresh();
    });
  }

  function excluir() {
    if (
      !confirm(
        `Excluir o vínculo com ${vinculo.beneficio_nome}? Esta ação remove o registro e não pode ser desfeita.\n\nSó use quando o vínculo foi cadastrado por engano. Para encerrar um benefício que existiu de verdade, prefira o botão "Encerrar".`,
      )
    ) {
      return;
    }
    start(async () => {
      const res = await excluirVinculo({ vinculoId: vinculo.id });
      if (!res.ok) {
        alert(res.message);
        return;
      }
      router.refresh();
    });
  }

  function editar() {
    start(async () => {
      const res = await editarVinculo({
        vinculoId: vinculo.id,
        dataInicio,
        dataFim: dataFim || null,
        observacao: observacao || null,
      });
      if (!res.ok) {
        alert(res.message);
        return;
      }
      setMostrarEditar(false);
      router.refresh();
    });
  }

  function mudar() {
    if (novoModo === vinculo.modo_custeio) {
      setMostrarMudar(false);
      return;
    }
    start(async () => {
      const res = await mudarModoCusteio({
        vinculoId: vinculo.id,
        novoModo,
      });
      if (!res.ok) {
        alert(res.message);
        return;
      }
      setMostrarMudar(false);
      router.refresh();
    });
  }

  return (
    <div
      className={`rounded-xl border p-4 shadow-soft ${
        ativo ? "border-border bg-card" : "border-border/60 bg-muted/20 opacity-70"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${cores.bgSuave} ${cores.icon}`}
          >
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="font-medium text-foreground">
              {vinculo.beneficio_nome}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {MODO_LABEL[vinculo.modo_custeio]} · desde{" "}
              {formatarData(vinculo.data_inicio)}
              {vinculo.data_fim && (
                <> · até {formatarData(vinculo.data_fim)}</>
              )}
            </div>
            {vinculo.observacao && (
              <div className="mt-1.5 text-xs italic text-muted-foreground">
                {vinculo.observacao}
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-3 text-xs">
          <button
            type="button"
            onClick={() => setMostrarEditar((v) => !v)}
            disabled={pending}
            className="font-medium text-california-red hover:underline"
          >
            Editar
          </button>
          {ativo && (
            <>
              <button
                type="button"
                onClick={() => setMostrarMudar((v) => !v)}
                disabled={pending}
                className="font-medium text-california-red hover:underline"
              >
                Mudar modo
              </button>
              <button
                type="button"
                onClick={encerrar}
                disabled={pending}
                className="font-medium text-red-600 hover:underline"
              >
                Encerrar
              </button>
            </>
          )}
          <button
            type="button"
            onClick={excluir}
            disabled={pending}
            className="font-medium text-red-700 hover:underline"
          >
            Excluir
          </button>
        </div>
      </div>
      {mostrarEditar && (
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">
                Data de fim (opcional)
              </label>
              <input
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-california-red/20"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">
              Observação
            </label>
            <textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              rows={2}
              maxLength={500}
              className="w-full resize-none rounded-md border border-border bg-background p-2 text-sm focus:outline-none focus:ring-2 focus:ring-california-red/20"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setDataInicio(vinculo.data_inicio);
                setDataFim(vinculo.data_fim ?? "");
                setObservacao(vinculo.observacao ?? "");
                setMostrarEditar(false);
              }}
              disabled={pending}
              className="h-9 rounded-md border border-border px-3 text-sm"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={editar}
              disabled={pending}
              className="h-9 rounded-md bg-california-red px-3 text-sm font-medium text-white disabled:opacity-50"
            >
              {pending ? "..." : "Salvar"}
            </button>
          </div>
        </div>
      )}
      {mostrarMudar && ativo && (
        <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-4">
          <div className="flex-1 min-w-[200px]">
            <label className="mb-1 block text-xs font-medium text-foreground">
              Novo modo
            </label>
            <Select
              value={novoModo}
              onValueChange={(v) => setNovoModo(v as BeneficioModoCusteio)}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rateado">Rateado 60/40</SelectItem>
                <SelectItem value="integral_empresa">Integral empresa</SelectItem>
                <SelectItem value="integral_empresa_com_upgrade">
                  Integral + upgrade
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <button
            type="button"
            onClick={mudar}
            disabled={pending}
            className="h-9 rounded-md bg-california-red px-3 text-sm font-medium text-white disabled:opacity-50"
          >
            {pending ? "..." : "Aplicar"}
          </button>
          <button
            type="button"
            onClick={() => setMostrarMudar(false)}
            disabled={pending}
            className="h-9 rounded-md border border-border px-3 text-sm"
          >
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}
