import os
import re

import polars as pl
import argparse
from datetime import datetime
from decimal import Decimal


def read_csv(file_path: str) -> pl.DataFrame:
    df = pl.read_csv(file_path, separator=";")
    df = df.rename(lambda col: col.lower().replace(" ", "_"))
    return df


def process_data(data_frame: pl.DataFrame, fund_name: str) -> pl.DataFrame:
    processed_data = (
        data_frame.lazy()
        .unpivot(index=["fecha_fiscal"], on=["inversión", "resultado_fiscal"])
        .with_columns(
            (pl.col("variable").cast(pl.Utf8) + " Fund : " + fund_name).alias(
                "variable"
            )
        )
    )

    return processed_data.collect()


def save_to_csv(df: pl.DataFrame, output_path: str):
    df.write_csv(output_path, separator=";")


def get_fund_from_filename(filename: str) -> str:
    base_name = os.path.basename(filename)
    match = re.search(r"fondo\s+(.+)\.csv", base_name)
    return match.group(1) if match else os.path.splitext(base_name)[0]


def set_output_file_name(input_file: str) -> str:
    base_name = os.path.basename(input_file)
    return os.path.splitext(base_name)[0] + "_processed.csv"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Process CSV data")
    parser.add_argument("input_file", nargs="+", help="Path(s) to input CSV files")
    parser.add_argument(
        "--combine", action="store_true", help="Combine already processed CSV files"
    )
    parser.add_argument("-o", "--output", help="Combined output CSV path")
    args = parser.parse_args()

    if args.combine:
        frames = []
        for path in args.input_file:
            frame = pl.read_csv(path, separator=";", infer_schema=False)
            if frame.columns != ["fecha_fiscal", "variable", "value"]:
                parser.error(f"{path}: expected a processed CSV with fecha_fiscal;variable;value")
            for row in frame.iter_rows(named=True):
                datetime.strptime(row["fecha_fiscal"], "%d/%m/%Y")
                # Validate amounts while preserving the original decimal-comma format.
                amount = Decimal(row["value"].replace(",", "."))
                if not amount.is_finite():
                    parser.error(f"{path}: invalid amount {row['value']!r}")
            frames.append(frame)
        combined = pl.concat(frames).with_columns(
            pl.col("fecha_fiscal").str.strptime(pl.Date, "%d/%m/%Y").alias("_date")
        ).sort("_date", maintain_order=True).drop("_date")
        save_to_csv(combined, args.output or "complete_processed.csv")
    else:
        if args.output and len(args.input_file) != 1:
            parser.error("--output requires one input file unless --combine is used")
        for input_file in args.input_file:
            output_file = args.output or set_output_file_name(input_file)
            fund_code = get_fund_from_filename(input_file)

            df = read_csv(input_file)
            processed_df = process_data(df, fund_code)
            save_to_csv(processed_df, output_file)
