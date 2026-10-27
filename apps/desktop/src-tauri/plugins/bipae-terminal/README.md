# Plugin `bipae-terminal` (Android, F8-12)

Maquininhas smart e TEF no app Android do Bipaê. **Esqueleto revisado, sem SDK e sem aparelho:
nada aqui cobra cartão.** Cada adquirente responde "falta configurar" até o dono do projeto
providenciar contas e aparelhos (itens E25 e E26 de `docs/TAREFAS.md`).

## Como as peças se encaixam

- Contrato e ponte em TypeScript: `packages/platform/src/smart-terminal/` (`SmartTerminalBridge`,
  `BridgeTefDriver`, simulador). O fluxo de passos e as duas fases são os do TEF
  (`packages/platform/src/tef/protocol.ts`).
- Ponte do app: `apps/desktop/src/terminal.ts` chama `plugin:bipae-terminal|<comando>`. Sem o plugin
  registrado, o Tauri recusa a chamada e a tela mostra "falta configurar".
- Plugin Kotlin: `android/src/main/java/br/com/bipae/terminal/`
  - `Acquirer.kt`: interface comum e a base `NotConfiguredAcquirer`.
  - `Acquirers.kt`: um esqueleto por adquirente, com o que cada uma exige.
  - `BipaeTerminalPlugin.kt`: comandos `status`, `configure`, `begin`, `next`, `abort`, `finish`.

## O que cada adquirente exige

| Adquirente | Tipo | O que falta |
| --- | --- | --- |
| PagBank (PlugPag) | maquininha smart | conta de desenvolvedor, SDK PlugPag, maquininha PagBank, código de ativação |
| Stone | maquininha smart | parceria com a Stone, SDK, Stone Code, maquininha com Android |
| Cielo LIO | maquininha smart | Cielo Developers (Client ID e token), maquininha LIO |
| Getnet Smart | maquininha smart | contrato de parceiro, SDK SmartPOS, código do estabelecimento |
| m-SiTef | TEF com pinpad | contrato Software Express/Fiserv, biblioteca m-SiTef, pinpad pareado |
| PayGo | TEF com pinpad | contrato Setis/PayGo, biblioteca de automação, pinpad pareado |

## Para ligar no app (ainda não feito)

1. Criar o crate Rust do plugin (`tauri-plugin` com `mobile::register_android_plugin("br.com.bipae.terminal", "BipaeTerminalPlugin")`)
   e o `build.gradle.kts` desta pasta `android`; sem Cargo e Android SDK instalados aqui, isso não
   foi compilado e ficou de fora do `Cargo.toml` de propósito.
2. Registrar o plugin só no alvo Android em `src-tauri/src/lib.rs` e liberar os comandos em `capabilities/`.
3. Declarar as permissões de Bluetooth no manifesto (a CI de `release-android.yml` já inclui
   `BLUETOOTH_CONNECT` e `BLUETOOTH_SCAN`).
4. Implementar uma adquirente por vez com a conta dela, homologar e só então marcar "Pronto".

Regras: segredos só no Keystore do aparelho e nunca em log; mensagens ao operador em português;
o cálculo ou a falha da maquininha nunca pode impedir uma venda (o caixa segue com outra forma de pagamento).
