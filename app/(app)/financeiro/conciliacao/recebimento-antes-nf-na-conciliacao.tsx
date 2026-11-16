"use client";

/**
 * Decisão 256: o "Recebimento antes da NF" do Novo lançamento da conciliação.
 *
 * O registro saiu da aba Faturamento de Contas a Receber e está aqui, onde o
 * dinheiro aparece. Primeiro se escolhe o job (ou o BV):
 * - job com envio do GP esperando nota: o recebimento vai para a nota do
 *   envio (como na decisão 130, inclusive com o câmbio da 229) e entra
 *   sozinho no Faturar do envio;
 * - job sem envio: fica preso ao job, e o Novo faturamento associa à nota;
 * - BV: pelo próprio BV.
 * Depois, o mesmo formulário de sempre (`RecebimentoAntesNfDialog`).
 */

import * as React from "react";
import { AlertCircle, HandCoins, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Combobox, COMBOBOX_COMO_SELECT } from "@/components/ui/combobox";
import type { ContaBancaria, PlanoContaSubtipo, PlanoContaTipo } from "@/lib/types";
import { RecebimentoAntesNfDialog } from "../contas-a-receber/recebimento-antes-nf-dialog";
import {
  carregarAlvosDoRecebimentoAntesNf,
  registrarRecebimentoAntesNf,
  registrarRecebimentoAntesNfDoJob,
  registrarRecebimentoCambio,
  type AlvoDaConciliacao,
} from "../contas-a-receber/actions-recebimento-antes-nf";

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function RecebimentoAntesNfNaConciliacao({
  aberto,
  onFechar,
  contas,
  tipos,
  subtipos,
  onRegistrado,
}: {
  aberto: boolean;
  onFechar: () => void;
  contas: ContaBancaria[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  /** O aviso do registro. */
  onRegistrado: (mensagem: string) => void;
}) {
  const [alvos, setAlvos] = React.useState<AlvoDaConciliacao[] | null>(null);
  const [erroCarga, setErroCarga] = React.useState<string | null>(null);
  const [escolhido, setEscolhido] = React.useState<string | null>(null);
  const [alvo, setAlvo] = React.useState<AlvoDaConciliacao | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  // Os alvos se leem a cada abertura: o que espera nota muda com o dia.
  React.useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    setAlvos(null);
    setErroCarga(null);
    setEscolhido(null);
    setAlvo(null);
    setErro(null);
    carregarAlvosDoRecebimentoAntesNf()
      .then((r) => {
        if (!vivo) return;
        if (r.ok) setAlvos(r.alvos);
        else setErroCarga(r.message);
      })
      .catch(() => vivo && setErroCarga("Não foi possível abrir os jobs. Tente de novo."));
    return () => {
      vivo = false;
    };
  }, [aberto]);

  const escolha = alvos?.find((a) => a.chave === escolhido) ?? null;

  return (
    <>
      <Dialog
        open={aberto && alvo === null}
        onOpenChange={(o) => {
          if (!o) onFechar();
        }}
      >
        <DialogContent
          className="sm:max-w-[600px]"
          // Ao passar para o formulário, a escolha fecha sem devolver o foco
          // ao "Novo lançamento": o foco fora do formulário o fecharia junto.
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HandCoins className="h-5 w-5 text-amber-700" />
              Recebimento antes da NF
            </DialogTitle>
          </DialogHeader>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            O cliente pagou antes de a nota sair. Escolha o job (ou o BV): com envio do GP esperando nota, o
            recebimento vai para a nota do envio; sem envio, fica preso ao job, e o Novo faturamento associa à nota.
          </p>
          <div className="space-y-1.5">
            <label className="text-sm font-semibold">
              Job ou BV <span className="text-california-red">*</span>
            </label>
            {alvos === null && !erroCarga ? (
              <div className="flex h-11 items-center gap-2 rounded-lg border border-border px-3 text-[13px] text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Lendo os jobs que esperam nota…
              </div>
            ) : (
              <Combobox
                items={(alvos ?? []).map((a) => ({
                  value: a.chave,
                  label: a.rotulo,
                  descricao: a.descricao,
                  busca: a.busca,
                }))}
                value={escolhido}
                onChange={(v) => setEscolhido(v ?? null)}
                placeholder="Selecione o job ou o BV"
                buscaPlaceholder="Escreva o código, o nome ou o cliente"
                className={COMBOBOX_COMO_SELECT}
              />
            )}
            {escolha && (
              <p className="text-[12px] text-muted-foreground">
                {escolha.jobId
                  ? `Sem envio: o recebimento fica preso ao job. Falta faturar ${formatMoney(escolha.saldo)}.`
                  : escolha.ehBv
                    ? `BV de ${escolha.contraparte}: ${formatMoney(escolha.saldo)} a faturar.`
                    : `Vai para a ${escolha.notaRotulo} do envio do GP, com saldo de ${formatMoney(escolha.saldo)}.`}
              </p>
            )}
          </div>
          {erroCarga && (
            <div className="flex items-start gap-2 rounded-lg border border-california-red/35 bg-california-red/[0.06] px-3 py-2.5 text-[12.5px] text-california-red">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{erroCarga}</span>
            </div>
          )}
          <div className="flex items-center justify-end gap-2.5 pt-1">
            <button
              type="button"
              onClick={onFechar}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={!escolha}
              onClick={() => {
                setErro(null);
                setAlvo(escolha);
              }}
              className="rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-california-red-hover disabled:opacity-50"
            >
              Continuar
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <RecebimentoAntesNfDialog
        alvo={alvo}
        onOpenChange={(o) => {
          if (!o && !pending) {
            setAlvo(null);
            onFechar();
          }
        }}
        contas={contas}
        tipos={tipos}
        subtipos={subtipos}
        pending={pending}
        erro={erro}
        onConfirm={(dados, cambio) => {
          const a = alvo;
          if (!a) return;
          setErro(null);
          startTransition(async () => {
            const res = a.jobId
              ? await registrarRecebimentoAntesNfDoJob({ job_id: a.jobId, ...dados })
              : cambio
                ? // O internacional registra o câmbio fechado (decisão 229).
                  await registrarRecebimentoCambio({ envio_nota_id: a.envioNotaId, ...dados, ...cambio })
                : await registrarRecebimentoAntesNf({ envio_nota_id: a.envioNotaId, item_bv_id: a.itemBvId, ...dados });
            if (!res.ok) {
              setErro(res.message);
              return;
            }
            setAlvo(null);
            onRegistrado(
              a.jobId
                ? `${formatMoney(dados.valor)} recebidos antes da NF em ${a.titulo}, presos ao job: o Novo faturamento associa à nota.`
                : `${formatMoney(dados.valor)} recebidos antes da NF em ${a.titulo}. Na emissão da nota, o valor entra como a parcela 1, já recebida.`,
            );
          });
        }}
      />
    </>
  );
}
