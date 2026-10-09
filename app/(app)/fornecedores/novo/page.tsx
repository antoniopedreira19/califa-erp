import { requireSession } from "@/lib/auth/session";
import { FornecedorForm } from "../fornecedor-form";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";

export default async function NovoFornecedorPage() {
  await requireSession();

  return (
    // O cartão saiu daqui: o formulário traz o próprio, com as seções
    // divididas por filete (desenho de 09/09/2026). A largura acompanha a
    // coluna de explicação de cada seção.
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <BotaoVoltar reserva="/fornecedores" />
        <h1 className="mt-2.5 text-[28px] font-bold leading-tight tracking-tight">
          Novo fornecedor
        </h1>
        <p className="mt-1 max-w-[52ch] text-[13.5px] text-muted-foreground">
          Nome, CPF/CNPJ, regime tributário, CNAE, contato e o pagamento são
          obrigatórios — endereço e observações podem ficar para depois.
        </p>
      </div>

      <FornecedorForm />
    </div>
  );
}
