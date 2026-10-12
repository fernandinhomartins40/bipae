//! Bipaê Conector (ADR-0012 §3): local WebSocket server that lets the web register use this
//! computer's peripherals. Mirrors `ConnectorCore` in `@bipae/platform` (the specification):
//! - only official origins (dev origins in debug builds) pass the handshake;
//! - a browser pairs once with the 6-digit code shown in the app (5 wrong tries lock it);
//! - tokens are stored in the app data folder and can be revoked;
//! - only print / drawer / scale / ports exist.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::StatusCode;
use tokio_tungstenite::tungstenite::Message;

use crate::peripherals;

pub const PORT: u16 = 47800;
/// www.bipae.com.br/app is production today; app./homolog. are reserved for later.
const ORIGINS: [&str; 3] = ["https://www.bipae.com.br", "https://app.bipae.com.br", "https://homolog.bipae.com.br"];
const DEV_ORIGINS: [&str; 3] = ["http://localhost:5173", "http://localhost:5174", "http://localhost:4173"];
const MAX_ATTEMPTS: u32 = 5;

pub fn origin_allowed(origin: Option<&str>, dev: bool) -> bool {
    match origin {
        Some(o) => ORIGINS.contains(&o) || (dev && DEV_ORIGINS.contains(&o)),
        None => false,
    }
}

#[derive(Default, Serialize, Deserialize)]
struct Tokens(HashMap<String, String>);

pub struct ConnectorState {
    code: Mutex<String>,
    attempts: Mutex<u32>,
    tokens: Mutex<Tokens>,
    running: Mutex<bool>,
    path: Mutex<Option<PathBuf>>,
}

impl Default for ConnectorState {
    fn default() -> Self {
        Self {
            code: Mutex::new(new_code()),
            attempts: Mutex::new(0),
            tokens: Mutex::new(Tokens::default()),
            running: Mutex::new(false),
            path: Mutex::new(None),
        }
    }
}

/// Codes and tokens come from the operating system's secure random generator.
fn random_bytes<const N: usize>() -> [u8; N] {
    let mut bytes = [0u8; N];
    getrandom::fill(&mut bytes).expect("gerador aleatório do sistema indisponível");
    bytes
}

fn new_code() -> String {
    format!("{:06}", u32::from_le_bytes(random_bytes::<4>()) % 1_000_000)
}

fn new_token() -> String {
    random_bytes::<16>().iter().map(|b| format!("{b:02x}")).collect()
}

impl ConnectorState {
    fn save_tokens(&self) {
        if let (Some(path), Ok(tokens)) = (self.path.lock().unwrap().clone(), self.tokens.lock()) {
            if let Ok(text) = serde_json::to_string(&*tokens) {
                let _ = std::fs::write(path, text);
            }
        }
    }

    /// Same rules as ConnectorCore.handle in TypeScript.
    pub fn handle(&self, app: &AppHandle, authed: &mut bool, request: &Value) -> Value {
        let id = request.get("id").cloned().unwrap_or(Value::Null);
        let fail = |code: &str, error: &str| json!({ "id": id, "ok": false, "code": code, "error": error });
        let kind = request.get("type").and_then(Value::as_str).unwrap_or("");
        match kind {
            "pair" => {
                let mut attempts = self.attempts.lock().unwrap();
                if *attempts >= MAX_ATTEMPTS {
                    return fail("locked", "Muitas tentativas. Gere um novo código no Bipaê Conector.");
                }
                let code = request.get("code").and_then(Value::as_str).unwrap_or("");
                if code != *self.code.lock().unwrap() {
                    *attempts += 1;
                    return fail("bad_code", "Código incorreto. Confira o código mostrado no Bipaê Conector.");
                }
                let token = new_token();
                let name: String = request.get("clientName").and_then(Value::as_str).unwrap_or("Navegador").chars().take(60).collect();
                self.tokens.lock().unwrap().0.insert(token.clone(), name);
                self.save_tokens();
                *authed = true;
                json!({ "id": id, "ok": true, "result": { "token": token } })
            }
            "auth" => {
                let token = request.get("token").and_then(Value::as_str).unwrap_or("");
                if !self.tokens.lock().unwrap().0.contains_key(token) {
                    return fail("unpaired", "Este navegador precisa ser pareado de novo com o Bipaê Conector.");
                }
                *authed = true;
                json!({ "id": id, "ok": true })
            }
            _ if !*authed => fail("unpaired", "Pareie este navegador com o Bipaê Conector primeiro."),
            "print" | "drawer" | "scale" | "ports" => {
                let config = peripherals::load_config(app);
                let result: Result<Value, String> = match kind {
                    "print" => {
                        use base64::Engine;
                        let data = request.get("data").and_then(Value::as_str).unwrap_or("");
                        base64::engine::general_purpose::STANDARD
                            .decode(data)
                            .map_err(|_| "Dados de impressão inválidos.".to_string())
                            .and_then(|bytes| peripherals::print(&config, &bytes))
                            .map(|_| Value::Null)
                    }
                    "drawer" => peripherals::open_drawer(&config).map(|_| Value::Null),
                    "scale" => peripherals::read_scale(&config).map(|grams| json!({ "grams": grams })),
                    _ => Ok(json!({ "ports": peripherals::list_ports() })),
                };
                match result {
                    Ok(Value::Null) => json!({ "id": id, "ok": true }),
                    Ok(value) => json!({ "id": id, "ok": true, "result": value }),
                    Err(error) => fail("device", &error),
                }
            }
            _ => fail("unknown_command", "Comando não permitido."),
        }
    }
}

/// Starts the server once per app run. If the port is taken (another Bipaê is the Conector),
/// it simply stays off.
pub fn start(app: AppHandle) {
    let state = app.state::<Arc<ConnectorState>>().inner().clone();
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("connector-tokens.json");
        if let Some(tokens) = std::fs::read_to_string(&path).ok().and_then(|t| serde_json::from_str(&t).ok()) {
            *state.tokens.lock().unwrap() = tokens;
        }
        *state.path.lock().unwrap() = Some(path);
    }
    tauri::async_runtime::spawn(async move {
        let Ok(listener) = TcpListener::bind(("127.0.0.1", PORT)).await else { return };
        *state.running.lock().unwrap() = true;
        while let Ok((stream, _)) = listener.accept().await {
            let (app, state) = (app.clone(), state.clone());
            tauri::async_runtime::spawn(async move {
                let _ = serve(stream, app, state).await;
            });
        }
    });
}

async fn serve(stream: TcpStream, app: AppHandle, state: Arc<ConnectorState>) -> Result<(), String> {
    let dev = cfg!(debug_assertions);
    let check_origin = |request: &Request, response: Response| -> Result<Response, ErrorResponse> {
        let origin = request.headers().get("origin").and_then(|v| v.to_str().ok());
        if origin_allowed(origin, dev) {
            Ok(response)
        } else {
            let mut denied = ErrorResponse::new(Some("Origem não permitida.".into()));
            *denied.status_mut() = StatusCode::FORBIDDEN;
            Err(denied)
        }
    };
    let mut socket = tokio_tungstenite::accept_hdr_async(stream, check_origin).await.map_err(|e| e.to_string())?;
    let mut authed = false;
    while let Some(message) = socket.next().await {
        let message = message.map_err(|e| e.to_string())?;
        if !message.is_text() {
            continue;
        }
        let request: Value = serde_json::from_str(message.to_text().unwrap_or("{}")).unwrap_or(Value::Null);
        let (app2, state2) = (app.clone(), state.clone());
        let mut flag = authed;
        let (response, flag) = tauri::async_runtime::spawn_blocking(move || {
            let response = state2.handle(&app2, &mut flag, &request);
            (response, flag)
        })
        .await
        .map_err(|e| e.to_string())?;
        authed = flag;
        socket.send(Message::Text(response.to_string().into())).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------------------------------------------------------------- commands for the desktop UI

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorStatus {
    running: bool,
    port: u16,
    code: String,
    clients: Vec<ConnectorClient>,
}

#[derive(Serialize)]
pub struct ConnectorClient {
    id: String,
    name: String,
}

#[tauri::command]
pub fn connector_status(state: State<'_, Arc<ConnectorState>>) -> ConnectorStatus {
    ConnectorStatus {
        running: *state.running.lock().unwrap(),
        port: PORT,
        code: state.code.lock().unwrap().clone(),
        clients: state
            .tokens
            .lock()
            .unwrap()
            .0
            .iter()
            .map(|(token, name)| ConnectorClient { id: token.chars().take(8).collect(), name: name.clone() })
            .collect(),
    }
}

#[tauri::command]
pub fn connector_new_code(state: State<'_, Arc<ConnectorState>>) -> String {
    let code = new_code();
    *state.code.lock().unwrap() = code.clone();
    *state.attempts.lock().unwrap() = 0;
    code
}

/// Revokes a paired browser by the first 8 characters of its token (what the UI shows).
#[tauri::command]
pub fn connector_revoke(state: State<'_, Arc<ConnectorState>>, id: String) {
    state.tokens.lock().unwrap().0.retain(|token, _| !token.starts_with(&id));
    state.save_tokens();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origins_follow_the_specification() {
        assert!(origin_allowed(Some("https://www.bipae.com.br"), false));
        assert!(origin_allowed(Some("https://app.bipae.com.br"), false));
        assert!(!origin_allowed(Some("https://evil.example"), true));
        assert!(!origin_allowed(Some("http://localhost:5173"), false));
        assert!(origin_allowed(Some("http://localhost:5173"), true));
        assert!(!origin_allowed(None, true));
    }

    #[test]
    fn codes_and_tokens_have_the_expected_shape() {
        let code = new_code();
        assert_eq!(code.len(), 6);
        assert!(code.chars().all(|c| c.is_ascii_digit()));
        assert_eq!(new_token().len(), 32);
    }
}
