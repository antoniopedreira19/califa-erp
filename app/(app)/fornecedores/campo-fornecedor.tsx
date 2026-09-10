"use client";

/** O campo de fornecedor inteiro: busca, ✕ e o botão que cadastra ou edita.
 *
 *  Nasceu em 10/09/2026, quando o desenho "PP - Campo Fornecedor"
 *  (decisão 067) foi para as três telas do financeiro que escolhem
 *  fornecedor — conta avulsa, recorrência e desembolso. A PP e o BV
 *  chegaram primeiro e montam o mesmo conjunto à mão, cada um com a sua
 *  altura; aqui o bloco virou um componente porque três cópias novas do
 *  mesmo comportamento divergiriam na primeira correção.
 *
 *  O que ele resolve, e que o `Combobox` sozinho não resolve:
 *
 *   * o fornecedor recém-criado ainda não está na lista que veio do
 *     servidor, e precisa aparecer escolhido na hora;
 *   * o lápis abre o cadastro COMPLETO, que a lista da tela não tem — ela
 *     traz só id, nome e documento, o suficiente para escolher.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { Combobox } from "@/components/ui/combobox";
import { cn, formatDocumento } from "@/lib/utils";
import type { Fornecedor } from "@/lib/types";
import { NovoFornecedorDialog, type ContextoCadastro } from "./novo-fornecedor-dialog";
import { carregarFornecedor, type FornecedorResumo } from "./actions";

/** O mínimo que a tela precisa carregar para alimentar o campo. */
export interface FornecedorDoCampo {
  id: string;
  nome: string;
  /** Segunda linha da opção e chave de busca. Opcional: tela que ainda
   *  não pede a coluna continua funcionando, só sem o documento. */
  cpf_cnpj?: string | null;
}

export function CampoFornecedor({
  id,
  value,
  onChange,
  fornecedores,
  contexto,
  disabled,
  placeholder = "Selecione o fornecedor",
  className,
  alturaBotao = "h-10 w-10 rounded-lg",
}: {
  id?: string;
  /** `null` = nenhum fornecedor escolhido. */
  value: string | null;
  onChange: (id: string | null) => void;
  fornecedores: ReadonlyArray<FornecedorDoCampo>;
  /** Só muda o texto do cabeçalho do dialog de cadastro. */
  contexto: ContextoCadastro;
  disabled?: boolean;
  placeholder?: string;
  /** Classes do gatilho do combo, para casar com a altura da tela. */
  className?: string;
  /** Classes do botão ao lado, idem. */
  alturaBotao?: string;
}) {
  const router = useRouter();
  const [novoFornecedorOpen, setNovoFornecedorOpen] = React.useState(false);
  const [fornecedorEditando, setFornecedorEditando] = React.useState<
    string | null
  >(null);
  const [nomeSugerido, setNomeSugerido] = React.useState("");
  const [fornecedorParaEditar, setFornecedorParaEditar] =
    React.useState<Fornecedor | null>(null);
  /** O recém-cadastrado, que ainda não está na lista do servidor. Fica
   *  aqui até a tela recarregar. */
  const [fornecedorNovo, setFornecedorNovo] =
    React.useState<FornecedorDoCampo | null>(null);

  const visiveis = React.useMemo(
    () =>
      fornecedorNovo && !fornecedores.some((f) => f.id === fornecedorNovo.id)
        ? [...fornecedores, fornecedorNovo].sort((x, y) =>
            x.nome.localeCompare(y.nome, "pt-BR"),
          )
        : fornecedores,
    [fornecedores, fornecedorNovo],
  );

  /** Nome em cima, documento embaixo — e a busca olha os dois. */
  const itens = React.useMemo(
    () =>
      visiveis.map((f) => ({
        value: f.id,
        label: f.nome,
        descricao: f.cpf_cnpj ? formatDocumento(f.cpf_cnpj) : undefined,
      })),
    [visiveis],
  );

  // Só abre a edição quando o cadastro completo chegou: dialog vazio
  // piscando é pior que meio segundo de espera.
  React.useEffect(() => {
    if (!fornecedorEditando) {
      setFornecedorParaEditar(null);
      return;
    }
    let vivo = true;
    carregarFornecedor(fornecedorEditando).then((res) => {
      if (!vivo) return;
      if (res.ok) setFornecedorParaEditar(res.fornecedor);
      else {
        setNovoFornecedorOpen(false);
        setFornecedorEditando(null);
      }
    });
    return () => {
      vivo = false;
    };
  }, [fornecedorEditando]);

  /** Escolher alguém que pode não estar na lista do servidor: o que
   *  acabou de ser criado, ou o que o cadastro achou pelo documento.
   *  Sem `router.refresh()` aqui — no meio do preenchimento ele
   *  re-renderiza a tela e zera o formulário (visto na PP em 04/09). */
  function adotar(f: FornecedorResumo) {
    setFornecedorNovo({ id: f.id, nome: f.nome, cpf_cnpj: f.cpf_cnpj ?? null });
    onChange(f.id);
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Combobox
            id={id}
            items={itens}
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            buscaPlaceholder="Escreva o nome ou o documento"
            limpavel={!disabled}
            disabled={disabled}
            className={className}
            acaoSemResultado={
              disabled
                ? undefined
                : {
                    rotulo: (busca) =>
                      `Cadastrar “${busca}” como novo fornecedor`,
                    onClick: (busca) => {
                      setNomeSugerido(busca);
                      setFornecedorEditando(null);
                      setNovoFornecedorOpen(true);
                    },
                  }
            }
          />
        </div>
        {/* "+" cadastra, lápis revisa o cadastro do escolhido. É o MESMO
            botão trocando de ícone — e o ✕ do campo é o que devolve o
            "+" depois de alguém ter sido escolhido. */}
        {!disabled && (
          <button
            type="button"
            onClick={() => {
              setNomeSugerido("");
              setFornecedorEditando(value);
              setNovoFornecedorOpen(true);
            }}
            title={
              value ? "Editar cadastro do fornecedor" : "Cadastrar fornecedor"
            }
            aria-label={
              value ? "Editar cadastro do fornecedor" : "Cadastrar fornecedor"
            }
            className={cn(
              "inline-flex flex-none items-center justify-center border border-border bg-white text-california-red transition-colors hover:border-california-red/40 hover:bg-california-red/[0.06] disabled:opacity-50",
              alturaBotao,
            )}
          >
            {value ? (
              <Pencil className="h-4 w-4" />
            ) : (
              <Plus className="h-[17px] w-[17px]" />
            )}
          </button>
        )}
      </div>

      <NovoFornecedorDialog
        open={
          novoFornecedorOpen &&
          (!fornecedorEditando || fornecedorParaEditar !== null)
        }
        onOpenChange={(aberto) => {
          setNovoFornecedorOpen(aberto);
          if (!aberto) {
            setFornecedorEditando(null);
            setNomeSugerido("");
          }
        }}
        fornecedor={fornecedorParaEditar ?? undefined}
        nomeInicial={nomeSugerido || undefined}
        contexto={contexto}
        onCriado={adotar}
        onSelecionarExistente={adotar}
        // A edição não mexe na escolha: o fornecedor continua o mesmo,
        // com o cadastro atualizado.
        onSalvo={() => {
          setFornecedorEditando(null);
          router.refresh();
        }}
      />
    </>
  );
}
