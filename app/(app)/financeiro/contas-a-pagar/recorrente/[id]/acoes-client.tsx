"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Edit, Pause, Play, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ContaRecorrenteDrawer } from "../../conta-recorrente-drawer";
import {
  pausarContaRecorrente,
  reativarContaRecorrente,
  excluirContaRecorrente,
} from "../../actions-recorrentes";
import type {
  ContaAvulsaRecorrente,
  PlanoContaTipo,
  PlanoContaSubtipo,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Tipos auxiliares compartilhados
// ---------------------------------------------------------------------------

type EmpresaResumida = { id: string; nome: string };
type FornecedorResumido = { id: string; nome: string };
type ClienteResumido = { id: string; nome: string };
type JobResumido = {
  id: string;
  codigo: string;
  nome: string;
  cliente_id: string | null;
};

// ---------------------------------------------------------------------------
// EditarRecorrenteButton
// Wraps <ContaRecorrenteDrawer mode="editar"> com estado controlado.
// ---------------------------------------------------------------------------

interface EditarProps {
  recorrente: ContaAvulsaRecorrente;
  tenantId: string;
  empresas: EmpresaResumida[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  fornecedores: FornecedorResumido[];
  clientes: ClienteResumido[];
  jobs: JobResumido[];
}

export function EditarRecorrenteButton({
  recorrente,
  tenantId,
  empresas,
  tipos,
  subtipos,
  fornecedores,
  clientes,
  jobs,
}: EditarProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted"
      >
        <Edit className="h-3.5 w-3.5" />
        Editar
      </button>
      <ContaRecorrenteDrawer
        mode="editar"
        tenantId={tenantId}
        recorrente={recorrente}
        empresas={empresas}
        tipos={tipos}
        subtipos={subtipos}
        fornecedores={fornecedores}
        clientes={clientes}
        jobs={jobs}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// PausarRecorrenteButton
// ---------------------------------------------------------------------------

interface PausarProps {
  recorrenteId: string;
  descricao: string;
}

export function PausarRecorrenteButton({ recorrenteId, descricao }: PausarProps) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const res = await pausarContaRecorrente(recorrenteId);
      if (!res.ok) {
        alert(res.message);
        return;
      }
      setOpen(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted"
      >
        <Pause className="h-3.5 w-3.5" />
        Pausar
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Pausar recorrência?"
        description={`"${descricao}" será pausada e não gerará novas ocorrências até ser reativada.`}
        confirmLabel="Pausar"
        variant="default"
        onConfirm={handleConfirm}
        pending={pending}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// ReativarRecorrenteButton
// ---------------------------------------------------------------------------

interface ReativarProps {
  recorrenteId: string;
  descricao: string;
}

export function ReativarRecorrenteButton({ recorrenteId, descricao }: ReativarProps) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const res = await reativarContaRecorrente(recorrenteId);
      if (!res.ok) {
        alert(res.message);
        return;
      }
      setOpen(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
      >
        <Play className="h-3.5 w-3.5" />
        Reativar
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Reativar recorrência?"
        description={`"${descricao}" voltará a gerar ocorrências conforme a frequência configurada.`}
        confirmLabel="Reativar"
        variant="default"
        onConfirm={handleConfirm}
        pending={pending}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// ExcluirRecorrenteButton
// Descrição sensível ao número de instâncias já geradas.
// ---------------------------------------------------------------------------

interface ExcluirProps {
  recorrenteId: string;
  descricao: string;
  geradasCount: number;
}

export function ExcluirRecorrenteButton({
  recorrenteId,
  descricao,
  geradasCount,
}: ExcluirProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const descricaoDialog =
    geradasCount > 0
      ? `"${descricao}": as instâncias já geradas serão preservadas. A recorrência será marcada como parada.`
      : `"${descricao}" será excluída definitivamente.`;

  function handleConfirm() {
    startTransition(async () => {
      const res = await excluirContaRecorrente(recorrenteId);
      if (!res.ok) {
        alert(res.message);
        return;
      }
      setOpen(false);
      router.push("/financeiro/contas-a-pagar");
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-california-red/30 bg-white px-3 py-2 text-xs font-semibold text-california-red hover:bg-california-red hover:text-white"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Excluir
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Excluir recorrência?"
        description={descricaoDialog}
        confirmLabel="Excluir"
        variant="destructive"
        onConfirm={handleConfirm}
        pending={pending}
      />
    </>
  );
}
