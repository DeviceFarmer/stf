from typing import TYPE_CHECKING, Any, Dict, List, Type, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.auto_test_response_group import AutoTestResponseGroup


T = TypeVar("T", bound="AutoTestResponse")


@_attrs_define
class AutoTestResponse:
    """
    Attributes:
        success (bool):
        description (str):
        group (Union[Unset, AutoTestResponseGroup]):
    """

    success: bool
    description: str
    group: Union[Unset, "AutoTestResponseGroup"] = UNSET
    additional_properties: Dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        success = self.success

        description = self.description

        group: Union[Unset, Dict[str, Any]] = UNSET
        if not isinstance(self.group, Unset):
            group = self.group.to_dict()

        field_dict: Dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "success": success,
                "description": description,
            }
        )
        if group is not UNSET:
            field_dict["group"] = group

        return field_dict

    @classmethod
    def from_dict(cls: Type[T], src_dict: Dict[str, Any]) -> T:
        from ..models.auto_test_response_group import AutoTestResponseGroup

        d = src_dict.copy()
        success = d.pop("success")

        description = d.pop("description")

        _group = d.pop("group", UNSET)
        group: Union[Unset, AutoTestResponseGroup]
        if isinstance(_group, Unset):
            group = UNSET
        else:
            group = AutoTestResponseGroup.from_dict(_group)

        auto_test_response = cls(
            success=success,
            description=description,
            group=group,
        )

        auto_test_response.additional_properties = d
        return auto_test_response

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
