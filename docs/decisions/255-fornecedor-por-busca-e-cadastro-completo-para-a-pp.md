# 255 — Fornecedor por busca no servidor, e o cadastro completo para a PP sair

**Data:** 2026-11-12
**Status:** aceita e implementada em 12/11/2026.
**Quem decidiu:** Tiago, em 12/11/2026, depois da conferência da planilha "Base Fornecedores California" com o cadastro: "pode corrigir e depois cadastrar tudo"; conta ou PIX só quando a PP paga pelo cadastro (chave aleatória, boleto e guia não exigem).
**Amplia:** a trava do cadastro da [166](166-regime-e-cnae-do-fornecedor.md) (regime e CNAE). O cadastro rápido da [048](048-fornecedor-nasce-de-dentro-da-pp.md) e o "Sem conta nem PIX" da [161](161-pp-por-boleto-ou-chave-aleatoria.md) continuam.

## O problema

A planilha de pedidos de produção de 2026 tem 3.204 fornecedores com CPF ou CNPJ válido; o sistema tinha 238 deles. Cadastrar os que faltam leva o cadastro de cerca de 400 para mais de 3.300 fornecedores, e a planilha só traz nome, razão social e documento. Duas coisas quebravam com isso:

1. **A lista parava em 1.000.** O combo de fornecedor da PP, o do BV, o campo do financeiro e mais oito telas carregavam o cadastro inteiro na abertura da página. O PostgREST deste projeto devolve no máximo 1.000 linhas por consulta, sem erro: quem ficasse depois do milésimo em ordem alfabética sumiria da lista, inclusive fornecedores antigos. E o `docs/PERFORMANCE.md` já proibia carregar cadastro que cresce inteiro num select.
2. **A pessoa física não tinha trava.** A trava da 166 olhava só o regime e o CNAE, e só na pessoa jurídica. A PP de um fornecedor sem e-mail, sem telefone e sem conta saía; na pessoa física, a tela só avisava em cinza "O cadastro deste fornecedor não tem conta nem chave PIX".

## Decisão

1. **O combo busca no servidor enquanto se digita.** Ao abrir, mostra os 30 primeiros em ordem alfabética; digitando, os que têm o termo no nome, na razão social ou no documento (a partir de 3 dígitos, com ou sem pontuação), sem diferença de acento, os que começam pelo termo primeiro. Vale para o combo da PP, o do BV e o campo de fornecedor do financeiro (conta avulsa, recorrência e desembolso). A busca é a função `buscar_fornecedores` (SECURITY INVOKER: o RLS de `fornecedores` continua valendo).
2. **A tela do job não carrega mais o cadastro inteiro.** Vêm só os fornecedores que aparecem no job (PPs, PPs a emitir e BVs), que dão nome às linhas e abrem o combo. A leitura da NF pela IA, que casava o CNPJ do emissor com essa lista, procura no cadastro quando o emissor não está nela.
3. **As telas que precisam da lista inteira leem página a página** (`todasAsLinhas`, de 1.000 em 1.000): o mapa de fornecedores do Contas a Pagar, da Conciliação (títulos e remessa) e do Contas a Receber, as listas do orçamento e da visão agregada, e a página de Fornecedores, que agora traz só as colunas que mostra.
4. **Para a PP sair, o cadastro precisa de** (mesma mensagem e mesmo lápis da 166 — "Cadastro incompleto: falta …"):
   - **e-mail e telefone**, em qualquer PP, de pessoa física ou jurídica;
   - **conta bancária ou PIX**, só quando o pagamento escolhido é "Cadastro do fornecedor". Com chave aleatória, boleto ou guia a conta não é pedida. O cadastro marcado "Sem conta nem PIX" (161) segue como antes: nem deixa escolher o cadastro;
   - **regime tributário e CNAE**, como antes, só na pessoa jurídica.

   O formulário da PP mostra o que falta ao escolher o fornecedor e troca a lista quando o pagamento muda; o "Gerar PP" fica travado e o "Salvar" guarda a PP a emitir. No servidor, a geração da PP a emitir e a edição da PP gerada conferem o mesmo.
5. **O lápis abre o cadastro inteiro**, como na 166. No CNPJ sem regime e sem CNAE, a consulta da Receita roda sozinha e preenche regime, CNAE e endereço; e-mail, telefone e conta continuam com quem cadastra.

## Exemplos

- CNPJ da planilha (só nome e documento), pagando pelo cadastro: "falta o e-mail, o telefone, a conta ou o PIX, o regime tributário e o CNAE".
- O mesmo, pagando por boleto: "falta o e-mail, o telefone, o regime tributário e o CNAE".
- CPF da planilha, pagando pelo cadastro: "falta o e-mail, o telefone e a conta ou o PIX"; por boleto, "falta o e-mail e o telefone".

## Implementação

- Banco: `buscar_fornecedores(p_tenant_id, p_termo, p_limite)` (migration `20261112600001`), só para `authenticated`.
- `lib/data/fornecedores-busca.ts` e a action `buscarFornecedoresParaEscolha`; o hook `useBuscaDeFornecedores` junta o que a busca trouxe à lista da tela.
- `Combobox` ganhou `buscar`: com ele, a lista é a resposta do servidor, e `items` é só o que a tela já conhece (o escolhido, o recém-cadastrado).
- `lib/supabase/todas-as-linhas.ts`: a leitura página a página, ordenada por uma chave única no fim.
- `lib/cadastro-do-fornecedor-na-pp.ts`: a trava (`pendenciasDoCadastroNaPP`), usada pelo formulário da PP (`pendenciasDoCadastroDoFornecedor` devolve as duas listas, pagando pelo cadastro ou não), por `gerarPPDaPPAEmitir` e por `editarPPGerada`.
- Testes: `lib/cadastro-do-fornecedor-na-pp.test.ts` e `lib/supabase/todas-as-linhas.test.ts`.

## O que fica de fora

- A página de Fornecedores continua desenhando a lista inteira no navegador (agora com poucas colunas). Com mais de 3 mil linhas, uma lista paginada no servidor fica para depois, se pesar.
- A carga dos fornecedores da planilha é dado pessoal e não entra no repositório: é gravada pelo MCP, e aqui ficam só as contagens.

## Complemento (12/11/2026): Regime, CNAE e "Exportar Excel" na tela de Fornecedores

Pedido do Tiago, depois da consulta do regime e do CNAE em lote:

- **A lista ganhou as colunas "Regime tributário" e "CNAE"**, depois do documento e antes do Contato. O título "Documento" virou **"CNPJ"** (a pessoa física continua mostrando o CPF nessa coluna). O regime é o gravado no cadastro; o CNAE sai com o código e a atividade embaixo. As duas filtram e ordenam pelo título, como as outras. A atividade vem montada do servidor só para os CNAEs da lista: a tabela inteira do CNAE não vai ao navegador.
- **"Exportar Excel"**, ao lado de "Mostrar inativos", baixa os fornecedores **que a tela mostra** (busca, inativos e filtros dos títulos), na ordem dela, como o "Exportar Excel" da Visualizar Jobs. Cada linha leva **todos os campos do cadastro**, um por coluna: nome, razão social, tipo, CNPJ/CPF, status, regime (o gravado e o da consulta, com as datas), CNAE e atividade, declaração do Simples, e-mail, telefone, endereço, banco, agência, conta, PIX, "sem conta nem PIX", veículo de mídia, empresa de fora do grupo, observações e datas do cadastro. O arquivo se chama "Fornecedores - DD-MM-AAAA.xlsx", com "(filtrado)" quando algum filtro estava ligado.
- **Só Administrador e Financeiro exportam** (`cadastros.fornecedores.exportar`): o arquivo leva conta e PIX de todos de uma vez. GP e Produtor abrem a tela e veem as colunas, mas não o botão, e a rota recusa (403). Cada exportação grava `fornecedores.exportados` na auditoria, com a quantidade e se estava filtrada.
- Implementação: `POST /api/fornecedores/export` recebe os ids da tela e lê o cadastro inteiro de cada um; a planilha é montada por `lib/exportacao/planilha-de-fornecedores.ts` (teste em `planilha-de-fornecedores.test.ts`). Testado no Sandbox: filtrada (1 linha) e inteira com inativos (4), conferida com o banco; GP sem botão e com 403.
