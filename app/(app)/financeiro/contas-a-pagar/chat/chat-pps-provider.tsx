"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import type { ConversaPPs } from "@/lib/data/chat-pps-conversas";
import { recarregarConversasPPs } from "./actions";

/**
 * O estado do chat de PPs do financeiro, compartilhado por duas peças que
 * não são vizinhas na árvore: o badge no título da aba "Pedidos de
 * Produção (PPs)" e o botão flutuante dentro do painel dessa aba.
 *
 * Ele fica montado o tempo todo, e não só quando a aba de PPs está
 * aberta: Contas a Pagar abre em "Títulos a Pagar", e o badge da aba só
 * serve pra alguma coisa se ele existir ANTES de alguém clicar nela.
 *
 * Realtime escuta o fio de PPs inteiro (todos os jobs) — o RLS da tabela
 * vale no canal, então ninguém recebe fio de outro tenant.
 */

interface Ctx {
  conversas: ConversaPPs[];
  /** Quantos CHATS têm mensagem não lida — não quantas mensagens. */
  chatsNaoLidos: number;
  recarregar: () => Promise<void>;
  /** Zera as não lidas de um job na hora, sem esperar o servidor. */
  zerarNaoLidas: (jobId: string) => void;
  podeEnviar: boolean;
}

const ChatPPsContext = React.createContext<Ctx | null>(null);

export function useChatPPs(): Ctx {
  const ctx = React.useContext(ChatPPsContext);
  if (!ctx) {
    throw new Error("useChatPPs precisa estar dentro de <ChatPPsProvider>.");
  }
  return ctx;
}

export function ChatPPsProvider({
  conversasIniciais,
  podeEnviar,
  children,
}: {
  conversasIniciais: ConversaPPs[];
  podeEnviar: boolean;
  children: React.ReactNode;
}) {
  const [conversas, setConversas] = React.useState(conversasIniciais);

  const recarregar = React.useCallback(async () => {
    const novas = await recarregarConversasPPs();
    setConversas(novas);
  }, []);

  const zerarNaoLidas = React.useCallback((jobId: string) => {
    setConversas((atuais) =>
      atuais.map((c) => (c.jobId === jobId ? { ...c, naoLidas: 0 } : c)),
    );
  }, []);

  React.useEffect(() => {
    const supabase = createClient();
    let canal: ReturnType<typeof supabase.channel> | null = null;
    let cancelado = false;

    /**
     * A sessão TEM que estar em mão antes de assinar.
     *
     * `createBrowserClient` devolve um client já utilizável, mas o token
     * chega ao Realtime de forma assíncrona. Assinar no mesmo tick do
     * mount abre o canal como `anon` — e aí o RLS de `jobs_mensagens`
     * (`is_tenant_member`) reprova e TODO evento é descartado em
     * silêncio: nada quebra, nada loga, a lista só nunca atualiza.
     * Foi exatamente o que aconteceu em 08/09/2026, e só apareceu olhando
     * `realtime.subscription.claims_role` no banco.
     */
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelado) return;
      const token = data.session?.access_token;
      if (token) await supabase.realtime.setAuth(token);
      if (cancelado) return;

      canal = supabase
        .channel("chat-pps-financeiro")
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "jobs_mensagens",
            // Sem `filter`: o Realtime do Supabase não filtra por coluna
            // de enum, e `escopo=eq.pps` engolia TODOS os eventos em
            // silêncio — a lista simplesmente não atualizava (08/09/2026).
            // O canal do job escapa disso porque filtra por `job_id`, que
            // é uuid, e confere o escopo no JS. Aqui não há um job só,
            // então o recorte inteiro é no JS mesmo. O RLS continua
            // valendo no canal: ninguém recebe fio de outro tenant.
          },
          (payload: any) => {
            if (payload?.new?.escopo !== "pps") return;
            // A conta de não lidas é do servidor (ela depende de
            // `jobs_chat_leituras`), então o evento só serve de gatilho.
            void recarregar();
          },
        )
        .subscribe();
    })();

    return () => {
      cancelado = true;
      if (canal) supabase.removeChannel(canal);
    };
  }, [recarregar]);

  const chatsNaoLidos = React.useMemo(
    () => conversas.filter((c) => c.naoLidas > 0).length,
    [conversas],
  );

  const valor = React.useMemo(
    () => ({ conversas, chatsNaoLidos, recarregar, zerarNaoLidas, podeEnviar }),
    [conversas, chatsNaoLidos, recarregar, zerarNaoLidas, podeEnviar],
  );

  return (
    <ChatPPsContext.Provider value={valor}>{children}</ChatPPsContext.Provider>
  );
}
