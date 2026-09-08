"use client";

import * as React from "react";
import { ArrowLeft, MessagesSquare } from "lucide-react";
import {
  Dialog,
  DrawerContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ThreadPPsDoJob } from "@/lib/data/chat-pps-conversas";
import { useChatPPs } from "./chat-pps-provider";
import { ChatPPsLista } from "./chat-pps-lista";
import { ChatPPsConversa } from "./chat-pps-conversa";
import { abrirThreadPPs, marcarConversaPPsLida } from "./actions";

/**
 * Botão flutuante do chat de PPs em Contas a Pagar (decisão 058).
 *
 * Espelha o FAB da aba PPs do job, com uma diferença: lá existe um job
 * só, então o clique abre o fio direto e o badge conta MENSAGENS não
 * lidas. Aqui existe um fio por job, então o clique abre a caixa de
 * entrada e o badge conta CHATS com mensagem não lida.
 *
 * PP registrada no fio não entra em nenhum dos dois números: card de PP é
 * derivado de `pedidos_compra` na leitura e não notifica.
 */
export function ChatPPsFab() {
  const { conversas, chatsNaoLidos, recarregar, zerarNaoLidas, podeEnviar } =
    useChatPPs();
  const [open, setOpen] = React.useState(false);
  const [jobAberto, setJobAberto] = React.useState<string | null>(null);
  const [thread, setThread] = React.useState<ThreadPPsDoJob | null>(null);

  const conversaAberta = jobAberto
    ? conversas.find((c) => c.jobId === jobAberto)
    : undefined;

  function abrir(jobId: string) {
    setJobAberto(jobId);
    setThread(null);
    // Zera na hora pra lista não piscar o badge de volta enquanto o
    // servidor confirma a leitura. Quem carrega o fio é o efeito abaixo.
    zerarNaoLidas(jobId);
  }

  function voltar() {
    setJobAberto(null);
    setThread(null);
    void recarregar();
  }

  /**
   * Carrega o fio do job aberto e marca como lido.
   *
   * Roda ao abrir a conversa E de novo quando a última mensagem daquele
   * job muda — o provider recarrega a lista no realtime, e é essa
   * mudança que avisa o fio aberto que chegou coisa nova. Job que ainda
   * não tem mensagem também passa por aqui (`ultimaEm` nulo): ele tem
   * cards de PP pra mostrar.
   */
  const ultimaDoJobAberto = conversaAberta?.ultimaEm ?? null;
  React.useEffect(() => {
    if (!jobAberto) return;
    let ativo = true;
    (async () => {
      const [t] = await Promise.all([
        abrirThreadPPs(jobAberto),
        marcarConversaPPsLida(jobAberto),
      ]);
      if (ativo) setThread(t);
    })();
    return () => {
      ativo = false;
    };
  }, [jobAberto, ultimaDoJobAberto]);

  return (
    <Dialog
      open={open}
      onOpenChange={(aberto) => {
        setOpen(aberto);
        if (!aberto) {
          setJobAberto(null);
          setThread(null);
          void recarregar();
        }
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir chat de Pedidos de Produção"
        className="fixed bottom-6 right-6 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-california-red text-white shadow-elevated transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-california-red/50"
      >
        <MessagesSquare className="h-6 w-6" />
        {chatsNaoLidos > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full border-2 border-white bg-foreground px-1 text-[10px] font-bold text-white">
            {chatsNaoLidos > 99 ? "99+" : chatsNaoLidos}
          </span>
        )}
      </button>

      <DrawerContent className="sm:max-w-[420px]">
        <DialogHeader className="flex-none border-b border-border px-[18px] py-4">
          <div className="flex items-center gap-2.5">
            {jobAberto ? (
              <button
                type="button"
                onClick={voltar}
                aria-label="Voltar para a lista de conversas"
                className="inline-flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[7px] border border-border bg-white text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="h-[15px] w-[15px]" />
              </button>
            ) : (
              <MessagesSquare className="h-[17px] w-[17px] text-california-red" />
            )}
            <div className="min-w-0">
              <DialogTitle className="text-xs font-semibold uppercase tracking-[0.08em]">
                Chat de PPs
              </DialogTitle>
              <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                {conversaAberta
                  ? `Produção ↔ Financeiro · ${conversaAberta.jobCodigo} ${conversaAberta.jobNome}`
                  : `Produção ↔ Financeiro · ${conversas.length} ${
                      conversas.length === 1 ? "conversa" : "conversas"
                    }`}
              </p>
            </div>
          </div>
        </DialogHeader>

        {open &&
          (jobAberto ? (
            <ChatPPsConversa
              jobId={jobAberto}
              thread={thread}
              onThread={setThread}
              podeEnviar={podeEnviar}
              onEnviou={recarregar}
            />
          ) : (
            <ChatPPsLista conversas={conversas} onAbrir={abrir} />
          ))}
      </DrawerContent>
    </Dialog>
  );
}
