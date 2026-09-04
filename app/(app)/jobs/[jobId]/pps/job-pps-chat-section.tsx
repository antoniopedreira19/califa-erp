"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { ChatArea, ChatTom, ItemChat } from "@/lib/types";
import { enviarMensagemPP, marcarChatPPsLido } from "./actions-chat";
import {
  ICONE_COMPONENTE,
  ICONE_CORES,
  PILL_CORES,
} from "@/components/chat/icone-map";
import { BalaoPessoa } from "@/components/chat/balao-pessoa";
import { ChatInput } from "@/components/chat/chat-input";

interface Props {
  jobId: string;
  itens: ItemChat[];
  minhaArea: ChatArea;
  /** Chamado uma vez, quando a section marca a thread como lida pela
   * primeira vez após aberta. O FAB usa isso pra zerar o badge local. */
  onLidoInicial: () => void;
  /**
   * Se `false`, o campo de escrita nao renderiza (Financeiro e Freelancer
   * so leem). Fonte-verdade: `lib/permissoes.ts`, recurso `chat.enviar`.
   */
  podeEnviar?: boolean;
}

function classeValor(tom: ChatTom): string {
  switch (tom) {
    case "positivo":
      return "font-mono text-[11.5px] font-bold text-emerald-700";
    case "negativo":
      return "font-mono text-[11.5px] font-bold text-red-700";
    case "neutro":
      return "font-mono text-[11.5px] font-semibold text-foreground";
    case "texto":
      return "text-[11.5px] font-semibold text-foreground";
  }
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
  const [abertas, setAbertas] = React.useState<Record<string, boolean>>({});
  const fimRef = React.useRef<HTMLDivElement>(null);
  const marcouRef = React.useRef(false);

  // Cards ficam fechados por default. Se o usuário quiser ver detalhes,
  // clica. Diferente do chat de Comunicação (que abre a última errata) —
  // aqui podem existir muitos cards de PP e abrir todos ocupa a thread.

  React.useEffect(() => {
    if (marcouRef.current) return;
    marcouRef.current = true;
    marcarChatPPsLido(jobId).then(() => onLidoInicial());
  }, [jobId, onLidoInicial]);

  React.useEffect(() => {
    fimRef.current?.scrollIntoView({ block: "end" });
  }, [itens.length]);

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
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto bg-[#FAFAFA] p-[18px]">
        {itens.length === 0 && (
          <div className="flex flex-1 items-center justify-center">
            <p className="max-w-[240px] text-center text-xs text-muted-foreground">
              Nenhuma PP nem mensagem por aqui ainda. Assim que uma PP for
              emitida ou alguém escrever, aparece na thread.
            </p>
          </div>
        )}
        {itens.map((item) =>
          item.tipo === "sistema" ? (
            <CardSistema
              key={item.id}
              item={item}
              aberto={!!abertas[item.id]}
              onAlternar={() =>
                setAbertas((p) => ({ ...p, [item.id]: !p[item.id] }))
              }
            />
          ) : (
            <BalaoPessoa key={item.id} item={item} />
          ),
        )}
        <div ref={fimRef} />
      </div>

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

function CardSistema({
  item,
  aberto,
  onAlternar,
}: {
  item: Extract<ItemChat, { tipo: "sistema" }>;
  aberto: boolean;
  onAlternar: () => void;
}) {
  const Icone = ICONE_COMPONENTE[item.icone];
  return (
    <div className="flex-none overflow-hidden rounded-xl border border-[#e4e2dd] bg-white">
      <button
        type="button"
        onClick={onAlternar}
        className="flex w-full items-start gap-2.5 px-3.5 py-3 text-left transition-colors hover:bg-california-red/[0.02]"
      >
        <span
          className={cn(
            "inline-flex h-6 w-6 flex-none items-center justify-center rounded-[7px]",
            ICONE_CORES[item.cor],
          )}
        >
          <Icone className="h-[13px] w-[13px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-[12.5px] font-semibold">{item.titulo}</span>
            <span className="text-[10.5px] text-muted-foreground">
              Automático · {item.quando}
            </span>
          </div>
          <p className="mt-1 text-xs leading-[1.45] text-muted-foreground">
            {item.resumo}
          </p>
        </div>
        {item.valor && (
          <span
            className={cn(
              "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-bold",
              PILL_CORES[item.valorTom],
            )}
          >
            {item.valor}
          </span>
        )}
        <ChevronRight
          className={cn(
            "h-[15px] w-[15px] flex-none text-[#c9c9c9] transition-transform",
            aberto && "rotate-90",
          )}
        />
      </button>

      {aberto && item.linhas.length > 0 && (
        <div className="flex flex-col gap-[9px] border-t border-border bg-[#f5f5f5]/50 px-3.5 py-3">
          {item.linhas.map((l, i) => (
            <div
              key={i}
              className="flex items-baseline gap-2 text-[11.5px] leading-[1.45]"
            >
              <span className="text-[#c9c9c9]">•</span>
              <span className="flex-1">{l.texto}</span>
              <span className={cn("whitespace-nowrap", classeValor(l.tom))}>
                {l.valor}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
