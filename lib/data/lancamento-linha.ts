import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocumentoTipo } from "@/lib/types";
import { DOCUMENTO_TIPOS_FISCAIS, documentoTipoLabel } from "@/lib/types";
import type { LancamentoLinha, OrigemDaTransacao } from "@/lib/calculos/saldo-conta";

/**
 * A LINHA DO EXTRATO, montada num lugar só (20/09/2026).
 *
 * Este módulo é o que a Conciliação sempre fez inline: a consulta de
 * `lancamentos_financeiros` com os embeds de origem, e a tradução de cada
 * linha crua para `LancamentoLinha` — fornecedor, job, plano de contas,
 * empresa, regional (pela regra da decisão 069), código e documento da
 * origem, rateio, e a marca de estornada. Saiu da página porque a fatura
 * do cartão passou a ser o MESMO extrato (decisão 093, entrega 2): cada
 * item da fatura é um lançamento na conta-espelho, com as mesmas colunas.
 * Duas cópias desta tradução divergiriam em semanas.
 *
 * `derivarSaldo` continua sendo chamado por quem usa: na conciliação o
 * acumulado parte do saldo anterior da conta; na fatura, de zero.
 */

export const SELECT_LANCAMENTO_LINHA = `id, data_movimento, descricao, natureza, valor, origem, created_at,
         papel_na_fatura, fatura_cartao_id,
         conta_avulsa_id, pedido_compra_parcela_id, desembolso_parcela_id,
         fornecedores(nome, razao_social),
         jobs(id, codigo, regional:regionais(nome)),
         empresas(nome_fantasia, razao_social),
         plano_contas_tipos!inner(codigo, nome),
         plano_contas_subtipos!inner(codigo, nome),
         forma_pagamento,
         pedido_compra:pedidos_compra(
           codigo,
           anexos:pedidos_compra_anexos(arquivo_path, documento_tipo, documento_numero)
         ),
         desembolso:desembolsos(
           codigo,
           anexos:desembolsos_anexos(arquivo_path, documento_tipo, documento_numero),
           rateio:desembolsos_regionais(
             percentual,
             regional:regionais(nome)
           )
         ),
         cartao:cartoes_credito(nome, ultimos_4_digitos),
         fatura:faturas_cartao(codigo),
         titulo:titulos_receber!lancamentos_financeiros_titulo_receber_id_fkey(
           faturamento:faturamentos(
             numero_nf, serie, anexo_nf_path,
             rateio:faturamentos_regionais(percentual, regional:regionais(nome))
           )
         ),
         conta_avulsa:contas_avulsas!conta_avulsa_id(
           codigo,
           recorrente_id,
           anexos:contas_avulsas_anexos(arquivo_path, documento_tipo, documento_numero),
           rateio:contas_avulsas_regionais(
             percentual,
             regional:regionais(nome)
           )
         )`;

type AnexoRaw = {
  arquivo_path: string;
  documento_tipo: DocumentoTipo | null;
  documento_numero: string | null;
};

type RateioRaw = { percentual: number; regional: { nome: string } | null };

export type LancamentoRaw = {
  id: string;
  data_movimento: string;
  descricao: string;
  natureza: "entrada" | "saida";
  valor: string | number;
  origem: string;
  papel_na_fatura: string | null;
  fatura_cartao_id: string | null;
  conta_avulsa_id: string | null;
  pedido_compra_parcela_id: string | null;
  desembolso_parcela_id: string | null;
  fornecedores: { nome: string | null; razao_social: string | null } | null;
  jobs: { id: string; codigo: string; regional: { nome: string } | null } | null;
  empresas: { nome_fantasia: string | null; razao_social: string | null } | null;
  plano_contas_tipos: { codigo: string; nome: string };
  plano_contas_subtipos: { codigo: string; nome: string };
  forma_pagamento: string | null;
  fatura: { codigo: string } | null;
  pedido_compra: { codigo: string; anexos: AnexoRaw[] } | null;
  desembolso: { codigo: string; anexos: AnexoRaw[]; rateio: RateioRaw[] } | null;
  cartao: { nome: string; ultimos_4_digitos: string } | null;
  titulo: {
    faturamento: {
      numero_nf: string | null;
      serie: string | null;
      anexo_nf_path: string | null;
      rateio: RateioRaw[];
    } | null;
  } | null;
  conta_avulsa: {
    codigo: string | null;
    recorrente_id: string | null;
    anexos: AnexoRaw[];
    rateio: RateioRaw[];
  } | null;
};

/** A linha pronta, menos o acumulado — esse depende de onde se parte. */
export type LinhaSemSaldo = Omit<LancamentoLinha, "credito" | "debito" | "saldo"> & {
  /** Papel do lançamento numa fatura de cartão (`item`, `ajuste`,
   *  `pagamento`, `pagamento_estorno`) — a fatura agrupa por ele. */
  papel_na_fatura: string | null;
  fatura_cartao_id: string | null;
  /** A origem item a item, para a fatura ligar a linha ao título de onde
   *  ela veio (estorno de compra, baixa registrada). */
  conta_avulsa_id: string | null;
  pedido_compra_parcela_id: string | null;
  desembolso_parcela_id: string | null;
};

/**
 * O comprovante FISCAL de uma origem: o primeiro anexo tipado como nota
 * ou recibo. Contrato e boleto acompanham a compra, mas não são o
 * documento que a contabilidade procura — por isso ficam de fora.
 */
function documentoFiscal(
  anexos: AnexoRaw[] | undefined,
): { label: string; path: string } | null {
  const alvo = (anexos ?? []).find(
    (a) =>
      a.documento_tipo !== null &&
      DOCUMENTO_TIPOS_FISCAIS.includes(a.documento_tipo),
  );
  if (!alvo?.documento_tipo) return null;
  const rotulo = documentoTipoLabel(alvo.documento_tipo);
  return {
    label: alvo.documento_numero ? `${rotulo} ${alvo.documento_numero}` : rotulo,
    path: alvo.arquivo_path,
  };
}

/** "NF 900123/1" — a nota como ela é lida, com a série quando existe. */
function numeroDaNota(
  f: { numero_nf: string | null; serie: string | null } | null,
): string | null {
  if (!f?.numero_nf) return null;
  return f.serie ? `NF ${f.numero_nf}/${f.serie}` : `NF ${f.numero_nf}`;
}

/**
 * Traduz as linhas cruas da consulta (`SELECT_LANCAMENTO_LINHA`) para o
 * formato do extrato, já com origens da nota, regional derivada e a marca
 * de estornada. Faz até duas leituras a mais (`vw_lancamento_origens` e
 * os jobs delas) — só quando há lançamento na lista.
 */
export async function montarLinhasDeLancamentos(
  supabase: SupabaseClient,
  tenantId: string,
  data: unknown[],
): Promise<LinhaSemSaldo[]> {
  const raw = (data as LancamentoRaw[]).map((r) => {
    // O rateio só existe onde não há job (decisão 069). Avulsa,
    // desembolso e a nota avulsa (086) são as origens que o carregam;
    // nunca duas ao mesmo tempo, porque o lançamento vem de uma origem só.
    const rateio = [
      ...(r.conta_avulsa?.rateio ?? []),
      ...(r.desembolso?.rateio ?? []),
      ...(r.titulo?.faturamento?.rateio ?? []),
    ].map((rr) => ({
      percentual: Number(rr.percentual),
      regional_nome: rr.regional?.nome ?? "—",
    }));
    return {
      id: r.id,
      data_movimento: r.data_movimento,
      descricao: r.descricao,
      natureza: r.natureza,
      valor: Number(r.valor),
      fornecedor_nome: r.fornecedores?.razao_social ?? r.fornecedores?.nome ?? null,
      job_id: r.jobs?.id ?? null,
      job_codigo: r.jobs?.codigo ?? null,
      // Mesma regra da `vw_fluxo_caixa` (decisão 069, 10/09/2026): a
      // regional do JOB manda sempre; o rateio só decide onde não há
      // job. Com mais de uma regional isto fica nulo — a coluna diz
      // "Rateada" e o detalhe abre a divisão, que é onde os percentuais
      // cabem.
      //
      // A BAIXA DE TÍTULO não tem job no lançamento (ele é derivado da
      // nota): a regional dela é resolvida mais abaixo, pelas origens —
      // as mesmas que a coluna Job já usava (15/09/2026).
      regional_nome:
        r.jobs?.regional?.nome ??
        (rateio.length === 1 ? rateio[0].regional_nome : null),
      // A ordem é a das origens que têm identificador próprio. O
      // recebimento fica por último porque ali a origem É a nota — o
      // faturamento não tem código interno, e inventar um só faria a
      // coluna Documento repetir esta.
      origem_codigo:
        r.pedido_compra?.codigo ??
        r.desembolso?.codigo ??
        r.conta_avulsa?.codigo ??
        numeroDaNota(r.titulo?.faturamento ?? null) ??
        // Fecha a lista: o pagamento da fatura e o ajuste de IOF não
        // vêm de documento nenhum, mas vêm de uma fatura — e sem isso
        // eles apareciam com travessão, sem dizer de onde saíram
        // (28/08/2026).
        r.fatura?.codigo ??
        null,
      origem_recorrente: r.conta_avulsa?.recorrente_id != null,
      cartao_label:
        r.forma_pagamento === "cartao_credito" && r.cartao
          ? `${r.cartao.nome} ·${r.cartao.ultimos_4_digitos}`
          : null,
      // Mesma ordem da Origem. No recebimento a NOTA é o documento: ela
      // já vem estruturada em `faturamentos`, e não depende de ninguém
      // ter identificado anexo nenhum.
      documento_label:
        documentoFiscal(r.pedido_compra?.anexos)?.label ??
        documentoFiscal(r.desembolso?.anexos)?.label ??
        documentoFiscal(r.conta_avulsa?.anexos)?.label ??
        numeroDaNota(r.titulo?.faturamento ?? null),
      documento_path:
        documentoFiscal(r.pedido_compra?.anexos)?.path ??
        documentoFiscal(r.desembolso?.anexos)?.path ??
        documentoFiscal(r.conta_avulsa?.anexos)?.path ??
        r.titulo?.faturamento?.anexo_nf_path ??
        null,
      tipo_codigo: r.plano_contas_tipos.codigo,
      tipo_nome: r.plano_contas_tipos.nome,
      subtipo_codigo: r.plano_contas_subtipos.codigo,
      subtipo_nome: r.plano_contas_subtipos.nome,
      empresa_nome: r.empresas?.nome_fantasia ?? r.empresas?.razao_social ?? null,
      origem: r.origem,
      papel_na_fatura: r.papel_na_fatura,
      fatura_cartao_id: r.fatura_cartao_id,
      conta_avulsa_id: r.conta_avulsa_id,
      pedido_compra_parcela_id: r.pedido_compra_parcela_id,
      desembolso_parcela_id: r.desembolso_parcela_id,
      rateio,
    };
  });

  // De onde vem o dinheiro de cada baixa: os jobs cobertos pela nota e
  // o saldo em save. Só existe em lançamento de título; nos demais a
  // consulta volta vazia e a linha fica sem expansão
  // (docs/decisions/028-save-entre-jobs.md).
  const ids = raw.map((r) => r.id);
  const origensPorLancamento = new Map<string, OrigemDaTransacao[]>();
  /** Valor por regional, para a baixa de título — cujo job é derivado da
   *  nota e não está no lançamento. */
  const regionaisPorLancamento = new Map<string, Map<string, number>>();
  if (ids.length > 0) {
    // Sem embed: `vw_lancamento_origens` é VIEW, e o PostgREST não tem
    // chave estrangeira para inferir o join com `jobs` a partir dela —
    // pedir `job:jobs!job_id(...)` volta erro, e o erro silencioso
    // deixava a linha sem expansão nenhuma. O nome do job vem numa
    // segunda leitura, pelos ids que a view devolveu.
    const { data: origens, error: origensErro } = await supabase
      .from("vw_lancamento_origens")
      .select("lancamento_id, tipo, valor, job_id, save_job_id")
      .eq("tenant_id", tenantId)
      .in("lancamento_id", ids);

    if (origensErro) {
      console.error("[lancamento-linha.origens]", origensErro.message);
    }

    type OrigemRaw = {
      lancamento_id: string;
      tipo: "job" | "save";
      valor: number | string | null;
      job_id: string | null;
      save_job_id: string | null;
    };
    type JobRaw = {
      id: string;
      codigo: string;
      nome: string;
      regional: { nome: string } | null;
    };

    const listaOrigens = (origens ?? []) as OrigemRaw[];
    const jobIds = [
      ...new Set(
        listaOrigens
          .map((o) => o.job_id ?? o.save_job_id)
          .filter((id): id is string => !!id),
      ),
    ];
    // `regional` entra aqui desde 15/09/2026: é por ela que a coluna
    // Regional da baixa de título deixa de sair vazia. A mesma leitura
    // que já dava o job da nota dá a regional dele — Job e Regional
    // passam a concordar por construção (decisão 069).
    const { data: jobsDasOrigens } = jobIds.length
      ? await supabase
          .from("jobs")
          .select("id, codigo, nome, regional:regionais(nome)")
          .eq("tenant_id", tenantId)
          .in("id", jobIds)
      : { data: [] as unknown[] };
    const jobPorId = new Map(
      ((jobsDasOrigens ?? []) as unknown as JobRaw[]).map((j) => [j.id, j]),
    );

    for (const o of listaOrigens) {
      const lista = origensPorLancamento.get(o.lancamento_id) ?? [];
      const alvo = jobPorId.get((o.tipo === "save" ? o.save_job_id : o.job_id) ?? "");
      // Quanto desta baixa pertence a cada regional. O save entra pela
      // regional do job que GEROU o save, que é de onde o dinheiro vem.
      const regionalDoJob = alvo?.regional?.nome ?? null;
      if (regionalDoJob) {
        const porRegional =
          regionaisPorLancamento.get(o.lancamento_id) ?? new Map<string, number>();
        porRegional.set(
          regionalDoJob,
          (porRegional.get(regionalDoJob) ?? 0) + Number(o.valor ?? 0),
        );
        regionaisPorLancamento.set(o.lancamento_id, porRegional);
      }
      lista.push({
        tipo: o.tipo,
        job_id: alvo?.id ?? null,
        codigo: alvo?.codigo ?? null,
        nome: alvo?.nome ?? null,
        valor: Number(o.valor ?? 0),
      });
      origensPorLancamento.set(o.lancamento_id, lista);
    }
  }

  // Faturas cujo pagamento foi estornado: têm no MESMO fatura_cartao_id
  // um lançamento com papel_na_fatura = 'pagamento' E outro com
  // 'pagamento_estorno' (o contra-lançamento inserido pela RPC de
  // estorno). Sinaliza pra riscar o `pagamento` original — o backend
  // não marca a origem (deixa como `manual`), diferente do PP/Avulsa.
  const faturasComEstorno = new Set<string>();
  for (const r of raw) {
    if (r.papel_na_fatura === "pagamento_estorno" && r.fatura_cartao_id !== null) {
      faturasComEstorno.add(r.fatura_cartao_id);
    }
  }

  return raw.map((r) => {
    // Baixa de título: sem job direto e sem rateio próprio, a regional
    // vem das origens da nota. Uma só regional vira o nome na coluna;
    // mais de uma vira a divisão, com o percentual que cada uma
    // representa do valor recebido (15/09/2026).
    const porRegional = regionaisPorLancamento.get(r.id);
    const pelasOrigens =
      r.regional_nome === null && r.rateio.length === 0 && porRegional
        ? [...porRegional.entries()]
        : [];
    const totalOrigens = pelasOrigens.reduce((acc, [, v]) => acc + v, 0);

    return {
      ...r,
      regional_nome: pelasOrigens.length === 1 ? pelasOrigens[0][0] : r.regional_nome,
      rateio:
        pelasOrigens.length > 1 && totalOrigens > 0
          ? pelasOrigens.map(([nome, valor]) => ({
              regional_nome: nome,
              percentual: Number(((valor / totalOrigens) * 100).toFixed(2)),
            }))
          : r.rateio,
      estornada:
        r.origem === "pp_baixa_estornada" ||
        r.origem === "avulsa_baixa_estornada" ||
        (r.papel_na_fatura === "pagamento" &&
          r.fatura_cartao_id !== null &&
          faturasComEstorno.has(r.fatura_cartao_id)),
      origens: origensPorLancamento.get(r.id) ?? [],
    };
  });
}
