# HK Internship Radar

Public dashboard and research-agent data feed for Hong Kong winter 2026-27 and summer 2027 internships.

## Features

- Available and officially announced upcoming internships
- Consulting, investment banking and finance, supply chain, and general business filters
- Expanded employer watchlist covering global banks, Chinese securities firms, boutiques, asset managers, trading firms, and specialist consultancies
- Application pipeline, priority, notes, deadlines, requirements, documents, and official links
- Scheduled research results and on-demand refresh queue
- Secure API for publishing research-agent updates to the hosted app

## Local development

```bash
python3 -m pip install -r requirements.txt
python3 server.py
```

Open `http://127.0.0.1:8080`.

## Render deployment

The repository includes `render.yaml`. Create a Render Blueprint from this repository to provision the web service, persistent disk, health check, and research synchronization secret.

See `DEPLOYMENT.md` for synchronization details.
