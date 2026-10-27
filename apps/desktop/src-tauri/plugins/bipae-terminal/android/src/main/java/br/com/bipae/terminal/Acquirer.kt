package br.com.bipae.terminal

import org.json.JSONObject

/**
 * Contrato comum das maquininhas e TEF no Android (F8-12). Espelha `SmartTerminalBridge` de
 * `packages/platform/src/smart-terminal/bridge.ts`: o Kotlin só move chamadas para o SDK da
 * adquirente. O fluxo (passos, duas fases, cancelamento) é o do TEF em TypeScript
 * (`packages/platform/src/tef/protocol.ts`); aqui os passos viajam como JSON no mesmo formato
 * de `TefStep`, por exemplo {"kind":"wait","text":"..."} e {"kind":"done","result":{...}}.
 *
 * REGRAS:
 * - Texto para o operador sempre em português do Brasil.
 * - Nenhum segredo (código de ativação, token, chave) em log ou em texto puro: guarde no
 *   EncryptedSharedPreferences / Android Keystore e responda só `secretsStored`.
 * - Nenhuma implementação finge que funciona: sem SDK ou sem aparelho, diga o que falta.
 */
interface Acquirer {
    /** Identificador igual ao `SmartAcquirerId` do TypeScript (pagbank, stone, cielo, getnet, msitef, paygo). */
    val id: String

    /** Estado atual: o SDK está no app? há maquininha ou pinpad? os segredos estão guardados? */
    fun status(): AcquirerStatus

    /** Guarda os valores da loja; os campos secretos vão para o Keystore. Falhe com [TerminalException]. */
    fun configure(values: Map<String, String>)

    /** Abre uma operação (`operation` no formato de `TefOperation`) e devolve a sessão. */
    fun begin(operation: JSONObject): AcquirerSession

    /** Segunda fase: confirma (true) a transação gravada ou a desfaz (false). */
    fun finish(transactionId: String, confirmed: Boolean)
}

/** Uma conversa com o SDK, do início da operação ao resultado. */
interface AcquirerSession {
    /** Passo seguinte (JSON de `TefStep`), depois da resposta ao anterior (JSON de `TefReply`, ou null no primeiro). */
    fun next(reply: JSONObject?): JSONObject

    /** Desiste no meio; o SDK desfaz o que for preciso. */
    fun abort()
}

data class AcquirerStatus(
    val sdkPresent: Boolean,
    val secretsStored: Boolean,
    val deviceReady: Boolean,
    val note: String? = null,
)

/** Erro com mensagem em português que vai direto para a tela do caixa. */
class TerminalException(message: String, val code: String = "unavailable") : Exception(message)

/**
 * Base dos esqueletos: nenhum SDK está incluído ainda (E26), então tudo responde "falta
 * configurar" com o que cada adquirente exige. Quando o SDK real entrar, a classe deixa de
 * estender esta base e implementa [Acquirer] de verdade.
 */
abstract class NotConfiguredAcquirer(
    override val id: String,
    private val name: String,
    private val needs: String,
) : Acquirer {
    override fun status() = AcquirerStatus(
        sdkPresent = false,
        secretsStored = false,
        deviceReady = false,
        note = "Falta configurar $name: $needs",
    )

    override fun configure(values: Map<String, String>) {
        throw TerminalException("Falta configurar $name: $needs", "not_configured")
    }

    override fun begin(operation: JSONObject): AcquirerSession {
        throw TerminalException("Falta configurar $name: $needs", "not_configured")
    }

    override fun finish(transactionId: String, confirmed: Boolean) {
        throw TerminalException("Falta configurar $name: $needs", "not_configured")
    }
}
