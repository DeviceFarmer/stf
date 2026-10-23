"""Synthetic signatures are test data, never valid Apple signing identities."""
import datetime
import importlib.util
import pathlib
import plistlib
import struct
import subprocess
import tempfile
import zipfile

spec = importlib.util.spec_from_file_location("metadata", pathlib.Path(__file__).parents[1] / "ipa_metadata.py")
metadata = importlib.util.module_from_spec(spec)
spec.loader.exec_module(metadata)

with tempfile.TemporaryDirectory() as directory:
  root = pathlib.Path(directory)
  key, cert = root / "test.key", root / "test.crt"
  subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
          "-subj", "/CN=STF fixture only", "-keyout", str(key), "-out", str(cert)],
         check=True, capture_output=True)

  def ipa(info_changes=None, profile_changes=None, extra=None, binary=None, unsigned=False):
    info = {"CFBundleIdentifier": "test.stf.app", "CFBundleExecutable": "TestApp",
        "CFBundlePackageType": "APPL", "CFBundleSupportedPlatforms": ["iPhoneOS"],
        "UIDeviceFamily": [1], "MinimumOSVersion": "18.0", "CFBundleName": "STF Test",
        "CFBundleShortVersionString": "1.2", **(info_changes or {})}
    profile = {"ExpirationDate": datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
         + datetime.timedelta(days=1), "ProvisionedDevices": ["phone-123"],
         "Entitlements": {"application-identifier": "TEAM.test.stf.*"},
         **(profile_changes or {})}
    signed = subprocess.run(["openssl", "cms", "-sign", "-binary", "-nodetach", "-outform", "DER",
                "-signer", str(cert), "-inkey", str(key)], input=plistlib.dumps(profile),
                check=True, capture_output=True).stdout
    filename = root / "test.ipa"
    with zipfile.ZipFile(filename, "w") as archive:
      app = "Payload/Test.app/"
      archive.writestr(app + "Info.plist", plistlib.dumps(info, fmt=plistlib.FMT_BINARY))
      archive.writestr(app + "TestApp", binary or struct.pack("<II", 0xFEEDFACF, 0x0100000C))
      if not unsigned:
        archive.writestr(app + "_CodeSignature/CodeResources", b"fixture")
        archive.writestr(app + "embedded.mobileprovision", signed)
      for name, value in (extra or {}).items():
        archive.writestr(name, value)
    return filename

  assert metadata.inspect(ipa(), "PHONE-123", "27.0.1")["package"] == "test.stf.app"
  cases = [
    ({"info_changes": {"CFBundleSupportedPlatforms": ["iPhoneSimulator"]}}, "IOS_IPA_PLATFORM"),
    ({"info_changes": {"UIDeviceFamily": [2]}}, "IOS_IPA_PLATFORM"),
    ({"info_changes": {"MinimumOSVersion": "99.0"}}, "IOS_IPA_OS_VERSION"),
    ({"binary": struct.pack("<II", 0xFEEDFACF, 0x01000007)}, "IOS_IPA_PLATFORM"),
    ({"unsigned": True}, "IOS_IPA_SIGNING"),
    ({"profile_changes": {"ProvisionedDevices": ["other-phone"]}}, "IOS_IPA_DEVICE_NOT_PROVISIONED"),
    ({"profile_changes": {"ExpirationDate": datetime.datetime(2000, 1, 1)}}, "IOS_IPA_PROFILE_EXPIRED"),
    ({"profile_changes": {"Entitlements": {"application-identifier": "TEAM.other.app"}}}, "IOS_IPA_SIGNING"),
    ({"extra": {"../../outside": b"escape"}}, "IOS_IPA_INVALID"),
    ({"extra": {"Payload/Other.app/Info.plist": b"second-app"}}, "IOS_IPA_INVALID"),
    ({"info_changes": {"CFBundleExecutable": "../escape"}}, "IOS_IPA_INVALID"),
  ]
  for arguments, code in cases:
    try:
      metadata.inspect(ipa(**arguments), "phone-123", "27.0.1")
      raise AssertionError("Expected " + code)
    except metadata.InvalidIpa as error:
      assert str(error) == code, (arguments, str(error), code)
  print("IPA preflight fixtures passed (12 cases)")
