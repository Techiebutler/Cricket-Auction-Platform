#!/bin/bash
# Generate a new migration after changing a model.
# Usage: ./scripts/migrate.sh "describe your change"
# Example: ./scripts/migrate.sh "add player bio field"
set -e

MSG=${1:-"auto"}
echo "Generating migration: $MSG"
docker compose exec backend alembic revision --autogenerate -m "$MSG"
echo ""
echo "Done! Migration file created in backend/alembic/versions/"
echo "It will be applied automatically on next 'docker compose up'."
