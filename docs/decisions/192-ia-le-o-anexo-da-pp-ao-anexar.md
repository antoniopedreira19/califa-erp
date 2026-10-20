# 192 — A IA lê o PDF logo que ele é anexado à PP e pré-preenche tipo, número e os dados da NF

**Data:** 2026-10-19
**Status:** aceita e implementada (19/10/2026). A conferência com a IA de
verdade espera crédito na conta da OpenAI (ver "Como foi testado").
**Quem decidiu:** Tiago. A ideia é dele, de 16/10/2026, depois do caso das
PP-00197 e PP-00198 ([178](178-fatura-revisao-sem-nf-e-previa-da-pp.md)):
ler o anexo assim que ele sobe e já sugerir o tipo. Entre as opções A, B e
C escolheu a A: ler todo PDF e pré-preencher, com o selo "IA" e tudo
editável. Aprovou o protótipo com os componentes reais
(https://claude.ai/artifact/8T2ANj2uyJMSgHjBvD3NQg) em 17/10, depois de
confirmar que a cobrança é a mesma da leitura de NF.
**Revê:** a [153](153-pp-a-emitir.md), "Os anexos": o tipo do arquivo
deixa de nascer sempre vazio. Ele continua vazio até a leitura terminar e
continua vazio quando ela não acha o tipo. A leitura de NF por botão
(decisão 152) fica, para quando a leitura ao anexar não roda.
**Migration:** nenhuma. O cache é o mesmo `nf_extracao_cache`, com outra
versão no `modelo` (ver "Cache").

## O problema

O tipo do anexo nascia vazio de propósito (153): obrigava quem anexa a
olhar o documento. Mesmo assim, a produtora das PP-00197 e PP-00198 marcou
uma fatura como "Recibo", porque não achou opção melhor, e digitou o número
à mão. A leitura por IA já existia, mas só como botão, só com o tipo NF já
escolhido e só para os dados da nota. Quem anexava uma fatura, um recibo ou
um boleto preenchia tudo sozinho.

## A regra

1. **Todo PDF anexado à PP comum é lido assim que termina de subir**, em
   dois lugares:
   - no formulário da PP (Gerar PP e PP a emitir);
   - no envio ao financeiro.
2. **A leitura preenche só o que está vazio**:
   - o **tipo** (NF, Recibo, Fatura, Boleto, Contrato ou Outro);
   - o **número** do documento. Na NF ele vai para o número da nota;
   - **na NF**, também a **data de emissão** e o **valor**;
   - o **CNPJ da California contra o qual o documento foi emitido**, já
     casado com o cadastro, em todo tipo que tem esse campo (NF, recibo e
     fatura). O campo nasce com o CNPJ da PP, que é um palpite. O que o
     documento diz vale mais, desde que ninguém tenha trocado o campo à
     mão.

   O tipo escolhido antes de a leitura terminar fica, e o número digitado
   também. Nesse caso a leitura completa só o resto.
3. **Cada campo preenchido leva o selo "IA"** (âmbar, com a dica
   "Preenchido pela leitura automática. Confira."), até alguém mexer nele.
   Embaixo do nome do arquivo, uma linha diz o estado:
   - "lendo o documento…";
   - "lido pela IA";
   - "lido pela IA, com dúvida: confira", quando a IA marca o documento como
     borrado, cortado ou de tipo incerto;
   - "não deu para ler: escolha o tipo".
4. **Tudo continua editável.** Trocar o tipo entre NF e outro leva o número
   junto.
5. **Sem tipo lido, a leitura conta como falha**, e o tipo se escolhe à
   mão, como antes. Erro da IA, PDF ilegível, falta de chave ou de crédito
   na OpenAI dão o mesmo resultado. Escolhido o tipo à mão, a linha "não
   deu para ler" some.
6. **O servidor não muda.** A leitura só pré-preenche a tela. Nada é
   gravado até alguém salvar, gerar ou enviar, e as travas de antes
   continuam valendo:
   - a NF completa no envio (152);
   - o documento fiscal da PP paga por boleto (161 e 178);
   - o CNPJ do documento (156).
7. **Ficam de fora:**
   - **imagens** (JPG, PNG). A leitura é só de PDF, como a da NF;
   - **a verba de produção e o reembolso.** Os comprovantes deles têm
     tipos e campos próprios ([187](187-pp-de-reembolso.md),
     [189](189-prestacao-de-contas-da-verba-documento-a-documento.md)), e
     o reembolso de veículo próprio anexa fotos.
8. **O botão "Ler NF automaticamente" some** enquanto a leitura roda e
   depois que ela leu. Ele volta quando a leitura falha ou não rodou.

## Custo

A cobrança é a mesma da leitura de NF: mesma chave `OPENAI_API_KEY`, mesmo
modelo (`gpt-4.1-mini`), cobrança por token. Uma leitura usa perto de 2.700
tokens de entrada e 180 de saída, cerca de US$ 0,0014 (menos de R$ 0,01).
O mesmo arquivo lido de novo sai do cache, sem custo.

Em volume, entraram 32 PDFs nas PPs em setembro e 96 de 1 a 17/10. Isso dá
alguns reais por mês.

Cada leitura grava em `audit_events`:
- a ação `pp.anexo.lido_por_ia`;
- o tipo lido, os tokens e o `custo_usd_estimado`;
- em caso de falha, o erro.

A estimativa usava o preço do gpt-5-mini (US$ 0,25 e US$ 2,00 por milhão de
tokens), que ficou para trás na troca de modelo de 08/10. Passou a usar o
do gpt-4.1-mini (US$ 0,40 e US$ 1,60), numa função só (`custoEstimadoUsd`)
que também vale para a leitura de NF por botão
(`pp.anexo.nf_lida_por_ia`). Os eventos antigos ficam como foram gravados.

## Cache

`nf_extracao_cache` guarda a leitura por arquivo: tenant, hash SHA-256 e
`modelo`. Na leitura do anexo, o `modelo` é
`gpt-4.1-mini|documento-v1`, e não o da leitura de NF. A leitura de NF não
tem o tipo nem o número fora da nota, por isso uma não reaproveita a da
outra. Mudar o pedido feito à IA é mudar a versão (`documento-v2`), e o
cache antigo deixa de valer sozinho.

## Implementação

- `lib/ia/ler-nf.ts`:
  - `SCHEMA_DADOS_DOCUMENTO`: os campos da NF mais `tipo_documento` e
    `numero_documento`;
  - `lerDadosBrutosDoDocumento`;
  - `VERSAO_LEITURA_DOCUMENTO`.
- `lib/ia/openai-client.ts`: `custoEstimadoUsd`.
- `lib/ia/leitura-do-anexo.ts` (novo, puro): `aplicarLeitura` (a regra 2)
  e `semSelo`.
- `lib/types.ts`: `CampoLidoPelaIA`, `DadosLidosDoDocumento`.
- `lib/auth/audit.ts`: a ação `pp.anexo.lido_por_ia`.
- `app/(app)/jobs/[jobId]/realizado/`:
  - `actions-ler-nf.ts`: `lerDocumentoPorIA`, que confere o caminho e o
    tipo do arquivo, usa o cache, valida o que voltou e audita. Valida:
    - o número da NF pela mesma regra da leitura de NF;
    - a data e o valor só na NF;
    - o CNPJ pelo cadastro.
  - `anexos-da-pp.tsx`:
    - `useAnexosEmEdicao` ganha um terceiro argumento, os CNPJs para a
      leitura. Sem ele, não lê;
    - `SeloIA`;
    - a linha de estado na lista de anexos;
    - o selo nos campos de tipo, número, NF e CNPJ.
  - `gerar-pp-drawer.tsx` e `pp-a-emitir-ui.tsx` (envio): passam os CNPJs só
    na PP comum.
  - `conferencia-dos-documentos.tsx`: "lendo…" e o selo na tela lado a
    lado.

## Testes

- `lib/ia/leitura-do-anexo.test.ts` cobre a regra 2:
  - o que está vazio é preenchido;
  - o que já foi preenchido fica;
  - os campos da NF;
  - o CNPJ do documento;
  - o boleto, que não tem CNPJ;
  - a falha sem tipo;
  - a dúvida;
  - o selo que sai.
- `lib/ia/ler-nf.test.ts`:
  - o leitor do documento com um cliente falso, inclusive o tipo fora da
    lista;
  - o schema;
  - a versão do cache;
  - a conta do custo.

```bash
node --import tsx --test lib/ia/leitura-do-anexo.test.ts lib/ia/ler-nf.test.ts
```

## Como foi testado (19/10/2026)

- Testes acima: 21 de 21, com os da `cnpj-da-pp`. `lint` limpo.
- No sistema, no servidor do worktree, no TES-1014/26, item Passagem,
  formulário "Nova PP", sem salvar:
  - **PP comum**: o PDF subiu, passou por "lendo o documento…" e, sem
    chave da OpenAI no ambiente local, terminou em "não deu para ler:
    escolha o tipo", com o evento `pp.anexo.lido_por_ia` e o erro na
    auditoria. O tipo escolhido à mão funcionou: Fatura abriu o número e o
    "Contra qual CNPJ", e a linha voltou a "enviado".
  - **Reembolso**: o comprovante subiu como "enviado", sem leitura e sem
    evento.
  - **Verba**: o formulário não tem área de anexos.
  - Os anexos de teste foram tirados pela lixeira (saíram do bucket), e o
    formulário foi fechado sem salvar.
- **Não conferido: a leitura com a IA de verdade.** Desde 19/10/2026, 15h39,
  toda leitura que não sai do cache falha em produção com "429 You have no
  credits remaining": a conta da OpenAI ficou sem crédito. Foram 8 falhas
  da leitura de NF por botão no mesmo dia. Com crédito, a conferência é:
  anexar a fatura e a NFS-e fictícias do protótipo numa PP do TES-1014/26 e
  ver o selo "IA" no tipo, no número e no CNPJ (e, na NF, na data e no
  valor), o evento com tokens e custo e a linha no `nf_extracao_cache`.
