/**
 * Bloco "Impostos desta nota" do Faturar (módulo fiscal, entrega 1 —
 * 02/10/2026; protótipo aprovado pelo Tiago). Só leitura: os impostos que a
 * nota gera, com alíquota, valor e vencimento, refeitos a cada troca de
 * CNPJ emissor, CNAE, valor, deduções ou data de emissão.
 *
 * Lucro Real (California e GoCrazy): ISS, PIS e COFINS nascem na emissão.
 * Lucro Presumido pelo caixa (Hitlab): só o ISS nasce na emissão; PIS,
 * COFINS, IRPJ e CSLL nascem no recebimento.
 *
 * Decisão 256 (15/11/2026):
 * - o quadro aparece desde a abertura do Faturar, zerado, e diz o que falta;
 * - as deduções (o repasse, custo AR) saem só da base do ISS — PIS e COFINS
 *   ficam sobre o total (o portal da NFS-e só destrincha o ISS);
 * - CBS e IBS (reforma tributária, fase de teste) sobre o líquido (total −
 *   ISS − PIS − COFINS), com as alíquotas do cadastro: registro, sem guia;
 * - as retenções que o cliente faz, quando o Faturar já as sabe.
 */
import * as React from "react";
import { Info, Landmark } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { FiscalCnae } from "@/lib/types";
import { cnaeDoCalculo } from "@/lib/fiscal/cadastro";
import {
  codigoDoCnae,
  impostosDaNotaComDeducoes,
  reformaDaNota,
  type EstabelecimentoDoCalculo,
} from "@/lib/fiscal/calculos";
import { dataBr, mesDe, nomeDoMes, r2, type FeriadoDoVencimento, type Vencimento } from "@/lib/fiscal/datas";
import { mesesDasCotas, textoDoRegime, textoDoTrimestre } from "@/lib/fiscal/faturar";

const moeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`;
const emDiaNaoUtil = (regra: EstabelecimentoDoCalculo["iss_regra"]) =>
  `em dia não útil, ${regra === "prorroga" ? "prorroga" : "antecipa"}`;

/** Uma retenção que o cliente faz na fonte, já com base e valor. */
export interface RetencaoDaNota {
  imposto: string;
  aliquota: number;
  base: number;
  valor: number;
}

interface LinhaDoImposto {
  imposto: string;
  como: string;
  /** "" enquanto o quadro não tem como calcular; "—" sem alíquota no CNAE. */
  aliquota: string;
  base: number;
  valor: number;
  vence: Vencimento | null;
  regra: string;
}

export function ImpostosDestaNota({
  estab,
  nomeDaPJ,
  cnae,
  valor,
  emissao,
  feriados,
  diaPisCofins,
  deducoes,
  retencoes,
  aliquotasReforma,
  faltam,
}: {
  /** O CNPJ emissor com o regime da PJ na data (`estabelecimentoDoCalculo`);
   *  nulo enquanto não escolhido. */
  estab: EstabelecimentoDoCalculo | null;
  /** Nome curto da PJ do CNPJ ("California"); nulo sem CNPJ emissor. */
  nomeDaPJ: string | null;
  cnae: FiscalCnae | null;
  valor: number;
  emissao: string | null;
  feriados: readonly FeriadoDoVencimento[];
  diaPisCofins: number;
  /** O repasse (custo AR) que sai da base do ISS. */
  deducoes: number;
  /** As retenções do cliente na fonte, quando o Faturar já as sabe. */
  retencoes: RetencaoDaNota[];
  /** As alíquotas de CBS e IBS vigentes na emissão (cadastro de impostos). */
  aliquotasReforma: { cbs: number; ibs: number };
  /** O que ainda falta no formulário para calcular os impostos. */
  faltam: string[];
}) {
  const baseIss = r2(Math.max(0, valor - deducoes));
  const completo = Boolean(estab && cnae && emissao) && valor > 0;
  const imp =
    completo && estab && cnae && emissao
      ? impostosDaNotaComDeducoes(estab, cnaeDoCalculo(cnae), valor, deducoes, emissao, feriados, diaPisCofins)
      : null;
  const nomeDaCompetencia = imp?.nomeDaCompetencia ?? (emissao ? nomeDoMes(mesDe(emissao)) : null);
  const valorDe = (nome: string) => imp?.impostos.find((i) => i.imposto === nome)?.valor ?? 0;
  const reforma = imp
    ? reformaDaNota(valor, { iss: valorDe("ISS"), pis: valorDe("PIS"), cofins: valorDe("COFINS") }, aliquotasReforma)
    : { liquido: 0, cbs: 0, ibs: 0 };
  const retido = (nome: string) => retencoes.find((r) => r.imposto === nome)?.valor ?? 0;
  const totalRetido = r2(retencoes.reduce((t, r) => t + r.valor, 0));
  const issDaGuia = r2(Math.max(0, valorDe("ISS") - retido("ISS")));
  const federaisRetidos = retencoes.filter((r) => r.imposto !== "ISS");
  const real = estab?.regime === "lucro_real";
  // PIS/COFINS reduzidos do CNAE (o subitem 12.08) no Lucro Real. Na PJ do
  // presumido tudo é cumulativo pelo regime, e o aviso não se aplica.
  const reduzido = real && Boolean(cnae?.cumulativo);

  const linhas: LinhaDoImposto[] = !imp
    ? (["ISS", "PIS", "COFINS"] as const).map((nome) => ({
        imposto: nome,
        como:
          nome === "ISS"
            ? estab
              ? `Guia municipal de ${estab.municipio}`
              : "Guia municipal do CNPJ emissor"
            : nomeDaPJ
              ? `DARF da ${nomeDaPJ} pela matriz`
              : "DARF da PJ do CNPJ emissor",
        aliquota: "",
        base: nome === "ISS" ? baseIss : valor,
        valor: 0,
        vence: null,
        regra: "",
      }))
    : [
        (() => {
          const iss = imp.impostos.find((i) => i.imposto === "ISS");
          return iss && estab
            ? {
                imposto: "ISS",
                como: `Guia municipal de ${estab.municipio}`,
                aliquota: pct(iss.aliquota),
                base: imp.baseIss,
                valor: iss.valor,
                vence: iss.vencimento,
                regra: `dia ${estab.iss_dia} do mês seguinte · ${emDiaNaoUtil(estab.iss_regra)}`,
              }
            : {
                imposto: "ISS",
                como: "Sem alíquota de ISS para este CNAE",
                aliquota: "—",
                base: imp.baseIss,
                valor: 0,
                vence: null,
                regra: "",
              };
        })(),
        // Pelo caixa, PIS e COFINS só nascem no recebimento: ficam no aviso.
        ...(imp.pelaCaixa
          ? []
          : imp.impostos
              .filter((i) => i.imposto !== "ISS")
              .map((i) => ({
                imposto: i.imposto,
                como: `DARF da ${nomeDaPJ} pela matriz`,
                aliquota: pct(i.aliquota),
                base: valor,
                valor: i.valor,
                vence: i.vencimento,
                regra: `dia ${diaPisCofins} do mês seguinte · ${emDiaNaoUtil("antecipa")}`,
              }))),
      ];

  const textoDoVaiProFiscal = !imp || !estab
    ? "ISS R$ 0,00 · PIS R$ 0,00 · COFINS R$ 0,00"
    : [
        retido("ISS") > 0.004
          ? `ISS ${moeda(issDaGuia)} (${estab.municipio}; ${moeda(retido("ISS"))} retidos pelo cliente, que recolhe)`
          : `ISS ${moeda(valorDe("ISS"))} (${estab.municipio})`,
        ...(imp.pelaCaixa ? [] : [`PIS ${moeda(valorDe("PIS"))}`, `COFINS ${moeda(valorDe("COFINS"))}`]),
      ].join(" · ") + (imp.pelaCaixa ? " · PIS e COFINS no recebimento" : "");

  // Decisão 260: o quadro só com os números; as contas, as guias e as
  // explicações ficam no ⓘ, ao passar o mouse.
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-4">
      <div className="mb-2 flex items-center gap-2">
        <Landmark className="h-3.5 w-3.5 shrink-0 text-california-red" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Impostos desta nota</span>
        <span className="ml-auto text-[11.5px] font-semibold text-foreground">{nomeDaCompetencia ?? "—"}</span>
        <Dica>
          <p>Competência {nomeDaCompetencia ?? "—"}: o mês da emissão.</p>
          {estab && (
            <p>
              {nomeDaPJ} · {textoDoRegime(estab.regime, estab.regime_caixa)}
            </p>
          )}
        </Dica>
      </div>
      {/* A conta do emissor: o total menos as deduções é a base do ISS. */}
      <div className="mb-2 divide-y divide-border overflow-hidden rounded-lg border border-border bg-white text-[12px]">
        {(
          [
            ["Valor total da nota", valor, ""],
            ["(−) Deduções (repasse)", deducoes, ""],
            ["= Base do ISS", baseIss, "font-bold"],
          ] as const
        ).map(([rotulo, v, peso]) => (
          <div key={rotulo} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{rotulo}</span>
            <span className={`font-mono tabular-nums text-foreground ${peso}`}>{moeda(v)}</span>
          </div>
        ))}
      </div>
      <div className="divide-y divide-border/60 text-[12.5px]">
        {linhas.map((l) => (
          <div key={l.imposto} className="flex items-center gap-2 py-1.5">
            <span className="w-14 shrink-0 font-semibold">{l.imposto}</span>
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground">
              {[l.aliquota && l.aliquota !== "—" ? l.aliquota : null, l.vence ? `vence ${dataBr(l.vence.data).slice(0, 5)}` : null]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <span className="shrink-0 font-mono font-semibold tabular-nums">{moeda(l.valor)}</span>
            <Dica>
              <p>{l.aliquota === "—" ? "Sem alíquota" : `${moeda(l.base)} × ${l.aliquota === "" ? "—" : l.aliquota}`}</p>
              <p>
                {l.como}
                {l.vence ? ` · vence ${dataBr(l.vence.data)} (${l.vence.motivo ?? l.regra})` : ""}
              </p>
            </Dica>
          </div>
        ))}
      </div>
      {!completo && faltam.length > 0 && (
        <p className="mt-1 text-[11.5px] text-muted-foreground">
          Falta: <span className="font-semibold text-foreground">{faltam.join(" · ")}</span>
        </p>
      )}
      <div className="mt-1.5 space-y-1 border-t border-border pt-2 text-[12px]">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Valor líquido</span>
          <Dica>
            <p>Total − ISS − PIS − COFINS. É a base de CBS e IBS.</p>
          </Dica>
          <span className="ml-auto font-mono font-semibold tabular-nums">{moeda(reforma.liquido)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">CBS {pct(aliquotasReforma.cbs)}</span>
          <Dica>
            <p>Reforma tributária, ainda não vigente: CBS e IBS ficam registrados na nota, sem guia.</p>
            <p>
              CBS {moeda(reforma.liquido)} × {pct(aliquotasReforma.cbs)} = {moeda(reforma.cbs)} · IBS {moeda(reforma.liquido)} ×{" "}
              {pct(aliquotasReforma.ibs)} = {moeda(reforma.ibs)}
            </p>
          </Dica>
          <span className="ml-auto font-mono tabular-nums">{moeda(reforma.cbs)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">IBS {pct(aliquotasReforma.ibs)}</span>
          <span className="ml-auto font-mono tabular-nums">{moeda(reforma.ibs)}</span>
        </div>
        {totalRetido > 0.004 && (
          <>
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Retido pelo cliente</span>
              <Dica>
                {retencoes.map((r) => (
                  <p key={r.imposto}>
                    {r.imposto}: {moeda(r.base)} × {pct(r.aliquota)} = {moeda(r.valor)}
                  </p>
                ))}
              </Dica>
              <span className="ml-auto font-mono tabular-nums">{moeda(totalRetido)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Líquido a receber</span>
              <span className="ml-auto font-mono font-semibold tabular-nums">{moeda(r2(valor - totalRetido))}</span>
            </div>
          </>
        )}
      </div>
      {reduzido && cnae && (
        <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[12px] text-amber-900">
          <span>PIS e COFINS reduzidos, sem crédito</span>
          <Dica>
            <p>
              {cnae.subitem ? `Subitem ${cnae.subitem}` : `CNAE ${codigoDoCnae(cnae)}`}: PIS {pct(cnae.aliquota_pis)} e COFINS{" "}
              {pct(cnae.aliquota_cofins)}, sem crédito sobre os custos. Se custos deste job já deram crédito, ele é estornado na
              apuração de {nomeDaCompetencia}.
            </p>
          </Dica>
        </div>
      )}
      <div className="mt-2 flex items-center gap-1.5 border-t border-border pt-2 text-[12px] text-muted-foreground">
        <span>Vai para a Apuração de {nomeDaCompetencia ?? "—"}</span>
        <Dica>
          <p>{textoDoVaiProFiscal}. CBS e IBS ficam registrados na nota, sem guia.</p>
          {federaisRetidos.length > 0 && (
            <p>
              Retenções sofridas ({federaisRetidos.map((r) => `${r.imposto} ${moeda(r.valor)}`).join(" · ")}) ficam registradas para
              abater na apuração.
            </p>
          )}
          {real && emissao && (
            <p>
              IRPJ e CSLL: a nota entra no lucro bruto do {textoDoTrimestre(emissao)}; cotas em {mesesDasCotas(emissao)}.
            </p>
          )}
          {real && !reduzido && <p>Os créditos de PIS/COFINS sobre os custos do job entram pelo mês da NF de cada fornecedor.</p>}
          {imp?.pelaCaixa && <p>PIS, COFINS, IRPJ e CSLL nascem quando o cliente pagar (regime de caixa).</p>}
        </Dica>
      </div>
    </div>
  );
}

/** O ⓘ com o texto longo, ao passar o mouse (decisão 260). */
function Dica({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label="Mais informações" className="inline-flex shrink-0 text-muted-foreground hover:text-foreground">
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-[320px] space-y-1 text-[11.5px] leading-snug">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}
