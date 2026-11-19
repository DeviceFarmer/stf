"""Check ownership fencing around the pinned screen server's cleanup calls."""

import asyncio
import runpy
import sys
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch


class DisplayService:
    def __init__(self, rsd):
        self.rsd = rsd
        self.queried = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exception):
        pass

    async def get_media_stream_server_status(self):
        if self.queried:
            raise AssertionError("CoreDevice status requires a fresh connection")
        self.queried = True
        return {"sessions": next(self.rsd.statuses)}

    @classmethod
    async def stop_all_streams(cls, rsd):
        raise AssertionError("Worker attempted to stop foreign media")


class UpstreamScreenServer:
    def __init__(self, rsd, **kwargs):
        self._rsd = rsd
        self._shared_session_id = uuid.uuid4()
        self._stop_active_stream = AsyncMock()
        self._stop_audio_stream = AsyncMock()

    async def serve(self):
        if self._rsd.interrupt_startup:
            raise asyncio.CancelledError
        await self._stop_active_stream()
        await self._stop_audio_stream()
        await screen_stream.DisplayService.stop_all_streams(self._rsd)


screen_stream = SimpleNamespace(DisplayService=DisplayService, ScreenStreamServer=UpstreamScreenServer)
core_device = SimpleNamespace(screen_stream=screen_stream)
with patch.dict(sys.modules, {
    "pymobiledevice3.remote.core_device": core_device,
    "pymobiledevice3.remote.core_device.display_service": SimpleNamespace(DisplayService=DisplayService),
    "pymobiledevice3.remote.remote_service_discovery": SimpleNamespace(RemoteServiceDiscoveryService=None),
}):
    worker = runpy.run_path(str(Path(__file__).resolve().parents[1] / "coredevice_worker.py"))


def media_session(client_id):
    return {"connection": {"options": {"avcMediaStreamOptionClientSessionID": {"uuid": client_id}}}}


class ScreenCleanupTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.rsd = SimpleNamespace(interrupt_startup=False)
        reservation = SimpleNamespace(getsockname=lambda: ("127.0.0.1", 7400))
        self.server = worker["ScreenServer"](self.rsd, reservation, "password", None)
        self.owned = media_session(self.server._shared_session_id)
        self.foreign = media_session(uuid.uuid4())

    async def test_shutdown_waits_only_for_owned_session(self):
        self.rsd.statuses = iter([[self.owned, self.foreign], [self.foreign]])
        with patch.object(asyncio, "sleep", new=AsyncMock()) as sleep:
            await self.server.serve()
        sleep.assert_awaited_once()
        self.server._stop_active_stream.assert_awaited_once()
        self.server._stop_audio_stream.assert_awaited_once()
        self.assertIs(screen_stream.DisplayService, DisplayService)

    async def test_startup_cancellation_closes_transports_and_rechecks_status(self):
        self.rsd.interrupt_startup = True
        self.rsd.statuses = iter([[self.foreign], [self.owned, self.foreign], [self.foreign]])
        with patch.object(asyncio, "sleep", new=AsyncMock()) as sleep:
            with self.assertRaises(asyncio.CancelledError):
                await self.server.serve()
        self.assertEqual(sleep.await_count, 2)
        self.server._stop_active_stream.assert_awaited_once()
        self.server._stop_audio_stream.assert_awaited_once()
        self.assertIs(screen_stream.DisplayService, DisplayService)


if __name__ == "__main__":
    unittest.main()
