"""Session manager for persistent MCP connections.

Supports session-based browser isolation: each tooling session gets
its own dedicated browser subprocess.
"""

import asyncio
import atexit
import threading
import warnings
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.sse import sse_client
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import streamablehttp_client

from .config import load_config
from .console import log_session, log_session_error


class SessionManager:
    """Manages persistent MCP sessions for stateful servers.

    Supports two modes:
    1. Legacy mode (server-keyed): One session per server name
    2. Session-isolated mode (session-keyed): Each tooling session gets
       its own browser subprocess for complete isolation
    """

    def __init__(self):
        # Primary structure for session-isolated browsers
        # Key: session_id (UUID from tooling)
        # Value: {server_name: (transport_ctx, session_ctx, ClientSession)}
        self._sessions: dict[str, dict[str, tuple[Any, Any, ClientSession]]] = {}

        # Legacy structure for backward compatibility (single session per server)
        self._legacy_sessions: dict[str, tuple[Any, Any, ClientSession]] = {}

        self._lock = threading.Lock()
        self._event_loop: asyncio.AbstractEventLoop | None = None
        self._loop_thread: threading.Thread | None = None
        self._loop_running = threading.Event()
        # Register cleanup on exit
        atexit.register(self.cleanup_all)

    def _ensure_event_loop(self):
        """Ensure we have a dedicated event loop running in a separate thread."""
        with self._lock:
            if self._event_loop is None or self._event_loop.is_closed():
                if self._loop_thread is not None and self._loop_thread.is_alive():
                    return

                self._loop_running.clear()

                def run_loop():
                    self._event_loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(self._event_loop)
                    self._loop_running.set()
                    try:
                        self._event_loop.run_forever()
                    finally:
                        self._event_loop.close()

                self._loop_thread = threading.Thread(target=run_loop, daemon=True)
                self._loop_thread.start()

                # Wait for loop to be ready
                self._loop_running.wait(timeout=5.0)

    def _run_in_loop(self, coro):
        """Run a coroutine in the managed event loop."""
        self._ensure_event_loop()
        if self._event_loop is None:
            raise RuntimeError("Event loop not available")

        config = load_config()
        future = asyncio.run_coroutine_threadsafe(coro, self._event_loop)
        return future.result(timeout=config["timeout"])

    def get_session_sync(self, server_name: str, server_conf: dict) -> ClientSession:
        """Synchronous wrapper for get_session (legacy mode)."""
        return self._run_in_loop(self.get_session(server_name, server_conf))

    def cleanup_session_sync(self, server_name: str):
        """Synchronous wrapper for cleanup_session (legacy mode)."""
        return self._run_in_loop(self.cleanup_session(server_name))

    def call_tool_with_recovery_sync(
        self,
        server_name: str,
        server_conf: dict,
        params: dict,
        session_id: str | None = None,
    ) -> str | list[str]:
        """Synchronous wrapper for call_tool_with_recovery."""
        return self._run_in_loop(
            self.call_tool_with_recovery(server_name, server_conf, params, session_id)
        )

    # ========== Session-isolated mode methods ==========

    def create_session_instance_sync(
        self, session_id: str, server_name: str, server_conf: dict
    ) -> bool:
        """Synchronous wrapper for create_session_instance."""
        try:
            self._run_in_loop(
                self.create_session_instance(session_id, server_name, server_conf)
            )
            return True
        except Exception as e:
            log_session_error(f"Sync create failed: {e}")
            raise

    def destroy_session_instance_sync(self, session_id: str) -> bool:
        """Synchronous wrapper for destroy_session_instance."""
        try:
            self._run_in_loop(self.destroy_session_instance(session_id))
            return True
        except Exception as e:
            log_session_error(f"Sync destroy failed: {e}")
            return False

    async def get_session(
        self, server_name: str, server_conf: dict
    ) -> ClientSession:
        """Get or create a session for the given server (legacy mode)."""
        with self._lock:
            if server_name in self._legacy_sessions:
                # Return existing session
                _, _, session = self._legacy_sessions[server_name]
                log_session("reusing", server_name)
                return session

            # Create new session
            try:
                if server_conf.get("type", "stdio").lower() == "stdio":
                    server_parameters = StdioServerParameters(**server_conf)
                    stdio_ctx = stdio_client(server_parameters)
                    read, write = await stdio_ctx.__aenter__()

                    session_ctx = ClientSession(read, write)
                    session = await session_ctx.__aenter__()
                    await session.initialize()

                    # Store the context managers and session
                    self._legacy_sessions[server_name] = (stdio_ctx, session_ctx, session)
                    log_session("created", server_name, "stdio")

                elif server_conf["type"].lower() == "http":
                    http_ctx = streamablehttp_client(
                        server_conf["url"], server_conf.get("headers", {})
                    )
                    read_stream, write_stream, _ = await http_ctx.__aenter__()

                    session_ctx = ClientSession(read_stream, write_stream)
                    session = await session_ctx.__aenter__()
                    await session.initialize()

                    # Store the context managers and session
                    self._legacy_sessions[server_name] = (http_ctx, session_ctx, session)
                    log_session("created", server_name, "http")

                elif server_conf["type"].lower() == "sse":
                    sse_ctx = sse_client(
                        server_conf["url"], server_conf.get("headers", {})
                    )
                    streams = await sse_ctx.__aenter__()

                    session_ctx = ClientSession(*streams)
                    session = await session_ctx.__aenter__()
                    await session.initialize()

                    # Store the context managers and session
                    self._legacy_sessions[server_name] = (sse_ctx, session_ctx, session)
                    log_session("created", server_name, "sse")
                else:
                    raise ValueError(f"Unsupported server type: {server_conf['type']}")

                return self._legacy_sessions[server_name][2]
            except Exception as e:
                log_session_error(f"Failed to create {server_name}: {e}")
                # Clean up any partial state
                if server_name in self._legacy_sessions:
                    del self._legacy_sessions[server_name]
                raise

    async def cleanup_session(self, server_name: str):
        """Clean up a specific session (legacy mode)."""
        with self._lock:
            if server_name in self._legacy_sessions:
                ctx1, ctx2, session = self._legacy_sessions[server_name]

                try:
                    # Clean up session context
                    if hasattr(ctx2, "__aexit__"):
                        await ctx2.__aexit__(None, None, None)

                    # Clean up stdio/sse context
                    if hasattr(ctx1, "__aexit__"):
                        await ctx1.__aexit__(None, None, None)

                    log_session("closed", server_name)
                except Exception as e:
                    log_session_error(f"Cleanup failed for {server_name}: {e}")

                del self._legacy_sessions[server_name]

    def cleanup_all(self):
        """Clean up all sessions (synchronous for atexit)."""
        with self._lock:
            session_ids = list(self._sessions.keys())
            legacy_count = len(self._legacy_sessions)

        if not session_ids and not legacy_count:
            return

        total = len(session_ids) + legacy_count
        log_session("cleanup", f"all sessions ({total})")

        # Suppress asyncio warnings about closed loops during cleanup
        warnings.filterwarnings("ignore", message=".*Loop.*closed.*")

        try:
            # Use our dedicated event loop for cleanup
            if self._event_loop and not self._event_loop.is_closed():
                try:
                    # Run cleanup in our dedicated event loop
                    future = asyncio.run_coroutine_threadsafe(
                        self._cleanup_all_async(), self._event_loop
                    )
                    future.result(timeout=30.0)  # 30 second timeout for cleanup
                except Exception as e:
                    log_session_error(f"Async cleanup: {e}")

                # Stop the event loop
                try:
                    self._event_loop.call_soon_threadsafe(self._event_loop.stop)
                    if self._loop_thread and self._loop_thread.is_alive():
                        self._loop_thread.join(timeout=5.0)
                except Exception:
                    pass  # Ignore errors stopping the loop
            else:
                # Fallback: create temporary event loop for cleanup
                try:
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)
                    loop.run_until_complete(self._cleanup_all_async())
                    loop.close()
                except Exception as e:
                    log_session_error(f"Fallback cleanup: {e}")
        except Exception as e:
            log_session_error(f"Cleanup: {e}")
        finally:
            with self._lock:
                self._sessions.clear()
                self._legacy_sessions.clear()

    async def _cleanup_all_async(self):
        """Async version of cleanup_all."""
        tasks = []

        # Clean up session-isolated instances
        with self._lock:
            session_ids = list(self._sessions.keys())

        for session_id in session_ids:
            tasks.append(self.destroy_session_instance(session_id))

        # Clean up legacy sessions
        with self._lock:
            server_names = list(self._legacy_sessions.keys())

        for server_name in server_names:
            tasks.append(self.cleanup_session(server_name))

        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    def is_stateful(self, server_conf: dict) -> bool:
        """Check if a server is configured for stateful operation."""
        return server_conf.get("stateful", False)

    def list_active_sessions(self) -> dict[str, str]:
        """List all active legacy sessions with their server types."""
        return {
            name: "stdio" if hasattr(data[0], "command") else "sse"
            for name, data in self._legacy_sessions.items()
        }

    async def reset_session(
        self, server_name: str, server_conf: dict
    ) -> ClientSession | None:
        """Reset a specific session by closing and recreating it (legacy mode)."""
        await self.cleanup_session(server_name)
        return await self.get_session(server_name, server_conf)

    async def call_tool_with_recovery(
        self,
        server_name: str,
        server_conf: dict,
        params: dict,
        session_id: str | None = None,
    ) -> str | list[str]:
        """Call a tool with automatic session recovery on failure.

        Args:
            server_name: Name of the MCP server
            server_conf: Server configuration
            params: Tool call parameters (name, arguments)
            session_id: If provided, uses session-isolated mode; otherwise legacy mode
        """
        max_retries = 2

        if session_id:
            # Session-isolated mode
            return await self._call_tool_session_isolated(
                session_id, server_name, server_conf, params, max_retries
            )
        else:
            # Legacy mode
            return await self._call_tool_legacy(
                server_name, server_conf, params, max_retries
            )

    async def _call_tool_legacy(
        self, server_name: str, server_conf: dict, params: dict, max_retries: int
    ) -> str | list[str]:
        """Legacy mode tool call with recovery."""
        for attempt in range(max_retries):
            try:
                session = await self.get_session(server_name, server_conf)
                tool_result = await session.call_tool(
                    params["name"], params["arguments"]
                )
                return self._serialize_tool_result(tool_result.content)
            except Exception as e:
                log_session_error(f"Tool call attempt {attempt + 1}: {e}")
                if attempt < max_retries - 1:
                    log_session("recreating", server_name)
                    await self.cleanup_session(server_name)
                else:
                    raise

    async def _call_tool_session_isolated(
        self,
        session_id: str,
        server_name: str,
        server_conf: dict,
        params: dict,
        max_retries: int,
    ) -> str | list[str]:
        """Session-isolated mode tool call with recovery."""
        for attempt in range(max_retries):
            try:
                session = await self.get_session_instance(session_id, server_name)
                if session is None:
                    raise RuntimeError(f"Session {session_id}/{server_name} not found")

                tool_result = await session.call_tool(
                    params["name"], params["arguments"]
                )
                return self._serialize_tool_result(tool_result.content)
            except Exception as e:
                log_session_error(f"Tool call attempt {attempt + 1}: {e}")
                if attempt < max_retries - 1:
                    log_session("recreating", f"{session_id}/{server_name}")
                    await self._cleanup_session_server(session_id, server_name)
                    await self.create_session_instance(
                        session_id, server_name, server_conf
                    )
                else:
                    raise

    def _serialize_tool_result(self, content: list) -> str | list[str]:
        """Serialize tool result content items."""
        result = []
        for item in content:
            if hasattr(item, "text"):
                result.append(item.text)
            elif hasattr(item, "data"):
                result.append(item.data)
            else:
                result.append(str(item))
        return result if len(result) > 1 else result[0] if result else ""

    # ========== Session-isolated mode async methods ==========

    async def create_session_instance(
        self, session_id: str, server_name: str, server_conf: dict
    ) -> ClientSession:
        """
        Create a new MCP session instance for a specific tooling session.

        Spawns a new browser subprocess dedicated to this session.

        Args:
            session_id: Tooling session identifier (UUID string)
            server_name: Name of the MCP server (e.g., "Playwright_MCP")
            server_conf: Server configuration from config.json

        Returns:
            ClientSession for the newly spawned browser instance

        Raises:
            Exception: If subprocess spawn fails
        """
        with self._lock:
            # Initialize session dict if needed
            if session_id not in self._sessions:
                self._sessions[session_id] = {}

            # Check if this server already exists for this session
            if server_name in self._sessions[session_id]:
                log_session("reusing", f"{session_id[:8]}.../{server_name}")
                _, _, session = self._sessions[session_id][server_name]
                return session

        # Create new MCP subprocess (outside lock for async operations)
        try:
            server_type = server_conf.get("type", "stdio").lower()

            if server_type == "stdio":
                server_parameters = StdioServerParameters(**server_conf)
                stdio_ctx = stdio_client(server_parameters)
                read, write = await stdio_ctx.__aenter__()

                session_ctx = ClientSession(read, write)
                session = await session_ctx.__aenter__()
                await session.initialize()

                with self._lock:
                    self._sessions[session_id][server_name] = (
                        stdio_ctx,
                        session_ctx,
                        session,
                    )
                log_session("created", f"{session_id[:8]}.../{server_name}", "stdio")

            elif server_type == "http":
                http_ctx = streamablehttp_client(
                    server_conf["url"], server_conf.get("headers", {})
                )
                read_stream, write_stream, _ = await http_ctx.__aenter__()

                session_ctx = ClientSession(read_stream, write_stream)
                session = await session_ctx.__aenter__()
                await session.initialize()

                with self._lock:
                    self._sessions[session_id][server_name] = (
                        http_ctx,
                        session_ctx,
                        session,
                    )
                log_session("created", f"{session_id[:8]}.../{server_name}", "http")

            elif server_type == "sse":
                sse_ctx = sse_client(
                    server_conf["url"], server_conf.get("headers", {})
                )
                streams = await sse_ctx.__aenter__()

                session_ctx = ClientSession(*streams)
                session = await session_ctx.__aenter__()
                await session.initialize()

                with self._lock:
                    self._sessions[session_id][server_name] = (
                        sse_ctx,
                        session_ctx,
                        session,
                    )
                log_session("created", f"{session_id[:8]}.../{server_name}", "sse")
            else:
                raise ValueError(f"Unsupported server type: {server_type}")

            with self._lock:
                return self._sessions[session_id][server_name][2]

        except Exception as e:
            log_session_error(f"Failed to create {session_id[:8]}.../{server_name}: {e}")
            # Clean up partial state
            with self._lock:
                if session_id in self._sessions and server_name in self._sessions[session_id]:
                    del self._sessions[session_id][server_name]
                if session_id in self._sessions and not self._sessions[session_id]:
                    del self._sessions[session_id]
            raise

    async def destroy_session_instance(self, session_id: str) -> None:
        """
        Destroy all MCP sessions for a given session ID.

        Cleans up all browser subprocesses associated with this tooling session.

        Args:
            session_id: Tooling session identifier to clean up
        """
        with self._lock:
            if session_id not in self._sessions:
                return
            servers_to_cleanup = list(self._sessions[session_id].keys())

        # Clean up each server outside the lock (async operations)
        for server_name in servers_to_cleanup:
            try:
                await self._cleanup_session_server(session_id, server_name)
            except Exception as e:
                log_session_error(
                    f"Cleanup failed for {session_id[:8]}.../{server_name}: {e}"
                )

        # Remove the session entry
        with self._lock:
            if session_id in self._sessions:
                del self._sessions[session_id]

        log_session("destroyed", f"{session_id[:8]}...")

    async def _cleanup_session_server(self, session_id: str, server_name: str) -> None:
        """Clean up a specific server within a session."""
        with self._lock:
            if session_id not in self._sessions:
                return
            if server_name not in self._sessions[session_id]:
                return
            ctx1, ctx2, session = self._sessions[session_id][server_name]

        try:
            # Clean up session context
            if hasattr(ctx2, "__aexit__"):
                await ctx2.__aexit__(None, None, None)

            # Clean up transport context (kills subprocess)
            if hasattr(ctx1, "__aexit__"):
                await ctx1.__aexit__(None, None, None)

            log_session("closed", f"{session_id[:8]}.../{server_name}")
        except Exception as e:
            log_session_error(
                f"Cleanup error {session_id[:8]}.../{server_name}: {e}"
            )

        with self._lock:
            if (
                session_id in self._sessions
                and server_name in self._sessions[session_id]
            ):
                del self._sessions[session_id][server_name]

    async def get_session_instance(
        self, session_id: str, server_name: str
    ) -> ClientSession | None:
        """
        Get an existing session instance.

        Args:
            session_id: Tooling session identifier
            server_name: Name of the MCP server

        Returns:
            ClientSession if exists, None otherwise
        """
        with self._lock:
            if (
                session_id in self._sessions
                and server_name in self._sessions[session_id]
            ):
                return self._sessions[session_id][server_name][2]
            return None

    def has_session(self, session_id: str) -> bool:
        """Check if a session exists."""
        with self._lock:
            return session_id in self._sessions

    def list_sessions(self) -> dict[str, list[str]]:
        """
        List all active sessions with their server names.

        Returns:
            Dict mapping session_id to list of server names
        """
        with self._lock:
            return {
                session_id: list(servers.keys())
                for session_id, servers in self._sessions.items()
            }


# Global session manager instance
_session_manager: SessionManager | None = None


def get_session_manager() -> SessionManager:
    """Get the global session manager instance."""
    global _session_manager
    if _session_manager is None:
        _session_manager = SessionManager()
    return _session_manager
