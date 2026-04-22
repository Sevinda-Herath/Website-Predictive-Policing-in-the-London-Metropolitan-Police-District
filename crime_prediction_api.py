from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Final

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, model_validator

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_PATH = BASE_DIR / "crime_data_2024.csv"
MODEL_PATH = BASE_DIR / "random_forest_model.joblib"
MODEL_COMPARISON_GENERIC_PATH = BASE_DIR / "model_comparison_generic.csv"
MODEL_COMPARISON_SPECIFIC_PATH = BASE_DIR / "model_comparison_specific.csv"
HDA_IMAGE_PATH = BASE_DIR / "hda.png"
MPC_IMAGE_PATH = BASE_DIR / "mpc.png"

DEFAULT_ALLOWED_ORIGINS: Final[list[str]] = [
    "https://sevinda-herath.github.io",
    "https://sevinda-herath.is-a.dev",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
]


def parse_allowed_origins() -> list[str]:
    raw = os.getenv("ALLOWED_ORIGINS", "").strip()
    if not raw:
        return DEFAULT_ALLOWED_ORIGINS
    origins = [item.strip() for item in raw.split(",") if item.strip()]
    return origins or DEFAULT_ALLOWED_ORIGINS


ALLOWED_ORIGINS = parse_allowed_origins()

app = FastAPI(
    title="Crime Count Prediction API",
    description=(
        "Predict crime count using a trained Random Forest model by providing "
        "LSOA code or LSOA name with year and month."
    ),
    version="1.2.0",
    docs_url="/docs",
    openapi_url="/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    max_age=600,
)


class PredictRequest(BaseModel):
    lsoa_code: str | None = Field(default=None, description="LSOA code, e.g. E01000001")
    lsoa_name: str | None = Field(default=None, description="LSOA name")
    year: int = Field(..., ge=1900, le=2100)
    month: int = Field(..., ge=1, le=12)

    @model_validator(mode="after")
    def validate_lsoa_input(self) -> "PredictRequest":
        if not self.lsoa_code and not self.lsoa_name:
            raise ValueError("Provide either lsoa_code or lsoa_name.")
        return self


class HotspotsRequest(BaseModel):
    year: int = Field(..., ge=1900, le=2100)
    month: int = Field(..., ge=1, le=12)
    top_x: int = Field(default=10, ge=1, le=500)


# Cache data and model at startup.
_df: pd.DataFrame | None = None
_model: Any = None
_features_used: list[str] = []
_target_name: str = "Crime_Count"


def require_file(path: Path, label: str) -> None:
    if not path.exists():
        raise RuntimeError(f"{label} not found: {path}")


def load_assets() -> None:
    global _df, _model, _features_used, _target_name

    require_file(DATA_PATH, "Data file")
    require_file(MODEL_PATH, "Model file")

    df = pd.read_csv(DATA_PATH)

    required_columns = {"Year", "Month", "LSOA_Code", "LSOA_Name"}
    missing_required = sorted(required_columns - set(df.columns))
    if missing_required:
        raise RuntimeError(f"Missing required columns in CSV: {missing_required}")

    # Normalize key columns for matching stability.
    df["LSOA_Code"] = df["LSOA_Code"].astype(str).str.strip()
    df["LSOA_Name"] = df["LSOA_Name"].astype(str).str.strip()
    df["Year"] = pd.to_numeric(df["Year"], errors="coerce").astype("Int64")
    df["Month"] = pd.to_numeric(df["Month"], errors="coerce").astype("Int64")

    model_package = joblib.load(MODEL_PATH)
    if not isinstance(model_package, dict) or "model" not in model_package:
        raise RuntimeError("Model artifact format is invalid. Expected dict with key 'model'.")

    model = model_package["model"]
    features_used = list(model_package.get("features_used", []))
    target_name = str(model_package.get("target", "Crime_Count"))

    if not features_used:
        raise RuntimeError("No feature list found in model artifact.")

    missing_features = [feature for feature in features_used if feature not in df.columns]
    if missing_features:
        raise RuntimeError(f"Missing required feature columns in CSV: {missing_features}")

    _df = df
    _model = model
    _features_used = features_used
    _target_name = target_name


@app.on_event("startup")
def on_startup() -> None:
    load_assets()


def ensure_loaded() -> None:
    if _df is None or _model is None or not _features_used:
        load_assets()


def lookup_row(lsoa_code: str | None, lsoa_name: str | None, year: int, month: int) -> pd.Series:
    assert _df is not None

    filt = (_df["Year"] == year) & (_df["Month"] == month)

    if lsoa_code:
        code = lsoa_code.strip().lower()
        filt = filt & (_df["LSOA_Code"].str.lower() == code)
    elif lsoa_name:
        name = lsoa_name.strip().lower()
        filt = filt & (_df["LSOA_Name"].str.lower() == name)

    matches = _df.loc[filt]
    if matches.empty:
        raise HTTPException(
            status_code=404,
            detail=(
                "No matching row found in CSV for the provided LSOA and date. "
                "Check LSOA code/name, year, and month."
            ),
        )

    # Keep deterministic behavior if duplicates exist.
    return matches.iloc[0]


def lookup_rows_for_lsoa(lsoa_code: str | None, lsoa_name: str | None) -> pd.DataFrame:
    assert _df is not None

    if not lsoa_code and not lsoa_name:
        raise HTTPException(status_code=400, detail="Provide either lsoa_code or lsoa_name.")

    filt = pd.Series(True, index=_df.index, dtype=bool)

    if lsoa_code:
        code = lsoa_code.strip().lower()
        filt = filt & (_df["LSOA_Code"].str.lower() == code)

    if lsoa_name:
        name = lsoa_name.strip().lower()
        filt = filt & (_df["LSOA_Name"].str.lower() == name)

    matches = _df.loc[filt]
    if matches.empty:
        raise HTTPException(
            status_code=404,
            detail="No matching LSOA found for the provided code/name.",
        )

    return matches


def build_feature_frame(rows: pd.DataFrame) -> pd.DataFrame:
    feature_frame = rows[_features_used].apply(pd.to_numeric, errors="coerce")
    if feature_frame.isnull().any().any():
        bad_columns = feature_frame.columns[feature_frame.isnull().any()].tolist()
        raise HTTPException(
            status_code=500,
            detail=f"Feature values contain non-numeric or missing values: {bad_columns}",
        )
    return feature_frame.astype(float)


def predict_from_rows(rows: pd.DataFrame) -> np.ndarray:
    assert _model is not None
    features = build_feature_frame(rows)
    preds = _model.predict(features)
    return np.clip(np.asarray(preds, dtype=float), 0, None)


def read_csv_rows(path: Path, friendly_name: str) -> list[dict[str, Any]]:
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"{friendly_name} not found.")
    data = pd.read_csv(path)
    return data.to_dict(orient="records")


@app.get("/")
def root() -> dict[str, Any]:
    return {
        "message": "Crime Count Prediction API is running.",
        "swagger_docs": "/docs",
        "openapi_schema": "/openapi.json",
        "health": "/healthz",
        "lsoa_availability": "/lsoa/availability?lsoa_code=E01000001",
        "model_comparison_generic": "/model-comparison/generic",
        "model_comparison_specific": "/model-comparison/specific",
        "image_hda": "/images/hda",
        "image_mpc": "/images/mpc",
        "cors_allowed_origins": ALLOWED_ORIGINS,
    }


@app.get("/healthz")
def healthz() -> dict[str, Any]:
    ensure_loaded()
    assert _df is not None
    return {
        "status": "ok",
        "rows_loaded": int(len(_df)),
        "features_used_count": int(len(_features_used)),
        "target": _target_name,
    }


@app.get("/lsoa/availability")
def get_lsoa_availability(
    lsoa_code: str | None = None,
    lsoa_name: str | None = None,
) -> dict[str, Any]:
    ensure_loaded()

    normalized_code = lsoa_code.strip() if isinstance(lsoa_code, str) else None
    normalized_name = lsoa_name.strip() if isinstance(lsoa_name, str) else None
    matches = lookup_rows_for_lsoa(normalized_code, normalized_name)

    if normalized_name and not normalized_code:
        unique_codes = sorted(
            {
                str(code).strip()
                for code in matches["LSOA_Code"].tolist()
                if str(code).strip()
            }
        )
        if len(unique_codes) > 1:
            raise HTTPException(
                status_code=400,
                detail="Multiple LSOA codes found for this LSOA name. Provide lsoa_code as well.",
            )

    availability = matches[["Year", "Month"]].copy()
    availability["Year"] = pd.to_numeric(availability["Year"], errors="coerce")
    availability["Month"] = pd.to_numeric(availability["Month"], errors="coerce")
    availability = availability.dropna(subset=["Year", "Month"])

    if availability.empty:
        raise HTTPException(
            status_code=404,
            detail="No year/month availability found for the selected LSOA.",
        )

    availability["Year"] = availability["Year"].astype(int)
    availability["Month"] = availability["Month"].astype(int)

    years = sorted(availability["Year"].unique().tolist())
    months_by_year = {
        str(year): sorted(
            availability.loc[availability["Year"] == year, "Month"].unique().tolist()
        )
        for year in years
    }

    representative = matches.iloc[0]

    return {
        "lsoa_code": str(representative["LSOA_Code"]),
        "lsoa_name": str(representative["LSOA_Name"]),
        "years": years,
        "months_by_year": months_by_year,
    }


@app.get("/model-comparison/generic")
def get_model_comparison_generic() -> dict[str, Any]:
    return {"rows": read_csv_rows(MODEL_COMPARISON_GENERIC_PATH, "model_comparison_generic.csv")}


@app.get("/model-comparison/specific")
def get_model_comparison_specific() -> dict[str, Any]:
    return {"rows": read_csv_rows(MODEL_COMPARISON_SPECIFIC_PATH, "model_comparison_specific.csv")}


@app.get("/model-comparison/generic/download")
def download_model_comparison_generic() -> FileResponse:
    if not MODEL_COMPARISON_GENERIC_PATH.exists():
        raise HTTPException(status_code=404, detail="model_comparison_generic.csv not found.")
    return FileResponse(
        path=MODEL_COMPARISON_GENERIC_PATH,
        media_type="text/csv",
        filename="model_comparison_generic.csv",
    )


@app.get("/model-comparison/specific/download")
def download_model_comparison_specific() -> FileResponse:
    if not MODEL_COMPARISON_SPECIFIC_PATH.exists():
        raise HTTPException(status_code=404, detail="model_comparison_specific.csv not found.")
    return FileResponse(
        path=MODEL_COMPARISON_SPECIFIC_PATH,
        media_type="text/csv",
        filename="model_comparison_specific.csv",
    )


@app.get("/images/hda")
def get_hda_image() -> FileResponse:
    if not HDA_IMAGE_PATH.exists():
        raise HTTPException(status_code=404, detail="hda.png not found.")
    return FileResponse(path=HDA_IMAGE_PATH, media_type="image/png", filename="hda.png")


@app.get("/images/mpc")
def get_mpc_image() -> FileResponse:
    if not MPC_IMAGE_PATH.exists():
        raise HTTPException(status_code=404, detail="mpc.png not found.")
    return FileResponse(path=MPC_IMAGE_PATH, media_type="image/png", filename="mpc.png")


@app.post("/predict")
def predict_crime_count(payload: PredictRequest) -> dict[str, Any]:
    ensure_loaded()
    row = lookup_row(payload.lsoa_code, payload.lsoa_name, payload.year, payload.month)

    preds = predict_from_rows(pd.DataFrame([row]))
    pred_value = float(np.round(preds[0], 4))

    return {
        "lsoa_code": str(row["LSOA_Code"]),
        "lsoa_name": str(row["LSOA_Name"]),
        "year": int(row["Year"]),
        "month": int(row["Month"]),
        "predicted_crime_count": pred_value,
        "target": _target_name,
    }


@app.post("/hotspots/top")
def top_hotspots(payload: HotspotsRequest) -> dict[str, Any]:
    ensure_loaded()
    assert _df is not None

    subset = _df[(_df["Year"] == payload.year) & (_df["Month"] == payload.month)].copy()
    if subset.empty:
        raise HTTPException(
            status_code=404,
            detail="No rows found for the given year and month.",
        )

    preds = predict_from_rows(subset)
    subset["predicted_crime_count"] = np.round(preds, 4)

    top = (
        subset[["LSOA_Code", "LSOA_Name", "predicted_crime_count"]]
        .sort_values("predicted_crime_count", ascending=False)
        .head(payload.top_x)
    )

    hotspots = [
        {
            "rank": idx + 1,
            "lsoa_code": str(row["LSOA_Code"]),
            "lsoa_name": str(row["LSOA_Name"]),
            "predicted_crime_count": float(row["predicted_crime_count"]),
        }
        for idx, (_, row) in enumerate(top.iterrows())
    ]

    return {
        "year": payload.year,
        "month": payload.month,
        "top_x": payload.top_x,
        "hotspots": hotspots,
    }
