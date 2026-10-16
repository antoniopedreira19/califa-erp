"use client";

import { Combobox } from "@/components/ui/combobox";
import { roleLabel, type AppRole } from "@/lib/types";

export interface ResponsavelItem {
  id: string;
  nome: string;
  email: string;
  role: AppRole;
}

interface Props {
  responsaveis: ResponsavelItem[];
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  id?: string;
}

export function ResponsavelPicker({
  responsaveis,
  value,
  onChange,
  disabled,
  id,
}: Props) {
  const items = responsaveis.map((r) => ({
    value: r.id,
    label: r.nome,
    descricao: `${roleLabel(r.role)} · ${r.email}`,
    busca: r.email,
  }));

  return (
    <Combobox
      items={items}
      value={value}
      onChange={onChange}
      disabled={disabled}
      id={id}
      placeholder="Escolha um responsável"
      buscaPlaceholder="Buscar por nome ou email..."
      limpavel
    />
  );
}
