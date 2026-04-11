import os
import re

import polars as pl
import argparse


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
    parser.add_argument("input_file", help="Path to the input CSV file")
    args = parser.parse_args()

    output_file = set_output_file_name(args.input_file)
    fund_code = get_fund_from_filename(args.input_file)

    df = read_csv(args.input_file)
    processed_df = process_data(df, fund_code)
    save_to_csv(processed_df, output_file)
