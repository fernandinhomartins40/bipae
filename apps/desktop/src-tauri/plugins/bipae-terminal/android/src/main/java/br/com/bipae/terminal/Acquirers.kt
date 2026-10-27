package br.com.bipae.terminal

/*
 * Esqueleto de cada adquirente (F8-12). NENHUM faz cobrança: todos respondem "falta configurar".
 * Cada classe lista, em português, o que o dono do projeto precisa providenciar (itens E25 e E26 de
 * docs/TAREFAS.md) antes de alguém escrever a chamada real ao SDK. Quando isso existir:
 *   1. adicione o SDK no build.gradle.kts do plugin (repositório e dependência indicados abaixo);
 *   2. troque a base NotConfiguredAcquirer por uma implementação de Acquirer;
 *   3. mapeie o resultado do SDK para o JSON de `TefStep`/`TefTransactionResult`
 *      (approved, message, transactionId, nsu, authorizationCode, brand, receipts);
 *   4. homologue com conta e aparelho reais e só então marque "Pronto" no catálogo.
 * As versões e nomes de pacote dos SDKs mudam: confirme sempre na documentação oficial.
 */

/**
 * PagBank PlugPag (maquininha smart PagBank).
 * Precisa: conta de desenvolvedor do PagBank, o SDK PlugPag (wrapper de serviço da PagSeguro),
 * maquininha smart PagBank com o app instalado e o código de ativação (segredo, vai ao Keystore).
 * Formas: crédito, débito, voucher e Pix. Roda só dentro da maquininha (o SDK não existe fora dela).
 */
class PagBankAcquirer : NotConfiguredAcquirer(
    "pagbank",
    "PagBank (PlugPag)",
    "SDK PlugPag, maquininha smart PagBank e código de ativação.",
)

/**
 * Stone (Stone Code).
 * Precisa: parceria com a Stone, a chave/credencial do SDK, maquininha Stone com Android
 * (Ton T3 ou Stone Smart), Stone Code da loja e o app instalado nela.
 * Formas: crédito, débito, voucher e Pix.
 */
class StoneAcquirer : NotConfiguredAcquirer(
    "stone",
    "Stone",
    "SDK Stone, parceria com a Stone, Stone Code da loja e maquininha Stone com Android.",
)

/**
 * Cielo LIO (Order Manager).
 * Precisa: cadastro no Cielo Developers, Client ID e access token (segredo), maquininha Cielo LIO
 * com o app instalado. O SDK cria um pedido e a LIO cobra; o resultado volta pelo pedido.
 * Formas: crédito, débito, voucher e Pix.
 */
class CieloLioAcquirer : NotConfiguredAcquirer(
    "cielo",
    "Cielo LIO",
    "SDK Cielo LIO, credenciais do Cielo Developers e maquininha LIO.",
)

/**
 * Getnet Smart (SmartPOS).
 * Precisa: contrato de parceiro com a Getnet, o SDK SmartPOS, o código do estabelecimento e uma
 * maquininha Getnet Smart com o app instalado. Formas: crédito, débito e voucher (Pix a confirmar).
 */
class GetnetAcquirer : NotConfiguredAcquirer(
    "getnet",
    "Getnet (Smart)",
    "SDK SmartPOS, contrato de parceiro com a Getnet e maquininha Getnet Smart.",
)

/**
 * m-SiTef (Fiserv/Software Express), TEF com pinpad Bluetooth ou USB.
 * Precisa: contrato da loja com a Software Express/Fiserv, a biblioteca m-SiTef para Android,
 * servidor SiTef (host), código da loja e número do terminal, e um pinpad homologado pareado.
 * Aqui os passos têm menus e campos (como o CliSiTef do computador em
 * `packages/platform/src/tef/cli-sitef.ts`): reaproveite a mesma tradução de comandos.
 * Permissões do Android: BLUETOOTH_CONNECT e BLUETOOTH_SCAN (e USB, se o pinpad for por cabo).
 */
class MSitefAcquirer : NotConfiguredAcquirer(
    "msitef",
    "m-SiTef",
    "biblioteca m-SiTef, contrato com a Software Express/Fiserv e pinpad pareado.",
)

/**
 * PayGo (PGWeb para Android), TEF com pinpad.
 * Precisa: contrato com a Setis/PayGo, a biblioteca de automação, servidor PayGo (host), chave de
 * automação (segredo) e pinpad homologado pareado. O protocolo do computador (em `packages/platform/src/tef/`)
 * é outro; o Android usa a biblioteca própria dele.
 */
class PayGoAcquirer : NotConfiguredAcquirer(
    "paygo",
    "PayGo",
    "biblioteca de automação da PayGo, contrato com a Setis/PayGo e pinpad pareado.",
)

/** Todas as adquirentes que o plugin conhece, por identificador. */
val ALL_ACQUIRERS: Map<String, Acquirer> = listOf(
    PagBankAcquirer(),
    StoneAcquirer(),
    CieloLioAcquirer(),
    GetnetAcquirer(),
    MSitefAcquirer(),
    PayGoAcquirer(),
).associateBy { it.id }
