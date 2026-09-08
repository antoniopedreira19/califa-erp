"use client";

import * as React from "react";
import { AREA_FINANCEIRO } from "@/lib/types";
import type { ThreadPPsDoJob } from "@/lib/data/chat-pps-conversas";
import { ThreadPPs } from "@/components/chat/thread-pps";
import { ChatInput } from "@/components/chat/chat-input";
import { abrirThreadPPs, enviarMensagemPPFinanceiro } from "./actions";

/**
 * Um fio aberto dentro da caixa de entrada. Mesmo layout da aba PPs do
 * job — literalmente o mesmo `<ThreadPPs>` e o mesmo `<ChatInput>`.
 *
 * A diferença é de onde vem o conteúdo: no job ele desce pronto do server
 * component e um `router.refresh()` atualiza; aqui ele é carregado sob
 * demanda, porque a página tem 12 fios e não faria sentido montar todos.
 */
export function ChatPPsConversa({
  jobId,
  thread,
  onThread,
  podeEnviar,
  onEnviou,
}: {
  jobId: string;
  /** `null` = ainda carregando. */
  thread: ThreadPPsDoJob | null;
  onThread: (t: ThreadPPsDoJob | null) => void;
  podeEnviar: boolean;
  /** Avisa o pai que o fio mudou, pra ele reordenar a lista. */
  onEnviou: () => void;
}) {
  const [pending, setPending] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  async function handleEnviar(texto: string): Promise<boolean> {
    setErro(null);
    setPending(true);
    try {
      const res = await enviarMensagemPPFinanceiro(jobId, texto);
      if (!res.ok) {
        setErro(res.message);
        return false;
      }
      // A action já devolve o fio atualizado: uma ida ao servidor, não duas.
      onThread(res.thread ?? (await abrirThreadPPs(jobId)));
      onEnviou();
      return true;
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {thread === null ? (
        <div className="flex min-h-0 flex-1 items-center justify-center bg-[#FAFAFA]">
          <p className="text-xs text-muted-foreground">Carregando o fio…</p>
        </div>
      ) : (
        <ThreadPPs
          itens={thread.itens}
          vazio="Nenhuma mensagem ainda neste job. As PPs enviadas aparecem aqui como registro; escreva para começar a conversa com a produção."
        />
      )}

      {podeEnviar && (
        <ChatInput
          minhaArea={AREA_FINANCEIRO}
          pending={pending || thread === null}
          erro={erro}
          onLimparErro={() => setErro(null)}
          onEnviar={handleEnviar}
          placeholder="Responda a produção sobre uma PP…"
        />
      )}
    </div>
  );
}
