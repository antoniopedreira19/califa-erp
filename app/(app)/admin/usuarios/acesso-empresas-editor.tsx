"use client";

import * as React from "react";
import type { Empresa, Regional } from "@/lib/types";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";

export type AcessoEscopo = "todas" | "personalizado";

export type AcessoEmpresa = {
  empresaId: string;
  regionais: "all" | string[];
};

export type AcessoEmpresasEditorProps = {
  empresas: Pick<Empresa, "id" | "razao_social" | "nome_fantasia">[];
  regionais: Pick<Regional, "id" | "nome" | "empresa_id">[];
  escopo: AcessoEscopo;
  empresasEscolhidas: AcessoEmpresa[];
  onChange: (escopo: AcessoEscopo, empresas: AcessoEmpresa[]) => void;
};

export function AcessoEmpresasEditor({
  empresas,
  regionais,
  escopo,
  empresasEscolhidas,
  onChange,
}: AcessoEmpresasEditorProps) {
  const escolhidasPorId = new Map(
    empresasEscolhidas.map((e) => [e.empresaId, e]),
  );

  const setEscopo = (novo: AcessoEscopo) => onChange(novo, empresasEscolhidas);

  const toggleEmpresa = (empresaId: string, ligada: boolean) => {
    if (ligada) {
      onChange(escopo, [
        ...empresasEscolhidas,
        { empresaId, regionais: "all" },
      ]);
    } else {
      onChange(
        escopo,
        empresasEscolhidas.filter((e) => e.empresaId !== empresaId),
      );
    }
  };

  const setRegionaisDaEmpresa = (
    empresaId: string,
    novoValor: "all" | string[],
  ) => {
    onChange(
      escopo,
      empresasEscolhidas.map((e) =>
        e.empresaId === empresaId ? { ...e, regionais: novoValor } : e,
      ),
    );
  };

  return (
    <div className="space-y-4">
      <Label className="text-sm font-medium">Acesso a empresas</Label>

      <RadioGroup
        value={escopo}
        onValueChange={(v) => setEscopo(v as AcessoEscopo)}
        className="space-y-2"
      >
        <div className="flex items-center gap-2">
          <RadioGroupItem value="todas" id="escopo-todas" />
          <Label htmlFor="escopo-todas" className="cursor-pointer text-sm">
            Todas as empresas do tenant
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem value="personalizado" id="escopo-personalizado" />
          <Label
            htmlFor="escopo-personalizado"
            className="cursor-pointer text-sm"
          >
            Personalizado
          </Label>
        </div>
      </RadioGroup>

      {escopo === "personalizado" && (
        <div className="rounded-lg border border-border p-3 space-y-3">
          {empresas.map((e) => {
            const escolhida = escolhidasPorId.get(e.id);
            const marcada = Boolean(escolhida);
            const nome = e.nome_fantasia ?? e.razao_social;
            const regionaisDaEmpresa = regionais.filter(
              (r) => r.empresa_id === e.id,
            );

            return (
              <div key={e.id} className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={marcada}
                    onCheckedChange={(c) => toggleEmpresa(e.id, c === true)}
                  />
                  <span className="text-sm font-medium">{nome}</span>
                </label>
                {marcada && escolhida && regionaisDaEmpresa.length > 0 && (
                  <div className="pl-6">
                    <RegionaisSubDropdown
                      regionais={regionaisDaEmpresa}
                      valor={escolhida.regionais}
                      onChange={(novo) => setRegionaisDaEmpresa(e.id, novo)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RegionaisSubDropdown({
  regionais,
  valor,
  onChange,
}: {
  regionais: Pick<Regional, "id" | "nome">[];
  valor: "all" | string[];
  onChange: (v: "all" | string[]) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const label =
    valor === "all"
      ? "Todas as regionais"
      : valor.length === 0
        ? "Nenhuma regional"
        : valor.length === 1
          ? (regionais.find((r) => r.id === valor[0])?.nome ?? "1 regional")
          : `${valor.length} regionais`;

  const toggle = (id: string, ligada: boolean) => {
    const atuais = valor === "all" ? [] : [...valor];
    if (ligada) {
      onChange([...atuais, id]);
    } else {
      const restante = atuais.filter((x) => x !== id);
      onChange(restante.length === 0 ? "all" : restante);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="justify-between w-full"
          type="button"
        >
          <span className="text-xs">Regionais: {label}</span>
          <ChevronDown className="h-3 w-3 ml-2 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        avoidCollisions={false}
        className="w-64 p-2"
      >
        <div className="pb-2 mb-2 border-b border-border">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs"
            type="button"
            onClick={() => onChange("all")}
          >
            Todas as regionais
          </Button>
        </div>
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {regionais.map((r) => {
            const checked = valor !== "all" && valor.includes(r.id);
            return (
              <label
                key={r.id}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent cursor-pointer"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(c) => toggle(r.id, c === true)}
                />
                <span className="text-sm">{r.nome}</span>
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
