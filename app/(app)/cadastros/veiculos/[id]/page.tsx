import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Fornecedor } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { VeiculoForm } from "../veiculo-form";

export const dynamic = "force-dynamic";

/** O cadastro do veículo (decisão 150): o fornecedor marcado como veículo. */
export default async function EditarVeiculoPage({ params }: { params: { id: string } }) {
  const session = await requireSession();
  const supabase = createClient();

  const { data, error } = await supabase
    .from("veiculos_midia")
    .select("fornecedor:fornecedores!inner(*)")
    .eq("fornecedor_id", params.id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ fornecedor: Fornecedor }>();

  if (error) console.error("[cadastros.veiculos.detalhe]", error.message);
  const fornecedor = data?.fornecedor;
  if (!fornecedor) notFound();

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <BotaoVoltar reserva="/cadastros/veiculos" />
        <div className="mt-3 flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">{fornecedor.nome}</h1>
          <Badge variant="outline">{fornecedor.tipo_pessoa === "fisica" ? "PF" : "PJ"}</Badge>
          {fornecedor.status === "ativo" ? (
            <Badge variant="soft">Ativo</Badge>
          ) : (
            <Badge variant="neutral">Inativo</Badge>
          )}
        </div>
      </div>

      <VeiculoForm fornecedor={fornecedor} />
    </div>
  );
}
