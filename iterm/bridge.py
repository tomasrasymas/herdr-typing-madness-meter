"""iTerm2 effects bridge for the typing-madness-meter herdr plugin.

The HUD starts this as a child process and sends NDJSON commands on stdin:
  {"tint": [r, g, b], "amount": 0.0-1.0}   blend the background toward a color
  {"tint": null}                           back to the profile's background
  {"flash": [r, g, b], "ms": 120}          brief full background flash
  {"badge": "COMBO 150!", "ms": 2000}      show a badge that shakes, then clear

Effects apply to every iTerm2 session whose foreground job is `herdr`. They
are session-local (never saved to the profile), and on exit or stdin EOF the
bridge restores colors and badge from the *saved* profile, so a crash can't
leave a tinted color behind as the new "original".

Status lines go to stdout: {"status": "ready", "sessions": N} | {"status": "error", ...}
"""
import asyncio
import json
import os
import random
import sys

import iterm2

MAX_TINT = 0.28  # strongest background blend at full typing heat
RESCAN_SECONDS = 5


def emit(obj):
    print(json.dumps(obj), flush=True)


def blend(base, color, amount):
    r, g, b = color
    return iterm2.Color(
        round(base.red + (r - base.red) * amount),
        round(base.green + (g - base.green) * amount),
        round(base.blue + (b - base.blue) * amount),
    )


class Target:
    """One herdr session and its saved (untouched) profile values."""

    def __init__(self, session, saved):
        self.session = session
        self.bg = {
            "set_background_color": saved.background_color,
            "set_background_color_dark": saved.background_color_dark,
            "set_background_color_light": saved.background_color_light,
        }
        self.badge_text = saved.badge_text or ""
        self.badge_top = saved.badge_top_margin
        self.badge_right = saved.badge_right_margin

    async def set_bg(self, color_for):
        p = iterm2.LocalWriteOnlyProfile()
        for setter, base in self.bg.items():
            if base is not None:
                getattr(p, setter)(color_for(base))
        await self.session.async_set_profile_properties(p)

    def _badge_props(self, p, text=None, dx=0, dy=0):
        p.set_badge_text(self.badge_text if text is None else text)
        if self.badge_top is not None:
            p.set_badge_top_margin(max(0, self.badge_top + dy))
        if self.badge_right is not None:
            p.set_badge_right_margin(max(0, self.badge_right + dx))

    async def set_badge(self, text=None, dx=0, dy=0):
        """Show `text` offset by (dx, dy); text=None restores the saved badge."""
        p = iterm2.LocalWriteOnlyProfile()
        self._badge_props(p, text, dx, dy)
        await self.session.async_set_profile_properties(p)

    async def restore(self):
        p = iterm2.LocalWriteOnlyProfile()
        for setter, base in self.bg.items():
            if base is not None:
                getattr(p, setter)(base)
        self._badge_props(p)
        await self.session.async_set_profile_properties(p)


class Bridge:
    def __init__(self, connection, app):
        self.connection = connection
        self.app = app
        self.targets = {}
        self.tint = None  # (rgb, amount) or None
        self.flashing = False
        self.badge_task = None

    async def scan(self):
        found = {}
        for window in self.app.terminal_windows:
            for tab in window.tabs:
                for session in tab.sessions:
                    try:
                        job = await session.async_get_variable("jobName")
                    except Exception:
                        continue
                    if job == "herdr":
                        found[session.session_id] = session
        for sid in list(self.targets):
            if sid not in found:
                del self.targets[sid]
        for sid, session in found.items():
            if sid in self.targets:
                continue
            live = await session.async_get_profile()
            guid = live.original_guid or live.guid
            saved = live
            try:
                partials = await iterm2.PartialProfile.async_query(self.connection, guids=[guid])
                if partials:
                    saved = await partials[0].async_get_full_profile()
            except Exception:
                pass
            self.targets[sid] = Target(session, saved)
            # Start from a clean state in case a previous bridge crashed.
            await self.targets[sid].restore()
            if self.tint:
                await self.apply_tint()

    async def each(self, fn):
        for t in list(self.targets.values()):
            try:
                await fn(t)
            except Exception:
                # Session closed: forget it; the next scan picks up new ones.
                self.targets.pop(t.session.session_id, None)

    async def apply_tint(self):
        if self.flashing:
            return
        if self.tint is None:
            await self.each(lambda t: t.set_bg(lambda base: base))
        else:
            rgb, amount = self.tint
            await self.each(lambda t: t.set_bg(lambda base: blend(base, rgb, amount * MAX_TINT)))

    async def flash(self, rgb, ms):
        if self.flashing:
            return
        self.flashing = True
        try:
            await self.each(lambda t: t.set_bg(lambda base: blend(base, rgb, 0.55)))
            await asyncio.sleep(ms / 1000)
        finally:
            self.flashing = False
            await self.apply_tint()

    async def badge(self, text, ms):
        async def run():
            # Shake the badge for the first ~400ms, settling down, then hold.
            for i in range(12):
                amp = 12 * (1 - i / 12)
                dx, dy = round(random.uniform(-amp, amp)), round(random.uniform(-amp, amp) / 2)
                await self.each(lambda t: t.set_badge(text, dx, dy))
                await asyncio.sleep(0.033)
            await self.each(lambda t: t.set_badge(text))
            await asyncio.sleep(max(0, ms / 1000 - 0.4))
            await self.each(lambda t: t.set_badge())

        if self.badge_task and not self.badge_task.done():
            self.badge_task.cancel()
        self.badge_task = asyncio.ensure_future(run())

    async def handle(self, msg):
        if "tint" in msg:
            tint = msg["tint"]
            self.tint = None if tint is None else (tuple(tint), float(msg.get("amount", 1)))
            await self.apply_tint()
        elif "flash" in msg:
            asyncio.ensure_future(self.flash(tuple(msg["flash"]), int(msg.get("ms", 120))))
        elif "badge" in msg:
            await self.badge(str(msg["badge"])[:40], int(msg.get("ms", 2000)))

    async def restore_all(self):
        if self.badge_task and not self.badge_task.done():
            self.badge_task.cancel()
        await self.each(lambda t: t.restore())


async def read_stdin():
    loop = asyncio.get_event_loop()
    reader = asyncio.StreamReader()
    await loop.connect_read_pipe(lambda: asyncio.StreamReaderProtocol(reader), sys.stdin)
    return reader


async def main(connection):
    app = await iterm2.async_get_app(connection)
    bridge = Bridge(connection, app)
    await bridge.scan()
    emit({"status": "ready", "sessions": len(bridge.targets)})

    async def rescan_forever():
        while True:
            await asyncio.sleep(RESCAN_SECONDS)
            try:
                await bridge.scan()
            except Exception:
                pass

    rescan = asyncio.ensure_future(rescan_forever())
    reader = await read_stdin()
    try:
        while True:
            line = await reader.readline()
            if not line:
                break
            try:
                await bridge.handle(json.loads(line))
            except Exception as e:  # keep going on a bad command
                emit({"status": "warn", "error": str(e)})
    finally:
        rescan.cancel()
        await bridge.restore_all()
        # The restore calls above have completed. Exit now instead of waiting
        # several seconds for the iterm2 library to close its websocket.
        sys.stdout.flush()
        os._exit(0)


if __name__ == "__main__":
    asyncio.set_event_loop(asyncio.new_event_loop())
    try:
        iterm2.run_until_complete(main, retry=False)
    except Exception as e:
        emit({"status": "error", "error": str(e)})
        sys.exit(1)
