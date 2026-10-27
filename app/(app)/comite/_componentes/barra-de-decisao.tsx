"use client";

// A barra de decisão do Comitê de Aprovações (decisão 223), no pé da página
// do orçamento ou do job aberta no pop-up da caixa — no desenho da barra
// "Aprovar versão" da produção. Na versão: Devolver ao GP e Aprovar versão
// (verde). Na PP: "Abrir menu de PPs" e "Abrir PP"; com a PP aberta, "Abrir
// PP" dá lugar a Devolver e Aprovar (vermelho, como os botões da PP).
import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, FileText, Gavel, ListTree, Undo2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { formatDataAsHoraBr } from "@/lib/formatar-data-hora";
import { aprovarPedidoDoComite, devolverPedidoDoComite } from "../actions";
import { MENSAGEM_DECIDIDO } from "../tipos";
import { MotivoDoCaso, type LinhaDoMotivo } from "./motivo-do-caso";

type Acao = "aprovar" | "devolver";

export interface PedidoNaBarra {
  id: string;
  tipo: "versao" | "pp";
  situacao: "pendente" | "aprovado" | "devolvido" | "cancelado";
  decididoPor: string | null;
  decididoEm: string | null;
  comentario: string | null;
}

function ConfirmarDecisao({
  tipo,
  versaoLabel,
  acao,
  linhas,
  onCancelar,
  onConfirmar,
}: {
  tipo: "versao" | "pp";
  versaoLabel: string | null;
  acao: Acao | null;
  linhas: LinhaDoMotivo[];
  onCancelar: () => void;
  onConfirmar: (comentario: string) => Promise<string | null>;
}) {
  const [comentario, setComentario] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);
  const [pendente, startTransition] = React.useTransition();
  React.useEffect(() => {
    setComentario("");
    setErro(null);
  }, [acao]);
  if (!acao) return null;
  const versao = tipo === "versao";
  const aprovar = acao === "aprovar";
  const titulo = aprovar
    ? versao
      ? `Tem certeza que quer aprovar a versão ${versaoLabel ?? ""}?`
      : "Tem certeza que quer aprovar a PP?"
    : versao
      ? "Devolver ao GP?"
      : "Devolver a quem enviou?";
  const descricao = aprovar
    ? versao
      ? "A versão fica aprovada. O GP segue com o envio do job para a abertura."
      : "A PP fica liberada para a produção gerar; depois segue o envio ao financeiro, como as outras."
    : versao
      ? "A versão volta a ser editável e o GP lê o seu comentário na tela do orçamento."
      : "A PP volta a quem enviou, salva, com o seu comentário.";

  return (
    <Dialog open onOpenChange={(o) => !o && !pendente && onCancelar()}>
      <DialogContent className="max-w-lg" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>
        </DialogHeader>
        {aprovar && <MotivoDoCaso linhas={linhas} />}
        <div>
          <label htmlFor="comentario-da-decisao" className="mb-1.5 block text-[13px] font-semibold">
            Comentário{aprovar ? <span className="font-normal text-muted-foreground"> (opcional)</span> : " *"}
          </label>
          <Textarea
            id="comentario-da-decisao"
            rows={3}
            maxLength={2000}
            value={comentario}
            onChange={(e) => {
              setComentario(e.target.value);
              setErro(null);
            }}
            placeholder={versao ? "Ex.: rever os honorários com o cliente." : "Ex.: pedir aditivo ao cliente."}
          />
          {erro && <p className="mt-1.5 text-[12px] font-medium text-california-red">{erro}</p>}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancelar}
            disabled={pendente}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={pendente}
            onClick={() => {
              if (!aprovar && !comentario.trim()) {
                setErro("Escreva o motivo da devolução.");
                return;
              }
              startTransition(async () => {
                const falha = await onConfirmar(comentario.trim());
                if (falha) setErro(falha);
              });
            }}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60",
              aprovar && versao ? "bg-emerald-600 hover:bg-emerald-700" : "bg-california-red hover:bg-california-red-hover",
            )}
          >
            {aprovar ? <CheckCircle2 className="h-4 w-4" /> : <Undo2 className="h-4 w-4" />}
            {pendente ? "Gravando…" : aprovar ? "Sim, aprovar" : "Sim, devolver"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function BarraDeDecisaoDoComite({
  pedido,
  resumo,
  motivoDaRegra,
  linhas,
  versaoLabel,
  embutido,
  ppAberta,
  onAbrirMenu,
  onAbrirPP,
}: {
  pedido: PedidoNaBarra;
  /** A primeira linha: o que está em decisão. */
  resumo: React.ReactNode;
  /** "Veio para o Comitê porque …", a frase das regras que pegaram. */
  motivoDaRegra: string;
  /** O quadro do motivo, na confirmação da aprovação. */
  linhas: LinhaDoMotivo[];
  versaoLabel: string | null;
  /** A página está no pop-up da caixa: decidir fecha o pop-up. */
  embutido: boolean;
  /** Só na PP: a PP do Comitê está aberta (consulta). */
  ppAberta: boolean;
  onAbrirMenu: (() => void) | null;
  onAbrirPP: (() => void) | null;
}) {
  const router = useRouter();
  const [acao, setAcao] = React.useState<Acao | null>(null);
  const versao = pedido.tipo === "versao";
  const pendente = pedido.situacao === "pendente";

  async function decidir(comentario: string): Promise<string | null> {
    const res =
      acao === "aprovar"
        ? await aprovarPedidoDoComite(pedido.id, comentario)
        : await devolverPedidoDoComite(pedido.id, comentario);
    if (!res.ok) return res.message;
    setAcao(null);
    if (embutido && window.parent !== window) {
      window.parent.postMessage({ tipo: MENSAGEM_DECIDIDO }, window.location.origin);
    } else {
      router.push(`/comite?aba=${versao ? "jobs" : "pps"}`);
    }
    return null;
  }

  return (
    <>
      <div
        data-barra-do-comite=""
        className="sticky bottom-0 z-30 -mx-1 flex flex-wrap items-center justify-between gap-4 rounded-t-2xl border border-b-0 border-border bg-white/95 px-5 py-2 shadow-[0_-4px_16px_-8px_rgba(0,0,0,0.12)] backdrop-blur"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-xs text-muted-foreground">
            <Gavel className="mr-1 inline h-3.5 w-3.5 -translate-y-px text-california-red" />
            {resumo}
          </span>
          {pendente ? (
            <span className="flex items-start gap-1.5 truncate text-xs font-medium text-california-red">
              <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
              Veio para o Comitê porque {motivoDaRegra}.
            </span>
          ) : (
            <span className="truncate text-xs text-muted-foreground">
              <strong
                className={
                  pedido.situacao === "aprovado"
                    ? "text-emerald-700"
                    : pedido.situacao === "devolvido"
                      ? "text-california-red"
                      : "text-foreground"
                }
              >
                {pedido.situacao === "aprovado" ? "Aprovado" : pedido.situacao === "devolvido" ? "Devolvido" : "Envio cancelado"}
              </strong>
              {pedido.decididoPor && ` por ${pedido.decididoPor} em ${formatDataAsHoraBr(pedido.decididoEm)}`}
              {pedido.comentario ? ` · “${pedido.comentario}”` : ""}
            </span>
          )}
        </div>

        <div className="flex flex-none items-center gap-2.5">
          {!versao && onAbrirMenu && (
            <button
              type="button"
              onClick={onAbrirMenu}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-[13px] font-semibold text-foreground transition-colors hover:border-california-red/40 hover:text-california-red"
            >
              <ListTree className="h-4 w-4" />
              Abrir menu de PPs
            </button>
          )}
          {!versao && pendente && !ppAberta && onAbrirPP && (
            <button
              type="button"
              onClick={onAbrirPP}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition-all hover:bg-california-red-hover hover:shadow-lg"
            >
              <FileText className="h-4 w-4" />
              Abrir PP
            </button>
          )}
          {pendente && (versao || ppAberta) && (
            <>
              <button
                type="button"
                onClick={() => setAcao("devolver")}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-[13px] font-semibold text-foreground transition-colors hover:border-california-red/40 hover:text-california-red"
              >
                <Undo2 className="h-4 w-4" />
                {versao ? "Devolver ao GP" : "Devolver"}
              </button>
              <button
                type="button"
                onClick={() => setAcao("aprovar")}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition-all hover:shadow-lg",
                  versao ? "bg-emerald-600 hover:bg-emerald-700" : "bg-california-red hover:bg-california-red-hover",
                )}
              >
                <CheckCircle2 className="h-4 w-4" />
                {versao ? "Aprovar versão" : "Aprovar"}
              </button>
            </>
          )}
        </div>
      </div>
      <ConfirmarDecisao
        tipo={pedido.tipo}
        versaoLabel={versaoLabel}
        acao={acao}
        linhas={linhas}
        onCancelar={() => setAcao(null)}
        onConfirmar={decidir}
      />
    </>
  );
}

/** "Envio de Fulano · data — “motivo”": quem mandou ao Comitê e por quê. */
export function EnvioAoComite({
  enviadoPor,
  enviadoEm,
  motivo,
}: {
  enviadoPor: string;
  enviadoEm: string;
  motivo: string;
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-california-red/25 bg-california-red/5 px-4 py-3">
      <Gavel className="mt-0.5 h-4 w-4 flex-none text-california-red" />
      <p className="text-[13px] text-muted-foreground">
        Envio de{" "}
        <span className="font-semibold text-foreground">
          {enviadoPor} · {formatDataAsHoraBr(enviadoEm)}
        </span>{" "}
        — “{motivo}”
      </p>
    </div>
  );
}

/** A página aberta no pop-up do Comitê: sem a barra lateral nem o recuo
 *  dela (o `<style>` sai no HTML do servidor, sem piscar). */
export function ModoEmbutido() {
  return <style>{`aside.fixed.bg-california-dark,button.fixed.top-4.left-4{display:none!important}main{padding-left:0!important}`}</style>;
}
