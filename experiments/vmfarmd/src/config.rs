use std::{
    collections::BTreeMap,
    net::SocketAddr,
    path::{Path, PathBuf},
    time::Duration,
};

use anyhow::{Context, bail};
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    #[serde(default = "default_listen")]
    pub listen: SocketAddr,
    #[serde(default = "default_idle_timeout_secs")]
    pub idle_timeout_secs: u64,
    #[serde(default = "default_call_timeout_secs")]
    pub call_timeout_secs: u64,
    #[serde(default = "default_startup_timeout_secs")]
    pub startup_timeout_secs: u64,
    pub log_dir: Option<PathBuf>,
    pub servers: BTreeMap<String, ServerSpec>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ServerSpec {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    pub cwd: Option<PathBuf>,
    /// Started for sessions that don't name their servers.
    #[serde(default = "default_true")]
    pub default: bool,
}

impl Config {
    pub fn load(path: &Path) -> anyhow::Result<Self> {
        let text = std::fs::read_to_string(path)
            .with_context(|| format!("reading config {}", path.display()))?;
        let config: Config =
            toml::from_str(&text).with_context(|| format!("parsing config {}", path.display()))?;
        config.validate()?;
        Ok(config)
    }

    fn validate(&self) -> anyhow::Result<()> {
        if self.servers.is_empty() {
            bail!("config needs at least one [servers.<name>] entry");
        }
        if !self.servers.values().any(|spec| spec.default) {
            bail!("at least one server must have default = true");
        }
        Ok(())
    }

    pub fn idle_timeout(&self) -> Duration {
        Duration::from_secs(self.idle_timeout_secs)
    }

    pub fn call_timeout(&self) -> Duration {
        Duration::from_secs(self.call_timeout_secs)
    }

    pub fn startup_timeout(&self) -> Duration {
        Duration::from_secs(self.startup_timeout_secs)
    }

    pub fn default_servers(&self) -> Vec<String> {
        self.servers
            .iter()
            .filter(|(_, spec)| spec.default)
            .map(|(name, _)| name.clone())
            .collect()
    }
}

pub fn default_path() -> PathBuf {
    if cfg!(windows) {
        PathBuf::from(r"C:\ProgramData\VmFarmDaemon\vmfarmd.toml")
    } else {
        PathBuf::from("vmfarmd.toml")
    }
}

fn default_listen() -> SocketAddr {
    SocketAddr::from(([127, 0, 0, 1], 7410))
}

fn default_idle_timeout_secs() -> u64 {
    1800
}

fn default_call_timeout_secs() -> u64 {
    120
}

fn default_startup_timeout_secs() -> u64 {
    60
}

fn default_true() -> bool {
    true
}
