#!/usr/bin/env python3
"""Stub for tools/jev-pick.py in the extension tests: answers from FAKE_PICK_MODE, no network."""
import json
import os
import sys

mode = os.environ.get("FAKE_PICK_MODE", "first")
try:
    payload = json.load(sys.stdin)
except ValueError:
    payload = {}
cands = payload.get("candidates") or []
if mode == "error":
    sys.exit(1)
if mode == "first" and cands:
    print(json.dumps({"judge": "jev", "delivered": [cands[0]["id"]], "reason": "ok", "maybe": False,
                      "scores": [{"source": cands[0]["source"], "score": 0.9}]}))
else:
    print(json.dumps({"judge": "jev", "delivered": [], "reason": "below_floor", "maybe": False, "scores": []}))
