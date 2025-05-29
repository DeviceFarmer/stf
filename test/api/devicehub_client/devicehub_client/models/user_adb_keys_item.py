from typing import Any, Dict, List, Type, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="UserAdbKeysItem")


@_attrs_define
class UserAdbKeysItem:
    """
    Attributes:
        fingerprint (Union[Unset, str]):
        title (Union[Unset, str]):
    """

    fingerprint: Union[Unset, str] = UNSET
    title: Union[Unset, str] = UNSET
    additional_properties: Dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        fingerprint = self.fingerprint

        title = self.title

        field_dict: Dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if fingerprint is not UNSET:
            field_dict["fingerprint"] = fingerprint
        if title is not UNSET:
            field_dict["title"] = title

        return field_dict

    @classmethod
    def from_dict(cls: Type[T], src_dict: Dict[str, Any]) -> T:
        d = src_dict.copy()
        fingerprint = d.pop("fingerprint", UNSET)

        title = d.pop("title", UNSET)

        user_adb_keys_item = cls(
            fingerprint=fingerprint,
            title=title,
        )

        user_adb_keys_item.additional_properties = d
        return user_adb_keys_item

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
