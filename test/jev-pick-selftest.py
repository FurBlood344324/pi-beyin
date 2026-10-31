#!/usr/bin/env python3
"""jev-pick politika birim testi — ağ yok, Jev yok (ask() taklit edilir).

Karar politikası (choice + none -> topikal kapı -> onay -> eşik) tek yerde: tools/jev-pick.py.
Bu test o politikanın eşik davranışını sabitler; gerçek Jev yanıtıyla ölçüm vault'ta
(tools/jev-taban-olcum.py --sweep).
"""
from __future__ import annotations

import importlib.util
import math
import sys
from pathlib import Path

sys.dont_write_bytecode = True

TOOL = Path(__file__).resolve().parent.parent / "tools" / "jev-pick.py"
spec = importlib.util.spec_from_file_location("jevpick", TOOL)
jp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(jp)


class FakeJev:
    def load_config(self, path):
        return {"model": "typesafe/jev", "base_url": "https://x/v1", "timeout": 5, "max_input_chars": 24000}

    def killed(self, path):
        return False

    def _environment(self, config):
        return {"TYPESAFE_API_KEY": "k"}

    def _endpoint(self, base):
        return base

    def _bounded_transport(self, *a):
        return None


def answers(which, topical, confirms=()):
    out = [{"which": {"choice": max(which, key=which.get), "probabilities": which}, "topical": {"noul": topical}}]
    if confirms:
        out.append({f"c{i}": {"noul": v} for i, v in enumerate(confirms, 1)})
    return out


def run(query, replies, earlier=(), floors=None, shape=None):
    calls = []

    def ask(jev, config, body, timeout, cache, cache_only):
        calls.append(sorted(body["questions"]))
        return replies[len(calls) - 1]

    jp.ask = ask
    cands = [
        dict(id="k1", source="knowledge/concepts/jev-karar-akisi.md", text="# Jev karar akışı\nchoice soruları"),
        dict(id="k2", source="knowledge/concepts/jev-kor-noktalari.md", text="# Jev kör noktaları\nonay adımı"),
        dict(id="k3", source="notes/proje-work.md", text="# Proje: work\nSobel kenar filtresi"),
    ]
    return jp.decide(FakeJev(), str(TOOL.parent), dict(query=query, earlier=list(earlier), candidates=cands),
                     dict(jp.SHAPE, **(shape or {})), dict(jp.FLOORS, **(floors or {})), None, False)


CHECKS = []


def expect(name, got, want):
    CHECKS.append((name, got == want, got, want))


expect("net isabet", run("jev karar akışı nedir", answers({"n1": .72, "n2": .1, "none": .18}, .92, [.95]))["delivered"], ["k1"])
expect("grup bölünmesi (aynı aile)",
       run("jev nasıl kullanılıyor", answers({"n1": .3, "n2": .3, "none": .4}, .9, [.9, .85]))["delivered"], ["k1", "k2"])
expect("ikinci not zayıf onay -> tek not",
       run("jev nasıl kullanılıyor", answers({"n1": .5, "n2": .3, "none": .2}, .9, [.95, .3]))["delivered"], ["k1"])
expect("vague mesaj: kapı altı, yüksek eşik -> sus",
       run("bunu düzelt", answers({"n1": .5, "none": .5}, .2, [.9]))["delivered"], [])
expect("tek kelime: hiçbir şey", run("devam", answers({"n1": .99, "none": .01}, .05))["delivered"], [])
expect("none seçildi -> sus", run("merhaba nasılsın", answers({"n1": .1, "none": .9}, .1))["delivered"], [])
expect("onaysız yol fail-closed", run("jev karar akışı nedir", answers({"n1": .9, "none": .1}, .95))["delivered"], [])
res = run("jev karar akışı nedir", answers({"n1": .9, "none": .1}, .95))
expect("onaysız skor g*unconfirmed", round(res["scores"][0]["score"], 3), round(.9 * jp.FLOORS["unconfirmed"], 3))
expect("eşik altı", run("jev karar akışı nedir", answers({"n1": .3, "none": .7}, .9, [.5]))["delivered"], [])
expect("topikal kapı reason", run("tamam", answers({"n1": .9, "none": .1}, .1))["reason"], "vague_one_word")

failed = 0
for name, ok, got, want in CHECKS:
    mark = "\033[32m✓\033[0m" if ok else "\033[31m✗\033[0m"
    print(f"  {mark} {name}" + ("" if ok else f"  → {got!r} (beklenen {want!r})"))
    failed += 0 if ok else 1
print(f"=== {len(CHECKS) - failed} passed, {failed} failed ===")
sys.exit(1 if failed else 0)
