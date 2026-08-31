"use client";

/**
 * "Informações de faturamento e cobrança" — o que o botão `i` abre.
 *
 * Nasceu para desafogar as tabelas de Contas a Receber. O contato de
 * cobrança vivia dentro da célula do cliente (aba Faturamento) e da célula
 * de jobs cobertos (aba Títulos a Receber), empurrando a linha para três
 * alturas e ainda assim mostrando só nome e e-mail. Nem PO nem a instrução
 * do GP cabiam em lugar nenhum.
 *
 * A saída, do handoff "Contas a Receber - Faturamento Agrupado": um único
 * modal, aberto por um botão `i` por linha, com as três coisas que quem
 * fatura ou cobra precisa saber e que não cabem na grade — PO, descrição
 * da NF e contatos.
 *
 * O quarto bloco, a quebra job × save, é condicional e só aparece quando a
 * linha carrega saldo em save (decisão do Tiago, 31/08/2026). Ele saiu da
 * coluna Valor da aba Faturamento e veio parar aqui, porque lá disputava
 * espaço com o número que a coluna existe para mostrar.
 *
 * Um componente só, e não um por aba, pelo mesmo motivo das cores das
 * planilhas: bloco repetido é bloco que diverge (`docs/09-identidade-visual-ui.md`).
 */

import * as React from "react";
import { Info, Mail, Phone } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { ContatoCobranca } from "@/lib/data/contatos-cobranca";

/** A quebra da parcela entre o faturamento do job e o saldo em save. */
export interface QuebraSave {
  job: number;
  save: number;
}

export interface InfoFaturamento {
  /** Linha do subtítulo: `JOB-0020 · Cliente · parcela 1/2`. */
  referencia: string;
  /** PO do envio para faturamento. Nem todo job tem, e BV nunca tem. */
  po: string | null;
  /** Instrução do GP sobre como a nota deve ser descrita. */
  descricaoNf: string | null;
  contatos: ContatoCobranca[];
  /** Só quando há saldo em save nesta linha. */
  quebra?: QuebraSave | null;
}

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Duas letras para o avatar. Nome vazio não deve virar avatar em branco. */
function iniciais(nome: string | null | undefined): string {
  const partes = (nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

function Rotulo({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
      {children}
    </span>
  );
}

/** Estado legítimo, e não erro: por isso itálico e cinza, não vermelho. */
function Vazio({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[12.5px] italic text-muted-foreground/80">
      {children}
    </span>
  );
}

export function InfoFaturamentoModal({
  info,
  onOpenChange,
}: {
  /** `null` fecha — o modal não guarda estado próprio. */
  info: InfoFaturamento | null;
  onOpenChange: (aberto: boolean) => void;
}) {
  return (
    <Dialog open={info !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[470px] gap-0 p-0">
        <DialogHeader className="flex-row items-center gap-2.5 space-y-0 border-b border-border px-5 py-4">
          <Info className="h-[17px] w-[17px] shrink-0 text-california-red" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <DialogTitle className="text-[15px] font-bold">
              Informações de faturamento e cobrança
            </DialogTitle>
            <DialogDescription className="truncate text-[11.5px]">
              {info?.referencia ?? ""}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-1.5">
            <Rotulo>Envio para faturamento · PO</Rotulo>
            {info?.po ? (
              <span className="self-start rounded-lg border border-border bg-muted/70 px-2.5 py-1.5 font-mono text-[13px] font-bold">
                {info.po}
              </span>
            ) : (
              <Vazio>Sem PO registrado no envio para faturamento.</Vazio>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Rotulo>Descrição de NF</Rotulo>
            {info?.descricaoNf?.trim() ? (
              // `whitespace-pre-line`: o GP escreve em linhas, e virar
              // parágrafo corrido perderia a formatação que ele deu.
              <p className="whitespace-pre-line text-[13px] text-pretty">
                {info.descricaoNf}
              </p>
            ) : (
              <Vazio>
                O gerente de projetos não informou a descrição no envio.
              </Vazio>
            )}
          </div>

          {info?.quebra && (
            <div className="flex flex-col gap-1.5">
              <Rotulo>Composição do valor</Rotulo>
              <div className="overflow-hidden rounded-lg border border-border">
                <LinhaQuebra rotulo="Faturamento do job" valor={info.quebra.job} />
                <LinhaQuebra
                  rotulo="Saldo em save do cliente"
                  valor={info.quebra.save}
                  destaque
                />
              </div>
              <p className="text-[11.5px] text-muted-foreground text-pretty">
                A nota sai com dois itens: o job vem primeiro, e o que passar
                dele entra como crédito do cliente.
              </p>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Rotulo>Contatos de cobrança</Rotulo>
            {info && info.contatos.length > 0 ? (
              info.contatos.map((c, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2.5"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-california-red/10 text-[10.5px] font-bold text-california-red">
                    {iniciais(c.nome)}
                  </div>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[12.5px] font-semibold">
                      {c.nome?.trim() || "Sem nome"}
                    </span>
                    {c.email?.trim() && (
                      <a
                        href={`mailto:${c.email.trim()}`}
                        className="inline-flex items-center gap-1.5 truncate text-[11.5px] text-california-red hover:underline"
                      >
                        <Mail className="h-3 w-3 shrink-0" />
                        {c.email.trim()}
                      </a>
                    )}
                    {c.numero?.trim() && (
                      <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                        <Phone className="h-3 w-3 shrink-0" />
                        {c.numero.trim()}
                      </span>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <Vazio>Sem contato de cobrança cadastrado.</Vazio>
            )}
          </div>
        </div>

        <div className="flex justify-end border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg border border-border bg-white px-3.5 py-2 text-[12.5px] font-semibold transition-colors hover:border-border/80 hover:bg-muted/50"
          >
            Fechar
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LinhaQuebra({
  rotulo,
  valor,
  destaque,
}: {
  rotulo: string;
  valor: number;
  destaque?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 px-3 py-2 text-[12.5px]",
        destaque ? "border-t border-border bg-muted/40" : "bg-white",
      )}
    >
      <span className={cn(destaque ? "font-semibold" : "text-muted-foreground")}>
        {rotulo}
      </span>
      <span className="font-mono font-bold tabular-nums">
        {formatMoney(valor)}
      </span>
    </div>
  );
}

/** O botão redondo que abre o modal. Igual nas duas abas. */
export function BotaoInfo({
  onClick,
  className,
}: {
  onClick: (e: React.MouseEvent) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="PO, descrição de NF e contatos de cobrança"
      aria-label="Ver informações de faturamento e cobrança"
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-white text-muted-foreground transition-colors hover:border-california-red hover:text-california-red",
        className,
      )}
    >
      <Info className="h-3.5 w-3.5" />
    </button>
  );
}
