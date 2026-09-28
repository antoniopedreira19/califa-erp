"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import type { CategoriaModeloPlanilha } from "@/lib/types";
import { ImportarPlanilhaDialog } from "@/app/(app)/orcamentos/_importacao/importar-planilha-dialog";
import {
  confirmarImportacao,
  previewImportacao,
  sobrescreverVersaoComPlanilha,
} from "./importar-actions";

/** O que a importação faz com o conteúdo.
 *
 *  `nova-versao` é a porta da tela do ORÇAMENTO: cria uma v+1 com a
 *  planilha, sem tocar no que existe. `sobrescrever` é a porta da tela da
 *  VERSÃO: troca o conteúdo da versão aberta, apagando grupos, itens e os
 *  BVs deles. Atende o caso "importei a planilha errada, quero a certa no
 *  mesmo lugar" (decisão do time, 13/08/2026).
 *
 *  As duas usam o mesmo modal (decisão 110, que trocou o drawer lateral
 *  por ele). O que muda é o destino e, em `sobrescrever` de versão com
 *  conteúdo, o "Tem certeza?" antes de gravar. */
export type ModoImportacao = "nova-versao" | "sobrescrever";

interface Props {
  projetoId: string;
  orcamentoId: string;
  /** Modelo do orçamento (decisão 072). Muda o desenho do formato; o
   *  servidor recusa planilha do outro modelo. Obrigatório. */
  modeloPlanilha: CategoriaModeloPlanilha;
  /** Orçamento de serviço Interno (decisão 105): toda linha entra como
   *  F · Interno com o planejado igual ao orçado — quem grava é o banco.
   *  A pergunta "de onde vem o planejado" não existe aqui. Obrigatório. */
  interno: boolean;
  disabled?: boolean;
  disabledReason?: string;
  modo?: ModoImportacao;
  /** Obrigatório em `sobrescrever`: a versão que vai receber a planilha. */
  versaoId?: string;
  /** Número da versão aberta, para o "Tem certeza?" dizer qual é. */
  numeroVersao?: number;
  /** O que existe hoje na versão, para a confirmação dizer o tamanho do
   *  estrago em número, não em advérbio. Versão vazia não pergunta nada. */
  conteudoAtual?: { grupos: number; itens: number; bvs: number };
  /** Controle externo. O menu "+" das abas do orçamento abre o modal sem
   *  ter um gatilho próprio para clicar. */
  aberto?: boolean;
  onAbertoChange?: (aberto: boolean) => void;
  /** Esconde o botão-gatilho: quem abre é quem controla. */
  semGatilho?: boolean;
}

export function ImportarPlanilhaVersao({
  projetoId,
  orcamentoId,
  modeloPlanilha,
  interno,
  disabled,
  disabledReason,
  modo = "nova-versao",
  versaoId,
  numeroVersao,
  conteudoAtual,
  aberto,
  onAbertoChange,
  semGatilho,
}: Props) {
  const sobrescreve = modo === "sobrescrever";
  const router = useRouter();
  const [abertoInterno, setAbertoInterno] = React.useState(false);
  const open = aberto ?? abertoInterno;
  const setOpen = onAbertoChange ?? setAbertoInterno;

  const vazia = !conteudoAtual || (conteudoAtual.grupos === 0 && conteudoAtual.itens === 0);
  const rotuloVersao = numeroVersao ? `v${numeroVersao}` : "versão";

  const formato =
    modeloPlanilha === "internacional"
      ? "Envie o arquivo .xlsx no modelo internacional."
      : modeloPlanilha === "mensal"
        ? "Envie a planilha exportada deste orçamento ou a planilha interna da agência, com um bloco por mês."
        : "Envie o arquivo .xlsx no formato padrão da agência.";
  const destino = sobrescreve
    ? "O conteúdo atual da versão será substituído pelo da planilha."
    : "Uma nova versão é criada em rascunho com os grupos e itens da planilha.";

  return (
    <>
      {!semGatilho && (
        <button
          type="button"
          disabled={disabled}
          title={disabled ? disabledReason : undefined}
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-foreground shadow-sm transition-all hover:border-california-red/40 hover:text-california-red disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Upload className="h-3.5 w-3.5" />
          Importar planilha
        </button>
      )}
      <ImportarPlanilhaDialog
        open={open}
        onOpenChange={setOpen}
        titulo={sobrescreve ? "Importar planilha nesta versão" : "Importar planilha de orçamento"}
        descricao={`${formato} ${destino}`}
        modeloPlanilha={modeloPlanilha}
        interno={interno}
        orcamentoId={orcamentoId}
        mostrarHonorarios
        ler={(envio) =>
          previewImportacao(orcamentoId, { envio, versao_id: sobrescreve ? (versaoId ?? null) : null })
        }
        gravar={async (g) => {
          const res =
            sobrescreve && versaoId
              ? await sobrescreverVersaoComPlanilha(versaoId, g)
              : await confirmarImportacao(orcamentoId, g);
          if (!res.ok) return res;
          // Sobrescrevendo já estamos na versão certa — só recarregar.
          // Criando, é preciso ir até a versão nova.
          if (!sobrescreve) {
            router.push(`/orcamentos/${projetoId}/${res.orcamento_id}?v=${res.versao_id}`);
          }
          router.refresh();
          return { ok: true };
        }}
        confirmarSubstituicao={
          sobrescreve && conteudoAtual
            ? { versao: rotuloVersao, ...conteudoAtual }
            : null
        }
        rotuloGravar={
          sobrescreve ? (vazia ? "Importar planilha" : "Substituir conteúdo da versão") : "Criar versão importada"
        }
        textoGravando={
          sobrescreve
            ? vazia
              ? "Importando a planilha..."
              : "Substituindo o conteúdo da versão..."
            : "Criando a versão e gravando os itens..."
        }
      />
    </>
  );
}
