from enum import Enum


class GetDevicesTarget(str, Enum):
    BOOKABLE = "bookable"
    ORIGIN = "origin"
    STANDARD = "standard"
    STANDARDIZABLE = "standardizable"
    USER = "user"

    def __str__(self) -> str:
        return str(self.value)
