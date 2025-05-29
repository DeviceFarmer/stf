from http import HTTPStatus
from typing import Any, Dict, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.generate_fake_device_response_200 import GenerateFakeDeviceResponse200
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    number: Union[Unset, float] = 1.0,
) -> Dict[str, Any]:
    params: Dict[str, Any] = {}

    params["number"] = number

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: Dict[str, Any] = {
        "method": "get",
        "url": "/devices/fake",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[GenerateFakeDeviceResponse200]:
    if response.status_code == 200:
        response_200 = GenerateFakeDeviceResponse200.from_dict(response.json())

        return response_200
    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Response[GenerateFakeDeviceResponse200]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: Union[AuthenticatedClient, Client],
    number: Union[Unset, float] = 1.0,
) -> Response[GenerateFakeDeviceResponse200]:
    """Device List

     Method generates fake devices ame as stf generate-fake-device

    Args:
        number (Union[Unset, float]):  Default: 1.0.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GenerateFakeDeviceResponse200]
    """

    kwargs = _get_kwargs(
        number=number,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: Union[AuthenticatedClient, Client],
    number: Union[Unset, float] = 1.0,
) -> Optional[GenerateFakeDeviceResponse200]:
    """Device List

     Method generates fake devices ame as stf generate-fake-device

    Args:
        number (Union[Unset, float]):  Default: 1.0.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GenerateFakeDeviceResponse200
    """

    return sync_detailed(
        client=client,
        number=number,
    ).parsed


async def asyncio_detailed(
    *,
    client: Union[AuthenticatedClient, Client],
    number: Union[Unset, float] = 1.0,
) -> Response[GenerateFakeDeviceResponse200]:
    """Device List

     Method generates fake devices ame as stf generate-fake-device

    Args:
        number (Union[Unset, float]):  Default: 1.0.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GenerateFakeDeviceResponse200]
    """

    kwargs = _get_kwargs(
        number=number,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: Union[AuthenticatedClient, Client],
    number: Union[Unset, float] = 1.0,
) -> Optional[GenerateFakeDeviceResponse200]:
    """Device List

     Method generates fake devices ame as stf generate-fake-device

    Args:
        number (Union[Unset, float]):  Default: 1.0.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GenerateFakeDeviceResponse200
    """

    return (
        await asyncio_detailed(
            client=client,
            number=number,
        )
    ).parsed
