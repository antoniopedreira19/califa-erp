import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Users } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Nivel } from "@/lib/types";
import { NiveisList } from "./niveis-list";

export const dynamic = "force-dynamic";

export default async function NiveisPage() {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "rh") {
    redirect("/home?reason=sem_permissao_rh");
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("niveis")
    .select("*")
    .eq("tenant_id", session.activeTenant.id)
    .returns<Nivel[]>();

  if (error) {
    console.error("[rh.niveis.page]", error.message);
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/rh/colaboradores"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para colaboradores
        </Link>
        <header className="mt-3 space-y-2">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-california-red/10 p-2">
              <Users className="h-5 w-5 text-california-red" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight">
              Níveis de cargo
            </h1>
          </div>
          <p className="text-sm text-muted-foreground max-w-3xl">
            Hierarquia de senioridade dos cargos (N3, N4, N5, extensível).{" "}
            <strong>Não é faixa salarial</strong> — nível serve para classificar
            a posição, salário vive no histórico próprio de cada colaborador.
          </p>
        </header>
      </div>

      <NiveisList niveis={data ?? []} />
    </div>
  );
}
