"use client";

import * as React from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type EmpresaOption = { id: string; nome: string };
export type RegionalOption = { id: string; nome: string; empresa_id: string };

export type SelectEmpresaRegionalProps = {
  empresas: EmpresaOption[];
  regionais: RegionalOption[];
  empresaId: string;
  regionalId: string;
  onEmpresaChange: (id: string) => void;
  onRegionalChange: (id: string) => void;
  empresaLabel?: string;
  regionalLabel?: string;
  required?: boolean;
  disabled?: boolean;
  errorEmpresa?: string;
  errorRegional?: string;
};

/**
 * Cascata empresa → regional. Combo de regional fica desabilitado até
 * empresa ter valor. Ao trocar empresa, chama `onRegionalChange("")`
 * para o pai limpar a regional. Filtro interno: regionais.filter(r =>
 * r.empresa_id === empresaId).
 */
export function SelectEmpresaRegional(props: SelectEmpresaRegionalProps) {
  const {
    empresas,
    regionais,
    empresaId,
    regionalId,
    onEmpresaChange,
    onRegionalChange,
    empresaLabel = "Empresa",
    regionalLabel = "Regional",
    required = true,
    disabled = false,
    errorEmpresa,
    errorRegional,
  } = props;

  const regionaisDisponiveis = React.useMemo(
    () => regionais.filter((r) => r.empresa_id === empresaId),
    [regionais, empresaId],
  );

  const handleEmpresaChange = (id: string) => {
    onEmpresaChange(id);
    onRegionalChange("");
  };

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="select-empresa">
          {empresaLabel}
          {required && " *"}
        </Label>
        <Select
          value={empresaId}
          onValueChange={handleEmpresaChange}
          disabled={disabled}
        >
          <SelectTrigger id="select-empresa">
            <SelectValue placeholder="Selecione a empresa" />
          </SelectTrigger>
          <SelectContent>
            {empresas.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errorEmpresa && (
          <p className="text-sm text-destructive">{errorEmpresa}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="select-regional">
          {regionalLabel}
          {required && " *"}
        </Label>
        <Select
          value={regionalId}
          onValueChange={onRegionalChange}
          disabled={disabled || empresaId === ""}
        >
          <SelectTrigger id="select-regional">
            <SelectValue
              placeholder={
                empresaId === ""
                  ? "Escolha a empresa primeiro"
                  : "Selecione a regional"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {regionaisDisponiveis.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errorRegional && (
          <p className="text-sm text-destructive">{errorRegional}</p>
        )}
      </div>
    </div>
  );
}
