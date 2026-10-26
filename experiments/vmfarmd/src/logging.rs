use std::path::Path;

use tracing_appender::{
    non_blocking::WorkerGuard,
    rolling::{RollingFileAppender, Rotation},
};
use tracing_subscriber::{EnvFilter, fmt, layer::SubscriberExt, util::SubscriberInitExt};

const KEEP_LOG_FILES: usize = 7;

/// Logs to stderr, and to a daily file in `log_dir` when set. Keep the guard alive to flush the file.
pub fn init(log_dir: Option<&Path>) -> anyhow::Result<Option<WorkerGuard>> {
    let filter = EnvFilter::try_from_env("VMFARMD_LOG").unwrap_or_else(|_| EnvFilter::new("info"));
    let stderr = fmt::layer().with_writer(std::io::stderr);
    let registry = tracing_subscriber::registry().with(filter).with(stderr);

    let Some(dir) = log_dir else {
        registry.init();
        return Ok(None);
    };
    let appender = RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .filename_prefix("vmfarmd")
        .filename_suffix("log")
        .max_log_files(KEEP_LOG_FILES)
        .build(dir)?;
    let (writer, guard) = tracing_appender::non_blocking(appender);
    registry
        .with(fmt::layer().with_ansi(false).with_writer(writer))
        .init();
    Ok(Some(guard))
}
