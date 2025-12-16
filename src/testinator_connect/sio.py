"""Socket.IO connection handler for testinator-tooling."""

import asyncio
import os
import threading
from typing import Any, Callable, Iterable

import socketio
from mcp import ClientSession, StdioServerParameters
from mcp.client.sse import sse_client
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import streamablehttp_client

from .session_manager import get_session_manager


def _sanitize_server_tools(all_tools: Any) -> list[dict[str, Any]]:
    """
    Normalize and sanitize server/tool definitions into a predictable structure.

    Expected input shape:
        [
            {
                "name": <str>,
                "tools": [
                    {
                        "name": <str>,
                        "description": <str>,
                        "inputSchema": {
                            "type": <str>,
                            "properties": <dict>,
                            "required": <list>
                        }
                    },
                    ...
                ]
            },
            ...
        ]

    Returns a list of sanitized servers with guaranteed keys and safe defaults.
    """
    sanitized_servers: list[dict[str, Any]] = []

    # Ensure we have an iterable of servers
    if not isinstance(all_tools, Iterable) or isinstance(all_tools, (str, bytes)):
        all_tools = []

    for server in all_tools:
        # Skip invalid server objects
        if not isinstance(server, dict):
            continue

        sanitized_server: dict[str, Any] = {
            "name": server.get("name", "") or "",
            "tools": [],
        }

        tools = server.get("tools") or []
        if not isinstance(tools, Iterable) or isinstance(tools, (str, bytes)):
            tools = []

        for tool in tools:
            # Skip invalid tool objects
            if not isinstance(tool, dict):
                continue

            raw_input_schema = tool.get("inputSchema") or {}
            if not isinstance(raw_input_schema, dict):
                raw_input_schema = {}

            properties = raw_input_schema.get("properties") or {}
            if not isinstance(properties, dict):
                properties = {}

            required = raw_input_schema.get("required") or []
            if not isinstance(required, list):
                required = [required]

            input_schema = {
                "type": raw_input_schema.get("type", "object") or "object",
                "properties": properties,
                "required": required,
            }

            sanitized_tool = {
                "name": tool.get("name", "") or "",
                "description": tool.get("description", "") or "",
                "inputSchema": input_schema,
            }
            sanitized_server["tools"].append(sanitized_tool)

        sanitized_servers.append(sanitized_server)

    return sanitized_servers


def start_socket_connection(
    config: dict,
    all_tools: list[dict],
    notify_on_connect: Callable[[str], None] | None = None,
    notify_on_disconnect: Callable[[str], None] | None = None,
) -> socketio.Client:
    """
    Start a Socket.IO connection to testinator-tooling.

    Args:
        config: Configuration dictionary with deployment_url, auth_token, etc.
        all_tools: List of server/tool definitions
        notify_on_connect: Optional callback when connected
        notify_on_disconnect: Optional callback when disconnected

    Returns:
        The connected Socket.IO client
    """
    common_timeout = 90

    # Check if SSL verification should be disabled
    env_ssl_setting = os.environ.get("TESTINATOR_DISABLE_SSL_VERIFY", "").lower()
    if env_ssl_setting in ("true", "false"):
        disable_ssl_verify = env_ssl_setting == "true"
    else:
        disable_ssl_verify = not config.get("ssl_verify", False)

    if disable_ssl_verify:
        sio = socketio.Client(
            ssl_verify=False,
            logger=False,
            engineio_logger=False,
            reconnection=True,
            reconnection_attempts=5,
            reconnection_delay=1,
            reconnection_delay_max=5,
        )
        print("SSL verification disabled for Socket.IO connection")
    else:
        sio = socketio.Client(
            logger=False,
            engineio_logger=False,
            reconnection=True,
            reconnection_attempts=5,
            reconnection_delay=1,
            reconnection_delay_max=5,
        )
        print("SSL verification enabled for Socket.IO connection")

    @sio.event
    def connect():
        sio.emit(
            "mcp_connect",
            {
                "project_id": config.get("project_id", 0),
                "toolkit_configs": _sanitize_server_tools(all_tools),
                "timeout_tools_list": common_timeout,
                "timeout_tools_call": common_timeout,
            },
        )
        print("Connected to testinator-tooling")
        if notify_on_connect:
            notify_on_connect("Connected to testinator-tooling")

    @sio.event
    def disconnect():
        print("Disconnected from testinator-tooling")
        if notify_on_disconnect:
            notify_on_disconnect("Disconnected from testinator-tooling")
        # Clean up persistent sessions when disconnecting
        session_manager = get_session_manager()
        try:
            session_manager.cleanup_all()
            print("Cleaned up persistent sessions")
        except Exception as e:
            print(f"Error during session cleanup: {e}")

    @sio.event
    def on_mcp_tools_list(data):
        all_tools_refreshed = asyncio.run(get_all_tools(config.get("servers", {})))
        return {
            "project_id": config.get("project_id", 0),
            "toolkit_configs": _sanitize_server_tools(all_tools_refreshed),
            "timeout_tools_list": common_timeout,
            "timeout_tools_call": common_timeout,
        }

    @sio.event
    def on_mcp_tools_call(data):
        if "server" in data:
            servers = config.get("servers", {})
            server_conf = servers.get(data["server"], {})
            tool_result = _mcp_tools_call_sync(
                server_conf, data["params"], server_name=data["server"]
            )
            return tool_result

    @sio.event
    def on_mcp_notification(notification):
        print(f"Platform Notification: {notification}")

    @sio.event
    def on_mcp_ping(data):
        return True

    try:
        sio.connect(
            config["deployment_url"],
            headers={"Authorization": f"Bearer {config.get('auth_token', '')}"},
            wait_timeout=30,
            retry=True,
        )
    except Exception as e:
        print(f"Failed to connect to testinator-tooling: {e}")
        print("Please check your network connection and try again.")
        raise

    sio.on("mcp_tools_list", on_mcp_tools_list)
    sio.on("mcp_tools_call", on_mcp_tools_call)
    sio.on("mcp_notification", on_mcp_notification)
    sio.on("mcp_ping", on_mcp_ping)

    def socketio_background_task():
        sio.wait()

    socketio_thread = threading.Thread(target=socketio_background_task, daemon=True)
    socketio_thread.start()

    return sio


def _mcp_tools_call_sync(
    server_conf: dict, params: dict, server_name: str | None = None
) -> str | list[str]:
    """Synchronous wrapper for MCP tool calls."""
    session_manager = get_session_manager()

    # Check if this server should use stateful sessions
    if session_manager.is_stateful(server_conf) and server_name:
        try:
            result = session_manager.call_tool_with_recovery_sync(
                server_name, server_conf, params
            )
            return result
        except Exception as e:
            print(f"Failed to call tool with stateful session: {e}")
            print("Falling back to stateless session...")

    # Use stateless session (original behavior) via async wrapper
    async def _stateless_call():
        return await _mcp_tools_call(server_conf, params, server_name)

    return session_manager._run_in_loop(_stateless_call())


async def get_all_tools(servers: dict) -> list[dict[str, Any]]:
    """
    Discover all tools from configured MCP servers.

    Args:
        servers: Dictionary of server configurations

    Returns:
        List of server/tool definitions
    """
    if not servers:
        return []

    tasks = [
        _process_server(server_name, server_conf)
        for server_name, server_conf in servers.items()
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    # Filter out exceptions and ensure required field is present
    valid_results = []
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            server_name = list(servers.keys())[i]
            print(f"Error processing server {server_name}: {result}")
            continue
        # Ensure required field exists in inputSchema
        for tool in result.get("tools", []):
            input_schema = tool.get("inputSchema")
            if input_schema is not None and "required" not in input_schema:
                input_schema["required"] = []
        valid_results.append(result)

    return valid_results


async def _process_server(server_name: str, server_conf: dict) -> dict[str, Any]:
    """Connect to an MCP server and discover its tools."""
    server_type = server_conf.get("type", "stdio").lower()

    if server_type == "stdio":
        server_parameters = StdioServerParameters(**server_conf)
        async with stdio_client(server_parameters) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                tools_response = await session.list_tools()
                return {
                    "name": server_name,
                    "tools": [tool.model_dump() for tool in tools_response.tools],
                }

    elif server_type == "http":
        async with streamablehttp_client(
            server_conf["url"], server_conf.get("headers", {})
        ) as (read_stream, write_stream, _):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                tools_response = await session.list_tools()
                return {
                    "name": server_name,
                    "tools": [tool.model_dump() for tool in tools_response.tools],
                }

    elif server_type == "sse":
        async with sse_client(
            server_conf["url"], server_conf.get("headers", {})
        ) as streams:
            async with ClientSession(*streams) as session:
                await session.initialize()
                tools_response = await session.list_tools()
                return {
                    "name": server_name,
                    "tools": [tool.model_dump() for tool in tools_response.tools],
                }

    else:
        raise ValueError(f"Unsupported server type: {server_type}")


async def _mcp_tools_call(
    server_conf: dict, params: dict, server_name: str | None = None
) -> str | list[str]:
    """Async function for stateless MCP tool calls."""
    server_type = server_conf.get("type", "stdio").lower()

    if server_type == "stdio":
        server_parameters = StdioServerParameters(**server_conf)
        async with stdio_client(server_parameters) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                tool_result = await session.call_tool(
                    params["name"], params["arguments"]
                )
                return _serialize_tool_result(tool_result.content)

    elif server_type == "http":
        async with streamablehttp_client(
            server_conf["url"], server_conf.get("headers", {})
        ) as (read_stream, write_stream, _):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                tool_result = await session.call_tool(
                    params["name"], params["arguments"]
                )
                return _serialize_tool_result(tool_result.content)

    elif server_type == "sse":
        async with sse_client(
            server_conf["url"], server_conf.get("headers", {})
        ) as streams:
            async with ClientSession(*streams) as session:
                await session.initialize()
                tool_result = await session.call_tool(
                    params["name"], params["arguments"]
                )
                return _serialize_tool_result(tool_result.content)

    else:
        raise ValueError(f"Unsupported server type: {server_type}")


def _serialize_tool_result(content: list) -> str | list[str]:
    """
    Serialize tool result content items.

    Handles both text content and binary data (like images).
    Returns all content items, not just the first one.
    """
    result = []
    for item in content:
        if hasattr(item, "text"):
            result.append(item.text)
        elif hasattr(item, "data"):
            result.append(item.data)
        else:
            result.append(str(item))
    return result if len(result) > 1 else result[0] if result else ""
