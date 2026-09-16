"use client";

/**
 * Fechar a fatura do cartão.
 *
 * A tela mostra os dois números lado a lado — o que o sistema somou e o que
 * o banco cobrou — porque a diferença entre eles é o assunto inteiro do
 * fechamento. IOF, anuidade e juros aparecem em toda fatura e ninguém os
 * lança; sem um lugar para eles, a fatura nunca bateria com o extrato.
 *
 * Desde a decisão 084 a diferença não vira mais um lançamento solto: ela
 * nasce como COMPRA da própria fatura, com plano de contas e rateio de
 * regional, igual a qualquer outra. E pode ser mais de uma — quando o que
 * faltou foram duas compras que ninguém lançou, cada uma entra com a sua
 * descrição, o seu plano de contas e o seu rateio. Um ajuste só é o mesmo
 * caminho, com uma linha.
 *
 * O rateio de cada linha vem preenchido na proporção em que as regionais
 * gastaram nesta fatura, e é editável. Fatura sem nenhum item com regional
 * abre a linha em branco, para o financeiro dizer de quem é.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CreditCard, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { formatCurrency, cn } from "@/lib/utils";
import type {
  PlanoContaTipo,
  PlanoContaSubtipo,
  RateioLinhaInput,
} from "@/lib/types";
import { RateioRegionalEditor } from "./rateio-regional-editor";
import {
  fecharFaturaCartao,
  rateioProporcionalDaFatura,
} from "./actions-fatura-cartao";

export interface FaturaDoCartao {
  id: string;
  codigo: string;
  cartao_credito_id: string;
  /** A empresa do cartão: é ela que decide quais regionais podem ratear. */
  empresa_id: string | null;
  competencia_fechamento: string;
  data_vencimento: string;
  /**
   * Aberta: soma dos itens, com sinal. Fechada: o valor cobrado que foi
   * informado no fechamento — os itens já viraram lançamento e saíram do
   * "aprovada", então somá-los de novo daria zero.
   */
  soma_itens: number;
  qtd_itens: number;
  /** `paga` não aparece aqui: ela vive em Títulos a Pagar. */
  status: "aberta" | "fechada";
}

interface RegionalOption {
  id: string;
  nome: string;
  ativo: boolean;
  empresa_id: string;
}

interface Props {
  fatura: FaturaDoCartao | null;
  cartaoNome: string;
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  regionais: RegionalOption[];
  onOpenChange: (aberto: boolean) => void;
}

/** Uma linha do ajuste: uma compra que a fatura vai ganhar. */
interface AjusteLinha {
  chave: string;
  descricao: string;
  tipoId: string;
  subtipoId: string;
  valorTexto: string;
  rateio: RateioLinhaInput[];
}

function formatData(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/** Aceita "1.234,56" e "1234.56" — o financeiro digita dos dois jeitos. */
function paraNumero(raw: string): number | null {
  const s = raw.trim();
  if (s === "") return null;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : null;
}

function paraTexto(n: number): string {
  return n.toFixed(2).replace(".", ",");
}

const TOLERANCIA = 0.005;

function rateioCompleto(linhas: RateioLinhaInput[]): boolean {
  if (linhas.length === 0) return false;
  if (linhas.some((l) => !l.regional_id)) return false;
  const soma = linhas.reduce((s, l) => s + l.percentual, 0);
  return Math.abs(soma - 100) < 0.01;
}

export function FecharFaturaDialog({
  fatura,
  cartaoNome,
  tipos,
  subtipos,
  regionais,
  onOpenChange,
}: Props) {
  const router = useRouter();
  const [valorTexto, setValorTexto] = React.useState("");
  const [linhas, setLinhas] = React.useState<AjusteLinha[]>([]);
  const [proporcional, setProporcional] = React.useState<RateioLinhaInput[]>([]);
  // A sugestão vem do servidor. Enquanto ela não chega, a primeira linha
  // não nasce: nascendo antes, ela nasceria em branco e a sugestão nunca
  // mais se aplicaria (a linha já existe, e o efeito não sobrescreve o que
  // o financeiro pode ter digitado).
  const [rateioCarregado, setRateioCarregado] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [salvando, setSalvando] = React.useState(false);

  const regionaisDaEmpresa = React.useMemo(
    () =>
      fatura?.empresa_id
        ? regionais.filter((r) => r.empresa_id === fatura.empresa_id)
        : regionais,
    [regionais, fatura?.empresa_id],
  );

  React.useEffect(() => {
    if (!fatura) return;
    // Abre com o valor do sistema: na fatura sem IOF nem anuidade ele já
    // é o valor certo, e o financeiro só confere e confirma.
    setValorTexto(paraTexto(fatura.soma_itens));
    setLinhas([]);
    setProporcional([]);
    setRateioCarregado(false);
    setErro(null);

    // O rateio sugerido vem do banco (proporção em que as regionais
    // gastaram NESTA fatura) e só é buscado quando o diálogo abre — não
    // vale pesar a página inteira por um número que quase sempre não é
    // usado.
    let vivo = true;
    void rateioProporcionalDaFatura(fatura.id).then((r) => {
      if (!vivo) return;
      if (r.ok) setProporcional(r.linhas);
      // Falhando a sugestão, a linha ainda precisa nascer — em branco, que
      // é o mesmo caminho da fatura sem nenhum item com regional.
      setRateioCarregado(true);
    });
    return () => {
      vivo = false;
    };
  }, [fatura]);

  const valorCobrado = paraNumero(valorTexto);
  const diferenca =
    fatura && valorCobrado !== null ? valorCobrado - fatura.soma_itens : 0;
  const temDiferenca = Math.abs(diferenca) > TOLERANCIA;
  // Diferença para baixo é crédito no cartão, e crédito no cartão só
  // existe como estorno de uma compra (29/08/2026). O banco recusa, e
  // aqui a tela explica antes de o financeiro tentar.
  const diferencaParaBaixo = temDiferenca && diferenca < 0;

  const somaLinhas = linhas.reduce(
    (s, l) => s + (paraNumero(l.valorTexto) ?? 0),
    0,
  );
  const restante = diferenca - somaLinhas;

  function novaLinha(valorSugerido: number): AjusteLinha {
    return {
      chave: Math.random().toString(36).slice(2),
      descricao: "",
      tipoId: "",
      subtipoId: "",
      valorTexto: valorSugerido > 0 ? paraTexto(valorSugerido) : "",
      // Já nasce com a proporção da fatura; em branco quando não há
      // nenhum item com regional para se basear.
      rateio:
        proporcional.length > 0
          ? proporcional.map((p) => ({ ...p }))
          : [{ regional_id: "", percentual: 100 }],
    };
  }

  // A primeira linha aparece sozinha assim que a diferença existe: é o
  // caso comum (um ajuste só, com o rateio já sugerido).
  React.useEffect(() => {
    if (temDiferenca && diferenca > 0 && linhas.length === 0 && rateioCarregado) {
      setLinhas([novaLinha(diferenca)]);
    }
    if (!temDiferenca && linhas.length > 0) {
      setLinhas([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [temDiferenca, diferenca, proporcional, rateioCarregado]);

  function alterarLinha(chave: string, patch: Partial<AjusteLinha>) {
    setLinhas((atual) =>
      atual.map((l) => (l.chave === chave ? { ...l, ...patch } : l)),
    );
  }

  // Zero e negativo passam: com estorno maior que as compras do mês a
  // fatura é credora e o banco não cobra nada (29/08/2026).
  const credora = valorCobrado !== null && valorCobrado <= 0;

  const linhasCompletas =
    linhas.length > 0 &&
    linhas.every(
      (l) =>
        l.tipoId !== "" &&
        l.subtipoId !== "" &&
        (paraNumero(l.valorTexto) ?? 0) > 0 &&
        rateioCompleto(l.rateio),
    );

  const podeFechar =
    fatura !== null &&
    valorCobrado !== null &&
    !diferencaParaBaixo &&
    (!temDiferenca ||
      (linhasCompletas && Math.abs(restante) < TOLERANCIA)) &&
    !salvando;

  async function confirmar() {
    if (!fatura || valorCobrado === null) return;
    setSalvando(true);
    setErro(null);

    const r = await fecharFaturaCartao({
      fatura_id: fatura.id,
      valor_cobrado: valorCobrado,
      ajustes: temDiferenca
        ? linhas.map((l) => ({
            descricao: l.descricao.trim() || null,
            tipo_id: l.tipoId,
            subtipo_id: l.subtipoId,
            valor: paraNumero(l.valorTexto) ?? 0,
            rateio: l.rateio,
          }))
        : [],
    });

    setSalvando(false);
    if (!r.ok) {
      setErro(r.message);
      return;
    }
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={fatura !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-[620px] overflow-y-auto">
        {fatura && (
          <>
            <DialogHeader>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-lg bg-california-red/10 p-2">
                  <CreditCard className="h-4.5 w-4.5 text-california-red" />
                </div>
                <div className="min-w-0">
                  <DialogTitle className="text-[19px]">
                    Fechar fatura
                  </DialogTitle>
                  <DialogDescription className="pt-1.5 text-[13px] leading-relaxed">
                    <span className="font-mono font-semibold text-[#b3323c]">
                      {fatura.codigo}
                    </span>{" "}
                    · {cartaoNome} · fecha em{" "}
                    {formatData(fatura.competencia_fechamento)}, vence em{" "}
                    {formatData(fatura.data_vencimento)}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-4 pt-1">
              <div className="rounded-xl border border-border px-3.5 py-3">
                <div className="flex items-center justify-between py-1">
                  <span className="text-[12.5px] text-muted-foreground">
                    Soma dos itens ({fatura.qtd_itens})
                  </span>
                  <span className="font-mono text-[13px] font-semibold">
                    {formatCurrency(fatura.soma_itens)}
                  </span>
                </div>
                {valorCobrado !== null && (
                  <div className="flex items-center justify-between border-t border-border py-1 pt-2">
                    <span className="text-[12.5px] text-muted-foreground">
                      Diferença
                    </span>
                    <span
                      className={cn(
                        "font-mono text-[13px] font-bold",
                        !temDiferenca
                          ? "text-muted-foreground"
                          : diferenca > 0
                            ? "text-[#c2410c]"
                            : "text-[#047857]",
                      )}
                    >
                      {diferenca === 0
                        ? formatCurrency(0)
                        : `${diferenca > 0 ? "+" : "−"}${formatCurrency(Math.abs(diferenca))}`}
                    </span>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="valor_cobrado">
                  Valor cobrado pelo banco *
                </Label>
                <Input
                  id="valor_cobrado"
                  inputMode="decimal"
                  value={valorTexto}
                  onChange={(e) => setValorTexto(e.target.value)}
                  placeholder="0,00"
                  className="font-mono"
                />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  O total da fatura como ele veio do banco. Vem preenchido com
                  a soma dos itens — corrija se o banco cobrou outro valor.
                  Negativo é válido: significa que o cartão ficou credor.
                </p>
              </div>

              {diferencaParaBaixo && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-xl border border-california-red/30 bg-california-red/5 px-3.5 py-3"
                >
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none text-california-red" />
                  <span className="text-[12px] leading-relaxed text-foreground">
                    O banco cobrou <strong>menos</strong> que a soma das
                    compras. Diferença para baixo é estorno: registre o
                    estorno da compra correspondente (botão{" "}
                    <strong>Estornar</strong>, na compra) e feche de novo.
                  </span>
                </div>
              )}

              {temDiferenca && !diferencaParaBaixo && (
                <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
                  <p className="text-[12.5px] leading-relaxed text-amber-900">
                    A diferença de{" "}
                    <strong className="font-mono font-semibold">
                      {formatCurrency(Math.abs(diferenca))}
                    </strong>{" "}
                    entra na fatura como compra. É o IOF, a anuidade, o juro
                    — ou compras que ninguém lançou, e aí cada uma entra na
                    sua linha.
                  </p>

                  {linhas.map((linha, idx) => {
                    const subtiposDoTipo = subtipos.filter(
                      (s) => s.tipo_id === linha.tipoId,
                    );
                    return (
                      <div
                        key={linha.chave}
                        className="space-y-3 rounded-lg border border-amber-200 bg-white px-3 py-3"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Item {idx + 1}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setLinhas((atual) =>
                                atual.filter((l) => l.chave !== linha.chave),
                              )
                            }
                            disabled={linhas.length <= 1}
                            className="rounded p-1 text-muted-foreground transition-colors hover:bg-california-red/10 hover:text-california-red disabled:opacity-30"
                            aria-label="Remover item"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        <div className="grid grid-cols-[1fr_auto] gap-2">
                          <div className="space-y-1">
                            <Label htmlFor={`aj_desc_${linha.chave}`}>
                              Descrição
                            </Label>
                            <Input
                              id={`aj_desc_${linha.chave}`}
                              value={linha.descricao}
                              onChange={(e) =>
                                alterarLinha(linha.chave, {
                                  descricao: e.target.value,
                                })
                              }
                              maxLength={200}
                              placeholder="Ex.: IOF e anuidade"
                            />
                          </div>
                          <div className="w-32 space-y-1">
                            <Label htmlFor={`aj_valor_${linha.chave}`}>
                              Valor *
                            </Label>
                            <Input
                              id={`aj_valor_${linha.chave}`}
                              inputMode="decimal"
                              value={linha.valorTexto}
                              onChange={(e) =>
                                alterarLinha(linha.chave, {
                                  valorTexto: e.target.value,
                                })
                              }
                              placeholder="0,00"
                              className="text-right font-mono"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label htmlFor={`aj_tipo_${linha.chave}`}>
                              Tipo *
                            </Label>
                            <select
                              id={`aj_tipo_${linha.chave}`}
                              value={linha.tipoId}
                              onChange={(e) =>
                                alterarLinha(linha.chave, {
                                  tipoId: e.target.value,
                                  subtipoId: "",
                                })
                              }
                              className="h-10 w-full rounded-lg border border-border bg-white px-2 text-sm outline-none focus:border-california-red"
                            >
                              <option value="">Selecione…</option>
                              {tipos.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.codigo} · {t.nome}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor={`aj_subtipo_${linha.chave}`}>
                              Subtipo *
                            </Label>
                            <select
                              id={`aj_subtipo_${linha.chave}`}
                              value={linha.subtipoId}
                              disabled={linha.tipoId === ""}
                              onChange={(e) =>
                                alterarLinha(linha.chave, {
                                  subtipoId: e.target.value,
                                })
                              }
                              className="h-10 w-full rounded-lg border border-border bg-white px-2 text-sm outline-none focus:border-california-red disabled:bg-muted/40"
                            >
                              <option value="">Selecione…</option>
                              {subtiposDoTipo.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.codigo} · {s.nome}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <RateioRegionalEditor
                          linhas={linha.rateio}
                          onChange={(novas) =>
                            alterarLinha(linha.chave, { rateio: novas })
                          }
                          regionais={regionaisDaEmpresa}
                          disabled={salvando}
                        />
                      </div>
                    );
                  })}

                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() =>
                        setLinhas((atual) => [...atual, novaLinha(restante)])
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 transition-colors hover:border-california-red hover:text-california-red"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Adicionar item
                    </button>
                    <span
                      className={cn(
                        "font-mono text-[12.5px] font-bold",
                        Math.abs(restante) < TOLERANCIA
                          ? "text-emerald-700"
                          : "text-california-red",
                      )}
                    >
                      {Math.abs(restante) < TOLERANCIA
                        ? "Diferença distribuída ✓"
                        : `Falta distribuir ${formatCurrency(restante)}`}
                    </span>
                  </div>
                </div>
              )}

              {credora ? (
                <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-[11.5px] leading-relaxed text-emerald-900">
                  Fatura credora: os estornos cobriram as compras e não há o
                  que pagar. Ela <strong>não desce</strong> para Títulos a
                  Pagar — o crédito fica na conta do cartão e abate a próxima
                  fatura, como a operadora faz.
                </p>
              ) : (
                <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                  Fechar transforma cada item num lançamento na conta do
                  cartão, com o plano de contas dele, e faz a fatura descer
                  para Títulos a Pagar como um título único. Depois disso ela
                  não recebe mais compra.
                </p>
              )}

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
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmar}
                  disabled={!podeFechar}
                  className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-california-red-hover disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <CreditCard className="h-3.5 w-3.5" />
                  {salvando ? "Fechando…" : "Fechar fatura"}
                </button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
