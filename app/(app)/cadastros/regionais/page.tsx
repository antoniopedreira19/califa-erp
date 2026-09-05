import Link from "next/link";
import { ArrowLeft, MapPin } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Regional } from "@/lib/types";
import { RegionaisList } from "./regionais-list";

export const dynamic = "force-dynamic";

export default async function RegionaisPage() {
  const session = await requireSession();
  const supabase = createClient();

  const { data, error } = await supabase
    .from("regionais")
    .select("*")
    .eq("tenant_id", session.activeTenant.id)
    .order("nome", { ascending: true })
    .returns<Regional[]>();

  if (error) console.error("[regionais.page]", error.message);

  const rows = data ?? [];
  const isAdmin = session.activeRole === "administrador";

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/cadastros"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para cadastros
        </Link>
        <header className="mt-3 space-y-2">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-california-red/10 p-2">
              <MapPin className="h-5 w-5 text-california-red" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Regionais</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Vocabulário de regionais compartilhado pelo tenant. Usado ao criar jobs.
          </p>
        </header>
      </div>

      <RegionaisList regionais={rows} isAdmin={isAdmin} />
    </div>
  );
}
