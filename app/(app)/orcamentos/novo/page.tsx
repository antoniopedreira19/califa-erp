import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listActiveMembers, listarGpsAtivos } from "@/lib/data/members";
import { listEmpresasAtivas, getEmpresaPrincipal } from "@/lib/data/empresas";
import type { CategoriaDominio, Regional } from "@/lib/types";
import { ProjetoForm } from "../projeto-form";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";

export const dynamic = "force-dynamic";

export default async function NovoProjetoPage() {
  const session = await requireSession();
  const supabase = createClient();

  // Cliente e marcas saíram do projeto (decisão 215): são do orçamento.
  const [responsaveis, gps, regionaisRes, categoriasRes, empresas, principal] = await Promise.all([
    listActiveMembers(session.activeTenant.id),
    // GPs Responsáveis: só quem pode ser GP (decisão 170).
    listarGpsAtivos(session.activeTenant.id),
    supabase
      .from("regionais")
      .select("id, nome, empresa_id")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      // Regional só de folha (AMBEV) não é opção de projeto — decisão 134.
      .eq("disponivel_em_projetos", true)
      .order("nome"),
    supabase
      .from("categorias_dominio")
      .select("id, nome")
      .eq("tenant_id", session.activeTenant.id)
      .eq("escopo", "projeto")
      .eq("ativo", true)
      .order("nome"),
    listEmpresasAtivas(session.activeTenant.id),
    getEmpresaPrincipal(session.activeTenant.id),
  ]);

  const regionais = (regionaisRes.data ?? []) as Pick<Regional, "id" | "nome" | "empresa_id">[];
  const categorias = (categoriasRes.data ?? []) as Pick<
    CategoriaDominio,
    "id" | "nome"
  >[];

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <BotaoVoltar reserva="/orcamentos" />
        <h1 className="mt-3 text-3xl font-bold tracking-tight">Novo projeto</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          O código do projeto é gerado automaticamente no formato{" "}
          <span className="font-mono">P-NNNN/AA</span>.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
        <ProjetoForm
          empresas={empresas}
          empresaPrincipalId={principal?.id}
          responsaveis={responsaveis}
          gps={gps}
          regionais={regionais}
          categorias={categorias}
          criadorId={session.profile.id}
        />
      </div>
    </div>
  );
}
