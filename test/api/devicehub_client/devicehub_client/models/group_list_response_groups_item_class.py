from enum import Enum


class GroupListResponseGroupsItemClass(str, Enum):
    BOOKABLE = "bookable"
    DAILY = "daily"
    DEBUG = "debug"
    HALFYEARLY = "halfyearly"
    HOURLY = "hourly"
    MONTHLY = "monthly"
    ONCE = "once"
    QUATERLY = "quaterly"
    STANDARD = "standard"
    WEEKLY = "weekly"
    YEARLY = "yearly"

    def __str__(self) -> str:
        return str(self.value)
