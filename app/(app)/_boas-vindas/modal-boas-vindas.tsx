"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { WizardBoasVindas } from "./wizard-boas-vindas";
import type { MeuPerfilPayload } from "./actions";

const KEY_DISMISS = "perfil-modal-dismissed";

/**
 * Controla a abertura do modal de boas-vindas:
 *
 * - Enquanto `perfil_completado_em IS NULL`, o modal aparece em toda
 *   sessão nova (abrir aba, recarregar após fechar o browser).
 * - Dentro da MESMA sessão, se o colaborador clicar "X" ou "Agora não",
 *   o sessionStorage marca e o modal não volta até ele reiniciar a
 *   sessão. Fecha a aba → some; abre de novo → aparece.
 * - Quando ele completa, server grava perfil_completado_em e o layout
 *   para de injetar o modal — não precisa mexer no sessionStorage.
 */
export function ModalBoasVindas({ payload }: { payload: MeuPerfilPayload }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  // Abre na primeira montagem se não dispensado nesta sessão.
  // useEffect (não useState lazy) porque sessionStorage não existe no SSR.
  React.useEffect(() => {
    try {
      if (!sessionStorage.getItem(KEY_DISMISS)) {
        setOpen(true);
      }
    } catch {
      setOpen(true);
    }
  }, []);

  function handleOpenChange(next: boolean) {
    if (!next) {
      try {
        sessionStorage.setItem(KEY_DISMISS, "1");
      } catch {}
    }
    setOpen(next);
  }

  function handleCompletado() {
    try {
      // Depois de completar, limpa a flag — não volta a aparecer, mas
      // deixa o storage limpo.
      sessionStorage.removeItem(KEY_DISMISS);
    } catch {}
    setOpen(false);
    // Recarrega o layout pra o InjetarBoasVindas não montar de novo.
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle>Bem-vindo(a) à California 🐻</DialogTitle>
          <DialogDescription>
            Vamos completar seu perfil. Leva uns minutos — você pode fechar
            e voltar quando quiser.
          </DialogDescription>
        </DialogHeader>
        <WizardBoasVindas
          payload={payload}
          onCompletado={handleCompletado}
          onFecharSemCompletar={() => handleOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
