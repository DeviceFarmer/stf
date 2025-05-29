from typing import Any, Dict, List, Type, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="UserGroupDeviceDataColumns")


@_attrs_define
class UserGroupDeviceDataColumns:
    """
    Attributes:
        name (Union[Unset, str]):
        selected (Union[Unset, bool]):
        sort (Union[Unset, str]):
    """

    name: Union[Unset, str] = UNSET
    selected: Union[Unset, bool] = UNSET
    sort: Union[Unset, str] = UNSET
    additional_properties: Dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        name = self.name

        selected = self.selected

        sort = self.sort

        field_dict: Dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if selected is not UNSET:
            field_dict["selected"] = selected
        if sort is not UNSET:
            field_dict["sort"] = sort

        return field_dict

    @classmethod
    def from_dict(cls: Type[T], src_dict: Dict[str, Any]) -> T:
        d = src_dict.copy()
        name = d.pop("name", UNSET)

        selected = d.pop("selected", UNSET)

        sort = d.pop("sort", UNSET)

        user_group_device_data_columns = cls(
            name=name,
            selected=selected,
            sort=sort,
        )

        user_group_device_data_columns.additional_properties = d
        return user_group_device_data_columns

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
