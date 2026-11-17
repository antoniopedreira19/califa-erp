// Decisão 264: o detalhe do pedido abre na tela do pedido, por cima da
// lista. O endereço antigo continua valendo: o financeiro vai para a aba
// Desembolsos do Contas a Pagar; quem pediu, para a sua lista.
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function DesembolsoDetalhePage({ params }: { params: { id: string } }) {
  const session = await requireSession();
  const id = encodeURIComponent(params.id);
  if (session.activeRole === "administrador" || session.activeRole === "financeiro") {
    redirect(`/financeiro/contas-a-pagar?tab=desembolsos&abrir=${id}`);
  }
  redirect(`/financeiro/desembolsos?abrir=${id}`);
}
