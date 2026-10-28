"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Lock, Pencil, Save, ShieldAlert, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ALIQUOTAS_IMPOSTO,
  aliquotaParaValor,
  formatarAliquota,
  valorInicialAliquota,
} from "@/lib/impostos";
import { formatCurrency } from "@/lib/utils";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { calcularTotaisVersao, type ItemParaTotais } from "@/lib/calculos/versao-totais";
import {
  SPREAD_DO_CAMBIO,
  compraDaCotacao,
  cotacaoValida,
  desviosDoPadrao,
  lerNumeroDigitado,
  vendaDaCotacao,
  type ExcecaoDoFechamento,
  type LinhaDoFechamento,
  type TaxasDoFechamento,
} from "@/lib/calculos/excecao-fechamento";
import { ExcecaoDialog, SeloExcecao } from "@/app/(app)/_planilha/excecao-no-fechamento";
import { formatarTaxa } from "@/app/(app)/_planilha/moeda-estrangeira";
import {
  atualizarVersao,
  definirExcecaoDoFechamento,
  removerExcecaoDoFechamento,
  type ActionResult,
} from "./versoes/actions";

/**
 * Os parâmetros que só o orçamento internacional tem (decisão 072).
 *
 * `moeda` e `taxaCambio` NÃO entram aqui: eles continuam descrevendo os
 * valores da planilha, que seguem em BRL mesmo no internacional. Quem
 * converte é `cambioCompra`.
 */
export interface MetaInternacional {
  /** Código ISO da moeda de fora. "" enquanto ninguém preencheu. */
  moedaEstrangeira: string;
  /** Cotação do dia e taxa de venda: registro de conferência. */
  cambioCotacao: number | null;
  cambioVenda: number | null;
  cambioData: string | null;
  /** A taxa que converte. */
  cambioCompra: number | null;
  percentualIntTaxes: number;
  intTransactionCosts: number;
}

interface Props {
  versaoId: string;
  /** Moeda dos valores da planilha — sempre BRL. Só formata o custo de
   *  transação do internacional; o nacional não a mostra mais. */
  moeda: string;
  percentualHonorarios: number;
  percentualImposto: number;
  /** `orcamentos.editar_impostos`. Trava o fee e — no internacional, desde
   *  14/09/2026 — também Impostos BR e int. taxes, que mudam o valor
   *  cobrado do cliente. A server action recusa de novo, mesmo que alguém
   *  contorne a tela. */
  podeEditarHonorarios: boolean;
  clienteNome?: string | null;
  /** Versão congelada (aprovada/cancelada) não abre o modo de edição. */
  readOnly?: boolean;
  readOnlyReason?: string;
  /** Parâmetros internacionais, ou `null` nas demais categorias.
   *
   *  Obrigatória e anulável, não opcional: quem monta o cabeçalho tem que
   *  dizer de qual modelo é a versão, e não deixar um default responder. */
  internacional: MetaInternacional | null;
  /** Mídia Off (decisão 147): a base dos honorários e a parte do veículo,
   *  ou `null` nas demais categorias. Obrigatória e anulável, como a de
   *  cima. A base e o veículo seguem a trava dos honorários. */
  midia: MetaMidia | null;
  /** Exceção no fechamento do internacional (decisão 206), ou `null` com a
   *  versão no padrão. Obrigatória e anulável, como `internacional`. */
  excecao: ExcecaoDoFechamento | null;
  /** `orcamentos.excecao_fechamento` — só o administrador. */
  podeRegistrarExcecao: boolean;
  /** Os itens como a cadeia os soma: o pop-up da exceção mostra o
   *  faturamento previsto com as taxas novas antes de gravar. */
  itensDoFechamento: ItemParaTotais[];
}

/** Os parâmetros que só a Mídia Off tem (decisão 147). */
export interface MetaMidia {
  /** A parte do negociado que fica com o veículo, em %. */
  percentualVeiculo: number;
  base: "negociado" | "liquido";
}

const BASES_DOS_HONORARIOS: Array<{ value: MetaMidia["base"]; rotulo: string }> = [
  { value: "negociado", rotulo: "do negociado" },
  { value: "liquido", rotulo: "do líquido do veículo" },
];

/**
 * Linha de parâmetros da versão ativa — Honorários e Impostos no nacional;
 * moeda de fora, câmbio, fee e taxas no internacional — com edição no
 * próprio lugar. Moeda e Câmbio do nacional saíram em 21/09/2026: a
 * planilha nacional é sempre em reais.
 *
 * Substitui o `VersaoEditorDrawer` nesta tela: com as versões em abas, estes
 * campos são o que muda de aba para aba, e abrir um drawer para
 * trocar uma alíquota tirava o usuário da planilha que ele está lendo. O
 * botão "Editar" fica à direita de Impostos e transforma a linha inteira
 * em formulário; nada mais da tela se mexe.
 *
 * As regras continuam as do drawer, porque a server action é a mesma
 * (`atualizarVersao`): campo em branco preserva o valor atual, a alíquota
 * sai da lista fechada de `lib/impostos.ts` e honorários é o único com
 * trava de papel.
 */
export function MetaVersao({
  versaoId,
  moeda,
  percentualHonorarios,
  percentualImposto,
  podeEditarHonorarios,
  clienteNome,
  readOnly,
  readOnlyReason,
  internacional,
  midia,
  excecao,
  podeRegistrarExcecao,
  itensDoFechamento,
}: Props) {
  const router = useRouter();
  const [editando, setEditando] = React.useState(false);
  // Decisão 206: no internacional, int. taxes, impostos BR e custo de
  // transação ficam no padrão e só mudam pela exceção do administrador.
  const [excecaoAberta, setExcecaoAberta] = React.useState(false);
  const [excecaoPendente, startExcecao] = React.useTransition();
  const [erroDaExcecao, setErroDaExcecao] = React.useState<string | null>(null);
  const taxas: TaxasDoFechamento | null = internacional
    ? {
        intTaxes: internacional.percentualIntTaxes,
        imposto: percentualImposto,
        itc: internacional.intTransactionCosts,
      }
    : null;
  const linhasForaDoPadrao = new Set<LinhaDoFechamento>(
    taxas && excecao ? desviosDoPadrao(taxas).map((d) => d.linha) : [],
  );
  const dicaDaTrava = podeRegistrarExcecao
    ? "Fora do padrão, pelo botão “Exceção”."
    : "Só o administrador altera, como exceção no fechamento.";

  function faturamentoCom(t: TaxasDoFechamento): number {
    return calcularTotaisVersao(itensDoFechamento, percentualHonorarios, t.imposto, {
      percentualIntTaxes: t.intTaxes,
      intTransactionCosts: t.itc,
    }).faturamentoPrevisto;
  }

  function aplicarExcecao(e: TaxasDoFechamento & { motivo: string }) {
    setErroDaExcecao(null);
    startExcecao(async () => {
      const res = await definirExcecaoDoFechamento(versaoId, e);
      if (!res.ok) {
        setErroDaExcecao(res.message);
        return;
      }
      setExcecaoAberta(false);
      router.refresh();
    });
  }

  function removerExcecao() {
    setErroDaExcecao(null);
    startExcecao(async () => {
      const res = await removerExcecaoDoFechamento(versaoId);
      if (!res.ok) {
        setErroDaExcecao(res.message);
        return;
      }
      setExcecaoAberta(false);
      router.refresh();
    });
  }
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  // Versão legada (0, 19,54, 20) abre vazia: a lista não tem esse valor.
  const [imposto, setImposto] = React.useState(() =>
    valorInicialAliquota(percentualImposto),
  );
  // Internacional sem a permissão: Impostos BR e int. taxes ficam só de
  // leitura e não são enviados (decisão do Tiago, 14/09/2026).
  const travarImpostos = internacional !== null && !podeEditarHonorarios;

  // Mídia Off: a base dos honorários mora num Select, fora do FormData.
  const [base, setBase] = React.useState<MetaMidia["base"]>(midia?.base ?? "negociado");

  // Trocar de aba remonta os valores: o estado do seletor tem que
  // acompanhar, senão a alíquota da versão anterior fica na tela.
  React.useEffect(() => {
    setImposto(valorInicialAliquota(percentualImposto));
    setBase(midia?.base ?? "negociado");
    setEditando(false);
    setErro(null);
  }, [versaoId, percentualImposto, midia?.base]);

  function fechar() {
    setEditando(false);
    setErro(null);
    setImposto(valorInicialAliquota(percentualImposto));
    setBase(midia?.base ?? "negociado");
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);

    const formData = new FormData(e.currentTarget);
    // O Select é controlado e não tem `name`. Em branco preserva a
    // alíquota atual — escolher só é obrigatório na aprovação.
    if (imposto !== "" && !travarImpostos && !internacional) {
      formData.set("percentual_imposto", imposto);
    }
    // Mídia Off: a base vai com os honorários, sob a mesma trava.
    if (midia && podeEditarHonorarios) {
      formData.set("base_honorarios", base);
    }

    startTransition(async () => {
      const res: ActionResult = await atualizarVersao(versaoId, formData);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setEditando(false);
      router.refresh();
    });
  }

  // Internacional: moeda e câmbio numa segunda linha, com edição própria
  // (22/10/2026). Os parâmetros que fecham a conta ficam na primeira.
  const comCambio = (conteudo: React.ReactNode) =>
    internacional ? (
      <div className="flex min-w-0 flex-col gap-2">
        {conteudo}
        <LinhaDoCambio
          versaoId={versaoId}
          internacional={internacional}
          readOnly={readOnly}
          readOnlyReason={readOnlyReason}
        />
      </div>
    ) : (
      conteudo
    );

  if (!editando) {
    return comCambio(
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {internacional ? (
          <>
            <Campo
              rotulo="Fee"
              valor={`${formatarPercentual(percentualHonorarios)}%`}
            />
            <Separador />
            <Campo
              rotulo="Int. taxes"
              valor={`${formatarPercentual(internacional.percentualIntTaxes)}%`}
              excecao={linhasForaDoPadrao.has("intTaxes")}
            />
            <Separador />
            <Campo
              rotulo="Impostos BR"
              valor={`${formatarPercentual(percentualImposto)}%`}
              excecao={linhasForaDoPadrao.has("imposto")}
            />
            <Separador />
            {/* Sempre à vista, mesmo em R$ 0,00 (decisão 206). */}
            <Campo
              rotulo="Int. transaction costs"
              valor={formatCurrency(internacional.intTransactionCosts, moeda)}
              excecao={linhasForaDoPadrao.has("itc")}
            />
            {excecao && taxas && <SeloExcecao excecao={excecao} taxas={taxas} />}
          </>
        ) : midia ? (
          <>
            {/* Mídia Off (decisão 147): os honorários levam a base, e a
                parte do veículo fica à vista — as três decidem a conta. */}
            <span>
              <span className="text-foreground/60">Honorários:</span>{" "}
              <span className="font-medium text-foreground">
                {formatarPercentual(percentualHonorarios)}%
              </span>{" "}
              <span className="text-foreground/60">
                {BASES_DOS_HONORARIOS.find((b) => b.value === midia.base)?.rotulo}
              </span>
            </span>
            <Separador />
            <span>
              <span className="text-foreground/60">Veículo:</span>{" "}
              <span className="font-medium text-foreground">
                {formatarPercentual(midia.percentualVeiculo)}%
              </span>{" "}
              <span className="text-foreground/60">do negociado</span>
            </span>
            <Separador />
            <Campo
              rotulo="Impostos"
              valor={`${formatarPercentual(percentualImposto)}%`}
            />
          </>
        ) : (
          <>
            {/* Moeda e Câmbio saíram daqui em 21/09/2026: planilha nacional
                é sempre em reais, e "BRL · 1,0000" era ruído em toda versão.
                Só o internacional mostra moeda e câmbio, no ramo de cima. */}
            <Campo
              rotulo="Honorários"
              valor={`${formatarPercentual(percentualHonorarios)}%`}
            />
            <Separador />
            <Campo
              rotulo="Impostos"
              valor={`${formatarPercentual(percentualImposto)}%`}
            />
          </>
        )}
        <button
          type="button"
          onClick={() => setEditando(true)}
          disabled={readOnly}
          title={readOnly ? readOnlyReason : "Editar parâmetros da versão"}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1 text-xs font-semibold text-foreground transition-colors hover:border-california-red/40 hover:text-california-red disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Pencil className="h-3 w-3" />
          Editar
        </button>
        {/* Decisão 206: a exceção é um ato à parte, só do administrador. */}
        {internacional && taxas && podeRegistrarExcecao && (
          <>
            <button
              type="button"
              onClick={() => {
                setErroDaExcecao(null);
                setExcecaoAberta(true);
              }}
              disabled={readOnly}
              title={
                readOnly
                  ? readOnlyReason
                  : "Ajustar int. taxes, impostos BR ou custo de transação só nesta versão"
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1 text-xs font-semibold text-foreground transition-colors hover:border-amber-400 hover:text-amber-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ShieldAlert className="h-3 w-3" />
              Exceção
            </button>
            <ExcecaoDialog
              open={excecaoAberta}
              onOpenChange={setExcecaoAberta}
              excecao={excecao}
              atual={taxas}
              fee={percentualHonorarios}
              faturamento={faturamentoCom}
              pending={excecaoPendente}
              erro={erroDaExcecao}
              onAplicar={aplicarExcecao}
              onRemover={removerExcecao}
            />
          </>
        )}
      </div>
    );
  }

  return comCambio(
    <form
      onSubmit={handleSubmit}
      className="flex min-w-0 flex-col gap-2 rounded-xl border border-california-red/30 bg-california-red/[0.03] px-3 py-2.5"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
        {/* No nacional não há `moeda` nem `taxa_cambio` para editar (21/09/2026):
            a server action preserva o valor atual de campo que não é enviado,
            como já acontecia no internacional. */}

        <CampoEdicao
          rotulo={internacional ? "Fee" : "Honorários"}
          travado={!podeEditarHonorarios}
          dica={
            podeEditarHonorarios
              ? undefined
              : `Vem do cadastro de ${clienteNome ?? "cliente"}. Só administrador altera.`
          }
        >
          {podeEditarHonorarios ? (
            <input
              name="percentual_honorarios"
              type="number"
              step="0.01"
              min="0"
              max="100"
              defaultValue={percentualHonorarios}
              // No nacional é o primeiro campo da linha; no internacional o
              // foco já nasce na Moeda.
              autoFocus={!internacional}
              className="no-spinner h-7 w-[76px] rounded-md border border-border bg-white px-2 text-sm font-medium text-foreground outline-none focus:border-california-red/50"
            />
          ) : (
            /* Sem `name`: o campo não é enviado. */
            <span className="inline-flex h-7 items-center rounded-md border border-border bg-muted/50 px-2 text-sm font-medium text-muted-foreground">
              {formatarPercentual(percentualHonorarios)}%
            </span>
          )}
          {midia &&
            (podeEditarHonorarios ? (
              <Select value={base} onValueChange={(v) => setBase(v as MetaMidia["base"])}>
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
            ) : (
              <span className="text-foreground/60">
                {BASES_DOS_HONORARIOS.find((b) => b.value === midia.base)?.rotulo}
              </span>
            ))}
        </CampoEdicao>

        {midia && (
          <CampoEdicao
            rotulo="Veículo"
            travado={!podeEditarHonorarios}
            dica={
              podeEditarHonorarios
                ? "A parte do veículo: 80% nas planilhas de referência."
                : "Só administrador ou gerente de projeto altera a parte do veículo."
            }
          >
            {podeEditarHonorarios ? (
              <input
                name="percentual_veiculo"
                type="number"
                step="0.01"
                min="0"
                max="100"
                defaultValue={midia.percentualVeiculo}
                aria-label="Parte do veículo, em %"
                className="no-spinner h-7 w-[64px] rounded-md border border-border bg-white px-2 text-sm font-medium text-foreground outline-none focus:border-california-red/50"
              />
            ) : (
              <span className="inline-flex h-7 items-center rounded-md border border-border bg-muted/50 px-2 text-sm font-medium text-muted-foreground">
                {formatarPercentual(midia.percentualVeiculo)}%
              </span>
            )}
            <span className="text-foreground/60">% do negociado</span>
          </CampoEdicao>
        )}

        {internacional && (
          <CampoEdicao rotulo="Int. taxes" travado dica={dicaDaTrava}>
            {/* Sem `name`: o campo não é enviado (decisão 206). */}
            <span className="inline-flex h-7 items-center rounded-md border border-border bg-muted/50 px-2 text-sm font-medium text-muted-foreground">
              {formatarPercentual(internacional.percentualIntTaxes)}%
            </span>
          </CampoEdicao>
        )}

        <CampoEdicao
          rotulo={internacional ? "Impostos BR" : "Impostos"}
          travado={travarImpostos || internacional !== null}
          dica={
            internacional
              ? dicaDaTrava
              : travarImpostos
                ? "Só administrador ou gerente de projeto altera os impostos da versão internacional."
                : undefined
          }
        >
          {travarImpostos || internacional ? (
            <span className="inline-flex h-7 items-center rounded-md border border-border bg-muted/50 px-2 text-sm font-medium text-muted-foreground">
              {formatarPercentual(percentualImposto)}%
            </span>
          ) : (
          <Select value={imposto} onValueChange={setImposto}>
            <SelectTrigger className="h-7 w-[136px] bg-white text-sm">
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

        {internacional && (
          <CampoEdicao rotulo="Int. transaction costs" travado dica={dicaDaTrava}>
            <span className="inline-flex h-7 items-center rounded-md border border-border bg-muted/50 px-2 text-sm font-medium text-muted-foreground">
              {formatCurrency(internacional.intTransactionCosts, moeda)}
            </span>
          </CampoEdicao>
        )}

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-california-red-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? (
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <Save className="h-3 w-3" />
            )}
            Salvar
          </button>
          <button
            type="button"
            onClick={fechar}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
          >
            <X className="h-3 w-3" />
            Cancelar
          </button>
        </div>
      </div>

      {erro && (
        <div className="flex items-start gap-2 text-xs text-california-red">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{erro}</span>
        </div>
      )}
    </form>
  );
}

function Campo({
  rotulo,
  valor,
  dica,
  excecao = false,
}: {
  rotulo: string;
  valor: string;
  /** Detalhe que não cabe na linha — no internacional, a cotação do dia,
   *  a data e a taxa de venda, que são registro de conferência. */
  dica?: string;
  /** O valor está fora do padrão por exceção do administrador (decisão 206). */
  excecao?: boolean;
}) {
  return (
    <span title={dica} className={dica ? "cursor-help" : undefined}>
      <span className="text-foreground/60">{rotulo}:</span>{" "}
      <span className={excecao ? "font-semibold text-amber-700" : "font-medium text-foreground"}>
        {valor}
      </span>
    </span>
  );
}

/** Um campo de taxa de câmbio no formulário: 4 casas, vazio quando ainda
 *  não há valor (e aí o `extractVersaoPartial` preserva o que está no
 *  banco, como já faz com os demais campos em branco). */
function TaxaInput({ name, valor }: { name: string; valor: number | null }) {
  return (
    <input
      name={name}
      type="number"
      step="0.0001"
      min="0"
      defaultValue={valor ?? ""}
      className="no-spinner h-7 w-[92px] rounded-md border border-border bg-white px-2 text-sm font-medium text-foreground outline-none focus:border-california-red/50"
    />
  );
}

/** ISO → dd/mm/aaaa, sem `Date`: `new Date("2026-06-02")` é UTC e volta
 *  um dia atrás em fuso negativo. */
function formatarData(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
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

/** Percentual em pt-BR, sem zeros à direita: 13 / 19,53 / 24,269914. */
function formatarPercentual(n: number): string {
  return String(Number(n)).replace(".", ",");
}

/* ---- A linha do câmbio do internacional (22/10/2026) -------------------- */

/** As moedas que se escolhem no câmbio (ISO 4217). O campo mostra o
 *  código; a busca acha pelo código, pelo nome e pelo país. Moeda nova
 *  entra com uma linha aqui. */
const MOEDAS: Array<[codigo: string, nome: string, pais: string]> = [
  ["USD", "Dólar americano", "Estados Unidos"],
  ["EUR", "Euro", "União Europeia"],
  ["GBP", "Libra esterlina", "Reino Unido"],
  ["ARS", "Peso argentino", "Argentina"],
  ["CLP", "Peso chileno", "Chile"],
  ["MXN", "Peso mexicano", "México"],
  ["COP", "Peso colombiano", "Colômbia"],
  ["PEN", "Sol peruano", "Peru"],
  ["UYU", "Peso uruguaio", "Uruguai"],
  ["PYG", "Guarani", "Paraguai"],
  ["BOB", "Boliviano", "Bolívia"],
  ["CAD", "Dólar canadense", "Canadá"],
  ["AUD", "Dólar australiano", "Austrália"],
  ["CHF", "Franco suíço", "Suíça"],
  ["JPY", "Iene", "Japão"],
  ["CNY", "Yuan", "China"],
  ["KRW", "Won", "Coreia do Sul"],
  ["INR", "Rúpia indiana", "Índia"],
  ["TRY", "Lira turca", "Turquia"],
  ["AED", "Dirham", "Emirados Árabes Unidos"],
  ["ZAR", "Rand", "África do Sul"],
  ["SEK", "Coroa sueca", "Suécia"],
  ["NOK", "Coroa norueguesa", "Noruega"],
  ["DKK", "Coroa dinamarquesa", "Dinamarca"],
];

/** Exportada para a linha de parâmetros do job no financeiro (decisão 224). */
export const ITENS_DE_MOEDA: ComboboxItem[] = MOEDAS.map(([codigo, nome, pais]) => ({
  value: codigo,
  label: `${codigo} · ${nome}`,
  descricao: pais,
  curto: codigo,
}));

/**
 * Moeda e câmbio do internacional numa linha própria, abaixo dos
 * parâmetros, com o próprio "Editar". Só se escolhem moeda, data e
 * cotação: compra e venda saem da cotação (−0,20 e +0,20), aparecem
 * calculadas enquanto ela é digitada, e o servidor as recalcula ao gravar.
 */
function LinhaDoCambio({
  versaoId,
  internacional,
  readOnly,
  readOnlyReason,
}: {
  versaoId: string;
  internacional: MetaInternacional;
  readOnly?: boolean;
  readOnlyReason?: string;
}) {
  const router = useRouter();
  const [editando, setEditando] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [cotacaoTxt, setCotacaoTxt] = React.useState("");
  const [moedaEscolhida, setMoedaEscolhida] = React.useState<string | null>(null);

  const cotacao = lerNumeroDigitado(cotacaoTxt);
  const valida = cotacaoValida(cotacao);
  // Moeda gravada fora da lista (versão antiga) continua aparecendo.
  const itens = React.useMemo(
    () =>
      internacional.moedaEstrangeira &&
      !MOEDAS.some(([c]) => c === internacional.moedaEstrangeira)
        ? [
            ...ITENS_DE_MOEDA,
            { value: internacional.moedaEstrangeira, label: internacional.moedaEstrangeira },
          ]
        : ITENS_DE_MOEDA,
    [internacional.moedaEstrangeira],
  );

  function abrir() {
    setCotacaoTxt(
      internacional.cambioCotacao ? String(internacional.cambioCotacao).replace(".", ",") : "",
    );
    setMoedaEscolhida(internacional.moedaEstrangeira || null);
    setErro(null);
    setEditando(true);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);
    if (!moedaEscolhida) {
      setErro("Escolha a moeda da versão.");
      return;
    }
    if (!valida) {
      setErro(
        `Informe a cotação do dia, maior que ${String(SPREAD_DO_CAMBIO).replace(".", ",")}: compra e venda saem dela (−0,20 e +0,20).`,
      );
      return;
    }
    const formData = new FormData(e.currentTarget);
    formData.set("cambio_cotacao", String(cotacao));
    startTransition(async () => {
      const res: ActionResult = await atualizarVersao(versaoId, formData);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setEditando(false);
      router.refresh();
    });
  }

  if (!editando) {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {/* Travessão quando vazio: desde 14/09/2026 aprovar exige o câmbio
            inteiro, e quem lê a linha tem que ver o que falta. */}
        <Campo rotulo="Moeda" valor={internacional.moedaEstrangeira || "—"} />
        <Separador />
        {/* A data entre parênteses, em tom apagado: o número da cotação
            fica em destaque, como os vizinhos. */}
        <span>
          <span className="text-foreground/60">Cotação:</span>{" "}
          <span className="font-medium text-foreground">
            {internacional.cambioCotacao ? formatarTaxa(internacional.cambioCotacao) : "—"}
          </span>
          {internacional.cambioData && (
            <span className="text-foreground/50"> ({formatarData(internacional.cambioData)})</span>
          )}
        </span>
        <Separador />
        <Campo
          rotulo="Compra"
          valor={internacional.cambioCompra ? formatarTaxa(internacional.cambioCompra) : "—"}
          dica="Cotação − 0,20. É a que converte a coluna da moeda e a cadeia de faturamento."
        />
        <Separador />
        <Campo
          rotulo="Venda"
          valor={internacional.cambioVenda ? formatarTaxa(internacional.cambioVenda) : "—"}
          dica="Cotação + 0,20. Registro de conferência: não entra em conta nenhuma."
        />
        <button
          type="button"
          onClick={abrir}
          disabled={readOnly}
          title={readOnly ? readOnlyReason : "Editar moeda e câmbio da versão"}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1 text-xs font-semibold text-foreground transition-colors hover:border-california-red/40 hover:text-california-red disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Pencil className="h-3 w-3" />
          Editar câmbio
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex min-w-0 flex-col gap-2 rounded-xl border border-california-red/30 bg-california-red/[0.03] px-3 py-2.5"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span className="text-foreground/60">Moeda:</span>
          <Combobox
            items={itens}
            value={moedaEscolhida}
            onChange={setMoedaEscolhida}
            name="moeda_estrangeira"
            ariaLabel="Moeda da versão"
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
            defaultValue={internacional.cambioData ?? ""}
            className="h-7 w-[138px] rounded-md border border-border bg-white px-2 text-sm font-medium text-foreground outline-none focus:border-california-red/50"
          />
        </CampoEdicao>
        <CampoEdicao rotulo="Cotação">
          <input
            value={cotacaoTxt}
            onChange={(e) => setCotacaoTxt(e.target.value)}
            inputMode="decimal"
            aria-label="Cotação do dia"
            className="h-7 w-[92px] rounded-md border border-border bg-white px-2 text-sm font-medium text-foreground outline-none focus:border-california-red/50"
          />
        </CampoEdicao>
        <CampoEdicao
          rotulo="Compra"
          travado
          dica="Cotação − 0,20, calculada. É a que converte a coluna da moeda e a cadeia de faturamento."
        >
          <span className="inline-flex h-7 items-center rounded-md border border-border bg-muted/50 px-2 font-mono text-sm font-medium text-muted-foreground">
            {valida ? formatarTaxa(compraDaCotacao(cotacao)) : "—"}
          </span>
        </CampoEdicao>
        <CampoEdicao rotulo="Venda" travado dica="Cotação + 0,20, calculada. Registro de conferência.">
          <span className="inline-flex h-7 items-center rounded-md border border-border bg-muted/50 px-2 font-mono text-sm font-medium text-muted-foreground">
            {valida ? formatarTaxa(vendaDaCotacao(cotacao)) : "—"}
          </span>
        </CampoEdicao>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-california-red-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? (
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <Save className="h-3 w-3" />
            )}
            Salvar
          </button>
          <button
            type="button"
            onClick={() => setEditando(false)}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
          >
            <X className="h-3 w-3" />
            Cancelar
          </button>
        </div>
      </div>
      {erro && (
        <div className="flex items-start gap-2 text-xs text-california-red">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{erro}</span>
        </div>
      )}
    </form>
  );
}
