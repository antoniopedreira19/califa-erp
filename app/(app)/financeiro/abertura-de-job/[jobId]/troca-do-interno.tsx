"use client";

/**
 * A troca do job para dentro ou para fora do Interno no "Editar registro"
 * (decisão 240, revê a 105 §3-a). Escolher no campo Serviço um serviço do
 * outro lado do Interno abre o pop-up: uma frase, o quadro "Hoje → Ao
 * salvar" e uma explicação curta (desenho aprovado no protótipo de
 * 05/11/2026). Com "Sim, trocar", o formulário passa a mostrar os números
 * de depois da troca; só o "Salvar alterações" grava.
 */
import * as React from "react";
import { AlertTriangle, ArrowRight, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn, formatCurrency } from "@/lib/utils";
import type { ServicoOption } from "@/lib/data/servicos";
import type { PreviaDaTrocaDoInterno } from "@/lib/data/troca-do-interno";
import { rotuloDosTipos, sentidoDaTroca } from "@/lib/calculos/troca-do-interno";
import { carregarTrocaDoInterno } from "../actions";

type Linhas = { rotulo: string; antes: string; depois: string }[];

function AntesDepois({ linhas }: { linhas: Linhas }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="bg-muted/50 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            <th className="px-3.5 py-2 text-left font-semibold">
              <span className="sr-only">Item</span>
            </th>
            <th className="px-2 py-2 text-right font-semibold">Hoje</th>
            <th className="w-5">
              <span className="sr-only">para</span>
            </th>
            <th className="px-3.5 py-2 text-right font-semibold">Ao salvar</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.rotulo} className="border-t border-border">
              <td className="px-3.5 py-2.5 text-muted-foreground">{l.rotulo}</td>
              <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums text-muted-foreground">
                {l.antes}
              </td>
              <td className="text-center text-muted-foreground/70">
                <ArrowRight className="inline h-3.5 w-3.5" />
              </td>
              <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-semibold tabular-nums">
                {l.depois}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Explica({ children }: { children: React.ReactNode }) {
  return <p className="text-[12.5px] leading-relaxed text-muted-foreground">{children}</p>;
}

interface Conteudo {
  titulo: string;
  frase: string;
  corpo: React.ReactNode;
  bloqueado: boolean;
}

function conteudoDa(p: PreviaDaTrocaDoInterno, nomeNovo: string): Conteudo {
  if (p.sentido === "entra" && p.bloqueios.length > 0) {
    return {
      titulo: "Não dá para passar este job para Interno",
      frase: "No Interno não há faturamento ao cliente nem save. Resolva antes:",
      corpo: (
        <ul className="space-y-1.5 text-[13px]">
          {p.bloqueios.map((b) => (
            <li key={b} className="flex gap-2">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-california-red/70" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      ),
      bloqueado: true,
    };
  }
  if (p.sentido === "entra") {
    return {
      titulo: "Passar o job para Interno?",
      frase:
        "No Interno, o custo é investimento da própria California e não há faturamento ao cliente. Ao salvar, o job e o orçamento passam a ser Interno.",
      corpo: (
        <>
          <AntesDepois
            linhas={[
              { rotulo: "Tipo de custo", antes: rotuloDosTipos(p.tiposHoje), depois: "Todos FI" },
              {
                rotulo: "Planejado",
                antes: formatCurrency(p.antes.planejado),
                depois: formatCurrency(p.depois.custoPlanejado),
              },
              {
                rotulo: "Faturamento",
                antes: formatCurrency(p.antes.faturamentoPrevisto),
                depois: formatCurrency(p.depois.faturamentoPrevisto),
              },
            ]}
          />
          <Explica>
            Todos os custos viram FI, com o planejado igual ao orçado. As previsões de recebimento e de
            impostos são canceladas, e o desembolso passa a seguir o orçado.
          </Explica>
          {p.linhasAD > 0 && (
            <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-800">
              <AlertTriangle className="mt-[2px] h-3.5 w-3.5 shrink-0" />
              <span>
                {p.linhasAD === 1
                  ? "A linha A ou D passa a ser paga pela California, por PP."
                  : `As ${p.linhasAD} linhas A e D passam a ser pagas pela California, por PP.`}
              </span>
            </p>
          )}
        </>
      ),
      bloqueado: false,
    };
  }
  return {
    titulo: "Tirar o job do Interno?",
    frase: `Fora do Interno, o job volta a faturar para o cliente. Ao salvar, o job e o orçamento passam para ${nomeNovo}.`,
    corpo: (
      <>
        <AntesDepois
          linhas={[
            { rotulo: "Tipo de custo", antes: "FI", depois: "Todos B" },
            {
              rotulo: "Faturamento",
              antes: formatCurrency(p.antes.faturamentoPrevisto),
              depois: formatCurrency(p.depois.faturamentoPrevisto),
            },
          ]}
        />
        <Explica>
          Os custos FI viram B, e o planejado fica como está. O recebimento e os impostos voltam a ser
          previstos: preencha as datas antes de salvar.
        </Explica>
      </>
    ),
    bloqueado: false,
  };
}

type Pendente =
  | { id: string; estado: "carregando" }
  | { id: string; estado: "erro"; message: string }
  | { id: string; estado: "pronto"; previa: PreviaDaTrocaDoInterno };

/**
 * `habilitada` só no "Editar registro" livre: na fila, na revisão de
 * errata, na aprovação de save e no "Editar planilha" a lista de serviços
 * continua do lado do orçamento, e escolher só troca o campo.
 */
export function useTrocaDoInterno({
  jobId,
  servicos,
  orcamentoEhInterno,
  servicoId,
  setServicoId,
  previa,
  setPrevia,
  habilitada,
}: {
  jobId: string;
  servicos: ServicoOption[];
  orcamentoEhInterno: boolean;
  servicoId: string;
  setServicoId: (id: string) => void;
  previa: PreviaDaTrocaDoInterno | null;
  setPrevia: (p: PreviaDaTrocaDoInterno | null) => void;
  habilitada: boolean;
}) {
  const [pendente, setPendente] = React.useState<Pendente | null>(null);
  const ehInterno = (id: string) => servicos.find((s) => s.id === id)?.investimento_interno === true;

  function aoEscolher(id: string) {
    const sentido = habilitada ? sentidoDaTroca(orcamentoEhInterno, ehInterno(id)) : null;
    if (sentido === null) {
      setServicoId(id);
      setPrevia(null);
      return;
    }
    if (previa?.sentido === sentido) {
      setServicoId(id);
      return;
    }
    setPendente({ id, estado: "carregando" });
    carregarTrocaDoInterno(jobId, id).then(
      (res) => {
        setPendente((atual) => {
          if (!atual || atual.id !== id) return atual;
          if (!res.ok) return { id, estado: "erro", message: res.message };
          if (!res.previa) return { id, estado: "erro", message: "Este serviço não troca o job de lado do Interno." };
          return { id, estado: "pronto", previa: res.previa };
        });
      },
      () => setPendente((atual) => (atual?.id === id ? { id, estado: "erro", message: "Não foi possível calcular a troca. Tente de novo." } : atual)),
    );
  }

  const nomeNovo = servicos.find((s) => s.id === pendente?.id)?.nome ?? "";
  const c = pendente?.estado === "pronto" ? conteudoDa(pendente.previa, nomeNovo) : null;
  const fechar = () => setPendente(null);

  const dialogo = (
    <Dialog open={pendente !== null} onOpenChange={(aberto) => !aberto && fechar()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <div className="flex-1 space-y-1 pr-6">
            <DialogTitle>
              {c ? c.titulo : pendente?.estado === "erro" ? "Não foi possível trocar o serviço" : "Calculando a troca"}
            </DialogTitle>
            <DialogDescription>
              {c
                ? c.frase
                : pendente?.estado === "erro"
                  ? pendente.message
                  : "Lendo a planilha do job para mostrar o que muda."}
            </DialogDescription>
          </div>
        </DialogHeader>
        {pendente?.estado === "carregando" && (
          <div className="flex justify-center py-6 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
        {c && <div className="space-y-2.5">{c.corpo}</div>}
        <DialogFooter className="mt-2 gap-2 sm:gap-2">
          <button
            type="button"
            onClick={fechar}
            className={cn(
              "inline-flex items-center rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
              (c && !c.bloqueado) || pendente?.estado === "carregando"
                ? "border border-border bg-white text-foreground hover:bg-accent"
                : "bg-california-dark text-white shadow-sm hover:bg-california-dark-soft",
            )}
          >
            {(c && !c.bloqueado) || pendente?.estado === "carregando" ? "Cancelar" : "Entendi"}
          </button>
          {c && !c.bloqueado && (
            <button
              type="button"
              onClick={() => {
                if (pendente?.estado === "pronto") {
                  setServicoId(pendente.id);
                  setPrevia(pendente.previa);
                }
                fechar();
              }}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-california-dark px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-california-dark-soft"
            >
              Sim, trocar
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const sentidoNaTela = habilitada && servicoId ? sentidoDaTroca(orcamentoEhInterno, ehInterno(servicoId)) : null;
  const aviso =
    sentidoNaTela !== null && previa ? (
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] leading-relaxed text-amber-800">
        <AlertTriangle className="mt-[2px] h-3.5 w-3.5 shrink-0" />
        <span>
          {previa.sentido === "entra"
            ? "Ao salvar, o job e o orçamento passam a ser Interno: custos em FI, planejado igual ao orçado, sem faturamento."
            : "Ao salvar, o job e o orçamento saem do Interno: os custos FI viram B."}
        </span>
      </div>
    ) : null;

  return { aoEscolher, dialogo, aviso };
}
