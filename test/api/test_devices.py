import pytest
from pytest_check import equal, is_not_none, is_none

from devicehub_client.api.devices import get_devices, get_device_by_serial
from devicehub_client.models import GetDevicesTarget


# TODO: add param: GetDevicesTarget.STANDARD, when generator of devices will be ready(add device with standard group)
# api/v1/devices - list of devices
@pytest.mark.parametrize("target", [GetDevicesTarget.BOOKABLE, GetDevicesTarget.ORIGIN, 'NONE'])
def test_get_devices(api_client, target, fake_device_field_check, successful_response_check):
    if target == 'NONE':
        response = get_devices.sync_detailed(client=api_client)
    else:
        response = get_devices.sync_detailed(client=api_client, target=target)
    successful_response_check(response, description='Devices Information')
    is_not_none(response.parsed.devices)
    equal(len(response.parsed.devices), 5)
    for device in response.parsed.devices:
        device_dict = device.to_dict()
        fake_device_field_check(device_dict)


@pytest.mark.parametrize("target", [GetDevicesTarget.BOOKABLE, GetDevicesTarget.ORIGIN, 'NONE'])
def test_get_devices_empty_fields(api_client, target, fake_device_field_check, successful_response_check):
    if target == 'NONE':
        response = get_devices.sync_detailed(client=api_client, fields='')
    else:
        response = get_devices.sync_detailed(client=api_client, target=target, fields='')
    successful_response_check(response, description='Devices Information')
    is_not_none(response.parsed.devices)
    equal(len(response.parsed.devices), 5)
    for device in response.parsed.devices:
        device_dict = device.to_dict()
        fake_device_field_check(device_dict)


@pytest.mark.parametrize("target", [GetDevicesTarget.BOOKABLE, GetDevicesTarget.ORIGIN, 'NONE'])
def test_get_devices_with_fields(api_client, target, successful_response_check, fake_device_certain_field_check):
    if target == 'NONE':
        response = get_devices.sync_detailed(
            client=api_client,
            fields='present,present,status,serial,group.owner.name,using,somefields'
        )
    else:
        response = get_devices.sync_detailed(
            client=api_client,
            fields='present,present,status,serial,group.owner.name,using,somefields',
            target=target
        )
    successful_response_check(response, description='Devices Information')
    is_not_none(response.parsed.devices)
    equal(len(response.parsed.devices), 5)
    for device in response.parsed.devices:
        device_dict = device.to_dict()
        fake_device_certain_field_check(device_dict)


@pytest.mark.parametrize("target", [GetDevicesTarget.BOOKABLE, GetDevicesTarget.ORIGIN, 'NONE'])
def test_get_devices_with_wrong_fields(api_client, target, successful_response_check):
    if target == 'NONE':
        response = get_devices.sync_detailed(
            client=api_client,
            fields='wrong,111,!@!$!$, ,'
        )
    else:
        response = get_devices.sync_detailed(
            client=api_client,
            fields='wrong,111,!@!$!$, ,',
            target=target
        )
    successful_response_check(response, description='Devices Information')
    is_not_none(response.parsed.devices)
    equal(len(response.parsed.devices), 5)
    for device in response.parsed.devices:
        device_dict = device.to_dict()
        equal(len(device_dict.values()), 1)
        is_not_none(device_dict.get('reverseForwards'))
        equal(device_dict.get('reverseForwards'), [])

@pytest.mark.skip(reason="can't sent wrong request because strong definition in api-client")
def test_get_devices_with_wrong_target(api_client):
    response = get_devices.sync_detailed(
        client=api_client,
        fields='present,',
        target='NONE'
    )
    equal(response.status_code, 400)
    is_none(response.parsed)


# api/v1/devices/{serial} - list of devices
def test_get_device_by_serial(api_client, fake_device_field_check, successful_response_check, first_device_serial):

    response = get_device_by_serial.sync_detailed(client=api_client, serial=first_device_serial)
    successful_response_check(response, description='Device Information')
    is_not_none(response.parsed.device)
    device_dict = response.parsed.device.to_dict()
    fake_device_field_check(device_dict)


def test_get_device_by_serial_empty_fields(
    api_client,
    fake_device_field_check,
    successful_response_check,
    first_device_serial
):

    response = get_device_by_serial.sync_detailed(client=api_client, serial=first_device_serial, fields='')
    successful_response_check(response, description='Device Information')
    is_not_none(response.parsed.device)
    device_dict = response.parsed.device.to_dict()
    fake_device_field_check(device_dict)


def test_get_device_by_serial_with_fields(
    api_client,
    fake_device_field_check,
    successful_response_check,
    first_device_serial,
    fake_device_certain_field_check
):

    response = get_device_by_serial.sync_detailed(
        client=api_client,
        serial=first_device_serial,
        fields='present,present,status,serial,group.owner.name,using,somefields'
    )
    successful_response_check(response, description='Device Information')
    is_not_none(response.parsed.device)
    device_dict = response.parsed.device.to_dict()
    fake_device_certain_field_check(device_dict)


def test_get_device_by_serial_with_wrong_fields(
    api_client,
    fake_device_field_check,
    successful_response_check,
    first_device_serial
):

    response = get_device_by_serial.sync_detailed(
        client=api_client,
        serial=first_device_serial,
        fields='wrong,111,!@!$!$, ,'
    )
    successful_response_check(response, description='Device Information')
    is_not_none(response.parsed.device)
    device_dict = response.parsed.device.to_dict()
    equal(len(device_dict.values()), 1)
    is_not_none(device_dict.get('reverseForwards'))
    equal(device_dict.get('reverseForwards'), [])
