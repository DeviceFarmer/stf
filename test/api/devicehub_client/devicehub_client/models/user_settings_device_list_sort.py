from typing import TYPE_CHECKING, Any, Dict, List, Type, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.user_settings_device_list_sort_fixed_item import UserSettingsDeviceListSortFixedItem
    from ..models.user_settings_device_list_sort_user_item import UserSettingsDeviceListSortUserItem


T = TypeVar("T", bound="UserSettingsDeviceListSort")


@_attrs_define
class UserSettingsDeviceListSort:
    """
    Attributes:
        fixed (Union[Unset, List['UserSettingsDeviceListSortFixedItem']]):
        user (Union[Unset, List['UserSettingsDeviceListSortUserItem']]):
    """

    fixed: Union[Unset, List["UserSettingsDeviceListSortFixedItem"]] = UNSET
    user: Union[Unset, List["UserSettingsDeviceListSortUserItem"]] = UNSET
    additional_properties: Dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        fixed: Union[Unset, List[Dict[str, Any]]] = UNSET
        if not isinstance(self.fixed, Unset):
            fixed = []
            for fixed_item_data in self.fixed:
                fixed_item = fixed_item_data.to_dict()
                fixed.append(fixed_item)

        user: Union[Unset, List[Dict[str, Any]]] = UNSET
        if not isinstance(self.user, Unset):
            user = []
            for user_item_data in self.user:
                user_item = user_item_data.to_dict()
                user.append(user_item)

        field_dict: Dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if fixed is not UNSET:
            field_dict["fixed"] = fixed
        if user is not UNSET:
            field_dict["user"] = user

        return field_dict

    @classmethod
    def from_dict(cls: Type[T], src_dict: Dict[str, Any]) -> T:
        from ..models.user_settings_device_list_sort_fixed_item import UserSettingsDeviceListSortFixedItem
        from ..models.user_settings_device_list_sort_user_item import UserSettingsDeviceListSortUserItem

        d = src_dict.copy()
        fixed = []
        _fixed = d.pop("fixed", UNSET)
        for fixed_item_data in _fixed or []:
            fixed_item = UserSettingsDeviceListSortFixedItem.from_dict(fixed_item_data)

            fixed.append(fixed_item)

        user = []
        _user = d.pop("user", UNSET)
        for user_item_data in _user or []:
            user_item = UserSettingsDeviceListSortUserItem.from_dict(user_item_data)

            user.append(user_item)

        user_settings_device_list_sort = cls(
            fixed=fixed,
            user=user,
        )

        user_settings_device_list_sort.additional_properties = d
        return user_settings_device_list_sort

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
