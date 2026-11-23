"use client";

import { useEffect, useState } from "react";
import { CheckCircle, Plus, UserPlus } from "lucide-react";
import { SeletorCompetenciaInline } from "./seletor-competencia-inline";
import { ModalNovoVinculo } from "./modal-novo-vinculo";
import { ModalNovoDependente } from "./modal-novo-dependente";
import type {
  BeneficioCompleto,
  ColaboradorBasico,
  VinculoDoColaborador,
} from "@/lib/queries/beneficios";

export function AcoesColaborador({
  colaborador,
  colaboradorId,
  ano,
  mes,
  beneficios,
  vinculosAtivos,
  colaboradorTemCpf,
  colaboradorTemDataNasc,
}: {
  colaborador: ColaboradorBasico;
  colaboradorId: string;
  ano: number;
  mes: number;
  beneficios: BeneficioCompleto[];
  vinculosAtivos: VinculoDoColaborador[];
  colaboradorTemCpf: boolean;
  colaboradorTemDataNasc: boolean;
}) {
  const [modalVinculoAberto, setModalVinculoAberto] = useState(false);
  const [modalDepAberto, setModalDepAberto] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const faltaCadastro = !colaboradorTemCpf || !colaboradorTemDataNasc;
  const tooltipFalta = faltaCadastro
    ? "Preencha CPF e data de nascimento do colaborador antes de criar vínculo."
    : undefined;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SeletorCompetenciaInline ano={ano} mes={mes} />
        <button
          type="button"
          onClick={() => setModalVinculoAberto(true)}
          disabled={faltaCadastro}
          title={tooltipFalta}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Novo Benefício
        </button>
        <button
          type="button"
          onClick={() => setModalDepAberto(true)}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-california-red px-3 text-sm font-medium text-white hover:bg-california-red/90"
        >
          <UserPlus className="h-4 w-4" />
          Novo Dependente
        </button>
      </div>

      <ModalNovoVinculo
        open={modalVinculoAberto}
        onOpenChange={setModalVinculoAberto}
        colaboradorId={colaboradorId}
        beneficios={beneficios}
        dataNascimentoTitular={colaborador.data_nascimento}
        ano={ano}
        mes={mes}
      />

      <ModalNovoDependente
        open={modalDepAberto}
        onOpenChange={setModalDepAberto}
        colaboradorId={colaboradorId}
        vinculosAtivos={vinculosAtivos}
        onSucesso={(nome) =>
          setToast(`Dependente ${nome} cadastrado com sucesso.`)
        }
      />

      {toast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-elevated">
          <CheckCircle className="h-4 w-4" />
          {toast}
        </div>
      )}
    </>
  );
}
