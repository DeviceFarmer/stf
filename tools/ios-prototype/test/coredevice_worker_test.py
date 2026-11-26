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

    async def stop_media_stream(self, *, stop_all=True, identifiers=None):
        self.rsd.stops.append({"stop_all": stop_all, "identifiers": identifiers})
        if self.rsd.stop_error:
            raise self.rsd.stop_error
        if self.rsd.stop_reply is not None:
            return self.rsd.stop_reply
        return {"stoppedStreams": identifiers}

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


def media_session(client_id, ssrc):
    return {"connection": {
        "options": {"avcMediaStreamOptionClientSessionID": {"uuid": client_id}},
        "streamConfig": {"RemoteSSRC": ssrc},
    }}


class ScreenCleanupTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.rsd = SimpleNamespace(interrupt_startup=False, stops=[], stop_error=None, stop_reply=None)
        reservation = SimpleNamespace(getsockname=lambda: ("127.0.0.1", 7400))
        self.server = worker["ScreenServer"](self.rsd, reservation, "password", None)
        self.owned = media_session(self.server._shared_session_id, 1001)
        self.owned_audio = media_session(self.server._shared_session_id, 1002)
        self.foreign = media_session(uuid.uuid4(), 2001)

    async def test_shutdown_waits_only_for_owned_session(self):
        self.rsd.statuses = iter([[self.owned, self.foreign], [self.foreign]])
        with patch.object(asyncio, "sleep", new=AsyncMock()) as sleep:
            await self.server.serve()
        sleep.assert_awaited_once()
        self.server._stop_active_stream.assert_awaited_once()
        self.server._stop_audio_stream.assert_awaited_once()
        self.assertIs(screen_stream.DisplayService, DisplayService)

    async def test_shutdown_stops_only_owned_streams(self):
        # The phone keeps unstopped streams for 20 s and blocks the next screen session.
        self.rsd.statuses = iter([[self.owned, self.foreign, self.owned_audio], [self.foreign]])
        with patch.object(asyncio, "sleep", new=AsyncMock()):
            with self.assertNoLogs(level="WARNING"):
                await self.server.serve()
        self.assertEqual(self.rsd.stops, [{"stop_all": False, "identifiers": [1001, 1002]}])

    async def test_unconfirmed_stop_is_reported_once(self):
        self.rsd.stop_reply = {"stoppedStreams": [1001]}
        self.rsd.statuses = iter([[self.owned, self.owned_audio], [self.owned_audio], []])
        with patch.object(asyncio, "sleep", new=AsyncMock()):
            with self.assertLogs(level="WARNING") as logs:
                await self.server.serve()
        self.assertEqual(len(self.rsd.stops), 2)
        self.assertEqual(len(logs.records), 1)
        self.assertIn("[1002]", logs.output[0])
        self.assertNotIn("1001", logs.output[0])

    async def test_failed_stop_falls_back_to_waiting_for_expiry(self):
        self.rsd.stop_error = RuntimeError("stop rejected")
        self.rsd.statuses = iter([
            [self.owned, self.foreign], [self.owned], [self.owned], [self.foreign],
        ])
        with patch.object(asyncio, "sleep", new=AsyncMock()) as sleep:
            with self.assertLogs(level="DEBUG") as logs:
                await self.server.serve()
        self.assertEqual(sleep.await_count, 3)
        self.assertEqual([stop["identifiers"] for stop in self.rsd.stops], [[1001]] * 3)
        self.assertFalse(any(stop["stop_all"] for stop in self.rsd.stops))
        warnings = [record for record in logs.records if record.levelname == "WARNING"]
        debug = [record for record in logs.records if record.levelname == "DEBUG"]
        self.assertEqual(len(warnings), 1)
        self.assertIsNotNone(warnings[0].exc_info)
        self.assertEqual(len(debug), 2)
        self.assertTrue(all(record.exc_info is None for record in debug))

    async def test_stream_id_zero_is_stopped(self):
        self.rsd.statuses = iter([[media_session(self.server._shared_session_id, 0)], []])
        with patch.object(asyncio, "sleep", new=AsyncMock()):
            await self.server.serve()
        self.assertEqual(self.rsd.stops, [{"stop_all": False, "identifiers": [0]}])

    async def test_owned_session_without_stream_id_is_left_to_expire(self):
        anonymous = [media_session(self.server._shared_session_id, ssrc)
                     for ssrc in (None, True, -1, 0x100000000, "1001")]
        self.rsd.statuses = iter([anonymous, []])
        with patch.object(asyncio, "sleep", new=AsyncMock()) as sleep:
            await self.server.serve()
        sleep.assert_awaited_once()
        self.assertEqual(self.rsd.stops, [])

    async def test_startup_cancellation_closes_transports_and_rechecks_status(self):
        self.rsd.interrupt_startup = True
        self.rsd.statuses = iter([[self.foreign], [self.owned, self.foreign], [self.foreign]])
        with patch.object(asyncio, "sleep", new=AsyncMock()) as sleep:
            with self.assertRaises(asyncio.CancelledError):
                await self.server.serve()
        self.assertEqual(sleep.await_count, 2)
        self.server._stop_active_stream.assert_awaited_once()
        self.server._stop_audio_stream.assert_awaited_once()
        self.assertEqual(self.rsd.stops, [{"stop_all": False, "identifiers": [1001]}])
        self.assertIs(screen_stream.DisplayService, DisplayService)


if __name__ == "__main__":
    unittest.main()
