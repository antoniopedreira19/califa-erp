"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Archive, RefreshCw } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { reativarProjeto } from "./actions";
import { reativarOrcamento } from "./[projetoId]/actions";

type Props =
  | {
      tipo: "projeto";
      projetoId: string;
      /** `orcamentos.editar` — quem não tem vê o aviso sem o botão. */
      podeReativar: boolean;
    }
  | {
      tipo: "orcamento";
      projetoId: string;
      orcamentoId: string;
      podeReativar: boolean;
      /** O próprio orçamento está arquivado. */
      orcamentoArquivado: boolean;
      /** Com o projeto arquivado, o orçamento não se reativa sozinho: o
       *  aviso manda reativar o projeto primeiro. */
      projetoArquivado: boolean;
    };

/**
 * Faixa de "arquivado" no topo do projeto e do orçamento (decisão 118).
 * Arquivado é só leitura: tudo na tela fica para consulta, e o único
 * caminho de volta é o Reativar daqui.
 */
export function AvisoArquivado(props: Props) {
  const router = useRouter();
  const [confirmando, setConfirmando] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);

  const ehProjeto = props.tipo === "projeto";
  const bloqueadoPeloProjeto = props.tipo === "orcamento" && props.projetoArquivado;

  const texto = ehProjeto
    ? "Projeto arquivado. Ele fica só para consulta: nada se cria nem se edita aqui até ele ser reativado."
    : !bloqueadoPeloProjeto
      ? "Orçamento arquivado. Ele não aparece na visão agregada nem nas abas do projeto, e fica só para consulta até ser reativado."
      : props.orcamentoArquivado
        ? "Orçamento arquivado, num projeto também arquivado. Reative o projeto primeiro."
        : "O projeto deste orçamento está arquivado. Tudo aqui fica só para consulta até o projeto ser reativado.";

  function reativar() {
    setErro(null);
    startTransition(async () => {
      const res =
        props.tipo === "projeto"
          ? await reativarProjeto(props.projetoId)
          : await reativarOrcamento(props.projetoId, props.orcamentoId);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setConfirmando(false);
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-muted/30 p-4">
        <div className="flex items-start gap-3">
          <Archive className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{texto}</p>
        </div>
        {props.podeReativar && !bloqueadoPeloProjeto && (
          <button
            type="button"
            onClick={() => {
              setErro(null);
              setConfirmando(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-accent"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {ehProjeto ? "Reativar projeto" : "Reativar orçamento"}
          </button>
        )}
      </div>

      <ConfirmDialog
        open={confirmando}
        onOpenChange={setConfirmando}
        title={ehProjeto ? "Reativar projeto?" : "Reativar orçamento?"}
        description={
          <>
            <p>
              {ehProjeto
                ? "O projeto volta para a lista de ativos e pode ser editado de novo."
                : "O orçamento volta para a visão agregada e para as abas do projeto, no status em que estava, e pode ser editado de novo."}
            </p>
            {erro && <p className="mt-2 text-california-red">{erro}</p>}
          </>
        }
        confirmLabel="Reativar"
        onConfirm={reativar}
        pending={pending}
      />
    </>
  );
}
