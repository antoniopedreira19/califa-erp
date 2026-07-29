import Link from "next/link";
import { ChevronRight, MapPin } from "lucide-react";
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
      <header className="space-y-1">
        <nav className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
          <Link href="/cadastros" className="hover:text-foreground">
            Cadastros
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span>Regionais</span>
        </nav>
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

      <RegionaisList regionais={rows} isAdmin={isAdmin} />
    </div>
  );
}
