"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  MessagesSquare,
  ChevronRight,
  Paperclip,
  ArrowUp,
  FolderOpen,
  FilePenLine,
  Tags,
  X,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  chatAreaLabel,
  type ChatArea,
  type ChatTom,
  type ItemChat,
} from "@/lib/types";
import { enviarMensagem, marcarChatLido } from "./actions";

interface Props {
  jobId: string;
  jobCodigo: string;
  itens: ItemChat[];
  naoLidas: number;
  /** Área de quem está logado — vem do papel, não é escolhida. */
  minhaArea: ChatArea;
}

const ICONE_COMPONENTE = {
  "folder-open": FolderOpen,
  "file-pen-line": FilePenLine,
  tags: Tags,
} as const;

const ICONE_CORES = {
  azul: "bg-blue-50 text-blue-700",
  verde: "bg-emerald-50 text-emerald-700",
  bege: "bg-[#f1f0ec] text-foreground",
  vermelho: "bg-red-50 text-red-700",
} as const;

const PILL_CORES = {
  positivo: "border-emerald-200 bg-emerald-50 text-emerald-700",
  negativo: "border-red-200 bg-red-50 text-red-700",
  neutro: "border-border bg-muted text-foreground",
} as const;

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

function iniciais(nome: string): string {
  return nome
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function JobChatSection({
  jobId,
  jobCodigo,
  itens,
  naoLidas,
  minhaArea,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [texto, setTexto] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);
  const [abertas, setAbertas] = React.useState<Record<string, boolean>>({});
  // Some assim que o usuário abre a aba, mas sem sumir antes de ele ver.
  const [badge, setBadge] = React.useState(naoLidas);
  const fimRef = React.useRef<HTMLDivElement>(null);
  const marcouRef = React.useRef(false);

  // Abre o card automático mais recente, como no design.
  React.useEffect(() => {
    const ultimoSistema = [...itens].reverse().find((i) => i.tipo === "sistema");
    if (ultimoSistema) setAbertas({ [ultimoSistema.id]: true });
  }, [itens]);

  // Marcar como lido é efeito de abrir a aba — roda uma vez só.
  React.useEffect(() => {
    if (marcouRef.current || naoLidas === 0) return;
    marcouRef.current = true;
    marcarChatLido(jobId).then(() => setBadge(0));
  }, [jobId, naoLidas]);

  React.useEffect(() => {
    fimRef.current?.scrollIntoView({ block: "end" });
  }, [itens.length]);

  // Realtime: mensagem do outro time aparece sem recarregar. O payload é
  // ignorado de propósito — a thread é montada no servidor (mistura
  // mensagens com erratas e a abertura), então o refresh traz tudo já
  // ordenado em vez de a gente remontar aqui e arriscar divergir.
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
        async () => {
          // Com a aba aberta a mensagem já está sendo lida agora: marca
          // antes do refresh, senão o servidor recalcula e o badge sobe
          // na cara de quem acabou de ler.
          await marcarChatLido(jobId);
          router.refresh();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
    };
  }, [jobId, router]);

  function handleEnviar() {
    const t = texto.trim();
    if (!t) return;
    setErro(null);
    startTransition(async () => {
      const res = await enviarMensagem(jobId, t);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setTexto("");
      router.refresh();
    });
  }

  return (
    <div className="flex h-[620px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <div className="flex flex-none items-center gap-2.5 border-b border-border bg-white px-4.5 py-4">
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

      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto bg-muted/30 p-4.5">
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

      <div className="flex flex-none flex-col gap-2.5 border-t border-border bg-white px-3.5 py-3">
        {erro && (
          <div className="flex items-center justify-between gap-2 rounded border border-california-red/40 bg-california-red/5 px-2.5 py-1.5 text-xs text-california-red">
            <span>{erro}</span>
            <button type="button" onClick={() => setErro(null)}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10.5px] text-muted-foreground">
            Enviando como
          </span>
          {/* Etiqueta, não escolha: a área vem do papel de quem está logado. */}
          <span className="inline-flex items-center rounded-full border border-foreground bg-foreground px-2.5 py-1 text-[10.5px] font-semibold text-white">
            {chatAreaLabel(minhaArea)}
          </span>
        </div>

        <div className="flex items-end gap-2">
          <textarea
            rows={2}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleEnviar();
              }
            }}
            maxLength={2000}
            placeholder="Escreva para o outro time…"
            className="flex-1 resize-none rounded-[10px] border border-border bg-white px-3 py-2.5 text-[12.5px] leading-relaxed outline-none focus:border-california-red/40"
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <button
                  type="button"
                  disabled
                  className="inline-flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-[10px] border border-border bg-white text-muted-foreground opacity-50"
                >
                  <Paperclip className="h-[15px] w-[15px]" />
                </button>
              </span>
            </TooltipTrigger>
            <TooltipContent>Em breve — anexos no chat</TooltipContent>
          </Tooltip>
          <button
            type="button"
            onClick={handleEnviar}
            disabled={pending || texto.trim().length === 0}
            className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] bg-california-red text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            title="Enviar (Cmd+Enter)"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </div>
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
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
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
        <div className="flex flex-col gap-2.5 border-t border-border bg-muted/40 px-3.5 py-3">
          {item.linhas.map((l, i) => (
            <div
              key={i}
              className="flex items-baseline gap-2 text-[11.5px] leading-relaxed"
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

function BalaoPessoa({
  item,
}: {
  item: Extract<ItemChat, { tipo: "pessoa" }>;
}) {
  // Produção à direita, Financeiro à esquerda — fixo por área, como no
  // design, pra thread ficar igual pros dois times.
  const direita = item.area === "producao";
  return (
    <div
      className={cn(
        "flex flex-none items-start gap-2.5",
        direita && "flex-row-reverse",
      )}
    >
      <div
        className={cn(
          "inline-flex h-7 w-7 flex-none items-center justify-center rounded-full text-[10.5px] font-bold text-white",
          direita ? "bg-california-red" : "bg-[#1e4fa3]",
        )}
      >
        {iniciais(item.autor)}
      </div>
      <div className="min-w-0 max-w-[80%]">
        <div
          className={cn(
            "mb-1 flex items-baseline gap-1.5",
            direita && "flex-row-reverse",
          )}
        >
          <span className="text-[11.5px] font-semibold">{item.autor}</span>
          <span className="text-[10.5px] text-muted-foreground">
            {chatAreaLabel(item.area)} · {item.quando}
          </span>
        </div>
        <div
          className={cn(
            "rounded-xl border px-3 py-2.5 text-[12.5px] leading-relaxed",
            direita
              ? "border-[#f3ced1] bg-[#fef5f5]"
              : "border-border bg-white",
          )}
        >
          {item.texto}
        </div>
      </div>
    </div>
  );
}
