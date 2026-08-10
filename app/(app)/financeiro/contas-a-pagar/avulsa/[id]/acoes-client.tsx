"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2, CreditCard, Ban, Edit } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ContaAvulsaDrawer } from "../../conta-avulsa-drawer";
import { BaixarAvulsaModal } from "./baixar-avulsa-modal";
import { CancelarBaixaAvulsaModal } from "./cancelar-baixa-avulsa-modal";
import { excluirContaAvulsa, signedUrlAnexoAvulsa } from "../../actions-avulsas";
import type {
  ContaAvulsa,
  ContaBancaria,
  PlanoContaTipo,
  PlanoContaSubtipo,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// EditarAvulsaButton
// Wraps <ContaAvulsaDrawer mode="editar"> com estado controlado.
// ---------------------------------------------------------------------------

interface EditarProps {
  conta: ContaAvulsa;
  tenantId: string;
  empresas: Array<{ id: string; nome: string }>;
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  fornecedores: Array<{ id: string; nome: string }>;
  clientes: Array<{ id: string; nome: string }>;
  jobs: Array<{ id: string; codigo: string; nome: string }>;
}

export function EditarAvulsaButton({
  conta,
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
      <ContaAvulsaDrawer
        mode="editar"
        tenantId={tenantId}
        conta={conta}
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
// ExcluirAvulsaButton
// ---------------------------------------------------------------------------

interface ExcluirProps {
  contaId: string;
  descricao: string;
}

export function ExcluirAvulsaButton({ contaId, descricao }: ExcluirProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const res = await excluirContaAvulsa(contaId);
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
        title="Excluir conta avulsa?"
        description={`"${descricao}" será removida definitivamente junto com seus anexos e histórico.`}
        confirmLabel="Excluir"
        variant="destructive"
        onConfirm={handleConfirm}
        pending={pending}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// BaixarAvulsaModalClient
// Botão que abre o modal de baixa.
// ---------------------------------------------------------------------------

interface BaixarProps {
  contaId: string;
  descricao: string;
  valor: number;
  contas: ContaBancaria[];
}

export function BaixarAvulsaModalClient({
  contaId,
  descricao,
  valor,
  contas,
}: BaixarProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
      >
        <CreditCard className="h-3.5 w-3.5" />
        Dar baixa
      </button>
      <BaixarAvulsaModal
        contaId={contaId}
        descricao={descricao}
        valor={valor}
        contas={contas}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// CancelarBaixaAvulsaModalClient
// Botão que abre o modal de estorno/cancelamento de baixa.
// ---------------------------------------------------------------------------

interface CancelarBaixaProps {
  contaId: string;
  descricao: string;
}

export function CancelarBaixaAvulsaModalClient({
  contaId,
  descricao,
}: CancelarBaixaProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-california-red/30 bg-white px-3 py-2 text-xs font-semibold text-california-red hover:bg-california-red hover:text-white"
      >
        <Ban className="h-3.5 w-3.5" />
        Cancelar baixa
      </button>
      <CancelarBaixaAvulsaModal
        contaId={contaId}
        descricao={descricao}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// BaixarAnexoButton
// Gera signed URL e abre em nova aba.
// ---------------------------------------------------------------------------

interface BaixarAnexoProps {
  anexoId: string;
}

export function BaixarAnexoButton({ anexoId }: BaixarAnexoProps) {
  const [pending, startTransition] = React.useTransition();

  function handleClick() {
    startTransition(async () => {
      const res = await signedUrlAnexoAvulsa(anexoId);
      if (!res.ok) {
        alert(res.message);
        return;
      }
      window.open(res.url, "_blank", "noopener,noreferrer");
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="inline-flex items-center gap-1 rounded border border-border bg-white px-2 py-1 text-[10px] font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50"
    >
      {pending ? "Abrindo..." : "Baixar"}
    </button>
  );
}
