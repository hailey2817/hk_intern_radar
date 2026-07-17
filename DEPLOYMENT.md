# Public deployment

The application is configured for Render using `render.yaml`.

## Deploy

1. Push this directory to a GitHub repository.
2. In Render, create a new Blueprint and select the repository.
3. Render reads `render.yaml`, creates the Python web service, provisions a persistent disk at `/var/data`, and generates `RESEARCH_SYNC_TOKEN`.
4. After deployment, open the Render service URL and verify `/api/health` returns `status: ok`.

The `starter` plan is used because Render persistent disks are not available on the free web-service plan. Change the plan only if the replacement supports persistent storage.

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
