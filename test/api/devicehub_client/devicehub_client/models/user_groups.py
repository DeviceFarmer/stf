from typing import TYPE_CHECKING, Any, Dict, List, Type, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.user_groups_quotas import UserGroupsQuotas


T = TypeVar("T", bound="UserGroups")


@_attrs_define
class UserGroups:
    """
    Attributes:
        subscribed (Union[Unset, List[str]]):
        lock (Union[Unset, bool]):
        quotas (Union[Unset, UserGroupsQuotas]):
    """

    subscribed: Union[Unset, List[str]] = UNSET
    lock: Union[Unset, bool] = UNSET
    quotas: Union[Unset, "UserGroupsQuotas"] = UNSET
    additional_properties: Dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        subscribed: Union[Unset, List[str]] = UNSET
        if not isinstance(self.subscribed, Unset):
            subscribed = self.subscribed

        lock = self.lock

        quotas: Union[Unset, Dict[str, Any]] = UNSET
        if not isinstance(self.quotas, Unset):
            quotas = self.quotas.to_dict()

        field_dict: Dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if subscribed is not UNSET:
            field_dict["subscribed"] = subscribed
        if lock is not UNSET:
            field_dict["lock"] = lock
        if quotas is not UNSET:
            field_dict["quotas"] = quotas

        return field_dict

    @classmethod
    def from_dict(cls: Type[T], src_dict: Dict[str, Any]) -> T:
        from ..models.user_groups_quotas import UserGroupsQuotas

        d = src_dict.copy()
        subscribed = cast(List[str], d.pop("subscribed", UNSET))

        lock = d.pop("lock", UNSET)

        _quotas = d.pop("quotas", UNSET)
        quotas: Union[Unset, UserGroupsQuotas]
        if isinstance(_quotas, Unset):
            quotas = UNSET
        else:
            quotas = UserGroupsQuotas.from_dict(_quotas)

        user_groups = cls(
            subscribed=subscribed,
            lock=lock,
            quotas=quotas,
        )

        user_groups.additional_properties = d
        return user_groups

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
