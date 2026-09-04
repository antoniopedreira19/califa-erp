"use client";

import * as React from "react";
import { MessagesSquare } from "lucide-react";
import {
  Dialog,
  DrawerContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import type { ChatArea, ItemChat } from "@/lib/types";
import { JobPPsChatSection } from "./job-pps-chat-section";

interface Props {
  jobId: string;
  jobCodigo: string;
  itens: ItemChat[];
  minhaArea: ChatArea;
  naoLidasIniciais: number;
  /**
   * Se `false`, o campo de escrita nao renderiza (Financeiro e Freelancer
   * so leem). Fonte-verdade: `lib/permissoes.ts`, recurso `chat.enviar`.
   */
  podeEnviar?: boolean;
}

/**
 * Botão flutuante que fica no canto inferior direito enquanto a aba
 * "Pedidos de Produção" está ativa. Abre o chat de PPs num drawer
 * lateral. O badge de não lidas mora aqui — a section não sabe do
 * badge, só marca como lido ao montar.
 *
 * Realtime é assinado enquanto o FAB está montado (i.e. enquanto a
 * aba PPs está ativa): mensagem nova de outro autor incrementa o
 * badge se o drawer estiver fechado; se estiver aberto, a section
 * cuida do refresh + mark-as-read.
 */
export function JobPPsChatFab({
  jobId,
  jobCodigo,
  itens,
  minhaArea,
  naoLidasIniciais,
  podeEnviar = true,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const [badge, setBadge] = React.useState(naoLidasIniciais);
  const abertoRef = React.useRef(false);

  // Mantém a ref sincronizada com o estado — o callback do realtime é
  // criado dentro do useEffect e não vê o `open` atualizado sem isso.
  React.useEffect(() => {
    abertoRef.current = open;
  }, [open]);

  React.useEffect(() => {
    const supabase = createClient();
    const canal = supabase
      .channel(`chat-pps-fab-${jobId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "jobs_mensagens",
          filter: `job_id=eq.${jobId}`,
        },
        (payload: any) => {
          if (payload?.new?.escopo !== "pps") return;
          // Se o drawer está aberto, a section já vai marcar como lido.
          // Aqui a gente só incrementa quando ele está fechado.
          if (!abertoRef.current) {
            setBadge((n) => n + 1);
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
    };
  }, [jobId]);

  // useCallback garante identidade estável da callback — evita que o
  // effect de marcarChatPPsLido na section rode duas vezes por re-render
  // do pai (o FAB), já que onLidoInicial é dependência do effect filho.
  const zerarBadge = React.useCallback(() => setBadge(0), []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir chat de Pedidos de Produção"
        className="fixed bottom-6 right-6 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-california-red text-white shadow-elevated transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-california-red/50"
      >
        <MessagesSquare className="h-6 w-6" />
        {badge > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full border-2 border-white bg-foreground px-1 text-[10px] font-bold text-white">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </button>

      <DrawerContent className="sm:max-w-[420px]">
        {/* DialogTitle é obrigatório pela acessibilidade Radix; fica
            visível como cabeçalho do drawer. */}
        <DialogHeader className="flex-none border-b border-border px-[18px] py-4">
          <div className="flex items-center gap-2.5">
            <MessagesSquare className="h-[17px] w-[17px] text-california-red" />
            <div className="min-w-0">
              <DialogTitle className="text-xs font-semibold uppercase tracking-[0.08em]">
                Chat de PPs
              </DialogTitle>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                Produção ↔ Financeiro · {jobCodigo}
              </p>
            </div>
          </div>
        </DialogHeader>

        {open && (
          <JobPPsChatSection
            jobId={jobId}
            itens={itens}
            minhaArea={minhaArea}
            onLidoInicial={zerarBadge}
            podeEnviar={podeEnviar}
          />
        )}
      </DrawerContent>
    </Dialog>
  );
}
