"use client";

import { useState } from "react";
import { Plus, UserPlus } from "lucide-react";
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
      />
    </>
  );
}
