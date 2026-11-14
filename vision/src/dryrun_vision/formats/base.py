"""Shared pieces of every file format: the model base class, field types and JSON(L) I/O.

Files use camelCase keys; Python attributes are snake_case (aliases do the mapping).
Models are frozen and do not coerce types ("1" is not a number).

Unknown fields: our own files (tracks.jsonl, calibration, vocab) reject them (FrozenModel). The
product files shared with the TypeScript app (scan, setup, layout, run, taps, positions, actions;
ProductModel) accept them with a warning on the "dryrun_vision" logger, like the TS validator
does, because that contract keeps growing. The CLI prints those warnings on stderr.
"""

from __future__ import annotations

import itertools
import json
import logging
from collections import Counter
from collections.abc import Callable, Iterable, Sequence
from datetime import datetime
from pathlib import Path
from typing import Annotated, Any

from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, Field, ValidationError
from pydantic.alias_generators import to_camel
from pydantic_core import ErrorDetails

from dryrun_vision.errors import FormatError

FORMAT_VERSION = 1
"""Every Dry Run file format is at version 1."""

TIME_DECIMALS = 3
"""Times are written in seconds with millisecond resolution, like the TypeScript side."""

METRE_DECIMALS = 3
"""Floor coordinates are written to the millimetre (positions.jsonl in the fixtures)."""

log = logging.getLogger("dryrun_vision.formats")


class FrozenModel(BaseModel):
    """Immutable, strict, camelCase-on-disk model."""

    model_config = ConfigDict(
        frozen=True,
        extra="forbid",
        strict=True,
        allow_inf_nan=False,
        alias_generator=to_camel,
        validate_by_name=True,
        validate_by_alias=True,
        serialize_by_alias=True,
    )

    def to_json(self) -> dict[str, Any]:
        """The JSON object as written to disk (camelCase keys, unset optional fields left out)."""
        return self.model_dump(mode="json", by_alias=True, exclude_none=True)


class ProductModel(FrozenModel):
    """A product-file model: unknown fields are kept aside (reported, never written back)."""

    model_config = ConfigDict(extra="allow")

    def to_json(self) -> dict[str, Any]:
        data = super().to_json()
        return {k: v for k, v in data.items() if k not in (self.model_extra or {})}


def _unknown_in(value: object, where: str) -> list[str]:
    if isinstance(value, BaseModel):
        return unknown_fields(value, f"{where}.")
    if isinstance(value, (tuple, list)):
        return [u for i, v in enumerate(value) for u in _unknown_in(v, f"{where}[{i}]")]
    if isinstance(value, dict):
        return [u for k, v in value.items() for u in _unknown_in(v, f"{where}[{k}]")]
    return []


def unknown_fields(model: BaseModel, prefix: str = "") -> list[str]:
    """Paths of the fields the model did not know, e.g. ["workers[0].hatSize"]."""
    out = [f"{prefix}{k}" for k in (model.model_extra or {})]
    for name, info in type(model).model_fields.items():
        out += _unknown_in(getattr(model, name), f"{prefix}{info.alias or name}")
    return out


def _unknown_text(field: str) -> str:
    return f'has unknown field "{field}"; it is ignored (check the spelling)'


def warn_unknown_lines(path_name: str, numbered: Sequence[tuple[int, BaseModel]]) -> None:
    """One warning per unknown field of a .jsonl file: its first line and how many lines have it."""
    first: dict[str, int] = {}
    count: Counter[str] = Counter()
    for no, m in numbered:
        for f in unknown_fields(m):
            first.setdefault(f, no)
            count[f] += 1
    for f, no in first.items():
        lines = f" ({count[f]} lines)" if count[f] > 1 else ""
        log.warning("%s line %d: %s%s", path_name, no, _unknown_text(f), lines)


def _check_iso(text: str) -> str:
    try:
        datetime.fromisoformat(text)
    except ValueError as exc:
        raise ValueError("must be a date and time like 2026-11-13T10:00:00Z") from exc
    return text


IsoDateTime = Annotated[str, AfterValidator(_check_iso)]


def _list_to_tuple(value: object) -> object:
    return tuple(value) if isinstance(value, list) else value


type Items[T] = Annotated[tuple[T, ...], BeforeValidator(_list_to_tuple)]
"""An immutable sequence field. Accepts a JSON array, or a Python list or tuple."""
Seconds = Annotated[float, Field(ge=0)]
"""Seconds since the run (or video) started."""
Metres = Annotated[float, Field(gt=0)]
"""A size in metres; must be more than 0."""
NonEmpty = Annotated[str, Field(min_length=1)]


def _loc_text(loc: tuple[int | str, ...]) -> str:
    out = ""
    for part in loc:
        if isinstance(part, int):
            out += f"[{part}]"
        else:
            out = part if out == "" else f"{out}.{part}"
    return out


def _issue_text(err: ErrorDetails, skip_union_tag: bool) -> str:
    loc = tuple(err["loc"])
    if skip_union_tag and loc:
        loc = loc[1:]  # the first element is the discriminator value, e.g. "pos"
    msg = err["msg"].removeprefix("Value error, ")
    msg = msg[:1].lower() + msg[1:]
    if err["type"] == "extra_forbidden":
        msg = "is not a known field (check the spelling)"
    elif err["type"] == "missing":
        msg = "is missing"
    where = f'field "{_loc_text(loc)}"' if loc else "the line"
    return f"{where} {msg}"


def validation_message(exc: ValidationError, skip_union_tag: bool = False) -> str:
    """The first problem of a pydantic error in plain words."""
    errors = exc.errors()
    first = errors[0]
    if first["type"] == "json_invalid":
        return "is not valid JSON (check for a missing comma, quote or bracket)"
    text = _issue_text(first, skip_union_tag)
    more = len(errors) - 1
    return text if more == 0 else f"{text} (and {more} more problem{'s' if more > 1 else ''})"


def _read_text(path: Path) -> str:
    if not path.is_file():
        raise FormatError(f"{path} does not exist. Check the folder holds {path.name}.")
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise FormatError(f"{path} could not be read: {exc}") from exc


def read_json_model[M: FrozenModel](path: Path, model: type[M]) -> M:
    """One JSON object from `path`, validated as `model`."""
    text = _read_text(path)
    try:
        out = model.model_validate_json(text)
    except ValidationError as exc:
        raise FormatError(f"{path.name}: {validation_message(exc)}") from exc
    for f in unknown_fields(out):
        log.warning("%s: %s", path.name, _unknown_text(f))
    return out


LineParser = Callable[[str], Any]


def read_jsonl_lines(path: Path) -> list[tuple[int, str]]:
    """Non-blank lines of a .jsonl file with their 1-based line numbers. Fails if there are none."""
    text = _read_text(path)
    lines = [(i + 1, line) for i, line in enumerate(text.splitlines()) if line.strip()]
    if not lines:
        raise FormatError(f"{path.name} is empty. Line 1 must be the header.")
    return lines


def parse_jsonl[H: FrozenModel](
    path: Path, header_model: type[H], parse_line: LineParser, tagged_union: bool = True
) -> tuple[H, tuple[tuple[int, Any], ...]]:
    """Header plus (line number, parsed object) for every other line. Errors name file and line."""
    lines = read_jsonl_lines(path)
    first_no, first = lines[0]
    try:
        header = header_model.model_validate_json(first)
    except ValidationError as exc:
        raise FormatError(f"{path.name} line {first_no}: the header {validation_message(exc)}") from exc
    body: list[tuple[int, Any]] = []
    for no, line in lines[1:]:
        try:
            body.append((no, parse_line(line)))
        except ValidationError as exc:
            raise FormatError(f"{path.name} line {no}: {validation_message(exc, tagged_union)}") from exc
    models = [(n, m) for n, m in ((first_no, header), *body) if isinstance(m, BaseModel)]
    warn_unknown_lines(path.name, models)
    return header, tuple(body)


def write_jsonl(path: Path, header: FrozenModel, lines: Iterable[FrozenModel]) -> None:
    """Header then one compact JSON object per line, newline-terminated."""
    out = [json.dumps(header.to_json(), separators=(",", ":"))]
    out.extend(json.dumps(m.to_json(), separators=(",", ":")) for m in lines)
    try:
        path.write_text("\n".join(out) + "\n", encoding="utf-8")
    except OSError as exc:
        raise FormatError(f"{path} could not be written: {exc}") from exc


def check_sorted(
    path_name: str, numbered: Sequence[tuple[int, Any]], key: Callable[[Any], tuple[Any, ...]], what: str
) -> None:
    """Fail on the first line that breaks the required order."""
    for (_, prev), (no, cur) in itertools.pairwise(numbered):
        if key(cur) < key(prev):
            raise FormatError(f"{path_name} line {no}: lines must be sorted by {what}.")


def round_time(t: float) -> float:
    return round(t, TIME_DECIMALS)
