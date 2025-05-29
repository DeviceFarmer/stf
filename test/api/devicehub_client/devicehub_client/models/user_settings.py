from typing import TYPE_CHECKING, Any, Dict, List, Type, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.user_settings_alert_message import UserSettingsAlertMessage
    from ..models.user_settings_device_list_columns_item import UserSettingsDeviceListColumnsItem
    from ..models.user_settings_device_list_sort import UserSettingsDeviceListSort
    from ..models.user_settings_group_items_per_page import UserSettingsGroupItemsPerPage


T = TypeVar("T", bound="UserSettings")


@_attrs_define
class UserSettings:
    """
    Attributes:
        last_used_device (Union[Unset, str]):
        date_format (Union[Unset, str]):
        email_address_separator (Union[Unset, str]):
        alert_message (Union[Unset, UserSettingsAlertMessage]):
        platform (Union[Unset, str]):
        group_items_per_page (Union[Unset, UserSettingsGroupItemsPerPage]):
        device_list_columns (Union[Unset, List['UserSettingsDeviceListColumnsItem']]):
        selected_language (Union[Unset, str]):
        device_list_sort (Union[Unset, UserSettingsDeviceListSort]):
    """

    last_used_device: Union[Unset, str] = UNSET
    date_format: Union[Unset, str] = UNSET
    email_address_separator: Union[Unset, str] = UNSET
    alert_message: Union[Unset, "UserSettingsAlertMessage"] = UNSET
    platform: Union[Unset, str] = UNSET
    group_items_per_page: Union[Unset, "UserSettingsGroupItemsPerPage"] = UNSET
    device_list_columns: Union[Unset, List["UserSettingsDeviceListColumnsItem"]] = UNSET
    selected_language: Union[Unset, str] = UNSET
    device_list_sort: Union[Unset, "UserSettingsDeviceListSort"] = UNSET
    additional_properties: Dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        last_used_device = self.last_used_device

        date_format = self.date_format

        email_address_separator = self.email_address_separator

        alert_message: Union[Unset, Dict[str, Any]] = UNSET
        if not isinstance(self.alert_message, Unset):
            alert_message = self.alert_message.to_dict()

        platform = self.platform

        group_items_per_page: Union[Unset, Dict[str, Any]] = UNSET
        if not isinstance(self.group_items_per_page, Unset):
            group_items_per_page = self.group_items_per_page.to_dict()

        device_list_columns: Union[Unset, List[Dict[str, Any]]] = UNSET
        if not isinstance(self.device_list_columns, Unset):
            device_list_columns = []
            for device_list_columns_item_data in self.device_list_columns:
                device_list_columns_item = device_list_columns_item_data.to_dict()
                device_list_columns.append(device_list_columns_item)

        selected_language = self.selected_language

        device_list_sort: Union[Unset, Dict[str, Any]] = UNSET
        if not isinstance(self.device_list_sort, Unset):
            device_list_sort = self.device_list_sort.to_dict()

        field_dict: Dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if last_used_device is not UNSET:
            field_dict["lastUsedDevice"] = last_used_device
        if date_format is not UNSET:
            field_dict["dateFormat"] = date_format
        if email_address_separator is not UNSET:
            field_dict["emailAddressSeparator"] = email_address_separator
        if alert_message is not UNSET:
            field_dict["alertMessage"] = alert_message
        if platform is not UNSET:
            field_dict["platform"] = platform
        if group_items_per_page is not UNSET:
            field_dict["groupItemsPerPage"] = group_items_per_page
        if device_list_columns is not UNSET:
            field_dict["deviceListColumns"] = device_list_columns
        if selected_language is not UNSET:
            field_dict["selectedLanguage"] = selected_language
        if device_list_sort is not UNSET:
            field_dict["deviceListSort"] = device_list_sort

        return field_dict

    @classmethod
    def from_dict(cls: Type[T], src_dict: Dict[str, Any]) -> T:
        from ..models.user_settings_alert_message import UserSettingsAlertMessage
        from ..models.user_settings_device_list_columns_item import UserSettingsDeviceListColumnsItem
        from ..models.user_settings_device_list_sort import UserSettingsDeviceListSort
        from ..models.user_settings_group_items_per_page import UserSettingsGroupItemsPerPage

        d = src_dict.copy()
        last_used_device = d.pop("lastUsedDevice", UNSET)

        date_format = d.pop("dateFormat", UNSET)

        email_address_separator = d.pop("emailAddressSeparator", UNSET)

        _alert_message = d.pop("alertMessage", UNSET)
        alert_message: Union[Unset, UserSettingsAlertMessage]
        if isinstance(_alert_message, Unset):
            alert_message = UNSET
        else:
            alert_message = UserSettingsAlertMessage.from_dict(_alert_message)

        platform = d.pop("platform", UNSET)

        _group_items_per_page = d.pop("groupItemsPerPage", UNSET)
        group_items_per_page: Union[Unset, UserSettingsGroupItemsPerPage]
        if isinstance(_group_items_per_page, Unset):
            group_items_per_page = UNSET
        else:
            group_items_per_page = UserSettingsGroupItemsPerPage.from_dict(_group_items_per_page)

        device_list_columns = []
        _device_list_columns = d.pop("deviceListColumns", UNSET)
        for device_list_columns_item_data in _device_list_columns or []:
            device_list_columns_item = UserSettingsDeviceListColumnsItem.from_dict(device_list_columns_item_data)

            device_list_columns.append(device_list_columns_item)

        selected_language = d.pop("selectedLanguage", UNSET)

        _device_list_sort = d.pop("deviceListSort", UNSET)
        device_list_sort: Union[Unset, UserSettingsDeviceListSort]
        if isinstance(_device_list_sort, Unset):
            device_list_sort = UNSET
        else:
            device_list_sort = UserSettingsDeviceListSort.from_dict(_device_list_sort)

        user_settings = cls(
            last_used_device=last_used_device,
            date_format=date_format,
            email_address_separator=email_address_separator,
            alert_message=alert_message,
            platform=platform,
            group_items_per_page=group_items_per_page,
            device_list_columns=device_list_columns,
            selected_language=selected_language,
            device_list_sort=device_list_sort,
        )

        user_settings.additional_properties = d
        return user_settings

    @property
    def additional_keys(self) -> List[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
