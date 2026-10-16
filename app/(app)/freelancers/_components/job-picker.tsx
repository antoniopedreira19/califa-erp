"use client";

import { Combobox } from "@/components/ui/combobox";

export interface JobItem {
  id: string;
  codigo: string;
  nome: string;
}

interface Props {
  jobs: JobItem[];
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  id?: string;
}

export function JobPicker({ jobs, value, onChange, disabled, id }: Props) {
  const items = jobs.map((j) => ({
    value: j.id,
    label: j.nome,
    descricao: j.codigo,
    busca: j.codigo,
  }));

  return (
    <Combobox
      items={items}
      value={value}
      onChange={onChange}
      disabled={disabled}
      id={id}
      placeholder="Escolha um job"
      buscaPlaceholder="Buscar por código ou nome..."
      limpavel
    />
  );
}
