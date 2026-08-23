#!/usr/bin/env python3

from __future__ import annotations


def transform(curve: str, progress: float) -> float:
    if curve == "linear":
        return progress
    if curve == "ease-out-cubic":
        inverse = 1.0 - progress
        return 1.0 - inverse * inverse * inverse
    if curve == "ease-in-out-cubic":
        if progress < 0.5:
            return 4.0 * progress * progress * progress
        inverse = -2.0 * progress + 2.0
        return 1.0 - (inverse * inverse * inverse) / 2.0
    if curve == "forge-spring":
        inverse = 1.0 - progress
        return 1.0 - inverse * inverse * (1.0 + 2.0 * progress)
    raise ValueError(curve)


def validate_curve(name: str) -> None:
    samples = [transform(name, i / 1000.0) for i in range(1001)]
    assert abs(samples[0]) < 1e-9, (name, samples[0])
    assert abs(samples[-1] - 1.0) < 1e-9, (name, samples[-1])
    assert all(0.0 <= sample <= 1.0 for sample in samples), name
    assert all(a <= b for a, b in zip(samples, samples[1:])), name


def validate_motion_scale() -> None:
    duration_ms = 220
    for scale in (0.0, 0.25, 0.5, 1.0):
        scaled = int(duration_ms * scale)
        assert scaled >= 0
        if scale == 0.0:
            assert scaled == 0
        else:
            assert 0 < scaled <= duration_ms


if __name__ == "__main__":
    for curve in ("linear", "ease-out-cubic", "ease-in-out-cubic", "forge-spring"):
        validate_curve(curve)
    validate_motion_scale()
    print("AArel Forge motion invariants: PASS")
