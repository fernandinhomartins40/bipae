package br.com.bipae.terminal

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

@InvokeArg
class AcquirerArgs {
    lateinit var acquirer: String
}

@InvokeArg
class ConfigureArgs {
    lateinit var acquirer: String
    var values: Map<String, String> = emptyMap()
}

@InvokeArg
class BeginArgs {
    lateinit var acquirer: String
    lateinit var operation: JSObject
}

@InvokeArg
class NextArgs {
    lateinit var sessionId: String
    var reply: JSObject? = null
}

@InvokeArg
class SessionArgs {
    lateinit var sessionId: String
}

@InvokeArg
class FinishArgs {
    lateinit var acquirer: String
    lateinit var transactionId: String
    var confirmed: Boolean = false
}

/**
 * Plugin Tauri `bipae-terminal` (F8-12). Os comandos têm os mesmos nomes de
 * `SmartTerminalBridge` (status, configure, begin, next, abort, finish) e devolvem os JSON de
 * `TefStep`. Este arquivo só roteia para a [Acquirer] certa; não tem regra de pagamento.
 * AINDA NÃO ESTÁ REGISTRADO NO APP (ver README.md deste plugin): foi escrito sem Android SDK
 * para compilar e precisa de revisão na primeira compilação.
 */
@TauriPlugin
class BipaeTerminalPlugin(private val activity: Activity) : Plugin(activity) {
    private val sessions = ConcurrentHashMap<String, AcquirerSession>()

    private fun acquirer(id: String): Acquirer =
        ALL_ACQUIRERS[id] ?: throw TerminalException("Adquirente desconhecida: $id", "rejected")

    private inline fun guarded(invoke: Invoke, block: () -> Unit) {
        try {
            block()
        } catch (e: TerminalException) {
            invoke.reject(e.message ?: "Erro na maquininha.", e.code)
        } catch (e: Exception) {
            // Nunca devolve o texto cru do SDK (pode conter dado do cartão ou segredo).
            invoke.reject("A maquininha não respondeu. Use outra forma de pagamento.", "unavailable")
        }
    }

    @Command
    fun status(invoke: Invoke) = guarded(invoke) {
        val args = invoke.parseArgs(AcquirerArgs::class.java)
        val s = acquirer(args.acquirer).status()
        invoke.resolve(JSObject().apply {
            put("sdkPresent", s.sdkPresent)
            put("secretsStored", s.secretsStored)
            put("deviceReady", s.deviceReady)
            s.note?.let { put("note", it) }
        })
    }

    @Command
    fun configure(invoke: Invoke) = guarded(invoke) {
        val args = invoke.parseArgs(ConfigureArgs::class.java)
        acquirer(args.acquirer).configure(args.values)
        invoke.resolve()
    }

    @Command
    fun begin(invoke: Invoke) = guarded(invoke) {
        val args = invoke.parseArgs(BeginArgs::class.java)
        val session = acquirer(args.acquirer).begin(JSONObject(args.operation.toString()))
        val id = UUID.randomUUID().toString()
        sessions[id] = session
        invoke.resolve(JSObject().put("sessionId", id))
    }

    @Command
    fun next(invoke: Invoke) = guarded(invoke) {
        val args = invoke.parseArgs(NextArgs::class.java)
        val session = sessions[args.sessionId]
            ?: throw TerminalException("A operação não está mais aberta.", "protocol")
        val step = session.next(args.reply?.let { JSONObject(it.toString()) })
        if (step.optString("kind") == "done") sessions.remove(args.sessionId)
        invoke.resolve(JSObject(step.toString()))
    }

    @Command
    fun abort(invoke: Invoke) = guarded(invoke) {
        val args = invoke.parseArgs(SessionArgs::class.java)
        sessions.remove(args.sessionId)?.abort()
        invoke.resolve()
    }

    @Command
    fun finish(invoke: Invoke) = guarded(invoke) {
        val args = invoke.parseArgs(FinishArgs::class.java)
        acquirer(args.acquirer).finish(args.transactionId, args.confirmed)
        invoke.resolve()
    }
}
