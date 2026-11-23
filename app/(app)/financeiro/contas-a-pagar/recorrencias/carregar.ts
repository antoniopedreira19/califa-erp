// A carga da aba Recorrências (decisão 272), no servidor. Quatro leituras em
// paralelo (regra de performance): as recorrências com o cadastro e o
// rateio; os títulos delas, com os anexos e as baixas; as linhas do extrato
// ainda sem conciliar; e o dia até onde o extrato foi importado. O status de
// cada título sai daqui pronto: o cliente não recebe o extrato.
import type { createClient } from "@/lib/supabase/server";
import { todasAsLinhas } from "@/lib/supabase/todas-as-linhas";
import { reconhecerCustoFixo } from "@/lib/conciliacao/custo-fixo";
import type { DocumentoTipo, FormaPagamento, FrequenciaRecorrencia } from "@/lib/types";
import {
  estadoDoTitulo,
  proximasDatas,
  situacaoDa,
  somarDias,
  type NoBanco,
  type Recorrencia,
  type TituloDaRecorrencia,
} from "./dados";

type Supabase = ReturnType<typeof createClient>;

interface LinhaRecorrencia {
  id: string;
  codigo: string;
  descricao: string;
  valor: string | number;
  empresa_id: string;
  fornecedor_id: string | null;
  cliente_id: string | null;
  plano_conta_tipo_id: string;
  plano_conta_subtipo_id: string;
  frequencia: FrequenciaRecorrencia;
  dia_do_mes: number | null;
  dia_quinzena_1: number | null;
  dia_quinzena_2: number | null;
  dia_do_ano_dia: number | null;
  dia_do_ano_mes: number | null;
  proxima_data: string;
  data_fim: string | null;
  ativo: boolean;
  forma_pagamento: FormaPagamento | null;
  cartao_credito_id: string | null;
  valor_variavel: boolean;
  texto_no_extrato: string | null;
  fornecedor: { nome: string | null; razao_social: string | null } | null;
  empresa: { razao_social: string | null; nome_fantasia: string | null } | null;
  tipo: { codigo: string; nome: string } | null;
  subtipo: { nome: string } | null;
  rateio: Array<{ regional_id: string; percentual: string | number; regional: { nome: string } | null }> | null;
}

interface LinhaTitulo {
  id: string;
  codigo: string | null;
  recorrente_id: string;
  valor: string | number;
  status: "aprovada" | "baixada";
  data_compra: string | null;
  data_pagamento_primeira: string | null;
  data_prevista_pagamento: string | null;
  data_pagamento: string | null;
  pago_em: string | null;
  valor_estimado: boolean;
  conta_lancada_em: string | null;
  fatura_cartao_id: string | null;
  anexos: Array<{
    id: string;
    arquivo_nome_original: string;
    documento_tipo: DocumentoTipo | null;
    documento_numero: string | null;
    created_at: string;
  }> | null;
  baixas: Array<{ origem: string; extrato_linha_id: string | null; valor: string | number }> | null;
}

interface LinhaDoExtrato {
  id: string;
  conta_bancaria_id: string;
  data: string;
  valor: string | number;
  historico: string;
}

export async function carregarRecorrencias(
  supabase: Supabase,
  tenantId: string,
  empresaIds: string[],
  hoje: string,
): Promise<{ recs: Recorrencia[]; erro: string | null }> {
  // O extrato só interessa na janela do reconhecimento (12 dias antes do
  // vencimento mais antigo em aberto): 90 dias cobrem o atraso que a
  // Conciliação ainda resolve, sem varrer o histórico (case 5 do PERFORMANCE).
  const desde = somarDias(hoje, -90);
  const [recRes, titRes, extratoRes, importRes, contasRes] = await Promise.all([
    (() => {
      let q = supabase
        .from("contas_avulsas_recorrentes")
        .select(
          `id, codigo, descricao, valor, empresa_id, fornecedor_id, cliente_id,
           plano_conta_tipo_id, plano_conta_subtipo_id, frequencia,
           dia_do_mes, dia_quinzena_1, dia_quinzena_2, dia_do_ano_dia, dia_do_ano_mes,
           proxima_data, data_fim, ativo, forma_pagamento, cartao_credito_id,
           valor_variavel, texto_no_extrato,
           fornecedor:fornecedores(nome, razao_social),
           empresa:empresas(razao_social, nome_fantasia),
           tipo:plano_contas_tipos(codigo, nome),
           subtipo:plano_contas_subtipos(nome),
           rateio:contas_avulsas_recorrentes_regionais(regional_id, percentual, regional:regionais(nome))`,
        )
        .eq("tenant_id", tenantId)
        .order("codigo");
      if (empresaIds.length > 0) q = q.in("empresa_id", empresaIds);
      return q;
    })(),
    todasAsLinhas<LinhaTitulo>((de, ate) =>
      supabase
        .from("contas_avulsas")
        .select(
          `id, codigo, recorrente_id, valor, status, data_compra, data_pagamento_primeira,
           data_prevista_pagamento, data_pagamento, pago_em, valor_estimado, conta_lancada_em,
           fatura_cartao_id,
           anexos:contas_avulsas_anexos(id, arquivo_nome_original, documento_tipo, documento_numero, created_at),
           baixas:lancamentos_financeiros!conta_avulsa_id(origem, extrato_linha_id, valor)`,
        )
        .eq("tenant_id", tenantId)
        .not("recorrente_id", "is", null)
        .order("id")
        .range(de, ate) as unknown as PromiseLike<{ data: LinhaTitulo[] | null; error: { message: string } | null }>,
    ),
    todasAsLinhas<LinhaDoExtrato>((de, ate) =>
      supabase
        .from("extrato_linhas")
        .select("id, conta_bancaria_id, data, valor, historico")
        .eq("tenant_id", tenantId)
        .is("conciliada_como", null)
        .is("ignorada_em", null)
        .lt("valor", 0)
        .gte("data", desde)
        .order("data")
        .order("id")
        .range(de, ate) as unknown as PromiseLike<{ data: LinhaDoExtrato[] | null; error: { message: string } | null }>,
    ),
    supabase
      .from("extrato_importacoes")
      .select("periodo_fim")
      .eq("tenant_id", tenantId)
      .not("periodo_fim", "is", null)
      .order("periodo_fim", { ascending: false })
      .limit(1),
    supabase.from("contas_bancarias").select("id, nome").eq("tenant_id", tenantId),
  ]);

  const erro = recRes.error?.message ?? titRes.error?.message ?? extratoRes.error?.message ?? null;
  if (recRes.error) console.error("[recorrencias.carregar.recorrencias]", recRes.error.message);
  if (titRes.error) console.error("[recorrencias.carregar.titulos]", titRes.error.message);
  if (extratoRes.error) console.error("[recorrencias.carregar.extrato]", extratoRes.error.message);

  const linhasRec = (recRes.data ?? []) as unknown as LinhaRecorrencia[];
  const porRec = new Map(linhasRec.map((r) => [r.id, r]));
  const contaNome = new Map(((contasRes.data ?? []) as Array<{ id: string; nome: string }>).map((c) => [c.id, c.nome]));
  // O extrato mais recente entre as contas: a conta bancária não pertence a
  // uma empresa (decisão 064), e a recorrência não guarda conta.
  const bancoAte = ((importRes.data ?? []) as Array<{ periodo_fim: string }>)[0]?.periodo_fim?.slice(0, 10) ?? null;

  // Os títulos, do mais antigo ao mais novo, com o reconhecimento no extrato
  // na mesma ordem: uma linha do banco paga um título só.
  const titulos = (titRes.data ?? [])
    .filter((a) => porRec.has(a.recorrente_id))
    .map((a) => ({ a, vencimento: (a.data_compra ?? a.data_pagamento_primeira ?? a.data_prevista_pagamento ?? "").slice(0, 10) }))
    .sort((x, y) => (x.vencimento < y.vencimento ? -1 : x.vencimento > y.vencimento ? 1 : x.a.id < y.a.id ? -1 : 1));
  const linhas = (extratoRes.data ?? []).map((l) => ({ ...l, valor: Number(l.valor) }));
  const usadas = new Set<string>();
  const porRecorrencia = new Map<string, TituloDaRecorrencia[]>();

  for (const { a, vencimento } of titulos) {
    const rec = porRec.get(a.recorrente_id)!;
    const pago = a.status === "baixada";
    const baixas = (a.baixas ?? []).filter((b) => b.origem === "avulsa_baixa");
    const baixado = baixas.reduce((s, b) => s + Number(b.valor), 0);
    const anexos = (a.anexos ?? [])
      .map((x) => ({ id: x.id, nome: x.arquivo_nome_original, tipo: x.documento_tipo, numero: x.documento_numero, quando: x.created_at }))
      .sort((x, y) => (x.quando < y.quando ? -1 : 1));
    const valor = Number(a.valor);
    const aberto = valor - baixado;
    let banco: NoBanco | null = null;
    if (!pago && aberto > 0.004) {
      const custo = { codigo: rec.codigo, variavel: rec.valor_variavel, textoNoExtrato: rec.texto_no_extrato };
      const melhor = linhas
        .filter((l) => !usadas.has(l.id))
        .map((l) => ({ l, r: reconhecerCustoFixo(custo, l, vencimento, aberto) }))
        .filter((x): x is { l: (typeof linhas)[number]; r: NonNullable<ReturnType<typeof reconhecerCustoFixo>> } => x.r !== null)
        .sort((x, y) => y.r.bonus - x.r.bonus || Math.abs(x.r.diasDoVencimento) - Math.abs(y.r.diasDoVencimento))[0];
      if (melhor) {
        usadas.add(melhor.l.id);
        banco = {
          data: melhor.l.data,
          valor: Math.abs(melhor.l.valor),
          contaNome: contaNome.get(melhor.l.conta_bancaria_id) ?? "Conta",
          historico: melhor.l.historico,
          motivo: melhor.r.motivo,
          valorIgual: melhor.r.valorIgual,
        };
      }
    }
    const t = {
      pago,
      conciliado: pago && baixas.length > 0 && baixas.every((b) => !!b.extrato_linha_id),
      estimado: a.valor_estimado && !pago,
      vencimento,
    };
    const titulo: TituloDaRecorrencia = {
      id: a.id,
      codigo: a.codigo ?? "",
      vencimento,
      valor,
      pago,
      pagoEm: pago ? (a.pago_em ?? a.data_pagamento ?? vencimento).slice(0, 10) : null,
      anexos,
      semDocumento: pago && anexos.length === 0,
      estimado: t.estimado,
      contaLancadaEm: a.conta_lancada_em,
      conciliado: t.conciliado,
      travado: pago || baixado > 0.004 || !!a.fatura_cartao_id,
      estado: estadoDoTitulo(t, banco, bancoAte, hoje),
      banco,
      bancoAte,
    };
    porRecorrencia.set(rec.id, [...(porRecorrencia.get(rec.id) ?? []), titulo]);
  }

  const recs: Recorrencia[] = linhasRec.map((r) => {
    const ts = porRecorrencia.get(r.id) ?? [];
    const situacao = situacaoDa(r, hoje);
    const previstas =
      situacao === "ativa" ? proximasDatas(r, r.proxima_data, 3, r.data_fim).filter((d) => !ts.some((t) => t.vencimento === d)) : [];
    return {
      id: r.id,
      codigo: r.codigo,
      descricao: r.descricao,
      valor: Number(r.valor),
      empresa_id: r.empresa_id,
      empresa_nome: r.empresa?.nome_fantasia ?? r.empresa?.razao_social ?? "—",
      fornecedor_id: r.fornecedor_id,
      fornecedor_nome: r.fornecedor ? (r.fornecedor.razao_social ?? r.fornecedor.nome) : null,
      cliente_id: r.cliente_id,
      tipo_id: r.plano_conta_tipo_id,
      tipo_codigo: r.tipo?.codigo ?? "",
      tipo_nome: r.tipo?.nome ?? "",
      subtipo_id: r.plano_conta_subtipo_id,
      subtipo_nome: r.subtipo?.nome ?? "",
      frequencia: r.frequencia,
      dia_do_mes: r.dia_do_mes,
      dia_quinzena_1: r.dia_quinzena_1,
      dia_quinzena_2: r.dia_quinzena_2,
      dia_do_ano_dia: r.dia_do_ano_dia,
      dia_do_ano_mes: r.dia_do_ano_mes,
      proxima_data: r.proxima_data,
      data_fim: r.data_fim,
      ativo: r.ativo,
      forma_pagamento: r.forma_pagamento,
      cartao_credito_id: r.cartao_credito_id,
      valor_variavel: r.valor_variavel,
      texto_no_extrato: r.texto_no_extrato,
      situacao,
      rateio: (r.rateio ?? [])
        .map((x) => ({ regional_id: x.regional_id, nome: x.regional?.nome ?? "—", percentual: Number(x.percentual) }))
        .sort((x, y) => y.percentual - x.percentual || x.nome.localeCompare(y.nome, "pt-BR")),
      titulos: ts,
      previstas,
      pendentes: ts.filter((t) => t.semDocumento).length,
    };
  });

  return { recs, erro };
}
