# AI-repo

Exploratory data analysis for the AI Skin Health project. The script analyzes the
HAM10000 skin-lesion metadata and Sephora product/review data, then saves charts
under `charts/`.

## Project structure

```text
AI-repo/
├── .git/
├── .venv/
├── dataset/
├── charts/
├── eda.py
├── .gitignore
├── LICENSE
└── README.md
```

The local dataset and chart files are ignored by Git. Keep the downloaded CSV
files in these locations:

```text
dataset/
├── Skin Cancer MNIST HAM10000/
│   └── HAM10000_metadata.csv
└── Sephora Products and Skincare Reviews/
    ├── product_info.csv
    └── reviews_0-250.csv
```

If a data file uses a different location or filename, update its path in the
configuration section near the top of `eda.py`.

## Setup and run (Windows PowerShell)

From the repository directory, create a virtual environment and install the
analysis dependencies:

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install pandas numpy matplotlib seaborn
```

Place the dataset CSVs at the paths above, then run:

```powershell
.\.venv\Scripts\python.exe eda.py
```

The script prints dataset checks and analysis findings to the terminal and saves
generated plots in `charts/`.
