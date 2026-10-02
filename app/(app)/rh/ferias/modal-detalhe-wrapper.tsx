"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  ColaboradorFeriasPeriodo,
  ColaboradorFeriasLancamento,
  TipoContratacao,
} from "@/lib/types";
import { ModalDetalheColaborador } from "./modal-detalhe-colaborador";
import { obterDetalheColaboradorFerias } from "./actions";

type Props = {
  colaboradorId: string;
  onFechar: () => void;
};

type Dados = {
  colaborador: {
    id: string;
    nome: string;
    tipo_contratacao: TipoContratacao;
    funcao: string;
    data_admissao: string;
  };
  periodos: ColaboradorFeriasPeriodo[];
  lancamentos: ColaboradorFeriasLancamento[];
};

/**
 * Carrega os dados do modal via server action quando aberto e passa pro
 * ModalDetalheColaborador real. Mostra loading enquanto fetcha.
 *
 * Isola o fetch do modal da renderização do Quadro — abrir/fechar modal
 * não dispara mais request RSC do Quadro.
 */
export function ModalDetalheWrapper({ colaboradorId, onFechar }: Props) {
  const [dados, setDados] = React.useState<Dados | null>(null);
  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    setDados(null);

    obterDetalheColaboradorFerias(colaboradorId).then((res) => {
      if (cancelado) return;
      if (!res.ok) {
        setErro(res.message);
        setCarregando(false);
        return;
      }
      setDados({
        colaborador: res.colaborador as Dados["colaborador"],
        periodos: res.periodos as ColaboradorFeriasPeriodo[],
        lancamentos: res.lancamentos as ColaboradorFeriasLancamento[],
      });
      setCarregando(false);
    });

    return () => {
      cancelado = true;
    };
  }, [colaboradorId]);

  // Enquanto carrega, mostra um shell com spinner — ainda abre instantâneo
  if (carregando || erro) {
    return (
      <Dialog open onOpenChange={(o) => !o && onFechar()}>
        <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] p-0 overflow-hidden flex flex-col">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-border shrink-0">
            <DialogTitle className="text-xl">Carregando…</DialogTitle>
          </DialogHeader>
          <div className="flex-1 flex items-center justify-center py-16">
            {erro ? (
              <p className="text-sm text-red-700">{erro}</p>
            ) : (
              <Loader2 className="h-8 w-8 animate-spin text-california-red" />
            )}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!dados) return null;

  return (
    <ModalDetalheColaborador
      colaborador={dados.colaborador}
      periodos={dados.periodos}
      lancamentos={dados.lancamentos}
      onFechar={onFechar}
    />
  );
}
