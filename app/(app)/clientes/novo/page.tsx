import { requireSession } from "@/lib/auth/session";
import { ClienteForm } from "../cliente-form";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";

export default async function NovoClientePage() {
  await requireSession();

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
