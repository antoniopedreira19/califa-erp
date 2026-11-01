"use client";

/**
 * O mútuo na aba Conciliação automática (decisão 230): a célula da linha
 * reconhecida, o "Lançar avulso" com a escolha e os dois pop-ups abertos pela
 * linha do banco.
 */

import * as React from "react";
import { AlertCircle, ChevronDown, CircleSlash, Handshake, Link2, Loader2, Plus, Receipt } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn, formatCurrency } from "@/lib/utils";
import { ehParteDeFora, nomeDaParte, parteDoLado, saldosDosPares, type DadosDoMutuo, type MutuoDaLinha } from "@/lib/financeiro/mutuo";
import { carregarDadosDoMutuo, lancarIofDoMutuo } from "../mutuos/actions";
import { MutuoFormComDados } from "../mutuos/mutuo-form";
import type { ResultadoDaLinha } from "./motor-da-conta";

const diaBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const diaMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function SituacaoDoMutuo({ m }: { m: MutuoDaLinha }) {
  return (
    <span className="whitespace-nowrap text-xs font-semibold text-sky-700">
      {m.par ? "Mútuo encontrado" : m.parte.deFora ? "Empresa de fora" : "CNPJ do grupo"}
    </span>
  );
}

export function CelulaDoMutuo({ r, m }: { r: ResultadoDaLinha; m: MutuoDaLinha }) {
  const saiuDaqui = r.mov.valor < 0;
  return (
    <div className="min-w-0">
      <p className="truncate text-xs font-semibold">{m.devolucao ? `Devolução de mútuo · ${m.parte.nome}` : `Mútuo com a ${m.parte.nome}`}</p>
      <p className="truncate text-[11px] text-muted-foreground">
        {m.par
          ? `${m.par.contaNome} · ${saiuDaqui ? "entrou" : "saiu"} o mesmo valor em ${diaMes(m.par.data)}`
          : m.parte.deFora
            ? `CNPJ da ${m.parte.nome} no PIX · só a nossa perna entra`
            : `CNPJ da ${m.parte.nome} no PIX · o extrato dela ainda não chegou`}
      </p>
    </div>
  );
}

/** O "Lançar avulso" da linha sem correspondência, agora com a escolha. */
export function BotaoLancar({
  r,
  classe,
  off,
  onAvulso,
  onMutuo,
  onIof,
}: {
  r: ResultadoDaLinha;
  classe: string;
  off: boolean;
  onAvulso: () => void;
  onMutuo: () => void;
  onIof: () => void;
}) {
  const [aberto, setAberto] = React.useState(false);
  const itens: Array<[string, string, typeof Plus, () => void, string?]> = [
    ["Avulso", "O formulário de sempre", Receipt, onAvulso],
    ["Mútuo entre empresas", "Empréstimo a outra empresa", Handshake, onMutuo, "text-sky-700"],
    ...(r.mov.valor < 0 ? ([["IOF do mútuo", "Lança e concilia esta linha", CircleSlash, onIof]] as Array<[string, string, typeof Plus, () => void]>) : []),
  ];
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button type="button" disabled={off} className={classe}>
          <Plus className="h-3 w-3" />
          Lançar avulso
          <ChevronDown className={cn("h-3 w-3 transition-transform", aberto && "rotate-180")} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[280px] p-1.5">
        {itens.map(([rotulo, ajuda, Icone, acao, cor]) => (
          <button
            key={rotulo}
            type="button"
            onClick={() => {
              setAberto(false);
              acao();
            }}
            className="flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted"
          >
            <Icone className={cn("mt-0.5 h-4 w-4 shrink-0", cor ?? "text-muted-foreground")} />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{rotulo}</span>
              <span className="block text-[11px] leading-snug text-muted-foreground">{ajuda}</span>
            </span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export function DialogoDoMutuoNaLinha({
  r,
  m,
  conta,
  onFechar,
  onFeito,
}: {
  r: ResultadoDaLinha;
  m: MutuoDaLinha | null;
  conta: { id: string; nome: string };
  onFechar: () => void;
  onFeito: (mensagem: string) => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-[780px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Handshake className="h-5 w-5 text-california-red" />
            Lançar mútuo
          </DialogTitle>
          <DialogDescription>Pela linha do banco: a data e o valor vêm dela.</DialogDescription>
        </DialogHeader>
        <MutuoFormComDados
          alvo={{
            modo: "linha",
            linha: { id: r.mov.id, contaId: conta.id, contaNome: conta.nome, data: r.mov.data, valor: r.mov.valor },
            par: m?.par ?? null,
            parte: m?.parte.chave ?? null,
          }}
          onFechar={onFechar}
          onFeito={onFeito}
        />
      </DialogContent>
    </Dialog>
  );
}

/** "Referente a" pode ficar vazio: o IOF entra sem somar em nenhum mútuo. */
const SEM_MUTUO = "vazio";

export function DialogoDoIof({
  r,
  conta,
  onFechar,
  onFeito,
}: {
  r: ResultadoDaLinha;
  conta: { id: string; nome: string };
  onFechar: () => void;
  onFeito: (mensagem: string) => void;
}) {
  const [dados, setDados] = React.useState<DadosDoMutuo | null>(null);
  const [ref, setRef] = React.useState(SEM_MUTUO);
  const [erro, setErro] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    let vivo = true;
    carregarDadosDoMutuo().then((res) => {
      if (!vivo) return;
      if (res.ok) setDados(res.dados);
      else setErro(res.message);
    });
    return () => {
      vivo = false;
    };
  }, []);

  const aqui = dados ? parteDoLado(dados, conta.id, null) : "";
  const outras = dados
    ? saldosDosPares(dados)
        .filter((p) => p.a === aqui || p.b === aqui)
        .map((p) => (p.a === aqui ? p.b : p.a))
    : [];
  const eCalifornia = dados ? nomeDaParte(dados, aqui) === "California" : false;
  const centro = eCalifornia ? "12 · Empréstimos · Mútuo interno" : "03 · Custo Tributário · IOF do mútuo";
  const efeito = eCalifornia ? "Abaixo do lucro, como a planilha faz na California." : "Entra no resultado, como a planilha faz na GoCrazy.";

  function lancar() {
    setErro(null);
    startTransition(async () => {
      const res = await lancarIofDoMutuo({
        linha_id: r.mov.id,
        com_empresa_contabil_id: ref !== SEM_MUTUO && !ehParteDeFora(ref) ? ref.slice(3) : null,
        com_fornecedor_id: ref !== SEM_MUTUO && ehParteDeFora(ref) ? ref.slice(2) : null,
      });
      if (!res.ok) return setErro(res.message);
      onFeito(`IOF de ${formatCurrency(Math.abs(r.mov.valor), "BRL")} lançado e conciliado.`);
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Handshake className="h-5 w-5 text-california-red" />
            IOF do mútuo
          </DialogTitle>
          <DialogDescription>
            {conta.nome} · {diaBr(r.mov.data)} · {formatCurrency(Math.abs(r.mov.valor), "BRL")}
          </DialogDescription>
        </DialogHeader>
        {!dados && !erro ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando…
          </div>
        ) : (
          <>
            <div className="overflow-hidden rounded-xl border border-border text-[12.5px]">
              {[
                ["Centro de custo", centro],
                ["No resultado", efeito],
              ].map(([rotulo, valor], i) => (
                <div key={rotulo} className={cn("flex items-center justify-between gap-4 px-4 py-2.5", i > 0 && "border-t border-border")}>
                  <span className="text-muted-foreground">{rotulo}</span>
                  <span className="text-right font-medium">{valor}</span>
                </div>
              ))}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold">Referente a (opcional)</label>
              <Select value={ref} onValueChange={setRef}>
                <SelectTrigger aria-label="Referente a">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM_MUTUO}>Deixar vazio</SelectItem>
                  {dados &&
                    outras.map((c) => (
                      <SelectItem key={c} value={c}>
                        Mútuo com a {nomeDaParte(dados, c)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">O banco não diz de qual mútuo é. Vazio, o IOF é lançado, mas não soma em nenhum mútuo.</p>
            </div>
          </>
        )}
        {erro && (
          <div className="flex items-start gap-2 rounded-lg border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red" role="alert">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{erro}</span>
          </div>
        )}
        <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
          <button type="button" onClick={onFechar} className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted">
            Cancelar
          </button>
          <button
            type="button"
            disabled={pending || !dados}
            onClick={lancar}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
          >
            <Link2 className="h-4 w-4" />
            Lançar e conciliar
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
