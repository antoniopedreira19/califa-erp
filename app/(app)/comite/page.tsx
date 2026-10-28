import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listActiveMembers } from "@/lib/data/members";
import { carregarRegrasDoComite, SELECT_PEDIDO, type PedidoComNomes } from "@/lib/data/comite";
import { nomeDoCartaoCorporativo } from "@/lib/types";
import { ModuloComite, type Aba } from "./modulo-comite";
import type { CasoDoComite, MembroDoComite, UsuarioParaComite } from "./tipos";

// Caixa de decisão: o que chega precisa aparecer na hora.
export const dynamic = "force-dynamic";

/**
 * Comitê de Aprovações (decisão 223): a caixa (aberturas de job e PPs que
 * precisam da aprovação) e as Configurações. Só para membros e
 * administradores — quem não é, não acha o módulo na barra lateral e cai
 * no 404 pelo link.
 */
export default async function ComitePage({
  searchParams,
}: {
  searchParams?: { aba?: string | string[] };
}) {
  const session = await requireSession();
  const supabase = createClient();
  const tenantId = session.activeTenant.id;
  const abaPedida = Array.isArray(searchParams?.aba) ? searchParams?.aba[0] : searchParams?.aba;
  const aba: Aba = abaPedida === "pps" || abaPedida === "config" ? abaPedida : "jobs";

  const [podeRes, regras, versoesRes, ppsRes, membrosRes, configRes, ativos] = await Promise.all([
    supabase.rpc("pode_decidir_no_comite", { p_tenant_id: tenantId }),
    carregarRegrasDoComite(supabase, tenantId),
    supabase
      .from("comite_pedidos")
      .select(
        `${SELECT_PEDIDO}, snapshot, orcamento_id, versao_orcamento_id, ` +
          "enviado_papel:profiles!comite_pedidos_enviado_por_fkey(role), " +
          "versao:versoes_orcamento!comite_pedidos_versao_orcamento_id_fkey(numero_versao), " +
          "orcamento:orcamentos!comite_pedidos_orcamento_id_fkey(nome, projeto_id, projeto:projetos!orcamentos_projeto_id_fkey(nome), " +
          "cliente:clientes!orcamentos_cliente_id_fkey(nome_fantasia, razao_social), " +
          "empresa:empresas!orcamentos_empresa_id_fkey(nome_fantasia, razao_social), regional:regionais!orcamentos_regional_id_fkey(nome))",
      )
      .eq("tenant_id", tenantId)
      .eq("tipo", "versao")
      .neq("status", "cancelado")
      .order("enviado_em", { ascending: false })
      .limit(300),
    supabase
      .from("comite_pedidos")
      .select(
        `${SELECT_PEDIDO}, snapshot, job_id, pp_a_emitir_id, ` +
          "enviado_papel:profiles!comite_pedidos_enviado_por_fkey(role), " +
          "job:jobs!comite_pedidos_job_id_fkey(codigo, nome, projeto:projetos!jobs_projeto_id_fkey(nome), " +
          "cliente:clientes!jobs_cliente_id_fkey(nome_fantasia, razao_social), " +
          "empresa:empresas!jobs_empresa_id_fkey(nome_fantasia, razao_social), regional:regionais!jobs_regional_id_fkey(nome)), " +
          "linha:jobs_itens_realizado!comite_pedidos_item_realizado_id_fkey(orcado:jobs_itens_orcado!jobs_itens_realizado_job_item_orcado_id_fkey(item)), " +
          "a_emitir:pedidos_compra_a_emitir!comite_pedidos_pp_a_emitir_id_fkey(servico, verba_producao, verba_titular_nome, cartao_corporativo, cartao_plataforma, " +
          "fornecedor:fornecedores!pedidos_compra_a_emitir_fornecedor_id_fkey(nome), " +
          "responsavel:profiles!pedidos_compra_a_emitir_responsavel_verba_id_fkey(nome))",
      )
      .eq("tenant_id", tenantId)
      .eq("tipo", "pp")
      .neq("status", "cancelado")
      .order("enviado_em", { ascending: false })
      .limit(300),
    supabase
      .from("comite_membros")
      .select("user_id, perfil:profiles!comite_membros_user_id_fkey(nome, role)")
      .eq("tenant_id", tenantId),
    supabase
      .from("comite_config")
      .select("updated_at, atualizado:profiles!comite_config_atualizado_por_fkey(nome)")
      .eq("tenant_id", tenantId)
      .maybeSingle<{ updated_at: string; atualizado: { nome: string } | null }>(),
    listActiveMembers(tenantId),
  ]);
  if (podeRes.data !== true) notFound();
  if (versoesRes.error) console.error("[comite.caixa.versoes]", versoesRes.error.message);
  if (ppsRes.error) console.error("[comite.caixa.pps]", ppsRes.error.message);
  if (membrosRes.error) console.error("[comite.membros]", membrosRes.error.message);

  const nomeEmpresa = (e: { nome_fantasia: string | null; razao_social: string } | null) =>
    e ? (e.nome_fantasia ?? e.razao_social) : "—";
  const nomeCliente = (c: { nome_fantasia: string | null; razao_social: string | null } | null) =>
    c ? (c.nome_fantasia ?? c.razao_social ?? "—") : "—";
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

  type Base = PedidoComNomes & { snapshot: Record<string, unknown>; enviado_papel: { role: string | null } | null };
  const casos: CasoDoComite[] = [];

  for (const p of (versoesRes.data ?? []) as unknown as Array<
    Base & {
      orcamento_id: string;
      versao_orcamento_id: string;
      versao: { numero_versao: number } | null;
      orcamento: {
        nome: string;
        projeto_id: string;
        projeto: { nome: string } | null;
        cliente: { nome_fantasia: string | null; razao_social: string | null } | null;
        empresa: { nome_fantasia: string | null; razao_social: string } | null;
        regional: { nome: string } | null;
      } | null;
    }
  >) {
    if (p.status === "cancelado") continue;
    casos.push({
      tipo: "versao",
      id: p.id,
      situacao: p.status,
      motivo: p.motivo,
      enviadoPor: p.enviado?.nome ?? "—",
      enviadoPorPapel: p.enviado_papel?.role ?? null,
      enviadoEm: p.enviado_em,
      decididoPor: p.decidido?.nome ?? null,
      decididoEm: p.decidido_em,
      comentario: p.comentario,
      projeto: p.orcamento?.projeto?.nome ?? "—",
      cliente: nomeCliente(p.orcamento?.cliente ?? null),
      empresa: nomeEmpresa(p.orcamento?.empresa ?? null),
      regional: p.orcamento?.regional?.nome ?? "—",
      href: p.orcamento
        ? `/orcamentos/${p.orcamento.projeto_id}/${p.orcamento_id}?v=${p.versao_orcamento_id}&comite=${p.id}&embutido=1`
        : null,
      orcamento: p.orcamento?.nome ?? "—",
      versao: p.versao?.numero_versao ?? 0,
      valorJob: num(p.snapshot.valor_job) ?? 0,
      resultadoGeral: num(p.snapshot.resultado_geral),
      itensAcima: num(p.snapshot.itens_acima) ?? 0,
      comExcecao: p.snapshot.excecao !== null && p.snapshot.excecao !== undefined,
    });
  }

  for (const p of (ppsRes.data ?? []) as unknown as Array<
    Base & {
      job_id: string;
      pp_a_emitir_id: string;
      job: {
        codigo: string;
        nome: string;
        projeto: { nome: string } | null;
        cliente: { nome_fantasia: string | null; razao_social: string | null } | null;
        empresa: { nome_fantasia: string | null; razao_social: string } | null;
        regional: { nome: string } | null;
      } | null;
      linha: { orcado: { item: string } | null } | null;
      a_emitir: {
        servico: string;
        verba_producao: boolean;
        verba_titular_nome: string | null;
        cartao_corporativo: boolean;
        cartao_plataforma: string | null;
        fornecedor: { nome: string } | null;
        responsavel: { nome: string } | null;
      } | null;
    }
  >) {
    if (p.status === "cancelado") continue;
    const a = p.a_emitir;
    const fornecedor = !a
      ? "—"
      : a.cartao_corporativo
        ? nomeDoCartaoCorporativo(a.cartao_plataforma)
        : a.verba_producao
          ? (a.verba_titular_nome ?? a.responsavel?.nome ?? "Verba de produção")
          : (a.fornecedor?.nome ?? "—");
    casos.push({
      tipo: "pp",
      id: p.id,
      situacao: p.status,
      motivo: p.motivo,
      enviadoPor: p.enviado?.nome ?? "—",
      enviadoPorPapel: p.enviado_papel?.role ?? null,
      enviadoEm: p.enviado_em,
      decididoPor: p.decidido?.nome ?? null,
      decididoEm: p.decidido_em,
      comentario: p.comentario,
      projeto: p.job?.projeto?.nome ?? "—",
      cliente: nomeCliente(p.job?.cliente ?? null),
      empresa: nomeEmpresa(p.job?.empresa ?? null),
      regional: p.job?.regional?.nome ?? "—",
      href: `/jobs/${p.job_id}?aba=planilha&comite=${p.id}&embutido=1`,
      jobCodigo: p.job?.codigo ?? "—",
      jobNome: p.job?.nome ?? "—",
      item: p.linha?.orcado?.item ?? a?.servico ?? "—",
      servico: a?.servico ?? "",
      fornecedor,
      valorPP: num(p.snapshot.valor) ?? 0,
      orcadoItem: num(p.snapshot.orcado) ?? 0,
      planejadoItem: num(p.snapshot.planejado) ?? 0,
      realizadoComAPP: num(p.snapshot.realizado) ?? 0,
      excesso: num(p.snapshot.excesso) ?? 0,
      linhaVermelha: p.snapshot.linha_vermelha === true,
    });
  }

  const membros: MembroDoComite[] = ((membrosRes.data ?? []) as unknown as Array<{
    user_id: string;
    perfil: { nome: string; role: string | null } | null;
  }>)
    .map((m) => ({ id: m.user_id, nome: m.perfil?.nome ?? "—", papel: m.perfil?.role ?? null }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const usuarios: UsuarioParaComite[] = ativos.map((u) => ({ id: u.id, nome: u.nome }));

  return (
    <ModuloComite
      aba={aba}
      casos={casos}
      regras={regras}
      membros={membros}
      usuarios={usuarios}
      ultimaAlteracao={
        configRes.data
          ? { por: configRes.data.atualizado?.nome ?? null, em: configRes.data.updated_at }
          : null
      }
      souAdministrador={session.activeRole === "administrador"}
    />
  );
}
