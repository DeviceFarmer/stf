import asyncio
import itertools
import json
import random

import pytest
from pytest_check import equal, is_, is_not_none, is_none

from devicehub_client.api.autotests import capture_devices, free_devices
from devicehub_client.types import UNSET


def raise_multiple(errors):
    if not errors:  # list emptied, recursion ends
        return
    try:
        raise errors.pop()  # pop removes list entries
    finally:
        raise_multiple(errors)  # recursion


pytest_plugins = ('pytest_asyncio',)


@pytest.mark.asyncio
@pytest.mark.xfail
async def test_get_groups(api_client):
    async def load_work(worker_number: int):
        async def shielded_load_work(test_num: int):
            test_name = f"test_worker_{worker_number}.{test_num}"
            print(f"Starting {test_name}")
            devices = await capture_devices.asyncio_detailed(client=api_client, amount=2, run=test_name, timeout=1200)
            assert devices.status_code in range(200, 300), devices.content
            assert devices.parsed
            assert devices.parsed.group
            group_id = devices.parsed.group.to_dict()["id"]
            await asyncio.sleep(random.uniform(0.2, 0.5))
            freed = await free_devices.asyncio_detailed(client=api_client, group=group_id)
            assert freed.status_code in range(200, 300), devices.content

        for test_num in itertools.count():
            await asyncio.shield(shielded_load_work(test_num))
            if test_num > 5:
                break

    tasks = [asyncio.create_task(load_work(i)) for i in range(2)]
    done, pending = await asyncio.wait(tasks, timeout=None, return_when=asyncio.FIRST_EXCEPTION)
    exceptions = []
    for coro in done:
        if exception := coro.exception():
            exceptions.append(exception)
    for coro in pending:
        coro.cancel()
    raise_multiple(exceptions)


def test_create_connect_delete_autotest_group(api_client, random_str):
    # Create autotests group
    devices_amount = 2
    device_abi = 'armeabi-v7a'
    autotests_group_name = f'Test-run-{random_str()}'
    response = capture_devices.sync_detailed(
        client=api_client,
        timeout=600,
        amount=devices_amount,
        need_amount=True,
        abi=device_abi,
        run=autotests_group_name,
        sdk=UNSET, model=UNSET,
        type=UNSET,
        version=UNSET
    )
    equal(response.status_code, 200, json.loads(response.content))
    is_not_none(response.parsed)
    is_(response.parsed.success, True)
    equal(response.parsed.description, 'Added (group devices)')
    is_not_none(response.parsed.group)
    group_dict = response.parsed.group.to_dict()
    equal(len(group_dict['devices']), devices_amount)
    autotests_group_id = group_dict['id']

    for device in group_dict['devices']:
        is_(device['present'], True)
        is_none(device['owner'])
        equal(device['status'], 3)
        is_(device['ready'], True)
        is_(device['remoteConnect'], False)
        is_not_none(device['group'])
        equal(device['group']['id'], autotests_group_id)
        equal(device['group']['name'], autotests_group_name)
        equal(device['abi'], device_abi)

    # remove autotests group
    response = free_devices.sync_detailed(client=api_client, group=autotests_group_id)
    equal(response.status_code, 200)
    is_(response.parsed.success, True)
    equal(response.parsed.description, 'Deleted (groups)')
