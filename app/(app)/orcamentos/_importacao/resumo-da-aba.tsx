"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency } from "@/lib/utils";
import { calcularRentabilidade } from "@/lib/calculos/versao-totais";
import type {
  OpcaoDosMeses,
  PreviewDaAba,
  SemBlocoDeMes,
} from "@/lib/importacao/tipos-da-importacao";
import { nomeDoMes } from "@/lib/calculos/meses-trimestre";
import { ORCADO, PLANEJADO, RENTAB_VALOR } from "@/app/(app)/_planilha/blocos";

/**
 * O resumo da aba escolhida (decisão 110, design 1C com os totais na lista
 * de grupos — versão B aprovada em 27/09/2026).
 *
 * Cada número aparece uma vez: a lista de grupos tem cabeçalho e fecha com
 * a linha de total, embaixo das colunas que ela soma. Rentabilidade em R$ e
 * em %, na conta da tela da versão (`calcularRentabilidade`: sobre o
 * orçado, travessão sem planejado), e em grafite, como nas planilhas.
 *
 * Aba sem título de mês no Fee e no Always On (decisão 158): a pergunta
 * "Meses" vem antes de tudo, e a do planejado só depois dela.
 */

export type OrigemDoPlanejado = "anterior" | "planilha";

function porcento(orcado: number, planejado: number): string {
  const { percentual } = calcularRentabilidade(orcado, planejado);
  return percentual === null ? "—" : `${percentual.toFixed(1).replace(".", ",")}%`;
}

/** "outubro, novembro e dezembro". */
function listaDeMeses(isos: string[]): string {
  const nomes = [...isos].sort().map(nomeDoMes);
  return nomes.length <= 1
    ? nomes.join("")
    : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/** Uma opção de rádio do resumo. `grupo` separa as perguntas na página. */
function OpcaoPlanejado({
  marcado,
  onEscolher,
  titulo,
  detalhe,
  grupo = "origem-planejado",
}: {
  marcado: boolean;
  onEscolher: () => void;
  titulo: string;
  detalhe: string;
  grupo?: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors",
        marcado ? "border-california-red/40 bg-california-red/5" : "border-border hover:bg-accent",
      )}
    >
      <input
        type="radio"
        name={grupo}
        checked={marcado}
        onChange={onEscolher}
        className="mt-0.5 accent-california-red"
      />
      <span className="space-y-0.5">
        <span className="block text-sm font-medium text-foreground">{titulo}</span>
        <span className="block text-xs text-muted-foreground">{detalhe}</span>
      </span>
    </label>
  );
}

/** A pergunta do planejado só aparece com versão anterior e fora do
 *  Interno. O modal usa a mesma conta para travar o botão de gravar. */
export function perguntaOPlanejado(preview: PreviewDaAba, interno: boolean): boolean {
  return preview.planejado.versao_anterior !== null && !interno;
}

export function ResumoDaAba({
  preview,
  origemPlanejado,
  onOrigemPlanejado,
  interno,
  mensal,
  mostrarHonorarios,
  semBloco,
  opcaoMeses,
  onOpcaoMeses,
}: {
  preview: PreviewDaAba;
  /** Aba sem título de mês no Fee e no Always On (decisão 158). `null` nas
   *  outras. */
  semBloco: SemBlocoDeMes | null;
  /** Onde os itens da aba sem título de mês entram. `null` antes da escolha. */
  opcaoMeses: OpcaoDosMeses | null;
  onOpcaoMeses: (opcao: OpcaoDosMeses) => void;
  /** `null` enquanto quem importa não escolheu: nada vem marcado (05/10/2026). */
  origemPlanejado: OrigemDoPlanejado | null;
  onOrigemPlanejado: (origem: OrigemDoPlanejado) => void;
  /** Serviço Interno (decisão 105): o planejado é o orçado, sem pergunta. */
  interno: boolean;
  /** Fee e Always On: o texto da opção diz de onde vem o planejado. */
  mensal: boolean;
  /** A importação da versão mostra os honorários que ela vai receber; o
   *  editor do orçamento tem os parâmetros na própria tela. */
  mostrarHonorarios: boolean;
}) {
  const p = preview.planejado;
  const perguntar = perguntaOPlanejado(preview, interno);
  const herdando = perguntar && origemPlanejado === "anterior";
  // Sem escolha, a tabela não adianta nenhuma das duas: planejado em "—".
  const semEscolha = perguntar && origemPlanejado === null;
  const planejadoDoGrupo = (g: PreviewDaAba["grupos"][number]) =>
    interno
      ? g.total_bruto
      : semEscolha
        ? 0
        : herdando
          ? g.total_planejado_herdado
          : g.total_planejado;

  const totalOrcado = preview.grupos.reduce((s, g) => s + g.total_bruto, 0);
  const totalPlanejado = preview.grupos.reduce((s, g) => s + planejadoDoGrupo(g), 0);
  const totalItens = preview.grupos.reduce((s, g) => s + g.itens_count, 0);
  const semPar = p.total_itens - p.casadas;
  const { ajustes, ignoradas } = preview.avisos_total;
  const TH = "py-2 text-[10px] font-semibold uppercase tracking-wider";
  const perguntaMeses = !!semBloco && semBloco.meses.length > 1;
  const [primeiroMes, ...outrosMeses] = semBloco ? [...semBloco.meses].sort() : [];
  const itensDaAba = semBloco?.primeiro
    ? semBloco.primeiro.grupos.reduce((s, g) => s + g.itens_count, 0)
    : 0;

  return (
    <div className="space-y-5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Resumo da aba {preview.aba}
      </p>

      {interno && (
        <p className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          <b className="text-foreground">Orçamento Interno.</b> Toda linha entra como F · Interno, com
          o planejado igual ao orçado — o tipo de custo e o bloco PLANEJADO da planilha não são usados.
        </p>
      )}

      {perguntaMeses && semBloco && (
        <fieldset className="space-y-2 rounded-xl border border-border p-4">
          <legend className="px-1 text-xs font-semibold text-foreground">Meses</legend>
          <p className="px-1 pb-1 text-xs leading-relaxed text-muted-foreground">
            A aba não tem título de mês, como “{nomeDoMes(primeiroMes).toUpperCase()} DE{" "}
            {primeiroMes.slice(0, 4)}”: os itens dela são de um mês só. Em que meses do orçamento eles
            entram?
          </p>
          <OpcaoPlanejado
            grupo="opcao-meses"
            marcado={opcaoMeses === "todos"}
            onEscolher={() => onOpcaoMeses("todos")}
            titulo={`Repetir em ${listaDeMeses(semBloco.meses)}`}
            detalhe={`Os mesmos ${itensDaAba} ${itensDaAba === 1 ? "item" : "itens"} em cada mês — ${
              itensDaAba * semBloco.meses.length
            } no total. Depois, cada mês se ajusta na sua aba.`}
          />
          <OpcaoPlanejado
            grupo="opcao-meses"
            marcado={opcaoMeses === "primeiro"}
            onEscolher={() => onOpcaoMeses("primeiro")}
            titulo={`Só em ${nomeDoMes(primeiroMes)}`}
            detalhe={`${maiuscula(listaDeMeses(outrosMeses))} ${
              outrosMeses.length === 1 ? "fica vazio" : "ficam vazios"
            }, para preencher na tela — o “Copiar itens de outro mês” traz os de ${nomeDoMes(
              primeiroMes,
            )}. Mês sem item segura a aprovação.`}
          />
        </fieldset>
      )}

      {semBloco && semBloco.meses.length === 1 && (
        <p className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          <b className="text-foreground">A aba não tem título de mês.</b> Os itens entram em{" "}
          {nomeDoMes(semBloco.meses[0])}, o único mês deste orçamento.
        </p>
      )}

      {perguntar && (
        <fieldset className="space-y-2 rounded-xl border border-border p-4">
          <legend className="px-1 text-xs font-semibold text-foreground">Planejado</legend>
          <OpcaoPlanejado
            marcado={origemPlanejado === "planilha"}
            onEscolher={() => onOrigemPlanejado("planilha")}
            titulo="Usar o planejado da planilha"
            detalhe={
              p.planilha_tem_planejado
                ? mensal
                  ? "Os valores do bloco PLANEJADO da planilha — na planilha interna, pelas colunas do cabeçalho."
                  : "Os valores das colunas H · R$, I · QT e J · D/M."
                : "A planilha só tem o orçado: o planejado de todas as linhas fica zerado."
            }
          />
          <OpcaoPlanejado
            marcado={origemPlanejado === "anterior"}
            onEscolher={() => onOrigemPlanejado("anterior")}
            titulo={`Manter o planejado da v${p.versao_anterior}`}
            detalhe={`${p.casadas} de ${p.total_itens} ${
              p.total_itens === 1 ? "linha casada" : "linhas casadas"
            } com a v${p.versao_anterior}${
              p.por_descricao > 0 ? ` (${p.por_descricao} pela descrição, sem o id da exportação)` : ""
            }.${
              semPar > 0
                ? ` ${semPar === 1 ? "A outra entra zerada" : `As outras ${semPar} entram zeradas`}.`
                : ""
            }`}
          />
        </fieldset>
      )}

      {mostrarHonorarios &&
        (preview.percentual_honorarios !== null &&
        preview.percentual_honorarios !== preview.percentual_honorarios_cliente ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
            A planilha traz <b>{preview.percentual_honorarios.toString().replace(".", ",")}%</b> de
            honorários, mas a versão vai nascer com{" "}
            <b>{preview.percentual_honorarios_cliente.toString().replace(".", ",")}%</b> — o percentual do
            cadastro de {preview.cliente_nome}. Para usar outro, um administrador altera pelo
            &quot;Editar&quot; da versão depois de criada.
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
            Honorários da versão:{" "}
            <b className="text-foreground">
              {preview.percentual_honorarios_cliente.toString().replace(".", ",")}%
            </b>{" "}
            — do cadastro de {preview.cliente_nome}.
          </div>
        ))}

      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full table-fixed">
          <colgroup>
            <col />
            <col style={{ width: 48 }} />
            <col style={{ width: 116 }} />
            <col style={{ width: 116 }} />
            <col style={{ width: 112 }} />
            <col style={{ width: 60 }} />
          </colgroup>
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className={cn(TH, "whitespace-nowrap px-4 text-left")}>
                {perguntaMeses && !opcaoMeses ? "Grupos da aba · um mês" : "Grupos que serão criados"}
              </th>
              <th className={cn(TH, "pr-3 text-right")}>Itens</th>
              <th className={cn(TH, "pr-3 text-right", ORCADO.texto)}>Orçado</th>
              <th className={cn(TH, "pr-3 text-right", PLANEJADO.texto)}>Planejado</th>
              <th className={cn(TH, "pr-3 text-right", RENTAB_VALOR)}>Rentab.</th>
              <th className={cn(TH, "pr-4 text-right", RENTAB_VALOR)}>%</th>
            </tr>
          </thead>
          <tbody>
            {preview.grupos.map((g) => {
              const plan = planejadoDoGrupo(g);
              return (
                <tr key={`${g.ordem}-${g.nome}`} className="border-t border-border text-sm">
                  <td className="truncate px-4 py-2.5 font-medium text-foreground" title={g.nome}>
                    {g.nome}
                  </td>
                  <td className="py-2.5 pr-3 text-right text-xs tabular-nums text-muted-foreground">
                    {g.itens_count}
                  </td>
                  <td className={cn("py-2.5 pr-3 text-right font-mono text-xs", ORCADO.texto)}>
                    {formatCurrency(g.total_bruto, "BRL")}
                  </td>
                  <td className={cn("py-2.5 pr-3 text-right font-mono text-xs", plan > 0 ? PLANEJADO.texto : "text-muted-foreground/60")}>
                    {plan > 0 ? formatCurrency(plan, "BRL") : "—"}
                  </td>
                  <td className={cn("py-2.5 pr-3 text-right font-mono text-xs", plan > 0 ? RENTAB_VALOR : "text-muted-foreground/60")}>
                    {plan > 0 ? formatCurrency(g.total_bruto - plan, "BRL") : "—"}
                  </td>
                  <td className={cn("py-2.5 pr-4 text-right font-mono text-xs", RENTAB_VALOR)}>
                    {porcento(g.total_bruto, plan)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-muted/20 text-sm font-semibold">
              <td className="px-4 py-3 text-foreground">
                Total · {preview.grupos.length} {preview.grupos.length === 1 ? "grupo" : "grupos"}
              </td>
              <td className="py-3 pr-3 text-right text-xs tabular-nums">{totalItens}</td>
              <td className={cn("py-3 pr-3 text-right font-mono text-[13px]", ORCADO.texto)}>
                {formatCurrency(totalOrcado, "BRL")}
              </td>
              <td className={cn("py-3 pr-3 text-right font-mono text-[13px]", totalPlanejado > 0 ? PLANEJADO.texto : "text-muted-foreground/60")}>
                {totalPlanejado > 0 ? formatCurrency(totalPlanejado, "BRL") : "—"}
              </td>
              <td className={cn("py-3 pr-3 text-right font-mono text-[13px]", totalPlanejado > 0 ? RENTAB_VALOR : "text-muted-foreground/60")}>
                {totalPlanejado > 0 ? formatCurrency(totalOrcado - totalPlanejado, "BRL") : "—"}
              </td>
              <td className={cn("py-3 pr-4 text-right font-mono text-[13px]", RENTAB_VALOR)}>
                {porcento(totalOrcado, totalPlanejado)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {(ajustes > 0 || ignoradas > 0) && (
        <div className="overflow-hidden rounded-xl border border-amber-200 bg-amber-50">
          <div className="flex items-center gap-2 border-b border-amber-200 px-4 py-2 text-xs font-semibold text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5" />
            {ajustes} {ajustes === 1 ? "ajuste" : "ajustes"}
            {ignoradas > 0 && (
              <>
                {" · "}
                {ignoradas} {ignoradas === 1 ? "linha ignorada" : "linhas ignoradas"}
              </>
            )}
          </div>
          <ul className="max-h-52 divide-y divide-amber-200/70 overflow-y-auto">
            {preview.warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-2 px-4 py-2 text-xs text-amber-900">
                <Badge
                  className={
                    w.severidade === "ignorada"
                      ? "border-amber-300 bg-amber-200 text-amber-900"
                      : "border-amber-200 bg-amber-100 text-amber-800"
                  }
                >
                  L{w.linha}
                  {w.coluna ? `·${w.coluna}` : ""}
                </Badge>
                <span className="flex-1">{w.motivo}</span>
              </li>
            ))}
            {ajustes + ignoradas > preview.warnings.length && (
              <li className="px-4 py-2 text-xs text-amber-800/70">
                + {ajustes + ignoradas - preview.warnings.length} outros avisos omitidos.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function maiuscula(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
