"use client";

import * as React from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

type Props = {
  empresasGerenciais: React.ReactNode;
  empresasContabeis: React.ReactNode;
};

export function EmpresasTabs({ empresasGerenciais, empresasContabeis }: Props) {
  return (
    <Tabs defaultValue="gerenciais">
      <TabsList className="mb-6">
        <TabsTrigger value="gerenciais">Gerenciais</TabsTrigger>
        <TabsTrigger value="contabeis">Contábeis</TabsTrigger>
      </TabsList>

      <TabsContent value="gerenciais">{empresasGerenciais}</TabsContent>
      <TabsContent value="contabeis">{empresasContabeis}</TabsContent>
    </Tabs>
  );
}
