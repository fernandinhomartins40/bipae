//! Native local database for Bipaê Desktop (ADR-0004/0012): one SQLite connection per open
//! file, guarded by a mutex. The JS side (`@bipae/local-db`) serializes statements and wraps
//! transactions in BEGIN/COMMIT, so a single connection is all that is needed.

use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::types::{Value, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde_json::{Map, Number, Value as Json};
use tauri::{AppHandle, Manager, State};

#[derive(Default)]
pub struct DbState(pub Mutex<Option<Connection>>);

fn to_sql(value: &Json) -> Result<Value, String> {
    Ok(match value {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Integer(i64::from(*b)),
        Json::Number(n) => match n.as_i64() {
            Some(i) => Value::Integer(i),
            None => Value::Real(n.as_f64().ok_or("número inválido")?),
        },
        Json::String(s) => Value::Text(s.clone()),
        other => Value::Text(other.to_string()),
    })
}

fn to_json(value: ValueRef<'_>) -> Json {
    match value {
        ValueRef::Null => Json::Null,
        ValueRef::Integer(i) => Json::Number(i.into()),
        ValueRef::Real(f) => Number::from_f64(f).map(Json::Number).unwrap_or(Json::Null),
        ValueRef::Text(t) => Json::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => Json::Array(b.iter().map(|x| Json::Number((*x).into())).collect()),
    }
}

/// Only plain file names inside the app data folder, never paths chosen by the page.
fn database_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.') {
        return Err("Nome de banco inválido.".into());
    }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(name))
}

#[tauri::command]
pub fn db_open(app: AppHandle, state: State<'_, DbState>, name: String) -> Result<Json, String> {
    let path = database_path(&app, &name)?;
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")
        .map_err(|e| e.to_string())?;
    *state.0.lock().map_err(|e| e.to_string())? = Some(conn);
    Ok(serde_json::json!({ "persistent": true }))
}

#[tauri::command]
pub fn db_run(state: State<'_, DbState>, sql: String, params: Vec<Json>) -> Result<Vec<Map<String, Json>>, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Banco local não aberto.")?;
    run(conn, &sql, &params)
}

pub fn run(conn: &Connection, sql: &str, params: &[Json]) -> Result<Vec<Map<String, Json>>, String> {
    let values = params.iter().map(to_sql).collect::<Result<Vec<_>, _>>()?;
    let mut statement = conn.prepare(sql).map_err(|e| e.to_string())?;
    let columns: Vec<String> = statement.column_names().iter().map(|c| c.to_string()).collect();
    let mut rows = statement.query(params_from_iter(values)).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let mut map = Map::new();
        for (i, name) in columns.iter().enumerate() {
            map.insert(name.clone(), to_json(row.get_ref(i).map_err(|e| e.to_string())?));
        }
        out.push(map);
    }
    Ok(out)
}

#[tauri::command]
pub fn db_exec(state: State<'_, DbState>, sql: String) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Banco local não aberto.")?;
    conn.execute_batch(&sql).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_close(state: State<'_, DbState>) -> Result<(), String> {
    state.0.lock().map_err(|e| e.to_string())?.take();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runs_statements_and_maps_types() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE t (a INTEGER, b TEXT, c REAL, d INTEGER)").unwrap();
        run(&conn, "INSERT INTO t VALUES (?, ?, ?, ?)", &[
            Json::from(42), Json::from("olá"), Json::from(1.5), Json::Null,
        ])
        .unwrap();
        let rows = run(&conn, "SELECT * FROM t", &[]).unwrap();
        assert_eq!(rows[0]["a"], Json::from(42));
        assert_eq!(rows[0]["b"], Json::from("olá"));
        assert_eq!(rows[0]["c"], Json::from(1.5));
        assert_eq!(rows[0]["d"], Json::Null);
    }

    #[test]
    fn rolls_back_a_failed_transaction() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE t (a INTEGER PRIMARY KEY)").unwrap();
        run(&conn, "BEGIN IMMEDIATE", &[]).unwrap();
        run(&conn, "INSERT INTO t VALUES (1)", &[]).unwrap();
        assert!(run(&conn, "INSERT INTO t VALUES (1)", &[]).is_err());
        run(&conn, "ROLLBACK", &[]).unwrap();
        assert!(run(&conn, "SELECT * FROM t", &[]).unwrap().is_empty());
    }
}
