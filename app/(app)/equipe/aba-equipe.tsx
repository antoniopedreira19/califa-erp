import { Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { TruncateTooltip } from "@/components/ui/truncate-tooltip";
import { tipoContratacaoLabel, type TipoContratacao } from "@/lib/types";

type LinhaEquipe = {
  colaborador_id: string;
  nome: string;
  tipo_contratacao: TipoContratacao;
  alocacao_empresa: string | null;
  alocacao_regional: string | null;
  email_corporativo: string | null;
};

export async function AbaEquipe() {
  const supabase = createClient();
  const { data } = await supabase
    .from("vw_equipe_do_lider")
    .select(
      "colaborador_id, nome, tipo_contratacao, alocacao_empresa, alocacao_regional, email_corporativo",
    )
    .order("nome");

  const linhas = (data ?? []) as LinhaEquipe[];

  if (linhas.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/40 p-12 text-center">
        <Users className="mx-auto h-10 w-10 text-muted-foreground/60" />
        <p className="mt-4 text-sm font-medium">Sua equipe aparecerá aqui.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Quando o RH vincular colaboradores com você como líder direto, eles
          aparecem nesta lista.
        </p>
      </div>
    );
  }

  return (
    <div className="relative overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full table-fixed">
        <colgroup>
          <col style={{ width: 320 }} />
          <col style={{ width: 140 }} />
          <col style={{ width: 320 }} />
          <col />
        </colgroup>
        <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-3 text-left font-medium">Colaborador</th>
            <th className="px-4 py-3 text-left font-medium">Contratação</th>
            <th className="px-4 py-3 text-left font-medium">Alocação</th>
            <th className="px-4 py-3 text-left font-medium">Email</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {linhas.map((l) => {
            const alocacao = formatarAlocacao(l);
            return (
              <tr key={l.colaborador_id} className="hover:bg-slate-50/60">
                <td className="px-4 py-3 align-middle">
                  <TruncateTooltip text={l.nome} linhas={2} />
                </td>
                <td className="px-4 py-3 align-middle text-sm">
                  {tipoContratacaoLabel(l.tipo_contratacao)}
                </td>
                <td className="px-4 py-3 align-middle text-sm">
                  <TruncateTooltip text={alocacao} linhas={2} />
                </td>
                <td className="px-4 py-3 align-middle text-sm text-muted-foreground">
                  {l.email_corporativo ? (
                    <TruncateTooltip
                      text={l.email_corporativo}
                      linhas={2}
                    />
                  ) : (
                    <span className="text-muted-foreground/60">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatarAlocacao(l: LinhaEquipe): string {
  const emp = l.alocacao_empresa ?? "—";
  const reg = l.alocacao_regional ?? null;
  return reg ? `${emp} · ${reg}` : emp;
}
