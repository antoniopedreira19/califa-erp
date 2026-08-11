"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2, CreditCard, Ban, Edit } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ContaAvulsaDrawer } from "../../conta-avulsa-drawer";
import { BaixarAvulsaModal } from "./baixar-avulsa-modal";
import { CancelarBaixaAvulsaModal } from "./cancelar-baixa-avulsa-modal";
import { excluirContaAvulsa, signedUrlAnexoAvulsa } from "../../actions-avulsas";
import type {
  ContaAvulsa,
  ContaBancaria,
  PlanoContaTipo,
  PlanoContaSubtipo,
  RateioLinhaInput,
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
  jobs: Array<{ id: string; codigo: string; nome: string; cliente_id: string | null; regional_id: string | null }>;
  regionais: Array<{ id: string; nome: string; ativo: boolean }>;
  rateioInicial?: RateioLinhaInput[];
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
  regionais,
  rateioInicial,
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
        regionais={regionais}
        rateioInicial={rateioInicial}
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
  recorrenteId: string | null;
}

export function ExcluirAvulsaButton({ contaId, descricao, recorrenteId }: ExcluirProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [pararRecorrencia, setPararRecorrencia] = React.useState<"nao" | "sim">("nao");

  function handleConfirm() {
    startTransition(async () => {
      const res = await excluirContaAvulsa(contaId, {
        parar_recorrencia: recorrenteId != null && pararRecorrencia === "sim",
      });
      if (!res.ok) {
        alert(res.message);
        return;
      }
      setOpen(false);
      router.push("/financeiro/contas-a-pagar");
    });
  }

  const botaoExcluir = (
    <button
      type="button"
      onClick={() => {
        setPararRecorrencia("nao");
        setOpen(true);
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-california-red/30 bg-white px-3 py-2 text-xs font-semibold text-california-red hover:bg-california-red hover:text-white"
    >
      <Trash2 className="h-3.5 w-3.5" />
      Excluir
    </button>
  );

  // Dialog especial para contas recorrentes
  if (recorrenteId) {
    return (
      <>
        {botaoExcluir}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Excluir esta ocorrência?</DialogTitle>
              <DialogDescription>
                Esta conta faz parte de uma recorrência. Escolha como proceder:
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-muted/50">
                <input
                  type="radio"
                  name="excluir_parar_recorrencia"
                  value="nao"
                  checked={pararRecorrencia === "nao"}
                  onChange={() => setPararRecorrencia("nao")}
                  className="mt-0.5"
                />
                <div>
                  <p className="text-sm font-semibold">Só esta ocorrência</p>
                  <p className="text-xs text-muted-foreground">
                    O template continua ativo e vai gerar a próxima na data prevista.
                  </p>
                </div>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-muted/50">
                <input
                  type="radio"
                  name="excluir_parar_recorrencia"
                  value="sim"
                  checked={pararRecorrencia === "sim"}
                  onChange={() => setPararRecorrencia("sim")}
                  className="mt-0.5"
                />
                <div>
                  <p className="text-sm font-semibold">Parar toda a recorrência</p>
                  <p className="text-xs text-muted-foreground">
                    Este template é desativado. Nenhuma nova ocorrência será gerada até você reativar manualmente.
                  </p>
                </div>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3 py-2 text-sm font-semibold text-white hover:bg-california-red/90 disabled:opacity-50"
              >
                {pending ? "Confirmando..." : "Confirmar exclusão"}
              </button>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // Fluxo original (não recorrente): ConfirmDialog simples
  return (
    <>
      {botaoExcluir}
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
  recorrenteId: string | null;
}

export function CancelarBaixaAvulsaModalClient({
  contaId,
  descricao,
  recorrenteId,
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
        recorrenteId={recorrenteId}
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
