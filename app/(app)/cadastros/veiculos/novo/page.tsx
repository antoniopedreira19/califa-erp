import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { pode } from "@/lib/permissoes";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { VeiculoForm } from "../veiculo-form";

export default async function NovoVeiculoPage() {
  const session = await requireSession();
  // A página barra com a mesma regra do menu (10/11/2026): quem não vê
  // Cadastros na barra não abre a tela digitando o endereço.
  if (!pode(session.activeRole, "cadastros.fornecedores.ver")) {
    redirect("/home?reason=sem_permissao_cadastros");
  }

  return (
    // A página do "Novo fornecedor", para o veículo (decisão 150).
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <BotaoVoltar reserva="/cadastros/veiculos" />
        <h1 className="mt-2.5 text-[28px] font-bold leading-tight tracking-tight">Novo veículo</h1>
        <p className="mt-1 max-w-[60ch] text-[13.5px] text-muted-foreground">
          Nome, CPF/CNPJ, regime tributário, CNAE e contato são obrigatórios — pagamento, endereço e observações
          podem ficar para depois.
        </p>
      </div>

      <VeiculoForm />
    </div>
  );
}
