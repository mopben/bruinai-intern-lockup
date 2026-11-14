import pytest

from dryrun_vision.labels.evaluation.metrics import (
    Run,
    boundary_errors,
    confusion,
    correct_and_total,
    edit_score,
    f1,
    f1_counts,
    runs_of,
)

GT = ["S", "a", "a", "a", "b", "b", "S"]


def test_runs_of():
    assert runs_of(["a", "a", None, "b"]) == (Run("a", 0, 2), Run(None, 2, 3), Run("b", 3, 4))


def test_accuracy_counts_unlabelled_as_wrong_and_can_ignore_background():
    pred = ["S", "a", None, "a", "a", "b", "b"]
    assert correct_and_total(GT, pred) == (4, 7)
    assert correct_and_total(GT, pred, ignore="S") == (3, 5)
    with pytest.raises(ValueError, match="frames"):
        correct_and_total(GT, pred[:-1])


def test_confusion_has_a_no_label_column():
    pred = ["S", "a", None, "b", "b", "b", "S"]
    m = confusion(GT, pred, ["S", "a", "b"])
    assert m == ((2, 0, 0, 0), (0, 1, 1, 1), (0, 0, 2, 0))


def test_edit_score():
    assert edit_score(GT, GT, ignore="S") == 100.0
    assert edit_score(GT, ["S", "b", "b", "b", "b", "b", "S"], ignore="S") == 50.0
    assert edit_score(["S"], ["S"], ignore="S") == 100.0
    assert edit_score(GT, ["S", "a", "b", "a", "b", "a", "S"], ignore="S") == pytest.approx(40.0)


def test_f1_at_half_overlap():
    pred = ["S", "S", "a", "a", "b", "b", "b"]  # a IoU 2/3, b IoU 2/3
    assert f1_counts(GT, pred, 0.5, ignore="S") == (2, 0, 0)
    assert f1_counts(GT, pred, 0.75, ignore="S") == (0, 2, 2)
    assert f1(2, 0, 0) == 100.0 and f1(0, 0, 0) == 0.0
    dup = ["S", "a", "a", "b", "a", "a", "S"]
    tp, fp, fn = f1_counts(GT, dup, 0.5, ignore="S")
    assert (tp, fp, fn) == (1, 2, 1)


def test_boundary_errors_for_found_segments():
    pred = ["S", "S", "a", "a", "b", "b", "b"]
    errs = boundary_errors(GT, pred, fps=2.0, ignore="S")
    assert errs == ((0.5, 0.0), (0.0, 0.5))
    assert boundary_errors(GT, ["S"] * 7, fps=2.0, ignore="S") == ()
