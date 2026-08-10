"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MessagesSquare, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { useIrParaAbaInformacoes } from "../job-tabs";
import type { ChatTom, ItemChat, ChatArea } from "@/lib/types";
import { enviarMensagem, marcarChatLido } from "./actions";
import {
  ICONE_COMPONENTE,
  ICONE_CORES,
  PILL_CORES,
} from "@/components/chat/icone-map";
import { BalaoPessoa } from "@/components/chat/balao-pessoa";
import { ChatInput } from "@/components/chat/chat-input";

interface Props {
  jobId: string;
  jobCodigo: string;
  itens: ItemChat[];
  naoLidas: number;
  /** Área de quem está logado — vem do papel, não é escolhida. */
  minhaArea: ChatArea;
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

export function JobChatSection({
  jobId,
  jobCodigo,
  itens,
  naoLidas,
  minhaArea,
}: Props) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [abertas, setAbertas] = React.useState<Record<string, boolean>>({});
  const [badge, setBadge] = React.useState(naoLidas);
  const fimRef = React.useRef<HTMLDivElement>(null);
  const marcouRef = React.useRef(false);

  React.useEffect(() => {
    const ultimaErrata = [...itens]
      .reverse()
      .find((i) => i.tipo === "sistema" && i.id !== "abertura");
    setAbertas(ultimaErrata ? { [ultimaErrata.id]: true } : {});
  }, [itens]);

  React.useEffect(() => {
    if (marcouRef.current || naoLidas === 0) return;
    marcouRef.current = true;
    marcarChatLido(jobId).then(() => setBadge(0));
  }, [jobId, naoLidas]);

  React.useEffect(() => {
    fimRef.current?.scrollIntoView({ block: "end" });
  }, [itens.length]);

  React.useEffect(() => {
    const supabase = createClient();
    const canal = supabase
      .channel(`chat-job-${jobId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "jobs_mensagens",
          filter: `job_id=eq.${jobId}`,
        },
        async (payload: any) => {
          // Só o chat geral: escopo 'pps' é outro canal semântico.
          if (payload?.new?.escopo && payload.new.escopo !== "geral") return;
          await marcarChatLido(jobId);
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
      const res = await enviarMensagem(jobId, texto);
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
    <div className="flex h-[620px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <div className="flex flex-none items-center gap-2.5 border-b border-border bg-white px-[18px] py-4">
        <MessagesSquare className="h-[17px] w-[17px] text-california-red" />
        <div className="min-w-0">
          <h2 className="text-xs font-semibold uppercase tracking-[0.08em]">
            Comunicação
          </h2>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            Produção ↔ Financeiro · {jobCodigo}
          </p>
        </div>
        {badge > 0 && (
          <span className="ml-auto inline-flex items-center whitespace-nowrap rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-[10.5px] font-semibold text-red-700">
            {badge} {badge === 1 ? "não lida" : "não lidas"}
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto bg-[#FAFAFA] p-[18px]">
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

      <ChatInput
        minhaArea={minhaArea}
        pending={pending}
        erro={erro}
        onLimparErro={() => setErro(null)}
        onEnviar={handleEnviar}
      />
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
  const irParaInformacoes = useIrParaAbaInformacoes();
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
          {irParaInformacoes && (
            <button
              type="button"
              onClick={irParaInformacoes}
              className="self-start text-[11.5px] text-california-red hover:underline"
            >
              Abrir na aba Informações →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

