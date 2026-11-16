"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { WizardBoasVindas } from "@/app/(app)/_boas-vindas/wizard-boas-vindas";
import {
  lerMeuPerfilCompleto,
  type MeuPerfilPayload,
} from "@/app/(app)/_boas-vindas/actions";

/**
 * Botão "Editar meus dados" no perfil. Abre o mesmo wizard usado no
 * onboarding, mas em modo edição: o botão final vira "Salvar" e não
 * reexecuta a validação de "perfil completo" (porque já tá completo).
 *
 * Carrega o payload sob demanda ao abrir pra evitar enviar o
 * colaborador inteiro no HTML do /perfil mesmo quando a pessoa não
 * vai editar.
 */
export function BotaoEditarPerfilCompleto() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [payload, setPayload] = React.useState<MeuPerfilPayload | null>(null);
  const [carregando, setCarregando] = React.useState(false);

  async function abrir() {
    setCarregando(true);
    const p = await lerMeuPerfilCompleto();
    setCarregando(false);
    if (!p) return;
    setPayload(p);
    setOpen(true);
  }

  function fechar() {
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={abrir}
        disabled={carregando}
        className="w-full"
      >
        <Pencil className="h-3.5 w-3.5 mr-1.5" />
        {carregando ? "Abrindo..." : "Editar meus dados completos"}
      </Button>

      {payload && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-3xl p-0 overflow-hidden">
            <DialogHeader className="px-6 pt-6 pb-2">
              <DialogTitle>Editar meus dados</DialogTitle>
              <DialogDescription>
                Atualize qualquer informação que mudou.
              </DialogDescription>
            </DialogHeader>
            <WizardBoasVindas
              payload={payload}
              modoEdicao
              onCompletado={fechar}
              onFecharSemCompletar={fechar}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
