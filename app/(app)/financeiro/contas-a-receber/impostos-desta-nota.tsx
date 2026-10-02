/**
 * Bloco "Impostos desta nota" do Faturar (módulo fiscal, entrega 1 —
 * 02/10/2026; protótipo aprovado pelo Tiago). Só leitura: os impostos que a
 * nota gera, com alíquota, valor e vencimento, refeitos a cada troca de
 * CNPJ emissor, CNAE, valor ou data de emissão (`impostosDaNota`).
 *
 * Lucro Real (California e GoCrazy): ISS, PIS e COFINS nascem na emissão.
 * Lucro Presumido pelo caixa (Hitlab): só o ISS nasce na emissão; PIS,
 * COFINS, IRPJ e CSLL nascem no recebimento.
 */
import { Landmark } from "lucide-react";
import type { FiscalCnae } from "@/lib/types";
import { cnaeDoCalculo } from "@/lib/fiscal/cadastro";
import {
  codigoDoCnae,
  impostosDaNota,
  type EstabelecimentoDoCalculo,
} from "@/lib/fiscal/calculos";
import { dataBr, type FeriadoDoVencimento, type Vencimento } from "@/lib/fiscal/datas";
import { mesesDasCotas, textoDoRegime, textoDoTrimestre } from "@/lib/fiscal/faturar";

const moeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`;
const emDiaNaoUtil = (regra: EstabelecimentoDoCalculo["iss_regra"]) =>
  `em dia não útil, ${regra === "prorroga" ? "prorroga" : "antecipa"}`;

interface LinhaDoImposto {
  imposto: string;
  como: string;
  aliquota: string;
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
}: {
  /** O CNPJ emissor com o regime da PJ na data (`estabelecimentoDoCalculo`). */
  estab: EstabelecimentoDoCalculo;
  /** Nome curto da PJ do CNPJ ("California"). */
  nomeDaPJ: string;
  cnae: FiscalCnae;
  valor: number;
  emissao: string;
  feriados: readonly FeriadoDoVencimento[];
  diaPisCofins: number;
}) {
  const imp = impostosDaNota(estab, cnaeDoCalculo(cnae), valor, emissao, feriados, diaPisCofins);
  const real = estab.regime === "lucro_real";
  // PIS/COFINS reduzidos do CNAE (o subitem 12.08) no Lucro Real. Na PJ do
  // presumido tudo é cumulativo pelo regime, e o aviso não se aplica.
  const reduzido = real && cnae.cumulativo;
  const iss = imp.impostos.find((i) => i.imposto === "ISS");
  const linhas: LinhaDoImposto[] = [
    iss
      ? {
          imposto: "ISS",
          como: `Guia municipal de ${estab.municipio}`,
          aliquota: pct(iss.aliquota),
          valor: iss.valor,
          vence: iss.vencimento,
          regra: `dia ${estab.iss_dia} do mês seguinte · ${emDiaNaoUtil(estab.iss_regra)}`,
        }
      : {
          imposto: "ISS",
          como: "Sem alíquota de ISS para este CNAE",
          aliquota: "—",
          valor: 0,
          vence: null,
          regra: "",
        },
    // Pelo caixa, PIS e COFINS só nascem no recebimento: ficam no aviso.
    ...(imp.pelaCaixa
      ? []
      : imp.impostos
          .filter((i) => i.imposto !== "ISS")
          .map((i) => ({
            imposto: i.imposto,
            como: `DARF da ${nomeDaPJ} pela matriz`,
            aliquota: pct(i.aliquota),
            valor: i.valor,
            vence: i.vencimento,
            regra: `dia ${diaPisCofins} do mês seguinte · ${emDiaNaoUtil("antecipa")}`,
          }))),
  ];

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <Landmark className="h-3.5 w-3.5 shrink-0 text-california-red" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Impostos desta nota
        </span>
        <span className="ml-auto text-[11.5px] text-muted-foreground">
          {nomeDaPJ} · {textoDoRegime(estab.regime, estab.regime_caixa)}
        </span>
      </div>
      <table className="w-full table-fixed text-[12.5px]">
        <colgroup>
          <col className="w-[36%]" />
          <col className="w-[13%]" />
          <col className="w-[19%]" />
          <col className="w-[32%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="pb-1.5 font-bold">Imposto</th>
            <th className="pb-1.5 text-right font-bold">Alíquota</th>
            <th className="pb-1.5 text-right font-bold">Valor</th>
            <th className="pb-1.5 pl-4 font-bold">Vence</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.imposto} className="border-b border-border/60 align-top last:border-0">
              <td className="py-2 pr-2">
                <span className="font-semibold">{l.imposto}</span>
                <span className="block text-[11px] leading-snug text-muted-foreground">{l.como}</span>
              </td>
              <td className="py-2 text-right font-mono tabular-nums">{l.aliquota}</td>
              <td className="py-2 text-right font-mono font-semibold tabular-nums">{moeda(l.valor)}</td>
              <td className="py-2 pl-4">
                {l.vence ? (
                  <>
                    <span className="font-mono tabular-nums">{dataBr(l.vence.data)}</span>
                    <span className="block text-[11px] leading-snug text-muted-foreground">
                      {l.vence.motivo ?? l.regra}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2.5 space-y-1.5 border-t border-border pt-2.5 text-[12px] leading-relaxed text-muted-foreground">
        {real && (
          <p>
            <span className="font-semibold text-foreground">IRPJ e CSLL:</span> a nota entra no lucro
            bruto do {textoDoTrimestre(emissao)}; cotas em {mesesDasCotas(emissao)}.
          </p>
        )}
        {real && !reduzido && (
          <p>Os créditos de PIS/COFINS sobre os custos do job entram pelo mês da NF de cada fornecedor.</p>
        )}
        {reduzido && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
            {cnae.subitem ? `Subitem ${cnae.subitem}` : `CNAE ${codigoDoCnae(cnae)}`}: PIS{" "}
            {pct(cnae.aliquota_pis)} e COFINS {pct(cnae.aliquota_cofins)}, sem crédito sobre os
            custos. Se custos deste job já deram crédito, ele é estornado na apuração de{" "}
            {imp.nomeDaCompetencia}.
          </p>
        )}
        {imp.pelaCaixa && (
          <p>PIS, COFINS, IRPJ e CSLL nascem quando o cliente pagar (regime de caixa).</p>
        )}
        <p>Retenções do cliente continuam na baixa do título, como hoje.</p>
      </div>
    </div>
  );
}

/** A caixa tracejada que fica no lugar do bloco até o formulário ter o que ele precisa. */
export function ImpostosDestaNotaVazio() {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-3 text-[12px] text-muted-foreground">
      <Landmark className="h-3.5 w-3.5 shrink-0" />
      <span className="text-[11px] font-bold uppercase tracking-wider">Impostos desta nota</span>
      <span className="basis-full text-pretty">
        Aparecem aqui quando o CNPJ emissor, o CNAE, o valor e a data de emissão estiverem
        preenchidos.
      </span>
    </div>
  );
}
