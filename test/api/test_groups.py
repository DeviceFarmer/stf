from datetime import datetime, timezone, timedelta
from time import sleep

from pytest_check import greater, equal, is_not_none, is_not_in, is_none, between_equal

from devicehub_client.api.admin import add_origin_group_devices
from devicehub_client.api.groups import get_groups, get_group_device, get_group_devices, create_group, delete_group, \
    add_group_device, add_group_user, add_group_devices, remove_group_device, update_group, remove_group_devices, \
    get_group
from devicehub_client.models import GroupPayload, GroupPayloadClass, DevicesPayload, GroupPayloadState


def test_get_groups(api_client, successful_response_check):
    response = get_groups.sync_detailed(client=api_client)
    successful_response_check(response, description='Groups Information')
    greater(len(response.parsed.groups), 0)


# api/v1/groups/{id}/devices - list of devices for certain group
def test_get_groups_devices(api_client, fake_device_field_check, common_group_id, successful_response_check):
    response = get_group_devices.sync_detailed(client=api_client, id=common_group_id)
    successful_response_check(response, description='Devices Information')
    is_not_none(response.parsed.devices)
    equal(len(response.parsed.devices), 5)
    for device in response.parsed.devices:
        device_dict = device.to_dict()
        fake_device_field_check(device_dict)


def test_get_groups_devices_empty_fields(
    api_client,
    fake_device_field_check,
    common_group_id,
    successful_response_check
):
    response = get_group_devices.sync_detailed(client=api_client, id=common_group_id, fields='')
    successful_response_check(response, description='Devices Information')
    is_not_none(response.parsed.devices)
    equal(len(response.parsed.devices), 5)
    for device in response.parsed.devices:
        device_dict = device.to_dict()
        fake_device_field_check(device_dict)


def test_get_groups_devices_with_fields(
    api_client,
    common_group_id,
    successful_response_check,
    fake_device_certain_field_check
):
    response = get_group_devices.sync_detailed(
        client=api_client,
        id=common_group_id,
        fields='present,present,status,serial,group.owner.name,using,somefields'
    )
    successful_response_check(response, description='Devices Information')
    is_not_none(response.parsed.devices)
    equal(len(response.parsed.devices), 5)
    for device in response.parsed.devices:
        device_dict = device.to_dict()
        fake_device_certain_field_check(device_dict)


def test_get_groups_devices_with_wrong_fields(
    api_client,
    common_group_id,
    successful_response_check,
    fake_device_certain_field_check
):
    response = get_group_devices.sync_detailed(
        client=api_client,
        id=common_group_id,
        fields='wrong,111,!@!$!$, ,'
    )
    successful_response_check(response, description='Devices Information')
    is_not_none(response.parsed.devices)
    equal(len(response.parsed.devices), 5)
    for device in response.parsed.devices:
        device_dict = device.to_dict()
        equal(len(device_dict.values()), 1)
        is_not_none(device_dict.get('reverseForwards'))
        equal(device_dict.get('reverseForwards'), [])


def test_get_unexisting_group_devices(
    api_client,
    fake_device_field_check,
    common_group_id,
    failure_response_check,
    random_str,
    first_device_serial
):
    random_group = f'group-{random_str()}'
    response = get_group_devices.sync_detailed(id=random_group, client=api_client)
    failure_response_check(response, status_code=404, description='Not Found (group)')
    is_none(response.parsed)


# api/v1/groups/{groupId}/devices/{deviceId} - certain device for certain group
def test_get_groups_device(
    api_client,
    fake_device_field_check,
    common_group_id,
    successful_response_check,
    devices_serial
):
    for serial in devices_serial:
        response = get_group_device.sync_detailed(id=common_group_id, serial=serial, client=api_client)
        successful_response_check(response, description='Device Information')
        is_not_none(response.parsed.device)
        device_dict = response.parsed.device.to_dict()
        equal(device_dict.get('serial'), serial)
        fake_device_field_check(device_dict)


def test_get_groups_unexisting_device(
    api_client,
    fake_device_field_check,
    common_group_id,
    failure_response_check,
    random_str
):
    random_serial = f'serial-{random_str()}'
    response = get_group_device.sync_detailed(id=common_group_id, serial=random_serial, client=api_client)
    failure_response_check(response, status_code=404, description='Not Found (device)')
    is_none(response.parsed)


def test_get_unexisting_group_device(
    api_client,
    fake_device_field_check,
    common_group_id,
    failure_response_check,
    random_str,
    first_device_serial
):
    random_group = f'group-{random_str()}'
    response = get_group_device.sync_detailed(id=random_group, serial=first_device_serial, client=api_client)
    failure_response_check(response, status_code=404, description='Not Found (group)')
    is_none(response.parsed)


def test_create_and_delete_once_group(api_client, random_str, successful_response_check):
    name = f'Test-run-{random_str()}'
    new_group = GroupPayload(
        name=name,
    )
    response = create_group.sync_detailed(client=api_client, body=new_group)
    successful_response_check(response, status_code=201, description='Created')
    is_not_none(response.parsed.group)
    group_dict = response.parsed.group.to_dict()
    equal(group_dict.get('name'), name)
    equal(group_dict.get('class'), 'once')
    group_id = group_dict.get('id')
    response = delete_group.sync_detailed(client=api_client, id=group_id)
    successful_response_check(response, description='Deleted (groups)')


def test_return_device_to_origin_group(
    api_client,
    api_client_custom_token,
    service_user_token,
    random_str,
    random_user,
    successful_response_check,
    failure_response_check,
    common_group_id,
    first_device_serial,
    device_in_group_check
):
    # create bookable group by admin
    bookable_group_name = f'Group_bookable-{random_str()}'
    response = create_group.sync_detailed(
        client=api_client,
        body=GroupPayload(
            name=bookable_group_name,
            class_=GroupPayloadClass.BOOKABLE
        )
    )
    successful_response_check(response, status_code=201, description='Created')
    # add device to admin bookable group
    bookable_group_id = response.parsed.group.to_dict()['id']
    response = add_origin_group_devices.sync_detailed(
        id=bookable_group_id,
        client=api_client,
        body=DevicesPayload(serials=first_device_serial)
    )
    successful_response_check(response, description='Updated (devices)')
    # create and add user to admin bookable group
    user = random_user()
    user_token = service_user_token(user=user)
    response = add_group_user.sync_detailed(id=bookable_group_id, email=user.email, client=api_client)
    successful_response_check(response, description='Added (group users)')
    # create once group by user
    user_api_client = api_client_custom_token(token=user_token)
    response = create_group.sync_detailed(
        client=user_api_client,
        body=GroupPayload(
            name=f'Group_once-{random_str()}',
            class_=GroupPayloadClass.ONCE
        )
    )
    successful_response_check(response, status_code=201, description='Created')
    once_group_id = response.parsed.group.to_dict()['id']
    # add device to once group by user
    response = add_group_device.sync_detailed(
        id=once_group_id,
        client=api_client,
        serial=first_device_serial
    )
    successful_response_check(response, description='Added (group devices)')
    # try to delete bookable group by admin
    response = delete_group.sync_detailed(id=bookable_group_id, client=api_client)
    failure_response_check(response, status_code=403, description='Forbidden (groups)')
    # delete once group by user
    response = delete_group.sync_detailed(id=once_group_id, client=user_api_client)
    successful_response_check(response, description='Deleted (groups)')
    # check device move to bookable group
    device_in_group_check(serial=first_device_serial, group_id=bookable_group_id, group_name=bookable_group_name)
    # delete bookable group
    response = delete_group.sync_detailed(id=bookable_group_id, client=api_client)
    successful_response_check(response, description='Deleted (groups)')
    sleep(1)
    # check device return to common group
    device_in_group_check(serial=first_device_serial, group_id=common_group_id, group_name='Common')


# @pytest.mark.focus
def test_return_devices_after_delete_bookable_group(
    api_client,
    random_str,
    successful_response_check,
    common_group_id,
    devices_serial,
    devices_in_group_check
):
    # create bookable group by admin
    bookable_group_name = f'Group_bookable-{random_str()}'
    response = create_group.sync_detailed(
        client=api_client,
        body=GroupPayload(
            name=bookable_group_name,
            class_=GroupPayloadClass.BOOKABLE
        )
    )
    successful_response_check(response, status_code=201, description='Created')
    # add devices to admin bookable group
    bookable_group_id = response.parsed.group.to_dict()['id']
    response = add_origin_group_devices.sync_detailed(
        id=bookable_group_id,
        client=api_client,
        body=DevicesPayload(serials=','.join(devices_serial))
    )
    successful_response_check(response, description='Updated (devices)')
    # delete bookable group
    response = delete_group.sync_detailed(id=bookable_group_id, client=api_client)
    successful_response_check(response, description='Deleted (groups)')
    # check device return to common group
    devices_in_group_check(serials=devices_serial, group_id=common_group_id, group_name='Common')


def test_remove_device_by_one_from_once_group(
    random_str,
    successful_response_check,
    devices_serial,
    device_in_group_check,
    api_client_custom_token,
    service_user_token
):
    # create once group by user
    user_api_client = api_client_custom_token(token=service_user_token())
    response = create_group.sync_detailed(
        client=user_api_client,
        body=GroupPayload(
            name=f'Group_once-{random_str()}',
            class_=GroupPayloadClass.ONCE,
            state=GroupPayloadState.PENDING
        )
    )
    successful_response_check(response, status_code=201, description='Created')
    equal(response.parsed.group.to_dict()['state'], GroupPayloadState.PENDING)
    once_group_id = response.parsed.group.to_dict()['id']
    once_group_name = response.parsed.group.to_dict()['name']
    # make once group ready
    response = update_group.sync_detailed(
        id=once_group_id,
        client=user_api_client,
        body=GroupPayload(
            state=GroupPayloadState.READY
        )
    )
    successful_response_check(response, description='Updated (group)')
    equal(response.parsed.group.to_dict()['state'], GroupPayloadState.READY)
    # add device to once group by user by one
    group_devices = []
    for serial in devices_serial:
        response = add_group_device.sync_detailed(
            id=once_group_id,
            client=user_api_client,
            serial=serial
        )
        successful_response_check(response, description='Added (group devices)')
        group_devices.append(serial)
        equal(sorted(group_devices), sorted(response.parsed.group.to_dict()['devices']))
        device_in_group_check(serial=serial, group_id=once_group_id, group_name=once_group_name)
    # try to delete devices by one by user
    for serial in devices_serial:
        response = remove_group_device.sync_detailed(id=once_group_id, serial=serial, client=user_api_client)
        successful_response_check(response, description='Removed (group devices)')
        is_not_in(serial, response.parsed.group.to_dict()['devices'])
    # delete once group by user
    response = delete_group.sync_detailed(id=once_group_id, client=user_api_client)
    successful_response_check(response, description='Deleted (groups)')


def test_remove_devices_from_once_group(
    random_str,
    successful_response_check,
    devices_serial,
    devices_in_group_check,
    api_client_custom_token,
    service_user_token
):
    # create once group by user
    user_api_client = api_client_custom_token(token=service_user_token())
    response = create_group.sync_detailed(
        client=user_api_client,
        body=GroupPayload(
            name=f'Group_once-{random_str()}',
            class_=GroupPayloadClass.ONCE,
            state=GroupPayloadState.PENDING
        )
    )
    successful_response_check(response, status_code=201, description='Created')
    equal(response.parsed.group.to_dict()['state'], GroupPayloadState.PENDING)
    once_group_id = response.parsed.group.to_dict()['id']
    once_group_name = response.parsed.group.to_dict()['name']
    # make once group ready
    response = update_group.sync_detailed(
        id=once_group_id,
        client=user_api_client,
        body=GroupPayload(
            state=GroupPayloadState.READY
        )
    )
    successful_response_check(response, description='Updated (group)')
    equal(response.parsed.group.to_dict()['state'], GroupPayloadState.READY)
    # add device to once group by user
    response = add_group_devices.sync_detailed(
        id=once_group_id,
        client=user_api_client,
        body=DevicesPayload(serials=','.join(devices_serial))
    )
    successful_response_check(response, description='Added (group devices)')
    equal(sorted(devices_serial), sorted(response.parsed.group.to_dict()['devices']))
    devices_in_group_check(serials=devices_serial, group_id=once_group_id, group_name=once_group_name)
    # try to delete devices by user
    response = remove_group_devices.sync_detailed(id=once_group_id, client=user_api_client, body=DevicesPayload())
    successful_response_check(response, description='Removed (group devices)')
    equal(response.parsed.group.to_dict()['devices'], [])
    # delete once group by user
    response = delete_group.sync_detailed(id=once_group_id, client=user_api_client)
    successful_response_check(response, description='Deleted (groups)')

def test_scheduler_update_bookable_group_lifetime(
    api_client,
    random_str,
    successful_response_check,
devices_serial, devices_in_group_check, common_group_id):
    # create group
    bookable_group_name = f'Group_expired_bookable-{random_str()}'
    response = create_group.sync_detailed(
        client=api_client,
        body=GroupPayload(
            name=bookable_group_name,
            class_=GroupPayloadClass.ONCE,
            state=GroupPayloadState.PENDING
        )
    )
    successful_response_check(response, status_code=201, description='Created')
    group_id = response.parsed.group.to_dict()['id']

    # update group to bookable with passed lifetime
    response = update_group.sync_detailed(
        id=group_id,
        client=api_client,
        body=GroupPayload(
            class_=GroupPayloadClass.BOOKABLE,
            start_time= datetime.now(timezone.utc) - timedelta(minutes=15),
            stop_time= datetime.now(timezone.utc) - timedelta(minutes=5),
        )
    )
    successful_response_check(response, description='Updated (group)')

    # add devices to bookable group
    response = add_origin_group_devices.sync_detailed(
        id=group_id,
        client=api_client,
        body=DevicesPayload(serials=','.join(devices_serial))
    )
    successful_response_check(response, description='Updated (devices)')

    # waiting for the scheduler has worked
    sleep(3)

    # check that scheduler update group lifetime
    response = get_group.sync_detailed(client=api_client, id=group_id)
    successful_response_check(response, description='Group Information')
    group_dict = response.parsed.group.to_dict()
    date_now = datetime.now(timezone.utc)
    date_now_plus_10 = date_now + timedelta(minutes=10)
    delta = timedelta(seconds=4)
    group_start_time = datetime.fromisoformat(group_dict.get('dates')[0].get('start').replace("Z", "+00:00"))
    group_stop_time = datetime.fromisoformat(group_dict.get('dates')[0].get('stop').replace("Z", "+00:00"))
    between_equal(group_start_time, date_now - delta, date_now + delta)
    between_equal(group_stop_time, date_now_plus_10 - delta, date_now_plus_10 + delta)

    # delete group
    response = delete_group.sync_detailed(id=group_id, client=api_client)
    successful_response_check(response, description='Deleted (groups)')

    # check device return to common group
    devices_in_group_check(serials=devices_serial, group_id=common_group_id, group_name='Common')

def test_scheduler_del_expired_once_group(
    api_client,
    random_str,
    successful_response_check,
devices_serial, devices_in_group_check, common_group_id, failure_response_check):
    # create group
    bookable_group_name = f'Group_expired_once-{random_str()}'
    response = create_group.sync_detailed(
        client=api_client,
        body=GroupPayload(
            name=bookable_group_name,
            class_=GroupPayloadClass.ONCE,
            state=GroupPayloadState.PENDING
        )
    )
    successful_response_check(response, status_code=201, description='Created')
    group_id = response.parsed.group.to_dict()['id']

    # update group to passed lifetime
    response = update_group.sync_detailed(
        id=group_id,
        client=api_client,
        body=GroupPayload(
            state=GroupPayloadState.READY,
            start_time= datetime.now(timezone.utc) - timedelta(minutes=15),
            stop_time= datetime.now(timezone.utc) - timedelta(minutes=5),
        )
    )
    successful_response_check(response, description='Updated (group)')

    # waiting for the scheduler has worked
    sleep(3)

    # check that scheduler del group
    response = get_group.sync_detailed(client=api_client, id=group_id)
    failure_response_check(response, status_code=404, description='Not Found (group)')
