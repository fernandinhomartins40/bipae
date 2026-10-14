# Changelog

## [MF-09 Confere no Bipaê] — 14/10/2026

### Adicionado
- **Compras → Notas de entrada (Confere):** aceite dos termos, certificado A1 (enviado direto ao MercadoFlow; o Bipaê não guarda o arquivo nem a senha) com aviso de vencimento, saldo de leituras e compra por Pix, ler a nota pela chave bipando o DANFE, importar o XML e buscar as notas na SEFAZ.
- **Conferência pela tela:** cega ou aberta, bipando o produto ou a caixa (a caixa soma 1; a unidade avisa quando a nota está em caixa), divergências por item (avaria, validade, produto trocado), salva a cada item e resumo antes de concluir, com os itens que subiram mais de 5%.
- **Entrada no estoque** já em unidades e com o custo da nota: o produto é achado pelo código de barras, pelo código da caixa ou pelo código do fornecedor (aprendido na primeira vez). Produtos que a loja ainda não tem são associados na hora. A mesma conferência nunca entra duas vezes; a conferência refeita lança só a diferença. Conferência concluída em outro aparelho entra sozinha pelo aviso do MercadoFlow.
- **Pendências com fornecedor:** faltas, sobras, avarias, validade e produto trocado, para cobrar crédito ou devolução.

### Pendente
- MF-14: aviso de nota recebida com contador no menu.

## [MF-07 Cadastro rápido no caixa] — 14/10/2026

### Adicionado
- **Código desconhecido no caixa:** quem tem permissão de cadastrar produtos e está com internet vê o cadastro rápido, com o nome já preenchido pelo catálogo (consulta de no máximo 1,5 s). Informa o preço, salva e o produto entra direto na venda.
- Sem permissão, sem internet ou sem resposta do catálogo, o caixa segue como antes (avisa que o código não foi encontrado). O caixa nunca espera o catálogo.

## [MF-05 MercadoFlow na VPS] — 14/10/2026

### Adicionado
- A API do Bipaê passa a estar também na rede do MercadoFlow na VPS (nome `bipae-api`), sem porta nova no host, com as variáveis `MERCADOFLOW_*` vazias: a integração continua desligada até as credenciais irem para o `.env`.
- Comandos `mercadoflow-status` e `mercadoflow-webhook` na `admin-cli`, e o passo a passo para ligar em `docs/deploy.md`.

### Pendente
- E19: credenciais do parceiro Bipaê no MercadoFlow.

## [MF-04 Contas MercadoFlow e desconto] — 14/10/2026

### Adicionado
- **Tela "MercadoFlow"** (menu, para quem gerencia empresas e lojas): por loja, "Criar minha conta MercadoFlow" ou "Já tenho conta MercadoFlow", a situação do vínculo, as permissões, o desconto de cliente Bipaê, a fila de envio e os erros.
- **Criar a conta** usa o CNPJ e o nome da empresa e o nome e o e-mail do dono, com o aceite obrigatório. O Bipaê nunca define nem vê a senha: o MercadoFlow manda o link por e-mail. Se o CNPJ já tem conta, a tela segue direto para o vínculo.
- **Vincular conta existente:** o link abre no navegador (no desktop, aparece para copiar). O vínculo fica ativo pelo aviso do MercadoFlow ou pela consulta a cada 30 segundos; expirado ou recusado aparece com o motivo.
- **Cliente ativo e desconto:** o Bipaê avisa o MercadoFlow quando a assinatura muda (troca de plano, suspensão, reativação) e uma vez por dia.
- Criar a conta e iniciar o vínculo ficam na auditoria.

### Pendente
- MF-13: o desktop abrir o link no navegador do sistema.

## [MF-03 Catálogo em lote e devolução ao catálogo] — 14/10/2026

### Adicionado
- **Compra pelo XML com o catálogo:** os itens sem produto associado são consultados no catálogo em lote. A tela mostra "No catálogo" com o nome padronizado, e o produto novo já nasce com esse nome (editável), a marca, o fabricante e o código da caixa.
- **Os produtos cadastrados ajudam a melhorar o catálogo:** produto criado ou alterado com código de barras válido vai para a fila e é enviado em lotes a cada 5 minutos, só com dados cadastrais (nunca preço nem custo). Mudar só o preço não gera envio, e item recusado pelo catálogo não é reenviado.

## [MF-02 Catálogo no cadastro de produto] — 14/10/2026

### Adicionado
- **"Buscar no catálogo" no cadastro de produto:** bipar o código de barras ou digitar o nome traz nome, marca, fabricante, departamento, unidade, conteúdo, NCM e CEST sugeridos e os códigos de caixa. O usuário confere, informa o preço e salva: nada é cadastrado sozinho.
- **NCM e CEST do catálogo só são sugeridos quando existem na tabela oficial vigente.**
- O produto passa a guardar os dados de catálogo e as embalagens de compra (caixa ou fardo com a quantidade).
- Cache do catálogo (30 dias para achado, 1 dia para não achado, 10 minutos para busca por nome), consulta em lote de até 200 códigos e modo rápido de 1,5 s para o caixa.
- Vale para toda loja, com ou sem conta no MercadoFlow. Com a integração desligada ou o MercadoFlow fora do ar, o cadastro segue manual.

### Pendente
- Imagens do catálogo (MF-06) dependem de onde guardar arquivos (item E12).

## [MF-01 Base da integração MercadoFlow] — 13/10/2026

### Adicionado
- **Base da integração com o MercadoFlow** (ADR-0015), desligada enquanto as credenciais não forem configuradas: sem elas, nada muda no Bipaê.
- Cliente da API de parceiro com token em memória (renovado antes de vencer), nova tentativa com espera crescente e tempo limite por chamada.
- **Fila de envio em tabela (outbox):** o caixa nunca espera o MercadoFlow; com ele fora do ar, o envio fica guardado e é repetido depois. Recusa por dado errado não entra em laço.
- **Webhook** com assinatura conferida (HMAC do corpo) e entrega repetida ignorada. Já trata o vínculo aprovado e o vínculo encerrado.
- Tabelas do vínculo por loja, das embalagens de compra (caixa e fardo) e do cache do catálogo.

## [F3-25 Alíquotas por produto] — 13/10/2026

### Adicionado
- **Alíquotas de ICMS por mercadoria das 27 UFs**, importadas do Portal Nacional da DIFAL (860 linhas), com NCM quando o portal informa, FCP, base legal e a data de cada linha.
- **Marcação de defasado:** quando a alíquota geral do portal não bate com a lei vigente da UF, as linhas antigas daquela UF aparecem como "Defasada". Hoje isso acontece em 11 UFs.
- Na tela **Regras de ICMS**, a referência do portal para a UF da empresa, com busca. Serve de ponto de partida para o contador: só vira regra o que a empresa cadastrar.

## [F3-21.a Certificado no aparelho] — 13/10/2026

### Adicionado
- **Certificado A1 instalado no próprio aparelho** (navegador e desktop), em Periféricos: base para emitir a nota mesmo sem internet (contingência, F3-15).
- A chave privada fica guardada como **não exportável**: nem o Bipaê consegue lê-la de volta, só usá-la para assinar. O arquivo .pfx e a senha não ficam salvos. Certificado vencido não é instalado e para de assinar quando vence.
- A assinatura da nota aceita um assinador externo (o certificado do aparelho e, depois, o token A3) e gera exatamente a mesma assinatura.

### Pendente
- A3 por token ou cartão (F3-21.b) depende de um token de teste (item E18).

## [F3-19 Compras pelo XML] — 13/10/2026

### Adicionado
- **Tela "Compras":** importe o XML da nota do fornecedor e veja, antes de gravar, o fornecedor (novo ou já cadastrado), cada item e o produto da loja associado a ele.
- Na confirmação, o Bipaê **cadastra o fornecedor e os produtos que faltam, dá entrada no estoque e atualiza o custo**. Uma caixa com 12 unidades pode entrar como 12 unidades (fator de conversão).
- Associação automática: pelo código de barras e, a partir da segunda compra, pelo código do produto no fornecedor (com o mesmo fator).
- **Segurança:** a assinatura digital da nota é conferida (XML alterado é recusado), a nota precisa ser para uma empresa sua e cada nota entra uma vez só. Avisos para nota sem protocolo da SEFAZ, de homologação ou com certificado fora da ICP-Brasil. A entrada vai para a auditoria.
- Os tributos de cada item ficam guardados com a nota, para a apuração do IBS/CBS (F4-13).
- Dúvida D-024: custo com ou sem os créditos de impostos.

## [F3-11.a Conversa com a SEFAZ] — 13/10/2026

### Adicionado
- **Cliente dos webservices da SEFAZ (homologação):** status do serviço, envio de notas assinadas (síncrono com uma nota), consulta do recibo e consulta pela chave, para NF-e e NFC-e, nas 27 UFs, com os endereços oficiais.
- Mensagens conferidas contra os schemas oficiais dos serviços (pacote 9q do Portal da NF-e). O XML autorizado (nfeProc, nota mais protocolo) passa no schema `procNFe`.
- **Conexão segura:** HTTPS com o certificado A1 da empresa (autenticação mútua) e a cadeia oficial da ICP-Brasil (arquivo do ITI, guardado com hash). Um teste prova que servidor com certificado desconhecido é recusado.
- Retornos explicados em português: SEFAZ fora do ar, falha SOAP com o motivo, resposta sem mensagem.
- Botão **"Testar conexão com a SEFAZ"** na empresa com certificado: mostra o código e a mensagem que a SEFAZ devolveu.
- O leitor de XML passou para o motor fiscal (`@bipae/fiscal`), usado pelo DANFE e pelos retornos da SEFAZ.

### Pendente
- A primeira conversa com a SEFAZ real depende do certificado de homologação (item E1): tarefa F3-11.b.

## [F3-13.c DANFE da NF-e] — 13/10/2026

### Adicionado
- **DANFE da NF-e em PDF (A4 retrato)**, no novo pacote `@bipae/danfe`, gerado sempre a partir do XML da nota, como manda o manual: canhoto, emitente, quadro "DANFE", código de barras CODE-128C da chave, protocolo, destinatário, fatura, cálculo do imposto, transportador, produtos e dados adicionais, nas posições do Anexo II do MOC 7.0.
- **Já no leiaute da NT 2026.010** (produção em 01/12/2026): código do regime tributário no emitente, quadro "Total do IBS/CBS/IS" e, em cada item, cClassTrib, base, alíquotas (a efetiva quando há redução) e valores do IBS e da CBS.
- Nota grande continua em folhas adicionais com o cabeçalho completo e "FOLHA n/total"; informações complementares longas continuam na folha seguinte. Homologação sai com "SEM VALOR FISCAL"; nota sem protocolo só como prévia marcada.
- Dúvida D-023: simbologia do código de barras quando a chave tiver letras (CNPJ alfanumérico).

## [F3-08.b Endereços da NF-e] — 13/10/2026

### Adicionado
- **Endereços oficiais da NF-e das 27 UFs**, em produção e homologação: quem autoriza (10 UFs com ambiente próprio, MA pela SEFAZ Virtual do Ambiente Nacional, as demais pela SEFAZ Virtual do RS), quem atende em contingência (SVC-AN ou SVC-RS) e os serviços de cada um, mais os do Ambiente Nacional.
- Extraídos da "Relação de Serviços Web" do Portal Nacional da NF-e, guardada com data e hash. Um teste confere que cada endereço aparece na página oficial do seu ambiente e que homologação nunca aponta para produção.
- A página oficial mostra o PI em contingências diferentes (SVC-AN em produção, SVC-RS em homologação): o Bipaê segue a página de cada ambiente.

## [F3-08.a XML da NF-e] — 13/10/2026

### Adicionado
- **XML da NF-e (modelo 55)**, validado contra o schema oficial: destinatário com endereço e indicador da inscrição estadual, natureza da operação, finalidade (normal, complementar, ajuste, devolução com a nota referenciada), presença do comprador, transporte com transportadora e volumes, fatura e duplicatas, pedido do cliente no item, informações ao fisco e ao contribuinte.
- **IPI na nota** (tributado e não tributado), com o código de enquadramento vindo da regra.
- **ICMS com substituição tributária, redução e diferimento** na NF-e e na NFC-e: CST 10, 51 e 70, CSOSN 201 e 202, FCP com base. O total da nota soma ST, IPI, frete, seguro e outras despesas, pela fórmula do manual.
- Conferências antes da SEFAZ, com mensagem clara: CFOP de entrada em nota de saída, CFOP interno para destinatário de outro estado, inscrição estadual faltando, parcelas que não fecham com a fatura, "sem pagamento" com valor.

### Pendente
- Venda interestadual para consumidor final não contribuinte (partilha do ICMS, DIFAL) avisa que ainda não é emitida: tarefa F3-32.

## [F3-13.b DANFE da NFC-e] — 13/10/2026

### Adicionado
- **DANFE da NFC-e em 80 mm** com as nove divisões do manual oficial (versão 5.1): cabeçalho, itens, totais e pagamentos, consulta pela chave em 11 blocos, consumidor (CPF, CNPJ, estrangeiro ou "não identificado"), número, série e protocolo no horário local, avisos de homologação e de contingência (duas vezes, sem protocolo, com a via do estabelecimento), mensagens e a carga tributária da Lei 12.741. Também na versão resumida, sem itens.
- **QR Code na impressora térmica** pelos comandos próprios dela, com pelo menos 22 mm de conteúdo, como pede o manual. Na tela e na impressão pelo navegador, o QR Code sai em SVG; um teste lê o código de volta, como a câmera do celular.
- A impressão pelo navegador aceita cupom em HTML (necessário para o QR Code).

## [F3-13.a QR Code da NFC-e] — 13/10/2026

### Adicionado
- **QR Code versão 3 da NFC-e** (NT 2025.001): na emissão normal leva só a chave, a versão e o ambiente, com a URL oficial da UF. **Não precisa mais de CSC.**
- O XML da NFC-e passa a trazer o grupo `infNFeSupl` (QR Code e URL de consulta pela chave), validado contra o schema oficial.
- O item externo E1 deixou de pedir o CSC: só o certificado A1 de homologação continua necessário.

## [F3-28 Endereços da NFC-e das 27 UFs] — 13/10/2026

### Adicionado
- **Endereços oficiais da NFC-e de cada UF:** quem autoriza (8 UFs com ambiente próprio, as demais pela SEFAZ Virtual do RS), os seis webservices de homologação e produção, a URL do QR Code e a de consulta pela chave.
- **Extraídos das páginas oficiais** da SEFAZ Virtual do RS e do Portal Nacional da NFC-e (ENCAT), guardadas com data e hash. Quando a página lista o endereço antigo e o novo, vale o vigente.
- Um teste confere que **cada endereço aparece literalmente na página oficial**: nenhum foi digitado ou inventado.
- Dúvida D-022: a SVRS e o ENCAT divergem sobre o autorizador da NFC-e em MG.

## [F3-12 Numeração da NFC-e] — 13/10/2026

### Adicionado
- **Numeração da NFC-e:** a série é a do caixa (única na empresa) e o número da nota é o número da venda no caixa, para dois caixas nunca repetirem número, mesmo sem internet. Os buracos (devolução, venda que não virou nota) serão inutilizados na F3-17.

### Corrigido
- **Aparelho novo ligado a um caixa que já vendeu recomeçava a numeração em 1.** As vendas novas colidiam com números já gravados no servidor. Agora o servidor informa o último número recebido e o aparelho continua dali (nunca volta para trás).

## [F3-10 Certificado digital A1] — 13/10/2026

### Adicionado
- **Envio do certificado A1 da empresa** no cartão da empresa (Empresas e lojas): escolhe o arquivo .pfx, digita a senha e pronto.
- O servidor confere o certificado e explica o problema: senha errada, arquivo que não é certificado, certificado vencido ou ainda não válido, CNPJ de outra empresa (filial da mesma raiz pode usar o da matriz).
- **Arquivo e senha guardados cifrados** (AES-256-GCM); a API nunca devolve nenhum dos dois, e a trilha de auditoria registra só o titular e a validade. A equipe Bipaê (painel da plataforma) não tem acesso à tabela.
- **Aviso de vencimento:** faltando 30 dias ou menos, o cartão da empresa avisa em destaque; vencido, pede o novo.
- O servidor já usa o certificado para assinar notas, e o teste confere a assinatura com o certificado guardado.

### Banco de dados
- Migração `0010`: tabela de certificados por empresa, com isolamento por cliente (RLS).

## [F3-09 Assinatura da nota] — 13/10/2026

### Adicionado
- **Assinatura XML da NF-e/NFC-e** no padrão da SEFAZ (XMLDSig envelopado, C14N, SHA-1 e RSA-SHA1, com o certificado no KeyInfo), usando só a criptografia padrão: a mesma função serve o servidor e o caixa desktop.
- **Conferida de duas formas nos testes:** por uma biblioteca independente (xml-crypto), que refaz a canonicalização e verifica a assinatura, e pelo schema oficial. Qualquer alteração depois de assinar invalida a assinatura.
- O XML passa a sair já na forma canônica (aspas no texto não são mais trocadas por entidades), para o documento assinado ser idêntico ao gerado.

## [F3-07 XML da NFC-e] — 13/10/2026

### Adicionado
- **Gerador do XML da NFC-e** (modelo 65, leiaute 4.00 com os grupos da Reforma: IBS, CBS e totais), a partir da venda e dos impostos já calculados pelo motor. Chave de acesso com dígito verificador.
- **Validação automática contra os schemas oficiais**: os testes validam cada XML gerado contra o pacote **PL_010f v1.04** do Portal Nacional, e conferem que o validador reprova XML errado.
- **Tabela oficial de meios de pagamento (tPag)** importada do Portal Nacional, com data e hash.
- Só homologação (tpAmb = 2): o gerador nem tem opção de produção.

### Alterado
- O motor passou a usar o pacote de schemas **PL_010f** (31/08/2026), o vigente no Portal Nacional, no lugar do PL_010b. Isso resolve a dúvida D-012.

### Ainda não
- A nota ainda não é assinada (F3-09) nem enviada (F3-10); o QR Code entra na F3-13.

## [F3-24 Mais cinco UFs confirmadas] — 13/10/2026

### Alterado
- **Alíquota geral do ICMS confirmada em fonte oficial para MA (23%), PI (22,5%), RS (17%), SE (19%) e TO (20%).** Empresas dessas UFs no regime normal passam a ter o ICMS calculado sem precisar cadastrar regra.
- Agora são **25 de 27 UFs** confirmadas e **129 de 135** combinações UF × regime calculando por completo.
- Continuam pendentes **AL** (a lei diz 19%, o portal nacional mostra 20,5%) e **AP** (sem fonte oficial atual). Empresas dessas UFs informam a alíquota em Regras de ICMS, com o contador (dúvida D-021).

## [F3-23.b Cobertura fiscal no painel] — 13/10/2026

### Adicionado
- **Painel do super admin, "Cobertura fiscal":** tabela das 27 UFs × 5 regimes mostrando onde o Bipaê já calcula todos os impostos de uma venda comum e o que falta em cada combinação (passe o mouse para ver o motivo). Hoje: 114 de 135.
- Fecha a F3-23 (teste e mapa de cobertura).

## [F3-06.e Regras de ICMS da empresa] — 13/10/2026

### Adicionado
- **Nova tela "Regras de ICMS":** a empresa (normalmente com o contador) cadastra o que a alíquota geral da UF não cobre, por NCM e com vigência: alíquota própria do produto, redução da base, FCP e substituição tributária (MVA e alíquota).
- Vale a regra **mais específica** para o NCM (8 dígitos vence 4, que vence 2). Duas regras para os mesmos NCM no mesmo período são recusadas no cadastro, com a explicação.
- **O caixa recebe as regras na sincronização e usa no cálculo de cada venda**, mesmo sem internet. O servidor usa as mesmas regras na conferência.
- Toda criação, alteração e exclusão de regra vai para a trilha de auditoria (alteração fiscal é ação sensível).

### Banco de dados
- Migração `0009`: tabela de regras de ICMS por empresa, com isolamento por cliente (RLS).

Com isso a **F3-06 está concluída**: cadastro fiscal conferido nas tabelas oficiais, regime e UF da empresa, regras próprias e impostos calculados em cada venda.

## [F3-06.d4 Impostos da venda na retaguarda] — 13/10/2026

### Adicionado
- **Detalhe da venda:** em Vendas, clicar numa venda abre os itens, o pagamento e os **impostos que o caixa calculou**, item a item (CFOP, ICMS, ICMS-ST, FCP, PIS, COFINS, IBS e CBS) e somados.
- **O que falta configurar aparece ali mesmo**, em português: produto sem perfil fiscal, UF sem alíquota confirmada e assim por diante.
- Quando o cadastro mudou depois da venda e a conta do servidor não bate com a do caixa, a tela avisa e mostra o que o caixa calculou.
- Teste de ponta a ponta do caminho inteiro: configurar a empresa, vender sem internet e ver os impostos na retaguarda.

### Alterado
- A tela de perfis fiscais deixou de dizer que o Bipaê não calcula impostos: agora calcula, para conferência. O que ainda não existe é a emissão da nota.

Com isso a **F3-06.d está concluída**. Os valores são para conferência com o contador; o ICMS usa a alíquota geral da UF até as regras por produto entrarem (F3-06.e e F3-25).

## [F3-06.d3 Impostos calculados na venda] — 13/10/2026

### Adicionado
- **O caixa calcula os impostos de cada item ao fechar a venda, mesmo sem internet.** Usa a UF e o regime da empresa e o perfil fiscal do produto, já guardados no aparelho. O desconto da venda entra na conta, rateado entre os itens.
- **O resumo dos impostos vai junto com a venda** (CRT, CFOP, ICMS, ICMS-ST, FCP, PIS, COFINS, IBS e CBS, e o que ficou por configurar) e fica gravado no servidor, item a item.
- **O servidor refaz a conta e registra se bateu.** Quando não bate (por exemplo, o regime mudou e o caixa ainda não tinha sincronizado), a venda entra do mesmo jeito e fica marcada para o suporte.

### Garantias
- **Imposto nunca impede venda.** Empresa que não configurou UF e regime vende como sempre, sem resumo de impostos. Se os dados fiscais do aparelho estiverem com problema, a venda acontece e segue sem o resumo.
- Caixas ainda na versão anterior continuam enviando vendas normalmente.

### Banco de dados
- Migração `0008`: coluna de impostos nos itens da venda e o sinal de conferência na venda.

### Ainda não aparece na tela
- Os valores já são calculados e gravados, mas a retaguarda ainda não os mostra: é a parte d4.

## [F3-06.d2 Dados fiscais no caixa] — 13/10/2026

### Adicionado
- **O caixa passa a receber os dados fiscais na sincronização:** a UF e o regime da empresa e os perfis fiscais dos produtos. Eles ficam guardados no aparelho, para o cálculo funcionar sem internet, e só são reenviados quando mudam.
- **CST do PIS e da COFINS no perfil fiscal**, para empresas do Lucro Presumido e do Lucro Real. A tela mostra o significado do código e o servidor recusa código que não existe.

### Banco local do caixa
- Migração local 4: tabela de perfis fiscais. Aplica sozinha na próxima abertura do caixa.

### Ainda não ligado
- O caixa já tem os dados, mas ainda não calcula os impostos ao fechar a venda: isso é a parte d3.

## [F3-06.d1 Impostos do item de venda] — 13/10/2026

### Adicionado
- **O motor já responde "quanto de imposto tem neste item?"** a partir do que o lojista cadastrou: UF e regime da empresa, perfil fiscal do produto e valor. Sai o CRT, o CFOP e, para ICMS, PIS, COFINS e IBS/CBS, o valor com a explicação da conta.
- **Quando falta algo, o motor diz o quê**, em português: "Informe a UF e o regime tributário da empresa", "O produto não tem perfil fiscal", "A alíquota geral de ICMS de AL ainda não foi confirmada. Peça a alíquota ao contador".
- **Simplificações ficam à vista:** quando o ICMS usa a alíquota geral da UF, o resultado avisa que produto com alíquota própria precisa de regra específica.
- **Teste de cobertura das 27 UFs × 5 regimes** (135 combinações): hoje 114 calculam por completo e 21 esperam a alíquota de uma das 7 UFs pendentes. Se uma UF ou um regime ficar sem resposta, o teste falha.

### Ainda não ligado
- É a função do motor, com testes. O caixa ainda não a chama: isso vem nas partes d2 a d4.

## [F3-06.c Regime tributário e UF da empresa] — 13/10/2026

### Adicionado
- **Regime tributário no cadastro da empresa:** MEI, Simples Nacional, Simples acima do sublimite, Lucro Presumido ou Lucro Real. A tela explica cada um e mostra o que ele muda na nota (CRT e se o ICMS usa CSOSN ou CST).
- **Alíquota geral do ICMS das 27 UFs no motor fiscal.** As 20 confirmadas em fonte oficial têm número e lei; as 7 pendentes (AL, AP, MA, PI, RS, SE, TO) aparecem como "ainda não confirmada", sem valor suposto.
- **Alíquotas interestaduais** (4%, 7% e 12%) para qualquer par de UFs.
- Ao escolher a UF da empresa, a tela mostra a alíquota geral e a lei, ou avisa que ainda falta confirmar.
- Empresa sem UF ou sem regime mostra "Falta configurar" no cartão.

### Banco de dados
- Migração `0007`: coluna `tax_regime` na empresa (opcional).

## [Plano de cobertura: 27 UFs e todos os regimes] — 13/10/2026

### Documentado
- **`docs/fiscal/cobertura-ufs-regimes.md`**: o mapa do que é preciso para atender as 27 UFs e todos os regimes, do MEI ao Lucro Real, com a fonte de cada número.
  - Alíquota geral do ICMS das 27 UFs: 20 confirmadas em site oficial do estado, 6 só em fonte secundária e 1 divergente (Alagoas).
  - FCP por UF, autorizador da NF-e e da NFC-e de cada UF e o servidor de contingência.
  - Os cinco regimes (MEI, Simples, Simples acima do sublimite, Presumido e Real), com o que o motor já calcula em cada um.
  - O que ainda muda por UF e não foi levantado: alíquotas por produto, substituição tributária, código de benefício, endereços de QR Code.
- **Plano no backlog:** nove tarefas novas (F3-23 a F3-31). A principal é um teste que falha se alguma UF ou algum regime ficar sem regra, para a cobertura não depender de memória.
- O item externo E2 (UF prioritária) foi fechado: são todas.
- Dúvida D-021 com as sete UFs que faltam confirmar.

## [F3-06.b Telas com as tabelas fiscais] — 13/10/2026

### Adicionado
- **Busca de NCM pelo nome da mercadoria** no cadastro de produto: digite "arroz polido" ou "cerveja" e escolha na lista. Quem digita o código vê na hora o que ele é, ou o aviso de que não existe.
- **Sugestão de CEST** pelo NCM escolhido, com o lembrete de que só se preenche quando o produto está em substituição tributária no estado.
- **Perfil fiscal explicado:** cada campo (CFOP, CSOSN, CST, cClassTrib) mostra o significado do código digitado e oferece as opções oficiais; código fora da tabela é avisado antes de salvar.

## [F3-06.a Cadastro conferido nas tabelas oficiais] — 13/10/2026

### Adicionado
- **O cadastro passa a conferir os códigos fiscais nas tabelas oficiais.** NCM e CEST do produto e, no perfil fiscal, origem, CFOP, CSOSN, CST do ICMS e cClassTrib: código que não existe ou não está em vigor é recusado com a explicação ("O CFOP 6102 não é de venda dentro do estado. Os CFOP de venda dentro do estado começam com 5.").
- Produto antigo com NCM que deixou de existir continua podendo ser alterado (preço, nome); a conferência só vale para o código que mudou.
- **Rotas de consulta** para as telas: busca de NCM por palavra ou código (`GET /v1/fiscal/ncm?q=`), sugestão de CEST pelo NCM (`GET /v1/fiscal/cest?ncm=`) e as listas do perfil fiscal (`GET /v1/fiscal/options`).

### Corrigido
- O seed de demonstração usava o NCM 3402.20.00 (sabão em pó e detergente), extinto em 2022. Agora usa o 3402.50.00. Quem já tem esses dois produtos de demonstração segue vendendo normalmente; o código antigo só precisa ser trocado ao editar o NCM.

## [Correção da limpeza periódica] — 13/10/2026

### Corrigido
- **A limpeza de logins antigos não era agendada em produção.** O identificador da tarefa repetida tinha dois-pontos, que o BullMQ recusa. A API subia normalmente e só avisava no log. A rotina passa a usar o agendador próprio do BullMQ, que também não duplica o agendamento quando a API reinicia.
- A primeira tentativa de correção foi barrada pelo teste com Redis de verdade antes do deploy, sem afetar o site: era só trocar o identificador, e a tarefa continuava sem disparar.
- Novo teste de tarefa repetida, rodando também contra o Redis de verdade, e o teste do pacote compilado passa a reprovar se o agendamento falhar.

## [F3-05 IBS, CBS e Imposto Seletivo] — 13/10/2026

### Adicionado
- **Cálculo de IBS e CBS** a partir da classificação tributária oficial (cClassTrib): tributação integral, alíquota reduzida (inclusive a zero, como na cesta básica) e situações sem tributo. O IBS sai separado em parte estadual e parte municipal, como a nota exige.
- **Base de cálculo por período, em tabela com a fonte:** ICMS, ISS, PIS e COFINS fora da base de 2026 a 2032; Imposto Seletivo dentro a partir de 2027.
- **Transição em tabela:** ICMS e ISS a 9/10, 8/10, 7/10 e 6/10 de 2029 a 2032, e extintos em 2033.
- **Imposto Seletivo** por percentual, por unidade ou os dois, sem nenhuma alíquota embutida.
- Casos de teste por período: 2026, 2027–2028, cada ano de 2029 a 2032 e 2033.

### Como o motor trata o que ainda não foi publicado
- **Sem alíquota, sem cálculo.** Para 2027 a CBS ainda "aguarda legislação": o motor para com a mensagem "A alíquota da CBS para 2027 ainda não está na tabela do Bipaê", em vez de supor um número. O mesmo vale para o IBS de 2029 em diante.
- Os testes dos anos futuros usam alíquotas **de exemplo**, marcadas como tal, só para provar que a regra troca na data certa.
- Situações de IBS/CBS ainda não calculadas e perguntas em aberto estão na dúvida D-020.

## [F3-04 Tributos atuais] — 13/10/2026

### Adicionado
- **Cálculo de ICMS** no regime normal (CST 00, 10, 20, 40, 41, 50, 51, 60 e 70) e no Simples Nacional (CSOSN 101, 102, 103, 201, 202, 203, 300, 400 e 500), com redução de base, diferimento, FCP, crédito do Simples e **substituição tributária por MVA**.
- **PIS e COFINS** por alíquota, por unidade de produto e nas situações sem destaque, com a opção de tirar o ICMS da base.
- **IPI** por alíquota.
- `calculateCurrentTaxes` escolhe a regra de cada tributo em vigor na data e calcula na ordem certa (IPI, ICMS, PIS/COFINS). Casos de teste para **Simples Nacional, Lucro Presumido e Lucro Real**.
- **Cada valor vem com a explicação da conta**, passo a passo, começando pela regra usada e a norma que a justifica.
- Alíquotas gerais de PIS e COFINS (cumulativo e não cumulativo) na tabela de referência, conferidas nas leis, com fim em 2027.
- As regras passam a poder depender do regime de apuração (Simples, Presumido ou Real), além do CRT.

### Limites assumidos
- Situação que o motor ainda não calcula (CST 30 e 90, CSOSN 900, combustíveis monofásicos, FCP-ST, DIFAL) gera aviso claro, nunca conta aproximada. Lista na dúvida D-019.
- **Ainda sem alíquotas reais de ICMS e MVA**: dependem da UF de homologação (item E2). Os testes usam valores de exemplo.

## [F3-03.d Tabela de CEST] — 13/10/2026

### Adicionado
- **CEST do Convênio ICMS 142/18**, extraído do texto consolidado do CONFAZ (já com o Convênio ICMS 107/26): 25 segmentos e 1.043 códigos vigentes, com os NCM/SH de cada um.
- `findCest` devolve a redação em vigor na data. Dois códigos mudam de texto em 01/11/2026 e já estão com as duas redações, cada uma na sua vigência.
- `cestsForNcm` sugere os CEST de um NCM, do mais específico para o mais genérico, para o cadastro de produto.
- O importador para diante de qualquer texto do convênio que não reconheça, em vez de adivinhar.

### Documentado
- Dúvida D-018: a lista de CEST é nacional; o que está de fato em substituição tributária depende da UF e ainda não está no sistema.
- Com isso a **F3-03 está concluída**: NCM, CEST, CFOP, CST/CSOSN, cClassTrib e alíquotas de referência, todos gerados de fonte oficial.

## [F3-03.c Situações tributárias e origem] — 13/10/2026

### Adicionado
- **CST do ICMS, CSOSN, CST de PIS, COFINS e IPI e origem da mercadoria**, com os códigos tirados do schema oficial da NF-e (pacote PL_010b v1.30), que é o que a SEFAZ usa para validar.
- Cada código já diz **em que grupo do XML ele entra** (CST 40, 41 e 50 no `ICMS40`; CSOSN 102, 103, 300 e 400 no `ICMSSN102`). É a base para montar a nota na F3-07.
- Descrições em português correto, com a norma de origem, e um teste que impede descrição sem código ou código sem descrição.

## [F3-03.b Tabela de NCM] — 13/10/2026

### Adicionado
- **NCM vigente do Portal Único Siscomex** (13/10/2026): 10.516 códigos de 8 dígitos, mais capítulos, posições e subposições. O arquivo original fica guardado compactado, com hash.
- `findNcm` aceita o código com ou sem pontos e só devolve NCM completo que exista na tabela.
- `ncmPath` monta o caminho do capítulo até o código, porque a descrição sozinha quase sempre é "Outros".
- `searchNcm` busca pelo começo do código ou por palavras, sem acento, em qualquer nível ("arroz polido" acha 1006.30.21). É a base da busca de NCM no cadastro de produto.
- Módulo à parte (`@bipae/fiscal/tables/ncm`), para a tabela grande não pesar em quem não precisa dela.

## [F3-03.a Tabelas oficiais: CFOP, cClassTrib e alíquotas de referência] — 13/10/2026

### Adicionado
- **Tabelas fiscais geradas dos arquivos oficiais**, nunca digitadas: as planilhas do Portal Nacional da NF-e ficam em `packages/fiscal/sources`, com data e hash, e `pnpm --filter @bipae/fiscal tables` gera os dados. Um teste falha se alguém trocar a planilha sem regerar.
  - **CFOP** (IT 2023.002 v2.10): 619 códigos, com vigência e indicadores de devolução, retorno e remessa.
  - **CST e cClassTrib do IBS e da CBS** (IT 2025.002 v1.70): 18 CSTs e 173 classificações, com a redução de alíquota de cada uma.
  - **Alíquotas de referência** com vigência e artigo da lei: CBS de 0,9% e IBS de 0,1% em 2026; IBS de 0,05% estadual + 0,05% municipal em 2027–2028 (LC 214/2025).
  - **FCP por UF**: alíquota fixa ou teto das 27 UFs.
- Uso: `import { findCfop, findClassTrib, referenceRates } from '@bipae/fiscal/tables'`.
- O lint passa a barrar qualquer leitura de arquivo, rede ou processo dentro do motor fiscal.

### Documentado
- A CBS de 2027 **não tem alíquota publicada** (o portal diz "aguarda legislação"): fica sem número na tabela, e a dúvida D-004 continua aberta.
- Dúvidas novas: D-016 (fim da vigência do cClassTrib) e D-017 (lista de CFOP do contribuinte exclusivo do IBS/CBS).
- O Portal Nacional da NF-e agora é lido direto; a tabela de CFOP vigente é a v2.10.

## [F3-02 Motor fiscal: base] — 13/10/2026

### Adicionado
- **`packages/fiscal`**, o motor fiscal puro (sem banco e sem rede), com 100% de cobertura de testes:
  - contas com decimal de precisão arbitrária, dinheiro em centavos e arredondamento explícito (ADR-0008);
  - **regras como dados**, cada uma com vigência, escopo e a norma que a justifica (ADR-0006);
  - escolha da regra em vigor na data do fato gerador, ficando com a mais específica; empate entre regras é erro, nunca escolha silenciosa;
  - conferência da tabela de regras (id repetido, vigência inválida, regra sem fonte, regras que se cruzam);
  - cálculo de base × alíquota com redução de base e **explicação passo a passo** de cada valor.
- Ainda sem alíquotas oficiais: as tabelas entram na F3-03.

## [Correção da fila e do deploy] — 13/10/2026

O deploy da F1-07 deixou o site fora do ar por alguns minutos: a API não subia e a volta automática para a versão anterior não rodou. A versão anterior foi restaurada à mão.

### Corrigido
- **A API não subia com o Redis ligado.** O BullMQ 6 não traz o driver `ioredis`, e no pacote de produção não consegue carregá-lo sozinho. Agora o driver é dependência da API e o cliente é criado por ela.
- **Fila com problema não derruba mais a API.** Redis fora do ar vira aviso no log, e a fila reconecta sozinha.
- **O deploy agora volta mesmo para a versão anterior** quando a nova não fica saudável. Antes, o script parava no primeiro erro, sem chegar a esse passo.

### Adicionado
- **Teste do pacote compilado** (`scripts/smoke-api.mjs`): sobe a API do jeito que roda em produção, com Redis de verdade e com o Redis fora do ar. Roda no CI e antes de todo deploy.
- O teste que antecede o deploy passou a usar um Redis de verdade. Era a falta dele que deixava o erro passar.

## [F1-07 Fila de tarefas] — 13/10/2026

### Adicionado
- **Fila de tarefas em segundo plano**, com nova tentativa automática: em memória no desenvolvimento, BullMQ + Redis em produção. É a base para o envio de notas à SEFAZ na Fase 3.
- Primeira tarefa: limpeza, a cada 6 horas, dos registros de login vencidos ou encerrados há mais de 30 dias.
- **Redis** na VPS: contêiner próprio do Bipaê, sem porta no host, com 96 MB de memória. A CI testa a fila contra um Redis de verdade.

## [F1-06 Convite por link] — 13/10/2026

### Adicionado
- **Convidar por link** em Equipe:
  - escolha o papel, o e-mail (opcional) e as lojas;
  - o link vale 7 dias e só pode ser usado uma vez;
  - os convites pendentes podem ser cancelados.
- **Página do convite**: a pessoa cria a conta ou entra com a que já tem (senha e, se usar, o código da verificação em duas etapas) e cai direto na empresa.

### Mudou
- **Quem já tem conta no Bipaê** (ex.: o contador de várias empresas) não entra mais direto pela tela Adicionar pessoa. Agora precisa aceitar um convite.

### Corrigido
- **Caixa:** num computador lento, um atalho (F4, F10...) apertado logo depois de bipar se perdia. Agora ele espera a bipagem terminar.

## [F1-05 Permissões por loja] — 13/10/2026

### Adicionado
- Em **Equipe**, cada pessoa pode ter **todas as lojas** ou **só algumas**.
- Quem é restrito só vê e usa as suas lojas e os caixas delas. Vendas e estoque de outras lojas não aparecem para essa pessoa, e ela não consegue sincronizar nem enviar vendas por um caixa de outra loja.

## [F1-04 Variações e kits] — 13/10/2026

### Adicionado
- **Kits** (ex.: cesta básica):
  - a composição é montada no cadastro do produto;
  - vender o kit baixa o estoque de cada componente, e o cancelamento e a devolução devolvem;
  - um kit não pode conter outro kit.
- **Grade de variações**:
  - os atributos (ex.: Tamanho P, M, G e Cor Azul, Preto) geram uma variação por combinação, com preço e estoque próprios;
  - gerar de novo só cria as combinações que faltam.
- **No caixa**, aparecem as variações e não o modelo; o kit entra como um item só, pelo preço do kit.

## [F1-03 Tabelas de preço] — 13/10/2026

### Adicionado
- Tela **Tabelas de preço**: busca de produtos, preço especial por item e o preço normal ao lado.
- **Tabela da loja** em Empresas e lojas, que agora permite editar a loja, e **tabela do cliente** no cadastro de clientes.
- **No caixa, inclusive sem internet**, o preço segue esta ordem: tabela do cliente (pelo CPF/CNPJ na venda) → tabela da loja → preço do cadastro.
  - Ao informar o CPF, o carrinho é recalculado.
  - A tela mostra qual tabela está valendo.
  - Os preços chegam ao caixa na sincronização, só quando algo muda.

### Mudou
- Comentários no código, nomes de testes e mensagens de commit passam a ser escritos em português.

## [F1-02 Perfis fiscais] — 13/10/2026

### Adicionado
- Tela **Perfis fiscais**:
  - lista, criação e edição;
  - campos: origem da mercadoria, CFOP dentro e fora do estado, CSOSN (Simples) ou CST (Presumido/Real) e cClassTrib (IBS/CBS);
  - aviso claro de que o cálculo dos impostos chega com a NFC-e.
- Campo **Perfil fiscal** no cadastro do produto.

### Corrigido
- **Bipaê Desktop:** salvar uma edição (produto, empresa, perfil...) dava "Sem conexão com o servidor". A API só liberava GET e POST para chamadas de outro endereço; agora libera também PUT, PATCH e DELETE, com teste.

## [F1-01 Verificação em duas etapas] — 13/10/2026

### Adicionado
- **Verificação em duas etapas** opcional para os usuários dos clientes, recomendada para donos e gerentes:
  - ativa em Configurações, com código QR e app autenticador;
  - o login passa a pedir o código de 6 dígitos;
  - desativar exige um código válido;
  - a semente fica cifrada no banco;
  - o suporte Bipaê, entrando como o cliente, não consegue mudá-la;
  - ativar e desativar ficam na auditoria.
- Painel super admin: **"Zerar verificação em duas etapas"** em Pessoas, para quem perdeu o celular. A ação encerra as sessões abertas e fica na auditoria da plataforma.

## [Nova landing page] — 12/10/2026

### Mudou
- **Landing page redesenhada** (www.bipae.com.br):
  - segue as referências aprovadas, com as **logos oficiais**: verde com o chapéu amarelo e a versão branca;
  - fonte Plus Jakarta Sans servida pelo próprio site;
  - seções: herói com a tela do caixa, 3 passos, recursos, "A internet caiu. A fila, não.", Online e Desktop, "O que vem por aí", planos, dúvidas e chamada final;
  - menu de celular.

### Corrigido
- **PDV Embed:** com leitor rápido e rede lenta, um código lido enquanto o anterior ainda era buscado podia se perder. Agora cada leitura entra numa fila e nenhuma se perde. Há teste novo que simula a rede lenta.

## [Bipaê PDV Embed 1.0] — 12/10/2026

### Adicionado
- **Bipaê PDV Embed** (`kits/pdv-embed`, ADR-0014): o caixa da Bipaê como uma tag HTML (`<bipae-pdv>`) para colocar no painel de qualquer aplicação web, em qualquer linguagem.
  - **O caixa:**
    - abertura de caixa;
    - bipagem, busca e `3*código`;
    - produtos por peso;
    - desconto com limite;
    - vários pagamentos com troco;
    - CPF/CNPJ na nota;
    - sangria, suprimento e fechamento cego;
    - cancelamento e reimpressão;
    - atalhos F2/F4/F9, temas claro/escuro e cores personalizáveis.
  - **Componente:** um único arquivo de 18 KB (gzip), com estilos isolados e eventos para a aplicação reagir a cada venda.
  - **Backend:**
    - contrato aberto de 9 rotas (OpenAPI);
    - implementações prontas em **Node** e **PHP** (Laravel, WordPress, PHP puro);
    - tabelas para PostgreSQL, MySQL e SQLite;
    - produtos lidos da tabela da própria aplicação, por uma view.
  - **Teste de conformidade** que valida qualquer backend. Junto vai um prompt pronto para pedir a uma IA a implementação em outras linguagens.
  - **CI:** testa as duas implementações e o componente num navegador real.

### Mudou
- `@bipae/pdv-core/pure`: entrada só com as regras puras do caixa.
- As formas de pagamento do `@bipae/domain` estão num arquivo próprio, sem zod.
- O app web aplica versões novas sozinho fora da tela do caixa. Na tela do caixa, espera o operador sair dela. Antes, páginas novas, como `/app/download`, voltavam para o início até limpar o cache.

## [Download do Bipaê Desktop] — 12/10/2026

### Adicionado
- Página **Baixar o Bipaê Desktop**:
  - pública em https://www.bipae.com.br/app/download, com links na landing;
  - item "Baixar o desktop" no menu da retaguarda e link na tela de Periféricos.
- Mostra a versão mais recente com o instalador certo para o sistema do visitante, as outras opções (MSI, .deb, AppImage), o passo a passo de instalação e o aviso do SmartScreen. Sem versão publicada, diz isso com clareza.
- API `GET /v1/downloads/desktop`, que lê a última Release estável do GitHub, com cache.
- O workflow **Release desktop** agora publica uma Release pública com instaladores de nome fixo a cada tag `vX.Y.Z`.

## [Plataforma SaaS e painel super admin] — 12/10/2026

### Adicionado
- **Multi-clientes e multi-empresas** (ADR-0013):
  - cada cliente (conta) pode ter várias empresas (CNPJs), cada empresa várias lojas, cada loja vários caixas;
  - nova tela **Empresas e lojas**;
  - quem participa de mais de um cliente troca pelo seletor no menu.
- **Planos e limites**:
  - planos Grátis, Essencial, Profissional e Rede, com limites de empresas, lojas, caixas, usuários e produtos;
  - limite aplicado na API com mensagem clara;
  - exceções negociadas por cliente;
  - nova tela **Minha assinatura**, com uso do plano e histórico da conta.
- **Ciclo de vida da conta**:
  - estados ativo, em teste (com data de fim), suspenso e cancelado;
  - conta bloqueada vê uma tela explicando o motivo, mas os caixas **continuam enviando as vendas feitas offline**.
- **Painel super admin** em `/app/admin`, para a equipe Bipaê:
  - **visão geral**: clientes ativos, receita mensal estimada, uso na semana, caixas ativos, novos clientes e faturamento por dia, clientes por plano, testes terminando;
  - **clientes**: busca e filtros; ficha com uso do plano, movimento, empresas, caixas, equipe, histórico e auditoria; ações de mudar plano ou teste, limites especiais, suspender, reativar, cancelar, anotar e encerrar sessões;
  - **pessoas**: busca em todos os clientes;
  - **planos, avisos** (faixa na retaguarda dos clientes) e **equipe Bipaê** (papéis Administrador, Suporte e Consulta);
  - **auditoria da plataforma** encadeada por hash, com verificação de integridade;
  - **sistema**: versões, banco e migrações.
- **Segurança do painel**:
  - login próprio, separado do login dos clientes;
  - verificação em duas etapas (app autenticador) obrigatória;
  - papel de banco exclusivo, que os clientes não enxergam;
  - rota sem permissão declarada só libera o Administrador.
- **Acesso de suporte**:
  - "entrar como o cliente" por 30 minutos, somente leitura por padrão, com motivo obrigatório;
  - faixa visível na tela do cliente;
  - registro nas duas auditorias.
- `admin-cli` para promover o primeiro super admin na VPS.

### Mudou
- Produção ganhou `SECRETS_KEY` (gerada no próximo deploy), usada para cifrar as sementes do 2FA.

## [Fase 2 — PDV offline-first] — 12/10/2026

### Adicionado
- **Caixa (PDV)** igual no navegador e no app desktop:
  - bipagem com multiplicador (`3*código`), busca sem acento, pesáveis com leitura de balança e etiquetas de balança (prefixo 2);
  - desconto com limite (acima de 10%, autorização de gerente com as credenciais dele, registrada na auditoria);
  - vários pagamentos na mesma venda com troco; Pix e cartão por **simulador**;
  - CPF/CNPJ na nota, orçamentos, sangria, suprimento, **fechamento cego**;
  - cancelamento, devolução por item sem sobra de centavo, reimpressão de comprovante (não fiscal);
  - atalhos F2–F12 e operação por toque, som de bip.
- **Offline-first**: banco local SQLite em todos os caixas (WASM + OPFS no navegador, nativo no desktop), venda e evento gravados na mesma transação, sincronização a cada 30 s e ao reconectar.
- **Servidor**:
  - eventos idempotentes (`/v1/sync/events`) com rejeição explicada em pt-BR;
  - catálogo incremental (`/v1/sync/pull`);
  - vendas, caixa e estoque como livro de movimentações;
  - contagem e ajuste de estoque; autorização de gerente.
- **Retaguarda**: tela de Vendas (faturamento, ticket médio), coluna e contagem de estoque, tela de Periféricos.
- **Periféricos** (desktop): impressora ESC/POS por rede ou serial, gaveta pela impressora, balança Toledo/Filizola.
- **Bipaê Conector**:
  - o app desktop serve impressora, balança e gaveta ao caixa do navegador, com pareamento por código, tokens revogáveis, checagem de origem e lista fechada de comandos;
  - modo bandeja (`--connector`);
  - simulador para desenvolvimento e testes.
- **Atualização automática** do desktop: assinada, canais estável/beta, nunca durante uma venda; workflow de release com assinatura de código opcional.
- **Testes**: 161 automatizados rodando nesta máquina (152 unitários e de integração + 9 E2E), mais 9 testes Rust que só rodam na CI:
  - dois caixas (web e desktop) vendendo offline ao mesmo tempo com estoque e numeração exatos;
  - atualização com vendas pendentes sem perda;
  - Conector com impressora e balança simuladas;
  - E2E de venda online e offline, fechamento cego e autorização nos dois frontends;
  - testes Rust para banco local, periféricos e Conector.

### Corrigido (achado pelos testes)
- Produto marcado como "vendido por peso" ficava com unidade UN.
- Caixa recém-vinculado não tinha catálogo no primeiro bip.
- Montagem dupla do React (modo de desenvolvimento) travava o banco do navegador.
- Bipar e apertar uma tecla de atalho logo em seguida usava o carrinho antigo.

### Limitações conhecidas
- O código Rust (banco nativo, periféricos, Conector, bandeja, atualizador) **não foi compilado nem testado em hardware** nesta máquina; depende da primeira execução da CI.
- O E2E dentro do WebView real (tauri-driver) ainda não existe; a suíte roda o frontend desktop no Chromium.
- Detalhes em `docs/TAREFAS.md`.

## [Fase 1 — Fundação] — 12/10/2026

### Adicionado
- **Monorepo** pnpm + Turborepo, TypeScript estrito, ESLint com regras de fronteira do ADR-0012 (pacotes não importam Tauri nem cascas).
- **`packages/domain`**: dinheiro em centavos, CPF e CNPJ (inclusive o CNPJ alfanumérico de julho/2026), GTIN, UUIDv7, catálogo de permissões e papéis, série de NFC-e por caixa, política de versão mínima de cliente, contratos Zod com mensagens em pt-BR.
- **`packages/platform`**: os oito ports do ADR-0012, matriz de capacidades web × desktop com explicações em pt-BR, estado "chega em breve" e simuladores.
- **API** (NestJS + Fastify):
  - PostgreSQL com Row-Level Security forçada em todas as tabelas de negócio; PGlite para desenvolver e testar sem Docker.
  - Cadastro sem configuração obrigatória; login; refresh token rotativo com detecção de reuso; troca de empresa (contador com vários clientes); limite de tentativas de login.
  - Papéis e permissões, recarregados a cada requisição.
  - Trilha de auditoria encadeada por hash e imutável no banco.
  - Cadastros: produtos (códigos de barras, variações, kits, pesáveis), unidades, perfis fiscais (só dados), tabelas de preço, clientes (com consentimento LGPD separado), fornecedores, empresas, lojas e caixas com série de NFC-e exclusiva.
  - API `/v1` com versão mínima de cliente (HTTP 426), que nunca bloqueia o envio de vendas.
  - Seed de demonstração.
- **Telas** (`packages/ui` e `packages/erp-ui`): entrar, criar conta, início com primeiros passos e capacidades da plataforma, produtos, clientes, fornecedores, caixas, equipe, auditoria e configurações (tema, alto contraste, fonte grande, som de bip).
- **Cascas** `apps/web` (PWA) e `apps/desktop` (Tauri 2), finas, sobre as mesmas telas.
- **Testes**: 98 unitários e de integração, e E2E Playwright com a mesma suíte nas duas cascas.
- **CI**: lint, typecheck, testes, API contra PostgreSQL 16 real, E2E e build dos instaladores desktop (Windows e Linux).
- **Docker Compose** com PostgreSQL, API e web, já com os dados de demonstração.

### Limitações conhecidas
- O `docker compose` e a compilação do app Tauri não puderam ser executados na máquina de desenvolvimento (sem WSL e sem Rust); ficam validados pela CI.
- Ver pendências em `docs/TAREFAS.md`.

## [Fase 0] — 11/10/2026

### Adicionado
- Briefing (`docs/PROMPT.md`), PRD, ADRs, benchmark de mercado em sala limpa, registro de versões fiscais e dúvidas fiscais.
- Adendo 01 (web + desktop): análise de impacto e ADR-0012.
