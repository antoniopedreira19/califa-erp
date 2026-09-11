"use client";

import * as React from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

type Aba = "gerenciais" | "contabeis";

type Props = {
  empresasGerenciais: React.ReactNode;
  empresasContabeis: React.ReactNode;
  acaoGerenciais: React.ReactNode;
  acaoContabeis: React.ReactNode;
};

export function EmpresasTabs({
  empresasGerenciais,
  empresasContabeis,
  acaoGerenciais,
  acaoContabeis,
}: Props) {
  const [aba, setAba] = React.useState<Aba>("gerenciais");

  return (
    <Tabs value={aba} onValueChange={(v) => setAba(v as Aba)}>
      <div className="mb-6 flex items-center justify-between gap-4">
        <TabsList>
          <TabsTrigger value="gerenciais">Gerenciais</TabsTrigger>
          <TabsTrigger value="contabeis">Contábeis</TabsTrigger>
        </TabsList>
        <div>{aba === "gerenciais" ? acaoGerenciais : acaoContabeis}</div>
      </div>

      <TabsContent value="gerenciais">{empresasGerenciais}</TabsContent>
      <TabsContent value="contabeis">{empresasContabeis}</TabsContent>
    </Tabs>
  );
}
