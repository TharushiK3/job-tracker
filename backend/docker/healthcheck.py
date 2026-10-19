"""Exit successfully only when the local API reports database readiness."""

import json
from urllib.request import urlopen


def main() -> None:
    with urlopen("http://127.0.0.1:8000/ready", timeout=6) as response:
        payload = json.load(response)

    if not isinstance(payload, dict) or (
        payload.get("status") != "ready"
        or payload.get("database") != "connected"
    ):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
