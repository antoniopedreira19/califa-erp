"use client";

import * as React from "react";
import { FileText, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Ícone discreto na linha que abre o descritivo num cartão ancorado
 * (handoff "Descritivos nas Listas.dc.html", 04/09/2026).
 *
 * O cartão flutua sobre a tabela: a lista não muda de tamanho e nada mais
 * se move. Fecha com clique fora, no X ou com Esc — o clique DENTRO não
 * fecha, para dar para selecionar e copiar o texto.
 *
 * Quem controla qual cartão está aberto é a lista, não este componente:
 * `aberto`/`onAbertoChange` vêm de um state único por tela, e é isso que
 * garante um cartão por vez e que o "Ver descritivo do projeto" do cartão
 * do job consiga abrir o cartão do grupo.
 *
 * ⚠️ O Portal do Radix é um portal do REACT: o evento continua subindo
 * pela árvore de componentes, ou seja, chegaria no `onClick` da linha e
 * navegaria. Por isso o gatilho E o cartão param a propagação — as três
 * chamadas de hoje vivem dentro de `<tr role="button">` clicável.
 */
export interface DescritivoPopoverProps {
  /** Rótulo do cartão: "Descritivo do projeto" ou "Descritivo do job". */
  rotulo: string;
  codigo: string | null;
  nome: string | null;
  /**
   * O texto. Vazio ou nulo apaga o ícone e desliga o clique: são os
   * registros anteriores à obrigatoriedade (decisão 043) — 12 dos 19
   * projetos e 27 dos 30 jobs na data do handoff. Não há backfill, então
   * o apagado é permanente até alguém editar o registro.
   */
  texto: string | null;
  aberto: boolean;
  onAbertoChange: (aberto: boolean) => void;
  /**
   * Um SEGUNDO texto, com rótulo próprio, abaixo do principal — para o
   * registro que descreve o trabalho em dois campos. Hoje é a PP:
   * "Descrição do serviço" e "Especificações". Vazio não desenha nada.
   */
  extra?: { rotulo: string; texto: string | null } | null;
  /**
   * O que o gatilho diz no `title` e para o leitor de tela. O padrão sai
   * do rótulo em minúsculas, que fica torto quando ele tem sigla
   * ("ver descrição da pp").
   */
  acaoGatilho?: string;
  /** Linhas de rodapé, abaixo do filete. */
  rodape?: React.ReactNode;
  align?: "start" | "center" | "end";
}

export function DescritivoPopover({
  rotulo,
  codigo,
  nome,
  texto,
  aberto,
  onAbertoChange,
  extra,
  acaoGatilho,
  rodape,
  align = "start",
}: DescritivoPopoverProps) {
  const extraTexto = extra?.texto?.trim() ?? "";
  const conteudo = texto?.trim() ?? "";
  const temTexto = conteudo.length > 0;

  // Sem texto o ícone continua ocupando o lugar — a coluna não dança
  // conforme a linha tem ou não descritivo —, mas não é botão.
  if (!temTexto) {
    return (
      <span
        aria-hidden="true"
        title="Registro anterior à obrigatoriedade"
        className="inline-flex h-6 w-6 flex-none items-center justify-center rounded-lg text-[#DCD8D1]"
      >
        <FileText className="h-3.5 w-3.5" />
      </span>
    );
  }

  return (
    <Popover open={aberto} onOpenChange={onAbertoChange}>
      <PopoverTrigger
        aria-label={acaoGatilho ?? `Ver ${rotulo.toLowerCase()}`}
        title={acaoGatilho ?? "Ver descritivo"}
        onClick={(e) => e.stopPropagation()}
        // Idem: o Enter/Espaço que abre o cartão não pode virar navegação
        // da linha, e o Esc tem que continuar chegando no Radix.
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") e.stopPropagation();
        }}
        className={cn(
          "inline-flex h-6 w-6 flex-none items-center justify-center rounded-lg transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          aberto
            ? "bg-california-red-soft text-california-red"
            : "text-[#b0736f] hover:bg-california-red-soft hover:text-california-red",
        )}
      >
        <FileText className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={2}
        className="w-[470px] p-0"
        onClick={(e) => e.stopPropagation()}
        // ⚠️ Só Enter e Espaço, NUNCA a tecla toda. A linha da tabela
        // navega no Enter/Espaço e é disso que o cartão precisa se
        // defender; parar o resto engole o Esc antes do Radix (que
        // escuta no document) e o cartão deixa de fechar pelo teclado.
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") e.stopPropagation();
        }}
      >
        <div className="flex flex-col gap-[9px] px-[17px] pb-3.5 pt-[15px]">
          <div className="flex items-center gap-2">
            <FileText className="h-3.5 w-3.5 flex-none text-california-red" />
            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#a5a29b]">
              {rotulo}
            </span>
            <button
              type="button"
              aria-label="Fechar"
              onClick={() => onAbertoChange(false)}
              className="ml-auto inline-flex h-[22px] w-[22px] flex-none items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[11.5px] text-california-red">
              {codigo ?? "—"}
            </span>
            <span className="text-[13.5px] font-semibold">{nome ?? "—"}</span>
          </div>
          {/* `whitespace-pre-wrap` porque o campo é um textarea: as quebras
              de linha que a produção escreveu fazem parte do texto. */}
          <p className="whitespace-pre-wrap text-[13px] leading-[1.65] text-[#4a4a4a]">
            {conteudo}
          </p>
          {extraTexto && (
            <div className="mt-0.5 flex flex-col gap-1 border-t border-[#F2F1ED] pt-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#a5a29b]">
                {extra?.rotulo}
              </span>
              <p className="whitespace-pre-wrap text-[13px] leading-[1.65] text-[#4a4a4a]">
                {extraTexto}
              </p>
            </div>
          )}
          {rodape && (
            <div className="mt-0.5 flex flex-col gap-[7px] border-t border-[#F2F1ED] pt-2">
              {rodape}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Linha de rodapé do cartão: ícone pequeno + texto acinzentado. */
export function DescritivoRodapeNota({
  icone,
  children,
}: {
  icone: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span className="flex items-center gap-1.5 text-[11.5px] text-[#a5a29b]">
      {icone}
      {children}
    </span>
  );
}
