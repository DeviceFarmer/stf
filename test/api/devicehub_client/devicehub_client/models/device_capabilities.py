from typing import Any, Dict, List, Type, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="DeviceCapabilities")


@_attrs_define
class DeviceCapabilities:
    """
    Attributes:
        has_touch (bool):
        has_cursor (bool):
    """

    has_touch: bool
    has_cursor: bool
    additional_properties: Dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        has_touch = self.has_touch

        has_cursor = self.has_cursor

        field_dict: Dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "hasTouch": has_touch,
                "hasCursor": has_cursor,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: Type[T], src_dict: Dict[str, Any]) -> T:
        d = src_dict.copy()
        has_touch = d.pop("hasTouch")

        has_cursor = d.pop("hasCursor")

        device_capabilities = cls(
            has_touch=has_touch,
            has_cursor=has_cursor,
        )

        device_capabilities.additional_properties = d
        return device_capabilities

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
