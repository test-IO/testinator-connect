use std::{
    collections::HashMap,
    future::Future,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};

use rmcp::model::{CallToolRequestParams, CallToolResponse, Tool};
use serde::Serialize;
use tokio::{
    sync::{Mutex, RwLock},
    task::JoinHandle,
};
use uuid::Uuid;

use crate::{child::McpChild, config::Config, error::DaemonError, native};

pub const DEFAULT_SESSION_ID: &str = "default";
const REAP_INTERVAL: Duration = Duration::from_secs(30);

pub struct Session {
    id: String,
    children: Vec<McpChild>,
    call_timeout: Duration,
    last_used: std::sync::Mutex<Instant>,
    in_flight: AtomicUsize,
    index: Mutex<Option<ToolIndex>>,
}

struct ToolIndex {
    generations: Vec<u64>,
    tools: Vec<Tool>,
    routes: HashMap<String, Route>,
}

#[derive(Clone)]
enum Route {
    Native,
    Server { child: usize, tool: String },
}

struct InFlight<'a>(&'a Session);

impl Drop for InFlight<'_> {
    fn drop(&mut self) {
        self.0.in_flight.fetch_sub(1, Ordering::AcqRel);
        self.0.touch();
    }
}

impl Session {
    fn new(id: String, children: Vec<McpChild>, call_timeout: Duration) -> Self {
        Self {
            id,
            children,
            call_timeout,
            last_used: std::sync::Mutex::new(Instant::now()),
            in_flight: AtomicUsize::new(0),
            index: Mutex::new(None),
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn server_names(&self) -> Vec<String> {
        self.children.iter().map(|child| child.name().to_owned()).collect()
    }

    pub fn idle_for(&self) -> Duration {
        if self.in_flight.load(Ordering::Acquire) > 0 {
            return Duration::ZERO;
        }
        self.last_used.lock().expect("last_used lock").elapsed()
    }

    fn touch(&self) {
        *self.last_used.lock().expect("last_used lock") = Instant::now();
    }

    fn begin(&self) -> InFlight<'_> {
        self.in_flight.fetch_add(1, Ordering::AcqRel);
        self.touch();
        InFlight(self)
    }

    /// Lists native tools first, then each server's tools.
    ///
    /// With more than one server, server tools are named `<server>__<tool>` so they cannot collide.
    pub async fn tools(&self) -> Result<Vec<Tool>, DaemonError> {
        let _in_flight = self.begin();
        let mut index = self.index.lock().await;
        self.refresh(&mut index).await?;
        Ok(index.as_ref().map(|index| index.tools.clone()).unwrap_or_default())
    }

    pub async fn call_tool(
        &self,
        mut params: CallToolRequestParams,
    ) -> Result<CallToolResponse, DaemonError> {
        let _in_flight = self.begin();
        let route = {
            let mut index = self.index.lock().await;
            self.refresh(&mut index).await?;
            index
                .as_ref()
                .and_then(|index| index.routes.get(params.name.as_ref()).cloned())
        }
        .ok_or_else(|| DaemonError::UnknownTool(params.name.to_string()))?;

        match route {
            Route::Native => native::call(self, &params.name, params.arguments)
                .await
                .map(Into::into),
            Route::Server { child, tool } => {
                let child = &self.children[child];
                let peer = child.peer().await?;
                params.name = tool.into();
                let what = format!("tool {} on {}", params.name, child.name());
                self.within(what, peer.call_tool_once(params))
                    .await?
                    .map_err(|error| DaemonError::mcp(child.name(), error))
            }
        }
    }

    async fn refresh(&self, index: &mut Option<ToolIndex>) -> Result<(), DaemonError> {
        let current = index
            .as_ref()
            .is_some_and(|index| index.generations == self.generations());
        if !current {
            *index = Some(self.build_index().await?);
        }
        Ok(())
    }

    async fn build_index(&self) -> Result<ToolIndex, DaemonError> {
        let mut tools = native::tools();
        let mut routes: HashMap<String, Route> = tools
            .iter()
            .map(|tool| (tool.name.to_string(), Route::Native))
            .collect();
        let prefixed = self.children.len() > 1;

        for (position, child) in self.children.iter().enumerate() {
            let peer = child.peer().await?;
            let listed = self
                .within(format!("listing tools of {}", child.name()), peer.list_all_tools())
                .await?
                .map_err(|error| DaemonError::mcp(child.name(), error))?;
            for mut tool in listed {
                let original = tool.name.to_string();
                let exposed = if prefixed {
                    format!("{}__{original}", child.name())
                } else {
                    original.clone()
                };
                if routes.contains_key(&exposed) {
                    tracing::warn!(server = child.name(), tool = %exposed, "tool name already taken; hiding it");
                    continue;
                }
                tool.name = exposed.clone().into();
                routes.insert(exposed, Route::Server { child: position, tool: original });
                tools.push(tool);
            }
        }

        Ok(ToolIndex {
            generations: self.generations(),
            tools,
            routes,
        })
    }

    fn generations(&self) -> Vec<u64> {
        self.children.iter().map(McpChild::generation).collect()
    }

    async fn within<T>(&self, what: String, future: impl Future<Output = T>) -> Result<T, DaemonError> {
        tokio::time::timeout(self.call_timeout, future)
            .await
            .map_err(|_| DaemonError::Timeout(what))
    }

    async fn shutdown(&self) {
        for child in &self.children {
            child.shutdown().await;
        }
    }
}

#[derive(Debug, Serialize)]
pub struct SessionSummary {
    pub session_id: String,
    pub servers: Vec<String>,
    pub idle_secs: u64,
}

pub struct SessionManager {
    config: Arc<Config>,
    sessions: RwLock<HashMap<String, Arc<Session>>>,
    starting: Mutex<()>,
}

impl SessionManager {
    pub fn new(config: Arc<Config>) -> Self {
        Self {
            config,
            sessions: RwLock::new(HashMap::new()),
            starting: Mutex::new(()),
        }
    }

    /// Starts a session and its MCP servers. With no servers named, the config's default servers start.
    pub async fn start(
        &self,
        id: Option<String>,
        servers: Option<Vec<String>>,
    ) -> Result<Arc<Session>, DaemonError> {
        let _starting = self.starting.lock().await;
        let id = id.unwrap_or_else(|| Uuid::new_v4().to_string());
        if self.sessions.read().await.contains_key(&id) {
            return Err(DaemonError::SessionExists(id));
        }

        let names = servers
            .filter(|names| !names.is_empty())
            .unwrap_or_else(|| self.config.default_servers());
        let children = names
            .iter()
            .map(|name| {
                let spec = self
                    .config
                    .servers
                    .get(name)
                    .ok_or_else(|| DaemonError::UnknownServer(name.clone()))?;
                Ok(McpChild::new(name.clone(), spec.clone(), self.config.startup_timeout()))
            })
            .collect::<Result<Vec<_>, DaemonError>>()?;

        let session = Arc::new(Session::new(id.clone(), children, self.config.call_timeout()));
        if let Err(error) = session.tools().await {
            session.shutdown().await;
            return Err(error);
        }
        self.sessions.write().await.insert(id.clone(), Arc::clone(&session));
        tracing::info!(session = %id, servers = ?names, "session started");
        Ok(session)
    }

    pub async fn get(&self, id: &str) -> Result<Arc<Session>, DaemonError> {
        self.sessions
            .read()
            .await
            .get(id)
            .cloned()
            .ok_or_else(|| DaemonError::UnknownSession(id.to_owned()))
    }

    pub async fn get_or_start_default(&self) -> Result<Arc<Session>, DaemonError> {
        if let Ok(session) = self.get(DEFAULT_SESSION_ID).await {
            return Ok(session);
        }
        match self.start(Some(DEFAULT_SESSION_ID.to_owned()), None).await {
            Err(DaemonError::SessionExists(_)) => self.get(DEFAULT_SESSION_ID).await,
            result => result,
        }
    }

    pub async fn end(&self, id: &str, reason: &str) -> Result<(), DaemonError> {
        let session = self
            .sessions
            .write()
            .await
            .remove(id)
            .ok_or_else(|| DaemonError::UnknownSession(id.to_owned()))?;
        session.shutdown().await;
        tracing::info!(session = %id, reason, "session ended");
        Ok(())
    }

    pub async fn end_all(&self) {
        let ids: Vec<String> = self.sessions.read().await.keys().cloned().collect();
        for id in ids {
            let _ = self.end(&id, "daemon shutting down").await;
        }
    }

    pub async fn summaries(&self) -> Vec<SessionSummary> {
        self.sessions
            .read()
            .await
            .values()
            .map(|session| SessionSummary {
                session_id: session.id().to_owned(),
                servers: session.server_names(),
                idle_secs: session.idle_for().as_secs(),
            })
            .collect()
    }

    pub fn spawn_idle_reaper(self: &Arc<Self>) -> JoinHandle<()> {
        let manager = Arc::clone(self);
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(REAP_INTERVAL);
            loop {
                tick.tick().await;
                manager.end_idle().await;
            }
        })
    }

    async fn end_idle(&self) {
        let timeout = self.config.idle_timeout();
        let idle: Vec<String> = self
            .sessions
            .read()
            .await
            .values()
            .filter(|session| session.idle_for() >= timeout)
            .map(|session| session.id().to_owned())
            .collect();
        for id in idle {
            let _ = self.end(&id, "idle timeout").await;
        }
    }
}
