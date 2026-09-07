# Exposing the macOS VM tools to `browser_tool_selector`

Draft for the agent config and system prompt. The VM is reached through the `MacOS_VM`
server (cua-driver over SSH) — see `vm-native-input.md` for the setup.

## Confirm the namespace before applying

Existing entries use two prefixes: `playwright__` for the cloud toolkit and
`local_machine__` for tools coming from a testinator-connect installation. cua-driver's
names are generic (`click`, `scroll`, `type_text`), so **there is a real chance of
collision** — `local_machine__scroll` already exists from playwright-mcp.

Start the service, then read the `toolkit_configs` the deployment actually receives (or the
Dashboard's tool list) and confirm the exact namespaced names. If both toolkits land under
one prefix, the VM tools need a distinct toolbox id before this allowlist can be used;
otherwise `scroll` is ambiguous and the model will pick the wrong one.

Names below assume `vm__`. Substitute whatever the deployment reports.

## Allowlist

Native desktop path only. Deliberately excludes every `browser_*` tool: those attach to a
DevTools target, which reintroduces exactly the CDP fingerprint the VM exists to avoid.

```ruby
# add to the browser_tool_selector `tools:` array
"vm__get_desktop_state",
"vm__get_screen_size",
"vm__read_qr_code",
"vm__list_apps",
"vm__launch_app",
"vm__bring_to_front",
"vm__list_windows",
"vm__click",
"vm__double_click",
"vm__right_click",
"vm__move_cursor",
"vm__drag",
"vm__type_text",
"vm__press_key",
"vm__hotkey",
"vm__scroll",
"vm__invoke_menu",
"vm__start_recording",
"vm__stop_recording",
```

### Withheld, and why

| Tool | Reason |
|---|---|
| `browser_prepare`, `browser_navigate`, `browser_click`, `browser_type`, `browser_pointer`, `browser_dialog`, `get_browser_state`, `browser_set_input_files`, `browser_download` | Bind a DevTools target — the fingerprint we are avoiding |
| `kill_app`, `set_config`, `escalate_session`, `end_session` | Environment/lifecycle; belongs to the orchestrator, not the model |
| `set_value` | Writes straight into an accessibility element, bypassing the UI being tested |
| `clipboard_read`, `clipboard_write` | Data exfiltration surface with no testing benefit here |
| `replay_trajectory`, `install_ffmpeg`, `check_for_update` | Maintenance operations |
| `get_window_state` | Costs the most and buys the least. A Chrome window on a typical web app returns ~485 elements (~25 KB), none of them carrying bounds, so it cannot ground a click — and repeated calls are what overflowed the 1,048,576-token input limit. `get_desktop_state` plus `box_2d` covers the same need. If a check genuinely needs the tree, pass `max_elements` / `query` to bound it |
| `verify_state`, `get_accessibility_tree`, `zoom`, `page` | Add them if a check needs them; keeping the initial set small keeps tool choice reliable |

## System prompt section

`browser_tool_selector_system.txt` enumerates tools prescriptively, so a tool that is not
described there is effectively never selected. Add:

```
## Driving a real desktop browser in a VM

The `vm__*` tools control a real Chrome running inside a macOS virtual machine using
operating-system mouse and keyboard input. There is no debugger attached, so pages that
refuse to work under browser automation behave normally.

Use these ONLY when the check explicitly targets the VM, or when a page demonstrably
stalls under the ordinary `browser_*` tools despite the element being present and enabled.
They are slower and coordinate-based; prefer the accessibility-tree tools otherwise.

Working rules:
- `vm__get_desktop_state` first, every time, then locate the target in that screenshot.
- Every pointer tool — `vm__click`, `vm__double_click`, `vm__right_click`,
  `vm__move_cursor`, `vm__scroll`, `vm__drag` — takes a **`box_2d`** bounding box:
  `[ymin, xmin, ymax, xmax]` normalized 0-1000, Y first, the same convention as
  `browser_mouse_click_xy`. The tool converts to screen coordinates itself. `vm__drag`
  takes two, `start_box_2d` and `end_box_2d`.
- Normalize over the **full-screen** `get_desktop_state` screenshot. A `get_window_state`
  screenshot covers one window only, so a box measured on it lands in the wrong place.
- `vm__scroll` puts a real mouse wheel where you point it, so box the pane you want to
  move — that is the only way to scroll a nested `overflow:auto` region.
- For elements containing text, box the text region rather than the whole element.
- Re-capture with `vm__get_desktop_state` after anything that moves or resizes a window.
- There is no accessibility-tree step. The VM's tree carries no element bounds, so it cannot
  locate anything to click — work from the screenshot.
- A QR code on screen is read with `vm__read_qr_code`, never by eye: a model cannot decode
  one, and these codes are usually single-use, so a wrong guess is unrecoverable.
- `vm__type_text` handles shift for you, so `user_name@host.com` arrives intact.
- Never use the `vm__browser_*` tools. They attach a debugger and defeat the purpose of
  driving the VM at all.
```

## Coordinates

macOS in the VM always runs a 2x backing scale, whatever resolution lume is given — 2560x1600
yields a 1280x800 point desktop, 1920x1080 yields 960x540. No lume setting makes them match,
`max_image_dimension` does not affect the full-screen capture, and `get_accessibility_tree`
returns no element bounds to use instead.

Rather than ask the model to compensate, the `macos_vm` toolbox overrides every pointer tool
with a custom one that accepts Gemini's `box_2d` (`toolboxes/macos_vm/`, shared conversion in
`_grounding.py`). This mirrors what `playwright/browser_mouse_click_xy.py` already does.

Two things about cua-driver's coordinate contract are easy to get wrong, and both were
confirmed against the live VM rather than inferred:

**`x`/`y` are screenshot pixels, not points.** The driver halves them internally, so a box
must be denormalized against the *PNG's* dimensions:

```
move_cursor(x=2000, y=1200, scope="desktop")
  -> "Moved the real desktop pointer to (1000, 600)"   # then get_cursor_position: (1000, 600)
```

Denormalizing against `get_screen_size` instead puts every click at half its intended offset
from the top-left. `get_screen_size` also mislabels the scale (`1280x800 points @ 1x`), so it
cannot be used to recover the ratio either. Only `get_desktop_state` reports both spaces —
`desktop screenshot 2560x1600 px (screen 1280x800 pts @ 1x)` — and passing
`screenshot_out_file` makes it return that line *without* the 4 MB base64 image, which is how
the conversion gets its dimensions for ~0.2 s a call.

**`scope` defaults to `"window"`.** Full-screen coordinates need an explicit
`scope: "desktop"` and no `pid`/`window_id`; otherwise they are read as window-local.
`move_cursor` is the worst case — at window scope it moves only the agent's cursor *overlay*
and never the real pointer, so a hover silently does nothing.

Two tools can't take desktop coordinates at all: native `double_click` and `right_click`
require a `pid` and expose no `scope`. Both overrides route through `click` instead, which
does support desktop scope, using `count: 2` and `button: "right"`.
