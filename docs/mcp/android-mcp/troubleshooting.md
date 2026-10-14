# Android MCP: why `get_ui_tree` and similar tools time out

## Conclusion

The root cause is in the android MCP server. The app triggers it. The Agentic QA platform turns it into a flood of blocked checks.

| Party | Contribution to the problem | Is it a defect? | Who should fix it |
|---|---|---|---|
| **android MCP** | Finds elements only through `uiautomator dump`, which waits for the screen to go completely quiet. The shell command limit is 10 s. The server has no other way to get the element tree. | **Yes, the main one.** Proper automation tools (Appium / UiAutomator2) can skip the idle wait (`waitForIdleTimeout=0`). | The server's authors, or replace it with another Android MCP server |
| **App** | The test session timer fires an accessibility event every second, so the screen is never "quiet". | Not really: a live timer is normal functionality. But it makes the app hard to drive with any UiAutomator-based automation. | The app team, as an improvement: for example, don't fire the event every second in debug builds |
| **Agentic QA platform** | Stops a check after 3 errors from the same tool across the whole run (`_MAX_TOOL_FAILURES = 3` in the `execute_check_via_mcp` graph). The agent has access to tools that are guaranteed to fail on these screens. | **Yes.** Intermittent failures should not kill a check. | The platform: count consecutive errors in the runner; steer the agent towards `screenshot` + `tap(x, y)` through session setup or the prompt |

**What to do, by priority:**

1. **Right away, no code.** In the MCP session setup, untick `get_ui_tree`, `tap_element`, `tap_and_wait`, `scroll_to_element` and `wait_for_element`. The agent will work through `screenshot` and `tap(x, y)`, which don't need the element tree.
2. **Platform.** Count a tool's errors in a row, not across the whole run. This protects against any flaky MCP server, not just this one.
3. **android MCP** (or pick a different server). Get the element tree without waiting for the screen to go idle.
4. **App**, optional. A timer that doesn't fire an accessibility event every second.

The sections below explain the mechanism and the experiment that confirms it.

## Mechanism

The android MCP server tools `get_ui_tree`, `tap_element`, `tap_and_wait`, `scroll_to_element` and `wait_for_element` find elements through `uiautomator dump`. It is a standard Android command that saves the tree of all on-screen elements (text, ids, coordinates) to XML.

Before taking the snapshot, `uiautomator dump` waits for the screen to "settle": accessibility events must go quiet for about a second. If that never happens, after ~10 s the command gives up with `ERROR: could not get idle state.` and returns no tree.

In the app under test (`io.test.android.debug`), the test session countdown ("Remaining time mm:ss") updates every second, so the screen never settles. The MCP server kills the shell command at its own 10 s limit, before `uiautomator` gives up by itself. The agent sees:

```
Shell command timed out: uiautomator dump /sdcard/window_dump.xml
Shell command timed out: cat /sdcard/window_dump.xml
```

After the third such error from the same tool, the runner stops the run and the check ends up blocked. Most bug-related checks require a running test session as a precondition, so the agent keeps landing on screens with the timer.

## Emulator experiment

**Environment:**
- Android emulator on Apple Silicon, image `sdk_gphone16k_arm64` (16 KB page size), Android 17 / API 37;
- debug build of `io.test.android.debug`, version `11.20-alpha01`;
- a test tester account on staging.

**Method.** Don't touch anything on each screen. First count the frames rendered during 5 s of idle, then take `uiautomator dump` 3 times and `uiautomator dump --compressed` once.

```bash
P=io.test.android.debug
adb shell dumpsys gfxinfo $P reset >/dev/null; sleep 5
adb shell dumpsys gfxinfo $P | grep "Total frames rendered"
for i in 1 2 3; do time adb shell uiautomator dump /sdcard/x.xml; done
time adb shell uiautomator dump --compressed /sdcard/x.xml
```

If `adb` is not on your `PATH`, it lives in `$ANDROID_HOME/platform-tools/adb`.

### Results

| Screen (activity) | Frames in 5 s idle | `uiautomator dump` |
|---|---|---|
| Test screen **without a session** (`TestInvitationDetailsActivity`) | 0 | 2.3–2.8 s, dump OK ×4 |
| Same screen **with a running session**: the "Test Session — Remaining time" card is visible | **5** | **11.0–11.9 s, `could not get idle state` ×4, no tree** |
| Submit Bug form, empty (`BugSubmissionActivity`) | 0 | 2.3–2.5 s, OK |
| Submit Bug form, feature selected | 0 | 2.3 s, OK |
| Submit Bug form, "AI empowered submission" dialog open | 0 | 2.3 s, OK |
| Submit Bug form, title typed (keyboard open, cursor blinking) | 10 | 2.3–2.4 s, OK |
| Submit Bug form, **session clock opened** (bottom sheet with the countdown) | **5** | **11.4–12.0 s, `could not get idle state` ×4** |

### Traces

Test screen without a session:

```
activity: io.test.android.debug/io.test.android.invitations.test.TestInvitationDetailsActivity
frames in 5s idle: Total frames rendered: 0
uiautomator dump #1                rc=0        2.8s  UI hierchary dumped to: /sdcard/x.xml
uiautomator dump #2                rc=0        2.3s  UI hierchary dumped to: /sdcard/x.xml
uiautomator dump #3                rc=0        2.3s  UI hierchary dumped to: /sdcard/x.xml
dump --compressed                  rc=0        2.4s  UI hierchary dumped to: /sdcard/x.xml
UI tree: nodes 57, empty(text/id/desc) 9, clickable 12
```

Same screen with a running test session:

```
activity: io.test.android.debug/io.test.android.invitations.test.TestInvitationDetailsActivity
frames in 5s idle: Total frames rendered: 5
uiautomator dump #1                rc=0       11.3s  ERROR: could not get idle state.
uiautomator dump #2                rc=0       11.0s  ERROR: could not get idle state.
uiautomator dump #3                rc=0       11.9s  ERROR: could not get idle state.
dump --compressed                  rc=0       11.1s  ERROR: could not get idle state.
UI tree: nodes 0
```

Submit Bug form after typing a title (the cursor blinks, but the dump works):

```
activity: io.test.android.debug/io.test.android.submission.BugSubmissionActivity
frames in 5s idle: Total frames rendered: 10
uiautomator dump #1                rc=0        2.4s  UI hierchary dumped to: /sdcard/x.xml
uiautomator dump #2                rc=0        2.3s  UI hierchary dumped to: /sdcard/x.xml
uiautomator dump #3                rc=0        2.3s  UI hierchary dumped to: /sdcard/x.xml
dump --compressed                  rc=0        2.3s  UI hierchary dumped to: /sdcard/x.xml
UI tree: nodes 62, empty(text/id/desc) 15, clickable 19
```

Submit Bug form with the session clock open:

```
activity: io.test.android.debug/io.test.android.submission.BugSubmissionActivity
frames in 5s idle: Total frames rendered: 5
uiautomator dump #1                rc=0       11.4s  ERROR: could not get idle state.
uiautomator dump #2                rc=0       11.9s  ERROR: could not get idle state.
uiautomator dump #3                rc=0       12.0s  ERROR: could not get idle state.
dump --compressed                  rc=0       12.0s  ERROR: could not get idle state.
UI tree: nodes 0
```

### Takeaways

- Same screen, same activity — the only difference is the visible session timer. It causes one redraw per second, and the dump stops working.
- The blinking cursor produces even more frames (10 in 5 s), yet the dump works. `uiautomator` waits for quiet accessibility events, not for quiet frames. The timer fires a text-change event every second; the cursor does not.
- `--compressed` doesn't help.
- It is not emulator load: on neighbouring screens the dump consistently takes ~2.3 s.
- Disabling animations (`settings put global *_animation_scale 0`) doesn't help either: the timer is a text update, not an animation.
- The "AI empowered submission" dialog closes with a single tap on "Got It" (`primaryActionBtn`) and doesn't affect the dump.

### Getting the tree without waiting for idle

With the timer on screen, `dumpsys activity top` responds in ~0.1 s and returns around 300 Views with ids (`app:id/toolbarBack`, `app:id/extendTestSession`, …):

```
dumpsys activity top (timer on)    rc=0        0.1s
lines: 1161, lines with app:id/: 301
```

This shows the View tree is available without waiting for idle. But `dumpsys` doesn't return element text, and its coordinates are relative (to the parent), so it is not a full replacement for `uiautomator dump`. The proper fix on the MCP server side is UiAutomator2 / Appium with `waitForIdleTimeout=0`.

## How to reproduce

1. Start an emulator and install the app's debug build.
2. Log in with a test tester account and open an accepted test.
3. Run the commands from the "Method" section on the test screen without a session.
4. Start a test session (Start Session → Start Session) and run the commands again. You should get `ERROR: could not get idle state` after about 11 s.
5. Open Submit Bug, tap the clock icon in the header and repeat — same result.
