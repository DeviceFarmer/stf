from enum import Enum


class AlertMessageLevel(str, Enum):
    CRITICAL = "Critical"
    INFORMATION = "Information"
    WARNING = "Warning"

    def __str__(self) -> str:
        return str(self.value)
