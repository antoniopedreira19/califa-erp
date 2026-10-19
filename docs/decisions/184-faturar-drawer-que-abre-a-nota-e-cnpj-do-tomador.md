# 184 — O Faturar redesenhado: drawer que abre a nota, "Faturar", job de referência e CNPJ do tomador

**Data:** 2026-10-16
**Status:** aceita e implementada (16/10/2026).
**Quem decidiu:** Tiago, em 16/10/2026, sobre o protótipo interativo
"Faturamento Avulso" (https://claude.ai/artifact/21vxXc3TWAMfZQ2kPQg3vr,
versão 5): pediu para reorganizar o formulário ("a ordem das informações
não está seguindo um fluxo lógico") com a empresa (gerencial) sempre vinda
do job; escolheu o modelo C refeito como drawer que abre a nota ao lado;
pediu "Faturar" no lugar de "Emitir NF"; tirou a competência como campo;
pediu o campo de CNPJ do tomador com a opção de tomador no exterior, também
no envio do GP; e "Quero que entregue exatamente igual a como está no
design".
**Revê:** a tela 3.3 (Faturar) e as decisões
[086](086-a-nota-avulsa-nasce-com-rateio-de-regional.md) (o rateio que se
escolhe fica só na avulsa "Sem job") e
[123](123-o-envio-para-faturamento-vira-notas-fiscais.md) (o CNPJ da nota
deixa de vir só do envio).
**Migrations:** `20261016700001_faturar_tomador_e_job_de_referencia.sql`,
`20261016700002_emitir_faturamento_tomador_e_job.sql`,
`20261016700003_envio_nota_cnpj_check_sem_nulo.sql`.

## 1. O formulário

A nota já foi emitida no portal da prefeitura; o Faturar a registra. Por
isso o botão é **"Faturar"** ("Faturando..." enquanto grava), e o rodapé diz
"Ao faturar, …".

**Drawer que abre a nota.** Sem anexo, é o drawer de sempre (700 px). A
área de arrastar o PDF fica **no fim da seção Nota fiscal**, depois dos
impostos ("Arraste o PDF da nota ou clique para anexar"). Anexado, o MESMO
conteúdo se alarga: a nota abre à esquerda (o PDF do próprio computador,
sem ida ao servidor para ver) e o formulário fica à direita, no mesmo lugar
— nada é remontado. O painel da nota tem "Trocar arquivo" e o botão de
ampliar (só a nota); tirar o anexo volta ao drawer. Sem anexo, clicar fora
fecha; com a nota aberta, fecha por Cancelar ou Esc.

**Seções, na ordem do fluxo** (numeradas): 1 Cliente e job (na de job,
"Jobs nesta NF") · 2 Valor e classificação (só a avulsa) · 3 Nota fiscal
(CNPJ emissor; Nº NF e Emissão; CNAE; Descrição; Impostos desta nota;
Anexo) · 4 Parcelas do recebimento. O aviso de erro fica no rodapé, junto
dos botões; faltando campos, ele diz "Falta preencher: …".

**Empresa (gerencial), regional e cliente vêm do job** e aparecem numa
faixa travada (cadeado, dica "Vem do job — não se escolhe aqui"). Na nota
de BV, a faixa diz "Fornecedor" e a empresa é a do job do BV.

**Nota avulsa.** "Referente a um job" (padrão) ou "Sem job":

- **Com job:** escolhe-se o job (código · nome; a lista mostra cliente,
  empresa, regional e "encerrado"); cliente, empresa e regional saem dele.
  A nota fica 100% na regional do job (o rateio continua sendo onde a
  regional da avulsa mora; a Apuração e o fluxo já leem dele). Não consome
  saldo de faturamento do job.
- **Sem job:** cliente, empresa (gerencial) e rateio de regional, como era.

**CNPJ do tomador**, nas duas notas (menos o BV, cuja contraparte é o
fornecedor): na de job nasce com o do envio ("Veio do envio de …"; se
trocado, aviso "Diferente do CNPJ do envio" e "Voltar ao do envio"); na
avulsa nasce com o do cadastro do cliente e, havendo mais de um já usado
(em nota ou envio), eles viram atalhos ("Já usados: …"). A caixa
**"Tomador no exterior, sem CNPJ"** tira o campo: cliente no exterior sai
para a subsidiária brasileira (é só outro CNPJ) ou sem CNPJ, com a nota
emitida no recebimento.

**Competência não é campo.** A da nota é o mês da emissão (é o que o fiscal
já usa); a gerencial vem do job.

**Impostos desta nota:** sai a frase "Retenções do cliente continuam na
baixa do título, como hoje." (comentário do Tiago no protótipo). A regra
não muda: as retenções seguem na baixa.

**A nota já emitida** ("NF X emitida", só leitura) continua como era; foi
para `nota-emitida-drawer.tsx`.

## 2. O envio do GP

Cada nota do envio ganha, debaixo do "CNPJ do cliente", a caixa **"Tomador
no exterior, sem CNPJ"**: marcada, o campo vira "Sem CNPJ" e a nota vai sem
CNPJ. O resumo e a confirmação mostram "Tomador no exterior, sem CNPJ", e
o "Ver envio" da página do job também. No Faturar, a caixa já vem marcada.

## 3. O que o banco passou a guardar e a conferir

- `faturamentos.tomador_exterior` (nota sem CNPJ do tomador) e
  `faturamentos.job_referencia_id` (só na avulsa; índice parcial).
- `jobs_envio_faturamento_notas.tomador_exterior`; o `cnpj` perde o NOT
  NULL e a regra vira: com a marca, sem CNPJ; sem a marca, 14 números (a
  700003 conserta a primeira versão da regra, que deixava passar CNPJ nulo
  sem a marca — achado na conferência, nenhuma linha ficou assim).
- `vw_faturamento_pendente` ganha `tomador_exterior` (coluna nova no fim).
- `enviar_job_para_faturamento` grava a marca da nota.
- `emitir_faturamento`:
  - grava o CNPJ do tomador **do formulário** (sem ele no payload — app
    antigo —, vale a regra da 123: o do envio, senão o do cadastro);
    "exterior" grava sem CNPJ; o CNPJ precisa ter 14 números;
  - **a nota de job e a de BV só saem na empresa (gerencial) do job**
    ("A nota de TES-1013/26 sai na empresa (gerencial) do job.") — até aqui
    o formulário deixava escolher qualquer empresa e a função gravava;
  - a avulsa com job de referência só sai na empresa, para o cliente e
    100% na regional do job;
  - a conferência "uma nota, um CNPJ" ignora a nota do envio sem CNPJ.

## 4. Conferência (16/10/2026)

No Chrome do Tiago, servidor do worktree, projeto TES-P001/26 (Empresa
Teste · Salvador): avulsa referente ao TES-1013/26 com tomador no exterior
(TESTE-184A, R$ 150); Faturar TES-1013/26 com o CNPJ trocado (TESTE-184B,
gravou o CNPJ do formulário); envio do TES-1007/26 com tomador no exterior
e o Faturar dele (TESTE-184C). As três notas foram canceladas pela action
de cancelamento (motivo "Teste do sistema (decisão 184)"); o envio do
TES-1007/26 ficou na fila do Faturamento, como dado de teste. As travas da
função foram exercidas em transação desfeita (empresa trocada, regional
fora do job, CNPJ curto). Também conferidos: nota de BV, "Sem job",
leitura da nota emitida, ampliar a nota e as saídas.

## 5. Fica para depois

- **Imposto da nota sem CNPJ (exportação de serviço) — decidido em
  19/10/2026: fica como está.** O Faturar calcula ISS, PIS e COFINS na nota
  com tomador no exterior como em qualquer nota, e eles entram na apuração.
  Tiago: "Ao realizar o recebimento nós emitimos a NF normalmente para
  justificar o recebimento, e nesses casos registramos o ISS que colocamos
  na NF ao emiti-la, geralmente no nosso município. É o que acontece hoje."
  A caixa "Exportação de serviço" (sem ISS, PIS e COFINS) foi descartada:
  os impostos são pagos.
- **Receita avulsa com job na rentabilidade do job:** a nota guarda o job,
  mas a rentabilidade (`vw_job_rentabilidade`, da frente do Antonio) não a
  lê. Decidir antes de ligar.
- **Conta da receita** (plano de contas, pendência registrada em 16/10):
  receita de Job × de Save, a de Job pelo tipo de serviço; o BV vira custo
  negativo.
- O diálogo de cancelar nota (`cancelar-faturamento-modal.tsx`) existe mas
  não tem botão em nenhuma tela; hoje o cancelamento de teste corre pela
  action.
