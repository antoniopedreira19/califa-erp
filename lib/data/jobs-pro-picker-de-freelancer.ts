import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobItem } from "@/app/(app)/freelancers/_components/job-picker";

const JOBS_STATUS_EXCLUIDOS = ["cancelado", "rejeitado_financeiro"];

/**
 * Carrega jobs pro picker usado no cadastro/edição de contrato e solicitação
 * de freelancer. Lê DAS DUAS FONTES — tabela `jobs` (produção) e
 * `freelancer_jobs_internos` (interno). O picker mostra os dois agrupados
 * (Produção primeiro, Interno depois).
 *
 * Jobs internos arquivados ficam de fora — não devem aparecer pra escolha
 * em contrato novo, mas continuam ligados a contratos antigos pelo FK.
 */
export async function jobsProPickerDeFreelancer(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<JobItem[]> {
  const [producaoRes, internoRes] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, codigo, nome, status")
      .eq("tenant_id", tenantId)
      .not("status", "in", `(${JOBS_STATUS_EXCLUIDOS.join(",")})`)
      .order("codigo", { ascending: false })
      .limit(500),
    supabase
      .from("freelancer_jobs_internos")
      .select("id, nome")
      .eq("tenant_id", tenantId)
      .is("arquivado_em", null)
      .order("nome", { ascending: true }),
  ]);

  const producao: JobItem[] = (producaoRes.data ?? []).map(
    (j: { id: string; codigo: string; nome: string }) => ({
      id: j.id,
      codigo: j.codigo,
      nome: j.nome,
      origem: "producao" as const,
    }),
  );
  const interno: JobItem[] = (internoRes.data ?? []).map(
    (j: { id: string; nome: string }) => ({
      id: j.id,
      // Internos não têm código — passa string vazia (o Combobox só mostra
      // na busca/descrição, não no label principal).
      codigo: "",
      nome: j.nome,
      origem: "interno" as const,
    }),
  );

  return [...producao, ...interno];
}
