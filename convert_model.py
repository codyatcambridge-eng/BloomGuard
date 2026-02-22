#!/usr/bin/env python3
"""
convert_model.py
---------------
Helper script that converts an existing TensorFlow.js model (model.json + weight shards)
into a Core ML `.mlmodel` bundle named LoverboyNSFW.mlmodel.

Prerequisites:
  pip install coremltools tensorflow tensorflowjs
  npm install -g @tensorflow/tfjs-converter  # exposes `tensorflowjs_converter`

Usage:
  python convert_model.py --model-json path/to/model.json --output ios/App/App/LoverboyNSFW.mlmodel
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path

import coremltools as ct
import tensorflow as tf


def run_tfjs_converter(input_json: Path, h5_path: Path) -> None:
    try:
        subprocess.run(
            [
                "tensorflowjs_converter",
                "--input_format",
                "tfjs_layers_model",
                "--output_format",
                "keras",
                str(input_json),
                str(h5_path),
            ],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except subprocess.CalledProcessError as err:
        print("TensorFlow.js conversion failed:", err.stderr.decode().strip(), file=sys.stderr)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert a TensorFlow.js model to Core ML.")
    parser.add_argument(
        "--model-json",
        type=Path,
        required=True,
        help="tfjs model.json file that describes your architecture and shards.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("LoverboyNSFW.mlmodel"),
        help="Destination Core ML model file (default LoverboyNSFW.mlmodel).",
    )
    parser.add_argument(
        "--input-name",
        type=str,
        default="input",
        help="Name of the Core ML image input (defaults to the first Keras input name).",
    )
    parser.add_argument(
        "--width",
        type=int,
        default=None,
        help="Override the expected input width (default uses the Keras model shape).",
    )
    parser.add_argument(
        "--height",
        type=int,
        default=None,
        help="Override the expected input height (default uses the Keras model shape).",
    )

    args = parser.parse_args()

    if not args.model_json.exists():
        raise FileNotFoundError(f"Model descriptor not found: {args.model_json}")

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_h5 = Path(tmpdir) / "tfjs_model.h5"
        run_tfjs_converter(args.model_json, tmp_h5)
        print(f"TensorFlow.js model converted to Keras H5 at {tmp_h5}")

        keras_model = tf.keras.models.load_model(str(tmp_h5))
        input_shape = keras_model.input_shape
        if isinstance(input_shape, list):
            input_shape = input_shape[0]

        height = args.height or (input_shape[1] if len(input_shape) > 2 else 224)
        width = args.width or (input_shape[2] if len(input_shape) > 2 else 224)
        bias = [0, 0, 0]
        scale = 1 / 255.0

        image_input = ct.ImageType(
            name=args.input_name,
            shape=(1, height, width, 3),
            scale=scale,
            bias=bias,
        )

        mlmodel = ct.convert(keras_model, inputs=[image_input])
        args.output.parent.mkdir(parents=True, exist_ok=True)
        mlmodel.save(str(args.output))
        print(f"Core ML model saved to {args.output}")


if __name__ == "__main__":
    main()
