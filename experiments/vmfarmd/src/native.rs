use std::sync::Arc;

use rmcp::model::{CallToolResult, JsonObject, Tool};
use serde_json::json;

use crate::{error::DaemonError, session::Session};

const GET_VM_INFO: &str = "get_vm_info";

/// Tools the daemon serves itself, next to the ones its MCP servers advertise.
pub fn tools() -> Vec<Tool> {
    vec![Tool::new(
        GET_VM_INFO,
        "Returns the VM's hostname, OS, daemon version and the MCP servers in this session.",
        empty_schema(),
    )]
}

pub async fn call(
    session: &Session,
    name: &str,
    _arguments: Option<JsonObject>,
) -> Result<CallToolResult, DaemonError> {
    match name {
        GET_VM_INFO => Ok(CallToolResult::structured(json!({
            "hostname": gethostname::gethostname().to_string_lossy(),
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "daemon_version": env!("CARGO_PKG_VERSION"),
            "session_id": session.id(),
            "servers": session.server_names(),
        }))),
        _ => Err(DaemonError::UnknownTool(name.to_owned())),
    }
}

fn empty_schema() -> Arc<JsonObject> {
    let mut schema = JsonObject::new();
    schema.insert("type".into(), json!("object"));
    schema.insert("properties".into(), json!({}));
    Arc::new(schema)
}
