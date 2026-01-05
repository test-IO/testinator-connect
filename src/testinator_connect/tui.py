"""Textual TUI dashboard for testinator-connect."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING

from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical
from textual.reactive import reactive
from textual.widgets import DataTable, Footer, Header, RichLog, Static

if TYPE_CHECKING:
    pass


@dataclass
class LogEntry:
    """A log entry with optional session association."""
    timestamp: str
    markup: str
    session_id: str | None = None

# Global app reference for thread-safe updates from Socket.IO
_app: "ConnectApp | None" = None


def get_app() -> "ConnectApp | None":
    """Get the global TUI app instance."""
    return _app


def set_app(app: "ConnectApp | None") -> None:
    """Set the global TUI app instance."""
    global _app
    _app = app


class StatusWidget(Static):
    """Connection status indicator."""

    connected: reactive[bool] = reactive(False)
    server_url: reactive[str] = reactive("")

    def render(self) -> str:
        # Use workflow colors: green-500 for connected, red-500 for disconnected
        if self.connected:
            status = "[#22C55E]● Connected[/]"
        else:
            status = "[#EF4444]● Disconnected[/]"
        url = f"[#9CA3AF]{self.server_url}[/]" if self.server_url else ""
        return f"{status} {url}"


class SessionStats(Static):
    """Session statistics widget."""

    active_sessions: reactive[int] = reactive(0)
    total_tool_calls: reactive[int] = reactive(0)

    def render(self) -> str:
        # Use workflow cyan-500 for stats
        return (
            f"Sessions: [#06B6D4]{self.active_sessions}[/] | "
            f"Tool Calls: [#06B6D4]{self.total_tool_calls}[/]"
        )


class ConnectApp(App):
    """Textual TUI application for testinator-connect."""

    CSS = """
    /* Layout using theme variables */
    Screen {
        layout: grid;
        grid-size: 1 3;
        grid-rows: auto 1fr auto;
    }

    #top-bar {
        height: 3;
        background: $surface;
        border-bottom: solid $panel;
        padding: 0 1;
    }

    #status {
        width: 1fr;
    }

    #stats {
        width: auto;
        color: $text-muted;
    }

    #main-content {
        layout: grid;
        grid-size: 2 1;
        grid-columns: 1fr 2fr;
    }

    #sessions-panel {
        border: solid $panel;
        background: $surface;
        height: 100%;
    }

    #sessions-title {
        background: $panel;
        text-align: center;
        text-style: bold;
        height: 1;
    }

    #sessions-table {
        height: 100%;
    }

    #log-panel {
        border: solid $panel;
        background: $surface;
        height: 100%;
    }

    #log-title {
        background: $panel;
        text-align: center;
        text-style: bold;
        height: 1;
    }

    #log {
        height: 100%;
    }
    """

    BINDINGS = [
        Binding("q", "quit", "Quit"),
        Binding("c", "clear_log", "Clear Log"),
        Binding("r", "refresh_sessions", "Refresh"),
        Binding("escape", "clear_selection", "Clear Selection"),
        Binding("a", "show_all_logs", "All Logs"),
    ]

    TITLE = "AGENTIC QA"
    SUB_TITLE = "testinator-connect"

    # Reactive state
    sessions: reactive[dict[str, dict]] = reactive({}, always_update=True)
    tool_call_count: reactive[int] = reactive(0)
    selected_session_id: reactive[str | None] = reactive(None)

    # Log entries store (not reactive - managed manually)
    _log_entries: list[LogEntry]

    def __init__(self, server_url: str = "", config: dict | None = None, **kwargs):
        super().__init__(**kwargs)
        self._server_url = server_url
        self._config = config or {}
        self._log_entries = []
        self._connection_started = False

    def compose(self) -> ComposeResult:
        """Create child widgets."""
        yield Header()

        with Horizontal(id="top-bar"):
            yield StatusWidget(id="status")
            yield SessionStats(id="stats")

        with Horizontal(id="main-content"):
            with Vertical(id="sessions-panel"):
                yield Static("Sessions", id="sessions-title")
                yield DataTable(id="sessions-table")

            with Vertical(id="log-panel"):
                yield Static("Activity Log", id="log-title")
                yield RichLog(id="log", highlight=False, markup=True, wrap=True)

        yield Footer()

    def on_mount(self) -> None:
        """Initialize the app on mount."""
        # Use textual-light theme
        self.theme = "textual-light"

        # Set up sessions table
        table = self.query_one("#sessions-table", DataTable)
        table.add_columns("Session", "Server", "Status", "Calls")
        table.cursor_type = "row"

        # Set server URL in status
        status = self.query_one("#status", StatusWidget)
        status.server_url = self._server_url

        # Log startup message
        self.log_message("[dim]TUI dashboard started[/dim]")

        # Start connection if config provided (and not already started)
        if self._config and not self._connection_started:
            self._connection_started = True
            self._start_connection()

    def _start_connection(self) -> None:
        """Start the Socket.IO connection in a background thread."""
        import asyncio
        import threading
        from .sio import start_socket_connection, get_all_tools

        config = self._config

        def connect_worker():
            servers = config.get("servers", {})

            # Discover tools
            self.call_from_thread(self.log_message, "[dim]Discovering MCP tools...[/dim]", None)
            try:
                all_tools = asyncio.run(get_all_tools(servers))
            except Exception as e:
                self.call_from_thread(self.log_message, f"[red]Error discovering tools: {e}[/red]", None)
                all_tools = []

            total_tools = sum(len(s.get("tools", [])) for s in all_tools)
            self.call_from_thread(
                self.log_message,
                f"[green]v[/green] Found {total_tools} tools from {len(all_tools)} servers",
                None
            )

            # Connect to testinator-tooling
            self.call_from_thread(
                self.log_message,
                f"[dim]Connecting to {config['deployment_url']}...[/dim]",
                None
            )

            try:
                sio = start_socket_connection(config, all_tools)
                tui_set_connected(True)
            except Exception as e:
                self.call_from_thread(self.log_message, f"[red]x[/red] Failed to connect: {e}", None)
                tui_set_connected(False)

        thread = threading.Thread(target=connect_worker, daemon=True)
        thread.start()

    def log_message(self, markup: str, session_id: str | None = None) -> None:
        """Add a message to the log (thread-safe)."""
        timestamp = datetime.now().strftime("%H:%M:%S")

        # Store the entry
        entry = LogEntry(timestamp=timestamp, markup=markup, session_id=session_id)
        self._log_entries.append(entry)

        # Only display if matches current filter
        if self.selected_session_id is None or session_id == self.selected_session_id:
            log = self.query_one("#log", RichLog)
            log.write(f"[blue]{timestamp}[/] {markup}")

    def set_connected(self, connected: bool) -> None:
        """Update connection status (thread-safe)."""
        status = self.query_one("#status", StatusWidget)
        status.connected = connected

    def update_session(
        self, session_id: str, server: str, status: str = "active", calls: int = 0
    ) -> None:
        """Update or add a session in the table."""
        sessions = dict(self.sessions)
        sessions[session_id] = {
            "server": server,
            "status": status,
            "calls": calls,
        }
        self.sessions = sessions
        self._refresh_sessions_table()

    def remove_session(self, session_id: str) -> None:
        """Mark a session as ended (keep in table for log filtering)."""
        sessions = dict(self.sessions)
        if session_id in sessions:
            sessions[session_id]["status"] = "ended"
            self.sessions = sessions
            self._refresh_sessions_table()

    def increment_tool_calls(self, session_id: str | None = None) -> None:
        """Increment tool call counter."""
        self.tool_call_count += 1

        # Update session-specific counter if provided
        if session_id and session_id in self.sessions:
            sessions = dict(self.sessions)
            sessions[session_id]["calls"] = sessions[session_id].get("calls", 0) + 1
            self.sessions = sessions
            self._refresh_sessions_table()

        # Update stats widget
        stats = self.query_one("#stats", SessionStats)
        stats.total_tool_calls = self.tool_call_count

    def _refresh_sessions_table(self) -> None:
        """Refresh the sessions table from current state."""
        table = self.query_one("#sessions-table", DataTable)

        # Save cursor position before clearing
        saved_cursor_row = table.cursor_row

        table.clear()

        active_count = 0
        for session_id, data in self.sessions.items():
            short_id = session_id[:8] + "..."
            status = data["status"]
            if status == "active":
                # Green badge (green-900 bg, green-200 text) - matching workflow
                status_badge = "[#BBF7D0 on #14532D] active [/]"
                active_count += 1
            else:
                # Gray badge (gray-700 bg, gray-300 text) - matching workflow
                status_badge = "[#D1D5DB on #374151] ended [/]"
            table.add_row(
                short_id,
                data["server"],
                status_badge,
                str(data.get("calls", 0)),
            )

        # Restore cursor position (clamped to valid range)
        if table.row_count > 0 and saved_cursor_row >= 0:
            table.cursor_coordinate = (min(saved_cursor_row, table.row_count - 1), 0)

        # Update stats (only count active sessions)
        stats = self.query_one("#stats", SessionStats)
        stats.active_sessions = active_count

    def _refresh_log_display(self) -> None:
        """Refresh the log display based on current filter."""
        log = self.query_one("#log", RichLog)
        log.clear()

        # Update log title
        log_title = self.query_one("#log-title", Static)
        if self.selected_session_id:
            short_id = self.selected_session_id[:8]
            log_title.update(f"Activity Log [dim](session {short_id}...)[/dim]")
        else:
            log_title.update("Activity Log")

        # Display filtered entries
        for entry in self._log_entries:
            if self.selected_session_id is None or entry.session_id == self.selected_session_id:
                log.write(f"[blue]{entry.timestamp}[/] {entry.markup}")

    def on_data_table_row_selected(self, event: DataTable.RowSelected) -> None:
        """Handle session row selection."""
        if event.row_key is not None:
            # Get session_id from our sessions dict by row index
            session_ids = list(self.sessions.keys())
            row_index = event.cursor_row
            if 0 <= row_index < len(session_ids):
                self.selected_session_id = session_ids[row_index]
                self._refresh_log_display()
                self.log_message(
                    f"[dim]Filtering logs for session {self.selected_session_id[:8]}...[/dim]",
                    session_id=None  # System message, always show
                )

    def action_clear_selection(self) -> None:
        """Clear session selection and show all logs."""
        if self.selected_session_id:
            self.selected_session_id = None
            self._refresh_log_display()
            self.log_message("[dim]Showing all logs[/dim]")

    def action_show_all_logs(self) -> None:
        """Show all logs (alias for clear_selection)."""
        self.action_clear_selection()

    def action_clear_log(self) -> None:
        """Clear the log widget and stored entries."""
        self._log_entries.clear()
        log = self.query_one("#log", RichLog)
        log.clear()
        self.log_message("[dim]Log cleared[/dim]")

    def action_refresh_sessions(self) -> None:
        """Refresh sessions display."""
        self._refresh_sessions_table()
        self.log_message("[dim]Sessions refreshed[/dim]")


# Thread-safe logging functions for use from Socket.IO callbacks
# Colors match testinator-workflow Tailwind palette
def tui_log_info(message: str) -> None:
    """Log info message to TUI."""
    app = get_app()
    if app:
        # blue-600
        app.call_from_thread(app.log_message, f"[#2563EB]ℹ[/] {message}", None)


def tui_log_success(message: str) -> None:
    """Log success message to TUI."""
    app = get_app()
    if app:
        # green-500
        app.call_from_thread(app.log_message, f"[#22C55E]✓[/] {message}", None)


def tui_log_warning(message: str) -> None:
    """Log warning message to TUI."""
    app = get_app()
    if app:
        # amber-500
        app.call_from_thread(app.log_message, f"[#F59E0B]⚠[/] {message}", None)


def tui_log_error(message: str) -> None:
    """Log error message to TUI."""
    app = get_app()
    if app:
        # red-500
        app.call_from_thread(app.log_message, f"[#EF4444]✗[/] {message}", None)


def tui_log_tool_call(server: str, tool: str, extra: str = "", session_id: str | None = None) -> None:
    """Log tool call to TUI."""
    app = get_app()
    if app:
        # cyan-500 for tool calls
        extra_str = f" [#9CA3AF]({extra})[/]" if extra else ""
        markup = f"[#06B6D4]→[/] [bold]{server}[/bold].{tool}{extra_str}"

        app.call_from_thread(app.log_message, markup, session_id)
        app.call_from_thread(app.increment_tool_calls, session_id)


def tui_log_tool_ok(server: str, tool: str, result: str, session_id: str | None = None) -> None:
    """Log successful tool result to TUI."""
    app = get_app()
    if app:
        # green-500 for success
        short_result = result[:100] + "..." if len(result) > 100 else result
        markup = f"[#22C55E]✓[/] {server}.{tool} [#9CA3AF]→[/] {short_result}"
        app.call_from_thread(app.log_message, markup, session_id)


def tui_log_tool_error(server: str, tool: str, error: str, session_id: str | None = None) -> None:
    """Log tool error to TUI."""
    app = get_app()
    if app:
        # red-500 for errors
        markup = f"[#EF4444]✗[/] {server}.{tool} [#9CA3AF]→[/] [#EF4444]{error}[/]"
        app.call_from_thread(app.log_message, markup, session_id)


def tui_log_session(action: str, server: str, extra: str = "", session_id: str | None = None) -> None:
    """Log session event to TUI."""
    app = get_app()
    if app:
        # purple-500 for session events
        extra_str = f" [#9CA3AF]({extra})[/]" if extra else ""
        markup = f"[#A855F7]●[/] [#9CA3AF]{action}[/] [bold]{server}[/bold]{extra_str}"
        app.call_from_thread(app.log_message, markup, session_id)


def tui_log_session_error(message: str, session_id: str | None = None) -> None:
    """Log session error to TUI."""
    app = get_app()
    if app:
        # red-500 for session errors
        app.call_from_thread(app.log_message, f"[#EF4444]●[/] [#EF4444]{message}[/]", session_id)


def tui_set_connected(connected: bool) -> None:
    """Update connection status in TUI."""
    app = get_app()
    if app:
        app.call_from_thread(app.set_connected, connected)


def tui_update_session(
    session_id: str, server: str, status: str = "active", calls: int = 0
) -> None:
    """Update session in TUI."""
    app = get_app()
    if app:
        app.call_from_thread(app.update_session, session_id, server, status, calls)


def tui_remove_session(session_id: str) -> None:
    """Remove session from TUI."""
    app = get_app()
    if app:
        app.call_from_thread(app.remove_session, session_id)
