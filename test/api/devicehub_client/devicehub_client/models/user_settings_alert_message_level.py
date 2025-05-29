from enum import Enum


class UserSettingsAlertMessageLevel(str, Enum):
    CRITICAL = "Critical"
    INFORMATION = "Information"
    WARNING = "Warning"

    def __str__(self) -> str:
        return str(self.value)
