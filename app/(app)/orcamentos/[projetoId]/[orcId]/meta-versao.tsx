"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Lock, Pencil, Save, X } from "lucide-react";
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
import { formatarTaxa } from "@/app/(app)/_planilha/moeda-estrangeira";
import { atualizarVersao, type ActionResult } from "./versoes/actions";

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
  moeda: string;
  taxaCambio: number;
  percentualHonorarios: number;
  percentualImposto: number;
  /** Só `administrador` diverge do padrão do cliente. A server action
   *  recusa de novo, mesmo que alguém contorne a tela. */
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
}

/**
 * Linha de parâmetros da versão ativa — Moeda, Câmbio, Honorários e
 * Impostos — com edição no próprio lugar.
 *
 * Substitui o `VersaoEditorDrawer` nesta tela: com as versões em abas, os
 * quatro campos são o que muda de aba para aba, e abrir um drawer para
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
  taxaCambio,
  percentualHonorarios,
  percentualImposto,
  podeEditarHonorarios,
  clienteNome,
  readOnly,
  readOnlyReason,
  internacional,
}: Props) {
  const router = useRouter();
  const [editando, setEditando] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  // Versão legada (0, 19,54, 20) abre vazia: a lista não tem esse valor.
  const [imposto, setImposto] = React.useState(() =>
    valorInicialAliquota(percentualImposto),
  );

  // Trocar de aba remonta os valores: o estado do seletor tem que
  // acompanhar, senão a alíquota da versão anterior fica na tela.
  React.useEffect(() => {
    setImposto(valorInicialAliquota(percentualImposto));
    setEditando(false);
    setErro(null);
  }, [versaoId, percentualImposto]);

  function fechar() {
    setEditando(false);
    setErro(null);
    setImposto(valorInicialAliquota(percentualImposto));
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);

    const formData = new FormData(e.currentTarget);
    // O Select é controlado e não tem `name`. Em branco preserva a
    // alíquota atual — escolher só é obrigatório na aprovação.
    if (imposto !== "") formData.set("percentual_imposto", imposto);

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
        {internacional ? (
          <>
            {/* A moeda dos VALORES continua BRL e por isso não vem aqui:
                o que muda de versão para versão no internacional é a moeda
                de fora e a taxa que converte. Cotação, venda e data são
                registro de conferência — vivem no `title` e no formulário,
                para a linha não virar um parágrafo. */}
            <Campo
              rotulo="Moeda"
              valor={internacional.moedaEstrangeira || "—"}
            />
            <Separador />
            <Campo
              rotulo="Compra"
              valor={
                internacional.cambioCompra
                  ? formatarTaxa(internacional.cambioCompra)
                  : "—"
              }
              dica={dicaDoCambio(internacional)}
            />
            <Separador />
            <Campo
              rotulo="Fee"
              valor={`${formatarPercentual(percentualHonorarios)}%`}
            />
            <Separador />
            <Campo
              rotulo="Int. taxes"
              valor={`${formatarPercentual(internacional.percentualIntTaxes)}%`}
            />
            <Separador />
            <Campo
              rotulo="Impostos BR"
              valor={`${formatarPercentual(percentualImposto)}%`}
            />
            {internacional.intTransactionCosts > 0 && (
              <>
                <Separador />
                <Campo
                  rotulo="Transação"
                  valor={formatCurrency(internacional.intTransactionCosts, moeda)}
                />
              </>
            )}
          </>
        ) : (
          <>
            <Campo rotulo="Moeda" valor={moeda} />
            <Separador />
            <Campo rotulo="Câmbio" valor={formatarTaxa(taxaCambio)} />
            <Separador />
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
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex min-w-0 flex-col gap-2 rounded-xl border border-california-red/30 bg-california-red/[0.03] px-3 py-2.5"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
        {internacional ? (
          <>
            {/* `moeda` e `taxa_cambio` não aparecem: os valores da planilha
                seguem em BRL, e mexer neles aqui faria a tela imprimir o
                símbolo errado em cima dos mesmos números. */}
            <CampoEdicao rotulo="Moeda">
              <input
                name="moeda_estrangeira"
                defaultValue={internacional.moedaEstrangeira}
                maxLength={4}
                placeholder="USD"
                autoFocus
                className="h-7 w-[68px] rounded-md border border-border bg-white px-2 text-sm font-medium uppercase text-foreground outline-none focus:border-california-red/50"
              />
            </CampoEdicao>

            <CampoEdicao rotulo="Data da cotação">
              <input
                name="cambio_data"
                type="date"
                defaultValue={internacional.cambioData ?? ""}
                className="h-7 w-[138px] rounded-md border border-border bg-white px-2 text-sm font-medium text-foreground outline-none focus:border-california-red/50"
              />
            </CampoEdicao>

            <CampoEdicao rotulo="Cotação">
              <TaxaInput
                name="cambio_cotacao"
                valor={internacional.cambioCotacao}
              />
            </CampoEdicao>

            <CampoEdicao
              rotulo="Compra"
              dica="É esta que converte a coluna da moeda e a cadeia de faturamento."
            >
              <TaxaInput
                name="cambio_compra"
                valor={internacional.cambioCompra}
              />
            </CampoEdicao>

            <CampoEdicao
              rotulo="Venda"
              dica="Registro de conferência: não entra em conta nenhuma."
            >
              <TaxaInput name="cambio_venda" valor={internacional.cambioVenda} />
            </CampoEdicao>
          </>
        ) : (
          <>
            <CampoEdicao rotulo="Moeda">
              <input
                name="moeda"
                defaultValue={moeda}
                maxLength={3}
                autoFocus
                className="h-7 w-[62px] rounded-md border border-border bg-white px-2 text-sm font-medium uppercase text-foreground outline-none focus:border-california-red/50"
              />
            </CampoEdicao>

            <CampoEdicao rotulo="Câmbio">
              <input
                name="taxa_cambio"
                type="number"
                step="0.0001"
                min="0.0001"
                defaultValue={taxaCambio}
                className="no-spinner h-7 w-[92px] rounded-md border border-border bg-white px-2 text-sm font-medium text-foreground outline-none focus:border-california-red/50"
              />
            </CampoEdicao>
          </>
        )}

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
              className="no-spinner h-7 w-[76px] rounded-md border border-border bg-white px-2 text-sm font-medium text-foreground outline-none focus:border-california-red/50"
            />
          ) : (
            /* Sem `name`: o campo não é enviado. */
            <span className="inline-flex h-7 items-center rounded-md border border-border bg-muted/50 px-2 text-sm font-medium text-muted-foreground">
              {formatarPercentual(percentualHonorarios)}%
            </span>
          )}
        </CampoEdicao>

        {internacional && (
          <CampoEdicao
            rotulo="Int. taxes"
            dica="Retidas no exterior, em gross-up sobre sub-total + fee. Na planilha modelo, 18,02% = IR 17,64% + IOF 0,37%."
          >
            <input
              name="percentual_int_taxes"
              type="number"
              step="0.01"
              min="0"
              max="100"
              defaultValue={internacional.percentualIntTaxes}
              className="no-spinner h-7 w-[76px] rounded-md border border-border bg-white px-2 text-sm font-medium text-foreground outline-none focus:border-california-red/50"
            />
          </CampoEdicao>
        )}

        <CampoEdicao rotulo={internacional ? "Impostos BR" : "Impostos"}>
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
        </CampoEdicao>

        {internacional && (
          <CampoEdicao
            rotulo="Int. transaction costs"
            dica="Em BRL. Entram depois do total recebido no exterior e não compõem base de imposto."
          >
            <input
              name="int_transaction_costs"
              type="number"
              step="0.01"
              min="0"
              defaultValue={internacional.intTransactionCosts}
              className="no-spinner h-7 w-[110px] rounded-md border border-border bg-white px-2 text-sm font-medium text-foreground outline-none focus:border-california-red/50"
            />
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
}: {
  rotulo: string;
  valor: string;
  /** Detalhe que não cabe na linha — no internacional, a cotação do dia,
   *  a data e a taxa de venda, que são registro de conferência. */
  dica?: string;
}) {
  return (
    <span title={dica} className={dica ? "cursor-help" : undefined}>
      <span className="text-foreground/60">{rotulo}:</span>{" "}
      <span className="font-medium text-foreground">{valor}</span>
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

/** O que o hover da "Compra" mostra: o que ficou registrado e não entra em
 *  conta nenhuma. Devolve `undefined` quando não há nada a contar, para o
 *  campo não ganhar cursor de ajuda sem ajuda. */
function dicaDoCambio(i: MetaInternacional): string | undefined {
  const partes: string[] = [];
  if (i.cambioCotacao) {
    const emData = i.cambioData ? ` em ${formatarData(i.cambioData)}` : "";
    partes.push(`Cotação ${formatarTaxa(i.cambioCotacao)}${emData}`);
  }
  if (i.cambioVenda) partes.push(`Venda ${formatarTaxa(i.cambioVenda)}`);
  return partes.length > 0 ? partes.join(" · ") : undefined;
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
