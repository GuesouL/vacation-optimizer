"""Write the API's OpenAPI schema to frontend/openapi.json.

The front end generates its TypeScript types from that file, so the two sides
share one contract. CI regenerates it and fails if the committed copy is stale.
"""

import json
from pathlib import Path

from vacation_optimizer.api import app

target = Path(__file__).resolve().parents[2] / "frontend" / "openapi.json"
target.write_text(json.dumps(app.openapi(), indent=2) + "\n")
print(f"wrote {target}")
