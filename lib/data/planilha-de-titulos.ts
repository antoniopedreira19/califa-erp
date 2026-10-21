/**
 * O que a planilha de títulos (decisão 195) mostra e as listas de títulos
 * ainda não liam: a regional de cada título (coluna REG), as retenções da
 * aprovação da PP (o líquido que sai da conta), o centro de custo da nota a
 * receber e os itens da fatura do cartão ("N itens", "Itens da fatura").
 *
 * Uma leitura por fonte, todas em `Promise.all`, só dos ids que a lista já
 * tem — depois que os títulos foram montados. Nada de embed pesado: cada
 * consulta traz só as colunas da regra.
 *
 * A regional segue a regra do Extrato (`lib/data/lancamento-linha.ts`,
 * decisão 069): com job, a regional do job, 100%; sem job, o rateio do
 * documento (avulsa, desembolso, nota avulsa); a nota com jobs, as
 * regionais deles, pesadas pelo valor de cada item.
 */

import type { createClient } from "@/lib/supabase/server";
import type { ImpostoRetido } from "@/lib/types";
import { carregarExtratoDaFatura, type ExtratoDaFatura } from "@/lib/data/fatura-cartao-extrato";
import { limparDescricaoDaFatura } from "@/lib/cartoes/descricao-fatura";
import {
  rateioPonderado,
  type ItemDaFatura,
  type ParteDoRateio,
} from "@/lib/financeiro/planilha-de-titulos";

type Supabase = ReturnType<typeof createClient>;

export interface ExtrasDaPlanilha {
  /** Chave do título (`pagar|pp|<id>`…) → rateio de regional. */
  rateio: Record<string, ParteDoRateio[]>;
  /** Parcela de PP → as alíquotas da retenção informada na aprovação. */
  retencaoDaAprovacao: Record<string, Partial<Record<ImpostoRetido, number>>>;
  /** Título a receber (nota) → o centro de custo da nota, quando ela tem. */
  centroDaNota: Record<string, { tipoId: string; subtipoId: string | null }>;
  /** Fatura do cartão → os itens dela. */
  itensDaFatura: Record<string, ItemDaFatura[]>;
  /** Transferência → as duas contas. */
  transferencias: Record<string, { origemContaId: string; destinoContaId: string }>;
  /** Fatura → o código ("FC-00004"): a fatura em que o item pago no cartão
   *  entrou. */
  codigoDaFatura: Record<string, string>;
}

export const EXTRAS_VAZIOS: ExtrasDaPlanilha = {
  rateio: {},
  retencaoDaAprovacao: {},
  centroDaNota: {},
  itensDaFatura: {},
  transferencias: {},
  codigoDaFatura: {},
};

type RateioRaw = Array<{ percentual: number | string; regional: { nome: string } | null }> | null;

function doRateio(r: RateioRaw): ParteDoRateio[] {
  return (r ?? [])
    .filter((x) => x.regional?.nome)
    .map((x) => ({ regional: x.regional!.nome, percentual: Number(x.percentual) }));
}

function daRegional(nome: string | null | undefined): ParteDoRateio[] {
  return nome ? [{ regional: nome, percentual: 100 }] : [];
}

const IMPOSTOS_RETIDOS: ImpostoRetido[] = ["ISS", "PIS", "COFINS", "CSLL", "IRRF"];

/**
 * Os títulos de cada fonte que a tela tem, pelo id. Quem não tem uma fonte
 * manda a lista vazia.
 */
export interface IdsDaPlanilha {
  ppParcelas: string[];
  avulsasPagar: Array<{ id: string; origem: "avulso" | "recorrencia" | "folha" }>;
  desembolsoParcelas: string[];
  devolucoesDeVerba: string[];
  faturas: string[];
  titulosReceber: string[];
  avulsasReceber: Array<{ id: string; origem: "recebimento_avulso" | "rendimento" }>;
  transferencias: string[];
  /** As faturas em que os itens pagos no cartão entraram. */
  faturasDosItens: string[];
}

/** Os itens da fatura do cartão nas colunas da planilha, cada um com o
 *  centro de custo e a regional dele (o pendente ainda não é lançamento). */
export function itensDoExtratoDaFatura(extrato: ExtratoDaFatura): ItemDaFatura[] {
  return extrato.itens
    .filter((it) => it.papel !== "pendente")
    .map((it) => {
      // Com sinal: a compra soma na fatura, o estorno abate.
      const valor = it.natureza === "saida" ? Math.abs(it.valor) : -Math.abs(it.valor);
      const rateio = it.regional_nome
        ? daRegional(it.regional_nome)
        : it.rateio.map((r) => ({ regional: r.regional_nome, percentual: r.percentual }));
      const tipoDoPlano = it.tipo_codigo ? `${it.tipo_codigo} · ${it.tipo_nome}` : null;
      return {
        id: it.id,
        data: it.data_movimento,
        valor,
        // Sem o "Cartão · " e o "PP " que o lançamento grava na frente.
        descricao: limparDescricaoDaFatura(it.descricao).replace(/^PP (?=PP-)/, "").replace(/^Avulsa /, ""),
        tipo:
          it.papel === "ajuste"
            ? "ajuste"
            : it.natureza === "entrada"
              ? "estorno"
              : it.origem_item?.tipo === "pp"
                ? "pp"
                : it.origem_item?.tipo === "desembolso"
                  ? "desembolso"
                  : it.origem_recorrente
                    ? "recorrencia"
                    : "avulso",
        codigo: it.origem_codigo,
        fornecedor: it.fornecedor_nome,
        job: it.job_codigo,
        centro: tipoDoPlano
          ? { rotulo: tipoDoPlano, completo: it.subtipo_nome ? `${tipoDoPlano} · ${it.subtipo_nome}` : tipoDoPlano }
          : null,
        empresa: it.empresa_nome,
        rateio,
      };
    });
}

/** Quantos ids vão numa consulta `.in()`: a lista viaja na URL, e os
 *  títulos pagos de Contas a Pagar só crescem. */
const TAMANHO_DO_LOTE = 150;

/** A mesma consulta em lotes de ids, em paralelo, com as linhas juntas. */
async function emLotes(
  ids: string[],
  consulta: (lote: string[]) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<{ data: unknown[]; error: { message: string } | null }> {
  if (ids.length === 0) return { data: [], error: null };
  const lotes: string[][] = [];
  for (let i = 0; i < ids.length; i += TAMANHO_DO_LOTE) lotes.push(ids.slice(i, i + TAMANHO_DO_LOTE));
  const respostas = await Promise.all(lotes.map((lote) => consulta(lote)));
  return {
    data: respostas.flatMap((r) => r.data ?? []),
    error: respostas.find((r) => r.error)?.error ?? null,
  };
}

export async function carregarExtrasDaPlanilha(
  supabase: Supabase,
  tenantId: string,
  ids: IdsDaPlanilha,
): Promise<ExtrasDaPlanilha> {
  const idsAvulsas = [...ids.avulsasPagar.map((a) => a.id), ...ids.avulsasReceber.map((a) => a.id)];

  const [ppsRes, avulsasRes, desembolsosRes, verbasRes, titulosRes, transferenciasRes, faturas, codigosRes] = await Promise.all([
    emLotes(ids.ppParcelas, (lote) =>
      supabase
        .from("pedidos_compra_parcelas")
        .select(
          "id, pp:pedidos_compra!pedido_compra_id(job:jobs!job_id(regional:regionais!regional_id(nome)), " +
            "retencoes:pedidos_compra_retencoes!pedido_compra_id(imposto, aliquota))",
        )
        .eq("tenant_id", tenantId)
        .in("id", lote),
    ),
    emLotes(idsAvulsas, (lote) =>
      supabase
        .from("contas_avulsas")
        .select(
          "id, regional:regionais!regional_id(nome), " +
            "rateio:contas_avulsas_regionais!conta_avulsa_id(percentual, regional:regionais!regional_id(nome))",
        )
        .eq("tenant_id", tenantId)
        .in("id", lote),
    ),
    emLotes(ids.desembolsoParcelas, (lote) =>
      supabase
        .from("desembolsos_parcelas")
        .select(
          "id, desembolso:desembolsos!desembolso_id(job:jobs!job_id(regional:regionais!regional_id(nome)), " +
            "rateio:desembolsos_regionais!desembolso_id(percentual, regional:regionais!regional_id(nome)))",
        )
        .eq("tenant_id", tenantId)
        .in("id", lote),
    ),
    emLotes(ids.devolucoesDeVerba, (lote) =>
      supabase
        .from("pp_verba_devolucoes")
        .select("id, pp:pedidos_compra!pedido_compra_id(job:jobs!job_id(regional:regionais!regional_id(nome)))")
        .eq("tenant_id", tenantId)
        .in("id", lote),
    ),
    emLotes(ids.titulosReceber, (lote) =>
      supabase
        .from("titulos_receber")
        .select(
          "id, regional:regionais!regional_id(nome), " +
            "faturamento:faturamentos!faturamento_id(plano_conta_tipo_id, plano_conta_subtipo_id, " +
            "rateio:faturamentos_regionais!faturamento_id(percentual, regional:regionais!regional_id(nome)), " +
            "itens:faturamento_itens!faturamento_id(origem_tipo, origem_id, valor))",
        )
        .eq("tenant_id", tenantId)
        .in("id", lote),
    ),
    emLotes(ids.transferencias, (lote) =>
      supabase
        .from("transferencias_contas")
        .select("id, conta_origem_id, conta_destino_id")
        .eq("tenant_id", tenantId)
        .in("id", lote),
    ),
    Promise.all(ids.faturas.map((id) => carregarExtratoDaFatura(supabase, tenantId, id))),
    emLotes([...new Set(ids.faturasDosItens)], (lote) =>
      supabase.from("faturas_cartao").select("id, codigo").eq("tenant_id", tenantId).in("id", lote),
    ),
  ]);

  for (const [nome, res] of [
    ["pps", ppsRes],
    ["avulsas", avulsasRes],
    ["desembolsos", desembolsosRes],
    ["verbas", verbasRes],
    ["titulos_receber", titulosRes],
    ["transferencias", transferenciasRes],
    ["faturas_dos_itens", codigosRes],
  ] as const) {
    if (res.error) console.error(`[planilha-de-titulos.${nome}]`, res.error.message);
  }

  const extras: ExtrasDaPlanilha = {
    rateio: {},
    retencaoDaAprovacao: {},
    centroDaNota: {},
    itensDaFatura: {},
    transferencias: {},
    codigoDaFatura: Object.fromEntries(
      ((codigosRes.data ?? []) as Array<{ id: string; codigo: string }>).map((f) => [f.id, f.codigo]),
    ),
  };

  // ---- PP: a regional do job; e a retenção da aprovação ----
  for (const p of (ppsRes.data ?? []) as any[]) {
    extras.rateio[`pagar|pp|${p.id}`] = daRegional(p.pp?.job?.regional?.nome);
    const aliquotas: Partial<Record<ImpostoRetido, number>> = {};
    for (const r of (p.pp?.retencoes ?? []) as Array<{ imposto: string; aliquota: number | string | null }>) {
      const a = Number(r.aliquota);
      if (IMPOSTOS_RETIDOS.includes(r.imposto as ImpostoRetido) && Number.isFinite(a) && a > 0) {
        aliquotas[r.imposto as ImpostoRetido] = a;
      }
    }
    if (Object.keys(aliquotas).length > 0) extras.retencaoDaAprovacao[p.id] = aliquotas;
  }

  // ---- Avulsa, recorrência, folha, recebimento avulso e rendimento: o
  //      rateio da avulsa; sem rateio, a regional dela ----
  const origemDaAvulsa = new Map<string, string>([
    ...ids.avulsasPagar.map((a): [string, string] => [a.id, `pagar|${a.origem}|${a.id}`]),
    ...ids.avulsasReceber.map((a): [string, string] => [a.id, `receber|${a.origem}|${a.id}`]),
  ]);
  for (const a of (avulsasRes.data ?? []) as any[]) {
    const chave = origemDaAvulsa.get(a.id);
    if (!chave) continue;
    const rateio = doRateio(a.rateio);
    extras.rateio[chave] = rateio.length ? rateio : daRegional(a.regional?.nome);
  }

  // ---- Desembolso: a regional do job, senão o rateio ----
  for (const d of (desembolsosRes.data ?? []) as any[]) {
    const doJob = daRegional(d.desembolso?.job?.regional?.nome);
    extras.rateio[`pagar|desembolso|${d.id}`] = doJob.length ? doJob : doRateio(d.desembolso?.rateio);
  }

  // ---- Estorno de verba: a regional do job da PP ----
  for (const v of (verbasRes.data ?? []) as any[]) {
    extras.rateio[`pagar|pp_devolucao_verba|${v.id}`] = daRegional(v.pp?.job?.regional?.nome);
  }

  // ---- Nota a receber: as regionais dos jobs, pesadas pelo valor; sem
  //      job, o rateio da nota avulsa; e o centro de custo da nota ----
  const titulos = (titulosRes.data ?? []) as any[];
  const idsDosJobs = [
    ...new Set(
      titulos.flatMap((t) =>
        ((t.faturamento?.itens ?? []) as Array<{ origem_tipo: string; origem_id: string | null }>)
          .filter((i) => i.origem_tipo === "job" && i.origem_id)
          .map((i) => i.origem_id as string),
      ),
    ),
  ];
  const { data: jobsDasNotas } = await emLotes(idsDosJobs, (lote) =>
    supabase.from("jobs").select("id, regional:regionais!regional_id(nome)").eq("tenant_id", tenantId).in("id", lote),
  );
  const regionalDoJob = new Map<string, string | null>(
    ((jobsDasNotas ?? []) as any[]).map((j) => [j.id, j.regional?.nome ?? null]),
  );
  for (const t of titulos) {
    const itens = (t.faturamento?.itens ?? []) as Array<{ origem_tipo: string; origem_id: string | null; valor: number | string }>;
    const pelosJobs = rateioPonderado(
      itens
        .filter((i) => i.origem_tipo === "job" && i.origem_id)
        .map((i) => ({ valor: Number(i.valor), rateio: daRegional(regionalDoJob.get(i.origem_id as string)) })),
    );
    const daNota = doRateio(t.faturamento?.rateio);
    extras.rateio[`receber|nf|${t.id}`] = pelosJobs.length
      ? pelosJobs
      : daNota.length
        ? daNota
        : daRegional(t.regional?.nome);
    if (t.faturamento?.plano_conta_tipo_id) {
      extras.centroDaNota[t.id] = {
        tipoId: t.faturamento.plano_conta_tipo_id,
        subtipoId: t.faturamento.plano_conta_subtipo_id ?? null,
      };
    }
  }

  // ---- Transferência: as duas contas ----
  for (const t of (transferenciasRes.data ?? []) as any[]) {
    extras.transferencias[t.id] = { origemContaId: t.conta_origem_id, destinoContaId: t.conta_destino_id };
  }

  // ---- Fatura do cartão: os itens, cada um com o centro e a regional ----
  ids.faturas.forEach((faturaId, i) => {
    const extrato = faturas[i];
    if (extrato) extras.itensDaFatura[faturaId] = itensDoExtratoDaFatura(extrato);
  });

  return extras;
}
