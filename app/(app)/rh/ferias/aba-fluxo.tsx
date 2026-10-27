import { createClient } from "@/lib/supabase/server";
import type { RhFeriasFluxoRow } from "@/lib/types";
import { FluxoKanban } from "./aba-fluxo-kanban";

export async function AbaFluxo({ tenantId }: { tenantId: string }) {
  const supabase = createClient();
  const { data } = await supabase
    .from("vw_rh_ferias_fluxo")
    .select("*")
    .eq("tenant_id", tenantId);

  const rows = (data ?? []) as RhFeriasFluxoRow[];
  return <FluxoKanban rows={rows} />;
}
