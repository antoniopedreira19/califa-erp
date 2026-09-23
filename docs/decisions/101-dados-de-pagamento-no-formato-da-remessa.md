# 101 — Chave PIX e conta bancária só se gravam no formato da remessa

**Data:** 2026-09-23
**Decidido por:** Tiago
**Migrations:** `20260923180001_chave_pix_e_banco_no_formato_da_remessa.sql`,
`20260923180002_chave_pix_e_banco_check_sem_null.sql`

Complementa a [090](090-a-chave-pix-e-gravada-no-formato-do-banco.md) (a
chave grava no formato do banco) e o módulo
[pgto-remessa](../modulos/pgto-remessa/02-decisoes.md) (ADR 006).

---

## 1. O problema

A homologação do PIX com o Santander (convênio 004906997169, proposta
4557231) caiu três vezes por dado fora do formato, todas no segmento B
do PIX:

| Quando | O que o banco apontou | Nota do manual |
|---|---|---|
| 07/08 | CPF do favorecido **zerado** (posições 019–032) e a chave na Informação 12 | G035 |
| 01/09 | CPF encostado à esquerda com brancos (`86191099525   `) | G042: à direita, zeros à esquerda |
| 10/09 | Favorecido CNPJ 48.208.075/0001-99 com chave CPF 860.484.865-70: os dois campos divergiam | G035: na chave CPF/CNPJ, 019–032 **é** a chave |

Os três arquivos vinham do Publi. O arquivo do ERP (PE000014, 21/09) já
acertava os dois primeiros, mas repetiria o terceiro: gravava o
documento do cadastro em 019–032 e a chave em 128–226, sem comparar.

## 2. A regra

**Registro fora do modelo da remessa não se grava.** Vale para
fornecedor e colaborador, os dois destinatários da remessa.

Chave PIX, depois de normalizada (090):

| Tipo | Formato | Forma de iniciação (G032) |
|---|---|---|
| CPF | 11 dígitos, DV válido | 03 |
| CNPJ | 14 dígitos, DV válido | 03 |
| Telefone | `+55` + DDD sem zero + celular de 9 dígitos começando em 9 | 01 |
| E-mail | padrão do DICT, minúsculas, até 77 caracteres | 02 |
| Aleatória | EVP com hífens, minúsculas | 04 |

Telefone fixo deixou de passar (antes aceitava 10 dígitos): fixo não é
chave PIX. Nenhum cadastro existente caiu nessa régua; os 24
fornecedores e o colaborador foram conferidos antes.

Conta bancária: ou vazia, ou completa (banco, agência, conta, dígito da
conta e tipo). Dígito com letra grava em maiúscula (`X`) e sai no
arquivo como `0` (G003).

**A chave pode ser de outra pessoa** (decisão do Tiago): um fornecedor
CNPJ pode ter chave CPF. Na chave CPF/CNPJ, o arquivo leva a própria
chave em 019–032 e o tipo de inscrição dela, e não o documento do
cadastro. Nas outras chaves, 019–032 é o documento do cadastro.

## 3. Onde a regra mora

1. `problemaDaChavePix` em `lib/pix.ts`: a régua única, com a mensagem
   que o cadastro mostra.
2. Os schemas `fornecedorSchema` e `dadosBancariosColaboradorSchema`
   recusam na server action.
3. As CHECKs `fornecedores_pix_formato`, `fornecedores_banco_completo`,
   `colaboradores_pix_formato` e `colaboradores_banco_formato` barram
   qualquer outro caminho. As expressões são as mesmas de `PIX_FORMATO`.
   Se mudar lá, muda aqui.
4. `gerarRemessaCnab` confere a chave de novo antes de montar a linha. O
   título com chave torta vai para os rejeitados, com o motivo.

A 180002 existe porque a 180001 deixava passar tipo sem chave e conta
sem dígito: CHECK com `NULL` passa. Isso foi pego na conferência pelo
MCP logo depois de aplicar, e as expressões ganharam `coalesce(…, false)`.

## 4. O que mudou no arquivo

- Segmento B do PIX: 019–032 como na §2.
- Segmento A: posições 029 (DV da agência) e 043 (DV agência/conta) em
  branco, como no layout e no PE000013 aprovado. Antes o gerador repetia
  o DV da conta na 043.
- Header: data e hora de geração no relógio de Brasília. O servidor
  roda em UTC, e um arquivo gerado depois das 21h sairia com a data do
  dia seguinte.
- O tipo de inscrição (1 = CPF, 2 = CNPJ) sai do tamanho do documento.
  O campo `favorecidoEhCnpj` saiu dos tipos.

## 5. Achado no caminho: a aprovação da folha não gerava título

`aprovarLinhaFolha` inseria a conta avulsa sem rateio de regional, e o
banco recusa desde 15/09 ("Toda conta avulsa precisa de rateio de
regional"). Aprovar folha falhava sempre. Agora ela usa a RPC
`criar_conta_avulsa`, a mesma do lançamento avulso, com 100% na regional
da alocação do título.

## 6. Primeiro arquivo pelo fluxo real

`PE000016.TXT`, sequencial 16, 23/09/2026: folha 09/2026 do colaborador
de teste Antonio, R$ 0,05, chave CPF. Sequencial ≥ 11 é produção:
transmitido, paga de verdade.
