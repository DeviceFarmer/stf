#!/usr/bin/env python3
"""Check a native amd64 image with disposable Compose services and HTTP."""

import argparse
import hashlib
import http.cookiejar
import json
import os
import pathlib
import re
import secrets
import signal
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


ROOT = pathlib.Path(__file__).resolve().parents[2]
SERVICES = ["rethinkdb", "migrate", "triproxy-app", "triproxy-dev", "processor",
            "reaper", "groups-engine", "auth", "app", "api", "websocket",
            "storage", "storage-image", "storage-apk", "proxy"]
EMAIL = "image-smoke@example.invalid"
NAME = "STF image smoke"


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


class LocalRedirects(urllib.request.HTTPRedirectHandler):
    def __init__(self, origin):
        self.origin = origin

    def redirect_request(self, request, response, code, message, headers, target):
        require(urllib.parse.urlsplit(target)[:2] == self.origin,
                "HTTP redirect left the disposable local test server")
        return super().redirect_request(request, response, code, message, headers, target)


class Client:
    def __init__(self, base):
        self.base = base
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(self.cookies),
            LocalRedirects(urllib.parse.urlsplit(base)[:2]))

    def request(self, route, data=None, headers=None, expected=200):
        target = urllib.parse.urljoin(self.base + "/", route)
        require(urllib.parse.urlsplit(target)[:2] == urllib.parse.urlsplit(self.base)[:2],
                "Request target left the disposable local test server")
        request = urllib.request.Request(target, data=data, headers=headers or {})
        try:
            with self.opener.open(request, timeout=30) as response:
                require(response.status == expected, "Unexpected HTTP status: " + str(response.status))
                return response.read(), response.headers
        except urllib.error.HTTPError as error:
            raise RuntimeError("HTTP {} for {}: {}".format(
                error.code, urllib.parse.urlsplit(target).path,
                error.read(1000).decode(errors="replace"))) from error

    def json(self, route, payload=None, headers=None, expected=200):
        request_headers = {"Accept": "application/json", **(headers or {})}
        data = None
        if payload is not None:
            data = json.dumps(payload).encode()
            request_headers["Content-Type"] = "application/json"
        content, _ = self.request(route, data, request_headers, expected)
        return json.loads(content)

    def upload(self, plugin, name, content_type, content):
        boundary = "stf-runtime-" + uuid.uuid4().hex
        body = ('--{}\r\nContent-Disposition: form-data; name="file"; filename="{}"\r\n'
                'Content-Type: {}\r\n\r\n').format(boundary, name, content_type).encode()
        body += content + ("\r\n--{}--\r\n".format(boundary)).encode()
        response, _ = self.request("/s/upload/" + plugin, body,
                                   {"Content-Type": "multipart/form-data; boundary=" + boundary}, 201)
        result = json.loads(response)
        require(result.get("success") is True, "Storage rejected upload")
        return result["resources"]["file"]["href"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True)
    parser.add_argument("--directory", required=True, type=pathlib.Path,
                        help="Directory for override, logs, fixtures and JSON results")
    parser.add_argument("--project", default="stf-runtime-" + uuid.uuid4().hex[:12])
    parser.add_argument("--port", type=int, default=17100)
    parser.add_argument("--wait-timeout", type=int, default=180)
    args = parser.parse_args()
    require(re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,55}", args.project), "Invalid Compose project name")
    require(1024 <= args.port <= 65535, "Use an unprivileged TCP port")
    os.umask(0o077)
    directory = args.directory.resolve()
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    override = directory / "compose.override.yaml"
    base = "http://127.0.0.1:" + str(args.port)
    with override.open("x") as output:
        output.write("services:\n  rethinkdb:\n")
        output.write('    command: ["rethinkdb", "--bind", "all", "--cache-size", "256"]\n')
        output.write("  auth:\n    command: " + json.dumps(
            ["stf", "auth-mock", "--app-url", base + "/"]) + "\n")
        output.write("  app:\n    command: " + json.dumps([
            "stf", "app", "--auth-url", base + "/auth/mock/", "--websocket-url", base + "/"]) + "\n")
        output.write("  proxy:\n    ports: !override\n      - " + json.dumps(
            "127.0.0.1:{}:7100".format(args.port)) + "\n")

    environment = {**os.environ, "STF_IMAGE": args.image, "STF_SECRET": secrets.token_hex(24),
                   "STF_RESTART_POLICY": "no", "STF_PUBLIC_IP": "127.0.0.1",
                   "STF_ADMIN_EMAIL": EMAIL, "STF_ADMIN_NAME": NAME}
    compose = ["docker", "compose", "--project-name", args.project, "--project-directory", str(ROOT),
               "-f", str(ROOT / "docker-compose.yaml"), "-f", str(override)]
    result = {"schema": 1, "image": args.image, "project": args.project, "baseUrl": base,
              "services": SERVICES, "checks": [], "status": "failed",
              "timingNotes": "Prepull and fixture extraction excluded; readiness includes Compose health checks and HTTP auth page."}
    started_project = False
    fixture_container = None
    sequence = 0

    def save_log(file, content):
        file.write_bytes(content.replace(environment["STF_SECRET"].encode(), b"<redacted>"))

    def run(command, label, timeout=120):
        nonlocal sequence
        sequence += 1
        logfile = directory / ("{:02d}-{}.log".format(sequence, label))
        try:
            completed = subprocess.run(command, cwd=ROOT, env=environment, stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE, timeout=timeout)
        except subprocess.TimeoutExpired as error:
            save_log(logfile, (error.stdout or b"") + b"\n--- stderr ---\n" + (error.stderr or b""))
            raise RuntimeError(label + " timed out; see saved log") from error
        save_log(logfile, completed.stdout + b"\n--- stderr ---\n" + completed.stderr)
        require(completed.returncode == 0, "{} failed; see saved log (exit {})".format(label, completed.returncode))
        return completed.stdout

    def best_effort(command, label):
        try:
            return run(command, label)
        except Exception as error:
            result.setdefault("diagnosticErrors", []).append(str(error))
            return None

    def check(name, action):
        started = time.monotonic()
        try:
            details = action()
        except Exception as error:
            result["checks"].append({"name": name, "status": "failed", "error": str(error),
                                     "seconds": round(time.monotonic() - started, 3)})
            raise
        else:
            result["checks"].append({"name": name, "status": "passed",
                                     "seconds": round(time.monotonic() - started, 3), "details": details})

    def container_state():
        identifiers = run(compose + ["ps", "--all", "--quiet"], "container-ids").decode().split()
        require(identifiers, "Compose created no containers")
        containers = json.loads(run(["docker", "inspect"] + identifiers, "container-inspect"))
        states = {}
        for container in containers:
            service = container["Config"]["Labels"]["com.docker.compose.service"]
            state = container["State"]
            states[service] = {"state": state["Status"], "exitCode": state["ExitCode"],
                               "health": state.get("Health", {}).get("Status"),
                               "restarts": container["RestartCount"], "imageId": container["Image"]}
            require(not container["HostConfig"]["Privileged"], "Unexpected privileged container")
            require(not container["HostConfig"].get("Devices"), "Unexpected device passthrough")
            require(not any("/dev/bus/usb" in mount.get("Source", "") for mount in container["Mounts"]),
                    "Unexpected USB mount")
            if service == "migrate":
                require(state["Status"] == "exited" and state["ExitCode"] == 0, "Migration failed")
            else:
                require(state["Status"] == "running", service + " is not running")
                require(state.get("Health", {}).get("Status") in (None, "healthy"), service + " is unhealthy")
                require(container["RestartCount"] == 0, service + " restarted")
            if service not in ("rethinkdb", "proxy"):
                require(container["Image"] == result["imageId"], service + " used a different STF image")
        require(set(states) == set(SERVICES), "Unexpected/missing services: " + repr(sorted(states)))
        result["containerState"] = states
        return {"services": len(states), "restarts": 0}

    try:
        for kind, command in [
                ("containers", ["docker", "ps", "--all", "--quiet", "--filter"]),
                ("volumes", ["docker", "volume", "ls", "--quiet", "--filter"]),
                ("networks", ["docker", "network", "ls", "--quiet", "--filter"])]:
            existing = run(command + ["label=com.docker.compose.project=" + args.project], "guard-" + kind)
            require(not existing.strip(), "Project already owns {}: choose a fresh --project".format(kind))
        image = json.loads(run(["docker", "image", "inspect", args.image], "image-inspect"))[0]
        result["imageId"] = image["Id"]
        result["imagePlatform"] = image["Os"] + "/" + image["Architecture"]
        require(result["imagePlatform"] == "linux/amd64", "Compose smoke requires a Linux amd64 image")
        host_arch = run(["docker", "info", "--format", "{{.Architecture}}"], "engine-architecture").decode().strip()
        require(host_arch in ("x86_64", "amd64"),
                "Compose smoke requires a native amd64 Docker engine for the RethinkDB image")
        environment["DOCKER_DEFAULT_PLATFORM"] = result["imagePlatform"]
        run(compose + ["config"], "compose-config")
        pull_started = time.monotonic()
        run(compose + ["pull", "--quiet", "rethinkdb", "proxy"], "prepull", timeout=300)
        result["prepullSeconds"] = round(time.monotonic() - pull_started, 3)
        fixture_container = run(["docker", "create", "--network", "none", "--entrypoint", "node",
                                 args.image, "-e", "process.exit(0)"], "fixture-container").decode().strip()
        try:
            for source, destination in [
                    ("/app/node_modules/@devicefarmer/stfservice-prebuilt/prebuilt/noarch/STFService.apk", "STFService.apk"),
                    ("/app/res/common/logo/exports/STF-128.png", "STF-128.png")]:
                run(["docker", "cp", fixture_container + ":" + source, str(directory / destination)], "copy-" + destination)
        finally:
            run(["docker", "rm", fixture_container], "remove-fixture-container")
            fixture_container = None
        client = Client(base)
        started_project = True
        ready_started = time.monotonic()
        run(compose + ["up", "--wait", "--wait-timeout", str(args.wait_timeout), "--no-build",
                       "--pull", "never"] + SERVICES, "compose-up", timeout=args.wait_timeout + 60)
        result["composeWaitSeconds"] = round(time.monotonic() - ready_started, 3)
        login_page, _ = client.request("/auth/mock/")
        require(b"authmock.entry.js" in login_page, "Mock auth page did not render")
        result["startToReadySeconds"] = round(time.monotonic() - ready_started, 3)
        check("service-state-before", container_state)

        def login():
            token = next((urllib.parse.unquote(cookie.value) for cookie in client.cookies
                          if cookie.name == "XSRF-TOKEN"), None)
            require(token, "Auth page did not set a CSRF cookie")
            signed_in = client.json("/auth/api/v1/mock", {"name": NAME, "email": EMAIL},
                                    {"X-XSRF-TOKEN": token})
            require(signed_in.get("success") is True, "Mock authentication failed")
            page, _ = client.request(signed_in["redirect"])
            require(b"app.entry.js" in page, "JWT redirect did not reach the application")
            user = client.json("/api/v1/user")
            require(user.get("success") is True and user["user"]["email"] == EMAIL,
                    "API did not accept the authenticated session")
            return {"email": user["user"]["email"]}
        check("csrf-login-jwt-api-user", login)

        def assets():
            sizes = {}
            for name in ["app", "authmock", "authldap"]:
                content, headers = client.request("/static/app/build/entry/" + name + ".entry.js")
                require(content and "javascript" in headers.get("Content-Type", ""), "Missing JavaScript bundle: " + name)
                sizes[name] = len(content)
            return sizes
        check("static-application-assets", assets)

        def apk_storage():
            apk = (directory / "STFService.apk").read_bytes()
            href = client.upload("apk", "STFService.apk", "application/vnd.android.package-archive", apk)
            manifest = client.json(href + "/manifest")
            require(manifest.get("success") is True and manifest["manifest"]["package"] == "jp.co.cyberagent.stf",
                    "APK metadata was not parsed")
            downloaded, _ = client.request(href)
            require(downloaded == apk, "Downloaded APK differs from uploaded bytes")
            return {"bytes": len(apk), "sha256": hashlib.sha256(apk).hexdigest()}
        check("apk-upload-manifest-download", apk_storage)

        def image_storage():
            png = (directory / "STF-128.png").read_bytes()
            href = client.upload("image", "STF-128.png", "image/png", png)
            original, _ = client.request(href.replace("/s/image/", "/s/blob/", 1))
            require(original == png, "Downloaded original PNG differs from uploaded bytes")
            resized, _ = client.request(href + "?crop=16x16")
            require(resized[:8] == b"\x89PNG\r\n\x1a\n" and len(resized) >= 24,
                    "Image service did not return a PNG")
            require(struct.unpack(">II", resized[16:24]) == (16, 16), "PNG was not resized to 16x16")
            return {"originalBytes": len(png), "resizedBytes": len(resized), "width": 16, "height": 16}
        check("png-upload-download-resize", image_storage)
        check("service-state-after", container_state)
        result["status"] = "passed"
    except BaseException as error:
        result["error"] = str(error) or type(error).__name__
    finally:
        if fixture_container is not None:
            if best_effort(["docker", "rm", "--force", fixture_container], "cleanup-fixture-container") is None:
                result["status"] = "failed"
        if started_project:
            best_effort(compose + ["logs", "--no-color", "--timestamps"], "compose-logs")
            cleanup = best_effort(compose + ["down", "--volumes", "--remove-orphans", "--timeout", "10"], "compose-down")
            result["cleanup"] = "passed" if cleanup is not None else "failed"
            for kind, command in [
                    ("containers", ["docker", "ps", "--all", "--quiet", "--filter"]),
                    ("volumes", ["docker", "volume", "ls", "--quiet", "--filter"]),
                    ("networks", ["docker", "network", "ls", "--quiet", "--filter"])]:
                remaining = best_effort(command + ["label=com.docker.compose.project=" + args.project],
                                        "cleanup-" + kind)
                if remaining is None or remaining.strip():
                    result["cleanup"] = "failed"
            if result["cleanup"] == "failed":
                result["status"] = "failed"
        (directory / "compose-result.json").write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps(result, indent=2), flush=True)
    return 0 if result["status"] == "passed" else 1


if __name__ == "__main__":
    def interrupt(_signal, _frame):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, interrupt)
    sys.exit(main())
