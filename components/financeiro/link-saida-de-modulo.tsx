"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";

/**
 * Link que leva para FORA do módulo financeiro, avisando antes.
 *
 * O financeiro não encaminha para telas de outros módulos (decisão do
 * Tiago, 20/08/2026). A exceção é o orçamento de origem do job: ele só
 * existe no módulo de Orçamentos, e sem esse caminho o financeiro perde
 * de vista de qual orçamento o job nasceu.
 *
 * A saída então é explícita, e não silenciosa: o clique abre uma
 * confirmação dizendo para onde a pessoa vai. Quem está conferindo
 * dinheiro não deve descobrir que trocou de módulo só depois de a tela
 * ter mudado.
 */
export function LinkSaidaDeModulo({
  href,
  modulo,
  descricao,
  className,
  children,
}: {
  href: string;
  /** Nome do módulo de destino, como aparece no menu. */
  modulo: string;
  /** O que a pessoa vai ver lá. Entra no corpo da confirmação. */
  descricao: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [aberto, setAberto] = React.useState(false);

  return (
    <>
      {/* `button`, e não `<a>`: um link de verdade abriria em nova aba no
          ctrl-clique e no clique do meio, pulando a confirmação. */}
      <button
        type="button"
        onClick={() => setAberto(true)}
        className={cn("inline-flex items-center gap-1.5 text-left", className)}
      >
        {children}
        <ExternalLink className="h-3 w-3 shrink-0 opacity-70" />
      </button>

      <ConfirmDialog
        open={aberto}
        onOpenChange={setAberto}
        title={`Sair para o módulo de ${modulo}?`}
        description={descricao}
        confirmLabel={`Ir para ${modulo}`}
        cancelLabel="Ficar no financeiro"
        onConfirm={() => {
          setAberto(false);
          router.push(href);
        }}
      />
    </>
  );
}
