"""Bounded IPA preflight. iOS remains responsible for final code-signature verification."""
import datetime
import json
import pathlib
import re
import stat
import struct
import subprocess
import sys
import zipfile


class InvalidIpa(Exception):
    pass


def require(condition, code):
    if not condition:
        raise InvalidIpa(code)


def inspect(filename, udid, ios_version):
    with zipfile.ZipFile(filename) as archive:
        entries = archive.infolist()
        require(0 < len(entries) <= 20000, "IOS_IPA_INVALID")
        names = set()
        total = 0
        for entry in entries:
            name = entry.filename
            path = pathlib.PurePosixPath(name)
            require(not path.is_absolute() and ".." not in path.parts and "\\" not in name
                    and "\0" not in name and name not in names, "IOS_IPA_INVALID")
            require(not stat.S_ISLNK(entry.external_attr >> 16), "IOS_IPA_INVALID")
            require(not entry.flag_bits & 1, "IOS_IPA_INVALID")
            names.add(name)
            total += entry.file_size
        require(total <= 3 * 1024 ** 3, "IOS_IPA_TOO_LARGE")
        roots = [name for name in names if re.fullmatch(r"Payload/[^/]+\.app/Info\.plist", name)]
        require(len(roots) == 1, "IOS_IPA_INVALID")
        root = roots[0][:-len("Info.plist")]

        def read(name, limit):
            require(name in names and archive.getinfo(name).file_size <= limit, "IOS_IPA_INVALID")
            return archive.read(name)

        import plistlib
        info = plistlib.loads(read(root + "Info.plist", 1024 * 1024))
        bundle = info.get("CFBundleIdentifier", "")
        require(isinstance(bundle, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]{0,254}", bundle),
                "IOS_IPA_INVALID")
        require(info.get("CFBundlePackageType") == "APPL", "IOS_IPA_INVALID")
        require("iPhoneOS" in info.get("CFBundleSupportedPlatforms", []), "IOS_IPA_PLATFORM")
        require(1 in info.get("UIDeviceFamily", [1]), "IOS_IPA_PLATFORM")
        minimum = info.get("MinimumOSVersion", "0")

        def version(value):
            require(isinstance(value, str) and re.fullmatch(r"\d+(\.\d+){0,3}", value),
                    "IOS_IPA_INVALID")
            return tuple(int(p) for p in value.split(".")) + (0,) * (4 - len(value.split(".")))

        require(version(minimum) <= version(ios_version), "IOS_IPA_OS_VERSION")
        executable = info.get("CFBundleExecutable", "")
        require(isinstance(executable, str) and executable not in ("", ".", "..")
                and "/" not in executable and "\\" not in executable, "IOS_IPA_INVALID")
        with archive.open(root + executable) as stream:
            header = stream.read(4096)
        require(len(header) >= 8, "IOS_IPA_PLATFORM")
        magic = header[:4]
        if magic in (b"\xcf\xfa\xed\xfe", b"\xce\xfa\xed\xfe"):
            arm64 = struct.unpack_from("<I", header, 4)[0] == 0x0100000C
        elif magic in (b"\xca\xfe\xba\xbe", b"\xca\xfe\xba\xbf"):
            count = struct.unpack_from(">I", header, 4)[0]
            stride = 20 if magic[-1] == 0xBE else 32
            require(count <= 32 and 8 + count * stride <= len(header), "IOS_IPA_PLATFORM")
            arm64 = any(struct.unpack_from(">I", header, 8 + i * stride)[0] == 0x0100000C
                        for i in range(count))
        else:
            arm64 = False
        require(arm64, "IOS_IPA_PLATFORM")
        require(root + "_CodeSignature/CodeResources" in names, "IOS_IPA_SIGNING")
        require(root + "embedded.mobileprovision" in names, "IOS_IPA_SIGNING")
        profile_bytes = read(root + "embedded.mobileprovision", 4 * 1024 * 1024)
        decoded = subprocess.run(["openssl", "cms", "-verify", "-inform", "DER", "-noverify"],
                                 input=profile_bytes, capture_output=True, timeout=10)
        require(decoded.returncode == 0, "IOS_IPA_SIGNING")
        profile = plistlib.loads(decoded.stdout)
        expires = profile.get("ExpirationDate")
        require(isinstance(expires, datetime.datetime), "IOS_IPA_SIGNING")
        expires = expires.replace(tzinfo=datetime.timezone.utc)
        require(expires > datetime.datetime.now(datetime.timezone.utc), "IOS_IPA_PROFILE_EXPIRED")
        allowed = profile.get("ProvisionedDevices", [])
        require(profile.get("ProvisionsAllDevices") is True or
                udid.lower() in [value.lower() for value in allowed if isinstance(value, str)],
                "IOS_IPA_DEVICE_NOT_PROVISIONED")
        app_id = profile.get("Entitlements", {}).get("application-identifier", "")
        require(isinstance(app_id, str) and "." in app_id, "IOS_IPA_SIGNING")
        identifier = app_id.split(".", 1)[1]
        require(identifier == bundle or (identifier.endswith("*") and
                "*" not in identifier[:-1] and bundle.startswith(identifier[:-1])), "IOS_IPA_SIGNING")
        return {"package": bundle, "name": str(info.get("CFBundleDisplayName") or
                info.get("CFBundleName") or bundle)[:255],
                "version": str(info.get("CFBundleShortVersionString") or info.get("CFBundleVersion") or ""),
                "minimumOSVersion": minimum, "profileExpiresAt": expires.isoformat()}


if __name__ == "__main__":
    try:
        print(json.dumps({"manifest": inspect(*sys.argv[1:])}))
    except InvalidIpa as error:
        print(json.dumps({"error": str(error)}))
    except Exception:
        print(json.dumps({"error": "IOS_IPA_INVALID"}))
