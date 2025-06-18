from typing import TYPE_CHECKING, Any, Dict, List, Type, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.group_class import GroupClass
from ..models.group_state import GroupState
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.group_dates_item import GroupDatesItem
    from ..models.group_lock import GroupLock
    from ..models.group_owner import GroupOwner


T = TypeVar("T", bound="Group")


@_attrs_define
class Group:
    """A null value means the group is unchanged

    Attributes:
        field_id (Union[Unset, str]):
        name (Union[Unset, str]):
        owner (Union[Unset, GroupOwner]):
        users (Union[Unset, List[str]]):
        privilege (Union[Unset, str]):
        class_ (Union[Unset, GroupClass]): Group class; privileged value => debug, bookable, standard
        repetitions (Union[Unset, int]): Group repetitions; default value => 0
        duration (Union[Unset, int]):
        is_active (Union[Unset, bool]):
        state (Union[Unset, GroupState]): Group state; default value => pending or ready for bookable/standard classes
        dates (Union[Unset, List['GroupDatesItem']]):
        env_user_groups_number (Union[Unset, int]):
        env_user_groups_duration (Union[Unset, int]):
        env_user_groups_repetitions (Union[Unset, int]):
        id (Union[Unset, str]):
        devices (Union[Unset, List[str]]):
        lock (Union[Unset, GroupLock]):
        run_url (Union[None, Unset, str]):
    """

    field_id: Union[Unset, str] = UNSET
    name: Union[Unset, str] = UNSET
    owner: Union[Unset, "GroupOwner"] = UNSET
    users: Union[Unset, List[str]] = UNSET
    privilege: Union[Unset, str] = UNSET
    class_: Union[Unset, GroupClass] = UNSET
    repetitions: Union[Unset, int] = UNSET
    duration: Union[Unset, int] = UNSET
    is_active: Union[Unset, bool] = UNSET
    state: Union[Unset, GroupState] = UNSET
    dates: Union[Unset, List["GroupDatesItem"]] = UNSET
    env_user_groups_number: Union[Unset, int] = UNSET
    env_user_groups_duration: Union[Unset, int] = UNSET
    env_user_groups_repetitions: Union[Unset, int] = UNSET
    id: Union[Unset, str] = UNSET
    devices: Union[Unset, List[str]] = UNSET
    lock: Union[Unset, "GroupLock"] = UNSET
    run_url: Union[None, Unset, str] = UNSET
    additional_properties: Dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        field_id = self.field_id

        name = self.name

        owner: Union[Unset, Dict[str, Any]] = UNSET
        if not isinstance(self.owner, Unset):
            owner = self.owner.to_dict()

        users: Union[Unset, List[str]] = UNSET
        if not isinstance(self.users, Unset):
            users = self.users

        privilege = self.privilege

        class_: Union[Unset, str] = UNSET
        if not isinstance(self.class_, Unset):
            class_ = self.class_.value

        repetitions = self.repetitions

        duration = self.duration

        is_active = self.is_active

        state: Union[Unset, str] = UNSET
        if not isinstance(self.state, Unset):
            state = self.state.value

        dates: Union[Unset, List[Dict[str, Any]]] = UNSET
        if not isinstance(self.dates, Unset):
            dates = []
            for dates_item_data in self.dates:
                dates_item = dates_item_data.to_dict()
                dates.append(dates_item)

        env_user_groups_number = self.env_user_groups_number

        env_user_groups_duration = self.env_user_groups_duration

        env_user_groups_repetitions = self.env_user_groups_repetitions

        id = self.id

        devices: Union[Unset, List[str]] = UNSET
        if not isinstance(self.devices, Unset):
            devices = self.devices

        lock: Union[Unset, Dict[str, Any]] = UNSET
        if not isinstance(self.lock, Unset):
            lock = self.lock.to_dict()

        run_url: Union[None, Unset, str]
        if isinstance(self.run_url, Unset):
            run_url = UNSET
        else:
            run_url = self.run_url

        field_dict: Dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if field_id is not UNSET:
            field_dict["_id"] = field_id
        if name is not UNSET:
            field_dict["name"] = name
        if owner is not UNSET:
            field_dict["owner"] = owner
        if users is not UNSET:
            field_dict["users"] = users
        if privilege is not UNSET:
            field_dict["privilege"] = privilege
        if class_ is not UNSET:
            field_dict["class"] = class_
        if repetitions is not UNSET:
            field_dict["repetitions"] = repetitions
        if duration is not UNSET:
            field_dict["duration"] = duration
        if is_active is not UNSET:
            field_dict["isActive"] = is_active
        if state is not UNSET:
            field_dict["state"] = state
        if dates is not UNSET:
            field_dict["dates"] = dates
        if env_user_groups_number is not UNSET:
            field_dict["envUserGroupsNumber"] = env_user_groups_number
        if env_user_groups_duration is not UNSET:
            field_dict["envUserGroupsDuration"] = env_user_groups_duration
        if env_user_groups_repetitions is not UNSET:
            field_dict["envUserGroupsRepetitions"] = env_user_groups_repetitions
        if id is not UNSET:
            field_dict["id"] = id
        if devices is not UNSET:
            field_dict["devices"] = devices
        if lock is not UNSET:
            field_dict["lock"] = lock
        if run_url is not UNSET:
            field_dict["runUrl"] = run_url

        return field_dict

    @classmethod
    def from_dict(cls: Type[T], src_dict: Dict[str, Any]) -> T:
        from ..models.group_dates_item import GroupDatesItem
        from ..models.group_lock import GroupLock
        from ..models.group_owner import GroupOwner

        d = src_dict.copy()
        field_id = d.pop("_id", UNSET)

        name = d.pop("name", UNSET)

        _owner = d.pop("owner", UNSET)
        owner: Union[Unset, GroupOwner]
        if isinstance(_owner, Unset):
            owner = UNSET
        else:
            owner = GroupOwner.from_dict(_owner)

        users = cast(List[str], d.pop("users", UNSET))

        privilege = d.pop("privilege", UNSET)

        _class_ = d.pop("class", UNSET)
        class_: Union[Unset, GroupClass]
        if isinstance(_class_, Unset):
            class_ = UNSET
        else:
            class_ = GroupClass(_class_)

        repetitions = d.pop("repetitions", UNSET)

        duration = d.pop("duration", UNSET)

        is_active = d.pop("isActive", UNSET)

        _state = d.pop("state", UNSET)
        state: Union[Unset, GroupState]
        if isinstance(_state, Unset):
            state = UNSET
        else:
            state = GroupState(_state)

        dates = []
        _dates = d.pop("dates", UNSET)
        for dates_item_data in _dates or []:
            dates_item = GroupDatesItem.from_dict(dates_item_data)

            dates.append(dates_item)

        env_user_groups_number = d.pop("envUserGroupsNumber", UNSET)

        env_user_groups_duration = d.pop("envUserGroupsDuration", UNSET)

        env_user_groups_repetitions = d.pop("envUserGroupsRepetitions", UNSET)

        id = d.pop("id", UNSET)

        devices = cast(List[str], d.pop("devices", UNSET))

        _lock = d.pop("lock", UNSET)
        lock: Union[Unset, GroupLock]
        if isinstance(_lock, Unset):
            lock = UNSET
        else:
            lock = GroupLock.from_dict(_lock)

        def _parse_run_url(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        run_url = _parse_run_url(d.pop("runUrl", UNSET))

        group = cls(
            field_id=field_id,
            name=name,
            owner=owner,
            users=users,
            privilege=privilege,
            class_=class_,
            repetitions=repetitions,
            duration=duration,
            is_active=is_active,
            state=state,
            dates=dates,
            env_user_groups_number=env_user_groups_number,
            env_user_groups_duration=env_user_groups_duration,
            env_user_groups_repetitions=env_user_groups_repetitions,
            id=id,
            devices=devices,
            lock=lock,
            run_url=run_url,
        )

        group.additional_properties = d
        return group

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
