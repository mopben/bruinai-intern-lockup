"""The label vocabulary: which labels a worker at a station may get, and how to describe them.

    {"format": "dryrun.vocab", "version": 1,
     "templates": ["a photo of a barista {}."],
     "waitingLabel": "waiting",
     "stations": [{"match": ["espresso"], "labels": [{"label": "pulling a shot",
                                                       "prompts": ["pulling an espresso shot"]}, ...]}],
     "defaultStation": {"labels": [...]},
     "idle": {"labels": [...]}}

A `work` segment's station picks the first `stations` entry with a `match` text inside the
station's name (case ignored), else `defaultStation`. `idle` segments use `idle`. Every label set
must contain the waiting label. Each prompt is put into every template ("{}" marks the slot).
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from importlib.resources import files
from pathlib import Path
from typing import Literal, Self

from pydantic import Field, field_validator, model_validator

from dryrun_vision.formats.base import FrozenModel, Items, NonEmpty, read_json_model

_SLOT = "{}"


class LabelDef(FrozenModel):
    label: NonEmpty
    prompts: Items[NonEmpty] = Field(min_length=1)
    """Descriptions of the action, e.g. "steaming milk in a metal jug"."""


class LabelSet(FrozenModel):
    match: Items[NonEmpty] = ()
    labels: Items[LabelDef] = Field(min_length=2)

    @model_validator(mode="after")
    def _unique(self) -> Self:
        twice = [name for name, n in Counter(d.label for d in self.labels).items() if n > 1]
        if twice:
            raise ValueError(f'label "{twice[0]}" appears twice in one label set')
        return self


class Vocabulary(FrozenModel):
    format: Literal["dryrun.vocab"]
    version: Literal[1]
    templates: Items[NonEmpty] = Field(min_length=1)
    waiting_label: NonEmpty
    stations: Items[LabelSet] = ()
    default_station: LabelSet
    idle: LabelSet

    @field_validator("templates")
    @classmethod
    def _slots(cls, templates: tuple[str, ...]) -> tuple[str, ...]:
        bad = [t for t in templates if t.count(_SLOT) != 1]
        if bad:
            raise ValueError(f'template "{bad[0]}" must contain "{{}}" exactly once (where the prompt goes)')
        return templates

    @model_validator(mode="after")
    def _check(self) -> Self:
        for i, s in enumerate(self.stations):
            if not s.match:
                raise ValueError(f"stations[{i}] needs at least one text in match")
        named = [(f"stations[{i}]", s) for i, s in enumerate(self.stations)]
        for where, s in [*named, ("defaultStation", self.default_station), ("idle", self.idle)]:
            if self.waiting_label not in {d.label for d in s.labels}:
                raise ValueError(f'{where} has no "{self.waiting_label}" label (the waiting label)')
        return self


@dataclass(frozen=True)
class Candidate:
    """One label a provider chooses from: its name, its raw prompts and the templated texts."""

    label: str
    prompts: tuple[str, ...]
    texts: tuple[str, ...]


def read_vocab(path: Path) -> Vocabulary:
    return read_json_model(path, Vocabulary)


def station_label_set(vocab: Vocabulary, station_name: str) -> LabelSet:
    name = station_name.casefold()
    found = (s for s in vocab.stations if any(m.casefold() in name for m in s.match))
    return next(found, vocab.default_station)


def idle_label_set(vocab: Vocabulary) -> LabelSet:
    return vocab.idle


def candidates_of(vocab: Vocabulary, label_set: LabelSet) -> tuple[Candidate, ...]:
    return tuple(
        Candidate(
            label=d.label,
            prompts=d.prompts,
            texts=tuple(t.replace(_SLOT, p) for p in d.prompts for t in vocab.templates),
        )
        for d in label_set.labels
    )


def bundled_vocab(name: str) -> Path:
    """A vocabulary shipped inside the package (labels/vocabularies/<name>.json)."""
    return Path(str(files("dryrun_vision.labels") / "vocabularies" / f"{name}.json"))
