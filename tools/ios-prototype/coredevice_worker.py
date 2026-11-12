"""Run the pinned pymobiledevice3 screen server for one STF screen connection."""

import asyncio
import contextlib
import json
import logging
import os
import socket
import sys
import threading

from pymobiledevice3.remote.core_device.display_service import DisplayService
from pymobiledevice3.remote.core_device.screen_stream import ScreenStreamServer
from pymobiledevice3.remote.remote_service_discovery import RemoteServiceDiscoveryService


MAX_TOUCH_BYTES = 1024


class ScreenServer(ScreenStreamServer):
    def __init__(self, rsd, reservation, password, stop):
        super().__init__(
            rsd, http_port=reservation.getsockname()[1], password=password, audio_default_on=False
        )
        self.reservation = reservation
        self.stop_requested = stop
        self._hid_queue = asyncio.Queue(maxsize=8)
        self.touch_lock = asyncio.Lock()
        self.last_contact = None
        self.stopping = False

    async def _eager_stream_start(self):
        try:
            await super()._eager_stream_start()
        finally:
            # Keep the port reserved until upstream is about to bind it.
            self.reservation.close()

    async def _handle_touch(self, body):
        async with self.touch_lock:
            if self.stopping:
                return 409, b"screen session ended"
            try:
                touch = json.loads(body)
                # A timed-out send may already have reached the phone.
                if touch["type"] == "contact":
                    self.last_contact = touch
                result = await super()._handle_touch(body)
            except Exception:
                self.stop_requested.set()
                raise
            if result[0] == 200:
                if touch["type"] != "contact":
                    self.last_contact = None
            else:
                self.stop_requested.set()
            return result

    async def release_contact(self):
        self.stopping = True
        async with self.touch_lock:
            if self.last_contact:
                release = {**self.last_contact, "type": "release"}
                self.last_contact = None
                await super()._handle_touch(json.dumps(release).encode())


async def dispatch_touches(server, commands, stop):
    while not stop.is_set():
        body = await commands.get()
        if stop.is_set():
            return
        try:
            status, _ = await server._handle_touch(body)
        except Exception:
            logging.exception("CoreDevice touch failed")
            status = 500
        try:
            print("ok" if status == 200 else "error", flush=True)
        except BrokenPipeError:
            stop.set()
        if status != 200:
            stop.set()


async def serve(config, stop, commands):
    async with RemoteServiceDiscoveryService((config["address"], config["rsdPort"])) as rsd:
        if rsd.udid != config["udid"]:
            raise RuntimeError("RSD belongs to a different iPhone")
        async with DisplayService(rsd) as display:
            status = await asyncio.wait_for(display.get_media_stream_server_status(), 5)
        if status.get("running") or status.get("sessions"):
            raise RuntimeError("iPhone already has a CoreDevice media session")
        if stop.is_set():
            return
        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1", 0))
            server = ScreenServer(rsd, reservation, config["password"], stop)
            print(reservation.getsockname()[1], flush=True)
            task = asyncio.create_task(server.serve())
            touches = asyncio.create_task(dispatch_touches(server, commands, stop))
            stopped = asyncio.create_task(stop.wait())
            try:
                done, _ = await asyncio.wait((task, stopped), return_when=asyncio.FIRST_COMPLETED)
                if task in done:
                    await task
                else:
                    server.stopping = True
                    touches.cancel()
                    await asyncio.wait((touches,), timeout=1)
                    with contextlib.suppress(Exception):
                        await asyncio.wait_for(server.release_contact(), 1)
            finally:
                stopped.cancel()
                touches.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await touches
                if not task.done():
                    task.cancel()
                    with contextlib.suppress(asyncio.CancelledError):
                        await task
                # Upstream installs its media cleanup after startup. Closing
                # while it was starting may leave a session on the phone.
                async with DisplayService(rsd) as display:
                    status = await asyncio.wait_for(display.get_media_stream_server_status(), 5)
                sessions = status.get("sessions", [])
                if sessions and all(owns_session(server, session) for session in sessions):
                    await asyncio.wait_for(DisplayService.stop_all_streams(rsd), 5)


def owns_session(server, session):
    options = session.get("connection", {}).get("options", {})
    client_id = options.get("avcMediaStreamOptionClientSessionID")
    if isinstance(client_id, dict):
        client_id = client_id.get("uuid")
    return str(client_id) == str(server._shared_session_id)


async def main(config):
    loop = asyncio.get_running_loop()
    stop = asyncio.Event()
    finished = threading.Event()
    commands = asyncio.Queue(maxsize=1)

    def enqueue(body):
        if not stop.is_set():
            try:
                commands.put_nowait(body)
            except asyncio.QueueFull:
                logging.error("Overlapping CoreDevice touch commands")
                stop.set()

    def watch_parent():
        # EOF arrives even if the Node parent exits abruptly. AppArmor on the
        # farm can reject signals between processes in the same container.
        pending = b""
        try:
            while chunk := os.read(sys.stdin.fileno(), MAX_TOUCH_BYTES):
                pending += chunk
                while b"\n" in pending:
                    body, pending = pending.split(b"\n", 1)
                    if not body or len(body) > MAX_TOUCH_BYTES:
                        raise ValueError("Invalid CoreDevice touch command length")
                    loop.call_soon_threadsafe(enqueue, body)
                if len(pending) > MAX_TOUCH_BYTES:
                    raise ValueError("CoreDevice touch command exceeds its size limit")
        except (OSError, RuntimeError, ValueError) as error:
            logging.error("CoreDevice touch pipe closed: %s", error)
        with contextlib.suppress(RuntimeError):
            loop.call_soon_threadsafe(stop.set)
        if not finished.wait(25):
            os._exit(1)

    threading.Thread(target=watch_parent, daemon=True).start()
    try:
        await serve(config, stop, commands)
    finally:
        finished.set()


if __name__ == "__main__":
    asyncio.run(main(json.loads(sys.stdin.buffer.readline(4096))))
