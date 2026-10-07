"use client";

// O formulário completo do veículo (decisão 150): o do fornecedor, na
// variante "veiculo" — pagamento opcional, e Cancelar e Criar voltando para a
// lista de veículos. Quando o CNPJ já é de um fornecedor, "Usar este
// cadastro" só o marca como veículo e abre o cadastro dele.

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { FornecedorForm } from "@/app/(app)/fornecedores/fornecedor-form";
import { marcarFornecedorComoVeiculo } from "@/app/(app)/fornecedores/actions";
import type { Fornecedor } from "@/lib/types";

export function VeiculoForm({ fornecedor }: { fornecedor?: Fornecedor }) {
  const router = useRouter();
  const [erro, setErro] = React.useState<string | null>(null);

  return (
    <div className="space-y-4">
      {erro && (
        <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{erro}</span>
        </div>
      )}
      <FornecedorForm
        fornecedor={fornecedor}
        variante="veiculo"
        onSelecionarExistente={async (f) => {
          setErro(null);
          const r = await marcarFornecedorComoVeiculo(f.id);
          if (!r.ok) {
            setErro(r.message);
            return;
          }
          router.push(`/cadastros/veiculos/${f.id}`);
        }}
      />
    </div>
  );
}
