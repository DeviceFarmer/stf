from typing import Any, Dict, List, Type, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="DeviceBattery")


@_attrs_define
class DeviceBattery:
    """
    Attributes:
        status (Union[Unset, str]):
        health (Union[Unset, str]):
        source (Union[Unset, str]):
        level (Union[Unset, int]):
        scale (Union[Unset, int]):
        temp (Union[Unset, int]):
        voltage (Union[Unset, int]):
    """

    status: Union[Unset, str] = UNSET
    health: Union[Unset, str] = UNSET
    source: Union[Unset, str] = UNSET
    level: Union[Unset, int] = UNSET
    scale: Union[Unset, int] = UNSET
    temp: Union[Unset, int] = UNSET
    voltage: Union[Unset, int] = UNSET
    additional_properties: Dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        status = self.status

        health = self.health

        source = self.source

        level = self.level

        scale = self.scale

        temp = self.temp

        voltage = self.voltage

        field_dict: Dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if status is not UNSET:
            field_dict["status"] = status
        if health is not UNSET:
            field_dict["health"] = health
        if source is not UNSET:
            field_dict["source"] = source
        if level is not UNSET:
            field_dict["level"] = level
        if scale is not UNSET:
            field_dict["scale"] = scale
        if temp is not UNSET:
            field_dict["temp"] = temp
        if voltage is not UNSET:
            field_dict["voltage"] = voltage

        return field_dict

    @classmethod
    def from_dict(cls: Type[T], src_dict: Dict[str, Any]) -> T:
        d = src_dict.copy()
        status = d.pop("status", UNSET)

        health = d.pop("health", UNSET)

        source = d.pop("source", UNSET)

        level = d.pop("level", UNSET)

        scale = d.pop("scale", UNSET)

        temp = d.pop("temp", UNSET)

        voltage = d.pop("voltage", UNSET)

        device_battery = cls(
            status=status,
            health=health,
            source=source,
            level=level,
            scale=scale,
            temp=temp,
            voltage=voltage,
        )

        device_battery.additional_properties = d
        return device_battery

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
