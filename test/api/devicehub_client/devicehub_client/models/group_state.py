from enum import Enum


class GroupState(str, Enum):
    PENDING = "pending"
    READY = "ready"

    def __str__(self) -> str:
        return str(self.value)
