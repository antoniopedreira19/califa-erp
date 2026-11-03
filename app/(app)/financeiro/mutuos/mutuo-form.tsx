"use client";

/**
 * O formulário do mútuo (decisão 230): a mesma grade da transferência, com as
 * duas contas, data, valor, descrição e a prévia "Sai de / Entra em", mais a
 * linha de quem passa a dever a quem. Serve aos três caminhos: novo, pela linha
 * do banco e corrigir. A empresa de fora aparece no fim da lista de contas: só
 * a nossa perna existe.
 */

import * as React from "react";
import { format } from "date-fns";
import { AlertCircle, ArrowLeftRight, ArrowRight, Banknote, CalendarPlus, Info, Link2, Loader2, Save } from "lucide-react";
import { DatePicker } from "@/components/ui/date-picker";
import { MoedaInput } from "@/components/ui/moeda-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn, formatCurrency } from "@/lib/utils";
import {
  ehParteDeFora,
  nomeDaParte,
  parteDeFora,
  previstoDe,
  saldoDepois,
  trimestrePadrao,
  type DadosDoMutuo,
  type LinhaDeOutraConta,
  type MutuoDaLista,
} from "@/lib/financeiro/mutuo";
import { saldoDaContaNoDia } from "@/app/(app)/financeiro/contas-a-receber/actions-recebimento-avulso";
import { carregarDadosDoMutuo, corrigirMutuo, criarMutuo, lancarMutuoPelaLinha } from "./actions";

export interface InicialDoMutuo {
  origem?: string;
  destino?: string;
  valor?: number;
  data?: string;
  trimestre?: number;
  ano?: number;
}

export type AlvoDoForm =
  | { modo: "novo"; inicial?: InicialDoMutuo }
  | {
      modo: "linha";
      linha: { id: string; contaId: string; contaNome: string; data: string; valor: number };
      par: LinhaDeOutraConta | null;
      /** A parte do outro lado, se a linha a reconheceu. */
      parte: string | null;
    }
  | { modo: "corrigir"; mutuo: MutuoDaLista };

function Campo({ rotulo, obrigatorio, ajuda, children }: { rotulo: string; obrigatorio?: boolean; ajuda?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold">
        {rotulo}
        {obrigatorio && <span className="text-california-red"> *</span>}
      </label>
      {children}
      {ajuda && <p className="text-[11px] text-muted-foreground">{ajuda}</p>}
    </div>
  );
}

const INPUT =
  "flex h-11 w-full rounded-lg border border-border bg-white px-3.5 py-2 text-sm placeholder:text-muted-foreground/60 focus-visible:border-california-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-california-red/15";

const diaBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const diaMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Conta do grupo pelo id; empresa de fora pela parte (`f:<id>`). */
const parteDoValor = (d: DadosDoMutuo, valor: string) => (ehParteDeFora(valor) ? valor : d.contas.find((c) => c.id === valor)?.parte ?? "");
const nomeDoValor = (d: DadosDoMutuo, valor: string) =>
  ehParteDeFora(valor) ? nomeDaParte(d, valor) : d.contas.find((c) => c.id === valor)?.nome ?? "—";

function SeletorDeConta({
  dados,
  valor,
  onChange,
  desabilitada,
  travada,
  soDe,
  aria,
}: {
  dados: DadosDoMutuo;
  valor: string;
  onChange: (v: string) => void;
  desabilitada?: string;
  travada?: boolean;
  soDe?: string | null;
  aria: string;
}) {
  const contas = soDe ? dados.contas.filter((c) => c.parte === soDe) : dados.contas;
  const foras = dados.partes.filter((p) => p.deFora && (!soDe || p.chave === soDe));
  return (
    <>
      <Select value={valor} onValueChange={onChange} disabled={travada}>
        <SelectTrigger aria-label={aria}>
          <SelectValue placeholder="Selecione a conta..." />
        </SelectTrigger>
        <SelectContent>
          {contas.map((c) => (
            <SelectItem key={c.id} value={c.id} disabled={c.id === desabilitada}>
              {c.nome} · {c.banco}
            </SelectItem>
          ))}
          {foras.map((p) => (
            <SelectItem key={p.chave} value={p.chave} disabled={p.chave === desabilitada}>
              {p.nome} · empresa de fora
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="h-4 text-[11px] text-muted-foreground">
        {!valor ? "" : ehParteDeFora(valor) ? "Sem conta no sistema: cadastro em Fornecedores" : `CNPJ ${nomeDaParte(dados, parteDoValor(dados, valor))}`}
      </p>
    </>
  );
}

export function MutuoForm({
  dados,
  alvo,
  onFechar,
  onFeito,
  onTransferencia,
}: {
  dados: DadosDoMutuo;
  alvo: AlvoDoForm;
  onFechar: () => void;
  onFeito: (mensagem: string) => void;
  /** Mesmo CNPJ: leva as contas para o tipo Transferência, quando há o tipo. */
  onTransferencia?: (origemId: string, destinoId: string) => void;
}) {
  const inicial = React.useMemo<InicialDoMutuo & { descricao?: string | null; juros?: number | null }>(() => {
    if (alvo.modo === "novo") return alvo.inicial ?? {};
    if (alvo.modo === "corrigir") {
      const m = alvo.mutuo;
      const fora = m.fornecedorId ? parteDeFora(m.fornecedorId) : "";
      return {
        origem: m.origemId ?? fora,
        destino: m.destinoId ?? fora,
        valor: m.valor,
        data: m.data,
        descricao: m.descricao,
        juros: m.juros,
        trimestre: m.trimestre,
        ano: m.ano,
      };
    }
    const { linha, par, parte } = alvo;
    const contra = par?.contaId ?? (parte && ehParteDeFora(parte) ? parte : "");
    return linha.valor < 0
      ? { origem: linha.contaId, destino: contra, valor: -linha.valor, data: linha.data }
      : { origem: contra, destino: linha.contaId, valor: linha.valor, data: linha.data };
  }, [alvo]);

  const [origem, setOrigem] = React.useState(inicial.origem ?? "");
  const [destino, setDestino] = React.useState(inicial.destino ?? "");
  const [centavos, setCentavos] = React.useState(inicial.valor ? String(Math.round(inicial.valor * 100)) : "");
  const [data, setData] = React.useState(inicial.data ?? dados.hoje);
  const [descricao, setDescricao] = React.useState(inicial.descricao ?? "");
  const [juros, setJuros] = React.useState(inicial.juros != null ? String(inicial.juros).replace(".", ",") : "");
  const [motivo, setMotivo] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);
  // O Tipo inteiro: a volta de um mútuo de 2025 herda 3T 2025.
  const [tri, setTri] = React.useState<string | null>(inicial.trimestre ? `${inicial.trimestre}-${inicial.ano ?? dados.hoje.slice(0, 4)}` : null);
  const [saldoOrigem, setSaldoOrigem] = React.useState<number | null>(null);
  const [saldoDestino, setSaldoDestino] = React.useState<number | null>(null);
  const [pending, startTransition] = React.useTransition();

  const travaData = alvo.modo === "linha";
  const travaOrigem = alvo.modo === "linha" && alvo.linha.valor < 0;
  const travaDestino = alvo.modo === "linha" && alvo.linha.valor > 0;
  const valor = Number(centavos || "0") / 100;
  const parteOrigem = parteDoValor(dados, origem);
  const parteDestino = parteDoValor(dados, destino);
  const mesmoCnpj = !!parteOrigem && parteOrigem === parteDestino;
  const contasOk = !!origem && !!destino && origem !== destino && !mesmoCnpj;
  const umaPerna = ehParteDeFora(origem) || ehParteDeFora(destino);
  const asLinhas = umaPerna ? "a linha" : "as duas linhas";
  const corrigindo = alvo.modo === "corrigir" ? alvo.mutuo : null;
  const ligadas = corrigindo ? corrigindo.pernas.filter((p) => p.conciliada) : [];
  const mudaPerna =
    !!corrigindo &&
    (origem !== inicial.origem || destino !== inicial.destino || valor !== corrigindo.valor || data !== corrigindo.data);

  const soDeOrigem = alvo.modo === "linha" && alvo.parte && alvo.linha.valor > 0 ? alvo.parte : null;
  const soDeDestino = alvo.modo === "linha" && alvo.parte && alvo.linha.valor < 0 ? alvo.parte : null;

  const depois = contasOk && valor ? saldoDepois(dados, { origem: parteOrigem, destino: parteDestino, valor, ignorar: corrigindo?.id }) : null;

  // Os saldos das duas contas no dia: a prévia "saldo passa a" da transferência.
  React.useEffect(() => {
    let vivo = true;
    const buscar = (id: string, set: (v: number | null) => void) => {
      if (!id || ehParteDeFora(id) || !data) return set(null);
      saldoDaContaNoDia({ conta_bancaria_id: id, data }).then((res) => {
        if (vivo) set(res.ok ? res.saldo : null);
      });
    };
    buscar(origem, setSaldoOrigem);
    buscar(destino, setSaldoDestino);
    return () => {
      vivo = false;
    };
  }, [origem, destino, data]);

  function validar(): string | null {
    if (!origem || !destino) return "Escolha a conta de origem e a de destino.";
    if (origem === destino) return "A conta de destino precisa ser diferente da de origem.";
    if (mesmoCnpj) return "Mútuo só entre CNPJs diferentes. No mesmo CNPJ é transferência entre contas.";
    if (!valor) return "Informe o valor do mútuo.";
    if (!data) return "Informe a data.";
    if (juros.trim() && !(Number(juros.replace(",", ".")) > 0)) return "Informe juros maiores que zero, ou deixe vazio.";
    if (corrigindo && motivo.trim().length < 10) return "Explique o motivo da correção em pelo menos 10 caracteres.";
    return null;
  }

  const padrao = trimestrePadrao(dados, parteOrigem, parteDestino, data || dados.hoje);
  const tipoTri = tri ?? `${padrao.trimestre}-${padrao.ano}`;
  const [trimestre, ano] = tipoTri.split("-").map(Number);
  const anoAtual = dados.hoje.slice(0, 4);
  const opcoesDeTri = [...new Set([tipoTri, ...[1, 2, 3, 4].map((t) => `${t}-${anoAtual}`)])].sort(
    (x, y) => x.slice(2).localeCompare(y.slice(2)) || x.localeCompare(y),
  );

  const fornecedorDe = (v: string) => (ehParteDeFora(v) ? v.slice(2) : null);
  const dadosDoForm = () => ({
    conta_origem_id: ehParteDeFora(origem) ? null : origem,
    conta_destino_id: ehParteDeFora(destino) ? null : destino,
    fornecedor_id: fornecedorDe(origem) ?? fornecedorDe(destino),
    valor,
    data_prevista: data,
    descricao: descricao.trim() || null,
    trimestre,
    ano,
    juros_ao_mes: juros.trim() ? Number(juros.replace(",", ".")) : null,
  });

  // A linha do banco realiza a previsão, em vez de lançar outro mútuo.
  const previsto =
    alvo.modo === "linha" && contasOk
      ? previstoDe(dados, {
          origemId: ehParteDeFora(origem) ? null : origem,
          destinoId: ehParteDeFora(destino) ? null : destino,
          fornecedorId: fornecedorDe(origem) ?? fornecedorDe(destino),
          valor,
        })
      : undefined;

  function enviar(acao: () => Promise<{ ok: true; mensagem: string } | { ok: false; message: string }>) {
    const msg = validar();
    if (msg) return setErro(msg);
    setErro(null);
    startTransition(async () => {
      const res = await acao();
      if (!res.ok) return setErro(res.message);
      onFeito(res.mensagem);
    });
  }

  const criar = (transferir: boolean) =>
    enviar(async () => {
      const res = await criarMutuo({ ...dadosDoForm(), transferir });
      if (!res.ok) return res;
      return {
        ok: true as const,
        mensagem: transferir
          ? `Mútuo ${res.codigo} de ${formatCurrency(valor, "BRL")} registrado, com ${asLinhas} no extrato.`
          : `Mútuo ${res.codigo} de ${formatCurrency(valor, "BRL")} criado em Títulos a Receber, a transferir.`,
      };
    });

  const pelaLinha = () =>
    enviar(async () => {
      if (alvo.modo !== "linha") return { ok: false as const, message: "Linha não encontrada." };
      const res = await lancarMutuoPelaLinha({ dados: dadosDoForm(), linha_id: alvo.linha.id, par_id: alvo.par?.id ?? null });
      if (!res.ok) return res;
      const outra = nomeDoValor(dados, alvo.linha.valor < 0 ? destino : origem);
      return {
        ok: true as const,
        mensagem: res.previsto
          ? `${res.codigo} baixado e conciliado: a previsão virou esta linha do banco.`
          : umaPerna
            ? `Mútuo ${res.codigo} lançado e conciliado.`
            : alvo.par
              ? `Mútuo ${res.codigo} lançado e conciliado nas duas contas.`
              : `Mútuo ${res.codigo} lançado e conciliado aqui. A perna da ${outra} espera o extrato dela.`,
      };
    });

  const corrigir = () =>
    enviar(async () => {
      if (!corrigindo) return { ok: false as const, message: "Mútuo não encontrado." };
      const res = await corrigirMutuo({ id: corrigindo.id, dados: dadosDoForm(), motivo: motivo.trim() });
      if (!res.ok) return res;
      return {
        ok: true as const,
        mensagem: mudaPerna && ligadas.length ? `${corrigindo.codigo} corrigido: a conciliação das pernas foi desfeita.` : `${corrigindo.codigo} corrigido.`,
      };
    });

  return (
    <>
      {alvo.modo === "linha" && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-muted/60 px-3 py-2 text-[12px]">
          <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
          <span>
            <b className="font-semibold">{alvo.linha.contaNome}</b> · {diaBr(alvo.linha.data)} ·{" "}
            <span className="font-mono">{formatCurrency(Math.abs(alvo.linha.valor), "BRL")}</span>
          </span>
          {alvo.par && (
            <span className="text-muted-foreground">
              e <b className="font-semibold text-foreground">{alvo.par.contaNome}</b> · {diaBr(alvo.par.data)}
            </span>
          )}
        </div>
      )}

      {erro && (
        <div className="flex items-start gap-2 rounded-lg border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      <div className="space-y-3">
        <div className="grid grid-cols-[1fr_28px_1fr] items-start gap-2">
          <Campo rotulo="Conta de origem" obrigatorio>
            <SeletorDeConta
              dados={dados}
              aria="Conta de origem"
              valor={origem}
              travada={travaOrigem}
              soDe={soDeOrigem}
              onChange={(v) => {
                setOrigem(v);
                if (v === destino) setDestino("");
                setErro(null);
              }}
            />
          </Campo>
          <div className="mt-[22px] flex h-11 items-center justify-center text-muted-foreground">
            <ArrowRight className="h-4 w-4" />
          </div>
          <Campo rotulo="Conta de destino" obrigatorio>
            <SeletorDeConta
              dados={dados}
              aria="Conta de destino"
              valor={destino}
              desabilitada={origem}
              travada={travaDestino}
              soDe={soDeDestino}
              onChange={(v) => {
                setDestino(v);
                setErro(null);
              }}
            />
          </Campo>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <Campo
            rotulo="Data"
            obrigatorio
            ajuda={
              alvo.modo === "linha"
                ? "A data do banco."
                : alvo.modo === "novo"
                  ? `Em Criar e dar baixa, é a data em que ${asLinhas} ${umaPerna ? "entra" : "entram"} no extrato.`
                  : undefined
            }
          >
            {travaData ? (
              <div className={cn(INPUT, "items-center bg-muted/50 font-mono")}>{diaBr(data)}</div>
            ) : (
              <DatePicker
                name="data_mutuo"
                defaultValue={data}
                onDateChange={(d) => {
                  setData(d ? format(d, "yyyy-MM-dd") : "");
                  setErro(null);
                }}
              />
            )}
          </Campo>
          <Campo rotulo="Valor" obrigatorio ajuda={alvo.modo === "linha" ? "O valor do banco." : undefined}>
            {alvo.modo === "linha" ? (
              <div className={cn(INPUT, "items-center bg-muted/50 font-mono")}>{formatCurrency(valor, "BRL")}</div>
            ) : (
              <MoedaInput
                defaultValue={centavos ? (Number(centavos) / 100).toFixed(2) : ""}
                onCentavosChange={(c) => {
                  setCentavos(c);
                  setErro(null);
                }}
              />
            )}
          </Campo>
          <Campo rotulo="Trimestre do mútuo" obrigatorio ajuda={padrao.herdado && tri === null ? "O do mútuo original." : "Vai para a DRE."}>
            <Select value={tipoTri} onValueChange={setTri}>
              <SelectTrigger aria-label="Trimestre do mútuo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {opcoesDeTri.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v[0]}T {v.slice(2)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
          <Campo rotulo="Juros ao mês (%)" ajuda="Opcional. Vazio é sem juros.">
            <input aria-label="Juros ao mês" value={juros} onChange={(ev) => setJuros(ev.target.value)} placeholder="0,00" className={cn(INPUT, "font-mono")} />
          </Campo>
        </div>
        <Campo rotulo="Descrição (opcional)">
          <input
            type="text"
            value={descricao}
            maxLength={200}
            onChange={(ev) => setDescricao(ev.target.value)}
            placeholder="Ex.: reforço de caixa da Hitlab"
            className={INPUT}
          />
        </Campo>

        {mesmoCnpj && (
          <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
            <span className="flex-1">As duas contas são do mesmo CNPJ: o dinheiro só muda de conta.</span>
            {onTransferencia && (
              <button
                type="button"
                onClick={() => onTransferencia(origem, destino)}
                className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2.5 text-[11.5px] font-semibold text-amber-900 hover:bg-amber-100"
              >
                <ArrowLeftRight className="h-3 w-3" />
                Lançar como transferência
              </button>
            )}
          </div>
        )}

        {previsto && (
          <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[12.5px] text-sky-900">
            Esta linha realiza a previsão {previsto.codigo} de {diaBr(previsto.data)}: ela fica baixada, e nenhum mútuo novo é criado.
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-border text-[12.5px]">
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-border px-4 py-2.5">
            <span>
              <span className="text-muted-foreground">Sai de</span> <b className="font-semibold">{origem ? nomeDoValor(dados, origem) : "—"}</b>
            </span>
            <span className={cn("font-mono font-semibold", ehParteDeFora(origem) ? "text-muted-foreground" : "text-california-red")}>{valor ? `− ${formatCurrency(valor, "BRL")}` : "—"}</span>
            <span className="w-[230px] text-right text-muted-foreground">
              {ehParteDeFora(origem) ? (
                "fora do sistema"
              ) : saldoOrigem !== null ? (
                <>
                  saldo passa a <b className="font-mono font-semibold text-foreground">{formatCurrency(saldoOrigem - valor, "BRL")}</b>
                </>
              ) : null}
            </span>
          </div>
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-4 py-2.5">
            <span>
              <span className="text-muted-foreground">Entra em</span> <b className="font-semibold">{destino ? nomeDoValor(dados, destino) : "escolha o destino"}</b>
            </span>
            <span className={cn("font-mono font-semibold", ehParteDeFora(destino) ? "text-muted-foreground" : "text-emerald-700")}>{valor ? `+ ${formatCurrency(valor, "BRL")}` : "—"}</span>
            <span className="w-[230px] text-right text-muted-foreground">
              {ehParteDeFora(destino) ? (
                "fora do sistema"
              ) : saldoDestino !== null ? (
                <>
                  saldo passa a <b className="font-mono font-semibold text-foreground">{formatCurrency(saldoDestino + valor, "BRL")}</b>
                </>
              ) : null}
            </span>
          </div>
          {depois && (
            <div className="flex items-center justify-between gap-4 border-t border-border bg-muted/40 px-4 py-2.5">
              <span className="text-muted-foreground">Depois deste lançamento</span>
              <span>
                <b className="font-semibold">{depois.texto}</b>
                {depois.valor > 0 && <span className="ml-2 font-mono font-semibold">{formatCurrency(depois.valor, "BRL")}</span>}
              </span>
            </div>
          )}
        </div>

        {corrigindo && (
          <Campo rotulo="Motivo da correção" obrigatorio>
            <input aria-label="Motivo da correção" value={motivo} onChange={(ev) => setMotivo(ev.target.value)} placeholder="Ex.: valor digitado errado" className={INPUT} />
          </Campo>
        )}
        {corrigindo && mudaPerna && ligadas.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
            {ligadas.length === 1 ? "A linha do banco" : "As linhas do banco"} de{" "}
            {ligadas.map((p) => `${diaMes(corrigindo.data)} na ${dados.contas.find((c) => c.id === p.contaId)?.nome ?? "conta"}`).join(" e ")}{" "}
            {ligadas.length === 1 ? "volta" : "voltam"} para pendente.
          </div>
        )}

        {!corrigindo && (
          <div className="flex items-start gap-2 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" />
            <span>
              Não é receita nem despesa: fica abaixo do Lucro líquido, nas linhas de Mútuo interno da DRE e do fluxo de caixa.{" "}
              {umaPerna ? "Aparece só no extrato da nossa conta." : "Aparece no extrato das duas contas."}
            </span>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-border pt-4">
        {alvo.modo === "novo" && (
          <p className="text-pretty text-[11px] text-muted-foreground">
            <strong className="font-semibold text-foreground">Criar</strong> lança o título em aberto em Títulos a Receber.{" "}
            <strong className="font-semibold text-foreground">Criar e dar baixa</strong> registra o mútuo agora, com {asLinhas} no extrato.
          </p>
        )}
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onFechar} className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted">
            Cancelar
          </button>
          {alvo.modo === "novo" && (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() => criar(false)}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
              >
                <CalendarPlus className="h-4 w-4" />
                Criar
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => criar(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
              >
                <Banknote className="h-4 w-4" />
                Criar e dar baixa
              </button>
            </>
          )}
          {alvo.modo === "linha" && (
            <button
              type="button"
              disabled={pending}
              onClick={pelaLinha}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
            >
              <Link2 className="h-4 w-4" />
              {alvo.par ? "Lançar e conciliar as duas" : previsto ? "Baixar e conciliar" : "Lançar e conciliar"}
            </button>
          )}
          {corrigindo && (
            <button
              type="button"
              disabled={pending}
              onClick={corrigir}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              Salvar correção
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/** O formulário que busca os próprios dados: a Conciliação e o menu Novo
 *  lançamento não carregam saldos de mútuo sem precisar. */
export function MutuoFormComDados(props: Omit<React.ComponentProps<typeof MutuoForm>, "dados">) {
  const [dados, setDados] = React.useState<DadosDoMutuo | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);

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

  if (erro) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red" role="alert">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{erro}</span>
      </div>
    );
  }
  if (!dados) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando…
      </div>
    );
  }
  return <MutuoForm {...props} dados={dados} />;
}
