from typing import TYPE_CHECKING, Any, Dict, List, Type, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.user_group_device_data_columns import UserGroupDeviceDataColumns
    from ..models.user_group_device_data_sort import UserGroupDeviceDataSort


T = TypeVar("T", bound="UserGroupDeviceData")


@_attrs_define
class UserGroupDeviceData:
    """
    Attributes:
        columns (Union[Unset, UserGroupDeviceDataColumns]):
        sort (Union[Unset, UserGroupDeviceDataSort]):
    """

    columns: Union[Unset, "UserGroupDeviceDataColumns"] = UNSET
    sort: Union[Unset, "UserGroupDeviceDataSort"] = UNSET
    additional_properties: Dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        columns: Union[Unset, Dict[str, Any]] = UNSET
        if not isinstance(self.columns, Unset):
            columns = self.columns.to_dict()

        sort: Union[Unset, Dict[str, Any]] = UNSET
        if not isinstance(self.sort, Unset):
            sort = self.sort.to_dict()

        field_dict: Dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if columns is not UNSET:
            field_dict["columns"] = columns
        if sort is not UNSET:
            field_dict["sort"] = sort

        return field_dict

    @classmethod
    def from_dict(cls: Type[T], src_dict: Dict[str, Any]) -> T:
        from ..models.user_group_device_data_columns import UserGroupDeviceDataColumns
        from ..models.user_group_device_data_sort import UserGroupDeviceDataSort

        d = src_dict.copy()
        _columns = d.pop("columns", UNSET)
        columns: Union[Unset, UserGroupDeviceDataColumns]
        if isinstance(_columns, Unset):
            columns = UNSET
        else:
            columns = UserGroupDeviceDataColumns.from_dict(_columns)

        _sort = d.pop("sort", UNSET)
        sort: Union[Unset, UserGroupDeviceDataSort]
        if isinstance(_sort, Unset):
            sort = UNSET
        else:
            sort = UserGroupDeviceDataSort.from_dict(_sort)

        user_group_device_data = cls(
            columns=columns,
            sort=sort,
        )

        user_group_device_data.additional_properties = d
        return user_group_device_data

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
