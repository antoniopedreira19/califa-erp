"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Power, PowerOff, User } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Colaborador, Empresa, Nivel } from "@/lib/types";
import { tipoContratacaoLabel } from "@/lib/types";
import {
  inativarColaborador,
  reativarColaborador,
} from "../actions";
import { EditarDadosDrawer } from "./editar-dados-drawer";

type Props = {
  colaborador: Colaborador & {
    nivel: Pick<Nivel, "id" | "codigo" | "descricao"> | null;
  };
  empresas: Pick<Empresa, "id" | "nome_fantasia">[];
  regionais: { id: string; nome: string; empresa_id: string }[];
  niveis: Pick<Nivel, "id" | "codigo" | "descricao">[];
};

export function CardDados({ colaborador, niveis }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [confirmando, setConfirmando] = React.useState<
    "inativar" | "reativar" | null
  >(null);

  function handleConfirm() {
    if (!confirmando) return;
    startTransition(async () => {
      const res =
        confirmando === "inativar"
          ? await inativarColaborador(
              colaborador.id,
              new Date().toISOString().slice(0, 10),
            )
          : await reativarColaborador(colaborador.id);
      if (!res.ok) {
        alert(res.message);
        return;
      }
      setConfirmando(null);
      router.refresh();
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <User className="h-4 w-4 text-california-red" />
          </div>
          <h2 className="text-lg font-semibold">Dados do colaborador</h2>
        </div>
        <div className="flex items-center gap-1">
          <EditarDadosDrawer colaborador={colaborador} niveis={niveis} />
          <button
            type="button"
            onClick={() =>
              setConfirmando(
                colaborador.status === "ativo" ? "inativar" : "reativar",
              )
            }
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            {colaborador.status === "ativo" ? (
              <>
                <PowerOff className="h-3.5 w-3.5" />
                Inativar
              </>
            ) : (
              <>
                <Power className="h-3.5 w-3.5" />
                Reativar
              </>
            )}
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-x-8 gap-y-4 md:grid-cols-2">
        <Info label="Nome" value={colaborador.nome} />
        <Info
          label="Função"
          value={colaborador.funcao}
          hint={colaborador.nivel ? `Nível ${colaborador.nivel.codigo}` : null}
        />
        <Info
          label="Tipo de contratação"
          value={tipoContratacaoLabel(colaborador.tipo_contratacao)}
        />
        <Info
          label={colaborador.tipo_contratacao === "clt" || colaborador.tipo_contratacao === "estagio" ? "CPF" : "CNPJ"}
          value={formatarDocumento(
            colaborador.cpf_cnpj,
            colaborador.tipo_contratacao,
          )}
        />
        <Info label="E-mail" value={colaborador.email ?? "—"} />
        <Info label="Admissão" value={formatarData(colaborador.data_admissao)} />
        <Info
          label="Encerramento"
          value={
            colaborador.data_encerramento
              ? formatarData(colaborador.data_encerramento)
              : "—"
          }
        />
      </div>

      {confirmando && (
        <ConfirmDialog
          open={!!confirmando}
          onOpenChange={(next) => {
            if (!next) setConfirmando(null);
          }}
          title={
            confirmando === "inativar"
              ? "Inativar colaborador?"
              : "Reativar colaborador?"
          }
          description={
            confirmando === "inativar"
              ? "Colaborador sai do quadro ativo e recebe hoje como data de encerramento. Histórico salarial e alocações são preservados."
              : "Colaborador volta ao quadro ativo. Data de encerramento é limpa."
          }
          confirmLabel={confirmando === "inativar" ? "Inativar" : "Reativar"}
          onConfirm={handleConfirm}
          pending={pending}
        />
      )}
    </div>
  );
}

function Info({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string | null;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm text-foreground">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  if (!ano || !mes || !dia) return iso;
  return `${dia}/${mes}/${ano}`;
}

function formatarDocumento(
  documento: string | null,
  tipoContratacao: Colaborador["tipo_contratacao"],
): string {
  if (!documento) return "—";
  if (tipoContratacao === "clt" || tipoContratacao === "estagio") {
    // CPF: 000.000.000-00
    if (documento.length !== 11) return documento;
    return `${documento.slice(0, 3)}.${documento.slice(3, 6)}.${documento.slice(6, 9)}-${documento.slice(9)}`;
  }
  // CNPJ: 00.000.000/0000-00
  if (documento.length !== 14) return documento;
  return `${documento.slice(0, 2)}.${documento.slice(2, 5)}.${documento.slice(5, 8)}/${documento.slice(8, 12)}-${documento.slice(12)}`;
}
