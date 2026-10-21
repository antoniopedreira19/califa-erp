"use server";

/**
 * O ⓘ das planilhas de títulos (decisão 195, variante A): a trilha da
 * origem, o pagamento e os documentos de UM título, lidos quando o pop-up
 * abre. As listas não carregam isso para todos os títulos.
 *
 * ⚠️ A action recebe a CHAVE do título (`pagar|pp|<id>`, `imposto|<id>`…),
 * nunca bucket e caminho: cada caminho é re-derivado aqui, com o filtro do
 * tenant, e só então assinado — o mesmo cuidado de `abrirDocumentoDoLancamento`
 * (conciliacao/actions-documento.ts). Só leitura; só administrador e
 * financeiro, como as telas que mostram o ⓘ.
 */

import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatBRL } from "@/lib/format";
import { formatDiaBr } from "@/lib/formatar-data-hora";
import { formaPagamentoLabel, type FormaPagamento } from "@/lib/types";
import {
  ehImagem,
  nomeDoCaminho,
  rotuloDaChavePix,
  rotuloDoAnexo,
  type DetalhesDoTitulo,
  type DocumentoDoDetalhe,
} from "@/lib/financeiro/detalhes-do-titulo";

type Resultado = { ok: true; detalhes: DetalhesDoTitulo } | { ok: false; message: string };

/** A URL vive o bastante para o visualizador ficar aberto. */
const TTL_SEGUNDOS = 60 * 10;

const NAO_ENCONTRADO: Resultado = { ok: false, message: "Título não encontrado." };

type Supabase = ReturnType<typeof createClient>;

interface Anexo {
  arquivo_path: string;
  arquivo_nome_original: string | null;
  arquivo_mimetype?: string | null;
  documento_tipo: string | null;
  documento_numero: string | null;
}

interface Pedido {
  bucket: string;
  path: string;
  grupo: "origem" | "pagamento";
  tipo: string;
  arquivo: string;
  mimetype: string | null;
}

/** Assina os caminhos, um bucket por vez, e devolve os documentos na ordem
 *  pedida. O que não assinar fica com `url` nula (o visualizador avisa). */
async function assinar(supabase: Supabase, pedidos: Pedido[]): Promise<DocumentoDoDetalhe[]> {
  const porBucket = new Map<string, Pedido[]>();
  for (const p of pedidos) porBucket.set(p.bucket, [...(porBucket.get(p.bucket) ?? []), p]);
  const urls = new Map<string, string>();
  await Promise.all(
    [...porBucket.entries()].map(async ([bucket, lista]) => {
      const { data } = await supabase.storage.from(bucket).createSignedUrls(
        lista.map((p) => p.path),
        TTL_SEGUNDOS,
      );
      for (const d of data ?? []) if (d.path && d.signedUrl) urls.set(`${bucket}|${d.path}`, d.signedUrl);
    }),
  );
  return pedidos.map((p) => ({
    grupo: p.grupo,
    tipo: p.tipo,
    arquivo: p.arquivo,
    url: urls.get(`${p.bucket}|${p.path}`) ?? null,
    imagem: ehImagem(p.arquivo, p.mimetype),
  }));
}

function anexosParaPedidos(bucket: string, anexos: Anexo[] | null | undefined): Pedido[] {
  return (anexos ?? []).map((a) => {
    const arquivo = a.arquivo_nome_original || nomeDoCaminho(a.arquivo_path);
    return {
      bucket,
      path: a.arquivo_path,
      grupo: "pagamento" as const,
      tipo: rotuloDoAnexo(a.documento_tipo, a.documento_numero, arquivo),
      arquivo,
      mimetype: a.arquivo_mimetype ?? null,
    };
  });
}

function cartaoTexto(c: { nome: string | null; ultimos_4_digitos: string | null } | null): string {
  if (!c) return "";
  return `${c.nome ?? "Cartão"}${c.ultimos_4_digitos ? ` ••••${c.ultimos_4_digitos}` : ""}`;
}

function parcelaTexto(numero: number | null | undefined, total: number): string | null {
  return total > 1 && numero ? `${numero} de ${total}` : null;
}

/** O pagamento pela forma prevista, quando ela não diz mais nada. */
function pagamentoPelaForma(
  forma: FormaPagamento | null,
  cartao: { nome: string | null; ultimos_4_digitos: string | null } | null,
  codigoBarras: string | null,
): { linha: string; detalhe: string | null } {
  if (codigoBarras) return { linha: "Boleto", detalhe: codigoBarras };
  if (forma === "cartao_credito") {
    return {
      linha: `Aprovado para o cartão ${cartaoTexto(cartao)}`.trim(),
      detalhe: "É só a intenção: a forma se confirma na baixa",
    };
  }
  if (forma) return { linha: formaPagamentoLabel(forma), detalhe: null };
  return { linha: "A forma se escolhe na baixa", detalhe: null };
}

// ---------------------------------------------------------------------------
// Por origem
// ---------------------------------------------------------------------------

async function daPP(supabase: Supabase, tenantId: string, id: string): Promise<Resultado> {
  const { data: par } = await supabase
    .from("pedidos_compra_parcelas")
    .select(
      `id, numero, codigo_barras, fatura_cartao_id, pago_em,
       fatura:faturas_cartao!fatura_cartao_id(codigo),
       pp:pedidos_compra!pedido_compra_id(
         codigo, created_at, enviada_financeiro_em, aprovada_em, pdf_path,
         forma_pagamento, fornecedor_pix_tipo, fornecedor_pix_chave,
         fornecedor_banco_nome, fornecedor_agencia, fornecedor_conta, fornecedor_conta_dv,
         pagamento_fora_do_cadastro_meio,
         cartao:cartoes_credito!cartao_credito_id(nome, ultimos_4_digitos),
         parcelas:pedidos_compra_parcelas!pedido_compra_id(id),
         anexos:pedidos_compra_anexos!pedido_compra_id(arquivo_path, arquivo_nome_original, arquivo_mimetype, documento_tipo, documento_numero)
       )`,
    )
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle<any>();
  const pp = par?.pp;
  if (!par || !pp) return NAO_ENCONTRADO;

  const trilha = [
    `Pedida pela produção em ${formatDiaBr(pp.enviada_financeiro_em ?? pp.created_at)}`,
    ...(pp.aprovada_em ? [`Aprovada pelo financeiro em ${formatDiaBr(pp.aprovada_em)}`] : []),
    ...(par.fatura_cartao_id
      ? [`Paga no cartão ${cartaoTexto(pp.cartao)}${par.pago_em ? ` em ${formatDiaBr(par.pago_em)}` : ""}`, `Entrou na fatura ${par.fatura?.codigo ?? ""}`.trim()]
      : []),
  ];

  let pagamento: { linha: string; detalhe: string | null };
  if (par.fatura_cartao_id) {
    pagamento = {
      linha: `Pago no cartão ${cartaoTexto(pp.cartao)} · fatura ${par.fatura?.codigo ?? ""}`.trim(),
      detalhe: "O dinheiro sai na baixa da fatura",
    };
  } else if (pp.pagamento_fora_do_cadastro_meio) {
    pagamento = { linha: "Pagamento fora do cadastro", detalhe: "Para onde vai o dinheiro aparece na baixa da PP" };
  } else if (par.codigo_barras) {
    pagamento = { linha: "Boleto", detalhe: par.codigo_barras };
  } else if (pp.forma_pagamento === "cartao_credito") {
    pagamento = pagamentoPelaForma("cartao_credito", pp.cartao, null);
  } else if (pp.fornecedor_pix_chave) {
    pagamento = { linha: rotuloDaChavePix(pp.fornecedor_pix_tipo), detalhe: pp.fornecedor_pix_chave };
  } else if (pp.fornecedor_conta) {
    pagamento = {
      linha: "Transferência",
      detalhe: [
        pp.fornecedor_banco_nome,
        pp.fornecedor_agencia ? `ag. ${pp.fornecedor_agencia}` : null,
        `cc ${pp.fornecedor_conta}${pp.fornecedor_conta_dv ? `-${pp.fornecedor_conta_dv}` : ""}`,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  } else {
    pagamento = pagamentoPelaForma(pp.forma_pagamento, pp.cartao, null);
  }

  const pedidos: Pedido[] = [
    ...(pp.pdf_path
      ? [
          {
            bucket: "pedidos-compra",
            path: pp.pdf_path,
            grupo: "origem" as const,
            tipo: "Pedido de Produção",
            arquivo: `${pp.codigo}.pdf`,
            mimetype: "application/pdf",
          },
        ]
      : []),
    ...anexosParaPedidos("pedidos-compra", pp.anexos),
  ];

  return {
    ok: true,
    detalhes: {
      referencia: pp.codigo,
      trilha,
      parcela: parcelaTexto(par.numero, (pp.parcelas ?? []).length),
      pagamento,
      origensDoDinheiro: [],
      retido: [],
        saidaDaBaixa: null,
        historicoDaBaixa: [],
      documentos: await assinar(supabase, pedidos),
    },
  };
}

async function daAvulsa(supabase: Supabase, tenantId: string, id: string, origem: string): Promise<Resultado> {
  const { data: a } = await supabase
    .from("contas_avulsas")
    .select(
      `id, codigo, created_at, aprovada_em, forma_pagamento, codigo_barras, competencia,
       parcela_numero, parcela_total, tipo_entrada,
       cartao:cartoes_credito!cartao_credito_id(nome, ultimos_4_digitos),
       recorrente:contas_avulsas_recorrentes!recorrente_id(frequencia, dia_do_mes),
       conta_prevista:contas_bancarias!conta_bancaria_prevista_id(nome),
       anexos:contas_avulsas_anexos!conta_avulsa_id(arquivo_path, arquivo_nome_original, arquivo_mimetype, documento_tipo, documento_numero)`,
    )
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle<any>();
  if (!a) return NAO_ENCONTRADO;

  const criado = `Criado no financeiro em ${formatDiaBr(a.created_at)}`;
  let trilha: string[];
  let pagamento: { linha: string; detalhe: string | null };
  if (origem === "rendimento") {
    trilha = ["Rendimento líquido do mês, depois do IR e do IOF"];
    pagamento = { linha: `Entra na ${a.conta_prevista?.nome ?? "conta da aplicação"}`, detalhe: null };
  } else if (origem === "recebimento_avulso") {
    trilha = [criado];
    pagamento = { linha: "TED ou PIX na conta da empresa", detalhe: null };
  } else if (origem === "recorrencia") {
    const dia = a.recorrente?.dia_do_mes;
    trilha = [
      dia ? `Recorrência mensal, todo dia ${String(dia).padStart(2, "0")}` : "Recorrência",
      `Título gerado em ${formatDiaBr(a.created_at)}`,
    ];
    pagamento = pagamentoPelaForma(a.forma_pagamento, a.cartao, a.codigo_barras);
  } else if (origem === "folha") {
    trilha = [a.competencia ? `Folha de pagamento ${a.competencia}` : "Folha de pagamento", criado];
    pagamento = pagamentoPelaForma(a.forma_pagamento, a.cartao, a.codigo_barras);
  } else {
    trilha = [criado, ...(a.aprovada_em ? [`Aprovado em ${formatDiaBr(a.aprovada_em)}`] : [])];
    pagamento = pagamentoPelaForma(a.forma_pagamento, a.cartao, a.codigo_barras);
  }

  return {
    ok: true,
    detalhes: {
      referencia: a.codigo ?? "—",
      trilha,
      parcela: parcelaTexto(a.parcela_numero, a.parcela_total ?? 1),
      pagamento,
      origensDoDinheiro: [],
      retido: [],
        saidaDaBaixa: null,
        historicoDaBaixa: [],
      documentos: await assinar(supabase, anexosParaPedidos("contas-avulsas", a.anexos)),
    },
  };
}

async function doDesembolso(supabase: Supabase, tenantId: string, id: string): Promise<Resultado> {
  const { data: par } = await supabase
    .from("desembolsos_parcelas")
    .select(
      `id, numero,
       desembolso:desembolsos!desembolso_id(
         codigo, created_at, aprovada_em, forma_pagamento,
         cartao:cartoes_credito!cartao_credito_id(nome, ultimos_4_digitos),
         parcelas:desembolsos_parcelas!desembolso_id(id),
         anexos:desembolsos_anexos!desembolso_id(arquivo_path, arquivo_nome_original, documento_tipo, documento_numero)
       )`,
    )
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle<any>();
  const d = par?.desembolso;
  if (!par || !d) return NAO_ENCONTRADO;
  return {
    ok: true,
    detalhes: {
      referencia: d.codigo,
      trilha: [
        `Pedido de desembolso de ${formatDiaBr(d.created_at)}`,
        ...(d.aprovada_em ? [`Aprovado em ${formatDiaBr(d.aprovada_em)}`] : []),
      ],
      parcela: parcelaTexto(par.numero, (d.parcelas ?? []).length),
      pagamento: pagamentoPelaForma(d.forma_pagamento, d.cartao, null),
      origensDoDinheiro: [],
      retido: [],
        saidaDaBaixa: null,
        historicoDaBaixa: [],
      documentos: await assinar(supabase, anexosParaPedidos("desembolsos", d.anexos)),
    },
  };
}

async function daVerba(supabase: Supabase, tenantId: string, id: string): Promise<Resultado> {
  const { data: dev } = await supabase
    .from("pp_verba_devolucoes")
    .select(
      `id, valor,
       pp:pedidos_compra!pedido_compra_id(codigo, valor, pago_em, pdf_path),
       prestacao:pp_verba_prestacoes!prestacao_id(
         valor_gasto, aprovada_em,
         anexos:pp_verba_prestacoes_anexos!prestacao_id(arquivo_path, arquivo_nome_original, arquivo_mimetype, documento_tipo, documento_numero)
       )`,
    )
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle<any>();
  if (!dev) return NAO_ENCONTRADO;
  const gasto = Number(dev.prestacao?.valor_gasto ?? 0);
  const nDocs = (dev.prestacao?.anexos ?? []).length;
  const trilha = [
    ...(dev.pp
      ? [`Verba de ${formatBRL(Number(dev.pp.valor))}${dev.pp.pago_em ? ` paga em ${formatDiaBr(dev.pp.pago_em)}` : ""}`]
      : []),
    gasto > 0
      ? `Prestação: gasto de ${formatBRL(gasto)} em ${nDocs} ${nDocs === 1 ? "documento" : "documentos"}`
      : "Prestação sem gasto: a verba volta inteira",
    `${dev.prestacao?.aprovada_em ? `Aprovada em ${formatDiaBr(dev.prestacao.aprovada_em)} · ` : ""}devolve ${formatBRL(Number(dev.valor))}`,
  ];
  const pedidos: Pedido[] = [
    ...(dev.pp?.pdf_path
      ? [
          {
            bucket: "pedidos-compra",
            path: dev.pp.pdf_path,
            grupo: "origem" as const,
            tipo: "Pedido de Produção da verba",
            arquivo: `${dev.pp.codigo}.pdf`,
            mimetype: "application/pdf",
          },
        ]
      : []),
    ...anexosParaPedidos("pedidos-compra", dev.prestacao?.anexos),
  ];
  return {
    ok: true,
    detalhes: {
      referencia: `ESTORNO ${dev.pp?.codigo ?? ""}`.trim(),
      trilha,
      parcela: null,
      pagamento: {
        linha: "Volta por PIX ou TED do titular da verba",
        detalhe: "A conta que recebe é escolhida na baixa",
      },
      origensDoDinheiro: [],
      retido: [],
        saidaDaBaixa: null,
        historicoDaBaixa: [],
      documentos: await assinar(supabase, pedidos),
    },
  };
}

async function daFatura(supabase: Supabase, tenantId: string, id: string): Promise<Resultado> {
  const [faturaRes, itensRes] = await Promise.all([
    supabase
      .from("faturas_cartao")
      .select(
        "codigo, competencia_fechamento, fechada_em, cartao:cartoes_credito!cartao_credito_id(nome, banco, bandeira, ultimos_4_digitos)",
      )
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle<any>(),
    supabase
      .from("lancamentos_financeiros")
      .select("natureza, papel_na_fatura")
      .eq("tenant_id", tenantId)
      .eq("fatura_cartao_id", id)
      .in("papel_na_fatura", ["item", "ajuste"]),
  ]);
  const f = faturaRes.data;
  if (!f) return NAO_ENCONTRADO;
  const itens = (itensRes.data ?? []) as Array<{ natureza: string; papel_na_fatura: string }>;
  const compras = itens.filter((i) => i.papel_na_fatura === "item" && i.natureza === "saida").length;
  const estornos = itens.filter((i) => i.papel_na_fatura === "item" && i.natureza === "entrada").length;
  const ajustes = itens.filter((i) => i.papel_na_fatura === "ajuste").length;
  const partes = [
    `${compras} ${compras === 1 ? "compra" : "compras"}`,
    `${estornos} ${estornos === 1 ? "estorno" : "estornos"}`,
    `${ajustes} ${ajustes === 1 ? "ajuste" : "ajustes"} do fechamento`,
  ];
  const c = f.cartao;
  return {
    ok: true,
    detalhes: {
      referencia: f.codigo,
      trilha: [
        `Fatura ${f.codigo} · fechou em ${formatDiaBr(f.fechada_em ?? f.competencia_fechamento)}`,
        `${partes[0]}, ${partes[1]} e ${partes[2]}`,
      ],
      parcela: null,
      pagamento: {
        linha: `Débito da fatura do ${c?.nome ?? "cartão"}`,
        detalhe: c ? [c.bandeira, c.ultimos_4_digitos ? `••••${c.ultimos_4_digitos}` : null, c.banco].filter(Boolean).join(" · ") : null,
      },
      origensDoDinheiro: [],
      retido: [],
        saidaDaBaixa: null,
        historicoDaBaixa: [],
      documentos: [],
    },
  };
}

async function daNota(supabase: Supabase, tenantId: string, id: string): Promise<Resultado> {
  const { data: t } = await supabase
    .from("titulos_receber")
    .select(
      `id, numero_parcela,
       faturamento:faturamentos!faturamento_id(
         numero_nf, data_emissao, anexo_nf_path,
         parcelas:titulos_receber!faturamento_id(id),
         itens:faturamento_itens!faturamento_id(origem_tipo, origem_id, valor)
       )`,
    )
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle<any>();
  const fat = t?.faturamento;
  if (!t || !fat) return NAO_ENCONTRADO;

  // A nota que cobre mais de um job (ou parte em save): quanto cabe a cada
  // um, como o "De onde vem este dinheiro" do Extrato.
  const itens = (fat.itens ?? []) as Array<{ origem_tipo: string; origem_id: string | null; valor: number | string }>;
  const idsDosJobs = [...new Set(itens.filter((i) => i.origem_tipo === "job" && i.origem_id).map((i) => i.origem_id as string))];
  const { data: jobs } = idsDosJobs.length
    ? await supabase.from("jobs").select("id, codigo, nome").eq("tenant_id", tenantId).in("id", idsDosJobs)
    : { data: [] as Array<{ id: string; codigo: string; nome: string }> };
  const porJob = new Map<string, { codigo: string; nome: string; valor: number }>();
  for (const i of itens) {
    const job = i.origem_tipo === "job" ? (jobs ?? []).find((j) => j.id === i.origem_id) : null;
    const chave = job ? job.id : i.origem_tipo;
    const atual = porJob.get(chave) ?? {
      codigo: job ? job.codigo : i.origem_tipo === "save" ? "Save" : "Avulso",
      nome: job ? job.nome : i.origem_tipo === "save" ? "saldo em save — crédito do cliente" : "item avulso da nota",
      valor: 0,
    };
    atual.valor += Number(i.valor);
    porJob.set(chave, atual);
  }
  const origens = [...porJob.values()];

  const pedidos: Pedido[] = fat.anexo_nf_path
    ? [
        {
          bucket: "faturamentos-nf",
          path: fat.anexo_nf_path,
          grupo: "origem",
          tipo: `Nota fiscal ${fat.numero_nf ?? ""}`.trim(),
          arquivo: nomeDoCaminho(fat.anexo_nf_path),
          mimetype: "application/pdf",
        },
      ]
    : [];
  return {
    ok: true,
    detalhes: {
      referencia: fat.numero_nf ? `NF ${fat.numero_nf}` : "Nota fiscal",
      trilha: [fat.data_emissao ? `Emitida em ${formatDiaBr(fat.data_emissao)}` : "Nota emitida"],
      parcela: parcelaTexto(t.numero_parcela, (fat.parcelas ?? []).length),
      pagamento: { linha: "TED ou PIX na conta da empresa", detalhe: null },
      origensDoDinheiro: origens.length > 1 ? origens : [],
      retido: [],
        saidaDaBaixa: null,
        historicoDaBaixa: [],
      documentos: await assinar(supabase, pedidos),
    },
  };
}

async function daTransferencia(supabase: Supabase, tenantId: string, id: string): Promise<Resultado> {
  const { data: tr } = await supabase
    .from("transferencias_contas")
    .select(
      "codigo, created_at, origem:contas_bancarias!conta_origem_id(nome), destino:contas_bancarias!conta_destino_id(nome)",
    )
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle<any>();
  if (!tr) return NAO_ENCONTRADO;
  return {
    ok: true,
    detalhes: {
      referencia: tr.codigo ?? "—",
      trilha: [`Criada em ${formatDiaBr(tr.created_at)}`, "Fica fora do DRE e do fluxo consolidado"],
      parcela: null,
      pagamento: { linha: `Sai da ${tr.origem?.nome ?? "conta de origem"}`, detalhe: `Entra na ${tr.destino?.nome ?? "conta de destino"}` },
      origensDoDinheiro: [],
      retido: [],
        saidaDaBaixa: null,
        historicoDaBaixa: [],
      documentos: [],
    },
  };
}

async function doImposto(supabase: Supabase, tenantId: string, id: string): Promise<Resultado> {
  const { data: i } = await supabase
    .from("impostos_a_pagar")
    .select(
      `id, origem, tributo, codigo_receita, rotulo_competencia, guia_path, comprovante_path, cota_numero, cota_total,
       aprovacao:fiscal_aprovacoes!aprovacao_id(aprovada_em),
       estabelecimento:fiscal_estabelecimentos!estabelecimento_id(cnpj),
       empresa:empresas_contabeis!empresa_contabil_id(cnpj)`,
    )
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle<any>();
  if (!i) return NAO_ENCONTRADO;
  const darf = !!i.codigo_receita;
  const referencia = darf ? `DARF ${i.codigo_receita}` : "Guia municipal";
  const cnpj = i.estabelecimento?.cnpj ?? i.empresa?.cnpj ?? null;
  const trilha = [
    i.origem === "avulso"
      ? "Lançamento avulso"
      : i.origem === "diferenca"
        ? `Diferença da apuração de ${i.rotulo_competencia}`
        : `Apuração de ${i.rotulo_competencia}`,
    ...(i.aprovacao?.aprovada_em ? [`Guia aprovada com a contabilidade em ${formatDiaBr(i.aprovacao.aprovada_em)}`] : []),
  ];
  const pedidos: Pedido[] = [
    ...(i.guia_path
      ? [
          {
            bucket: "impostos",
            path: i.guia_path,
            grupo: "pagamento" as const,
            tipo: darf ? "Guia (DARF)" : "Guia municipal",
            arquivo: nomeDoCaminho(i.guia_path),
            mimetype: null,
          },
        ]
      : []),
    ...(i.comprovante_path
      ? [
          {
            bucket: "impostos",
            path: i.comprovante_path,
            grupo: "pagamento" as const,
            tipo: "Comprovante de pagamento",
            arquivo: nomeDoCaminho(i.comprovante_path),
            mimetype: null,
          },
        ]
      : []),
  ];
  return {
    ok: true,
    detalhes: {
      referencia,
      trilha,
      parcela: i.cota_numero && i.cota_total > 1 ? `cota ${i.cota_numero} de ${i.cota_total}` : null,
      pagamento: { linha: `${referencia} · código de barras na guia`, detalhe: cnpj ? `CNPJ ${cnpj}` : null },
      origensDoDinheiro: [],
      retido: [],
        saidaDaBaixa: null,
        historicoDaBaixa: [],
      documentos: await assinar(supabase, pedidos),
    },
  };
}

/**
 * O ⓘ de uma linha do Extrato: o lançamento leva ao documento que ele pagou
 * ou recebeu, e o pop-up é o do título, com a baixa na trilha e o que ela
 * reteve na fonte.
 */
async function doLancamento(supabase: Supabase, tenantId: string, id: string): Promise<Resultado> {
  // Os juros e a multa desta baixa (decisão 196), lidos junto.
  const jurosPromise = supabase
    .from("lancamentos_financeiros")
    .select("valor")
    .eq("tenant_id", tenantId)
    .eq("origem", "juros_baixa")
    .eq("juros_de_lancamento_id", id);
  const { data: l } = await supabase
    .from("lancamentos_financeiros")
    .select(
      `id, origem, descricao, data_movimento, valor, forma_pagamento,
       pedido_compra_parcela_id, conta_avulsa_id, desembolso_parcela_id, pp_verba_devolucao_id,
       titulo_receber_id, imposto_a_pagar_id, transferencia_id, fatura_cartao_id, papel_na_fatura,
       conta:contas_bancarias!conta_bancaria_id(nome),
       cartao:cartoes_credito!cartao_credito_id(nome, ultimos_4_digitos),
       avulsa:contas_avulsas!conta_avulsa_id(tipo_entrada, folha_id, recorrente_id),
       retencoes:baixas_retencoes!lancamento_id(imposto, aliquota, valor)`,
    )
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle<any>();
  if (!l) return { ok: false, message: "Lançamento não encontrado." };

  let base: Resultado;
  if (l.pedido_compra_parcela_id) base = await daPP(supabase, tenantId, l.pedido_compra_parcela_id);
  else if (l.desembolso_parcela_id) base = await doDesembolso(supabase, tenantId, l.desembolso_parcela_id);
  else if (l.pp_verba_devolucao_id) base = await daVerba(supabase, tenantId, l.pp_verba_devolucao_id);
  else if (l.titulo_receber_id) base = await daNota(supabase, tenantId, l.titulo_receber_id);
  else if (l.imposto_a_pagar_id) base = await doImposto(supabase, tenantId, l.imposto_a_pagar_id);
  else if (l.transferencia_id) base = await daTransferencia(supabase, tenantId, l.transferencia_id);
  else if (l.fatura_cartao_id && l.papel_na_fatura === "pagamento") base = await daFatura(supabase, tenantId, l.fatura_cartao_id);
  else if (l.conta_avulsa_id) {
    const origem = l.avulsa?.tipo_entrada
      ? l.avulsa.tipo_entrada
      : l.avulsa?.folha_id
        ? "folha"
        : l.avulsa?.recorrente_id
          ? "recorrencia"
          : "avulso";
    base = await daAvulsa(supabase, tenantId, l.conta_avulsa_id, origem);
  } else {
    // Sem documento de origem (o lançamento manual, o ajuste).
    base = {
      ok: true,
      detalhes: {
        referencia: "—",
        trilha: ["Lançamento sem documento de origem"],
        parcela: null,
        pagamento: pagamentoPelaForma(l.forma_pagamento, l.cartao, null),
        origensDoDinheiro: [],
        retido: [],
        saidaDaBaixa: null,
        historicoDaBaixa: [],
        documentos: [],
      },
    };
  }
  if (!base.ok) return base;

  const forma = l.forma_pagamento ? formaPagamentoLabel(l.forma_pagamento as FormaPagamento) : null;
  const baixa = [
    `Baixa em ${formatDiaBr(l.data_movimento)}`,
    forma,
    l.forma_pagamento === "cartao_credito" ? cartaoTexto(l.cartao) : l.conta?.nome,
  ]
    .filter(Boolean)
    .join(" · ");
  const retido = ((l.retencoes ?? []) as Array<{ imposto: string; aliquota: number | string | null; valor: number | string }>)
    .filter((r) => Number(r.valor) > 0)
    .map((r) => ({
      rotulo: r.aliquota ? `${r.imposto} ${Number(r.aliquota).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%` : r.imposto,
      valor: Number(r.valor),
    }));
  const { data: jurosLidos } = await jurosPromise;
  const juros =
    Math.round(((jurosLidos ?? []) as Array<{ valor: number | string }>).reduce((acc, j) => acc + Number(j.valor) * 100, 0)) / 100;
  return {
    ok: true,
    detalhes: {
      ...base.detalhes,
      trilha: [...base.detalhes.trilha, baixa],
      retido,
      saidaDaBaixa: juros > 0 ? { principal: Number(l.valor), juros } : null,
    },
  };
}

/** A baixa feita à mão corrigida pela conciliação com o banco (decisão 200),
 *  pelo documento: a correção refaz a baixa, e o lançamento muda de id. */
async function historicoDaBaixa(
  supabase: Supabase,
  tenantId: string,
  origem: "pp_baixa" | "avulsa_baixa" | "titulo_baixa",
  documentoId: string,
): Promise<DetalhesDoTitulo["historicoDaBaixa"]> {
  const { data, error } = await supabase
    .from("baixa_correcoes")
    .select("created_at, de, para, motivo, desfeita_em, autor:profiles!corrigida_por(nome)")
    .eq("tenant_id", tenantId)
    .eq("documento_origem", origem)
    .eq("documento_id", documentoId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[detalhes-do-titulo.historico]", error.message);
    return [];
  }
  return ((data ?? []) as any[]).map((c) => ({
    em: c.created_at,
    por: c.autor?.nome ?? "—",
    de: { data: c.de?.data, total: Number(c.de?.total) },
    para: { data: c.para?.data, total: Number(c.para?.total) },
    motivo: c.motivo,
    desfeitaEm: c.desfeita_em,
  }));
}

/** O documento cuja baixa pode ter sido corrigida, pela chave do ⓘ. */
async function documentoDaCorrecao(
  supabase: Supabase,
  tenantId: string,
  lado: string | undefined,
  origem: string | undefined,
  id: string,
): Promise<{ origem: "pp_baixa" | "avulsa_baixa" | "titulo_baixa"; id: string } | null> {
  if (lado === "pagar" && origem === "pp") return { origem: "pp_baixa", id };
  if (lado === "pagar" && (origem === "avulso" || origem === "recorrencia" || origem === "folha")) return { origem: "avulsa_baixa", id };
  if (lado === "receber" && origem === "nf") return { origem: "titulo_baixa", id };
  if (lado === "receber" && (origem === "recebimento_avulso" || origem === "rendimento")) return { origem: "avulsa_baixa", id };
  if (lado !== "lancamento") return null;
  const { data: l } = await supabase
    .from("lancamentos_financeiros")
    .select("pedido_compra_parcela_id, conta_avulsa_id, titulo_receber_id")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle<{ pedido_compra_parcela_id: string | null; conta_avulsa_id: string | null; titulo_receber_id: string | null }>();
  if (l?.pedido_compra_parcela_id) return { origem: "pp_baixa", id: l.pedido_compra_parcela_id };
  if (l?.conta_avulsa_id) return { origem: "avulsa_baixa", id: l.conta_avulsa_id };
  if (l?.titulo_receber_id) return { origem: "titulo_baixa", id: l.titulo_receber_id };
  return null;
}

// ---------------------------------------------------------------------------
// A entrada
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function carregarDetalhesDoTitulo(chave: string): Promise<Resultado> {
  const res = await lerDetalhesDoTitulo(chave);
  if (!res.ok) return res;
  // O histórico da baixa corrigida pela conciliação (decisão 200).
  try {
    const session = await requireSession();
    const supabase = createClient();
    const tenantId = session.activeTenant.id;
    const partes = chave.split("|");
    const doc = await documentoDaCorrecao(supabase, tenantId, partes[0], partes[1], partes[partes.length - 1]);
    if (!doc) return res;
    return { ok: true, detalhes: { ...res.detalhes, historicoDaBaixa: await historicoDaBaixa(supabase, tenantId, doc.origem, doc.id) } };
  } catch (e) {
    console.error("[detalhes-do-titulo.historico]", e instanceof Error ? e.message : String(e));
    return res;
  }
}

async function lerDetalhesDoTitulo(chave: string): Promise<Resultado> {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    return { ok: false, message: "Apenas admin ou financeiro pode ver os detalhes do título." };
  }
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const partes = typeof chave === "string" ? chave.split("|") : [];
  const id = partes[partes.length - 1] ?? "";
  if (!UUID.test(id)) return NAO_ENCONTRADO;
  const [lado, origem] = partes;

  try {
    if (lado === "lancamento") return await doLancamento(supabase, tenantId, id);
    if (lado === "imposto") return await doImposto(supabase, tenantId, id);
    if (lado === "transferencia") return await daTransferencia(supabase, tenantId, id);
    if (lado === "pagar") {
      switch (origem) {
        case "pp":
          return await daPP(supabase, tenantId, id);
        case "avulso":
        case "recorrencia":
        case "folha":
          return await daAvulsa(supabase, tenantId, id, origem);
        case "desembolso":
          return await doDesembolso(supabase, tenantId, id);
        case "pp_devolucao_verba":
          return await daVerba(supabase, tenantId, id);
        case "fatura_cartao":
          return await daFatura(supabase, tenantId, id);
      }
    }
    if (lado === "receber") {
      if (origem === "nf") return await daNota(supabase, tenantId, id);
      if (origem === "transferencia") return await daTransferencia(supabase, tenantId, id);
      if (origem === "recebimento_avulso" || origem === "rendimento") {
        return await daAvulsa(supabase, tenantId, id, origem);
      }
    }
  } catch (e) {
    console.error("[detalhes-do-titulo]", e instanceof Error ? e.message : String(e));
    return { ok: false, message: "Não foi possível ler os detalhes do título." };
  }
  return NAO_ENCONTRADO;
}
