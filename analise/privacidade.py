"""
Privacy rules for the public data bundle.

All suppression decisions live here so they can be tested in isolation and
applied consistently by build_public.py and any future build script.

Rule summary (from docs/PLANO.md §3.1-3.2):
  - Any count with n < 5 → null, flagged as suppressed
  - Percentages rounded to 1 decimal place
  - Complementarity: if A and B are public and C is suppressed but C = total − A − B,
    suppress the second-smallest published cell too
  - No individual rankings
  - Network: only aggregate stats, never edge list
  - Project atlas: surrogate id, cluster, sigla, year, production count, and
    (decision 1, 2026-08-08) title ONLY for projects in a cluster with >= 10
    members — never the coordinator or any member name
  - No text excerpts in public bundle
  - Funding: agency aggregated by program; no project↔agency pairs
"""

import random
import string
from typing import Any

SUPPRESSION_THRESHOLD = 5


def suppress_count(n: int | None) -> dict:
    """Return a cell value dict: {value, suppressed}."""
    if n is None or n < SUPPRESSION_THRESHOLD:
        return {"value": None, "suppressed": True}
    return {"value": n, "suppressed": False}


def safe_percent(numerator: int | None, denominator: int | None, decimals: int = 1) -> float | None:
    """Compute percentage, returning None if either operand is None or denominator is 0."""
    if numerator is None or denominator is None or denominator == 0:
        return None
    return round(100 * numerator / denominator, decimals)


def suppress_row(row: dict[str, Any], count_keys: list[str], total_key: str | None = None) -> dict[str, Any]:
    """
    Apply suppression to a dict of count fields.

    count_keys: names of fields that hold raw counts to suppress.
    total_key: if provided, also applies complementarity suppression:
      if the total is public and only one component is suppressed,
      check that the suppressed value is not reconstructible from
      (total − sum_of_public_parts). If it is, suppress the smallest
      remaining published cell too.
    """
    result = {k: v for k, v in row.items() if k not in count_keys}

    suppressed_cells = []
    published_cells = []
    total = row.get(total_key) if total_key else None

    for key in count_keys:
        val = row.get(key)
        cell = suppress_count(val)
        result[key] = cell
        if cell["suppressed"]:
            suppressed_cells.append(key)
        else:
            published_cells.append((key, cell["value"]))

    # Complementarity: suppressed value is recoverable when total is public
    # and all other parts are published.
    if (
        total_key
        and total is not None
        and total >= SUPPRESSION_THRESHOLD
        and len(suppressed_cells) > 0
    ):
        published_sum = sum(v for _, v in published_cells if v is not None)
        # If exactly one cell is suppressed, its value = total - published_sum.
        # That reveals the suppressed count → suppress the smallest published cell.
        if len(suppressed_cells) == 1 and published_cells:
            smallest_key = min(published_cells, key=lambda x: x[1])[0]
            result[smallest_key] = {"value": None, "suppressed": True}

    return result


def generate_surrogate(length: int = 16) -> str:
    """Random alphanumeric surrogate id for use in place of real database ids."""
    alphabet = string.ascii_lowercase + string.digits
    return "".join(random.choices(alphabet, k=length))


def build_id_map(real_ids: list) -> dict:
    """
    Build a {real_id: surrogate} mapping with random surrogate keys.
    The mapping should be persisted in derivados/id_map.sqlite (never in git).
    """
    return {rid: generate_surrogate() for rid in real_ids}


# ---------------------------------------------------------------------------
# Unit tests (run with:  python3 -m analise.privacidade  or  pytest)
# ---------------------------------------------------------------------------

def _run_tests():
    # suppress_count
    assert suppress_count(0) == {"value": None, "suppressed": True}
    assert suppress_count(4) == {"value": None, "suppressed": True}
    assert suppress_count(5) == {"value": 5, "suppressed": False}
    assert suppress_count(None) == {"value": None, "suppressed": True}
    assert suppress_count(100) == {"value": 100, "suppressed": False}

    # safe_percent
    assert safe_percent(1, 0) is None
    assert safe_percent(None, 10) is None
    assert safe_percent(1, 3) == 33.3
    assert safe_percent(1, 3, decimals=0) == 33.0

    # suppress_row — basic
    row = {"sigla": "USP", "docentes": 43, "discentes": 3, "externos": 10}
    result = suppress_row(row, count_keys=["docentes", "discentes", "externos"])
    assert result["sigla"] == "USP"
    assert result["docentes"] == {"value": 43, "suppressed": False}
    assert result["discentes"] == {"value": None, "suppressed": True}
    assert result["externos"] == {"value": 10, "suppressed": False}

    # suppress_row — complementarity: suppressed value is recoverable
    # total=50, A=45 published, B=suppressed(2) → B = 50-45 = 5... wait, B<5 so suppressed
    # Let's test: total=50, A=45, B=suppressed(3) → C should suppress smallest published (A)
    row2 = {"total": 50, "a": 45, "b": 3}
    result2 = suppress_row(row2, count_keys=["a", "b"], total_key="total")
    # b is suppressed (3 < 5); a is published (45); a = total - b = 50-3 = 47 → recoverable
    # smallest published cell is a; it should also be suppressed
    assert result2["b"] == {"value": None, "suppressed": True}
    assert result2["a"] == {"value": None, "suppressed": True}

    # surrogate ids are unique and have correct length
    surrogates = [generate_surrogate() for _ in range(1000)]
    assert len(set(surrogates)) == 1000
    assert all(len(s) == 16 for s in surrogates)

    print("All privacy tests passed.")


if __name__ == "__main__":
    _run_tests()
