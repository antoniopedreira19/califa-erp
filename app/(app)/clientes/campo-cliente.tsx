"use client";

/** O campo de cliente inteiro: busca, o botão que cadastra ou edita, e o
 *  "+" da Marca ao lado.
 *
 *  Gêmeo do `CampoFornecedor` da PP (decisão 067), aplicado ao formulário
 *  de projeto em 17/09/2026 (decisão 089). O que ele resolve, e que o
 *  `Combobox` sozinho não resolve:
 *
 *   * o cliente recém-criado ainda não está na lista que veio do servidor,
 *     e precisa aparecer escolhido na hora — com a marca padrão junto, que
 *     o banco cria pelo `trg_clientes_marca_padrao`;
 *   * o lápis abre o cadastro COMPLETO, que a lista da tela não tem — ela
 *     traz só id, nome e código, o suficiente para escolher.
 */

import * as React from "react";
import { Pencil, Plus } from "lucide-react";
import { Combobox } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";
import type { Cliente, ClienteProduto, ClientePortal } from "@/lib/types";
import { NovoClienteDialog } from "./novo-cliente-dialog";
import { NovaMarcaDialog } from "./nova-marca-dialog";
import { carregarCliente } from "./actions";

/** O mínimo que a tela precisa carregar para alimentar o campo. */
export interface ClienteDoCampo {
  id: string;
  nome_fantasia: string;
  /** Entra na BUSCA, e não na lista: cliente com mais de um CNPJ tem mais
   *  de um código, e mostrar um deles na linha mentiria (decisão 089). */
  codigo_curto?: string | null;
}

/** A marca que o banco cria junto do cliente. O campo Marca do projeto lê
 *  daqui enquanto a tela não recarrega. */
export interface MarcaNova {
  id: string;
  nome: string;
  codigo: string;
  cliente_id: string;
}

export function CampoCliente({
  id,
  value,
  onChange,
  clientes,
  onCadastroMudou,
  disabled,
  podeCadastrar = true,
  podeEditar = true,
  placeholder = "Selecione um cliente ativo",
  className,
  alturaBotao = "h-10 w-10 rounded-lg",
  abrirMarcas,
  onAbrirMarcasResolvido,
  onMarcaCriada,
}: {
  id?: string;
  /** `null` = nenhum cliente escolhido. */
  value: string | null;
  onChange: (id: string | null) => void;
  clientes: ReadonlyArray<ClienteDoCampo>;
  /**
   * Chamado depois de criar E depois de salvar uma edição, com as marcas
   * ATIVAS do cliente lidas do banco. É o que deixa o campo Marca do
   * projeto funcionar sem recarregar a tela: o cliente novo já vem com a
   * PRD-01 que o trigger criou, e a marca acrescentada pelo "+" aparece
   * na hora.
   */
  onCadastroMudou?: (cliente: ClienteDoCampo, marcas: MarcaNova[]) => void;
  disabled?: boolean;
  /**
   * São DUAS permissões, como no campo de fornecedor da PP (18/09/2026):
   *
   *  * criar pelo dialog é `cadastros.clientes.inline` — Admin, GP e
   *    Produtor, porque quem cria orçamento precisa do cliente que ele
   *    pede. Vale para o "+" e para o atalho "Cadastrar «…»" da busca;
   *  * abrir o cadastro de um cliente que JÁ existe é
   *    `cadastros.clientes.editar`, só do administrador. É o lápis.
   *
   * A action barra dos dois lados de qualquer jeito. Aqui é para a pessoa
   * não preencher o cadastro inteiro e só então ler "Você não tem
   * permissão para essa ação".
   */
  podeCadastrar?: boolean;
  podeEditar?: boolean;
  placeholder?: string;
  className?: string;
  alturaBotao?: string;
  /** Ligado por fora pelo "+" do campo Marca: abre o dialog de UMA marca
   *  nova para o cliente escolhido (18/09/2026). Antes abria a ficha
   *  completa, que é do administrador — ver decisão 089 §6. */
  abrirMarcas?: boolean;
  onAbrirMarcasResolvido?: () => void;
  /** A marca recém-criada, para o campo Marca de fora escolhê-la. */
  onMarcaCriada?: (marca: { id: string; nome: string; codigo: string }) => void;
}) {
  const [dialogAberto, setDialogAberto] = React.useState(false);
  const [clienteEditando, setClienteEditando] = React.useState<string | null>(
    null,
  );
  const [nomeSugerido, setNomeSugerido] = React.useState("");
  /** O dialog de marca nova, que é outro — e bem menor — que o do
   *  cadastro do cliente. */
  const [marcaAberta, setMarcaAberta] = React.useState(false);
  const [marcasDoCliente, setMarcasDoCliente] = React.useState(0);
  const [cadastro, setCadastro] = React.useState<{
    cliente: Cliente;
    marcas: ClienteProduto[];
    portais: ClientePortal[];
  } | null>(null);
  /** O recém-cadastrado, que ainda não está na lista do servidor. */
  const [clienteNovo, setClienteNovo] = React.useState<ClienteDoCampo | null>(
    null,
  );

  const visiveis = React.useMemo(
    () =>
      clienteNovo && !clientes.some((c) => c.id === clienteNovo.id)
        ? [...clientes, clienteNovo].sort((x, y) =>
            x.nome_fantasia.localeCompare(y.nome_fantasia, "pt-BR"),
          )
        : clientes,
    [clientes, clienteNovo],
  );

  const itens = React.useMemo(
    () =>
      visiveis.map((c) => ({
        value: c.id,
        label: c.nome_fantasia,
        busca: c.codigo_curto ?? undefined,
      })),
    [visiveis],
  );

  // Só abre a edição quando o cadastro completo chegou: dialog vazio
  // piscando é pior que meio segundo de espera.
  React.useEffect(() => {
    if (!clienteEditando) {
      setCadastro(null);
      return;
    }
    let vivo = true;
    carregarCliente(clienteEditando).then((res) => {
      if (!vivo) return;
      if (res.ok) {
        setCadastro({
          cliente: res.cliente,
          marcas: res.marcas,
          portais: res.portais,
        });
      } else {
        setDialogAberto(false);
        setClienteEditando(null);
      }
    });
    return () => {
      vivo = false;
    };
  }, [clienteEditando]);

  /** O "+" do campo Marca, que vive fora daqui. Ele abre o dialog de UMA
   *  marca (18/09/2026): só INSERE, e por isso segue `podeCadastrar` — o
   *  GP monta o projeto e precisa da marca que o projeto pede.
   *
   *  Conta as marcas antes de abrir, INCLUSIVE as inativas, para o dialog
   *  dizer o código certo: `PRD-NN` é único por cliente e a numeração não
   *  reaproveita número de marca desativada. */
  React.useEffect(() => {
    if (!abrirMarcas || !value || !podeCadastrar) return;
    // Avisar que o pedido foi recebido desliga `abrirMarcas` lá fora, o
    // que re-roda ESTE efeito. Por isso ele não tem cleanup que cancele:
    // o cleanup do render anterior matava o carregamento que o próprio
    // efeito tinha acabado de começar, e o dialog nunca abria.
    onAbrirMarcasResolvido?.();
    carregarCliente(value).then((res) => {
      setMarcasDoCliente(res.ok ? res.marcas.length : 0);
      setMarcaAberta(true);
    });
  }, [abrirMarcas, value, podeCadastrar, onAbrirMarcasResolvido]);

  function abrirCadastro(nome: string) {
    setNomeSugerido(nome);
    setClienteEditando(null);
    setDialogAberto(true);
  }

  /** Relê o cadastro gravado e devolve as marcas ativas a quem usa o
   *  campo. Sem `router.refresh()`: ele zeraria o formulário de trás. */
  function avisarCadastro(item: ClienteDoCampo) {
    if (!onCadastroMudou) return;
    carregarCliente(item.id).then((res) => {
      onCadastroMudou(
        item,
        res.ok
          ? res.marcas
              .filter((m) => m.ativo)
              .map((m) => ({
                id: m.id,
                nome: m.nome,
                codigo: m.codigo,
                cliente_id: item.id,
              }))
          : [],
      );
    });
  }

  function abrirEdicao() {
    setNomeSugerido("");
    setClienteEditando(value);
    setDialogAberto(true);
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
            buscaPlaceholder="Escreva o nome ou o código do cliente"
            limpavel={!disabled}
            disabled={disabled}
            className={className}
            acaoSemResultado={
              disabled || !podeCadastrar
                ? undefined
                : {
                    rotulo: (busca) => `Cadastrar “${busca}” como cliente`,
                    onClick: abrirCadastro,
                  }
            }
          />
        </div>
        {/* "+" cadastra, lápis revisa o cadastro do escolhido. É o MESMO
            botão trocando de ícone — e o ✕ do campo é o que devolve o "+"
            depois de alguém ter sido escolhido. Como são permissões
            diferentes, o gate segue o PAPEL do botão, não o botão. */}
        {!disabled && (value ? podeEditar : podeCadastrar) && (
          <button
            type="button"
            onClick={() => (value ? abrirEdicao() : abrirCadastro(""))}
            title={value ? "Editar cadastro do cliente" : "Cadastrar cliente"}
            aria-label={
              value ? "Editar cadastro do cliente" : "Cadastrar cliente"
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

      <NovoClienteDialog
        open={dialogAberto && (!clienteEditando || cadastro !== null)}
        onOpenChange={(aberto) => {
          setDialogAberto(aberto);
          if (!aberto) {
            setClienteEditando(null);
            setNomeSugerido("");
          }
        }}
        cliente={cadastro?.cliente}
        marcas={cadastro?.marcas}
        portais={cadastro?.portais}
        nomeInicial={nomeSugerido || undefined}
        onCriado={(novo) => {
          const item: ClienteDoCampo = {
            id: novo.id,
            nome_fantasia: novo.nome_fantasia,
          };
          setClienteNovo(item);
          onChange(novo.id);
          setDialogAberto(false);
          setNomeSugerido("");
          avisarCadastro(item);
        }}
        // A edição não mexe na escolha: o cliente continua o mesmo, com o
        // cadastro atualizado. Sem `router.refresh()` — ele re-renderiza a
        // tela de trás e zera o formulário no meio do preenchimento.
        onSalvo={() => {
          const atual = visiveis.find((c) => c.id === clienteEditando);
          setDialogAberto(false);
          if (atual) avisarCadastro(atual);
          setClienteEditando(null);
        }}
      />

      {/* O "+" do campo Marca. Só existe com cliente escolhido, e só
          acrescenta — ver o cabeçalho de `nova-marca-dialog.tsx`. */}
      {value && (
        <NovaMarcaDialog
          open={marcaAberta}
          onOpenChange={setMarcaAberta}
          clienteId={value}
          clienteNome={
            visiveis.find((c) => c.id === value)?.nome_fantasia ?? "cliente"
          }
          marcasExistentes={marcasDoCliente}
          onCriada={(marca) => onMarcaCriada?.(marca)}
        />
      )}
    </>
  );
}
