import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import type { Contratacao, Empresa } from "@/lib/types";
import { ContratacaoDetalheView } from "./detalhe-view";
import { expirarContratacoesVencidas } from "@/app/proposta/[token]/actions";

export const dynamic = "force-dynamic";

export default async function ContratacaoDetalhePage({
  params,
}: {
  params: { id: string };
}) {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "rh") {
    redirect("/home?reason=sem_permissao_rh");
  }

  // Marca vencidas antes de carregar — v1 sem cron.
  await expirarContratacoesVencidas(session.activeTenant.id);

  const supabase = createClient();
  // Sem embeds — contratacoes tem duas FKs pra regionais (simples e
  // composta com empresa_id), o que deixa o PostgREST ambíguo e retorna
  // erro silencioso na query. Resolvo empresa/regional/nivel por
  // lookup em paralelo. Mesmo padrão adotado em /rh/colaboradores.
  const { data: base, error } = await supabase
    .from("contratacoes")
    .select("*")
    .eq("id", params.id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (error) console.error("[rh.contratacao.detalhe]", error.message);
  if (!base) notFound();

  const c = base as unknown as Contratacao;

  const [empresaRes, regionalRes, nivelRes] = await Promise.all([
    supabase
      .from("empresas")
      .select("id, nome_fantasia")
      .eq("id", c.empresa_id)
      .maybeSingle(),
    c.regional_id
      ? supabase
          .from("regionais")
          .select("id, nome")
          .eq("id", c.regional_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    c.nivel_id
      ? supabase
          .from("niveis")
          .select("id, codigo, descricao")
          .eq("id", c.nivel_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const contratacao = {
    ...c,
    empresa: empresaRes.data as Pick<Empresa, "id" | "nome_fantasia"> | null,
    regional: regionalRes.data as { id: string; nome: string } | null,
    nivel: nivelRes.data as
      | { id: string; codigo: string; descricao: string | null }
      | null,
  };

  // Monta a URL pública que o RH copia — origin vem do ENV pra
  // ambientes que não são o Vercel deployment.
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "https://www.sistemacalifa.com.br";
  const linkPublico = `${baseUrl}/proposta/${contratacao.token}`;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <BotaoVoltar reserva="/rh/contratacoes" />
      <ContratacaoDetalheView
        contratacao={contratacao}
        linkPublico={linkPublico}
      />
    </div>
  );
}
