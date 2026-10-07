# 149 — O envio para abertura muda pelo tipo de job: Interno sem recebimento; Fee e Always On sem evento e com recebimento por mês

**Data:** 2026-10-06
**Quem decidiu:** Tiago — pedido de 06/10/2026 ("Jobs Internos (serviço) não precisam ter a data de recebimento preenchida… Jobs Fee e Always On não precisarão ter a data evento preenchida… e além disso precisam preencher as datas de recebimento de cada mês"), com o protótipo aprovado no mesmo dia (https://claude.ai/artifact/GV5xUFxDbRsfprTyF4BHk6, v2) e as quatro respostas abaixo.
**Continua:** [105](105-servico-interno-e-job-sem-faturamento.md) (o Interno sem faturamento) e [078](078-orcamento-mensal-fee-e-always-on.md) (o modelo mensal).

## O que mudou no formulário "Enviar job para abertura"

| Tipo de job | Data Evento | Data prevista para recebimento |
|---|---|---|
| Nacional e internacional (Ativação, Mídia On…) | Obrigatória, como antes | Uma data, obrigatória, como antes |
| Serviço **Interno** (nacional) | Obrigatória, como antes | Travada: "Sem recebimento — Serviço Interno não tem recebimento." |
| **Fee e Always On** (categoria de modelo `mensal`) | Travada: "Não se aplica — Fee/Always On não tem data de evento." | **Uma data por mês** do trimestre, obrigatória em todo mês com faturamento |
| **Interno · Always On** | Travada: "Não se aplica" | Travada: "Sem recebimento" |

- **Travado, e não removido** (resposta 1). O campo fica no lugar: a grade é a mesma em todo tipo de job, como Serviço e Categoria.
- **Recebimento por mês.** Rótulo "Datas previstas para recebimento" na linha inteira e cada mês numa coluna da grade (o trimestre tem de 1 a 3 meses), com o faturamento do mês ao lado do nome. Mês sem faturamento aparece travado, "Sem recebimento", e não pede data. O calendário de um mês vazio abre no mês seguinte ao de referência (prop nova e opcional `mesInicial` do `DatePicker`; os outros usos não mudam).
- **A sugestão** (resposta 2): só o **primeiro mês com faturamento** sugere. Ao escolher a data dele, os meses seguintes que estiverem **vazios** recebem o mesmo dia, deslocado pela distância entre os meses (outubro em 20/11 → novembro em 20/12 → dezembro em 20/01). Mês já preenchido nunca muda — nem quando o primeiro muda de novo —, e mexer num mês do meio não mexe em nenhum outro. Dia que o mês não tem vira o último dia dele (31/10 → 30/11). O mês sugerido diz "Sugerida pela data de outubro. Altere se precisar.". Regra em `lib/calculos/recebimento-por-mes.ts`, com testes.
- **A conferência** (o pop-up seguinte e o "Ver dados do job") mostra "Data evento: Não se aplica" e uma linha "Recebimento de outubro", "Recebimento de novembro"… no mensal.
- **A barra** do job enviado diz "Primeiro recebimento previsto para …" quando há mais de um mês.

## Quem é "Fee e Always On" (resposta 3)

A **categoria** do orçamento de modelo `mensal` (Fee e Always On), e não o nome do serviço. Isso inclui o Interno · Always On. Os 4 orçamentos com serviço Always On e categoria nacional (SEBRAE Nosso Canto: HITLAB, ANCINE MANIFESTO e ANCINE HEROS; Universal: Raízes do Futuro, cancelado) continuam com o formulário nacional — Data Evento e data única. A categoria deles é assunto à parte, que o Tiago vai tratar em seguida.

## O Interno

O Interno já tinha faturamento previsto zero (só F · Interno, decisão 105), e por isso a data já aparecia travada. Agora a regra olha também o **serviço** (`categorias_dominio.investimento_interno`): Interno não tem recebimento, qualquer que seja o número. O contato de cobrança segue opcional, como no job sem faturamento.

## Onde as datas por mês ficam, e o financeiro (resposta 4)

- **Coluna nova `jobs.recebimento_previsto_por_mes`** (jsonb, `{ "AAAA-MM-01": "AAAA-MM-DD" }`, nula fora do mensal). Migration `20261006700001_recebimento_previsto_por_mes.sql`, aditiva, sem backfill. Não é `jobs_previsao_recebimento`: aquela é a previsão do **financeiro**, gravada na abertura e lida pelo fluxo de caixa; escrever nela no envio poria no caixa um job que o financeiro ainda não abriu (decisão 113).
- **`jobs.data_prevista_faturamento`** continua existindo e, no mensal, recebe a data do **primeiro mês com faturamento** — é ela que listas, "faturamento próximo" e prazos leem.
- **`jobs.data_evento`** fica nula no Fee e no Always On.
- **Na abertura do financeiro**, as parcelas de recebimento do mensal nascem com as datas que a produção enviou, uma por mês (até aqui nasciam vazias, esperando o "Dia do recebimento"). O financeiro continua podendo mudar cada data e usar o "Dia do recebimento". Os resumos "Dados da produção" e o diálogo de conferência da fila mostram uma linha de recebimento por mês.

## O servidor (`enviarJobParaAbertura`)

- Lê o serviço do orçamento (`servico:categorias_dominio!servico_id(investimento_interno)`) e o modelo da categoria.
- **Data Evento**: obrigatória fora do mensal ("Data do evento é obrigatória."); no mensal, descartada.
- **Sem recebimento** = faturamento previsto zero **ou** serviço Interno: data vazia, contato opcional.
- **Mensal**: calcula o faturamento de cada mês — da versão (meses, grupos e itens) no envio, da cópia do job no reenvio do devolvido (`faturamentoPorMesDoFinanceiro`) — e exige uma data para cada mês com faturamento ("Informe a data prevista de recebimento de cada mês."). Data de mês sem faturamento ou de mês que não é da versão é descartada.
- Grava `recebimento_previsto_por_mes` no envio e no reenvio, e no audit.

## Fica de fora

- Os orçamentos de categoria incompatível com o serviço (item 3 acima) — próxima conversa.
- O calendário de jobs do financeiro marca o dia do evento na grade do mês: Fee e Always On enviados daqui em diante não têm essa marca (seguem contando como ativos entre início e fim).

## Testado no navegador, gravando no banco (TES-P001/26, 06–07/10/2026)

- **Always On** "Teste demonstração" (outubro R$ 16.701,88, novembro e dezembro R$ 13.918,23): Data Evento "Não se aplica"; o calendário de outubro abriu em novembro; 20/11 em outubro sugeriu 20/12 e 20/01/2027; dezembro mudado à mão para 15/01/2027. Enviado como TES-1022/26: `data_evento` nula, `data_prevista_faturamento` 20/11/2026, `recebimento_previsto_por_mes` com os três meses. A barra disse "Primeiro recebimento previsto para 20/11/2026"; o "Ver dados do job" mostrou os três recebimentos. No financeiro, a abertura trouxe as parcelas com 20/11, 20/12 e 15/01/2027, e "Dados da produção" e a conferência da fila mostraram os três meses. Depois, "Cancelar envio à abertura": o TES-1022/26 está cancelado e o orçamento voltou a Aprovado.
- **Interno** "Teste Interno 105 · nacional": "Sem recebimento — Serviço Interno não tem recebimento.", contato opcional, Data Evento obrigatória (nada enviado).
- **Ativação** "Orçamento de Teste": o formulário de sempre.
- **Trava do servidor** (action chamada sem o formulário): nacional sem Data Evento → recusado ("Data do evento é obrigatória."); mensal só com outubro → recusado ("Informe a data prevista de recebimento de cada mês."). Nenhum job criado.

## Status

- 2026-10-06: decidida e implementada.
