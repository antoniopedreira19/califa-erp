import type { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";

type Supabase = ReturnType<typeof createClient>;

/**
 * O GP de fora entra nos GPs Responsáveis do projeto (decisão 176).
 *
 * O campo "GP Responsável" do orçamento oferece todo membro que pode ser GP;
 * quem ainda não é GP do projeto passa a ser quando o orçamento é criado,
 * editado ou enviado para abertura — como na troca do GP do job aberto. Quem
 * estava só na Equipe (`papel = 'equipe'`) vira GP. A função do banco
 * confere de novo se a pessoa pode ser GP (decisão 170).
 *
 * Chame DEPOIS de gravar o orçamento: uma recusa antes deixaria o projeto
 * mudado sem orçamento nenhum.
 */
export async function incluirGpNoProjeto(
  supabase: Supabase,
  entrada: {
    tenantId: string;
    projetoId: string;
    gpId: string;
    origem: "orcamento_criado" | "orcamento_editado" | "envio_para_abertura";
    orcamentoId: string;
  },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data, error } = await supabase.rpc("incluir_gp_no_projeto", {
    p_projeto_id: entrada.projetoId,
    p_profile_id: entrada.gpId,
  });
  if (error) {
    console.error("[projeto.incluir_gp]", error.message);
    const limpa = error.message.replace(/^.*?(?:ERROR|erro):\s*/i, "").trim();
    return {
      ok: false,
      message:
        limpa && !/[_"]/.test(limpa)
          ? limpa
          : "Não foi possível incluir o GP nos GPs Responsáveis do projeto.",
    };
  }
  if (data === true) {
    await logAuditEvent({
      acao: "projeto.gp_incluido",
      tenantId: entrada.tenantId,
      entidadeTipo: "projeto",
      entidadeId: entrada.projetoId,
      metadata: {
        decisao: "176",
        gp_id: entrada.gpId,
        origem: entrada.origem,
        orcamento_id: entrada.orcamentoId,
      },
    });
  }
  return { ok: true };
}
