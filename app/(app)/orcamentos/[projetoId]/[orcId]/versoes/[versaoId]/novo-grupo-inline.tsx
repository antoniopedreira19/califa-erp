"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, FolderPlus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { criarGrupo, type ActionResult } from "../actions";
import { BOTAO_NOVO_GRUPO } from "@/app/(app)/_planilha/blocos";

interface Props {
  versaoId: string;
  disabled?: boolean;
  disabledReason?: string;
  /** Nasce com o campo já aberto. É o caso da planilha (ou do mês) sem
   *  nenhum agrupamento: a tela abre pedindo o nome do primeiro, em vez de
   *  mostrar um botão para clicar antes (21/09/2026). Quem monta passa
   *  também uma `key` que muda com isto, para o estado renascer ao trocar
   *  de mês na régua. */
  abrirDeInicio?: boolean;
  /** Mês em que o grupo nasce — obrigatório no modelo mensal (decisão
   *  078), ausente nos demais. */
  mesId?: string;
  /** "julho" — entra no rótulo acessível do campo. Na tela o mês já está
   *  no título da seção, logo acima da planilha. */
  nomeDoMes?: string;
}

/**
 * "Novo grupo" sem diálogo (21/09/2026, pedido do Tiago).
 *
 * Era um pop-up com um campo só. Agora o gatilho VIRA o campo, no próprio
 * lugar, com a mesma forma do renomear de `NomeDoGrupo` (`grupo-linha.tsx`):
 * campo de 28px, ✓ vermelho, ✕, Esc cancela, erro na própria linha. Ele
 * mora na linha tracejada que já diz "o grupo novo entra aqui" — quem
 * confirma vê o grupo nascer exatamente onde digitou.
 *
 * Planilha sem nenhum agrupamento abre com o campo JÁ em edição
 * (`abrirDeInicio`), com "Nomeie o agrupamento" ao fundo. Não existe mais
 * agrupamento padrão gravado — nem o "Novo grupo" que a v1 nacional trazia,
 * nem estado vazio com botão: nas palavras do Tiago, "nada poderá ser feito
 * com um agrupamento sem nome", então ele só passa a existir com nome.
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
  abrirDeInicio = false,
  mesId,
  nomeDoMes,
}: Props) {
  const router = useRouter();
  const [aberto, setAberto] = React.useState(abrirDeInicio && !disabled);
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
            nomeDoMes
              ? `Nome do novo agrupamento de ${nomeDoMes}`
              : "Nome do novo agrupamento"
          }
          placeholder="Nomeie o agrupamento"
          className="h-7 w-[240px] max-w-full bg-white"
          onKeyDown={(e) => {
            if (e.key === "Escape") sair();
          }}
        />
        <button
          type="submit"
          disabled={pending}
          title="Criar agrupamento"
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
      className={BOTAO_NOVO_GRUPO}
    >
      <FolderPlus className="h-3.5 w-3.5" />
      Novo grupo
    </button>
  );
}
