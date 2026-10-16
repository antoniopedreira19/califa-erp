"use client";

import * as React from "react";
import { Send, Loader2, MessageSquare } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn, initials } from "@/lib/utils";
import type { FreelancerSolicitacaoMensagem } from "@/lib/types";
import {
  enviarMensagem,
  marcarMensagensComoLidas,
} from "../actions";

interface MensagemComAutor extends FreelancerSolicitacaoMensagem {
  autor_nome: string | null;
}

interface Props {
  solicitacaoId: string;
  userId: string;
}

export function ChatSolicitacao({ solicitacaoId, userId }: Props) {
  const [mensagens, setMensagens] = React.useState<MensagemComAutor[]>([]);
  const [carregando, setCarregando] = React.useState(true);
  const [texto, setTexto] = React.useState("");
  const [enviando, startEnviar] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const listaRef = React.useRef<HTMLDivElement>(null);

  // Carga inicial + marcar como lida
  React.useEffect(() => {
    const supabase = createClient();
    let cancelado = false;

    (async () => {
      const { data, error } = await supabase
        .from("freelancer_solicitacao_mensagens")
        .select("*, autor:profiles(nome)")
        .eq("solicitacao_id", solicitacaoId)
        .order("created_at", { ascending: true });

      if (!cancelado) {
        if (error) {
          setErro(error.message);
        } else if (data) {
          setMensagens(
            (data as any[]).map((m) => ({
              id: m.id,
              solicitacao_id: m.solicitacao_id,
              autor_id: m.autor_id,
              texto: m.texto,
              created_at: m.created_at,
              autor_nome: m.autor?.nome ?? null,
            })),
          );
        }
        setCarregando(false);
      }
    })();

    // Marca como lida ao abrir
    marcarMensagensComoLidas(solicitacaoId);

    return () => {
      cancelado = true;
    };
  }, [solicitacaoId]);

  // Subscription Realtime pra INSERT novos
  React.useEffect(() => {
    const supabase = createClient();
    const canal = supabase
      .channel(`chat-solicitacao-${solicitacaoId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "freelancer_solicitacao_mensagens",
          filter: `solicitacao_id=eq.${solicitacaoId}`,
        },
        async (payload) => {
          const nova = payload.new as FreelancerSolicitacaoMensagem;
          // Dedup se já tem na lista (envio otimista)
          setMensagens((atual) => {
            if (atual.find((m) => m.id === nova.id)) return atual;
            return [
              ...atual,
              {
                ...nova,
                autor_nome: null, // Nome real vem numa refetch se precisar
              },
            ];
          });
          // Se não é mensagem minha, puxa o nome do autor
          if (nova.autor_id && nova.autor_id !== userId) {
            const { data: perfil } = await supabase
              .from("profiles")
              .select("nome")
              .eq("id", nova.autor_id)
              .maybeSingle();
            if (perfil) {
              setMensagens((atual) =>
                atual.map((m) =>
                  m.id === nova.id
                    ? { ...m, autor_nome: (perfil as any).nome }
                    : m,
                ),
              );
            }
            // Marca como lida também pras novas chegadas enquanto estou vendo
            marcarMensagensComoLidas(solicitacaoId);
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
    };
  }, [solicitacaoId, userId]);

  // Auto-scroll pra última mensagem
  React.useEffect(() => {
    if (listaRef.current) {
      listaRef.current.scrollTop = listaRef.current.scrollHeight;
    }
  }, [mensagens.length]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const t = texto.trim();
    if (!t) return;

    // Otimista: adiciona com id temporário
    const idTemp = `temp-${Date.now()}`;
    const otimista: MensagemComAutor = {
      id: idTemp,
      solicitacao_id: solicitacaoId,
      autor_id: userId,
      texto: t,
      created_at: new Date().toISOString(),
      autor_nome: "Você",
    };
    setMensagens((m) => [...m, otimista]);
    setTexto("");

    startEnviar(async () => {
      const r = await enviarMensagem(solicitacaoId, t);
      if (!r.ok) {
        setErro(r.message);
        // Remove otimista em caso de falha
        setMensagens((m) => m.filter((x) => x.id !== idTemp));
      } else if (r.data?.id) {
        // Substitui id temp pelo real (realtime pode chegar e dedup acontece)
        setMensagens((m) =>
          m.map((x) => (x.id === idTemp ? { ...x, id: r.data!.id } : x)),
        );
      }
    });
  }

  return (
    <div className="pt-5 space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-california-red/10 text-california-red">
          <MessageSquare className="h-3 w-3" />
        </div>
        <h4 className="text-xs font-bold uppercase tracking-[0.08em] text-foreground">
          Conversa
        </h4>
      </div>

      <div
        ref={listaRef}
        className="max-h-[320px] overflow-y-auto rounded-lg border border-border bg-muted/20 p-3 space-y-3"
      >
        {carregando ? (
          <p className="text-xs text-muted-foreground text-center py-6">
            Carregando mensagens...
          </p>
        ) : mensagens.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">
            Nenhuma mensagem ainda. Comece a conversa pra discutir detalhes
            desta solicitação.
          </p>
        ) : (
          mensagens.map((m) => (
            <MensagemLinha key={m.id} m={m} isSelf={m.autor_id === userId} />
          ))
        )}
      </div>

      {erro && (
        <p className="text-xs text-california-red font-medium">{erro}</p>
      )}

      <form onSubmit={onSubmit} className="flex items-end gap-2">
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit(e);
            }
          }}
          placeholder="Digite uma mensagem... (Enter envia, Shift+Enter nova linha)"
          rows={2}
          maxLength={2000}
          disabled={enviando}
          className="flex-1 min-h-[44px] resize-none rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:border-california-red focus:ring-2 focus:ring-california-red/15 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={enviando || !texto.trim()}
          className="inline-flex h-[44px] w-[44px] items-center justify-center rounded-lg bg-california-red text-white shadow-sm hover:bg-california-red-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {enviando ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </button>
      </form>
    </div>
  );
}

function MensagemLinha({
  m,
  isSelf,
}: {
  m: MensagemComAutor;
  isSelf: boolean;
}) {
  const hora = new Date(m.created_at).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <div className={cn("flex gap-2", isSelf && "flex-row-reverse")}>
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
          isSelf
            ? "bg-california-red text-white"
            : "bg-muted text-muted-foreground",
        )}
      >
        {initials(m.autor_nome ?? "?")}
      </div>
      <div className={cn("flex-1 min-w-0", isSelf && "text-right")}>
        <div
          className={cn(
            "flex items-baseline gap-2 flex-wrap",
            isSelf && "justify-end",
          )}
        >
          <p className="text-[11px] font-semibold text-foreground">
            {isSelf ? "Você" : m.autor_nome ?? "—"}
          </p>
          <p className="text-[10px] text-muted-foreground">{hora}</p>
        </div>
        <p
          className={cn(
            "mt-0.5 inline-block max-w-full text-left text-sm whitespace-pre-wrap rounded-lg px-3 py-2 break-words",
            isSelf
              ? "bg-california-red/10 text-foreground"
              : "bg-white border border-border text-foreground",
          )}
        >
          {m.texto}
        </p>
      </div>
    </div>
  );
}
