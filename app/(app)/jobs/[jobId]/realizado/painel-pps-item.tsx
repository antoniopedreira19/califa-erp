"use client";

/** Painel "Destrinchar realizado" — as PPs de UM item da planilha.
 *
 *  Design: `PPs - Gerar e Enviar ao Financeiro.dc.html` (02/09/2026),
 *  que substituiu a ficha numérica da opção 2a de `Job - PPs Parciais -
 *  Opcoes`. O que mudou, e por quê (decisão 039):
 *
 *  - A PP nasce GERADA e fica aqui, no job, até alguém enviá-la ao
 *    financeiro. Enviar, editar, ver e cancelar são ações por PP, e o
 *    painel se parte em dois blocos: "Aguardando envio" em cima, "Já no
 *    financeiro" embaixo.
 *  - A referência do item virou o PLANEJADO (era o orçado), e "Em PPs
 *    emitidas" soma só o que já chegou ao financeiro — a gerada conta só
 *    na pendência. O número acende em vermelho quando passa do planejado.
 *  - O Saldo e o "máximo aceito" saíram: sem teto por PP eles não decidem
 *    mais nada. Passar do planejado não impede gerar; no envio, pede o
 *    responsável do job (ou administrador) e um "tem certeza?" com o
 *    quanto o item fica acima.
 *  - Fora da verba de produção, a PP sem anexo não envia: o pedido de NF
 *    aparece em vermelho na própria linha.
 *  - Com a abertura em revisão por errata (decisão 040), nada envia até o
 *    financeiro salvar a revisão. Gerar, editar e cancelar seguem.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  X,
  FilePlus,
  Eye,
  Send,
  Pencil,
  XCircle,
  Paperclip,
  AlertTriangle,
  Lock,
} from "lucide-react";
import { Dialog, DrawerContent } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn, formatCurrency } from "@/lib/utils";
import { ppStatusLabel, type PPStatus } from "@/lib/types";
import { passaDoPlanejado } from "@/lib/calculos/pps-item";
import {
  signedUrlPdf,
  enviarPedidoCompraAoFinanceiro,
  cancelarPedidoCompra,
  type AcimaDoPlanejado,
} from "./actions-pp";

export interface PPDoItem {
  id: string;
  codigo: string;
  status: PPStatus;
  fornecedorNome: string;
  valor: number;
  verbaProducao: boolean;
  /** Tem pelo menos um anexo. Fora da verba, é o que libera o envio. */
  temAnexo: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemNome: string;
  grupoNome: string;
  moeda: string;
  /** PLANEJADO do item — a referência da PP desde 02/09/2026. */
  totalPlanejado: number;
  /** PPs do item, sem as canceladas (o servidor já as tira do mapa). */
  pps: PPDoItem[];
  /** Soma das PPs que já chegaram ao financeiro. A gerada não entra. */
  emPPs: number;
  /** Errata devolveu o job ao mural: o envio fica fechado. */
  aberturaEmRevisao: boolean;
  /** Quem pode gerar também pode enviar, editar e cancelar. Null quando o
   *  usuário só lê — a tela do financeiro, o job congelado. */
  onNovaPP: (() => void) | null;
  onEditar: ((pp: PPDoItem) => void) | null;
  /** Mensagem de sucesso para o toast de quem abriu o painel. */
  onMensagem?: (mensagem: string) => void;
}

export function PainelPPsItem({
  open,
  onOpenChange,
  itemNome,
  grupoNome,
  moeda,
  totalPlanejado,
  pps,
  emPPs,
  aberturaEmRevisao,
  onNovaPP,
  onEditar,
  onMensagem,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [confirmando, setConfirmando] = React.useState<{
    pp: PPDoItem;
    numeros: AcimaDoPlanejado;
  } | null>(null);
  const [cancelando, setCancelando] = React.useState<PPDoItem | null>(null);

  const podeAgir = onNovaPP !== null;
  const pendentes = pps.filter((pp) => pp.status === "gerada");
  const enviadas = pps.filter((pp) => pp.status !== "gerada");
  const excede = passaDoPlanejado(emPPs, totalPlanejado);

  React.useEffect(() => {
    if (!open) {
      setErro(null);
      setConfirmando(null);
      setCancelando(null);
    }
  }, [open]);

  function verPdf(ppId: string) {
    startTransition(async () => {
      const res = await signedUrlPdf(ppId);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      window.open(res.url, "_blank", "noopener,noreferrer");
    });
  }

  /** O envio propriamente dito. `confirmado` é o "sim, enviar" do
   *  pop-up acima do planejado — sem ele o servidor devolve os números
   *  e o pop-up abre. */
  function enviar(pp: PPDoItem, confirmado: boolean) {
    setErro(null);
    startTransition(async () => {
      const res = await enviarPedidoCompraAoFinanceiro(pp.id, confirmado);
      if (!res.ok) {
        if (res.acimaDoPlanejado) {
          setConfirmando({ pp, numeros: res.acimaDoPlanejado });
          return;
        }
        setErro(res.message);
        return;
      }
      setConfirmando(null);
      onMensagem?.(`${res.codigo} enviada ao financeiro.`);
      router.refresh();
    });
  }

  function pedirEnvio(pp: PPDoItem) {
    // A mesma conta do servidor, feita antes para o pop-up abrir sem uma
    // ida ao servidor. Se os números da tela estiverem velhos, o servidor
    // devolve os dele e o pop-up abre do mesmo jeito.
    const emPPsDepois = Math.round((emPPs + pp.valor) * 100) / 100;
    if (passaDoPlanejado(emPPsDepois, totalPlanejado)) {
      setConfirmando({
        pp,
        numeros: {
          planejado: totalPlanejado,
          emPPsDepois,
          excedente: Math.round((emPPsDepois - totalPlanejado) * 100) / 100,
        },
      });
      return;
    }
    enviar(pp, false);
  }

  function cancelar() {
    if (!cancelando) return;
    const alvo = cancelando;
    startTransition(async () => {
      const res = await cancelarPedidoCompra(alvo.id);
      setCancelando(null);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onMensagem?.(`${alvo.codigo} cancelada.`);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="sm:max-w-[430px]">
        <div className="flex items-start justify-between gap-3 border-b border-border px-6 py-5">
          <div className="flex flex-col gap-1">
            <h2 className="text-[17px] font-bold tracking-tight">
              Destrinchar realizado
            </h2>
            <p className="text-[12.5px] text-muted-foreground">
              {itemNome} · grupo {grupoNome}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Fechar"
            className="inline-flex h-7 w-7 items-center justify-center rounded-[9px] border border-border bg-card text-muted-foreground hover:bg-muted"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="relative flex flex-1 flex-col gap-[18px] overflow-y-auto px-6 py-4">
          {erro && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-california-red/30 bg-california-red/5 px-3 py-2 text-xs text-california-red">
              <span>{erro}</span>
              <button type="button" onClick={() => setErro(null)} aria-label="Fechar aviso">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Os dois números do design: a referência e o que já está
              comprometido. O Saldo saiu — sem teto ele não decide nada. */}
          <div className="grid grid-cols-2 overflow-hidden rounded-[14px] border border-border bg-card">
            <FichaNumero
              rotulo="Planejado do item"
              valor={formatCurrency(totalPlanejado, moeda)}
              className="border-r border-border"
            />
            <FichaNumero
              rotulo="Em PPs emitidas"
              valor={formatCurrency(emPPs, moeda)}
              corValor={excede ? "text-california-red" : undefined}
            />
          </div>

          {aberturaEmRevisao && pendentes.length > 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
              <p className="text-[11.5px] leading-relaxed text-amber-800">
                A abertura deste job está em revisão no financeiro desde a
                última errata. O envio de PPs volta quando a revisão for salva
                — gerar, editar e cancelar continuam liberados.
              </p>
            </div>
          )}

          {pps.length === 0 && (
            <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
              Nenhuma PP gerada para este item ainda.
            </div>
          )}

          {pendentes.length > 0 && (
            <div className="flex flex-col gap-2.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                Aguardando envio · {pendentes.length}
              </span>
              {pendentes.map((pp) => {
                const semNF = !pp.verbaProducao && !pp.temAnexo;
                const podeEnviar = podeAgir && !semNF && !aberturaEmRevisao;
                return (
                  <div
                    key={pp.id}
                    className="flex flex-col gap-2.5 rounded-xl border border-border px-3.5 py-3"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono text-[11px] font-semibold text-muted-foreground">
                        {pp.codigo}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
                        {pp.fornecedorNome}
                      </span>
                      <span className="font-mono text-[13px] font-bold">
                        {formatCurrency(pp.valor, moeda)}
                      </span>
                    </div>

                    {semNF && (
                      <span className="flex items-start gap-1.5 text-[11px] leading-snug text-california-red">
                        <Paperclip className="mt-0.5 h-3 w-3 shrink-0" />
                        Anexe a NF do fornecedor para enviar esta PP ao
                        financeiro.
                      </span>
                    )}

                    <div className="flex items-center gap-1.5">
                      {podeAgir && (
                        <button
                          type="button"
                          onClick={() => pedirEnvio(pp)}
                          disabled={pending || !podeEnviar}
                          title={
                            aberturaEmRevisao
                              ? "Abertura em revisão: o envio volta quando o financeiro salvar a revisão."
                              : semNF
                                ? "Anexe a NF antes de enviar."
                                : undefined
                          }
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-[9px] border px-3 py-1.5 text-[11.5px] font-bold transition-colors",
                            podeEnviar
                              ? "border-california-red bg-california-red text-white hover:bg-california-red-hover"
                              : "cursor-not-allowed border-border bg-muted text-muted-foreground/70",
                            pending && "opacity-60",
                          )}
                        >
                          <Send className="h-3 w-3" />
                          Enviar ao financeiro
                        </button>
                      )}
                      <span className="ml-auto inline-flex items-center gap-1.5">
                        {onEditar && (
                          <BotaoIcone
                            titulo="Editar"
                            onClick={() => onEditar(pp)}
                            disabled={pending}
                          >
                            <Pencil className="h-3 w-3" />
                          </BotaoIcone>
                        )}
                        <BotaoIcone
                          titulo="Ver PP"
                          onClick={() => verPdf(pp.id)}
                          disabled={pending}
                        >
                          <Eye className="h-3 w-3" />
                        </BotaoIcone>
                        {podeAgir && (
                          <BotaoIcone
                            titulo="Cancelar PP"
                            onClick={() => setCancelando(pp)}
                            disabled={pending}
                          >
                            <XCircle className="h-3 w-3" />
                          </BotaoIcone>
                        )}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {enviadas.length > 0 && (
            <div className="flex flex-col gap-2.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                Já no financeiro
              </span>
              {enviadas.map((pp) => (
                <div
                  key={pp.id}
                  className="flex items-center gap-2.5 rounded-xl border border-border px-3.5 py-2.5"
                >
                  <span className="font-mono text-[11px] font-semibold text-muted-foreground">
                    {pp.codigo}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
                    {ppStatusLabel(pp.status)}
                    <span className="text-muted-foreground/70">
                      {" "}
                      · {pp.fornecedorNome}
                    </span>
                  </span>
                  <span className="font-mono text-[13px] font-bold">
                    {formatCurrency(pp.valor, moeda)}
                  </span>
                  <BotaoIcone
                    titulo="Ver PP"
                    onClick={() => verPdf(pp.id)}
                    disabled={pending}
                  >
                    <Eye className="h-3 w-3" />
                  </BotaoIcone>
                </div>
              ))}
            </div>
          )}

          {/* "Tem certeza?" acima do planejado — só quem pode enviar chega
              aqui. Cobre o corpo do painel, como no design. */}
          {confirmando && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#282828]/30 p-5">
              <div className="flex w-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-elevated">
                <div className="flex flex-col gap-2.5 px-[18px] pb-3.5 pt-[18px]">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-california-red" />
                    <h3 className="text-[15px] font-bold tracking-tight">
                      Enviar PP acima do planejado?
                    </h3>
                  </div>
                  <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                    Com {confirmando.pp.codigo} o item passa a ter{" "}
                    {formatCurrency(confirmando.numeros.emPPsDepois, moeda)} em
                    PPs, {formatCurrency(confirmando.numeros.excedente, moeda)}{" "}
                    acima do planejado de{" "}
                    {formatCurrency(confirmando.numeros.planejado, moeda)}. O
                    envio ao financeiro é registrado no seu nome.
                  </p>
                  <div className="flex flex-col gap-1.5 rounded-[11px] border border-border bg-muted/40 px-3 py-2.5">
                    <div className="flex items-baseline justify-between gap-2.5">
                      <span className="text-[11.5px] text-muted-foreground">
                        Esta PP
                      </span>
                      <span className="font-mono text-[12.5px] font-bold">
                        {formatCurrency(confirmando.pp.valor, moeda)}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2.5">
                      <span className="text-[11.5px] text-muted-foreground">
                        Em PPs depois do envio
                      </span>
                      <span className="font-mono text-[12.5px] font-bold text-california-red">
                        {formatCurrency(confirmando.numeros.emPPsDepois, moeda)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/30 px-[18px] py-3">
                  <button
                    type="button"
                    onClick={() => setConfirmando(null)}
                    disabled={pending}
                    className="rounded-[10px] border border-border bg-card px-3.5 py-2 text-[12.5px] font-semibold hover:bg-muted disabled:opacity-50"
                  >
                    Voltar
                  </button>
                  <button
                    type="button"
                    onClick={() => enviar(confirmando.pp, true)}
                    disabled={pending}
                    className="rounded-[10px] bg-california-red px-[15px] py-2 text-[12.5px] font-bold text-white hover:bg-california-red-hover disabled:opacity-50"
                  >
                    {pending ? "Enviando…" : "Sim, enviar"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {onNovaPP && (
          <div className="border-t border-border bg-muted/30 px-6 py-4">
            <button
              type="button"
              onClick={onNovaPP}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2.5 text-[13px] font-semibold transition-colors hover:bg-muted"
            >
              <FilePlus className="h-3.5 w-3.5 text-california-red" />
              Nova PP para este item
            </button>
          </div>
        )}

        <ConfirmDialog
          open={cancelando !== null}
          onOpenChange={(o) => !o && setCancelando(null)}
          title="Cancelar Pedido de Produção?"
          description={
            <>
              <strong className="text-foreground">{cancelando?.codigo}</strong>{" "}
              será cancelada. O PDF e os anexos ficam guardados no histórico.
            </>
          }
          confirmLabel="Cancelar PP"
          cancelLabel="Voltar"
          variant="destructive"
          pending={pending}
          onConfirm={cancelar}
        />
      </DrawerContent>
    </Dialog>
  );
}

function BotaoIcone({
  titulo,
  onClick,
  disabled,
  children,
}: {
  titulo: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[9px] border border-border bg-card text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function FichaNumero({
  rotulo,
  valor,
  corValor,
  className,
}: {
  rotulo: string;
  valor: string;
  corValor?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1 px-4 py-3.5", className)}>
      <span className="text-[9.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
        {rotulo}
      </span>
      <span className={cn("font-mono text-[15px] font-bold", corValor)}>
        {valor}
      </span>
    </div>
  );
}
