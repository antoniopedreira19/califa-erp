"use client";

import * as React from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

type Aba = "equipe" | "ferias";

export function EquipeTabs({
  equipeContent,
  feriasContent,
  badgeFerias,
}: {
  equipeContent: React.ReactNode;
  feriasContent: React.ReactNode;
  badgeFerias?: number;
}) {
  const [aba, setAba] = React.useState<Aba>("equipe");
  return (
    <Tabs value={aba} onValueChange={(v) => setAba(v as Aba)}>
      <TabsList className="mb-6">
        <TabsTrigger value="equipe">Equipe</TabsTrigger>
        <TabsTrigger value="ferias" className="gap-2">
          Férias
          {badgeFerias && badgeFerias > 0 ? (
            <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white">
              {badgeFerias}
            </span>
          ) : null}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="equipe">{equipeContent}</TabsContent>
      <TabsContent value="ferias">{feriasContent}</TabsContent>
    </Tabs>
  );
}
