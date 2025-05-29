from typing import TYPE_CHECKING, Any, Dict, List, Type, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.user_groups_quotas_allocated import UserGroupsQuotasAllocated
    from ..models.user_groups_quotas_consumed import UserGroupsQuotasConsumed


T = TypeVar("T", bound="UserGroupsQuotas")


@_attrs_define
class UserGroupsQuotas:
    """
    Attributes:
        allocated (Union[Unset, UserGroupsQuotasAllocated]):
        consumed (Union[Unset, UserGroupsQuotasConsumed]):
        default_groups_number (Union[Unset, float]):
        default_groups_duration (Union[Unset, float]):
        default_groups_repetitions (Union[Unset, float]):
        repetitions (Union[Unset, int]):
    """

    allocated: Union[Unset, "UserGroupsQuotasAllocated"] = UNSET
    consumed: Union[Unset, "UserGroupsQuotasConsumed"] = UNSET
    default_groups_number: Union[Unset, float] = UNSET
    default_groups_duration: Union[Unset, float] = UNSET
    default_groups_repetitions: Union[Unset, float] = UNSET
    repetitions: Union[Unset, int] = UNSET
    additional_properties: Dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        allocated: Union[Unset, Dict[str, Any]] = UNSET
        if not isinstance(self.allocated, Unset):
            allocated = self.allocated.to_dict()

        consumed: Union[Unset, Dict[str, Any]] = UNSET
        if not isinstance(self.consumed, Unset):
            consumed = self.consumed.to_dict()

        default_groups_number = self.default_groups_number

        default_groups_duration = self.default_groups_duration

        default_groups_repetitions = self.default_groups_repetitions

        repetitions = self.repetitions

        field_dict: Dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if allocated is not UNSET:
            field_dict["allocated"] = allocated
        if consumed is not UNSET:
            field_dict["consumed"] = consumed
        if default_groups_number is not UNSET:
            field_dict["defaultGroupsNumber"] = default_groups_number
        if default_groups_duration is not UNSET:
            field_dict["defaultGroupsDuration"] = default_groups_duration
        if default_groups_repetitions is not UNSET:
            field_dict["defaultGroupsRepetitions"] = default_groups_repetitions
        if repetitions is not UNSET:
            field_dict["repetitions"] = repetitions

        return field_dict

    @classmethod
    def from_dict(cls: Type[T], src_dict: Dict[str, Any]) -> T:
        from ..models.user_groups_quotas_allocated import UserGroupsQuotasAllocated
        from ..models.user_groups_quotas_consumed import UserGroupsQuotasConsumed

        d = src_dict.copy()
        _allocated = d.pop("allocated", UNSET)
        allocated: Union[Unset, UserGroupsQuotasAllocated]
        if isinstance(_allocated, Unset):
            allocated = UNSET
        else:
            allocated = UserGroupsQuotasAllocated.from_dict(_allocated)

        _consumed = d.pop("consumed", UNSET)
        consumed: Union[Unset, UserGroupsQuotasConsumed]
        if isinstance(_consumed, Unset):
            consumed = UNSET
        else:
            consumed = UserGroupsQuotasConsumed.from_dict(_consumed)

        default_groups_number = d.pop("defaultGroupsNumber", UNSET)

        default_groups_duration = d.pop("defaultGroupsDuration", UNSET)

        default_groups_repetitions = d.pop("defaultGroupsRepetitions", UNSET)

        repetitions = d.pop("repetitions", UNSET)

        user_groups_quotas = cls(
            allocated=allocated,
            consumed=consumed,
            default_groups_number=default_groups_number,
            default_groups_duration=default_groups_duration,
            default_groups_repetitions=default_groups_repetitions,
            repetitions=repetitions,
        )

        user_groups_quotas.additional_properties = d
        return user_groups_quotas

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
