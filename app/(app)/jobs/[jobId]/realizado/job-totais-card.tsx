import { Calculator } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import {
  calcularTotaisVersao,
  calcularRentabilidade,
  LINHAS_FECHAMENTO_POR_TIPO,
  somarLinhaFechamento,
} from "@/lib/calculos/versao-totais";
import {
  agregarRentabilidadePorProjeto,
  type JobParaAgregar,
} from "@/lib/calculos/projeto-totais";
import { PainelResultado } from "@/components/painel-resultado";
import { LegendaFechamento } from "@/components/legenda-fechamento";
import {
  type VersaoOrcamentoGrupo,
  type ItemPlanilhaJob,
  type ItemBv,
  type JobItemRealizado,
} from "@/lib/types";
import {
  blocosDoItem,
  rotuloColunaTotal,
  somarBlocosDosItens,
  valorNaVisao,
  type VisaoBv,
} from "@/lib/calculos/bv-planilha";
import { SubLinhaBv } from "@/app/(app)/_planilha/chave-bruto-liquido";
import {
  ColunasJob,
  LARGURA_MINIMA_JOB,
  LARGURA_MINIMA_JOB_SAVE,
} from "@/app/(app)/_planilha/grade-job";
import {
  ORCADO,
  PLANEJADO,
  REALIZADO,
  FAIXA_ROTULO,
  RENTAB_VALOR,
} from "@/app/(app)/_planilha/blocos";

interface Props {
  grupos: VersaoOrcamentoGrupo[];
  itens: ItemPlanilhaJob[];
  realizadosMap: Map<string, JobItemRealizado>;
  /** BV por id do item da versão — a dedução da vista Líquido e a linha
   *  "+ BVs" do painel Resultado saem daqui. */
  bvsPorItem: Record<string, ItemBv>;
  /** Bruto ou Líquido (− BV). Vem de `JobRealizadoSection`: o Totais tem
   *  que estar sempre no mesmo modo que os grupos acima dele. */
  visao: VisaoBv;
  /** Job já aberto pelo financeiro. Falso zera o REALIZADO — inclusive o
   *  dos tipos `A` e `D`, que fora isso espelhariam o orçado. */
  jobAberto: boolean;
  percentualHonorarios: number;
  percentualImposto: number;
  moeda: string;
  /** A coluna de Save está aberta na planilha acima? O card não ganha a
   *  coluna, mas precisa do MESMO piso de largura para as colunas de
   *  Total caírem no mesmo eixo. */
  saveVisivel?: boolean;
}

function formatarPercentual(p: number): string {
  return `${p.toFixed(1).replace(".", ",")}%`;
}

/** Taxa configurada na versão: 12 -> "12%", 19.53 -> "19,53%". */
function formatarTaxa(p: number): string {
  return `${String(p).replace(".", ",")}%`;
}

/** Linha "rótulo ......... valor" dos painéis de fechamento e resultado. */
function LinhaValor({
  rotulo,
  valor,
  destaque,
}: {
  rotulo: React.ReactNode;
  valor: React.ReactNode;
  destaque?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span
        className={cn(
          "text-sm",
          destaque ? "font-semibold text-foreground" : "text-muted-foreground",
        )}
      >
        {rotulo}
      </span>
      <span
        className={cn(
          "whitespace-nowrap font-mono text-sm",
          destaque && "font-semibold",
        )}
      >
        {valor}
      </span>
    </div>
  );
}

/** Célula "R$ x,xx / y,y%" das linhas de Rentabilidade do rodapé. */
function CelulaRentabilidade({
  orcado,
  custo,
  moeda,
  corValor,
  corPercentual,
}: {
  orcado: number;
  custo: number;
  moeda: string;
  corValor: string;
  corPercentual: string;
}) {
  const { rentabilidade, percentual } = calcularRentabilidade(orcado, custo);

  if (custo <= 0) {
    return <span className="font-mono text-sm text-muted-foreground">—</span>;
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className={cn("font-mono text-[13px] font-bold", corValor)}>
        {formatCurrency(rentabilidade, moeda)}
      </span>
      {percentual !== null && (
        <span className={cn("font-mono text-[10.5px]", corPercentual)}>
          {formatarPercentual(percentual)}
        </span>
      )}
    </div>
  );
}

export function JobTotaisCard({
  grupos,
  itens,
  realizadosMap,
  bvsPorItem,
  visao,
  jobAberto,
  percentualHonorarios,
  percentualImposto,
  moeda,
  saveVisivel = false,
}: Props) {
  const {
    subtotaisPorTipo,
    subtotalGeral,
    honorarios,
    imposto,
    faturamentoPrevisto,
    valorJob,
    save,
    faturamento,
    job,
  } = calcularTotaisVersao(itens, percentualHonorarios, percentualImposto);

  // Com save, o fechamento abre em três colunas — o mesmo bloco da tela da
  // versão do orçamento. Sem ele os dois totais de baixo divergiriam sem
  // explicação nenhuma nesta tela (decisão 023 §3).
  const temSave = save.totalSaveGerado > 0 || save.totalSaveUsado > 0;

  // Planejado e realizado passam pelos blocos com BV: o número que o card
  // mostra tem que ser o MESMO que os grupos acima somaram, e a única
  // forma de garantir isso é a conta ser a mesma função.
  const blocosPorItem = new Map(
    itens.map((it) => [
      it.id,
      blocosDoItem(
        it,
        bvsPorItem[it.id] ?? null,
        Number(realizadosMap.get(it.id)?.total_realizado ?? 0),
        percentualImposto,
        jobAberto,
      ),
    ]),
  );
  const totais = somarBlocosDosItens([...blocosPorItem.values()]);

  const totalPlanejado = valorNaVisao(totais.planejado, visao);
  const totalRealizado = valorNaVisao(totais.realizado, visao);

  // Agrupamentos por grupo — reusa a mesma funcao usada na pagina de projeto,
  // garantindo que visao individual e visao agregada calculam da mesma forma.
  const jobParaAgregar: JobParaAgregar = {
    grupos: grupos.map((g) => ({
      id: g.id,
      nome: g.nome,
      created_at: g.created_at,
    })),
    // Os totais entregues ao agregador já vêm na VISTA ativa: o
    // agrupamento do card não pode contar um BV que a linha da planilha
    // acabou de descontar.
    itens: itens.map((i) => {
      const b = blocosPorItem.get(i.id);
      return {
        id: i.id,
        grupo_id: i.grupo_id,
        total_orcado: b?.orcado ?? 0,
        // A linha em save fica fora da comparação orçado × custo, mas
        // continua cheia na coluna ORÇADO (decisão 023 §9).
        orcado_rentabilidade: b?.orcadoRentabilidade ?? 0,
        total_planejado: b ? valorNaVisao(b.planejado, visao) : 0,
      };
    }),
    realizadosPorItemId: new Map(
      itens.map((i) => [
        i.id,
        {
          total_realizado: blocosPorItem.get(i.id)
            ? valorNaVisao(blocosPorItem.get(i.id)!.realizado, visao)
            : 0,
        },
      ]),
    ),
  };
  const { linhas: linhasAgregadas } = agregarRentabilidadePorProjeto(
    [jobParaAgregar],
    "primeiroEncontro",
  );
  const linhas = linhasAgregadas.map((l) => ({
    id: l.chaveNormalizada,
    nome: l.nomeExibicao,
    orcado: l.orcado,
    planejado: l.planejado,
    realizado: l.realizado,
  }));

  // Sem realizado lancado o rodape mostra travessao em vez de zero — a conta
  // do resultado em si mora no PainelResultado.
  const temRealizado = totalRealizado > 0;

  return (
    <div className="rounded-2xl border border-border bg-card shadow-soft">
      <div className="flex items-center gap-3 border-b border-border p-6">
        <Calculator className="h-5 w-5 text-california-red" />
        <div>
          <h2 className="text-lg font-semibold leading-none tracking-tight">
            Totais
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Orçado × Planejado × Realizado · valores calculados a partir dos
            itens.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        {/* Mesma grade dos cards de agrupamento acima: as colunas Total
            de Orçado, Planejado e Realizado caem exatamente sob as de lá. */}
        <table
          className={cn(
            "w-full table-fixed border-collapse text-sm",
            saveVisivel ? LARGURA_MINIMA_JOB_SAVE : LARGURA_MINIMA_JOB,
          )}
        >
          <ColunasJob />
          <thead>
            <tr>
              <th colSpan={3} className="bg-muted/40 border-b border-border" />
              <th colSpan={4} className={cn(FAIXA_ROTULO, ORCADO.faixa)}>
                ORÇADO
              </th>
              <th colSpan={4} className={cn(FAIXA_ROTULO, PLANEJADO.faixa)}>
                PLANEJADO
              </th>
              <th colSpan={4} className={cn(FAIXA_ROTULO, REALIZADO.faixa)}>
                REALIZADO
              </th>
            </tr>
            <tr className="bg-muted/40">
              <th
                colSpan={3}
                className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Agrupamento
              </th>
              <th colSpan={3} className={ORCADO.cabecalhoAbre} />
              <th
                className={cn(
                  "text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-wider",
                  ORCADO.cabecalhoFim,
                )}
              >
                Total
              </th>
              <th colSpan={3} className={PLANEJADO.cabecalhoAbre} />
              <th
                className={cn(
                  "text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-wider",
                  PLANEJADO.cabecalhoFim,
                )}
              >
                {rotuloColunaTotal(visao)}
              </th>
              <th colSpan={3} className={REALIZADO.cabecalhoAbre} />
              <th
                className={cn(
                  "text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-wider",
                  REALIZADO.cabecalhoFim,
                )}
              >
                {rotuloColunaTotal(visao)}
              </th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.id} className="border-b border-border">
                <td colSpan={3} className="px-3 py-3 text-sm">
                  {l.nome}
                </td>
                <td colSpan={3} className={ORCADO.celulaVazia} />
                <td
                  className={cn(
                    "px-3 py-3 text-right whitespace-nowrap font-mono text-[13px]",
                    ORCADO.celulaTotal,
                  )}
                >
                  {formatCurrency(l.orcado, moeda)}
                </td>
                <td colSpan={3} className={PLANEJADO.celulaVazia} />
                <td
                  className={cn(
                    "px-3 py-3 text-right whitespace-nowrap font-mono text-[13px]",
                    PLANEJADO.celulaTotal,
                  )}
                >
                  {l.planejado > 0 ? formatCurrency(l.planejado, moeda) : "—"}
                </td>
                <td colSpan={3} className={REALIZADO.celulaVazia} />
                <td
                  className={cn(
                    "px-3 py-3 text-right whitespace-nowrap font-mono text-[13px]",
                    REALIZADO.celulaTotal,
                  )}
                >
                  {l.realizado > 0 ? formatCurrency(l.realizado, moeda) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td
                colSpan={3}
                className="px-3 py-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-t border-t-border"
              >
                Total dos custos
              </td>
              <td colSpan={3} className={ORCADO.subtotalVazio} />
              <td className={cn("px-3 py-3 text-right whitespace-nowrap font-mono text-[13px] font-bold", ORCADO.subtotalValor)}>
                {formatCurrency(subtotalGeral, moeda)}
              </td>
              <td colSpan={3} className={PLANEJADO.subtotalVazio} />
              <td className={cn("px-3 py-3 text-right whitespace-nowrap", PLANEJADO.subtotalValor)}>
                <div className="flex flex-col items-end">
                  <span className="font-mono text-[13px] font-bold">
                    {totais.planejado.bruto > 0
                      ? formatCurrency(totalPlanejado, moeda)
                      : "—"}
                  </span>
                  {visao === "liquido" && (
                    <SubLinhaBv
                      deducao={totais.planejado.deducaoBv}
                      formatar={(v) => formatCurrency(v, moeda)}
                      cor={PLANEJADO.texto}
                      corRotulo={PLANEJADO.textoSuave}
                    />
                  )}
                </div>
              </td>
              <td colSpan={3} className={REALIZADO.subtotalVazio} />
              <td className={cn("px-3 py-3 text-right whitespace-nowrap", REALIZADO.subtotalValor)}>
                <div className="flex flex-col items-end">
                  <span className="font-mono text-[13px] font-bold">
                    {temRealizado ? formatCurrency(totalRealizado, moeda) : "—"}
                  </span>
                  {visao === "liquido" && (
                    <SubLinhaBv
                      deducao={totais.realizado.deducaoBv}
                      formatar={(v) => formatCurrency(v, moeda)}
                      cor={REALIZADO.texto}
                      corRotulo={REALIZADO.textoSuave}
                    />
                  )}
                </div>
              </td>
            </tr>
            <tr>
              <td
                colSpan={3}
                className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-t border-t-border"
              >
                Rentabilidade
              </td>
              <td colSpan={4} className={cn("border-t border-t-[#dfeafb]", ORCADO.celulaVazia)} />
              <td colSpan={3} className={cn("border-t border-t-[#dcf5e8]", PLANEJADO.celulaVazia)} />
              <td className={cn("px-3 py-2.5 text-right whitespace-nowrap border-t border-t-[#dcf5e8]", PLANEJADO.celulaTotal)}>
                <CelulaRentabilidade
                  orcado={totais.orcadoRentabilidade}
                  custo={totalPlanejado}
                  moeda={moeda}
                  corValor={RENTAB_VALOR}
                  corPercentual={RENTAB_VALOR}
                />
              </td>
              <td colSpan={3} className={cn("border-t border-t-[#fbd8b8]", REALIZADO.celulaVazia)} />
              <td className={cn("px-3 py-2.5 text-right whitespace-nowrap border-t border-t-[#fbd8b8]", REALIZADO.celulaTotal)}>
                <CelulaRentabilidade
                  orcado={totais.orcadoRentabilidade}
                  custo={totalRealizado}
                  moeda={moeda}
                  corValor={RENTAB_VALOR}
                  corPercentual={RENTAB_VALOR}
                />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="grid grid-cols-1 border-t border-border md:grid-cols-2">
        <div className="border-b border-border p-6 md:border-b-0 md:border-r">
          <p className="mb-3.5 text-[13px] font-bold uppercase tracking-wider">
            Fechamento do orçado · por tipo de custo
          </p>
          <div className="flex flex-col gap-1.5">
            {temSave && (
              <div className="grid grid-cols-[1fr_repeat(3,minmax(84px,auto))] gap-x-3 pb-1 text-right text-[9.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                <span />
                <span>Save usado</span>
                <span>Save gerado</span>
                <span>Custos do job</span>
              </div>
            )}
            {LINHAS_FECHAMENTO_POR_TIPO.map((linha) =>
              temSave ? (
                <LinhaQuebrada
                  key={linha.chave}
                  label={linha.label}
                  usado={somarLinhaFechamento(save.saveUsado, linha.tipos)}
                  gerado={somarLinhaFechamento(save.saveGerado, linha.tipos)}
                  custos={somarLinhaFechamento(save.custosDoJob, linha.tipos)}
                  moeda={moeda}
                />
              ) : (
                <LinhaValor
                  key={linha.chave}
                  rotulo={linha.label}
                  valor={formatCurrency(
                    somarLinhaFechamento(subtotaisPorTipo, linha.tipos),
                    moeda,
                  )}
                />
              ),
            )}
            {temSave ? (
              <LinhaQuebrada
                label="Total dos custos"
                usado={save.totalSaveUsado}
                gerado={save.totalSaveGerado}
                custos={save.totalCustosDoJob}
                moeda={moeda}
                destaque
              />
            ) : (
              <div className="mt-3 border-t border-border pt-3">
                <LinhaValor
                  rotulo="Total dos custos"
                  valor={formatCurrency(subtotalGeral, moeda)}
                  destaque
                />
              </div>
            )}
            {/* Com save, estas duas são as do FATURAMENTO: são elas que
                levam ao "Faturamento previsto" logo abaixo. As do valor do
                job saem na nota, porque a conta é outra. */}
            <LinhaValor
              rotulo={`Honorários (${formatarTaxa(percentualHonorarios)})`}
              valor={formatCurrency(
                temSave ? faturamento.honorarios : honorarios,
                moeda,
              )}
            />
            <LinhaValor
              rotulo={`Impostos (${formatarTaxa(percentualImposto)})`}
              valor={formatCurrency(
                temSave ? faturamento.imposto : imposto,
                moeda,
              )}
            />
            {/* Os dois fechamentos: o que a California emite nota e o que o
                cliente se compromete a gastar no total. Diferem pelos
                principais pagos direto ao fornecedor (A · Direto, D e F). */}
            <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-border pt-3.5">
              <span className="text-sm font-semibold">
                Faturamento previsto
              </span>
              <span className="whitespace-nowrap font-mono text-lg font-bold text-california-red">
                {formatCurrency(faturamentoPrevisto, moeda)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3 pt-1">
              <span className="text-sm font-semibold">Valor do Job</span>
              <span className="whitespace-nowrap font-mono text-lg font-bold text-foreground">
                {formatCurrency(valorJob, moeda)}
              </span>
            </div>
            {temSave && (
              <>
                <div className="flex items-baseline justify-between gap-3 pt-1">
                  <span className="text-sm font-semibold text-[#5f5d57]">
                    Saldo em save
                  </span>
                  <span className="whitespace-nowrap font-mono text-lg font-bold text-[#5f5d57]">
                    {formatCurrency(save.totalSaveGerado, moeda)}
                  </span>
                </div>
                <p className="pt-2 text-[10.5px] leading-relaxed text-muted-foreground">
                  Os honorários e impostos acima correm sobre{" "}
                  <strong>save gerado + custos do job</strong> (
                  {formatCurrency(faturamento.base, moeda)}) — é o que esta
                  nota cobra. O Valor do Job repete a mesma conta sobre{" "}
                  <strong>save usado + custos do job</strong> (
                  {formatCurrency(job.base, moeda)}): honorários{" "}
                  {formatCurrency(job.honorarios, moeda)}, impostos{" "}
                  {formatCurrency(job.imposto, moeda)}.
                </p>
              </>
            )}
          </div>
        </div>

        {/* O Resultado usa o custo BRUTO e mostra o BV como linha própria
            — por isso ele dá o mesmo número nas duas vistas. Ver o
            comentário de `bvPlanejado` em PainelResultado. */}
        <PainelResultado
          valorJob={valorJob}
          imposto={imposto}
          orcado={totais.orcadoRentabilidade}
          custoPlanejado={totais.planejado.bruto}
          custoRealizado={totais.realizado.bruto}
          bvPlanejado={totais.planejado.deducaoBv}
          bvRealizado={totais.realizado.deducaoBv}
          honorarios={honorarios}
          taxaHonorarios={formatarTaxa(percentualHonorarios)}
          moeda={moeda}
        />
      </div>

      <LegendaFechamento custo="custo (planejado ou realizado)" />
    </div>
  );
}

/** Linha do fechamento repartida em save usado / save gerado / custos do
 *  job. Mesma forma do card de Totais da versão do orçamento — as duas
 *  telas mostram a MESMA quebra, e o design é um só. */
function LinhaQuebrada({
  label,
  usado,
  gerado,
  custos,
  moeda,
  destaque,
}: {
  label: string;
  usado: number;
  gerado: number;
  custos: number;
  moeda: string;
  destaque?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[1fr_repeat(3,minmax(84px,auto))] items-baseline gap-x-3",
        destaque && "mt-3 border-t border-border pt-3",
      )}
    >
      <span
        className={cn(
          "text-sm",
          destaque ? "font-semibold" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
      {[usado, gerado, custos].map((v, i) => (
        <span
          key={i}
          className={cn(
            "whitespace-nowrap text-right font-mono text-[12.5px]",
            destaque ? "font-bold" : "font-semibold",
            v === 0 && "text-muted-foreground/50",
            i < 2 && v !== 0 && "text-[#5f5d57]",
          )}
        >
          {formatCurrency(v, moeda)}
        </span>
      ))}
    </div>
  );
}
