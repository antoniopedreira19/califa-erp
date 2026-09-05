import { createClient } from "@/lib/supabase/server";
import type { Cidade } from "@/lib/types";
import { buscarMunicipiosIBGE } from "./ibge-municipios";

/** O par que todo select/combobox de cidade consome. */
export type CidadeOpcao = Pick<Cidade, "id" | "nome" | "uf">;

/**
 * Item devolvido pelo combobox híbrido. `local` já está no cadastro do
 * tenant (tem `id`). `ibge` é uma sugestão externa que ainda não foi
 * cadastrada; o combobox chama `criarCidadeDoIBGE(ibge_codigo, ...)`
 * ao selecionar, materializando-a no cadastro.
 */
export type CidadeSugestao =
  | {
      origem: "local";
      id: string;
      nome: string;
      uf: string | null;
    }
  | {
      origem: "ibge";
      ibge_codigo: string;
      nome: string;
      uf: string;
    };

/**
 * Máximo de cidades devolvidas por consulta local.
 *
 * A busca híbrida também limita as sugestões IBGE — ver
 * `LIMITE_SUGESTOES_IBGE` abaixo.
 */
export const LIMITE_CIDADES = 30;
const LIMITE_SUGESTOES_IBGE = 15;

/**
 * Cidades ativas do tenant em ordem alfabética, no máximo `LIMITE_CIDADES`.
 * Sem termo, são as primeiras; com termo, as que contêm o trecho no nome.
 */
export async function listarCidades(
  tenantId: string,
  termo = "",
): Promise<CidadeOpcao[]> {
  const supabase = createClient();

  let query = supabase
    .from("cidades")
    .select("id, nome, uf")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .order("nome")
    .limit(LIMITE_CIDADES);

  const q = termo.trim();
  if (q.length > 0) {
    const escaped = q.replace(/[%_]/g, (m) => `\\${m}`);
    query = query.ilike("nome", `%${escaped}%`);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[cidades.listar]", error.message);
    return [];
  }
  return (data ?? []) as CidadeOpcao[];
}

/** Primeiras cidades — o que a página manda para o combobox abrir cheio. */
export async function listarCidadesIniciais(
  tenantId: string,
): Promise<CidadeOpcao[]> {
  return listarCidades(tenantId);
}

/**
 * Busca híbrida: junta o cadastro local do tenant com sugestões do IBGE
 * que ainda não foram cadastradas (dedupe pelo `ibge_codigo` local).
 *
 * Ordem no combobox: locais primeiro (já cadastradas, escolha de 1 clique)
 * e depois sugestões IBGE (com marcador visual). O usuário nunca fica
 * travado — se nenhuma cidade brasileira serve, ainda existe o cadastro
 * manual pelo /cadastros/cidades.
 */
export async function buscarSugestoesHibridas(
  tenantId: string,
  termo: string,
): Promise<CidadeSugestao[]> {
  const [locaisRes, ibgeSugestoes] = await Promise.all([
    listarCidades(tenantId, termo),
    buscarMunicipiosIBGE(termo, LIMITE_SUGESTOES_IBGE),
  ]);

  // Pra dedupe, precisa saber que códigos IBGE já estão no cadastro.
  // A `listarCidades` acima só devolve id/nome/uf — busca à parte só dos
  // códigos das cidades ativas do tenant (dado leve, indexado por tenant).
  const supabase = createClient();
  const { data: locaisComCodigo } = await supabase
    .from("cidades")
    .select("ibge_codigo")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .not("ibge_codigo", "is", null);

  const codigosLocais = new Set(
    (locaisComCodigo ?? [])
      .map((r: { ibge_codigo: string | null }) => r.ibge_codigo)
      .filter((c): c is string => c !== null),
  );

  const locais: CidadeSugestao[] = locaisRes.map((c) => ({
    origem: "local" as const,
    id: c.id,
    nome: c.nome,
    uf: c.uf,
  }));

  const ibge: CidadeSugestao[] = ibgeSugestoes
    .filter((m) => !codigosLocais.has(m.codigo))
    .map((m) => ({
      origem: "ibge" as const,
      ibge_codigo: m.codigo,
      nome: m.nome,
      uf: m.uf,
    }));

  return [...locais, ...ibge];
}
