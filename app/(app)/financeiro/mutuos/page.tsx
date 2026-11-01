import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { carregarMutuos } from "./dados";
import { TelaMutuos } from "./tela-mutuos";

export const dynamic = "force-dynamic";

/** Quem deve a quem entre os CNPJs do grupo e com as empresas de fora (decisão 230). */
export default async function MutuosPage() {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    redirect("/home?reason=sem_permissao_financeira");
  }
  const dados = await carregarMutuos(createClient(), session.activeTenant.id);

  return (
    <div className="space-y-6">
      <BotaoVoltar reserva="/financeiro" />
      <TelaMutuos dados={dados} />
    </div>
  );
}
