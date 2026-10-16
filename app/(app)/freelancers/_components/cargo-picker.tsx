"use client";

import { Combobox } from "@/components/ui/combobox";
import type { FreelancerCargo } from "@/lib/types";

interface Props {
  cargos: FreelancerCargo[];
  value: string | null;
  onChange: (cargo: string | null) => void;
  disabled?: boolean;
  id?: string;
}

/**
 * Picker de cargo que trabalha pelo **nome** do cargo, não pelo id —
 * `freelancer_contratos.cargo` é text livre (com autocomplete via
 * `freelancer_cargos`). Isso permite que contratos migrados do
 * AgCaliforniaRH tragam cargos legados que não estão mais no catálogo
 * ativo sem precisar inserir cargo inativo na tabela.
 */
export function CargoPicker({ cargos, value, onChange, disabled, id }: Props) {
  const items = cargos
    .filter((c) => c.ativo || c.nome === value) // mantém o selecionado mesmo se inativo
    .map((c) => ({
      value: c.nome,
      label: c.nome,
    }));

  return (
    <Combobox
      items={items}
      value={value}
      onChange={onChange}
      disabled={disabled}
      id={id}
      placeholder="Escolha o cargo"
      buscaPlaceholder="Buscar cargo..."
      limpavel
      cabecalhoLista={
        <p className="text-[11px] text-muted-foreground">
          Não achou? Vá em{" "}
          <strong>Freelancers → Gerenciar cargos</strong> para criar.
        </p>
      }
    />
  );
}
