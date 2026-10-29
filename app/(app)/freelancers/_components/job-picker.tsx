"use client";

import { Combobox } from "@/components/ui/combobox";

export interface JobItem {
  id: string;
  codigo: string;
  nome: string;
  /**
   * Fonte do job. Determina em qual coluna o contrato vai gravar o FK:
   * 'producao' → `job_id` (tabela `jobs`); 'interno' → `job_interno_id`
   * (tabela `freelancer_jobs_internos`). Default 'producao' pra compat
   * com chamadores antigos que ainda não passam a origem.
   */
  origem?: "producao" | "interno";
}

interface Props {
  jobs: JobItem[];
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  id?: string;
}

/**
 * Renderiza jobs de produção e jobs internos no mesmo combobox, agrupados.
 * O `grupo` do Combobox separa visualmente — a lista mostra um cabeçalho
 * "Produção" / "Interno" antes de cada bloco.
 *
 * Dentro do grupo, a ordem é a que vem na prop `jobs` (chamador ordena).
 * Pra manter os blocos juntos na lista, o chamador deve passar os de produção
 * em bloco e depois os internos em bloco (ou vice-versa) — a ordem dos
 * grupos na lista espelha a ordem de aparição.
 */
export function JobPicker({ jobs, value, onChange, disabled, id }: Props) {
  const items = jobs.map((j) => ({
    value: j.id,
    label: j.nome,
    descricao: j.codigo,
    busca: j.codigo,
    grupo: j.origem === "interno" ? "Interno" : "Produção",
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
