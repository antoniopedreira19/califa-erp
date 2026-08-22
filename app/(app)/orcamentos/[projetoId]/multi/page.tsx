import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listActiveMembers } from "@/lib/data/members";
import { listarCidadesIniciais } from "@/lib/data/cidades";
import { HONORARIOS_PADRAO_FALLBACK } from "@/lib/validations/clientes";
import type {
  CategoriaDominio,
  Categoria,
  Profile,
  Regional,
} from "@/lib/types";
import { EditorMultiJobs } from "./editor-multi-jobs";

export const dynamic = "force-dynamic";

/**
 * Orçamento do projeto: monta vários orçamentos de job de uma vez.
 *
 * Tudo o que a tela precisa vem daqui em um único passe — o editor é um
 * rascunho no cliente e não faz nenhuma leitura própria depois de montado.
 */
export default async function OrcamentoDoProjetoPage({
  params,
}: {
  params: { projetoId: string };
}) {
  const session = await requireSession();
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const [
    projRes,
    categoriasOrcRes,
    cidadesIniciais,
    categoriasItemRes,
    fornecedoresRes,
    produtores,
    vinculosRegRes,
    vinculosRespRes,
    orcCountRes,
  ] = await Promise.all([
    // O cliente entra no embed por causa dos honorários: o percentual do
    // cadastro é o único que vale na criação, e o editor precisa dele já
    // no primeiro render para mostrar o campo travado com o valor certo.
    supabase
      .from("projetos")
      .select(
        "id, codigo, nome, status, cliente:clientes(id, nome_fantasia, percentual_honorarios_padrao)",
      )
      .eq("id", params.projetoId)
      .eq("tenant_id", tenantId)
      .maybeSingle<{
        id: string;
        codigo: string;
        nome: string;
        status: string;
        cliente: {
          id: string;
          nome_fantasia: string;
          percentual_honorarios_padrao: number | string;
        } | null;
      }>(),
    supabase
      .from("categorias_dominio")
      .select("id, nome")
      .eq("tenant_id", tenantId)
      .eq("escopo", "orcamento")
      .eq("ativo", true)
      .order("nome"),
    // Só as primeiras cidades: o combobox do formulário busca o resto no
    // servidor a cada digitação. O cadastro comporta o Brasil inteiro.
    listarCidadesIniciais(tenantId),
    // Catálogo global do tenant — alimenta a coluna Categoria da planilha.
    supabase
      .from("categorias")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("nome")
      .returns<Categoria[]>(),
    // Só id + nome: é tudo que o formulário de BV usa.
    supabase
      .from("fornecedores")
      .select("id, nome")
      .eq("tenant_id", tenantId)
      .eq("status", "ativo")
      .order("nome")
      .returns<{ id: string; nome: string }[]>(),
    listActiveMembers(tenantId),
    supabase
      .from("projeto_regionais")
      .select("regional_id, regional:regionais(id, nome)")
      .eq("projeto_id", params.projetoId)
      .eq("tenant_id", tenantId),
    supabase
      .from("projeto_responsaveis")
      .select("profile_id, profile:profiles(id, nome)")
      .eq("projeto_id", params.projetoId)
      .eq("tenant_id", tenantId),
    // Só a contagem: é a base do código previsto nos cards. Agregação
    // separada em vez de embed — a lista de orçamentos não é usada aqui.
    supabase
      .from("orcamentos")
      .select("id", { count: "exact", head: true })
      .eq("projeto_id", params.projetoId)
      .eq("tenant_id", tenantId),
  ]);

  const projeto = projRes.data;
  if (!projeto) notFound();

  // Regional e GP do orçamento saem do projeto — a peça não sai da praça
  // que a iniciativa cobre. Mesma regra do formulário de sempre.
  const regionaisDoProjeto = ((vinculosRegRes.data ?? []) as any[])
    .filter((v) => v.regional)
    .map((v) => ({ id: v.regional.id as string, nome: v.regional.nome as string }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")) as Pick<
    Regional,
    "id" | "nome"
  >[];

  const gpsDoProjeto = ((vinculosRespRes.data ?? []) as any[])
    .filter((v) => v.profile)
    .map((v) => ({ id: v.profile.id as string, nome: v.profile.nome as string }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")) as Pick<
    Profile,
    "id" | "nome"
  >[];

  return (
    <EditorMultiJobs
      projeto={projeto}
      honorariosCliente={Number(
        projeto.cliente?.percentual_honorarios_padrao ??
          HONORARIOS_PADRAO_FALLBACK,
      )}
      clienteNome={projeto.cliente?.nome_fantasia ?? "cliente"}
      orcamentosExistentes={orcCountRes.count ?? 0}
      categorias={(categoriasOrcRes.data ?? []) as Pick<
        CategoriaDominio,
        "id" | "nome"
      >[]}
      regionaisDoProjeto={regionaisDoProjeto}
      cidadesIniciais={cidadesIniciais}
      gpsDoProjeto={gpsDoProjeto}
      produtores={produtores}
      categoriasItem={categoriasItemRes.data ?? []}
      fornecedores={fornecedoresRes.data ?? []}
    />
  );
}
