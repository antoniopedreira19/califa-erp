"use client";

import * as React from "react";
import { ArrowUp, Paperclip, X } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { chatAreaLabel, type ChatArea } from "@/lib/types";

interface Props {
  minhaArea: ChatArea;
  pending: boolean;
  erro: string | null;
  onLimparErro: () => void;
  /**
   * Retorna `true` se o envio deu certo — o textarea só é limpo nesse
   * caso, pra não perder o que o usuário escreveu quando a mensagem
   * falha (rede, RLS, validação).
   */
  onEnviar: (texto: string) => Promise<boolean>;
  placeholder?: string;
}

/**
 * Input padrão dos chats do job: textarea + badge "Enviando como…" +
 * botão de anexo (disabled) + botão de enviar. Cmd/Ctrl+Enter envia.
 * Compartilhado entre chat de Comunicação e chat de PPs.
 */
export function ChatInput({
  minhaArea,
  pending,
  erro,
  onLimparErro,
  onEnviar,
  placeholder = "Escreva para o outro time…",
}: Props) {
  const [texto, setTexto] = React.useState("");

  async function handleEnviar() {
    const t = texto.trim();
    if (!t) return;
    const ok = await onEnviar(t);
    if (ok) setTexto("");
  }

  return (
    <div className="flex flex-none flex-col gap-2.5 border-t border-border bg-white px-3.5 py-3">
      {erro && (
        <div className="flex items-center justify-between gap-2 rounded border border-california-red/40 bg-california-red/5 px-2.5 py-1.5 text-xs text-california-red">
          <span>{erro}</span>
          <button type="button" onClick={onLimparErro}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10.5px] text-muted-foreground">
          Enviando como
        </span>
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
          placeholder={placeholder}
          className="flex-1 resize-none rounded-[10px] border border-border bg-white px-[11px] py-[9px] text-[12.5px] leading-[1.45] outline-none focus:border-california-red/40"
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
  );
}
