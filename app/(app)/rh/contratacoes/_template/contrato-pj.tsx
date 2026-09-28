/**
 * Template do contrato de prestação de serviços PJ da California.
 * Baseado no modelo 2025 (arquivo PDF fornecido pela Kika).
 *
 * Estrutura: 14 cláusulas + preâmbulo + área de assinatura + testemunhas.
 * Layout A4, margem 25mm, footer com endereço e numeração.
 */

import * as React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import type { DadosContratoPJ } from "@/lib/rh/gerar-contrato-pj";

const CALIFORNIA_ENDERECO =
  "RUA VALE CABRAL, 43, PITUBA - SALVADOR / BA · CEP 41810-020 · +55 71 3035.8675 · CONTATO@AGENCIACALIFORNIA.COM.BR";
const CALIFORNIA_RAZAO =
  "CALIFORNIA FILMES E PUBLICIDADE LTDA.";
const CALIFORNIA_CNPJ = "19.437.976/0001-54";
const CALIFORNIA_SEDE =
  "Av. da França 000393, #EDF HUB SALVADOR SET - COMÉRCIO - Salvador - CEP:40010-000 - BA";

const styles = StyleSheet.create({
  page: {
    paddingTop: 60,
    paddingBottom: 80,
    paddingHorizontal: 60,
    fontFamily: "Helvetica",
    fontSize: 10,
    lineHeight: 1.5,
    color: "#282828",
  },
  header: {
    marginBottom: 24,
    textAlign: "center",
  },
  logo: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#E74B56",
    marginBottom: 4,
  },
  titulo: {
    fontSize: 12,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 20,
    textDecoration: "underline",
  },
  paragrafo: {
    marginBottom: 10,
    textAlign: "justify",
  },
  clausulaTitulo: {
    fontSize: 11,
    fontWeight: "bold",
    marginTop: 12,
    marginBottom: 8,
  },
  subclausula: {
    marginBottom: 8,
    textAlign: "justify",
    paddingLeft: 12,
  },
  bold: {
    fontWeight: "bold",
  },
  destaque: {
    fontWeight: "bold",
  },
  assinaturas: {
    marginTop: 40,
  },
  linhaAssinatura: {
    marginTop: 30,
    borderTopWidth: 1,
    borderTopColor: "#282828",
    paddingTop: 4,
    textAlign: "center",
  },
  testemunhas: {
    marginTop: 30,
  },
  testemunhaLinha: {
    marginTop: 24,
    borderTopWidth: 1,
    borderTopColor: "#282828",
    paddingTop: 4,
    marginRight: 40,
  },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 60,
    right: 60,
    fontSize: 7,
    color: "#666",
    textAlign: "center",
    borderTopWidth: 1,
    borderTopColor: "#e5e5e5",
    paddingTop: 6,
  },
  pageNumber: {
    position: "absolute",
    bottom: 60,
    right: 60,
    fontSize: 8,
    color: "#666",
  },
});

function Header() {
  return (
    <View style={styles.header} fixed>
      <Text style={styles.logo}>CALIFORNIA</Text>
    </View>
  );
}

function Footer() {
  return (
    <>
      <Text
        style={styles.pageNumber}
        render={({ pageNumber, totalPages }) =>
          `Página ${pageNumber} de ${totalPages}`
        }
        fixed
      />
      <Text style={styles.footer} fixed>
        {CALIFORNIA_ENDERECO}
      </Text>
    </>
  );
}

export function ContratoPJDocument({ dados }: { dados: DadosContratoPJ }) {
  const hoje = new Date();
  const meses = [
    "janeiro",
    "fevereiro",
    "março",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
  ];
  const dataAssinatura = `Salvador – BA, ${hoje.getDate()} de ${meses[hoje.getMonth()]} de ${hoje.getFullYear()}.`;

  return (
    <Document
      title={`Contrato PJ — ${dados.nome}`}
      author="California Filmes"
    >
      <Page size="A4" style={styles.page}>
        <Header />

        <Text style={styles.titulo}>CONTRATO DE PRESTAÇÃO DE SERVIÇOS</Text>

        <Text style={styles.paragrafo}>
          <Text style={styles.bold}>{CALIFORNIA_RAZAO}</Text>, inscrita no
          CNPJ/MF sob o nº {CALIFORNIA_CNPJ}, com sede à {CALIFORNIA_SEDE},
          doravante denominada simplesmente <Text style={styles.bold}>CONTRATANTE</Text>;
        </Text>

        <Text style={styles.paragrafo}>
          <Text style={styles.bold}>{dados.nome.toUpperCase()}</Text>,
          brasileiro(a), portador(a) de RG nº {dados.rg}, inscrito(a) no CPF
          sob o nº {dados.cpf}, residente e domiciliado(a) na{" "}
          {dados.endereco}, neste ato como representante da{" "}
          <Text style={styles.bold}>{dados.razao_social}</Text>,{" "}
          {dados.natureza_pj_texto} {dados.cnpj}, doravante denominado(a){" "}
          <Text style={styles.bold}>CONTRATADO(A)</Text>;
        </Text>

        <Text style={styles.paragrafo}>
          <Text style={styles.bold}>CONTRATANTE</Text> e{" "}
          <Text style={styles.bold}>CONTRATADO(A)</Text>, adiante referidos
          como partes contratantes, reconhecem a validade e a eficácia deste
          Termo de Prestação de Serviços como sendo a expressão exata e
          convergente das suas vontades, obrigando-se reciprocamente ao
          cumprimento das condições nele assumidas, nos termos que se seguem:
        </Text>

        <Text style={styles.clausulaTitulo}>PREÂMBULO</Text>
        <Text style={styles.paragrafo}>
          <Text style={styles.bold}>Considerando que:</Text> a CONTRATANTE é
          constituída e exerce atividades empresariais relacionadas à
          publicidade, produção cinematográfica, vídeos e conteúdos
          audiovisuais, produção fotográfica e produção musical, além de atuar
          nos segmentos de produção de festas, eventos e espetáculos de dança,
          e desenvolve projetos especiais de comunicação, publicidade e
          propagando com terceiros contratantes.
        </Text>

        <Text style={styles.clausulaTitulo}>1. OBJETO</Text>
        <Text style={styles.subclausula}>
          1.1. O(A) CONTRATADO(A) compromete-se, por este instrumento
          particular, a executar os serviços relacionados de{" "}
          <Text style={styles.bold}>{dados.cargo}</Text>, por meio de seus
          prepostos ou empregados, com total autonomia e insubordinação,
          conforme o projeto tratado diretamente entre as partes.
        </Text>

        <Text style={styles.clausulaTitulo}>2. FUNÇÃO EXERCIDA</Text>
        <Text style={styles.subclausula}>
          2.1. O(A) CONTRATADO(A) prestará serviços como colaboradora
          autônoma, desempenhando tarefas em consonância com a sua atividade;
        </Text>
        <Text style={styles.subclausula}>
          2.2. O(A) CONTRATADO(A) compromete-se a desenvolver suas atribuições
          de forma autônoma, sempre priorizando a destreza no desempenho das
          atividades, bem como respeitando o regimento interno da CONTRATANTE,
          o qual, desde já, assume conhecer.
        </Text>
        <Text style={styles.subclausula}>
          2.3. Fica acordada a total inexistência de vínculo trabalhista entre
          as partes contratantes, excluindo as obrigações previdenciárias e
          encargos sociais, não havendo entre eles qualquer tipo de relação de
          subordinação.
        </Text>

        <Text style={styles.clausulaTitulo}>3. DO VALOR</Text>
        <Text style={styles.subclausula}>
          3.1. A CONTRATANTE pagará em favor do(a) CONTRATADO(A) o valor
          bruto mensal de{" "}
          <Text style={styles.bold}>{dados.salario_formatado}</Text> (
          {dados.salario_extenso}), pelas funções exercidas descritas na
          cláusula acima.
        </Text>
        <Text style={styles.subclausula}>
          3.2. A CONTRATANTE efetuará pagamento da remuneração mensalmente,
          mediante transferência bancária para conta de titularidade do(a)
          CONTRATADO(A), Banco: {dados.banco_codigo}, Ag.: {dados.agencia},
          CC: {dados.conta}.
        </Text>
        <Text style={styles.subclausula}>
          3.3. O(A) CONTRATADO(A) deverá emitir e apresentar à CONTRATANTE
          nota fiscal de serviços com uma antecedência mínima de 05 (cinco)
          dias úteis da data prevista na cláusula para pagamento.
        </Text>
        <Text style={styles.subclausula}>
          3.3.1. Na hipótese de atraso do(a) CONTRATADO(A) em emitir e
          apresentar a nota fiscal, a data determinada para efetivação do
          pagamento será prorrogada em número de dias igual ao do atraso, sem
          qualquer ônus para a CONTRATANTE.
        </Text>
        <Text style={styles.subclausula}>
          3.4. O comprovante de transferência bancária valerá como prova do
          pagamento.
        </Text>

        <Text style={styles.clausulaTitulo}>4. VIGÊNCIA DO TERMO</Text>
        <Text style={styles.subclausula}>
          4.1. O(A) CONTRATADO(A) exercerá suas atividades no prazo de 1 (um)
          ano ou até a finalização do projeto específico, com prazo inicial
          contado a partir da data de assinatura do instrumento contratual;
        </Text>
        <Text style={styles.subclausula}>
          4.2. O presente contrato poderá ser renovado de forma tácita, caso
          mantenham-se as condições ora acordadas, ou por meio de mero aditivo
          contratual formalizado entre as partes com as eventuais alterações
          pactuadas.
        </Text>
        <Text style={styles.subclausula}>
          4.3. As Partes confirmam que a relação contratual teve seu início em{" "}
          <Text style={styles.bold}>{dados.data_admissao_formatada}</Text>.
        </Text>
        <Text style={styles.subclausula}>
          4.4. As cláusulas do presente contrato, sobretudo aquelas que tratam
          acerca de direitos da personalidade, confidencialidade, propriedade
          intelectual e não concorrência, gozam de ultra-atividade, produzindo
          efeitos mesmo após o seu encerramento, seja por decurso de prazo,
          resilição, rescisão ou resolução.
        </Text>
        <Text style={styles.subclausula}>
          4.5. Por meio deste Contrato, de forma irrevogável e irretratável,
          outorga a mais ampla, geral, rasa e irrestrita quitação de contratos
          anteriormente firmados entre as Partes, de todos os atos praticados
          e de todas as obrigações decorrentes da relação existente entre as
          partes, sejam cíveis ou trabalhistas, para nada mais reclamar ou
          exigir, a qualquer tempo e a qualquer título, em juízo ou fora dele.
        </Text>

        <Text style={styles.clausulaTitulo}>5. OBRIGAÇÕES DA CONTRATANTE</Text>
        <Text style={styles.subclausula}>
          5.1. A CONTRATANTE compromete-se a efetuar pagamento da remuneração
          descrita na cláusula terceira;
        </Text>
        <Text style={styles.subclausula}>
          5.2. Fornecer ao(à) CONTRATADO(A) as orientações e os materiais
          indispensáveis ao exercício da contratação.
        </Text>

        <Text style={styles.clausulaTitulo}>6. OBRIGAÇÕES DO(A) CONTRATADO(A)</Text>
        <Text style={styles.subclausula}>
          6.1. Cumprir o estipulado nos termos do presente instrumento
          contratual;
        </Text>
        <Text style={styles.subclausula}>
          6.2. Observar as instruções da CONTRATANTE, acerca dos termos do
          serviço prestado;
        </Text>
        <Text style={styles.subclausula}>
          6.3. O(A) CONTRATADO(A) pode fazer substituir-se na execução das
          atividades do presente contrato, ficando de logo ajustado que a
          eventual substituição do referido profissional indicado, ficará
          sujeita à prévia concordância, por escrito, da CONTRATANTE;
        </Text>
        <Text style={styles.subclausula}>
          6.4. Responsabilizar-se por todos os tributos, encargos e
          contribuições municipais, estaduais e federais, decorrentes das
          suas atividades e da prestação dos serviços ora contratados;
        </Text>
        <Text style={styles.subclausula}>
          6.5. Prestar informações à CONTRATANTE, sempre que esta lhe
          solicitar, informando sobre a execução de seus serviços e demais
          detalhes solicitados;
        </Text>

        <Text style={styles.clausulaTitulo} break>
          7. PROPRIEDADE INTELECTUAL DECORRENTE DE CRIAÇÕES
        </Text>
        <Text style={styles.subclausula}>
          7.1. O(A) CONTRATADO(A) cede à CONTRATANTE, neste ato, todos os
          direitos de propriedade intelectual e de natureza patrimonial
          referentes às ideias e criações produzidas em decorrência deste
          contrato, assim como referentes aos estudos, resultados de análises
          e planos criados e/ou produzidos pelo(a) CONTRATADO(A), seus
          empregados, representantes, administradores, sócios e/ou
          subcontratados, na íntegra ou com modificações (&ldquo;criações&rdquo;),
          passando a CONTRATANTE a ser a única e exclusiva proprietária das
          criações e dos direitos de propriedade intelectual delas
          decorrentes, em caráter definitivo, irrevogável e irretratável, sem
          quaisquer ressalvas ou limitações de tempo ou lugar, e sem quaisquer
          ônus adicionais para a CONTRATANTE.
        </Text>
        <Text style={styles.subclausula}>
          7.2. O(A) CONTRATADO(A) compromete-se a observar com absoluto rigor
          o requisito legal da originalidade, sendo exclusiva e diretamente
          responsável por qualquer caracterização de plágio, contrafação ou,
          genericamente, violação de direito de autor ou dos que lhe são
          conexos de titularidade de terceiros;
        </Text>
        <Text style={styles.subclausula}>
          7.3. As criações poderão ser utilizadas, reproduzidas, incorporadas,
          copiadas, alteradas ou divulgadas em parte ou integralmente pela
          CONTRATANTE, ou por solicitação desta, a qualquer tempo, bem como
          as Criações poderão ser utilizadas pela CONTRATANTE como marca,
          sinal ou expressão de propaganda para identificação, promoção e
          divulgação de quaisquer produtos ou serviços, ao exclusivo critério
          da CONTRATANTE.
        </Text>
        <Text style={styles.subclausula}>
          7.4. O(A) CONTRATADO(A) deverá responder por eventuais ações ou
          reclamações promovidas por terceiros, relativamente às suas
          obrigações descritas nesta cláusula, eximindo a CONTRATANTE de
          qualquer responsabilidade.
        </Text>

        <Text style={styles.clausulaTitulo}>8. CONFIDENCIALIDADE E SIGILO</Text>
        <Text style={styles.subclausula}>
          8.1. Se, durante a vigência deste contrato, o(a) CONTRATADO(A) vier
          a tomar conhecimento e/ou receber informações concernentes a
          segredo comercial e ideias patenteáveis ou não, bem como quaisquer
          outras informações de natureza confidencial tituladas pela
          CONTRATANTE, o(a) CONTRATADO(A) obriga-se a mantê-las em absoluto
          sigilo, sendo-lhe vedada, durante a vigência deste termo e nos 05
          (cinco) anos imediatamente subsequentes à sua extinção, revelar
          essas informações a terceiros, em qualquer hipótese, a menos que
          expressamente autorizada pela CONTRATANTE.
        </Text>
        <Text style={styles.subclausula}>
          8.2. As partes declaram que manterão em sigilo todos os aspectos da
          contratação, estratégias e políticas da CONTRATANTE e do(a)
          CONTRATADO(A), de forma a preservar os interesses comuns ou não,
          independentemente da duração do contrato e ainda pelo prazo de 05
          (cinco) anos após o seu encerramento.
        </Text>
        <Text style={styles.subclausula}>
          8.3. As partes se obrigam, por si e por seus prepostos,
          colaboradores, consultores ou contratados, a manter a mais estrita
          confidencialidade a respeito das informações que vier a obter a
          respeito da outra e/ou de seus clientes em função deste Instrumento.
        </Text>

        <Text style={styles.clausulaTitulo}>
          9. NÃO ALICIAMENTO E CONCORRÊNCIA DESLEAL
        </Text>
        <Text style={styles.subclausula}>
          9.1. O(A) CONTRATADO(A) se compromete, durante e após a relação
          contratual com a CONTRATANTE, não recrutar ou solicitar a
          contratação (onerosa ou não onerosa) de colaboradores vinculados à
          empresa, bem como ex-colaboradores que estejam no período de
          quarentena de 12 (doze) meses após o encerramento da relação, sem a
          expressa comunicação e autorização da CONTRATANTE, sob pena de
          multa no valor de R$ 10.000,00 (dez mil reais).
        </Text>
        <Text style={styles.subclausula}>
          9.1.1. Ao ser identificado ato que gere a incidência de aliciamento
          e/ou concorrência desleal, deverá o(a) CONTRATADO(A) cessar de
          imediato, sob pena da aplicação de multa diária no valor de R$
          1.000,00 (mil reais).
        </Text>
        <Text style={styles.subclausula}>
          9.1.2. Sendo comprovado o descumprimento deste Contrato, o(a)
          CONTRATADO(A) também poderá ser punido pelo crime de concorrência
          desleal, punido de acordo com o disposto no artigo 196 do Código
          Penal, com pena de detenção, sem prejuízo de indenização por perdas
          e danos causados.
        </Text>

        <Text style={styles.clausulaTitulo}>10. AUTORIZAÇÃO DO USO DE IMAGEM</Text>
        <Text style={styles.subclausula}>
          10.1. Através deste instrumento e em conformidade com a Lei 9.610
          de 19/02/1998 e com o art. 5º incisos X e XXVIII da Constituição
          Federal, o(a) CONTRATADO(A) cede e autoriza de forma gratuita, em
          qualquer tempo, enquanto entender útil e/ou necessário, a
          CONTRATANTE a utilizar sua imagem e voz, juntos ou separados, em
          todo o território nacional ou internacional, a título gratuito,
          abrangendo inclusive a licença a terceiros, para toda e qualquer
          finalidade, por prazo indeterminado.
        </Text>

        <Text style={styles.clausulaTitulo}>11. RESOLUÇÃO DE CONFLITOS</Text>
        <Text style={styles.subclausula}>
          11.1. As partes contratantes se comprometem a buscar soluções para
          qualquer conflito relacionado a este Termo, de forma amigável, no
          prazo máximo de 30 (trinta) dias, contados do recebimento de
          Notificação sobre a ocorrência do evento que gerou o conflito.
        </Text>

        <Text style={styles.clausulaTitulo}>12. RESCISÃO ANTECIPADA</Text>
        <Text style={styles.subclausula}>
          12.1. O presente Instrumento poderá ser rescindido a qualquer
          tempo, mediante notificação formal da parte contrária, desde que a
          Parte que deseje a resilição esteja adimplente com suas obrigações
          contratuais.
        </Text>

        <Text style={styles.clausulaTitulo}>13. PROTEÇÃO DE DADOS</Text>
        <Text style={styles.subclausula}>
          13.1 As Partes obrigam-se a atuar no presente Contrato em
          conformidade com a legislação vigente sobre proteção de dados,
          especialmente a Lei n.º 13.709/2018 (LGPD).
        </Text>
        <Text style={styles.subclausula}>
          13.2 As Partes tratarão os Dados Pessoais de forma confidencial e
          com o mesmo nível de segurança que tratam seus dados de caráter
          confidencial.
        </Text>

        <Text style={styles.clausulaTitulo}>14. FORO</Text>
        <Text style={styles.subclausula}>
          14.1. As partes elegem o foro Salvador - BA, para dirimir
          controvérsias concernentes ao presente Termo, em detrimento de
          qualquer outro, por mais privilegiado que seja.
        </Text>

        <Text style={styles.paragrafo}>
          Para todos os fins legais e probatórios, as Partes concordam e
          convencionam que a celebração deste Instrumento ocorrerá de forma
          digital, nos termos e para os fins da Medida Provisória 2.200, de
          24 de agosto de 2001, mediante a utilização de certificado digital.
        </Text>

        <Text style={{ ...styles.paragrafo, textAlign: "center", marginTop: 20 }}>
          {dataAssinatura}
        </Text>

        <View style={styles.assinaturas}>
          <View style={styles.linhaAssinatura}>
            <Text style={styles.bold}>{CALIFORNIA_RAZAO}</Text>
          </View>
          <View style={{ ...styles.linhaAssinatura, marginTop: 40 }}>
            <Text style={styles.bold}>{dados.razao_social}</Text>
            <Text>CONTRATADO</Text>
          </View>
        </View>

        <View style={styles.testemunhas}>
          <Text style={styles.bold}>Testemunhas:</Text>
          <View style={styles.testemunhaLinha}>
            <Text>Nome:</Text>
            <Text>CPF:</Text>
          </View>
          <View style={styles.testemunhaLinha}>
            <Text>Nome:</Text>
            <Text>CPF:</Text>
          </View>
        </View>

        <Footer />
      </Page>
    </Document>
  );
}
