import pytest
from pytest_check import greater, equal, is_not_none

from smartphone_test_farm_client.api.admin import add_origin_group_devices
from smartphone_test_farm_client.api.groups import get_groups, get_group_devices, create_group, delete_group, \
    add_group_device, add_group_user
from smartphone_test_farm_client.models import GroupPayload, GroupPayloadClass, DevicesPayload


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


def test_create_and_delete_once_group(api_client, random_str, successful_response_check):
    name = f'Test-run-{random_str()}'
    new_group = GroupPayload(
        name=name,
    )
    response = create_group.sync_detailed(client=api_client, body=new_group)
    successful_response_check(response, status_code=201, description='Created')
    is_not_none(response.parsed.group)
    equal(response.parsed.group.additional_properties.get('name'), name)
    equal(response.parsed.group.additional_properties.get('class'), 'once')

    group_id = response.parsed.group.additional_properties.get('id')
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
    # check device return to common group
    device_in_group_check(serial=first_device_serial, group_id=common_group_id, group_name='Common')


# @pytest.mark.focus
def test_return_devices_after_delete_bookable_group(
    api_client,
    api_client_custom_token,
    service_user_token,
    random_str,
    random_user,
    successful_response_check,
    failure_response_check,
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
    # add device to admin bookable group
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
