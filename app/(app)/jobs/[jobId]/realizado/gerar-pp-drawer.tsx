"use client";
import * as React from "react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemRealizadoId: string | null;
  jobId: string;
  fornecedores: Array<{ id: string; nome: string; razao_social: string | null }>;
  empresas: Array<{ id: string; razao_social: string; principal: boolean }>;
  defaultEmpresaId: string;
  itemDescricao: string;
  valorRealizado: number;
  quantidadeRealizada: number;
}
export function GerarPPDrawer(_props: Props) {
  return null; // stub — sera implementado na Task 5
}
