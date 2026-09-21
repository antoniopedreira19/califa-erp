"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, FolderPlus, Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { criarGrupo, type ActionResult } from "../actions";
import { BOTAO_NOVO_GRUPO } from "@/app/(app)/_planilha/blocos";

interface Props {
  versaoId: string;
  disabled?: boolean;
  disabledReason?: string;
  /** Forma do gatilho.
   *
   *  `"tracejada"` é a do handoff "Grupos Unificados": o botão mora numa
   *  linha tracejada DENTRO da tabela, depois do último grupo, mostrando
   *  onde o grupo novo vai nascer. Ali ele não pode ser sólido — seria o
   *  elemento mais pesado da planilha, competindo com os números.
   *
   *  `"solida"` continua para o estado vazio, em que ele é a única ação
   *  da tela e precisa ser o botão primário. */
  variante?: "solida" | "tracejada";
  /** Mês em que o grupo nasce — obrigatório no modelo mensal (decisão
   *  078), ausente nos demais. */
  mesId?: string;
  /** "julho" — entra no texto do campo, para quem cria saber em qual mês
   *  o grupo vai morar. */
  nomeDoMes?: string;
}

const GATILHO_SOLIDO =
  "inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-california-red-hover transition-all disabled:opacity-50 disabled:cursor-not-allowed";

/**
 * "Novo grupo" sem diálogo (21/09/2026, pedido do Tiago).
 *
 * Era um pop-up com um campo só. Agora o gatilho VIRA o campo, no próprio
 * lugar, com a mesma forma do renomear de `NomeDoGrupo` (`grupo-linha.tsx`):
 * campo de 28px, ✓ vermelho, ✕, Esc cancela, erro na própria linha. Na
 * variante tracejada isso acontece na linha que já diz "o grupo novo entra
 * aqui" — quem confirma vê o grupo nascer exatamente onde digitou.
 *
 * O grupo só é criado na confirmação. Não há grupo provisório gravado com
 * nome padrão: o nome é único por versão (`uniq_grupo_nome_por_versao`), e
 * um "Novo grupo" esquecido na planilha travaria o próximo. Desistir não
 * deixa rastro.
 */
export function NovoGrupoInline({
  versaoId,
  disabled,
  disabledReason,
  variante = "solida",
  mesId,
  nomeDoMes,
}: Props) {
  const router = useRouter();
  const [aberto, setAberto] = React.useState(false);
  const [nome, setNome] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);

  function sair() {
    setAberto(false);
    setNome("");
    setErro(null);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // A planilha pode estar dentro de outro formulário amanhã: o submit
    // sobe pela árvore do React, e `preventDefault` não o segura.
    e.stopPropagation();
    setErro(null);
    const formData = new FormData(e.currentTarget);
    if (mesId) formData.set("mes_id", mesId);

    startTransition(async () => {
      const res: ActionResult = await criarGrupo(versaoId, formData);
      if (!res.ok) {
        setErro(res.fieldErrors?.nome?.[0] ?? res.message);
        return;
      }
      sair();
      router.refresh();
    });
  }

  if (aberto) {
    return (
      <form onSubmit={handleSubmit} className="flex min-w-0 items-center gap-2">
        <Input
          name="nome"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          autoFocus
          required
          aria-label={
            nomeDoMes ? `Nome do novo grupo de ${nomeDoMes}` : "Nome do novo grupo"
          }
          placeholder={
            nomeDoMes ? `Nome do grupo em ${nomeDoMes}` : "Nome do grupo"
          }
          className="h-7 w-[240px] max-w-full bg-white"
          onKeyDown={(e) => {
            if (e.key === "Escape") sair();
          }}
        />
        <button
          type="submit"
          disabled={pending}
          title="Criar grupo"
          className="rounded-md bg-california-red p-1 text-white transition-colors hover:bg-california-red-hover disabled:opacity-50"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={sair}
          disabled={pending}
          title="Cancelar"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-white disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        {erro && (
          <span className="whitespace-nowrap text-[11px] text-california-red">
            {erro}
          </span>
        )}
      </form>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setAberto(true)}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      className={variante === "tracejada" ? BOTAO_NOVO_GRUPO : GATILHO_SOLIDO}
    >
      {variante === "tracejada" ? (
        <FolderPlus className="h-3.5 w-3.5" />
      ) : (
        <Plus className="h-3.5 w-3.5" />
      )}
      Novo grupo
    </button>
  );
}
