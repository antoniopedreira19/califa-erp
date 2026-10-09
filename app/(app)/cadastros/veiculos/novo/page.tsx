import { requireSession } from "@/lib/auth/session";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { VeiculoForm } from "../veiculo-form";

export default async function NovoVeiculoPage() {
  await requireSession();

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
