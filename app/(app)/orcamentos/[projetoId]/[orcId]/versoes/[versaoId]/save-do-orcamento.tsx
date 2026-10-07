"use client";

/** O save do ORÇAMENTO INTEIRO (decisão 154).
 *
 *  O botão "Save" da barra da planilha, ao lado do "Exibir", tomou o lugar
 *  da chave "Orçamento de save" (que só marcava a linha nova — decisão 028
 *  §10). Ele dedica a versão inteira a uma de duas coisas, que se excluem:
 *
 *    • gerar save — todas as linhas viram save, e a linha nova já nasce em
 *      save;
 *    • consumir o saldo de UM job — todas as linhas são pagas pelo saldo
 *      dele, e o valor que passaria do saldo não grava.
 *
 *  E "Retirar todos os saves" desfaz tudo num clique. O rótulo do botão diz
 *  o modo ligado, e a faixa sobre a planilha mostra os números — no
 *  consumo, o saldo do job, o que este orçamento usa e o que resta.
 *
 *  As travas moram no banco (`versao_save_*_tudo` e os gatilhos da linha);
 *  a tela confere antes só para mostrar o motivo sem ida ao servidor, e
 *  mostra a recusa do banco quando ela vem.
 *
 *  Desenho aprovado pelo Tiago no protótipo de 07/10/2026 (opção 1, artifact
 *  `2fyxzYA64SdGuLcRVDiS8b`).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  Loader2,
  PiggyBank,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn, formatCurrency } from "@/lib/utils";
import type { SaldoDeSave } from "@/lib/data/saves";
import type { EstadoSaveDaLinha } from "@/app/(app)/_planilha/save-coluna";
import {
  consumirSaldoNoOrcamentoInteiro,
  gerarSaveNoOrcamentoInteiro,
  retirarTodosOsSaves,
} from "./save-actions";

export type ModoDoSave =
  | { tipo: "nenhum" }
  | { tipo: "gera" }
  | { tipo: "consome"; jobId: string };

/** O modo, lido das duas colunas da versão. */
export function modoDoSave(
  savePorPadrao: boolean,
  saveConsumoJobId: string | null,
): ModoDoSave {
  if (saveConsumoJobId) return { tipo: "consome", jobId: saveConsumoJobId };
  if (savePorPadrao) return { tipo: "gera" };
  return { tipo: "nenhum" };
}

/** Uma linha que impede ligar um modo, com o motivo já escrito. */
interface LinhaEmConflito {
  id: string;
  rotulo: string;
  motivo: string;
}

/** Tudo o que o menu e a faixa precisam saber da versão INTEIRA. No modelo
 *  mensal a planilha de cada mês monta isto com as linhas de todos os
 *  meses: o modo vale para a versão, não para o mês. */
export interface ResumoDoSave {
  versaoId: string;
  modo: ModoDoSave;
  moeda: string;
  /** Saldos aprovados do cliente (`vw_saves_por_job`). */
  saldos: SaldoDeSave[];
  /** Código do job do modo consome, para quando ele já não está na lista
   *  de saldos (job cancelado depois). */
  codigoDoModo: string | null;
  qtdLinhas: number;
  /** Soma do orçado de todas as linhas — o que o consumo precisa cobrir. */
  totalOrcado: number;
  faturamentoPrevisto: number;
  /** Linhas que geram save hoje. */
  linhasQueGeram: { id: string; rotulo: string; valor: number }[];
  /** Linhas que consomem hoje, e de quais jobs. */
  linhasQueConsomem: {
    id: string;
    rotulo: string;
    origens: { jobId: string; codigo: string; valor: number }[];
  }[];
}

/** Monta o resumo a partir das linhas e do estado de save de cada uma. */
export function resumoDoSave(args: {
  versaoId: string;
  modo: ModoDoSave;
  moeda: string;
  saldos: SaldoDeSave[];
  itens: {
    id: string;
    item: string;
    grupo_id: string;
    total_orcado: number;
  }[];
  nomeDoGrupo: Record<string, string>;
  savePorItem: Record<string, EstadoSaveDaLinha>;
  faturamentoPrevisto: number;
}): ResumoDoSave {
  const { itens, savePorItem, nomeDoGrupo } = args;
  const rotulo = (i: { item: string; grupo_id: string }) =>
    `${nomeDoGrupo[i.grupo_id] ?? "—"} · ${i.item}`;
  const linhasQueGeram = itens
    .filter((i) => savePorItem[i.id]?.emSave)
    .map((i) => ({ id: i.id, rotulo: rotulo(i), valor: Number(i.total_orcado ?? 0) }));
  const linhasQueConsomem = itens
    .filter((i) => (savePorItem[i.id]?.origens.length ?? 0) > 0)
    .map((i) => ({
      id: i.id,
      rotulo: rotulo(i),
      origens: savePorItem[i.id].origens.map((o) => ({
        jobId: o.jobId,
        codigo: o.codigo,
        valor: o.valor,
      })),
    }));
  const jobDoModo = args.modo.tipo === "consome" ? args.modo.jobId : null;
  const codigoDoModo = jobDoModo
    ? (args.saldos.find((s) => s.jobId === jobDoModo)?.codigo ??
      linhasQueConsomem
        .flatMap((l) => l.origens)
        .find((o) => o.jobId === jobDoModo)?.codigo ??
      null)
    : null;
  return {
    versaoId: args.versaoId,
    modo: args.modo,
    moeda: args.moeda,
    saldos: args.saldos,
    codigoDoModo,
    qtdLinhas: itens.length,
    totalOrcado: itens.reduce((s, i) => s + Number(i.total_orcado ?? 0), 0),
    faturamentoPrevisto: args.faturamentoPrevisto,
    linhasQueGeram,
    linhasQueConsomem,
  };
}

function saldoDoModo(r: ResumoDoSave): SaldoDeSave | null {
  return r.modo.tipo === "consome"
    ? (r.saldos.find((s) => s.jobId === (r.modo as { jobId: string }).jobId) ?? null)
    : null;
}

function brl(r: ResumoDoSave, v: number) {
  return formatCurrency(v, r.moeda);
}

/** As linhas que impedem gerar save: as que consomem. */
function conflitosParaGerar(r: ResumoDoSave): LinhaEmConflito[] {
  return r.linhasQueConsomem.map((l) => ({
    id: l.id,
    rotulo: l.rotulo,
    motivo: `paga ${brl(r, l.origens.reduce((s, o) => s + o.valor, 0))} com o saldo do ${l.origens
      .map((o) => o.codigo)
      .join(" + ")}`,
  }));
}

/** As linhas que impedem consumir: as que geram save e, escolhido o job,
 *  as que consomem de OUTRO (a do mesmo job é absorvida, e a do job que o
 *  orçamento já consumia é trocada). */
function conflitosParaConsumir(r: ResumoDoSave, jobId: string | null): LinhaEmConflito[] {
  const atual = r.modo.tipo === "consome" ? r.modo.jobId : null;
  const geram = r.linhasQueGeram.map((l) => ({
    id: l.id,
    rotulo: l.rotulo,
    motivo: `gera save de ${brl(r, l.valor)}`,
  }));
  if (!jobId) return geram;
  const deOutros = r.linhasQueConsomem.flatMap((l) => {
    const outras = l.origens.filter((o) => o.jobId !== jobId && o.jobId !== atual);
    if (outras.length === 0) return [];
    return [
      {
        id: l.id,
        rotulo: l.rotulo,
        motivo: `paga ${brl(r, outras.reduce((s, o) => s + o.valor, 0))} com o saldo do ${outras
          .map((o) => o.codigo)
          .join(" + ")}`,
      },
    ];
  });
  return [...geram, ...deOutros];
}

function temAlgumSave(r: ResumoDoSave) {
  return (
    r.modo.tipo !== "nenhum" ||
    r.linhasQueGeram.length > 0 ||
    r.linhasQueConsomem.length > 0
  );
}

function textoDoRetirar(r: ResumoDoSave): string {
  if (r.modo.tipo === "gera") {
    return `As ${r.qtdLinhas} linhas deixam de gerar save e voltam ao valor do job, com o planejado que tinham antes. O orçamento deixa de ser um orçamento de save.`;
  }
  if (r.modo.tipo === "consome") {
    return `As ${r.qtdLinhas} linhas deixam de consumir o saldo do ${r.codigoDoModo ?? "job"}: os ${brl(r, r.totalOrcado)} voltam ao saldo do job, e o orçamento volta a ser faturado inteiro.`;
  }
  const gera = r.linhasQueGeram.length;
  const consome = r.linhasQueConsomem.length;
  const consumido = r.linhasQueConsomem
    .flatMap((l) => l.origens)
    .reduce((s, o) => s + o.valor, 0);
  const partes: string[] = [];
  if (gera) partes.push(`${gera} ${gera === 1 ? "linha deixa" : "linhas deixam"} de gerar save`);
  if (consome)
    partes.push(
      `${consome} ${consome === 1 ? "linha deixa" : "linhas deixam"} de consumir ${brl(r, consumido)} de saldo`,
    );
  return `${partes.join(" e ")}. As linhas voltam ao normal.`;
}

// ---------------------------------------------------------------------------
// O botão e o menu — mesmo desenho do "Exibir"
// ---------------------------------------------------------------------------

type Dialogo =
  | null
  | { tipo: "confirmarGera" }
  | { tipo: "bloqueio"; acao: "gera" | "consome"; linhas: LinhaEmConflito[] }
  | { tipo: "escolherJob" }
  | { tipo: "confirmarRetirar" };

export function MenuSaveDoOrcamento({
  resumo,
  onMudou,
}: {
  resumo: ResumoDoSave;
  /** Depois de LIGAR um modo: a planilha abre a coluna Save. */
  onMudou?: () => void;
}) {
  const router = useRouter();
  const [aberto, setAberto] = React.useState(false);
  const [dialogo, setDialogo] = React.useState<Dialogo>(null);
  const caixa = React.useRef<HTMLDivElement>(null);
  const r = resumo;
  const ligado = r.modo.tipo !== "nenhum";
  const saldo = saldoDoModo(r);

  // Clique fora e Esc fecham: o menu é flutuante e não tem overlay.
  React.useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  function pedirGera() {
    if (r.modo.tipo === "gera") return;
    if (r.modo.tipo === "consome") {
      setDialogo({ tipo: "bloqueio", acao: "gera", linhas: [] });
      return;
    }
    const linhas = conflitosParaGerar(r);
    if (linhas.length > 0) {
      setDialogo({ tipo: "bloqueio", acao: "gera", linhas });
      return;
    }
    setDialogo({ tipo: "confirmarGera" });
  }

  function pedirConsumo() {
    if (r.modo.tipo === "gera") {
      setDialogo({ tipo: "bloqueio", acao: "consome", linhas: [] });
      return;
    }
    // A linha que gera save trava com qualquer job, e isso já se sabe
    // antes de escolher. A que consome de outro job só se sabe depois.
    const linhas = conflitosParaConsumir(r, null);
    if (linhas.length > 0) {
      setDialogo({ tipo: "bloqueio", acao: "consome", linhas });
      return;
    }
    setDialogo({ tipo: "escolherJob" });
  }

  function aposGravar(ligou: boolean) {
    setDialogo(null);
    if (ligou) onMudou?.();
    router.refresh();
  }

  const item = (
    icone: React.ReactNode,
    titulo: string,
    sub: string,
    onClick: () => void,
    marcado = false,
    perigo = false,
  ) => (
    <button
      type="button"
      onClick={() => {
        setAberto(false);
        onClick();
      }}
      className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left hover:bg-muted"
    >
      <span
        className={cn(
          "mt-px flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[5px]",
          perigo
            ? "text-california-red"
            : marcado
              ? "bg-[#5f5d57] text-white"
              : "border border-[#d7d5cf] bg-card text-[#5f5d57]",
        )}
      >
        {icone}
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            "flex items-center gap-1.5 text-[12.5px] font-semibold",
            perigo ? "text-california-red" : "text-foreground",
          )}
        >
          {titulo}
          {marcado && <Check className="h-3.5 w-3.5 text-[#5f5d57]" />}
        </span>
        <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
          {sub}
        </span>
      </span>
    </button>
  );

  return (
    <>
      <div className="relative" ref={caixa}>
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
            ligado
              ? "border-[#5f5d57] bg-[#5f5d57] text-white hover:bg-[#4d4b46]"
              : "border-border bg-card text-foreground hover:bg-muted",
          )}
        >
          {r.modo.tipo === "gera" ? (
            <ArrowUpRight className="h-3.5 w-3.5" />
          ) : r.modo.tipo === "consome" ? (
            <ArrowDownLeft className="h-3.5 w-3.5" />
          ) : (
            <PiggyBank className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          {r.modo.tipo === "gera"
            ? "Orçamento de save"
            : r.modo.tipo === "consome"
              ? `Consumindo ${r.codigoDoModo ?? "saldo"}`
              : "Save"}
          <ChevronDown
            className={cn("h-3.5 w-3.5", ligado ? "text-white/70" : "text-muted-foreground")}
          />
        </button>

        {aberto && (
          <div className="absolute right-0 top-full z-30 mt-2 w-[318px] overflow-hidden rounded-xl border border-[#d7d5cf] bg-card text-left shadow-[0_14px_30px_-12px_rgba(0,0,0,.28)]">
            <p className="border-b border-border px-3 pb-1.5 pt-2.5 text-[9.5px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
              Save do orçamento inteiro
            </p>
            <div className="p-1.5">
              {item(
                <ArrowUpRight className="h-3 w-3" />,
                "Gerar save em todas as linhas",
                r.modo.tipo === "gera"
                  ? `Ligado: as ${r.qtdLinhas} linhas geram save, e linha nova já nasce em save.`
                  : "Todas as linhas viram save, e linha nova já nasce em save.",
                pedirGera,
                r.modo.tipo === "gera",
              )}
              {item(
                <ArrowDownLeft className="h-3 w-3" />,
                r.modo.tipo === "consome"
                  ? "Trocar o job do saldo…"
                  : "Consumir o saldo de um job…",
                r.modo.tipo === "consome"
                  ? saldo
                    ? `Hoje: ${saldo.codigo}, restam ${brl(r, saldo.disponivel - r.totalOrcado)}.`
                    : `Hoje: ${r.codigoDoModo ?? "—"}.`
                  : "Todas as linhas passam a ser pagas pelo saldo de um job do cliente.",
                pedirConsumo,
                r.modo.tipo === "consome",
              )}
            </div>
            {temAlgumSave(r) && (
              <div className="border-t border-border p-1.5">
                {item(
                  <Trash2 className="h-3.5 w-3.5" />,
                  "Retirar todos os saves",
                  "Desfaz o save de todas as linhas e desliga o modo.",
                  () => setDialogo({ tipo: "confirmarRetirar" }),
                  false,
                  true,
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <DialogoConfirmarGera
        aberto={dialogo?.tipo === "confirmarGera"}
        resumo={r}
        onFechar={() => setDialogo(null)}
        onGravou={() => aposGravar(true)}
      />
      <DialogoConfirmarRetirar
        aberto={dialogo?.tipo === "confirmarRetirar"}
        resumo={r}
        onFechar={() => setDialogo(null)}
        onGravou={() => aposGravar(false)}
      />
      <DialogoEscolherJob
        aberto={dialogo?.tipo === "escolherJob"}
        resumo={r}
        onFechar={() => setDialogo(null)}
        onGravou={() => aposGravar(true)}
      />
      <DialogoBloqueio
        dialogo={dialogo?.tipo === "bloqueio" ? dialogo : null}
        resumo={r}
        onFechar={() => setDialogo(null)}
        onRetirar={() => setDialogo({ tipo: "confirmarRetirar" })}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// A faixa sobre a planilha
// ---------------------------------------------------------------------------

export function FaixaSaveDoOrcamento({ resumo }: { resumo: ResumoDoSave }) {
  const r = resumo;
  if (r.modo.tipo === "gera") {
    return (
      <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-8 rounded-xl border border-[#d7d5cf] bg-card px-4 py-2.5">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 inline-flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[5px] bg-[#5f5d57] text-white">
            <ArrowUpRight className="h-3 w-3" />
          </span>
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            <strong className="text-foreground">Orçamento de save.</strong> As {r.qtdLinhas}{" "}
            linhas geram save: o cliente paga o faturamento inteiro, e o crédito fica no
            saldo dele depois que o financeiro aprovar. Linha nova já nasce em save.
          </p>
        </div>
        <Numero rotulo="Faturamento previsto" valor={brl(r, r.faturamentoPrevisto)} />
        <Numero rotulo="Crédito que vira saldo" valor={brl(r, r.totalOrcado)} forte />
      </div>
    );
  }
  if (r.modo.tipo === "consome") {
    const saldo = saldoDoModo(r);
    const restante = saldo ? saldo.disponivel - r.totalOrcado : null;
    return (
      <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-x-8 rounded-xl border border-[#d7d5cf] bg-card px-4 py-2.5">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 inline-flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[5px] bg-[#5f5d57] text-white">
            <ArrowDownLeft className="h-3 w-3" />
          </span>
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            <strong className="text-foreground">
              Consumindo o saldo do {r.codigoDoModo ?? "job"}
              {saldo ? ` · ${saldo.nome}` : ""}.
            </strong>{" "}
            As {r.qtdLinhas} linhas são pagas por esse saldo. O valor que passar do
            restante não é gravado.
          </p>
        </div>
        <Numero
          rotulo={`Saldo do ${r.codigoDoModo ?? "job"}`}
          valor={saldo ? brl(r, saldo.disponivel) : "—"}
        />
        <Numero rotulo="Este orçamento usa" valor={brl(r, r.totalOrcado)} />
        <Numero
          rotulo="Restante"
          valor={restante === null ? "—" : brl(r, restante)}
          forte
          alerta={restante !== null && restante <= 0.004}
        />
      </div>
    );
  }
  return null;
}

function Numero({
  rotulo,
  valor,
  forte,
  alerta,
}: {
  rotulo: string;
  valor: string;
  forte?: boolean;
  alerta?: boolean;
}) {
  return (
    <div className="text-right">
      <p className="text-[9.5px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
        {rotulo}
      </p>
      <p
        className={cn(
          "whitespace-nowrap font-mono text-[13.5px]",
          forte ? "font-bold" : "font-semibold",
          alerta ? "text-california-red" : "text-foreground",
        )}
      >
        {valor}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// O aviso da linha (com um modo ligado, o pop-up de save da linha não abre)
// ---------------------------------------------------------------------------

export function AvisoSaveDaLinha({
  resumo,
  aberto,
  onFechar,
}: {
  resumo: ResumoDoSave;
  aberto: boolean;
  onFechar: () => void;
}) {
  const r = resumo;
  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Save do orçamento inteiro</DialogTitle>
          <DialogDescription>
            {r.modo.tipo === "gera"
              ? "Este orçamento inteiro gera save: o save não se mexe linha a linha."
              : `Este orçamento inteiro consome o saldo do ${r.codigoDoModo ?? "job"}: cada linha consome o próprio orçado.`}{" "}
            Para mudar uma linha só, retire antes o save do orçamento, no menu Save.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onFechar}>Entendi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Pop-ups do menu
// ---------------------------------------------------------------------------

function Erro({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-california-red/30 bg-california-red/[0.05] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-california-red">
      {children}
    </div>
  );
}

function ListaDeConflitos({ linhas }: { linhas: LinhaEmConflito[] }) {
  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-muted px-3.5 py-3 text-[12.5px] leading-relaxed">
      {linhas.map((l) => (
        <div key={l.id}>
          <p className="font-medium text-foreground">{l.rotulo}</p>
          <p className="text-[12px] text-muted-foreground">{l.motivo}</p>
        </div>
      ))}
    </div>
  );
}

function DialogoConfirmarGera({
  aberto,
  resumo: r,
  onFechar,
  onGravou,
}: {
  aberto: boolean;
  resumo: ResumoDoSave;
  onFechar: () => void;
  onGravou: () => void;
}) {
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (aberto) setErro(null);
  }, [aberto]);

  return (
    <ConfirmDialog
      open={aberto}
      onOpenChange={(o) => !o && !pending && onFechar()}
      title="Transformar o orçamento em save?"
      description={
        <div className="space-y-2">
          <p>
            As {r.qtdLinhas} linhas passam a gerar save, e toda linha nova já nasce em save.
            O cliente continua pagando{" "}
            <strong className="font-mono text-foreground">{brl(r, r.faturamentoPrevisto)}</strong>{" "}
            de faturamento; o valor do job vai a{" "}
            <strong className="font-mono text-foreground">{brl(r, 0)}</strong>, e o crédito de{" "}
            <strong className="font-mono text-foreground">{brl(r, r.totalOrcado)}</strong> fica
            no saldo do cliente depois que o financeiro aprovar.
          </p>
          <p>O planejado das linhas zera e volta se você retirar o save.</p>
          {erro && <Erro>{erro}</Erro>}
        </div>
      }
      confirmLabel="Transformar em save"
      pending={pending}
      onConfirm={() =>
        startTransition(async () => {
          const res = await gerarSaveNoOrcamentoInteiro(r.versaoId);
          if (!res.ok) {
            setErro(res.message);
            return;
          }
          onGravou();
        })
      }
    />
  );
}

function DialogoConfirmarRetirar({
  aberto,
  resumo: r,
  onFechar,
  onGravou,
}: {
  aberto: boolean;
  resumo: ResumoDoSave;
  onFechar: () => void;
  onGravou: () => void;
}) {
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (aberto) setErro(null);
  }, [aberto]);

  return (
    <ConfirmDialog
      open={aberto}
      onOpenChange={(o) => !o && !pending && onFechar()}
      title="Retirar todos os saves?"
      description={
        <div className="space-y-2">
          <p>{textoDoRetirar(r)}</p>
          {erro && <Erro>{erro}</Erro>}
        </div>
      }
      confirmLabel="Retirar todos"
      variant="destructive"
      pending={pending}
      onConfirm={() =>
        startTransition(async () => {
          const res = await retirarTodosOsSaves(r.versaoId);
          if (!res.ok) {
            setErro(res.message);
            return;
          }
          onGravou();
        })
      }
    />
  );
}

function DialogoEscolherJob({
  aberto,
  resumo: r,
  onFechar,
  onGravou,
}: {
  aberto: boolean;
  resumo: ResumoDoSave;
  onFechar: () => void;
  onGravou: () => void;
}) {
  const [pending, startTransition] = React.useTransition();
  const [escolhido, setEscolhido] = React.useState<string | null>(null);
  const [erro, setErro] = React.useState<React.ReactNode>(null);

  React.useEffect(() => {
    if (!aberto) return;
    setEscolhido(r.modo.tipo === "consome" ? r.modo.jobId : null);
    setErro(null);
    // Só ao abrir: o modo não muda com o pop-up aberto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  function confirmar() {
    if (!escolhido) {
      setErro("Escolha o job de onde vem o saldo.");
      return;
    }
    const saldo = r.saldos.find((s) => s.jobId === escolhido);
    const outros = conflitosParaConsumir(r, escolhido);
    if (outros.length > 0) {
      setErro(
        <>
          <p className="mb-1.5 font-semibold">
            {outros.length === 1
              ? "Uma linha já tem save de outro tipo."
              : `${outros.length} linhas já têm save de outro tipo.`}{" "}
            Nada foi gravado.
          </p>
          <p>
            O orçamento inteiro consome de um job só. Retire antes:{" "}
            {outros.map((l) => `${l.rotulo} (${l.motivo})`).join("; ")}.
          </p>
        </>,
      );
      return;
    }
    if (saldo && r.totalOrcado > saldo.disponivel + 0.005) {
      setErro(
        <>
          O orçamento soma <strong className="font-mono">{brl(r, r.totalOrcado)}</strong> e o
          saldo disponível do {saldo.codigo} é de{" "}
          <strong className="font-mono">{brl(r, saldo.disponivel)}</strong>: faltam{" "}
          <strong className="font-mono">{brl(r, r.totalOrcado - saldo.disponivel)}</strong>. Nada
          foi gravado.
        </>,
      );
      return;
    }
    startTransition(async () => {
      const res = await consumirSaldoNoOrcamentoInteiro(r.versaoId, escolhido);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onGravou();
    });
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && !pending && onFechar()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {r.modo.tipo === "consome" ? "Trocar o job do saldo" : "Consumir o saldo de um job"}
          </DialogTitle>
          <DialogDescription>
            O orçamento inteiro passa a ser pago pelo saldo do job escolhido: as {r.qtdLinhas}{" "}
            linhas consomem o próprio orçado. O orçamento soma{" "}
            <strong className="font-mono text-foreground">{brl(r, r.totalOrcado)}</strong>.
          </DialogDescription>
        </DialogHeader>

        {r.saldos.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Este cliente ainda não tem saldo de save aprovado. O crédito nasce quando o
            financeiro aprova um save de outro job dele.
          </p>
        ) : (
          <>
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
              Saldos aprovados do cliente
            </p>
            <div className="flex flex-col gap-1.5">
              {r.saldos.map((saldo) => {
                const falta = r.totalOrcado - saldo.disponivel;
                const ativo = escolhido === saldo.jobId;
                return (
                  <button
                    key={saldo.jobId}
                    type="button"
                    onClick={() => {
                      setEscolhido(saldo.jobId);
                      setErro(null);
                    }}
                    className={cn(
                      "grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-x-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                      ativo ? "border-[#5f5d57] bg-muted/40" : "border-[#d7d5cf] hover:bg-muted/30",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded-full border",
                        ativo ? "border-[#5f5d57]" : "border-[#c9c6bf]",
                      )}
                    >
                      {ativo && <span className="h-2 w-2 rounded-full bg-[#5f5d57]" />}
                    </span>
                    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                      <span className="font-mono text-xs font-bold">{saldo.codigo}</span>
                      <span className="truncate text-[13px]">{saldo.nome}</span>
                      {falta > 0.004 && (
                        <span className="text-[11.5px] text-muted-foreground">
                          não cabe: faltam {brl(r, falta)}
                        </span>
                      )}
                    </span>
                    <span className="text-right">
                      <span className="block text-[9.5px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
                        Disponível
                      </span>
                      <span className="font-mono text-[13px] font-semibold">
                        {brl(r, saldo.disponivel)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {erro && <Erro>{erro}</Erro>}

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={pending || r.saldos.length === 0}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Consumir saldo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogoBloqueio({
  dialogo,
  resumo: r,
  onFechar,
  onRetirar,
}: {
  dialogo: { acao: "gera" | "consome"; linhas: LinhaEmConflito[] } | null;
  resumo: ResumoDoSave;
  onFechar: () => void;
  onRetirar: () => void;
}) {
  const d = dialogo;
  let texto = "";
  if (d?.acao === "gera" && r.modo.tipo === "consome") {
    texto = `Este orçamento inteiro consome o saldo do ${r.codigoDoModo ?? "job"}. Para transformá-lo em orçamento de save, retire antes todos os saves.`;
  } else if (d?.acao === "consome" && r.modo.tipo === "gera") {
    texto = "Este orçamento inteiro gera save. Para consumir o saldo de um job, retire antes todos os saves.";
  } else if (d) {
    texto =
      (d.acao === "gera"
        ? "No orçamento de save, todas as linhas geram save. "
        : "No orçamento que consome save, todas as linhas são pagas pelo saldo de um único job. ") +
      (d.linhas.length === 1
        ? "Esta linha já tem um save diferente e precisa ser retirada antes:"
        : `Estas ${d.linhas.length} linhas já têm um save diferente e precisam ser retiradas antes:`);
  }
  return (
    <Dialog open={d !== null} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {d?.acao === "gera"
              ? "Não dá para transformar o orçamento em save"
              : "Não dá para consumir o saldo de um job"}
          </DialogTitle>
          <DialogDescription>{texto}</DialogDescription>
        </DialogHeader>
        {d && d.linhas.length > 0 && <ListaDeConflitos linhas={d.linhas} />}
        <DialogFooter>
          <Button variant="outline" className="mr-auto" onClick={onRetirar}>
            <Trash2 className="h-3.5 w-3.5" />
            Retirar todos os saves
          </Button>
          <Button onClick={onFechar}>Entendi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
