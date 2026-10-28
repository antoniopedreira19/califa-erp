"use client";

/**
 * A linha de parâmetros do job na Planilha Interna do financeiro (decisão
 * 224) — honorários/fee e impostos; no internacional, int. taxes, Impostos
 * BR, custo de transação e o câmbio; na Mídia Off, a base dos honorários e a
 * parte do veículo.
 *
 * É a linha do cabeçalho da versão no orçamento (`MetaVersao`), com a
 * mesma leitura e as mesmas classes, e o que muda é de quem ela é:
 *
 * - grava no JOB (`alterarParametrosDoJob`); a versão aprovada continua
 *   como o cliente aprovou;
 * - o "Salvar" abre o pop-up com o de → para, o impacto no faturamento
 *   previsto, nos impostos e no valor do job, e o motivo obrigatório (a
 *   confirmação A do protótipo aprovado em 27/10/2026);
 * - na fila da abertura tudo se edita; com o job aberto também, até a
 *   primeira nota (aí os campos ficam com o cadeado, e o câmbio do
 *   internacional continua) ou o encerramento (revisão de 28/10/2026);
 * - o selo "Alterado na abertura" mostra o de → para, quem e por quê.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CalendarClock,
  FilePenLine,
  Landmark,
  Lock,
  Pencil,
  Save,
  X,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Combobox } from "@/components/ui/combobox";
import { cn, formatCurrency } from "@/lib/utils";
import {
  ALIQUOTAS_IMPOSTO,
  aliquotaParaValor,
  formatarAliquota,
  valorInicialAliquota,
} from "@/lib/impostos";
import { calcularTotaisVersao } from "@/lib/calculos/versao-totais";
import {
  SPREAD_DO_CAMBIO,
  compraDaCotacao,
  cotacaoValida,
  lerNumeroDigitado,
  vendaDaCotacao,
} from "@/lib/calculos/excecao-fechamento";
import { comAContaDaMidia, fechamentoDosItens, parametrosDaVersao } from "@/lib/calculos/midia-off";
import { configDaPlanilha } from "@/app/(app)/_planilha/modelo-planilha";
import { formatarTaxa } from "@/app/(app)/_planilha/moeda-estrangeira";
import { ITENS_DE_MOEDA } from "@/app/(app)/orcamentos/[projetoId]/[orcId]/meta-versao";
import type { CategoriaModeloPlanilha, ParametrosDoJobGravados, TipoCusto } from "@/lib/types";
import { alterarParametrosDoJob } from "./actions-parametros-do-job";

/** Uma alteração dos parâmetros já gravada, para o selo. */
export interface AlteracaoDosParametros {
  id: string;
  created_at: string;
  autor_nome: string | null;
  motivo: string;
  parametros: { de: ParametrosDoJobGravados; para: ParametrosDoJobGravados };
}

/** As linhas do orçado do job, como a conta dos Totais as soma. */
export interface ItemDosParametros {
  tipo_custo: TipoCusto;
  total_orcado: number;
  em_save: boolean;
  save_consumido: number;
}

interface Props {
  jobId: string;
  jobCodigo: string;
  jobNome: string;
  /** Moeda dos valores da planilha — sempre BRL. */
  moeda: string;
  modelo: CategoriaModeloPlanilha;
  /** Os parâmetros que valem para o job hoje (`vw_parametros_do_job`). */
  parametros: ParametrosDoJobGravados;
  /** Quem edita e quando. `null` = só leitura: sem a permissão, ou fora da
   *  janela (encerrado). `travaDosParametros`: por que honorários, impostos
   *  e taxas não mudam mais (a primeira nota); o câmbio segue editável. */
  edicao: { naFila: boolean; travaDosParametros: string | null } | null;
  alteracoes: AlteracaoDosParametros[];
  itens: ItemDosParametros[];
}

type Editando = null | "parametros" | "cambio";

interface Rascunho {
  fee: string;
  imposto: string;
  intTaxes: string;
  itc: string;
  veiculo: string;
  base: "negociado" | "liquido";
  moeda: string | null;
  data: string;
  cotacao: string;
}

const CLASSE_INPUT =
  "no-spinner h-7 rounded-md border border-border bg-white px-2 text-sm font-medium text-foreground outline-none focus:border-california-red/50";

const BASES_DOS_HONORARIOS: Array<{ value: Rascunho["base"]; rotulo: string }> = [
  { value: "negociado", rotulo: "do negociado" },
  { value: "liquido", rotulo: "do líquido do veículo" },
];

/** Percentual em pt-BR, sem zeros à direita: 13 / 19,53 / 24,269914. */
function formatarPercentual(n: number): string {
  return String(Number(n)).replace(".", ",");
}
const pct = (n: number) => `${formatarPercentual(n)}%`;
const texto = (n: number | null) => (n === null ? "" : String(n).replace(".", ","));

function formatarData(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** Data e hora de Brasília da alteração. */
function quando(iso: string): string {
  const d = new Date(iso);
  const data = d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const hora = d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
  return `${data} · ${hora}`;
}

/** O de → para de cada campo que mudou, nos rótulos do modelo do job. */
export function camposDaAlteracao(
  de: ParametrosDoJobGravados,
  para: ParametrosDoJobGravados,
  modelo: CategoriaModeloPlanilha,
  moeda = "BRL",
): Array<{ rotulo: string; de: string; para: string }> {
  const intl = modelo === "internacional";
  const c: Array<{ rotulo: string; de: string; para: string }> = [];
  const se = (cond: boolean, rotulo: string, a: string, b: string) => {
    if (cond) c.push({ rotulo, de: a, para: b });
  };
  se(
    de.percentual_honorarios !== para.percentual_honorarios,
    intl ? "Fee" : "Honorários",
    pct(de.percentual_honorarios),
    pct(para.percentual_honorarios),
  );
  se(de.base_honorarios !== para.base_honorarios, "Base dos honorários",
    BASES_DOS_HONORARIOS.find((b) => b.value === de.base_honorarios)?.rotulo ?? de.base_honorarios,
    BASES_DOS_HONORARIOS.find((b) => b.value === para.base_honorarios)?.rotulo ?? para.base_honorarios);
  se(de.percentual_veiculo !== para.percentual_veiculo, "Veículo", pct(de.percentual_veiculo), pct(para.percentual_veiculo));
  se(de.percentual_int_taxes !== para.percentual_int_taxes, "Int. taxes", pct(de.percentual_int_taxes), pct(para.percentual_int_taxes));
  se(
    de.percentual_imposto !== para.percentual_imposto,
    intl ? "Impostos BR" : "Impostos",
    pct(de.percentual_imposto),
    pct(para.percentual_imposto),
  );
  se(
    de.int_transaction_costs !== para.int_transaction_costs,
    "Int. transaction costs",
    formatCurrency(de.int_transaction_costs, moeda),
    formatCurrency(para.int_transaction_costs, moeda),
  );
  se(de.moeda_estrangeira !== para.moeda_estrangeira, "Moeda", de.moeda_estrangeira || "—", para.moeda_estrangeira || "—");
  se(
    de.cambio_cotacao !== para.cambio_cotacao,
    "Cotação",
    de.cambio_cotacao ? formatarTaxa(de.cambio_cotacao) : "—",
    para.cambio_cotacao ? formatarTaxa(para.cambio_cotacao) : "—",
  );
  se(
    de.cambio_compra !== para.cambio_compra,
    "Compra",
    de.cambio_compra ? formatarTaxa(de.cambio_compra) : "—",
    para.cambio_compra ? formatarTaxa(para.cambio_compra) : "—",
  );
  se(
    de.cambio_data !== para.cambio_data,
    "Data da cotação",
    de.cambio_data ? formatarData(de.cambio_data) : "—",
    para.cambio_data ? formatarData(para.cambio_data) : "—",
  );
  return c;
}

function rascunhoDe(p: ParametrosDoJobGravados, intl: boolean): Rascunho {
  return {
    fee: texto(p.percentual_honorarios),
    // Fora do internacional a alíquota sai da lista, como no orçamento.
    imposto: intl ? texto(p.percentual_imposto) : valorInicialAliquota(p.percentual_imposto),
    intTaxes: texto(p.percentual_int_taxes),
    itc: texto(p.int_transaction_costs),
    veiculo: texto(p.percentual_veiculo),
    base: p.base_honorarios === "liquido" ? "liquido" : "negociado",
    moeda: p.moeda_estrangeira || null,
    data: p.cambio_data ?? "",
    cotacao: texto(p.cambio_cotacao),
  };
}

/** O retrato novo a partir do rascunho, ou o erro do que foi digitado. */
function paraDoRascunho(
  p: ParametrosDoJobGravados,
  r: Rascunho,
  editando: Editando,
  modelo: CategoriaModeloPlanilha,
): { para: ParametrosDoJobGravados; erro: string | null } {
  const intl = modelo === "internacional";
  const para: ParametrosDoJobGravados = { ...p };
  const ler = (s: string, atual: number): number | null => {
    if (s.trim() === "") return atual;
    const n = lerNumeroDigitado(s);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  if (editando === "parametros") {
    const fee = ler(r.fee, p.percentual_honorarios);
    const imposto = r.imposto === "" ? p.percentual_imposto : ler(r.imposto, p.percentual_imposto);
    if (fee === null || imposto === null) {
      return { para, erro: "Use só números, com vírgula nos decimais." };
    }
    para.percentual_honorarios = fee;
    para.percentual_imposto = imposto;
    if (intl) {
      const it = ler(r.intTaxes, p.percentual_int_taxes);
      const itc = ler(r.itc, p.int_transaction_costs);
      if (it === null || itc === null) return { para, erro: "Use só números, com vírgula nos decimais." };
      para.percentual_int_taxes = it;
      para.int_transaction_costs = itc;
    }
    if (modelo === "midia_off") {
      const v = ler(r.veiculo, p.percentual_veiculo);
      if (v === null) return { para, erro: "Use só números, com vírgula nos decimais." };
      para.percentual_veiculo = v;
      para.base_honorarios = r.base;
    }
  }
  if (editando === "cambio") {
    if (!r.moeda) return { para, erro: "Escolha a moeda do job." };
    const cot = lerNumeroDigitado(r.cotacao);
    if (!cotacaoValida(cot)) {
      return {
        para,
        erro: `Informe a cotação do dia, maior que ${String(SPREAD_DO_CAMBIO).replace(".", ",")}: compra e venda saem dela (−0,20 e +0,20).`,
      };
    }
    para.moeda_estrangeira = r.moeda;
    para.cambio_cotacao = cot;
    para.cambio_compra = compraDaCotacao(cot);
    para.cambio_venda = vendaDaCotacao(cot);
    para.cambio_data = r.data || null;
  }
  return { para, erro: null };
}

export function ParametrosDoJob({
  jobId,
  jobCodigo,
  jobNome,
  moeda,
  modelo,
  parametros: p,
  edicao,
  alteracoes,
  itens,
}: Props) {
  const router = useRouter();
  const intl = modelo === "internacional";
  const midia = modelo === "midia_off";
  const [editando, setEditando] = React.useState<Editando>(null);
  const [rascunho, setRascunho] = React.useState<Rascunho>(() => rascunhoDe(p, intl));
  const [erro, setErro] = React.useState<string | null>(null);
  const [confirmando, setConfirmando] = React.useState(false);
  const [salvando, startSalvar] = React.useTransition();
  const [erroDoPopup, setErroDoPopup] = React.useState<string | null>(null);

  // Depois do refresh os parâmetros novos chegam: a linha volta a ler deles.
  // Pelo conteúdo, e não pela referência — o objeto é remontado a cada render.
  const chaveDosParametros = JSON.stringify(p);
  React.useEffect(() => {
    setEditando(null);
    setConfirmando(false);
    setErro(null);
  }, [chaveDosParametros]);

  const { para, erro: erroDoRascunho } = paraDoRascunho(p, rascunho, editando, modelo);
  const campos = camposDaAlteracao(p, para, modelo, moeda);

  /** Faturamento, impostos e valor do job com um retrato de parâmetros —
   *  a mesma conta do card de Totais; o servidor refaz a sua ao gravar. */
  function contas(x: ParametrosDoJobGravados) {
    const t = calcularTotaisVersao(
      itens,
      x.percentual_honorarios,
      x.percentual_imposto,
      configDaPlanilha(modelo, x).internacional,
    );
    const final = midia ? comAContaDaMidia(t, fechamentoDosItens(itens, parametrosDaVersao(x))) : t;
    return {
      faturamento: final.faturamentoPrevisto,
      imposto: final.faturamento.imposto + final.faturamento.intTaxes,
      valorJob: final.valorJob,
    };
  }

  function editar(qual: Exclude<Editando, null>) {
    setRascunho(rascunhoDe(p, intl));
    setErro(null);
    setEditando(qual);
  }

  function fechar() {
    setEditando(null);
    setErro(null);
  }

  function pedirConfirmacao(e: React.FormEvent) {
    e.preventDefault();
    if (erroDoRascunho) return setErro(erroDoRascunho);
    if (campos.length === 0) return setErro("Nenhum parâmetro mudou.");
    setErro(null);
    setErroDoPopup(null);
    setConfirmando(true);
  }

  function confirmar(motivo: string) {
    setErroDoPopup(null);
    startSalvar(async () => {
      const res = await alterarParametrosDoJob(jobId, {
        motivo,
        para: {
          percentual_honorarios: para.percentual_honorarios,
          percentual_imposto: para.percentual_imposto,
          percentual_int_taxes: para.percentual_int_taxes,
          int_transaction_costs: para.int_transaction_costs,
          moeda_estrangeira: para.moeda_estrangeira,
          cambio_cotacao: para.cambio_cotacao,
          cambio_data: para.cambio_data,
          percentual_veiculo: para.percentual_veiculo,
          base_honorarios: para.base_honorarios === "liquido" ? "liquido" : "negociado",
        },
      });
      if (!res.ok) {
        setErroDoPopup(res.message);
        return;
      }
      setConfirmando(false);
      setEditando(null);
      router.refresh();
    });
  }

  const podeParametros = edicao !== null && edicao.travaDosParametros === null;
  const podeCambio = intl && edicao !== null;
  const antes = contas(p);
  const depois = contas(para);
  const rotuloDoSelo = edicao?.naFila === false ? "Alterado pelo financeiro" : "Alterado na abertura";

  const linhaDosParametros =
    editando !== "parametros" ? (
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {intl ? (
          <>
            <Campo rotulo="Fee" valor={pct(p.percentual_honorarios)} />
            <Separador />
            <Campo rotulo="Int. taxes" valor={pct(p.percentual_int_taxes)} />
            <Separador />
            <Campo rotulo="Impostos BR" valor={pct(p.percentual_imposto)} />
            <Separador />
            <Campo rotulo="Int. transaction costs" valor={formatCurrency(p.int_transaction_costs, moeda)} />
          </>
        ) : midia ? (
          <>
            <span>
              <span className="text-foreground/60">Honorários:</span>{" "}
              <span className="font-medium text-foreground">{pct(p.percentual_honorarios)}</span>{" "}
              <span className="text-foreground/60">
                {BASES_DOS_HONORARIOS.find((b) => b.value === p.base_honorarios)?.rotulo}
              </span>
            </span>
            <Separador />
            <span>
              <span className="text-foreground/60">Veículo:</span>{" "}
              <span className="font-medium text-foreground">{pct(p.percentual_veiculo)}</span>{" "}
              <span className="text-foreground/60">do negociado</span>
            </span>
            <Separador />
            <Campo rotulo="Impostos" valor={pct(p.percentual_imposto)} />
          </>
        ) : (
          <>
            <Campo rotulo="Honorários" valor={pct(p.percentual_honorarios)} />
            <Separador />
            <Campo rotulo="Impostos" valor={pct(p.percentual_imposto)} />
          </>
        )}
        {podeParametros ? (
          <button
            type="button"
            onClick={() => editar("parametros")}
            disabled={editando !== null}
            title={editando ? "Termine a edição do câmbio antes." : "Editar parâmetros do job"}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1 text-xs font-semibold text-foreground transition-colors hover:border-california-red/40 hover:text-california-red disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Pencil className="h-3 w-3" />
            Editar
          </button>
        ) : edicao?.travaDosParametros ? (
          <span
            title={
              intl
                ? `${edicao.travaDosParametros} O câmbio continua editável.`
                : edicao.travaDosParametros
            }
            className="inline-flex cursor-help items-center"
          >
            <Lock className="h-3.5 w-3.5 text-muted-foreground" />
          </span>
        ) : null}
        {alteracoes.length > 0 && (
          <SeloAlterado alteracoes={alteracoes} modelo={modelo} moeda={moeda} rotulo={rotuloDoSelo} />
        )}
      </div>
    ) : (
      <form
        onSubmit={pedirConfirmacao}
        className="flex min-w-0 flex-col gap-2 rounded-xl border border-california-red/30 bg-california-red/[0.03] px-3 py-2.5"
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          <CampoEdicao rotulo={intl ? "Fee" : "Honorários"}>
            <input
              name="percentual_honorarios"
              inputMode="decimal"
              value={rascunho.fee}
              onChange={(e) => setRascunho((r) => ({ ...r, fee: e.target.value }))}
              autoFocus
              aria-label={intl ? "Fee, em %" : "Honorários, em %"}
              className={`${CLASSE_INPUT} w-[76px]`}
            />
            {midia && (
              <Select
                value={rascunho.base}
                onValueChange={(v) => setRascunho((r) => ({ ...r, base: v as Rascunho["base"] }))}
              >
                <SelectTrigger className="h-7 w-[186px] bg-white text-sm" aria-label="Base dos honorários">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BASES_DOS_HONORARIOS.map((b) => (
                    <SelectItem key={b.value} value={b.value}>
                      {b.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </CampoEdicao>

          {midia && (
            <CampoEdicao rotulo="Veículo">
              <input
                name="percentual_veiculo"
                inputMode="decimal"
                value={rascunho.veiculo}
                onChange={(e) => setRascunho((r) => ({ ...r, veiculo: e.target.value }))}
                aria-label="Parte do veículo, em %"
                className={`${CLASSE_INPUT} w-[64px]`}
              />
              <span className="text-foreground/60">% do negociado</span>
            </CampoEdicao>
          )}

          {intl && (
            <CampoEdicao rotulo="Int. taxes">
              <input
                name="percentual_int_taxes"
                inputMode="decimal"
                value={rascunho.intTaxes}
                onChange={(e) => setRascunho((r) => ({ ...r, intTaxes: e.target.value }))}
                aria-label="Int. taxes, em %"
                className={`${CLASSE_INPUT} w-[76px]`}
              />
            </CampoEdicao>
          )}

          <CampoEdicao rotulo={intl ? "Impostos BR" : "Impostos"}>
            {intl ? (
              <input
                name="percentual_imposto"
                inputMode="decimal"
                value={rascunho.imposto}
                onChange={(e) => setRascunho((r) => ({ ...r, imposto: e.target.value }))}
                aria-label="Impostos BR, em %"
                className={`${CLASSE_INPUT} w-[76px]`}
              />
            ) : (
              <Select value={rascunho.imposto} onValueChange={(v) => setRascunho((r) => ({ ...r, imposto: v }))}>
                <SelectTrigger className="h-7 w-[136px] bg-white text-sm" aria-label="Impostos">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {ALIQUOTAS_IMPOSTO.map((a) => (
                    <SelectItem key={a} value={aliquotaParaValor(a)}>
                      {formatarAliquota(a)}%
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </CampoEdicao>

          {intl && (
            <CampoEdicao rotulo="Int. transaction costs">
              <input
                name="int_transaction_costs"
                inputMode="decimal"
                value={rascunho.itc}
                onChange={(e) => setRascunho((r) => ({ ...r, itc: e.target.value }))}
                aria-label="Int. transaction costs, em R$"
                className={`${CLASSE_INPUT} w-[100px]`}
              />
            </CampoEdicao>
          )}

          <BotoesDoForm onCancelar={fechar} />
        </div>
        {erro && <Erro texto={erro} />}
      </form>
    );

  const linhaDoCambio = !intl ? null : editando !== "cambio" ? (
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
      {/* Travessão quando vazio: quem lê a linha tem que ver o que falta. */}
      <Campo rotulo="Moeda" valor={p.moeda_estrangeira || "—"} />
      <Separador />
      <span>
        <span className="text-foreground/60">Cotação:</span>{" "}
        <span className="font-medium text-foreground">{p.cambio_cotacao ? formatarTaxa(p.cambio_cotacao) : "—"}</span>
        {p.cambio_data && <span className="text-foreground/50"> ({formatarData(p.cambio_data)})</span>}
      </span>
      <Separador />
      <Campo
        rotulo="Compra"
        valor={p.cambio_compra ? formatarTaxa(p.cambio_compra) : "—"}
        dica="Cotação − 0,20. É a que converte a coluna da moeda e a cadeia de faturamento."
      />
      <Separador />
      <Campo
        rotulo="Venda"
        valor={p.cambio_venda ? formatarTaxa(p.cambio_venda) : "—"}
        dica="Cotação + 0,20. Registro de conferência: não entra em conta nenhuma."
      />
      {podeCambio && (
        <button
          type="button"
          onClick={() => editar("cambio")}
          disabled={editando !== null}
          title={editando ? "Termine a edição dos parâmetros antes." : "Editar moeda e câmbio do job"}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1 text-xs font-semibold text-foreground transition-colors hover:border-california-red/40 hover:text-california-red disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Pencil className="h-3 w-3" />
          Editar câmbio
        </button>
      )}
    </div>
  ) : (
    <form
      onSubmit={pedirConfirmacao}
      className="flex min-w-0 flex-col gap-2 rounded-xl border border-california-red/30 bg-california-red/[0.03] px-3 py-2.5"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span className="text-foreground/60">Moeda:</span>
          <Combobox
            items={ITENS_DE_MOEDA}
            value={rascunho.moeda}
            onChange={(v) => setRascunho((r) => ({ ...r, moeda: v }))}
            name="moeda_estrangeira"
            ariaLabel="Moeda do job"
            placeholder="Escolha"
            buscaPlaceholder="Código, moeda ou país"
            larguraLista="w-[300px]"
            className="h-7 w-[96px] rounded-md border-border bg-white px-2 text-sm font-medium"
          />
        </span>
        <CampoEdicao rotulo="Data da cotação">
          <input
            name="cambio_data"
            type="date"
            value={rascunho.data}
            onChange={(e) => setRascunho((r) => ({ ...r, data: e.target.value }))}
            className="h-7 w-[138px] rounded-md border border-border bg-white px-2 text-sm font-medium text-foreground outline-none focus:border-california-red/50"
          />
        </CampoEdicao>
        <CampoEdicao rotulo="Cotação">
          <input
            value={rascunho.cotacao}
            onChange={(e) => setRascunho((r) => ({ ...r, cotacao: e.target.value }))}
            inputMode="decimal"
            aria-label="Cotação do dia"
            autoFocus
            className="h-7 w-[92px] rounded-md border border-border bg-white px-2 text-sm font-medium text-foreground outline-none focus:border-california-red/50"
          />
        </CampoEdicao>
        <CampoEdicao
          rotulo="Compra"
          travado
          dica="Cotação − 0,20, calculada. É a que converte a coluna da moeda e a cadeia de faturamento."
        >
          <span className="inline-flex h-7 items-center rounded-md border border-border bg-muted/50 px-2 font-mono text-sm font-medium text-muted-foreground">
            {cotacaoValida(lerNumeroDigitado(rascunho.cotacao))
              ? formatarTaxa(compraDaCotacao(lerNumeroDigitado(rascunho.cotacao)))
              : "—"}
          </span>
        </CampoEdicao>
        <CampoEdicao rotulo="Venda" travado dica="Cotação + 0,20, calculada. Registro de conferência.">
          <span className="inline-flex h-7 items-center rounded-md border border-border bg-muted/50 px-2 font-mono text-sm font-medium text-muted-foreground">
            {cotacaoValida(lerNumeroDigitado(rascunho.cotacao))
              ? formatarTaxa(vendaDaCotacao(lerNumeroDigitado(rascunho.cotacao)))
              : "—"}
          </span>
        </CampoEdicao>
        <BotoesDoForm onCancelar={fechar} />
      </div>
      {erro && <Erro texto={erro} />}
    </form>
  );

  return (
    <>
      {linhaDoCambio ? (
        <div className="flex min-w-0 flex-col gap-2">
          {linhaDosParametros}
          {linhaDoCambio}
        </div>
      ) : (
        linhaDosParametros
      )}
      <ConfirmarParametrosDialog
        open={confirmando}
        onOpenChange={(aberto) => {
          if (!salvando) setConfirmando(aberto);
        }}
        jobCodigo={jobCodigo}
        jobNome={jobNome}
        campos={campos}
        faturamento={{ antes: antes.faturamento, depois: depois.faturamento }}
        imposto={{ antes: antes.imposto, depois: depois.imposto }}
        valorJob={{ antes: antes.valorJob, depois: depois.valorJob }}
        moeda={moeda}
        naFila={edicao?.naFila === true}
        salvando={salvando}
        erro={erroDoPopup}
        onConfirmar={confirmar}
      />
    </>
  );
}

/* ---- O selo do que mudou ---------------------------------------------------- */

function SeloAlterado({
  alteracoes,
  modelo,
  moeda,
  rotulo,
}: {
  alteracoes: AlteracaoDosParametros[];
  modelo: CategoriaModeloPlanilha;
  moeda: string;
  rotulo: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex h-[22px] cursor-help items-center gap-1 rounded-full border border-border bg-white px-2 text-[11px] font-semibold text-muted-foreground">
          <Landmark className="h-3 w-3 text-california-red" />
          {rotulo}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[380px] text-xs leading-relaxed">
        <div className="space-y-2.5">
          {alteracoes.map((a) => (
            <div key={a.id} className="space-y-1">
              {camposDaAlteracao(a.parametros.de, a.parametros.para, modelo, moeda).map((c) => (
                <div key={c.rotulo} className="flex justify-between gap-4">
                  <span>{c.rotulo}</span>
                  <span className="font-mono">
                    <span className="text-muted-foreground line-through">{c.de}</span> → {c.para}
                  </span>
                </div>
              ))}
              <p className="border-t border-border pt-1">“{a.motivo}”</p>
              <p className="text-muted-foreground">
                {a.autor_nome ?? "—"} · {quando(a.created_at)}
              </p>
            </div>
          ))}
          <p className="border-t border-border pt-1.5 text-muted-foreground">
            A versão aprovada no orçamento não muda.
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/* ---- O pop-up do Salvar (o desenho do `EdicaoFinanceiroConfirmarDialog`) ---- */

interface ParDeValores {
  antes: number;
  depois: number;
}

function corDoDelta(delta: number): string {
  if (delta > 0) return "text-[#c2410c]";
  if (delta < 0) return "text-[#047857]";
  return "text-muted-foreground";
}

function comSinal(v: number, moeda: string): string {
  const s = formatCurrency(Math.abs(v), moeda);
  if (Math.round(v * 100) === 0) return s;
  return `${v > 0 ? "+" : "−"}${s}`;
}

const delta = (par: ParDeValores) => (Math.round(par.depois * 100) - Math.round(par.antes * 100)) / 100;

function LinhaDeValor({
  rotulo,
  par,
  moeda,
  forte,
}: {
  rotulo: string;
  par: ParDeValores;
  moeda: string;
  forte?: boolean;
}) {
  const d = delta(par);
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span className={cn("text-[12.5px]", forte ? "font-semibold text-foreground" : "text-muted-foreground")}>
        {rotulo}
      </span>
      <div className="flex items-baseline gap-2 whitespace-nowrap">
        <span className="font-mono text-[11.5px] text-muted-foreground line-through">
          {formatCurrency(par.antes, moeda)}
        </span>
        <span className={cn("font-mono font-bold text-foreground", forte ? "text-[13.5px]" : "text-[12.5px]")}>
          {formatCurrency(par.depois, moeda)}
        </span>
        <span className={cn("font-mono text-[11.5px] font-bold", corDoDelta(d))}>{comSinal(d, moeda)}</span>
      </div>
    </div>
  );
}

function ConfirmarParametrosDialog({
  open,
  onOpenChange,
  jobCodigo,
  jobNome,
  campos,
  faturamento,
  imposto,
  valorJob,
  moeda,
  naFila,
  salvando,
  erro,
  onConfirmar,
}: {
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
  jobCodigo: string;
  jobNome: string;
  campos: Array<{ rotulo: string; de: string; para: string }>;
  faturamento: ParDeValores;
  imposto: ParDeValores;
  valorJob: ParDeValores;
  moeda: string;
  naFila: boolean;
  salvando: boolean;
  erro: string | null;
  onConfirmar: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = React.useState("");
  React.useEffect(() => {
    if (open) setMotivo("");
  }, [open]);
  const podeConfirmar = motivo.trim().length >= 5 && campos.length > 0 && !salvando;
  const mudaValor = delta(faturamento) !== 0 || delta(valorJob) !== 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-[620px] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-california-red/10 p-2">
              <FilePenLine className="h-4.5 w-4.5 text-california-red" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-[19px]">Confirmar alteração dos parâmetros</DialogTitle>
              <DialogDescription className="pt-1.5 text-[13px] leading-relaxed">
                {jobCodigo} · {jobNome}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <section className="rounded-xl border border-border">
            <h3 className="border-b border-border px-3.5 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              O que muda no job
            </h3>
            <ul className="divide-y divide-border">
              {campos.map((c) => (
                <li key={c.rotulo} className="flex items-center justify-between gap-3 px-3.5 py-2">
                  <span className="text-[12.5px] text-foreground">{c.rotulo}</span>
                  <span className="flex items-baseline gap-2 whitespace-nowrap font-mono text-[11.5px]">
                    <span className="text-muted-foreground">{c.de}</span>
                    <span className="text-muted-foreground">→</span>
                    <span className="font-bold text-foreground">{c.para}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-border px-3.5 py-2">
            <LinhaDeValor rotulo="Faturamento previsto" par={faturamento} moeda={moeda} />
            <LinhaDeValor rotulo="Impostos previstos" par={imposto} moeda={moeda} />
            <LinhaDeValor rotulo="Valor do job" par={valorJob} moeda={moeda} forte />
          </section>

          {mudaValor && (
            <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/30 px-3.5 py-3">
              <CalendarClock className="mt-0.5 h-4 w-4 flex-none text-california-red" />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-[12.5px] font-semibold text-foreground">A previsão de recebimento acompanha</p>
                <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                  {naFila
                    ? "As parcelas já preenchidas na aba Abertura do Job andam na mesma proporção, com as mesmas datas; os recolhimentos de impostos previstos acompanham do mesmo jeito."
                    : "Cada parcela na mesma proporção, com as mesmas datas; os recolhimentos de impostos previstos e o envio para faturamento ainda sem nota acompanham do mesmo jeito."}
                </p>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-baseline gap-2">
              <label htmlFor="motivo-parametros-do-job" className="text-[12.5px] font-semibold text-foreground">
                Motivo da alteração
              </label>
              <span className="text-[10.5px] font-semibold uppercase tracking-wider text-california-red">
                obrigatório
              </span>
            </div>
            <Textarea
              id="motivo-parametros-do-job"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              maxLength={500}
              autoFocus
              placeholder="Ex.: Fee renegociado com o cliente depois da aprovação."
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Vai para Alterações do Financeiro, na aba Informações do Job, com o seu nome, data e hora.
            </p>
          </div>

          {erro && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-california-red/30 bg-california-red/5 px-3 py-2.5"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none text-california-red" />
              <span className="text-[12px] text-foreground">{erro}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={salvando}
              className="inline-flex items-center rounded-lg border border-border bg-white px-3.5 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-[#d7d7d7] hover:text-foreground disabled:opacity-50"
            >
              Voltar
            </button>
            <button
              type="button"
              onClick={() => onConfirmar(motivo.trim())}
              disabled={!podeConfirmar}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-california-red-hover disabled:cursor-not-allowed disabled:opacity-45"
            >
              <FilePenLine className="h-3.5 w-3.5" />
              {salvando ? "Gravando…" : "Confirmar alteração"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---- Peças da linha ---------------------------------------------------------- */

function BotoesDoForm({ onCancelar }: { onCancelar: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="submit"
        className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-california-red-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Save className="h-3 w-3" />
        Salvar
      </button>
      <button
        type="button"
        onClick={onCancelar}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
      >
        <X className="h-3 w-3" />
        Cancelar
      </button>
    </div>
  );
}

function Erro({ texto }: { texto: string }) {
  return (
    <div className="flex items-start gap-2 text-xs text-california-red">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{texto}</span>
    </div>
  );
}

function Campo({ rotulo, valor, dica }: { rotulo: string; valor: string; dica?: string }) {
  return (
    <span title={dica} className={dica ? "cursor-help" : undefined}>
      <span className="text-foreground/60">{rotulo}:</span>{" "}
      <span className="font-medium text-foreground">{valor}</span>
    </span>
  );
}

function Separador() {
  return (
    <span aria-hidden className="text-border">
      ·
    </span>
  );
}

function CampoEdicao({
  rotulo,
  travado,
  dica,
  children,
}: {
  rotulo: string;
  travado?: boolean;
  dica?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="inline-flex items-center gap-2" title={dica}>
      <span className="inline-flex items-center gap-1 text-foreground/60">
        {rotulo}:
        {travado && <Lock className="h-3 w-3 text-muted-foreground" />}
      </span>
      {children}
    </label>
  );
}
