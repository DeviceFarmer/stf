import datetime
from typing import TYPE_CHECKING, Any, Dict, List, Type, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.device_battery import DeviceBattery
    from ..models.device_browser import DeviceBrowser
    from ..models.device_capabilities import DeviceCapabilities
    from ..models.device_cpu import DeviceCpu
    from ..models.device_display import DeviceDisplay
    from ..models.device_group import DeviceGroup
    from ..models.device_memory import DeviceMemory
    from ..models.device_network import DeviceNetwork
    from ..models.device_owner_type_0 import DeviceOwnerType0
    from ..models.device_phone import DevicePhone
    from ..models.device_provider import DeviceProvider
    from ..models.device_reverse_forwards_item import DeviceReverseForwardsItem
    from ..models.device_service import DeviceService


T = TypeVar("T", bound="Device")


@_attrs_define
class Device:
    """
    Attributes:
        field_id (Union[Unset, str]):
        present (Union[Unset, bool]):
        presence_changed_at (Union[Unset, datetime.datetime]):
        provider (Union[Unset, DeviceProvider]):
        owner (Union['DeviceOwnerType0', None, Unset]):
        status (Union[Unset, int]):
        status_changed_at (Union[Unset, datetime.datetime]):
        booked_before (Union[Unset, int]):
        ready (Union[Unset, bool]):
        reverse_forwards (Union[Unset, List['DeviceReverseForwardsItem']]):
        remote_connect (Union[Unset, bool]):
        remote_connect_url (Union[None, Unset, str]):
        usage (Union[None, Unset, str]):
        logs_enabled (Union[Unset, bool]):
        serial (Union[Unset, str]):
        created_at (Union[Unset, datetime.datetime]):
        group (Union[Unset, DeviceGroup]):
        adb_port (Union[Unset, int]):
        network (Union[Unset, DeviceNetwork]):
        display (Union[Unset, DeviceDisplay]):
        airplane_mode (Union[Unset, bool]):
        battery (Union[Unset, DeviceBattery]):
        browser (Union[Unset, DeviceBrowser]):
        service (Union[Unset, DeviceService]):
        channel (Union[Unset, str]):
        abi (Union[Unset, str]):
        cpu_platform (Union[Unset, str]):
        mac_address (Union[Unset, str]):
        manufacturer (Union[Unset, str]):
        market_name (Union[Unset, str]):
        model (Union[Unset, str]):
        open_gles_version (Union[Unset, str]):
        operator (Union[None, Unset, str]):
        phone (Union[Unset, DevicePhone]):
        platform (Union[Unset, str]):
        ios_client_channel (Union[Unset, str]):
        ios (Union[Unset, bool]):
        product (Union[Unset, str]):
        ram (Union[Unset, str]):
        sdk (Union[Unset, str]):
        version (Union[Unset, str]):
        usage_changed_at (Union[Unset, datetime.datetime]):
        notes (Union[Unset, str]):
        place (Union[Unset, str]):
        storage_id (Union[Unset, str]):
        screen_port (Union[Unset, float]):
        connect_port (Union[Unset, float]):
        cpu (Union[Unset, DeviceCpu]):
        memory (Union[Unset, DeviceMemory]):
        image (Union[Unset, str]):
        released_at (Union[Unset, datetime.datetime]):
        name (Union[Unset, str]):
        device_type (Union[Unset, str]):
        likely_leave_reason (Union[Unset, str]):
        using (Union[Unset, bool]):
        capabilities (Union[Unset, DeviceCapabilities]):
    """

    field_id: Union[Unset, str] = UNSET
    present: Union[Unset, bool] = UNSET
    presence_changed_at: Union[Unset, datetime.datetime] = UNSET
    provider: Union[Unset, "DeviceProvider"] = UNSET
    owner: Union["DeviceOwnerType0", None, Unset] = UNSET
    status: Union[Unset, int] = UNSET
    status_changed_at: Union[Unset, datetime.datetime] = UNSET
    booked_before: Union[Unset, int] = UNSET
    ready: Union[Unset, bool] = UNSET
    reverse_forwards: Union[Unset, List["DeviceReverseForwardsItem"]] = UNSET
    remote_connect: Union[Unset, bool] = UNSET
    remote_connect_url: Union[None, Unset, str] = UNSET
    usage: Union[None, Unset, str] = UNSET
    logs_enabled: Union[Unset, bool] = UNSET
    serial: Union[Unset, str] = UNSET
    created_at: Union[Unset, datetime.datetime] = UNSET
    group: Union[Unset, "DeviceGroup"] = UNSET
    adb_port: Union[Unset, int] = UNSET
    network: Union[Unset, "DeviceNetwork"] = UNSET
    display: Union[Unset, "DeviceDisplay"] = UNSET
    airplane_mode: Union[Unset, bool] = UNSET
    battery: Union[Unset, "DeviceBattery"] = UNSET
    browser: Union[Unset, "DeviceBrowser"] = UNSET
    service: Union[Unset, "DeviceService"] = UNSET
    channel: Union[Unset, str] = UNSET
    abi: Union[Unset, str] = UNSET
    cpu_platform: Union[Unset, str] = UNSET
    mac_address: Union[Unset, str] = UNSET
    manufacturer: Union[Unset, str] = UNSET
    market_name: Union[Unset, str] = UNSET
    model: Union[Unset, str] = UNSET
    open_gles_version: Union[Unset, str] = UNSET
    operator: Union[None, Unset, str] = UNSET
    phone: Union[Unset, "DevicePhone"] = UNSET
    platform: Union[Unset, str] = UNSET
    ios_client_channel: Union[Unset, str] = UNSET
    ios: Union[Unset, bool] = UNSET
    product: Union[Unset, str] = UNSET
    ram: Union[Unset, str] = UNSET
    sdk: Union[Unset, str] = UNSET
    version: Union[Unset, str] = UNSET
    usage_changed_at: Union[Unset, datetime.datetime] = UNSET
    notes: Union[Unset, str] = UNSET
    place: Union[Unset, str] = UNSET
    storage_id: Union[Unset, str] = UNSET
    screen_port: Union[Unset, float] = UNSET
    connect_port: Union[Unset, float] = UNSET
    cpu: Union[Unset, "DeviceCpu"] = UNSET
    memory: Union[Unset, "DeviceMemory"] = UNSET
    image: Union[Unset, str] = UNSET
    released_at: Union[Unset, datetime.datetime] = UNSET
    name: Union[Unset, str] = UNSET
    device_type: Union[Unset, str] = UNSET
    likely_leave_reason: Union[Unset, str] = UNSET
    using: Union[Unset, bool] = UNSET
    capabilities: Union[Unset, "DeviceCapabilities"] = UNSET
    additional_properties: Dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        from ..models.device_owner_type_0 import DeviceOwnerType0

        field_id = self.field_id

        present = self.present

        presence_changed_at: Union[Unset, str] = UNSET
        if not isinstance(self.presence_changed_at, Unset):
            presence_changed_at = self.presence_changed_at.isoformat()

        provider: Union[Unset, Dict[str, Any]] = UNSET
        if not isinstance(self.provider, Unset):
            provider = self.provider.to_dict()

        owner: Union[Dict[str, Any], None, Unset]
        if isinstance(self.owner, Unset):
            owner = UNSET
        elif isinstance(self.owner, DeviceOwnerType0):
            owner = self.owner.to_dict()
        else:
            owner = self.owner

        status = self.status

        status_changed_at: Union[Unset, str] = UNSET
        if not isinstance(self.status_changed_at, Unset):
            status_changed_at = self.status_changed_at.isoformat()

        booked_before = self.booked_before

        ready = self.ready

        reverse_forwards: Union[Unset, List[Dict[str, Any]]] = UNSET
        if not isinstance(self.reverse_forwards, Unset):
            reverse_forwards = []
            for reverse_forwards_item_data in self.reverse_forwards:
                reverse_forwards_item = reverse_forwards_item_data.to_dict()
                reverse_forwards.append(reverse_forwards_item)

        remote_connect = self.remote_connect

        remote_connect_url: Union[None, Unset, str]
        if isinstance(self.remote_connect_url, Unset):
            remote_connect_url = UNSET
        else:
            remote_connect_url = self.remote_connect_url

        usage: Union[None, Unset, str]
        if isinstance(self.usage, Unset):
            usage = UNSET
        else:
            usage = self.usage

        logs_enabled = self.logs_enabled

        serial = self.serial

        created_at: Union[Unset, str] = UNSET
        if not isinstance(self.created_at, Unset):
            created_at = self.created_at.isoformat()

        group: Union[Unset, Dict[str, Any]] = UNSET
        if not isinstance(self.group, Unset):
            group = self.group.to_dict()

        adb_port = self.adb_port

        network: Union[Unset, Dict[str, Any]] = UNSET
        if not isinstance(self.network, Unset):
            network = self.network.to_dict()

        display: Union[Unset, Dict[str, Any]] = UNSET
        if not isinstance(self.display, Unset):
            display = self.display.to_dict()

        airplane_mode = self.airplane_mode

        battery: Union[Unset, Dict[str, Any]] = UNSET
        if not isinstance(self.battery, Unset):
            battery = self.battery.to_dict()

        browser: Union[Unset, Dict[str, Any]] = UNSET
        if not isinstance(self.browser, Unset):
            browser = self.browser.to_dict()

        service: Union[Unset, Dict[str, Any]] = UNSET
        if not isinstance(self.service, Unset):
            service = self.service.to_dict()

        channel = self.channel

        abi = self.abi

        cpu_platform = self.cpu_platform

        mac_address = self.mac_address

        manufacturer = self.manufacturer

        market_name = self.market_name

        model = self.model

        open_gles_version = self.open_gles_version

        operator: Union[None, Unset, str]
        if isinstance(self.operator, Unset):
            operator = UNSET
        else:
            operator = self.operator

        phone: Union[Unset, Dict[str, Any]] = UNSET
        if not isinstance(self.phone, Unset):
            phone = self.phone.to_dict()

        platform = self.platform

        ios_client_channel = self.ios_client_channel

        ios = self.ios

        product = self.product

        ram = self.ram

        sdk = self.sdk

        version = self.version

        usage_changed_at: Union[Unset, str] = UNSET
        if not isinstance(self.usage_changed_at, Unset):
            usage_changed_at = self.usage_changed_at.isoformat()

        notes = self.notes

        place = self.place

        storage_id = self.storage_id

        screen_port = self.screen_port

        connect_port = self.connect_port

        cpu: Union[Unset, Dict[str, Any]] = UNSET
        if not isinstance(self.cpu, Unset):
            cpu = self.cpu.to_dict()

        memory: Union[Unset, Dict[str, Any]] = UNSET
        if not isinstance(self.memory, Unset):
            memory = self.memory.to_dict()

        image = self.image

        released_at: Union[Unset, str] = UNSET
        if not isinstance(self.released_at, Unset):
            released_at = self.released_at.isoformat()

        name = self.name

        device_type = self.device_type

        likely_leave_reason = self.likely_leave_reason

        using = self.using

        capabilities: Union[Unset, Dict[str, Any]] = UNSET
        if not isinstance(self.capabilities, Unset):
            capabilities = self.capabilities.to_dict()

        field_dict: Dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if field_id is not UNSET:
            field_dict["_id"] = field_id
        if present is not UNSET:
            field_dict["present"] = present
        if presence_changed_at is not UNSET:
            field_dict["presenceChangedAt"] = presence_changed_at
        if provider is not UNSET:
            field_dict["provider"] = provider
        if owner is not UNSET:
            field_dict["owner"] = owner
        if status is not UNSET:
            field_dict["status"] = status
        if status_changed_at is not UNSET:
            field_dict["statusChangedAt"] = status_changed_at
        if booked_before is not UNSET:
            field_dict["bookedBefore"] = booked_before
        if ready is not UNSET:
            field_dict["ready"] = ready
        if reverse_forwards is not UNSET:
            field_dict["reverseForwards"] = reverse_forwards
        if remote_connect is not UNSET:
            field_dict["remoteConnect"] = remote_connect
        if remote_connect_url is not UNSET:
            field_dict["remoteConnectUrl"] = remote_connect_url
        if usage is not UNSET:
            field_dict["usage"] = usage
        if logs_enabled is not UNSET:
            field_dict["logs_enabled"] = logs_enabled
        if serial is not UNSET:
            field_dict["serial"] = serial
        if created_at is not UNSET:
            field_dict["createdAt"] = created_at
        if group is not UNSET:
            field_dict["group"] = group
        if adb_port is not UNSET:
            field_dict["adbPort"] = adb_port
        if network is not UNSET:
            field_dict["network"] = network
        if display is not UNSET:
            field_dict["display"] = display
        if airplane_mode is not UNSET:
            field_dict["airplaneMode"] = airplane_mode
        if battery is not UNSET:
            field_dict["battery"] = battery
        if browser is not UNSET:
            field_dict["browser"] = browser
        if service is not UNSET:
            field_dict["service"] = service
        if channel is not UNSET:
            field_dict["channel"] = channel
        if abi is not UNSET:
            field_dict["abi"] = abi
        if cpu_platform is not UNSET:
            field_dict["cpuPlatform"] = cpu_platform
        if mac_address is not UNSET:
            field_dict["macAddress"] = mac_address
        if manufacturer is not UNSET:
            field_dict["manufacturer"] = manufacturer
        if market_name is not UNSET:
            field_dict["marketName"] = market_name
        if model is not UNSET:
            field_dict["model"] = model
        if open_gles_version is not UNSET:
            field_dict["openGLESVersion"] = open_gles_version
        if operator is not UNSET:
            field_dict["operator"] = operator
        if phone is not UNSET:
            field_dict["phone"] = phone
        if platform is not UNSET:
            field_dict["platform"] = platform
        if ios_client_channel is not UNSET:
            field_dict["iosClientChannel"] = ios_client_channel
        if ios is not UNSET:
            field_dict["ios"] = ios
        if product is not UNSET:
            field_dict["product"] = product
        if ram is not UNSET:
            field_dict["ram"] = ram
        if sdk is not UNSET:
            field_dict["sdk"] = sdk
        if version is not UNSET:
            field_dict["version"] = version
        if usage_changed_at is not UNSET:
            field_dict["usageChangedAt"] = usage_changed_at
        if notes is not UNSET:
            field_dict["notes"] = notes
        if place is not UNSET:
            field_dict["place"] = place
        if storage_id is not UNSET:
            field_dict["storageId"] = storage_id
        if screen_port is not UNSET:
            field_dict["screenPort"] = screen_port
        if connect_port is not UNSET:
            field_dict["connectPort"] = connect_port
        if cpu is not UNSET:
            field_dict["cpu"] = cpu
        if memory is not UNSET:
            field_dict["memory"] = memory
        if image is not UNSET:
            field_dict["image"] = image
        if released_at is not UNSET:
            field_dict["releasedAt"] = released_at
        if name is not UNSET:
            field_dict["name"] = name
        if device_type is not UNSET:
            field_dict["deviceType"] = device_type
        if likely_leave_reason is not UNSET:
            field_dict["likelyLeaveReason"] = likely_leave_reason
        if using is not UNSET:
            field_dict["using"] = using
        if capabilities is not UNSET:
            field_dict["capabilities"] = capabilities

        return field_dict

    @classmethod
    def from_dict(cls: Type[T], src_dict: Dict[str, Any]) -> T:
        from ..models.device_battery import DeviceBattery
        from ..models.device_browser import DeviceBrowser
        from ..models.device_capabilities import DeviceCapabilities
        from ..models.device_cpu import DeviceCpu
        from ..models.device_display import DeviceDisplay
        from ..models.device_group import DeviceGroup
        from ..models.device_memory import DeviceMemory
        from ..models.device_network import DeviceNetwork
        from ..models.device_owner_type_0 import DeviceOwnerType0
        from ..models.device_phone import DevicePhone
        from ..models.device_provider import DeviceProvider
        from ..models.device_reverse_forwards_item import DeviceReverseForwardsItem
        from ..models.device_service import DeviceService

        d = src_dict.copy()
        field_id = d.pop("_id", UNSET)

        present = d.pop("present", UNSET)

        _presence_changed_at = d.pop("presenceChangedAt", UNSET)
        presence_changed_at: Union[Unset, datetime.datetime]
        if isinstance(_presence_changed_at, Unset):
            presence_changed_at = UNSET
        else:
            presence_changed_at = isoparse(_presence_changed_at)

        _provider = d.pop("provider", UNSET)
        provider: Union[Unset, DeviceProvider]
        if isinstance(_provider, Unset):
            provider = UNSET
        else:
            provider = DeviceProvider.from_dict(_provider)

        def _parse_owner(data: object) -> Union["DeviceOwnerType0", None, Unset]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                owner_type_0 = DeviceOwnerType0.from_dict(data)

                return owner_type_0
            except:  # noqa: E722
                pass
            return cast(Union["DeviceOwnerType0", None, Unset], data)

        owner = _parse_owner(d.pop("owner", UNSET))

        status = d.pop("status", UNSET)

        _status_changed_at = d.pop("statusChangedAt", UNSET)
        status_changed_at: Union[Unset, datetime.datetime]
        if isinstance(_status_changed_at, Unset):
            status_changed_at = UNSET
        else:
            status_changed_at = isoparse(_status_changed_at)

        booked_before = d.pop("bookedBefore", UNSET)

        ready = d.pop("ready", UNSET)

        reverse_forwards = []
        _reverse_forwards = d.pop("reverseForwards", UNSET)
        for reverse_forwards_item_data in _reverse_forwards or []:
            reverse_forwards_item = DeviceReverseForwardsItem.from_dict(reverse_forwards_item_data)

            reverse_forwards.append(reverse_forwards_item)

        remote_connect = d.pop("remoteConnect", UNSET)

        def _parse_remote_connect_url(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        remote_connect_url = _parse_remote_connect_url(d.pop("remoteConnectUrl", UNSET))

        def _parse_usage(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        usage = _parse_usage(d.pop("usage", UNSET))

        logs_enabled = d.pop("logs_enabled", UNSET)

        serial = d.pop("serial", UNSET)

        _created_at = d.pop("createdAt", UNSET)
        created_at: Union[Unset, datetime.datetime]
        if isinstance(_created_at, Unset):
            created_at = UNSET
        else:
            created_at = isoparse(_created_at)

        _group = d.pop("group", UNSET)
        group: Union[Unset, DeviceGroup]
        if isinstance(_group, Unset):
            group = UNSET
        else:
            group = DeviceGroup.from_dict(_group)

        adb_port = d.pop("adbPort", UNSET)

        _network = d.pop("network", UNSET)
        network: Union[Unset, DeviceNetwork]
        if isinstance(_network, Unset):
            network = UNSET
        else:
            network = DeviceNetwork.from_dict(_network)

        _display = d.pop("display", UNSET)
        display: Union[Unset, DeviceDisplay]
        if isinstance(_display, Unset):
            display = UNSET
        else:
            display = DeviceDisplay.from_dict(_display)

        airplane_mode = d.pop("airplaneMode", UNSET)

        _battery = d.pop("battery", UNSET)
        battery: Union[Unset, DeviceBattery]
        if isinstance(_battery, Unset):
            battery = UNSET
        else:
            battery = DeviceBattery.from_dict(_battery)

        _browser = d.pop("browser", UNSET)
        browser: Union[Unset, DeviceBrowser]
        if isinstance(_browser, Unset):
            browser = UNSET
        else:
            browser = DeviceBrowser.from_dict(_browser)

        _service = d.pop("service", UNSET)
        service: Union[Unset, DeviceService]
        if isinstance(_service, Unset):
            service = UNSET
        else:
            service = DeviceService.from_dict(_service)

        channel = d.pop("channel", UNSET)

        abi = d.pop("abi", UNSET)

        cpu_platform = d.pop("cpuPlatform", UNSET)

        mac_address = d.pop("macAddress", UNSET)

        manufacturer = d.pop("manufacturer", UNSET)

        market_name = d.pop("marketName", UNSET)

        model = d.pop("model", UNSET)

        open_gles_version = d.pop("openGLESVersion", UNSET)

        def _parse_operator(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        operator = _parse_operator(d.pop("operator", UNSET))

        _phone = d.pop("phone", UNSET)
        phone: Union[Unset, DevicePhone]
        if isinstance(_phone, Unset):
            phone = UNSET
        else:
            phone = DevicePhone.from_dict(_phone)

        platform = d.pop("platform", UNSET)

        ios_client_channel = d.pop("iosClientChannel", UNSET)

        ios = d.pop("ios", UNSET)

        product = d.pop("product", UNSET)

        ram = d.pop("ram", UNSET)

        sdk = d.pop("sdk", UNSET)

        version = d.pop("version", UNSET)

        _usage_changed_at = d.pop("usageChangedAt", UNSET)
        usage_changed_at: Union[Unset, datetime.datetime]
        if isinstance(_usage_changed_at, Unset):
            usage_changed_at = UNSET
        else:
            usage_changed_at = isoparse(_usage_changed_at)

        notes = d.pop("notes", UNSET)

        place = d.pop("place", UNSET)

        storage_id = d.pop("storageId", UNSET)

        screen_port = d.pop("screenPort", UNSET)

        connect_port = d.pop("connectPort", UNSET)

        _cpu = d.pop("cpu", UNSET)
        cpu: Union[Unset, DeviceCpu]
        if isinstance(_cpu, Unset):
            cpu = UNSET
        else:
            cpu = DeviceCpu.from_dict(_cpu)

        _memory = d.pop("memory", UNSET)
        memory: Union[Unset, DeviceMemory]
        if isinstance(_memory, Unset):
            memory = UNSET
        else:
            memory = DeviceMemory.from_dict(_memory)

        image = d.pop("image", UNSET)

        _released_at = d.pop("releasedAt", UNSET)
        released_at: Union[Unset, datetime.datetime]
        if isinstance(_released_at, Unset):
            released_at = UNSET
        else:
            released_at = isoparse(_released_at)

        name = d.pop("name", UNSET)

        device_type = d.pop("deviceType", UNSET)

        likely_leave_reason = d.pop("likelyLeaveReason", UNSET)

        using = d.pop("using", UNSET)

        _capabilities = d.pop("capabilities", UNSET)
        capabilities: Union[Unset, DeviceCapabilities]
        if isinstance(_capabilities, Unset):
            capabilities = UNSET
        else:
            capabilities = DeviceCapabilities.from_dict(_capabilities)

        device = cls(
            field_id=field_id,
            present=present,
            presence_changed_at=presence_changed_at,
            provider=provider,
            owner=owner,
            status=status,
            status_changed_at=status_changed_at,
            booked_before=booked_before,
            ready=ready,
            reverse_forwards=reverse_forwards,
            remote_connect=remote_connect,
            remote_connect_url=remote_connect_url,
            usage=usage,
            logs_enabled=logs_enabled,
            serial=serial,
            created_at=created_at,
            group=group,
            adb_port=adb_port,
            network=network,
            display=display,
            airplane_mode=airplane_mode,
            battery=battery,
            browser=browser,
            service=service,
            channel=channel,
            abi=abi,
            cpu_platform=cpu_platform,
            mac_address=mac_address,
            manufacturer=manufacturer,
            market_name=market_name,
            model=model,
            open_gles_version=open_gles_version,
            operator=operator,
            phone=phone,
            platform=platform,
            ios_client_channel=ios_client_channel,
            ios=ios,
            product=product,
            ram=ram,
            sdk=sdk,
            version=version,
            usage_changed_at=usage_changed_at,
            notes=notes,
            place=place,
            storage_id=storage_id,
            screen_port=screen_port,
            connect_port=connect_port,
            cpu=cpu,
            memory=memory,
            image=image,
            released_at=released_at,
            name=name,
            device_type=device_type,
            likely_leave_reason=likely_leave_reason,
            using=using,
            capabilities=capabilities,
        )

        device.additional_properties = d
        return device

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
