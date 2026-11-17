// Decisão 264: a leitura dos pedidos de desembolso, do jeito que as duas
// telas usam — o módulo Desembolsos (só os pedidos de quem está usando; a
// RLS também só mostra esses fora do financeiro) e a aba Desembolsos do
// Contas a Pagar (todos, para o financeiro).
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatarCnpj } from "@/lib/fiscal/cadastro";
import { formatDocumento } from "@/lib/utils";
import { tomadoresPadrao } from "@/lib/fiscal/nf-da-pp";
import { ROTULO_DO_REGIME } from "@/lib/fiscal/regime-do-fornecedor";
import { todasAsLinhas } from "@/lib/supabase/todas-as-linhas";
import type { DocumentoTipo, RegimeTributarioFornecedor } from "@/lib/types";
import type { TomadorDaNf } from "@/app/(app)/jobs/[jobId]/realizado/anexos-da-pp";
import type {
  AlocacaoDeQuemPede,
  EmpresaDoForm,
  FornecedorDoForm,
  PedidoDeDesembolso,
  RegionalDoForm,
  StatusDoDesembolso,
  TomadorPadrao,
} from "./tipos";

const SELECT_DO_PEDIDO = `
  id, codigo, descricao, valor, status, favorecido_tipo, fornecedor_id, empresa_id,
  data_prevista_pagamento, motivo_rejeicao, motivo_cancelamento, criado_por, created_at,
  enviado_em, reenviado_em, urgente, urgente_justificativa,
  aprovada_em, rejeitada_em, cancelada_em, pago_em, forma_pagamento,
  empresa:empresas(id, razao_social, nome_fantasia),
  fornecedor:fornecedores(id, nome, razao_social, cpf_cnpj, regime_tributario),
  criador:profiles!desembolsos_criado_por_fkey(nome),
  aprovador:profiles!desembolsos_aprovada_por_fkey(nome),
  rejeitador:profiles!desembolsos_rejeitada_por_fkey(nome),
  cancelador:profiles!desembolsos_cancelada_por_fkey(nome),
  parcelas:desembolsos_parcelas(id, numero, data_vencimento, data_pagamento, valor, pago_em),
  regionais:desembolsos_regionais(percentual, regional:regionais(id, nome)),
  anexos:desembolsos_anexos(
    id, arquivo_path, arquivo_nome_original, arquivo_tamanho_bytes, arquivo_mimetype,
    documento_tipo, documento_numero, nf_data_emissao, nf_valor, nf_tomador_estabelecimento_id,
    nf_valor_no_pedido, nota_fiscal_id, created_at
  )
`;

type Linha = {
  id: string;
  codigo: string;
  descricao: string;
  valor: number | string;
  status: StatusDoDesembolso;
  favorecido_tipo: string | null;
  fornecedor_id: string | null;
  empresa_id: string;
  data_prevista_pagamento: string | null;
  motivo_rejeicao: string | null;
  motivo_cancelamento: string | null;
  criado_por: string;
  created_at: string;
  enviado_em: string | null;
  reenviado_em: string | null;
  urgente: boolean | null;
  urgente_justificativa: string | null;
  aprovada_em: string | null;
  rejeitada_em: string | null;
  cancelada_em: string | null;
  pago_em: string | null;
  forma_pagamento: string | null;
  empresa: { id: string; razao_social: string | null; nome_fantasia: string | null } | null;
  fornecedor: {
    id: string;
    nome: string;
    razao_social: string | null;
    cpf_cnpj: string | null;
    regime_tributario: RegimeTributarioFornecedor | null;
  } | null;
  criador: { nome: string } | null;
  aprovador: { nome: string } | null;
  rejeitador: { nome: string } | null;
  cancelador: { nome: string } | null;
  parcelas: Array<{
    id: string;
    numero: number;
    data_vencimento: string;
    data_pagamento: string | null;
    valor: number | string;
    pago_em: string | null;
  }> | null;
  regionais: Array<{ percentual: number | string; regional: { id: string; nome: string } | null }> | null;
  anexos: Array<{
    id: string;
    arquivo_path: string;
    arquivo_nome_original: string;
    arquivo_tamanho_bytes: number | string;
    arquivo_mimetype: string | null;
    documento_tipo: DocumentoTipo | null;
    documento_numero: string | null;
    nf_data_emissao: string | null;
    nf_valor: number | string | null;
    nf_tomador_estabelecimento_id: string | null;
    nf_valor_no_pedido: number | string | null;
    nota_fiscal_id: string | null;
    created_at: string;
  }> | null;
};

const num = (v: number | string | null | undefined) => (v === null || v === undefined ? null : Number(v));

/** O tipo do arquivo pelo nome, para os anexos gravados antes de o tipo ser guardado. */
function mimeDoNome(nome: string): string {
  const n = nome.toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

function montar(l: Linha): PedidoDeDesembolso {
  const parcelas = (l.parcelas ?? [])
    .slice()
    .sort((a, b) => a.numero - b.numero)
    .map((p) => ({
      id: p.id,
      numero: p.numero,
      vencimento: p.data_vencimento,
      dataPagamento: p.data_pagamento,
      valor: Number(p.valor),
      pagoEm: p.pago_em,
    }));
  const reembolso = l.favorecido_tipo === "reembolso" || (!l.favorecido_tipo && !l.fornecedor_id);
  return {
    id: l.id,
    codigo: l.codigo,
    descricao: l.descricao,
    valor: Number(l.valor),
    status: l.status,
    reembolso,
    fornecedor:
      !reembolso && l.fornecedor
        ? {
            id: l.fornecedor.id,
            nome: l.fornecedor.razao_social ?? l.fornecedor.nome,
            documento: l.fornecedor.cpf_cnpj ? formatDocumento(l.fornecedor.cpf_cnpj) : null,
            regime: l.fornecedor.regime_tributario ? ROTULO_DO_REGIME[l.fornecedor.regime_tributario] ?? null : null,
          }
        : null,
    empresa: {
      id: l.empresa_id,
      nome: l.empresa?.razao_social ?? l.empresa?.nome_fantasia ?? "—",
    },
    regionais: (l.regionais ?? [])
      .filter((r) => r.regional)
      .map((r) => ({ id: r.regional!.id, nome: r.regional!.nome, pct: Number(r.percentual) }))
      .sort((a, b) => b.pct - a.pct || a.nome.localeCompare(b.nome, "pt-BR")),
    parcelas,
    prevista: parcelas[0]?.dataPagamento ?? parcelas[0]?.vencimento ?? l.data_prevista_pagamento,
    anexos: (l.anexos ?? [])
      .slice()
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((a) => ({
        id: a.id,
        path: a.arquivo_path,
        nome: a.arquivo_nome_original,
        tamanho: Number(a.arquivo_tamanho_bytes ?? 0),
        mime: a.arquivo_mimetype ?? mimeDoNome(a.arquivo_nome_original),
        tipo: a.documento_tipo,
        numero: a.documento_numero,
        emissao: a.nf_data_emissao,
        valorDoDoc: num(a.nf_valor),
        tomadorId: a.nf_tomador_estabelecimento_id,
        parte: num(a.nf_valor_no_pedido),
        notaId: a.nota_fiscal_id,
        criadoEm: a.created_at,
      })),
    criador: { id: l.criado_por, nome: l.criador?.nome ?? "—" },
    criadoEm: l.created_at,
    enviadoEm: l.enviado_em ?? l.created_at,
    reenviadoEm: l.reenviado_em,
    urgente: l.urgente === true,
    justificativaUrgente: l.urgente_justificativa,
    aprovado: l.aprovada_em ? { por: l.aprovador?.nome ?? null, em: l.aprovada_em } : null,
    rejeitado: l.rejeitada_em
      ? { por: l.rejeitador?.nome ?? null, em: l.rejeitada_em, motivo: l.motivo_rejeicao ?? "" }
      : null,
    cancelado:
      l.status === "cancelada" && l.cancelada_em
        ? { por: l.cancelador?.nome ?? null, em: l.cancelada_em, motivo: l.motivo_cancelamento ?? "" }
        : null,
    pagoEm: l.pago_em,
    forma: l.forma_pagamento,
  };
}

/**
 * Os pedidos de desembolso do tenant. `criadoPor` restringe aos de uma
 * pessoa (o módulo Desembolsos); `empresaIds`, às empresas do filtro do
 * topo (o Contas a Pagar). A ordem é a do último envio, o mais novo antes.
 */
export async function carregarPedidosDeDesembolso(
  supabase: SupabaseClient,
  tenantId: string,
  filtro: { criadoPor?: string; empresaIds?: string[] } = {},
): Promise<PedidoDeDesembolso[]> {
  let q = supabase.from("desembolsos").select(SELECT_DO_PEDIDO).eq("tenant_id", tenantId);
  if (filtro.criadoPor) q = q.eq("criado_por", filtro.criadoPor);
  if (filtro.empresaIds && filtro.empresaIds.length > 0) q = q.in("empresa_id", filtro.empresaIds);
  const { data, error } = await q
    .order("enviado_em", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .returns<Linha[]>();
  if (error) {
    console.error("[desembolsos.carregar]", error.message);
    return [];
  }
  return (data ?? []).map(montar);
}

/** O que o formulário do pedido precisa: empresas, regionais, fornecedores,
 *  os CNPJs tomadores da NF e a alocação de quem pede no RH. */
export interface ContextoDoFormulario {
  empresas: EmpresaDoForm[];
  regionais: RegionalDoForm[];
  fornecedores: FornecedorDoForm[];
  tomadores: TomadorDaNf[];
  tomadorPadrao: TomadorPadrao;
  alocacao: AlocacaoDeQuemPede | null;
}

export async function carregarContextoDoFormulario(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<ContextoDoFormulario> {
  const [empresasRes, regionaisRes, fornecedoresRes, estabelecimentosRes, porRegionalRes, alocacaoRes] =
    await Promise.all([
      supabase
        .from("empresas")
        .select("id, razao_social, nome_fantasia, cnpj, principal")
        .eq("tenant_id", tenantId)
        .eq("ativo", true)
        .order("razao_social"),
      supabase
        .from("regionais")
        .select("id, nome, ativo, empresa_id")
        .eq("tenant_id", tenantId)
        .eq("ativo", true)
        .order("nome"),
      // Decisão 255: sem o corte de 1.000 linhas do PostgREST.
      todasAsLinhas((de, ate) =>
        supabase
          .from("fornecedores")
          .select("id, nome, razao_social, cpf_cnpj")
          .eq("tenant_id", tenantId)
          .eq("status", "ativo")
          .order("nome")
          .order("id")
          .range(de, ate),
      ),
      // Os CNPJs tomadores da NF (decisão 152): os ativos com CNPJ do cadastro de impostos.
      supabase
        .from("fiscal_estabelecimentos")
        .select("id, nome, cnpj, ativo, papel, ordem")
        .eq("tenant_id", tenantId)
        .eq("ativo", true)
        .order("ordem")
        .order("nome"),
      // O CNPJ que a nota já traz escolhido para cada regional (decisão 156).
      supabase.from("fiscal_cnpj_da_pp_por_regional").select("regional_id, estabelecimento_id").eq("tenant_id", tenantId),
      supabase.rpc("minha_alocacao_vigente"),
    ]);
  for (const [nome, r] of [
    ["empresas", empresasRes],
    ["regionais", regionaisRes],
    ["estabelecimentos", estabelecimentosRes],
    ["cnpj_por_regional", porRegionalRes],
    ["alocacao", alocacaoRes],
  ] as const) {
    if (r.error) console.error(`[desembolsos.form.${nome}]`, r.error.message);
  }

  const empresasRaw = (empresasRes.data ?? []) as Array<{
    id: string;
    razao_social: string | null;
    nome_fantasia: string | null;
    cnpj: string | null;
    principal: boolean | null;
  }>;
  const estabelecimentos = ((estabelecimentosRes.data ?? []) as Array<{
    id: string;
    nome: string;
    cnpj: string | null;
    ativo: boolean;
    papel: string;
    ordem: number | null;
  }>).filter((e) => typeof e.cnpj === "string" && e.cnpj.replace(/\D/g, "").length === 14);
  const padrao = tomadoresPadrao(
    estabelecimentos.map((e) => ({ id: e.id, cnpj: e.cnpj, ativo: e.ativo === true, papel: e.papel, ordem: Number(e.ordem ?? 0) })),
    empresasRaw.map((e) => ({ id: e.id, cnpj: e.cnpj, principal: e.principal === true })),
  );
  const ativos = new Set(estabelecimentos.map((e) => e.id));
  const porRegional: Record<string, string> = {};
  for (const r of (porRegionalRes.data ?? []) as Array<{ regional_id: string; estabelecimento_id: string }>) {
    if (ativos.has(r.estabelecimento_id)) porRegional[r.regional_id] = r.estabelecimento_id;
  }
  const aloc = ((alocacaoRes.data ?? []) as Array<{ empresa_id: string; regional_id: string | null }>)[0] ?? null;

  return {
    empresas: empresasRaw.map((e) => ({ id: e.id, nome: e.razao_social ?? e.nome_fantasia ?? "" })),
    regionais: ((regionaisRes.data ?? []) as RegionalDoForm[]).map((r) => ({
      id: r.id,
      nome: r.nome,
      ativo: r.ativo,
      empresa_id: r.empresa_id,
    })),
    fornecedores: (fornecedoresRes.data ?? []).map((f: { id: string; nome: string; razao_social: string | null; cpf_cnpj: string | null }) => ({
      id: f.id,
      nome: f.razao_social ?? f.nome,
      cpf_cnpj: f.cpf_cnpj,
    })),
    tomadores: estabelecimentos.map((e) => ({ id: e.id, nome: e.nome, cnpj: formatarCnpj(e.cnpj) })),
    tomadorPadrao: { porRegional, porEmpresa: padrao.porEmpresa, geral: padrao.geral },
    alocacao: aloc ? { empresaId: aloc.empresa_id, regionalId: aloc.regional_id } : null,
  };
}

/** Os CNPJs tomadores, para a tela de conferência mostrar o CNPJ da nota. */
export async function carregarTomadores(supabase: SupabaseClient, tenantId: string): Promise<TomadorDaNf[]> {
  const { data, error } = await supabase
    .from("fiscal_estabelecimentos")
    .select("id, nome, cnpj")
    .eq("tenant_id", tenantId)
    .order("ordem")
    .order("nome");
  if (error) console.error("[desembolsos.tomadores]", error.message);
  return ((data ?? []) as Array<{ id: string; nome: string; cnpj: string | null }>).map((e) => ({
    id: e.id,
    nome: e.nome,
    cnpj: formatarCnpj(e.cnpj),
  }));
}
