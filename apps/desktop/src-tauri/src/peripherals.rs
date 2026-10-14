//! Peripherals for Bipaê Desktop and the Conector: thermal printer (serial, raw TCP 9100 or the
//! Windows spooler in RAW mode),
//! cash drawer (pulse through the printer) and retail scale (serial, Toledo/Filizola family).
//! Rust only moves bytes; ESC/POS encoding and receipts live in `@bipae/pdv-core`.

use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "transport", rename_all = "lowercase", rename_all_fields = "camelCase")]
pub enum PrinterConfig {
    Serial { port: String, baud_rate: u32, columns: u8, code_page: u8 },
    Tcp { host: String, port: u16, columns: u8, code_page: u8 },
    /// Impressora instalada no Windows (USB), pelo spooler em modo RAW (F2-07).
    Spooler { printer_name: String, columns: u8, code_page: u8 },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScaleConfig {
    pub port: String,
    pub baud_rate: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub printer: Option<PrinterConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale: Option<ScaleConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub drawer_via_printer: Option<bool>,
}

/// Cash drawer kick through the printer (ESC p 0 25 250), same as DRAWER_PULSE in pdv-core.
const DRAWER_PULSE: [u8; 5] = [0x1b, 0x70, 0x00, 0x19, 0xfa];
const ENQ: u8 = 0x05;
const STX: u8 = 0x02;
const ETX: u8 = 0x03;

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("devices.json"))
}

pub fn load_config(app: &AppHandle) -> DeviceConfig {
    config_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn list_ports() -> Vec<String> {
    serialport::available_ports()
        .map(|ports| ports.into_iter().map(|p| p.port_name).collect())
        .unwrap_or_default()
}

pub fn print(config: &DeviceConfig, bytes: &[u8]) -> Result<(), String> {
    match config.printer.as_ref().ok_or("Nenhuma impressora configurada.")? {
        PrinterConfig::Serial { port, baud_rate, .. } => {
            let mut serial = serialport::new(port, *baud_rate)
                .timeout(Duration::from_secs(3))
                .open()
                .map_err(|e| format!("Não foi possível abrir a impressora em {port}: {e}"))?;
            serial.write_all(bytes).map_err(|e| format!("Falha ao imprimir: {e}"))?;
            serial.flush().map_err(|e| format!("Falha ao imprimir: {e}"))
        }
        PrinterConfig::Tcp { host, port, .. } => {
            let addr = (host.as_str(), *port)
                .to_socket_addrs()
                .map_err(|e| format!("Endereço da impressora inválido: {e}"))?
                .next()
                .ok_or("Endereço da impressora inválido.")?;
            let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(3))
                .map_err(|e| format!("A impressora em {host}:{port} não respondeu: {e}"))?;
            stream.write_all(bytes).map_err(|e| format!("Falha ao imprimir: {e}"))
        }
        PrinterConfig::Spooler { printer_name, .. } => spooler::print_raw(printer_name, bytes),
    }
}

/// Impressoras instaladas no Windows (vazio nos outros sistemas).
pub fn list_printers() -> Vec<String> {
    spooler::list()
}

/// Spooler do Windows: os bytes ESC/POS vão sem tradução (modo RAW), como na porta serial.
#[cfg(windows)]
mod spooler {
    use windows_sys::Win32::Graphics::Printing::{
        ClosePrinter, EndDocPrinter, EndPagePrinter, EnumPrintersW, OpenPrinterW, StartDocPrinterW,
        StartPagePrinter, WritePrinter, DOC_INFO_1W, PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL,
        PRINTER_INFO_4W,
    };

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe fn from_wide(ptr: *const u16) -> String {
        if ptr.is_null() {
            return String::new();
        }
        let mut len = 0;
        while *ptr.add(len) != 0 {
            len += 1;
        }
        String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len))
    }

    pub fn print_raw(printer: &str, bytes: &[u8]) -> Result<(), String> {
        let name = wide(printer);
        let mut doc_name = wide("Bipaê");
        let mut datatype = wide("RAW");
        unsafe {
            let mut handle: windows_sys::Win32::Foundation::HANDLE = std::ptr::null_mut();
            if OpenPrinterW(name.as_ptr(), &mut handle, std::ptr::null()) == 0 {
                return Err(format!("A impressora \"{printer}\" não foi encontrada no Windows."));
            }
            let info = DOC_INFO_1W {
                pDocName: doc_name.as_mut_ptr(),
                pOutputFile: std::ptr::null_mut(),
                pDatatype: datatype.as_mut_ptr(),
            };
            let mut result = Ok(());
            if StartDocPrinterW(handle, 1, std::ptr::addr_of!(info).cast()) == 0 {
                result = Err(format!("O Windows recusou o trabalho na impressora \"{printer}\"."));
            } else {
                if StartPagePrinter(handle) != 0 {
                    let mut written: u32 = 0;
                    let ok = WritePrinter(handle, bytes.as_ptr().cast(), bytes.len() as u32, &mut written);
                    if ok == 0 || written as usize != bytes.len() {
                        result = Err(format!("Falha ao enviar para a impressora \"{printer}\"."));
                    }
                    EndPagePrinter(handle);
                } else {
                    result = Err(format!("O Windows recusou a página na impressora \"{printer}\"."));
                }
                EndDocPrinter(handle);
            }
            ClosePrinter(handle);
            result
        }
    }

    pub fn list() -> Vec<String> {
        let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
        let mut needed: u32 = 0;
        let mut count: u32 = 0;
        unsafe {
            EnumPrintersW(flags, std::ptr::null(), 4, std::ptr::null_mut(), 0, &mut needed, &mut count);
            if needed == 0 {
                return Vec::new();
            }
            // Buffer alinhado para ponteiros (PRINTER_INFO_4W tem ponteiros).
            let mut buffer = vec![0u64; (needed as usize).div_ceil(8)];
            if EnumPrintersW(
                flags,
                std::ptr::null(),
                4,
                buffer.as_mut_ptr().cast(),
                needed,
                &mut needed,
                &mut count,
            ) == 0
            {
                return Vec::new();
            }
            let infos = std::slice::from_raw_parts(buffer.as_ptr().cast::<PRINTER_INFO_4W>(), count as usize);
            infos.iter().map(|info| from_wide(info.pPrinterName)).collect()
        }
    }
}

#[cfg(not(windows))]
mod spooler {
    pub fn print_raw(_printer: &str, _bytes: &[u8]) -> Result<(), String> {
        Err("Impressora do Windows só existe no Bipaê Desktop para Windows. Use rede ou porta serial.".into())
    }

    pub fn list() -> Vec<String> {
        Vec::new()
    }
}

pub fn open_drawer(config: &DeviceConfig) -> Result<(), String> {
    print(config, &DRAWER_PULSE)
}

/// Parses STX + 5–6 ASCII digits (grams) + ETX. Messages match `SCALE_MESSAGES` in pdv-core.
pub fn parse_scale(bytes: &[u8]) -> Result<u32, String> {
    let start = bytes.iter().position(|b| *b == STX).ok_or(INVALID)?;
    let end = bytes[start + 1..].iter().position(|b| *b == ETX).ok_or(INVALID)? + start + 1;
    let payload = std::str::from_utf8(&bytes[start + 1..end]).map_err(|_| INVALID)?.trim();
    if !payload.is_empty() && payload.chars().all(|c| c == 'I') {
        return Err("A balança ainda está estabilizando. Espere um instante.".into());
    }
    if !payload.is_empty() && payload.chars().all(|c| c == 'N') {
        return Err("A balança está com peso negativo. Tire tudo do prato e zere a balança.".into());
    }
    if !payload.is_empty() && payload.chars().all(|c| c == 'S') {
        return Err("Peso acima da capacidade da balança.".into());
    }
    if !(5..=6).contains(&payload.len()) || !payload.chars().all(|c| c.is_ascii_digit()) {
        return Err(INVALID.into());
    }
    payload.parse::<u32>().map_err(|_| INVALID.into())
}

const INVALID: &str =
    "Não entendemos a resposta da balança. Confira o cabo e a configuração (velocidade e protocolo).";

pub fn read_scale(config: &DeviceConfig) -> Result<u32, String> {
    let scale = config.scale.as_ref().ok_or("Nenhuma balança configurada.")?;
    let mut serial = serialport::new(&scale.port, scale.baud_rate)
        .timeout(Duration::from_millis(200))
        .open()
        .map_err(|e| format!("Não foi possível abrir a balança em {}: {e}", scale.port))?;
    serial.write_all(&[ENQ]).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_millis(1500);
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 32];
    while Instant::now() < deadline {
        match serial.read(&mut chunk) {
            Ok(n) if n > 0 => {
                buffer.extend_from_slice(&chunk[..n]);
                if buffer.contains(&ETX) {
                    return parse_scale(&buffer);
                }
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::TimedOut => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("A balança não respondeu. Confira se está ligada e conectada.".into())
}

// ---------------------------------------------------------------- Tauri commands

#[tauri::command]
pub fn devices_get_config(app: AppHandle) -> DeviceConfig {
    load_config(&app)
}

#[tauri::command]
pub fn devices_set_config(app: AppHandle, config: DeviceConfig) -> Result<(), String> {
    let text = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(config_path(&app)?, text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn devices_list_ports() -> Vec<String> {
    list_ports()
}

#[tauri::command]
pub async fn devices_list_printers() -> Vec<String> {
    tauri::async_runtime::spawn_blocking(list_printers).await.unwrap_or_default()
}

#[tauri::command]
pub async fn devices_print(app: AppHandle, data: Vec<u8>) -> Result<(), String> {
    let config = load_config(&app);
    tauri::async_runtime::spawn_blocking(move || print(&config, &data))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn devices_open_drawer(app: AppHandle) -> Result<(), String> {
    let config = load_config(&app);
    tauri::async_runtime::spawn_blocking(move || open_drawer(&config))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn devices_read_scale(app: AppHandle) -> Result<u32, String> {
    let config = load_config(&app);
    tauri::async_runtime::spawn_blocking(move || read_scale(&config))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(s: &str) -> Vec<u8> {
        let mut v = vec![STX];
        v.extend_from_slice(s.as_bytes());
        v.push(ETX);
        v
    }

    #[test]
    fn parses_scale_frames_like_pdv_core() {
        assert_eq!(parse_scale(&frame("01250")), Ok(1250));
        assert!(parse_scale(&frame("IIIII")).unwrap_err().contains("estabilizando"));
        assert!(parse_scale(&frame("NNNNN")).unwrap_err().contains("negativo"));
        assert!(parse_scale(&frame("SSSSS")).unwrap_err().contains("capacidade"));
        assert_eq!(parse_scale(&frame("12a45")), Err(INVALID.into()));
        assert_eq!(parse_scale(&[0x30]), Err(INVALID.into()));
    }

    #[test]
    fn device_config_json_matches_the_typescript_shape() {
        let json = r#"{"printer":{"transport":"tcp","host":"192.168.0.50","port":9100,"columns":48,"codePage":3},"scale":{"port":"COM3","baudRate":9600}}"#;
        let config: DeviceConfig = serde_json::from_str(json).unwrap();
        assert_eq!(
            config.printer,
            Some(PrinterConfig::Tcp { host: "192.168.0.50".into(), port: 9100, columns: 48, code_page: 3 })
        );
        assert_eq!(config.scale.as_ref().unwrap().baud_rate, 9600);
        let back = serde_json::to_string(&config).unwrap();
        assert!(back.contains("\"codePage\":3") && back.contains("\"transport\":\"tcp\""));
    }

    #[test]
    fn spooler_config_round_trips_and_explains_other_systems() {
        let json = r#"{"printer":{"transport":"spooler","printerName":"EPSON TM-T20","columns":48,"codePage":3}}"#;
        let config: DeviceConfig = serde_json::from_str(json).unwrap();
        assert_eq!(
            config.printer,
            Some(PrinterConfig::Spooler { printer_name: "EPSON TM-T20".into(), columns: 48, code_page: 3 })
        );
        assert!(serde_json::to_string(&config).unwrap().contains("\"printerName\":\"EPSON TM-T20\""));
        if !cfg!(windows) {
            assert!(print(&config, b"x").unwrap_err().contains("Windows"));
            assert!(list_printers().is_empty());
        }
    }

    #[test]
    fn printing_without_a_printer_explains_it() {
        assert_eq!(print(&DeviceConfig::default(), &[0]), Err("Nenhuma impressora configurada.".into()));
        assert_eq!(read_scale(&DeviceConfig::default()), Err("Nenhuma balança configurada.".into()));
    }

    #[test]
    fn prints_to_a_network_printer() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let reader = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut received = Vec::new();
            socket.read_to_end(&mut received).unwrap();
            received
        });
        let config = DeviceConfig {
            printer: Some(PrinterConfig::Tcp { host: "127.0.0.1".into(), port, columns: 48, code_page: 3 }),
            ..Default::default()
        };
        open_drawer(&config).unwrap();
        assert_eq!(reader.join().unwrap(), DRAWER_PULSE.to_vec());
    }
}
