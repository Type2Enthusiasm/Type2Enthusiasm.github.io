#!/bin/bash
cd "$(dirname "$0")"
git pull
python3 build.py
