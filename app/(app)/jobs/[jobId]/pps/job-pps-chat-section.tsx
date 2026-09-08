"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ChatArea, ItemChat } from "@/lib/types";
import { enviarMensagemPP, marcarChatPPsLido } from "./actions-chat";
import { ChatInput } from "@/components/chat/chat-input";
import { ThreadPPs } from "@/components/chat/thread-pps";

interface Props {
  jobId: string;
  itens: ItemChat[];
  minhaArea: ChatArea;
  /** Chamado uma vez, quando a section marca a thread como lida pela
   * primeira vez após aberta. O FAB usa isso pra zerar o badge local. */
  onLidoInicial: () => void;
  /**
   * Se `false`, o campo de escrita nao renderiza (Freelancer so le, e o
   * papel Financeiro responde pelo Contas a Pagar, nao por aqui).
   * Fonte-verdade: `lib/permissoes.ts`, recurso `chat.enviar`.
   */
  podeEnviar?: boolean;
}

export function JobPPsChatSection({
  jobId,
  itens,
  minhaArea,
  onLidoInicial,
  podeEnviar = true,
}: Props) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const marcouRef = React.useRef(false);

  React.useEffect(() => {
    if (marcouRef.current) return;
    marcouRef.current = true;
    marcarChatPPsLido(jobId).then(() => onLidoInicial());
  }, [jobId, onLidoInicial]);

  // Realtime pra thread aberta: chega mensagem nova de PP, refaz a
  // thread e marca como lida (o usuário está com o drawer aberto).
  React.useEffect(() => {
    const supabase = createClient();
    const canal = supabase
      .channel(`chat-pps-${jobId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "jobs_mensagens",
          filter: `job_id=eq.${jobId}`,
        },
        async (payload: any) => {
          if (payload?.new?.escopo !== "pps") return;
          await marcarChatPPsLido(jobId);
          router.refresh();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
    };
  }, [jobId, router]);

  async function handleEnviar(texto: string): Promise<boolean> {
    setErro(null);
    setPending(true);
    try {
      const res = await enviarMensagemPP(jobId, texto);
      if (!res.ok) {
        setErro(res.message);
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ThreadPPs
        itens={itens}
        vazio="Nenhuma PP nem mensagem por aqui ainda. Assim que uma PP for emitida ou alguém escrever, aparece na thread."
      />

      {podeEnviar && (
        <ChatInput
          minhaArea={minhaArea}
          pending={pending}
          erro={erro}
          onLimparErro={() => setErro(null)}
          onEnviar={handleEnviar}
          placeholder="Escreva sobre uma PP…"
        />
      )}
    </div>
  );
}
