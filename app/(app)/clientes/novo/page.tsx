import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { pode } from "@/lib/permissoes";
import { ClienteForm } from "../cliente-form";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";

export default async function NovoClientePage() {
  const session = await requireSession();
  // A página barra com a mesma regra do menu (10/11/2026): quem não vê
  // Cadastros na barra não abre a tela digitando o endereço.
  if (!pode(session.activeRole, "cadastros.clientes.ver")) {
    redirect("/home?reason=sem_permissao_cadastros");
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <BotaoVoltar reserva="/clientes" />
        <h1 className="mt-3 text-3xl font-bold tracking-tight">Novo cliente</h1>
        <p className="mt-1 max-w-[62ch] text-sm text-muted-foreground">
          Cadastre a empresa e as marcas dela de uma vez — o cliente já nasce
          pronto para abrir projeto.
        </p>
      </div>

      {/* Sem cartão em volta: o formulário traz o próprio (09/09/2026). */}
      <ClienteForm />
    </div>
  );
}
