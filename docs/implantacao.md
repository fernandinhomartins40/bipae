# Guia de implantação do Bipaê (para revendas e técnicos)

Roteiro para colocar uma loja no ar: o que levantar antes da visita, como instalar, configurar e testar, e o que fazer quando algo não funciona. Para o lojista, a tela **Ajuda**, dentro do Bipaê, explica as tarefas do dia a dia.

> **Situação da nota fiscal (16/10/2026):** o Bipaê emite NFC-e só em **homologação** (ambiente de teste da SEFAZ, sem valor fiscal). Ainda **não há emissão em produção**: ela depende da liberação pelo Bipaê. Até lá, não implante o Bipaê como emissor oficial de uma loja. Use para treinamento, testes e operação de caixa com a nota emitida por outro sistema.

## 1. Antes da visita

Peça ao lojista, por escrito:

| Item | Para quê | Observação |
|---|---|---|
| CNPJ, razão social, nome fantasia e endereço completo | Cadastro da empresa | O município é escolhido na lista oficial do IBGE |
| Inscrição estadual (IE) | Nota fiscal | Obrigatória para a NFC-e |
| Regime tributário: MEI, Simples Nacional, Simples acima do sublimite, Lucro Presumido ou Lucro Real | Cálculo dos impostos | Confira no cartão do CNPJ ou no Simples Nacional. **Não suponha.** |
| Certificado digital **A1** (arquivo .pfx ou .p12 e a senha) | Assinar a nota | O A3 (token ou cartão) ainda **não** é suportado |
| Lista de produtos com código de barras, preço e NCM | Cadastro | O jeito mais rápido é importar os XML das notas de compra |
| Quantos caixas, quantas lojas e quem vai usar | Caixas e equipe | Cada caixa tem a própria série de NFC-e |
| Periféricos: impressora, gaveta, balança, leitor | Instalação | Veja a seção 2 |

## 2. Equipamentos

| Equipamento | O que funciona | Como liga |
|---|---|---|
| Computador do caixa | Windows 10 ou superior, ou Linux (Ubuntu 22.04+). O navegador também serve: Chrome ou Edge atualizados | — |
| Leitor de código de barras | Qualquer leitor USB que funcione como teclado | Direto, sem configurar |
| Impressora térmica | ESC/POS, papel de 80 mm ou 58 mm | Rede (IP, porta 9100), USB/serial (porta COM) ou impressora instalada no Windows |
| Gaveta de dinheiro | Ligada à impressora (pulso) | Marque "Abrir a gaveta pela impressora em vendas no dinheiro" |
| Balança | Toledo (Prix) e Filizola, por cabo serial/USB | Informe a porta e a velocidade (baud) |
| Internet | Necessária para sincronizar e emitir a nota | O caixa vende sem internet e envia depois |

> Os periféricos ainda não foram homologados com equipamentos reais pelo Bipaê. Faça a venda de teste completa (seção 6) antes de liberar o caixa.

## 3. Instalação

1. **Conta:** o lojista cria a conta em https://www.bipae.com.br. Você entra como membro da equipe dele, nunca com a senha do dono.
2. **Bipaê Desktop** (recomendado no caixa): baixe em https://www.bipae.com.br/app/download.
   - Enquanto o instalador não tiver assinatura digital, o Windows mostra "O Windows protegeu o computador". Clique em **Mais informações → Executar assim mesmo**.
   - Os dados do caixa ficam no computador e sobrevivem às atualizações.
3. **Ou pelo navegador** (Chrome ou Edge): abra https://www.bipae.com.br/app/ e instale como aplicativo (ícone "Instalar" na barra de endereço).
   - Para usar impressora, gaveta e balança pelo navegador, instale também o Bipaê Desktop no mesmo computador. Ele traz o **Bipaê Conector**.
   - Em **Periféricos**, digite o código de pareamento do Conector.
   - Para o Conector abrir junto com o Windows, marque "Iniciar o Bipaê Conector junto com o computador".

## 4. Configuração (na retaguarda)

1. **Empresas e lojas:**
   - razão social, CNPJ, UF, "Regime tributário", "Inscrição estadual" e endereço;
   - envie o **certificado A1** e confira a validade mostrada na tela;
   - crie uma loja para cada endereço físico.
2. **Caixas:** crie um caixa por computador ou tablet. Cada um recebe a própria série de NFC-e, para dois caixas sem internet nunca repetirem o número.
3. **Equipe:** convide as pessoas com o papel certo (Dono, Gerente, Operador de caixa ou Contador) e, se preciso, limite às lojas delas.
   - Cancelamento, desconto acima do limite, sangria e mudança de preço ficam na **Auditoria**.
4. **Produtos:**
   - importe os XML de compra em **Compras → Importar XML**. Isso cria o fornecedor, os produtos, o custo e o estoque;
   - cadastre à mão o que faltar;
   - o NCM é conferido na tabela oficial. Produto sem NCM válido não sai na nota.
5. **Regras fiscais:**
   - em **Perfis fiscais** e **Regras de ICMS**, ajuste os casos especiais da loja: substituição tributária, redução de base e alíquotas por NCM;
   - o que o Bipaê ainda não sabe calcular aparece como **"falta configurar"**, nunca como pronto. Nesses casos, consulte as normas da SEFAZ do estado.
6. **Periféricos** (no computador do caixa): escolha a conexão da impressora, a largura do papel, a gaveta e a balança. Use os botões de teste.

## 5. Treinamento rápido do operador (15 minutos)

- **Venda:** bipar, **F10** para pagar, várias formas de pagamento na mesma venda.
- **Durante a venda:** **F6** para CPF na nota, **F4** para desconto (acima do limite pede gerente) e **F8** para remover item.
- **Gaveta e fechamento:** **F9** para sangria, suprimento e fechamento. O fechamento é cego: o operador conta, e o Bipaê compara.
- **Depois da venda:** **F11** para reimprimir, cancelar ou devolver.
- **Sem internet:** continue vendendo. O selo no topo mostra quantas vendas faltam enviar.
- **Dúvidas:** menu **Ajuda**.

## 6. Checklist antes de liberar o caixa

- [ ] Venda de teste com 3 itens: um bipado, um pesado na balança e um buscado pelo nome.
- [ ] Pagamento em dinheiro com troco: a gaveta abre e o comprovante sai inteiro e legível.
- [ ] Venda com CPF na nota.
- [ ] Cancelamento de uma venda de teste, com autorização do gerente.
- [ ] Tirar o cabo de rede, vender, ligar de novo: a venda aparece em **Vendas** na retaguarda.
- [ ] A nota de teste aparece como autorizada **em homologação**. Se aparecer recusada, a tela explica o motivo.
- [ ] Fechamento do caixa com a conferência.
- [ ] Senha do dono só com o dono; cada operador com o próprio acesso.

## 7. Problemas comuns

| O que aparece | O que fazer |
|---|---|
| "Sem conexão · N para enviar" | Normal sem internet. Quando a conexão voltar, tudo é enviado sozinho. Se não enviar em 1 minuto, confira a internet do computador. |
| "Este navegador não guarda dados no aparelho" | Use Chrome ou Edge atualizados (fora da janela anônima) ou o Bipaê Desktop. |
| "O Bipaê Conector não está aberto neste computador" | Abra o Bipaê Desktop ou marque o início automático em Periféricos. |
| Impressora não imprime | Confira IP e porta 9100 (rede) ou a porta COM e a velocidade (serial). Use o teste em Periféricos. |
| A balança "não respondeu" | Confira cabo, porta e velocidade. Toledo e Filizola costumam usar 9600 ou 2400. |
| Nota "falta configurar" | Falta dado da empresa (IE, endereço, certificado) ou do produto (NCM). A tela diz o quê. |
| Nota recusada pela SEFAZ | A tela mostra o código e o que corrigir. Depois de corrigir, a nota é reenviada. |
| "Sua sessão expirou" | Entre de novo. Por segurança, sessões antigas são encerradas. |
| Windows bloqueou o instalador | **Mais informações → Executar assim mesmo** (seção 3). |

## 8. Suporte

- A equipe do Bipaê pode entrar na conta da loja em **modo suporte**: somente leitura, ou com as alterações registradas na auditoria. Isso acontece sempre com o aviso no topo da tela e por tempo limitado.
- Ao abrir um chamado, informe o CNPJ, o nome do caixa, o que apareceu na tela (de preferência com a imagem) e o horário.

## 9. O que ainda não está disponível

Não ofereça ao lojista como pronto:

- emissão de NFC-e em produção;
- NF-e na retaguarda (modelo 55);
- NFS-e de serviços;
- certificado A3;
- Pix e cartão integrados (TEF): por enquanto, o Pix e o cartão são registrados à mão no caixa;
- iFood e marketplaces;
- envio de e-mail de campanhas;
- macOS.

A lista atualizada está no backlog do projeto (`docs/TAREFAS.md`). O que o Bipaê ainda não faz aparece na tela como "chega em breve" ou "falta configurar".
