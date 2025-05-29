from http import HTTPStatus
from typing import Any, Dict, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.auto_test_response import AutoTestResponse
from ...types import UNSET, Response, Unset


def _get_kwargs(
    id: str,
    *,
    amount: int,
    need_amount: Union[Unset, bool] = UNSET,
    abi: Union[Unset, str] = UNSET,
    sdk: Union[Unset, str] = UNSET,
    model: Union[Unset, str] = UNSET,
    type: Union[Unset, str] = UNSET,
    version: Union[Unset, str] = UNSET,
) -> Dict[str, Any]:
    params: Dict[str, Any] = {}

    params["amount"] = amount

    params["need_amount"] = need_amount

    params["abi"] = abi

    params["sdk"] = sdk

    params["model"] = model

    params["type"] = type

    params["version"] = version

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: Dict[str, Any] = {
        "method": "get",
        "url": f"/autotests/{id}/addDevices/",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[AutoTestResponse]:
    if response.status_code == 200:
        response_200 = AutoTestResponse.from_dict(response.json())

        return response_200
    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Response[AutoTestResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    id: str,
    *,
    client: Union[AuthenticatedClient, Client],
    amount: int,
    need_amount: Union[Unset, bool] = UNSET,
    abi: Union[Unset, str] = UNSET,
    sdk: Union[Unset, str] = UNSET,
    model: Union[Unset, str] = UNSET,
    type: Union[Unset, str] = UNSET,
    version: Union[Unset, str] = UNSET,
) -> Response[AutoTestResponse]:
    """Add devices for autotests group

     Filter and add devices to autotests group

    Args:
        id (str):
        amount (int):
        need_amount (Union[Unset, bool]):
        abi (Union[Unset, str]):
        sdk (Union[Unset, str]):
        model (Union[Unset, str]):
        type (Union[Unset, str]):
        version (Union[Unset, str]):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[AutoTestResponse]
    """

    kwargs = _get_kwargs(
        id=id,
        amount=amount,
        need_amount=need_amount,
        abi=abi,
        sdk=sdk,
        model=model,
        type=type,
        version=version,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: str,
    *,
    client: Union[AuthenticatedClient, Client],
    amount: int,
    need_amount: Union[Unset, bool] = UNSET,
    abi: Union[Unset, str] = UNSET,
    sdk: Union[Unset, str] = UNSET,
    model: Union[Unset, str] = UNSET,
    type: Union[Unset, str] = UNSET,
    version: Union[Unset, str] = UNSET,
) -> Optional[AutoTestResponse]:
    """Add devices for autotests group

     Filter and add devices to autotests group

    Args:
        id (str):
        amount (int):
        need_amount (Union[Unset, bool]):
        abi (Union[Unset, str]):
        sdk (Union[Unset, str]):
        model (Union[Unset, str]):
        type (Union[Unset, str]):
        version (Union[Unset, str]):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        AutoTestResponse
    """

    return sync_detailed(
        id=id,
        client=client,
        amount=amount,
        need_amount=need_amount,
        abi=abi,
        sdk=sdk,
        model=model,
        type=type,
        version=version,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: Union[AuthenticatedClient, Client],
    amount: int,
    need_amount: Union[Unset, bool] = UNSET,
    abi: Union[Unset, str] = UNSET,
    sdk: Union[Unset, str] = UNSET,
    model: Union[Unset, str] = UNSET,
    type: Union[Unset, str] = UNSET,
    version: Union[Unset, str] = UNSET,
) -> Response[AutoTestResponse]:
    """Add devices for autotests group

     Filter and add devices to autotests group

    Args:
        id (str):
        amount (int):
        need_amount (Union[Unset, bool]):
        abi (Union[Unset, str]):
        sdk (Union[Unset, str]):
        model (Union[Unset, str]):
        type (Union[Unset, str]):
        version (Union[Unset, str]):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[AutoTestResponse]
    """

    kwargs = _get_kwargs(
        id=id,
        amount=amount,
        need_amount=need_amount,
        abi=abi,
        sdk=sdk,
        model=model,
        type=type,
        version=version,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    *,
    client: Union[AuthenticatedClient, Client],
    amount: int,
    need_amount: Union[Unset, bool] = UNSET,
    abi: Union[Unset, str] = UNSET,
    sdk: Union[Unset, str] = UNSET,
    model: Union[Unset, str] = UNSET,
    type: Union[Unset, str] = UNSET,
    version: Union[Unset, str] = UNSET,
) -> Optional[AutoTestResponse]:
    """Add devices for autotests group

     Filter and add devices to autotests group

    Args:
        id (str):
        amount (int):
        need_amount (Union[Unset, bool]):
        abi (Union[Unset, str]):
        sdk (Union[Unset, str]):
        model (Union[Unset, str]):
        type (Union[Unset, str]):
        version (Union[Unset, str]):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        AutoTestResponse
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            amount=amount,
            need_amount=need_amount,
            abi=abi,
            sdk=sdk,
            model=model,
            type=type,
            version=version,
        )
    ).parsed
