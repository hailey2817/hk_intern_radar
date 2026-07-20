# Public deployment

The application is configured for Render using `render.yaml`.

## Deploy

1. Push this directory to a GitHub repository.
2. In Render, create a new Blueprint and select the repository.
3. Render reads `render.yaml`, creates the Python web service, and generates `RESEARCH_SYNC_TOKEN`.
4. After deployment, open the Render service URL and verify `/api/health` returns `status: ok`.

The default Blueprint uses Render's free web-service plan. Runtime research imports are stored in the service's ephemeral filesystem and can be lost when the service is recreated or restarted. Upgrade the service and attach a persistent disk when durable hosted history is required.

## Research synchronization

The hosted app accepts researched data at `POST /api/research/import` with the generated token in the `X-Research-Token` header. The request body must contain:

```json
{
  "research": {
    "generatedAt": "ISO timestamp",
    "cycle": "Winter 2026-27 and Summer 2027",
    "summary": {},
    "opportunities": [],
    "watchlist": [],
    "changes": []
  },
  "status": {
    "status": "complete",
    "completedAt": "ISO timestamp",
    "message": "Research completed"
  }
}
```

Do not commit the generated synchronization token.
