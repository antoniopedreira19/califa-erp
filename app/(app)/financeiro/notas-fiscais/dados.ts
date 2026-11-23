/**
 * Notas Fiscais (decisão 271): a leitura das duas abas.
 *
 * - **Emitidas:** as notas que as empresas do grupo emitiram (`faturamentos`
 *   — job, BV, save e avulsa), com o recebimento pelos títulos a receber, e
 *   o histórico da planilha (decisão 211, só as cargas ativas). A linha tem
 *   o formato do Contas a Receber (`FaturadoRow`) para abrir o MESMO painel
 *   de leitura da nota emitida.
 * - **Tomadas:** as NFs emitidas contra os nossos CNPJs
 *   (`notas_fiscais_fornecedor`, o cadastro único da decisão 152), com os
 *   documentos que cada uma cobre — PP, desembolso e prestação da verba —
 *   e o pagamento deles. A NF do reembolso fica fora (ponto 4).
 *
 * As abas abrem em "Tudo": a página lê as notas de todas as datas e o
 * navegador de período recorta na tela. As listas passam de 1.000 linhas
 * (o histórico tem milhares de notas): tudo é lido página a página
 * (`todasAsLinhas`), ordenado por uma chave única.
 */
import type { createClient } from "@/lib/supabase/server";
import { todasAsLinhas } from "@/lib/supabase/todas-as-linhas";
import type { FaturadoRow } from "@/app/(app)/financeiro/contas-a-receber/faturamento-list";
import { recebimentoDaNota } from "@/app/(app)/financeiro/contas-a-receber/situacao-da-nota";
import { leituraEAtual } from "@/lib/ia/versao-nota-tomada";

type Supabase = ReturnType<typeof createClient>;
// As linhas vêm de selects com embeds; o formato é conferido na montagem.
type Linha = any;

export interface CnpjDaLista {
  id: string;
  nome: string;
  cnpj: string;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

// ---------------------------------------------------------------------------
// Emitidas
// ---------------------------------------------------------------------------

export type SituacaoDoRecebimento = "recebida" | "parcial" | "a_receber" | "vencida" | "cancelada" | "sem_registro";

/** A origem da nota: o tipo dos itens dela (uma nota de job com parte em
 *  save tem as duas) ou o histórico importado da planilha (decisão 211). */
export type OrigemDaNota = "job" | "bv" | "save" | "avulso" | "historico";
export const ORIGENS: OrigemDaNota[] = ["job", "bv", "save", "avulso", "historico"];

export interface NotaEmitida extends FaturadoRow {
  serie: string | null;
  /** O retido pelo cliente: nas baixas; no histórico, a coluna da planilha. */
  retido: number;
  /** O retido por imposto (a dica do valor). */
  retidoPorImposto: Array<{ imposto: string; valor: number }>;
  /** No histórico, os impostos que a planilha calculou por nota. */
  impostosDaPlanilha: { iss: number; pis: number; cofins: number; csll: number; ir: number; adicional_ir: number } | null;
  status: "emitido" | "cancelado";
  cancelado_em: string | null;
  motivo_cancelamento: string | null;
  /** O CNPJ que emitiu (o estabelecimento fiscal). */
  emissor: CnpjDaLista | null;
  /** CNPJ da nota; nas antigas e nas de BV, o do cadastro do cliente/fornecedor. */
  tomador_documento: string | null;
  origens: OrigemDaNota[];
  /** Os jobs da nota: dos itens de job e de save, do BV (o job do BV), o de
   *  referência da avulsa; no histórico, o da planilha. */
  jobs: Array<{ id: string | null; codigo: string | null; nome: string }>;
  /** Nota do histórico da planilha: sem painel nem PDF no sistema. */
  historico: boolean;
  /** No histórico: "sem job", "distribuição de lucro". */
  classe: string | null;
  /** O recebimento como a coluna da lista mostra (o `recebimento` herdado é
   *  o do painel do Contas a Receber, pelas mesmas regras de lá). */
  recebimentoNaLista: {
    situacao: SituacaoDoRecebimento;
    recebido: number;
    aberto: number;
    vencido: number;
    /** O próximo vencimento em aberto (ou o vencido mais antigo). */
    proximo: string | null;
    /** O último recebimento. */
    ultimo: string | null;
  };
}

export interface DadosDasEmitidas {
  notas: NotaEmitida[];
  empresas: Array<{ id: string; nome: string }>;
  infoPorJob: Record<
    string,
    {
      po: string | null;
      descricaoNf: string | null;
      contatos: never[];
      anexos: Array<{ id: string; nome_arquivo: string; path: string; mime_type: string; tamanho_bytes: number }>;
    }
  >;
  erro: boolean;
}

export async function carregarEmitidas(supabase: Supabase, tenantId: string, hoje: string): Promise<DadosDasEmitidas> {
  const [notasRes, empresasRes, estabRes, historicoRes] = await Promise.all([
    todasAsLinhas<Linha>((de, ate) =>
      supabase
        .from("faturamentos")
        .select(
          `id, numero_nf, serie, data_emissao, valor_total, descricao, cnae, anexo_nf_path, status,
           cancelado_em, motivo_cancelamento, cnpj_tomador, estabelecimento_id, fiscal_cnae_id, faturado_pelo_financeiro,
           empresa_id, origem_tipo, cliente_id, fornecedor_id, job_referencia_id,
           itens:faturamento_itens(id, origem_tipo, origem_id, valor),
           rateio:faturamentos_regionais(percentual, regional:regionais(nome))`,
        )
        .eq("tenant_id", tenantId)
        .order("data_emissao", { ascending: false })
        .order("id")
        .range(de, ate),
    ),
    supabase.from("empresas").select("id, razao_social, nome_fantasia").eq("tenant_id", tenantId).order("razao_social"),
    supabase.from("fiscal_estabelecimentos").select("id, nome, cnpj").eq("tenant_id", tenantId),
    // O histórico da planilha (decisão 211): só as cargas ativas, como os
    // relatórios. A política de leitura deixa só o administrador e o financeiro.
    todasAsLinhas<Linha>((de, ate) =>
      supabase
        .from("historico_notas")
        .select(
          `id, numero, situacao, classe, emissao, vencimento, recebimento, valor, estabelecimento, cliente,
           job_chave, job_nome, cnae, retencoes, iss, pis, cofins, csll, ir, adicional_ir,
           carga:historico_cargas!inner(situacao)`,
        )
        .eq("tenant_id", tenantId)
        .eq("carga.situacao", "ativa")
        .order("emissao", { ascending: false })
        .order("id")
        .range(de, ate),
    ),
  ]);
  const brutas = notasRes.data as Linha[];
  const ids = brutas.map((n) => n.id as string);
  const idsDosBvs = [
    ...new Set(brutas.flatMap((n) => ((n.itens ?? []) as Linha[]).filter((i) => i.origem_tipo === "bv" && i.origem_id).map((i) => i.origem_id as string))),
  ];
  const idsDosClientes = [...new Set(brutas.map((n) => n.cliente_id).filter(Boolean))] as string[];
  const idsDosFornecedores = [...new Set(brutas.map((n) => n.fornecedor_id).filter(Boolean))] as string[];
  const [bvsRes, titulosRes, clientesRes, fornecedoresRes] = await Promise.all([
    idsDosBvs.length ? supabase.from("itens_bv").select("id, job_id").in("id", idsDosBvs) : Promise.resolve({ data: [] as Linha[], error: null }),
    ids.length
      ? todasAsLinhas<Linha>((de, ate) =>
          supabase
            .from("titulos_receber")
            .select("id, faturamento_id, numero_parcela, valor, data_vencimento, status, pago_em")
            .eq("tenant_id", tenantId)
            .in("faturamento_id", ids)
            .order("id")
            .range(de, ate),
        )
      : Promise.resolve({ data: [] as Linha[], error: null }),
    idsDosClientes.length
      ? supabase.from("clientes").select("id, nome_fantasia, razao_social, cnpj").in("id", idsDosClientes)
      : Promise.resolve({ data: [] as Linha[], error: null }),
    idsDosFornecedores.length
      ? supabase.from("fornecedores").select("id, nome, razao_social, cpf_cnpj").in("id", idsDosFornecedores)
      : Promise.resolve({ data: [] as Linha[], error: null }),
  ]);
  const jobDoBv = new Map(((bvsRes.data ?? []) as Linha[]).map((b) => [b.id as string, b.job_id as string | null]));
  const jobIds = [
    ...new Set(
      brutas.flatMap((n) => [
        ...((n.itens ?? []) as Linha[])
          .map((i) => (i.origem_tipo === "bv" ? jobDoBv.get(i.origem_id) : i.origem_tipo === "avulso" ? null : i.origem_id))
          .filter(Boolean),
        ...(n.job_referencia_id ? [n.job_referencia_id] : []),
      ]),
    ),
  ] as string[];
  const idsDosTitulos = ((titulosRes.data ?? []) as Linha[]).map((t) => t.id as string);
  const [baixasRes, jobsRes, enviosRes] = await Promise.all([
    // As baixas dos títulos (decisão 125: pode haver várias por título): o
    // recebido parcial. O retido pelo cliente conta como recebido, como na
    // aba Títulos a Receber.
    idsDosTitulos.length
      ? todasAsLinhas<Linha>((de, ate) =>
          supabase
            .from("lancamentos_financeiros")
            .select("id, titulo_receber_id, valor, data_movimento, retencoes:baixas_retencoes(imposto, valor)")
            .eq("tenant_id", tenantId)
            .eq("origem", "titulo_baixa")
            .in("titulo_receber_id", idsDosTitulos)
            .order("id")
            .range(de, ate),
        )
      : Promise.resolve({ data: [] as Linha[], error: null }),
    jobIds.length ? supabase.from("jobs").select("id, codigo, nome").in("id", jobIds) : Promise.resolve({ data: [] as Linha[], error: null }),
    jobIds.length
      ? supabase
          .from("jobs_envio_faturamento")
          .select(
            "job_id, numero_po, descricao_nf, anexos:jobs_envio_faturamento_anexos!jobs_envio_faturamento_anexos_envio_id_fkey(id, nome_arquivo, path, mime_type, tamanho_bytes)",
          )
          .eq("tenant_id", tenantId)
          .in("job_id", jobIds)
      : Promise.resolve({ data: [] as Linha[], error: null }),
  ]);
  for (const [nome, r] of [
    ["notas", notasRes],
    ["historico", historicoRes],
    ["titulos", titulosRes],
    ["baixas", baixasRes],
    ["jobs", jobsRes],
  ] as const)
    if (r.error) console.error(`[nf.emitidas.${nome}]`, r.error.message);

  const cliente = new Map(((clientesRes.data ?? []) as Linha[]).map((c) => [c.id as string, c]));
  const fornecedor = new Map(((fornecedoresRes.data ?? []) as Linha[]).map((f) => [f.id as string, f]));
  const estab = new Map(((estabRes.data ?? []) as Linha[]).map((e) => [e.id as string, e]));
  const job = new Map(((jobsRes.data ?? []) as Linha[]).map((j) => [j.id as string, j]));
  const estabPorNome = new Map(((estabRes.data ?? []) as Linha[]).map((e) => [e.nome as string, e]));
  const baixadoDoTitulo = new Map<string, { valor: number; ultima: string }>();
  const retidoPorImpostoDoTitulo = new Map<string, Map<string, number>>();
  for (const b of (baixasRes.data ?? []) as Linha[]) {
    const atual = baixadoDoTitulo.get(b.titulo_receber_id) ?? { valor: 0, ultima: "" };
    const retencoes = (b.retencoes ?? []) as Linha[];
    const retido = retencoes.reduce((s, r) => s + Number(r.valor), 0);
    const m = retidoPorImpostoDoTitulo.get(b.titulo_receber_id) ?? new Map<string, number>();
    for (const r of retencoes) m.set(String(r.imposto), r2((m.get(String(r.imposto)) ?? 0) + Number(r.valor)));
    retidoPorImpostoDoTitulo.set(b.titulo_receber_id, m);
    baixadoDoTitulo.set(b.titulo_receber_id, {
      valor: r2(atual.valor + Number(b.valor) + retido),
      ultima: String(b.data_movimento) > atual.ultima ? String(b.data_movimento) : atual.ultima,
    });
  }
  const titulosPorNota = new Map<string, Linha[]>();
  for (const t of (titulosRes.data ?? []) as Linha[]) {
    const l = titulosPorNota.get(t.faturamento_id) ?? [];
    l.push(t);
    titulosPorNota.set(t.faturamento_id, l);
  }

  const infoPorJob: DadosDasEmitidas["infoPorJob"] = {};
  for (const e of (enviosRes.data ?? []) as Linha[]) {
    const atual = infoPorJob[e.job_id];
    const pos = new Set([atual?.po, e.numero_po].filter(Boolean) as string[]);
    infoPorJob[e.job_id] = {
      po: pos.size ? [...pos].join(" · ") : null,
      descricaoNf: atual?.descricaoNf ?? e.descricao_nf ?? null,
      contatos: [],
      anexos: [...(atual?.anexos ?? []), ...((e.anexos ?? []) as Linha[]).map((a) => ({ ...a, tamanho_bytes: Number(a.tamanho_bytes) }))],
    };
  }

  const notas: NotaEmitida[] = brutas.map((f) => {
    const titulos = (titulosPorNota.get(f.id) ?? []).sort((a, b) => Number(a.numero_parcela) - Number(b.numero_parcela));
    const cancelada = f.status === "cancelado";
    const vivos = titulos.filter((t) => t.status !== "cancelado");
    const recebidoDo = (t: Linha) => (t.status === "pago" ? Number(t.valor) : Math.min(Number(t.valor), baixadoDoTitulo.get(t.id)?.valor ?? 0));
    const recebido = r2(vivos.reduce((s, t) => s + recebidoDo(t), 0));
    const abertos = vivos.filter((t) => t.status !== "pago");
    const aberto = r2(abertos.reduce((s, t) => s + Number(t.valor) - recebidoDo(t), 0));
    const vencidos = abertos.filter((t) => t.data_vencimento < hoje);
    const vencido = r2(vencidos.reduce((s, t) => s + Number(t.valor) - recebidoDo(t), 0));
    const situacao: SituacaoDoRecebimento = cancelada
      ? "cancelada"
      : abertos.length === 0
        ? "recebida"
        : vencidos.length > 0
          ? "vencida"
          : recebido > 0
            ? "parcial"
            : "a_receber";
    const pagos = vivos
      .map((t) => (t.pago_em ? String(t.pago_em) : baixadoDoTitulo.get(t.id)?.ultima ?? ""))
      .filter(Boolean)
      .sort();
    const cli = f.cliente_id ? cliente.get(f.cliente_id) : null;
    const forn = f.fornecedor_id ? fornecedor.get(f.fornecedor_id) : null;
    const e = f.estabelecimento_id ? estab.get(f.estabelecimento_id) : null;
    const itens = (f.itens ?? []) as Linha[];
    const jobsDaNota: Array<{ job_id: string; codigo: string }> = [];
    for (const i of itens) {
      if (i.origem_tipo !== "job" || !i.origem_id || jobsDaNota.some((j) => j.job_id === i.origem_id)) continue;
      const j = job.get(i.origem_id);
      if (j) jobsDaNota.push({ job_id: j.id, codigo: j.codigo });
    }
    const idsDosJobs = [
      ...new Set(
        [
          ...itens.map((i) => (i.origem_tipo === "bv" ? jobDoBv.get(i.origem_id) : i.origem_tipo === "avulso" ? null : i.origem_id)),
          f.job_referencia_id,
        ].filter(Boolean) as string[],
      ),
    ];
    const origens = ORIGENS.filter((o) => itens.some((i) => i.origem_tipo === o));
    if (!origens.length) origens.push(f.origem_tipo);
    const somaRetida = new Map<string, number>();
    for (const t of titulos) for (const [imp, v] of retidoPorImpostoDoTitulo.get(t.id) ?? []) somaRetida.set(imp, r2((somaRetida.get(imp) ?? 0) + v));
    return {
      faturamento_id: f.id,
      numero_nf: f.numero_nf,
      serie: f.serie ?? null,
      retido: r2([...somaRetida.values()].reduce((s, v) => s + v, 0)),
      retidoPorImposto: [...somaRetida].map(([imposto, valor]) => ({ imposto, valor })),
      impostosDaPlanilha: null,
      data_emissao: f.data_emissao,
      valor_total: Number(f.valor_total),
      descricao: f.descricao,
      cnae: f.cnae,
      cnpj_tomador: f.cnpj_tomador,
      estabelecimento_id: f.estabelecimento_id ?? null,
      fiscal_cnae_id: f.fiscal_cnae_id ?? null,
      anexo_nf_path: f.anexo_nf_path,
      empresa_id: f.empresa_id,
      origem_tipo: f.origem_tipo,
      contraparte_nome: (forn ? forn.nome : cli?.nome_fantasia ?? cli?.razao_social) ?? "—",
      cliente_id: f.cliente_id,
      qtd_parcelas: titulos.length || 1,
      primeiro_vencimento: titulos[0]?.data_vencimento ?? null,
      parcelas: titulos.map((t) => ({ numero: Number(t.numero_parcela), valor: Number(t.valor), data_vencimento: t.data_vencimento })),
      rateio: ((f.rateio ?? []) as Linha[])
        .map((r) => ({ regional_nome: r.regional?.nome ?? "—", percentual: Number(r.percentual) }))
        .sort((a, b) => b.percentual - a.percentual),
      jobs_cobertos: jobsDaNota,
      autores: [],
      itens: itens.map((i) => {
        const j = i.origem_id ? job.get(i.origem_id) : null;
        return {
          origem_tipo: i.origem_tipo,
          origem_id: i.origem_id,
          codigo: j?.codigo ?? (i.origem_tipo === "bv" ? "BV" : i.origem_tipo === "save" ? "Save" : "Avulso"),
          descricao: i.origem_tipo === "save" ? "Saldo em save — crédito do cliente" : (j?.nome ?? f.descricao),
          valor: Number(i.valor),
        };
      }),
      status: cancelada ? "cancelado" : "emitido",
      cancelado_em: f.cancelado_em ?? null,
      motivo_cancelamento: f.motivo_cancelamento ?? null,
      emissor: e ? { id: e.id, nome: e.nome, cnpj: e.cnpj ?? "" } : null,
      tomador_documento: f.cnpj_tomador ?? cli?.cnpj ?? forn?.cpf_cnpj ?? null,
      origens,
      jobs: idsDosJobs
        .map((id) => job.get(id))
        .filter(Boolean)
        .map((j: Linha) => ({ id: j.id, codigo: j.codigo, nome: j.nome })),
      historico: false,
      classe: null,
      pelo_financeiro: f.faturado_pelo_financeiro === true,
      recebimento: recebimentoDaNota(
        titulos.map((t) => ({
          status: t.status,
          valor: Number(t.valor),
          baixado: t.status === "pago" ? Number(t.valor) : (baixadoDoTitulo.get(t.id)?.valor ?? 0),
          baixas: baixadoDoTitulo.has(t.id) ? [baixadoDoTitulo.get(t.id)] : [],
          data_vencimento: t.data_vencimento,
          pago_em: t.pago_em ?? null,
        })),
        hoje,
        Number(f.valor_total),
      ),
      recebimentoNaLista: {
        situacao,
        recebido,
        aberto,
        vencido,
        proximo: (vencidos[0] ?? abertos[0])?.data_vencimento ?? null,
        ultimo: pagos.length ? pagos[pagos.length - 1] : null,
      },
    } satisfies NotaEmitida;
  });

  // O histórico: a mesma linha, sem títulos — o recebimento é a data da planilha.
  // A nota que também está no sistema (mesmo número e CNPJ emissor, como a
  // 6116 de 13/08/2026) aparece uma vez só, pela do sistema.
  const noSistema = new Set(brutas.filter((f) => f.estabelecimento_id).map((f) => `${f.estabelecimento_id}|${f.numero_nf}`));
  const historicas: NotaEmitida[] = (historicoRes.data as Linha[])
    .filter((h) => {
      const e = h.estabelecimento ? estabPorNome.get(h.estabelecimento) : null;
      return !(e && noSistema.has(`${e.id}|${h.numero}`));
    })
    .map((h) => {
      const e = h.estabelecimento ? estabPorNome.get(h.estabelecimento) : null;
      const cancelada = h.situacao === "cancelada";
      const valor = Number(h.valor);
      const temJob = h.job_nome || h.job_chave;
      return {
        faturamento_id: "historico:" + h.id,
        numero_nf: String(h.numero ?? ""),
        serie: null,
        retido: Number(h.retencoes ?? 0),
        retidoPorImposto: [],
        impostosDaPlanilha:
          h.iss == null && h.pis == null && h.ir == null
            ? null
            : {
                iss: Number(h.iss ?? 0),
                pis: Number(h.pis ?? 0),
                cofins: Number(h.cofins ?? 0),
                csll: Number(h.csll ?? 0),
                ir: Number(h.ir ?? 0),
                adicional_ir: Number(h.adicional_ir ?? 0),
              },
        data_emissao: h.emissao,
        valor_total: valor,
        descricao: "",
        cnae: h.cnae ?? "",
        cnpj_tomador: null,
        estabelecimento_id: e?.id ?? null,
        fiscal_cnae_id: null,
        anexo_nf_path: "",
        empresa_id: "",
        origem_tipo: "avulso",
        contraparte_nome: h.cliente ?? "—",
        cliente_id: null,
        qtd_parcelas: 1,
        primeiro_vencimento: h.vencimento ?? null,
        parcelas: [],
        rateio: [],
        jobs_cobertos: [],
        autores: [],
        itens: [],
        status: cancelada ? "cancelado" : "emitido",
        cancelado_em: null,
        motivo_cancelamento: null,
        emissor: e ? { id: e.id, nome: e.nome, cnpj: e.cnpj ?? "" } : h.estabelecimento ? { id: "", nome: h.estabelecimento, cnpj: "" } : null,
        tomador_documento: null,
        origens: ["historico"],
        jobs: temJob ? [{ id: null, codigo: h.job_chave ?? null, nome: h.job_nome ?? h.job_chave }] : [],
        historico: true,
        classe: temJob ? null : h.classe ?? null,
        pelo_financeiro: false,
        recebimento: { situacao: h.recebimento ? "recebida" : "a_receber", detalhe: null, partes: [] },
        recebimentoNaLista: {
          situacao: cancelada ? "cancelada" : h.recebimento ? "recebida" : "sem_registro",
          recebido: !cancelada && h.recebimento ? valor : 0,
          aberto: 0,
          vencido: 0,
          proximo: h.vencimento ?? null,
          ultimo: h.recebimento ?? null,
        },
      } satisfies NotaEmitida;
    });

  return {
    notas: [...notas, ...historicas].sort(
      (a, b) =>
        b.data_emissao.localeCompare(a.data_emissao) ||
        (Number(b.numero_nf.replace(/\D/g, "")) || 0) - (Number(a.numero_nf.replace(/\D/g, "")) || 0),
    ),
    empresas: ((empresasRes.data ?? []) as Linha[]).map((e) => ({ id: e.id, nome: e.razao_social ?? e.nome_fantasia ?? "" })),
    infoPorJob,
    erro: Boolean(notasRes.error || titulosRes.error || baixasRes.error || historicoRes.error),
  };
}

// ---------------------------------------------------------------------------
// Tomadas
// ---------------------------------------------------------------------------

export type SituacaoDaTomada = "registrada" | "em_avaliacao" | "sem_pp";
export type SituacaoDoPagamento = "paga" | "parcial" | "a_pagar" | "sem_pagamento";

/** De onde vem o documento que usa a nota. */
export type OrigemDoDocumento = "pp" | "desembolso" | "prestacao";
export const ORIGENS_DO_DOCUMENTO: OrigemDoDocumento[] = ["pp", "desembolso", "prestacao"];
export const ROTULO_DA_ORIGEM: Record<OrigemDoDocumento, string> = {
  pp: "PP",
  desembolso: "Desembolso",
  prestacao: "Prestação da verba",
};

/** Um documento que usa a nota, de qualquer origem. */
export interface DocumentoDaNota {
  origem: OrigemDoDocumento;
  /** O id do documento (PP, desembolso, prestação). */
  id: string;
  /** Na PP e na prestação: a PP (a tela que abre). */
  ppId: string | null;
  codigo: string;
  descricao: string;
  job: { codigo: string; nome: string } | null;
  status: string;
  rotuloStatus: string;
  cor: "ambar" | "azul" | "verde" | "cinza" | "vermelho";
  /** Vale para o saldo da nota (não rejeitado, não cancelado). */
  vale: boolean;
  /** A parte da nota neste documento. */
  parte: number;
  pago: number;
  aPagar: number;
  proximo: string | null;
  anexo: { tabela: TabelaDoAnexo; id: string; nome: string } | null;
}

export type TabelaDoAnexo = "pedidos_compra_anexos" | "desembolsos_anexos" | "pp_verba_prestacoes_anexos";

/** Quantas notas uma chamada da leitura ampliada lê (a tela chama de novo até acabar). */
export const NOTAS_POR_LEITURA = 4;

export interface NotaTomada {
  id: string;
  numero: string;
  data_emissao: string;
  valor: number;
  fornecedor: { id: string; nome: string; razao_social: string | null; documento: string | null; regime: string | null };
  tomador: CnpjDaLista | null;
  registrada_em: string | null;
  /** "na aprovação da PP-00601", "na aprovação do DES-00012". */
  registrada_onde: string | null;
  iss_retido_aliquota: number | null;
  credito_retirado: boolean;
  credito_motivo: string | null;
  documentos: DocumentoDaNota[];
  origens: OrigemDoDocumento[];
  /** Soma das partes nos documentos que valem. */
  nasDocumentos: number;
  situacao: SituacaoDaTomada;
  pagamento: { situacao: SituacaoDoPagamento; pago: number; aPagar: number; proximo: string | null };
  /** O que a leitura da NF traz (decisão 271). */
  leitura: LeituraDaNota;
}

export interface LeituraDaNota {
  /** A leitura já rodou, na versão atual do esquema (`leitura_modelo`). */
  lida: boolean;
  descricao: string | null;
  /** O CNAE da nota; sem ele, o do cadastro do emitente (`cnaeDoCadastro`). */
  cnae: string | null;
  cnaeDoCadastro: string | null;
  /** O código de tributação do serviço / item da LC 116. */
  codigoServico: string | null;
  municipio: string | null;
  /** "AAAA-MM". */
  competencia: string | null;
  codigoVerificacao: string | null;
  retencoes: Array<{ imposto: string; aliquota: number | null; valor: number }>;
  retido: number;
  liquido: number;
}

export interface DadosDasTomadas {
  notas: NotaTomada[];
  erro: boolean;
}

const PP_VALE = (s: string) => s === "em_avaliacao" || s === "aprovada" || s === "pago";
const ROTULO_PP: Record<string, [string, DocumentoDaNota["cor"]]> = {
  em_avaliacao: ["Em avaliação", "ambar"],
  aprovada: ["Aprovada", "azul"],
  pago: ["Paga", "verde"],
  rejeitada: ["Rejeitada", "vermelho"],
  cancelada: ["Cancelada", "cinza"],
};
const ROTULO_DES: Record<string, [string, DocumentoDaNota["cor"]]> = {
  em_avaliacao: ["Em avaliação", "ambar"],
  aprovada: ["Aprovado", "azul"],
  pago: ["Pago", "verde"],
  rejeitada: ["Rejeitado", "vermelho"],
  cancelada: ["Cancelado", "cinza"],
};

export async function carregarTomadas(supabase: Supabase, tenantId: string): Promise<DadosDasTomadas> {
  const [notasRes, estabRes, ppAnx, desAnx, preAnx] = await Promise.all([
    todasAsLinhas<Linha>((de, ate) =>
      supabase
        .from("notas_fiscais_fornecedor")
        .select(
          `id, numero, data_emissao, valor, tomador_estabelecimento_id, registrada_em, registrada_na_pp_id, registrada_no_desembolso_id,
           iss_retido_aliquota, credito_pis_cofins_retirado, credito_pis_cofins_motivo,
           leitura_em, leitura_modelo, cnae, codigo_servico, descricao_servico, municipio_prestacao, competencia, codigo_verificacao, retencoes,
           fornecedor:fornecedores(id, nome, razao_social, cpf_cnpj, regime_tributario, cnae)`,
        )
        .eq("tenant_id", tenantId)
        .order("data_emissao", { ascending: false })
        .order("id")
        .range(de, ate),
    ),
    supabase.from("fiscal_estabelecimentos").select("id, nome, cnpj").eq("tenant_id", tenantId),
    todasAsLinhas<Linha>((de, ate) =>
      supabase
        .from("pedidos_compra_anexos")
        .select(
          `id, nota_fiscal_id, nf_valor_na_pp, arquivo_nome_original,
           pedido:pedidos_compra(id, codigo, status, valor,
             job:jobs(id, codigo, nome),
             parcelas:pedidos_compra_parcelas(valor, pago_em, data_pagamento, data_vencimento))`,
        )
        .eq("tenant_id", tenantId)
        .not("nota_fiscal_id", "is", null)
        .order("id")
        .range(de, ate),
    ),
    todasAsLinhas<Linha>((de, ate) =>
      supabase
        .from("desembolsos_anexos")
        .select(
          `id, nota_fiscal_id, nf_valor_no_pedido, nf_valor, arquivo_nome_original,
           desembolso:desembolsos(id, codigo, status, valor, descricao, favorecido_tipo,
             parcelas:desembolsos_parcelas(valor, pago_em, data_pagamento, data_vencimento))`,
        )
        .eq("tenant_id", tenantId)
        .not("nota_fiscal_id", "is", null)
        .order("id")
        .range(de, ate),
    ),
    todasAsLinhas<Linha>((de, ate) =>
      supabase
        .from("pp_verba_prestacoes_anexos")
        .select(
          `id, nota_fiscal_id, valor, arquivo_nome_original, descricao,
           prestacao:pp_verba_prestacoes(id, status, pedido:pedidos_compra(id, codigo, job:jobs(id, codigo, nome)))`,
        )
        .eq("tenant_id", tenantId)
        .not("nota_fiscal_id", "is", null)
        .order("id")
        .range(de, ate),
    ),
  ]);
  for (const [nome, r] of [
    ["notas", notasRes],
    ["pps", ppAnx],
    ["desembolsos", desAnx],
    ["prestacoes", preAnx],
  ] as const)
    if (r.error) console.error(`[nf.tomadas.${nome}]`, r.error.message);

  const estab = new Map(((estabRes.data ?? []) as Linha[]).map((e) => [e.id as string, e]));
  const docs = new Map<string, DocumentoDaNota[]>();
  const add = (notaId: string, d: DocumentoDaNota) => {
    const lista = docs.get(notaId) ?? [];
    if (!lista.some((x) => x.origem === d.origem && x.id === d.id)) lista.push(d);
    docs.set(notaId, lista);
  };

  for (const a of ppAnx.data as Linha[]) {
    const p = a.pedido;
    if (!p) continue;
    const parcelas = (p.parcelas ?? []) as Linha[];
    const pagoDaPP = r2(parcelas.filter((x) => x.pago_em).reduce((s, x) => s + Number(x.valor), 0));
    const abertas = parcelas
      .filter((x) => !x.pago_em)
      .map((x) => String(x.data_pagamento ?? x.data_vencimento))
      .sort();
    const parte = Number(a.nf_valor_na_pp ?? p.valor);
    const pago = Number(p.valor) > 0 ? r2((parte * pagoDaPP) / Number(p.valor)) : 0;
    const [rotulo, cor] = ROTULO_PP[p.status] ?? [p.status, "cinza"];
    add(a.nota_fiscal_id, {
      origem: "pp",
      id: p.id,
      ppId: p.id,
      codigo: p.codigo,
      descricao: p.job?.nome ?? "",
      job: p.job ? { codigo: p.job.codigo, nome: p.job.nome } : null,
      status: p.status,
      rotuloStatus: rotulo,
      cor,
      vale: PP_VALE(p.status),
      parte,
      pago,
      aPagar: p.status === "aprovada" ? r2(parte - pago) : 0,
      proximo: p.status === "aprovada" ? abertas[0] ?? null : null,
      anexo: { tabela: "pedidos_compra_anexos", id: a.id, nome: a.arquivo_nome_original },
    });
  }
  for (const a of desAnx.data as Linha[]) {
    const d = a.desembolso;
    // A NF do reembolso fica fora do controle (decisão 271, ponto 4).
    if (!d || d.favorecido_tipo === "reembolso") continue;
    const parcelas = (d.parcelas ?? []) as Linha[];
    const pagoDoDes = r2(parcelas.filter((x) => x.pago_em).reduce((s, x) => s + Number(x.valor), 0));
    const abertas = parcelas
      .filter((x) => !x.pago_em)
      .map((x) => String(x.data_pagamento ?? x.data_vencimento))
      .sort();
    const parte = Number(a.nf_valor_no_pedido ?? a.nf_valor ?? d.valor);
    const pago = Number(d.valor) > 0 ? r2((parte * pagoDoDes) / Number(d.valor)) : 0;
    const [rotulo, cor] = ROTULO_DES[d.status] ?? [d.status, "cinza"];
    add(a.nota_fiscal_id, {
      origem: "desembolso",
      id: d.id,
      ppId: null,
      codigo: d.codigo,
      descricao: d.descricao,
      job: null,
      status: d.status,
      rotuloStatus: rotulo,
      cor,
      vale: d.status !== "rejeitada" && d.status !== "cancelada",
      parte,
      pago,
      aPagar: d.status === "aprovada" ? r2(parte - pago) : 0,
      proximo: d.status === "aprovada" ? abertas[0] ?? null : null,
      anexo: { tabela: "desembolsos_anexos", id: a.id, nome: a.arquivo_nome_original },
    });
  }
  for (const a of preAnx.data as Linha[]) {
    const pr = a.prestacao;
    // Desde a 269 a NF entra no envio: valem as enviadas e as aprovadas.
    if (!pr || (pr.status !== "aprovada" && pr.status !== "em_avaliacao")) continue;
    const aprovada = pr.status === "aprovada";
    const pp = pr.pedido;
    add(a.nota_fiscal_id, {
      origem: "prestacao",
      id: pr.id,
      ppId: pp?.id ?? null,
      codigo: pp ? `${pp.codigo} · prestação` : "Prestação",
      descricao: a.descricao ?? "",
      job: pp?.job ? { codigo: pp.job.codigo, nome: pp.job.nome } : null,
      status: pr.status,
      rotuloStatus: aprovada ? "Aprovada" : "Em avaliação",
      cor: aprovada ? "verde" : "ambar",
      vale: true,
      parte: Number(a.valor ?? 0),
      // A loja já foi paga pela verba: nada a pagar pela nota.
      pago: Number(a.valor ?? 0),
      aPagar: 0,
      proximo: null,
      anexo: { tabela: "pp_verba_prestacoes_anexos", id: a.id, nome: a.arquivo_nome_original },
    });
  }

  const notas: NotaTomada[] = [];
  for (const n of notasRes.data as Linha[]) {
    const documentos = (docs.get(n.id) ?? []).sort(
      (a, b) => ORIGENS_DO_DOCUMENTO.indexOf(a.origem) - ORIGENS_DO_DOCUMENTO.indexOf(b.origem) || a.codigo.localeCompare(b.codigo),
    );
    const valem = documentos.filter((d) => d.vale);
    const nasDocumentos = r2(valem.reduce((s, d) => s + d.parte, 0));
    const pago = r2(valem.reduce((s, d) => s + d.pago, 0));
    const aPagar = r2(valem.reduce((s, d) => s + d.aPagar, 0));
    const comPagamento = valem.filter((d) => d.pago > 0 || d.aPagar > 0);
    const situacaoPag: SituacaoDoPagamento =
      comPagamento.length === 0 ? "sem_pagamento" : aPagar <= 0.004 ? "paga" : pago > 0.004 ? "parcial" : "a_pagar";
    const proximos = valem
      .map((d) => d.proximo)
      .filter(Boolean)
      .sort() as string[];
    const e = n.tomador_estabelecimento_id ? estab.get(n.tomador_estabelecimento_id) : null;
    const registradaEm: string | null = n.registrada_em ?? null;
    const pp = n.registrada_na_pp_id ? documentos.find((d) => d.id === n.registrada_na_pp_id)?.codigo ?? null : null;
    const des = n.registrada_no_desembolso_id ? documentos.find((d) => d.id === n.registrada_no_desembolso_id)?.codigo ?? null : null;
    const onde = !registradaEm
      ? null
      : pp
        ? `na aprovação da ${pp}`
        : des
          ? `na aprovação do ${des}`
          : documentos[0]?.origem === "prestacao"
            ? "na aprovação da prestação"
            : null;
    // A leitura de outra versão do esquema não conta: a nota volta a ser lida.
    const lida = Boolean(n.leitura_em) && leituraEAtual(n.leitura_modelo);
    const retencoes: LeituraDaNota["retencoes"] = ((lida ? n.retencoes : null) ?? ([] as Linha[])).map((r: Linha) => ({
      imposto: String(r.imposto),
      aliquota: r.aliquota == null ? null : Number(r.aliquota),
      valor: Number(r.valor),
    }));
    const retido = r2(retencoes.reduce((s, r) => s + r.valor, 0));
    notas.push({
      id: n.id,
      numero: n.numero,
      data_emissao: n.data_emissao,
      valor: Number(n.valor),
      fornecedor: {
        id: n.fornecedor?.id ?? "",
        nome: n.fornecedor?.nome ?? "—",
        razao_social: n.fornecedor?.razao_social ?? null,
        documento: n.fornecedor?.cpf_cnpj ?? null,
        regime: n.fornecedor?.regime_tributario ?? null,
      },
      tomador: e ? { id: e.id, nome: e.nome, cnpj: e.cnpj ?? "" } : null,
      registrada_em: registradaEm,
      registrada_onde: onde,
      iss_retido_aliquota: n.iss_retido_aliquota == null ? null : Number(n.iss_retido_aliquota),
      credito_retirado: n.credito_pis_cofins_retirado === true,
      credito_motivo: n.credito_pis_cofins_motivo ?? null,
      documentos,
      origens: [...new Set(documentos.map((d) => d.origem))],
      nasDocumentos,
      situacao: valem.length === 0 ? "sem_pp" : registradaEm ? "registrada" : "em_avaliacao",
      pagamento: { situacao: situacaoPag, pago, aPagar: Math.max(0, aPagar), proximo: proximos[0] ?? null },
      leitura: {
        lida,
        descricao: lida ? (n.descricao_servico ?? null) : null,
        cnae: lida ? (n.cnae ?? null) : null,
        cnaeDoCadastro: n.fornecedor?.cnae ?? null,
        codigoServico: lida ? (n.codigo_servico ?? null) : null,
        municipio: lida ? (n.municipio_prestacao ?? null) : null,
        competencia: lida && n.competencia ? String(n.competencia).slice(0, 7) : null,
        codigoVerificacao: lida ? (n.codigo_verificacao ?? null) : null,
        retencoes,
        retido,
        liquido: r2(Number(n.valor) - retido),
      },
    });
  }

  return { notas, erro: Boolean(notasRes.error || ppAnx.error || desAnx.error || preAnx.error) };
}

// ---------------------------------------------------------------------------
// Os CNPJs do grupo (o filtro das duas abas)
// ---------------------------------------------------------------------------

export async function carregarCnpjs(supabase: Supabase, tenantId: string): Promise<CnpjDaLista[]> {
  const { data } = await supabase.from("fiscal_estabelecimentos").select("id, nome, cnpj, ativo").eq("tenant_id", tenantId).order("ordem").order("nome");
  return ((data ?? []) as Linha[]).filter((e) => e.ativo !== false && e.cnpj).map((e) => ({ id: e.id, nome: e.nome, cnpj: e.cnpj }));
}
