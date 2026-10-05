# PRism Backend

PRism Backend is the Node.js orchestration layer for the PRism code-review intelligence pipeline. It validates pre-engineered 43-field ESLint findings, calls the deployed surface-classification model, and returns an enriched review result without crashing the PR pipeline when the model is unavailable.

## Architecture

The overall deployment model is intentionally split:

- Python ML service: ESLint surface hybrid model, responsible only for inference.
- Node.js backend: PRism orchestration/API layer, responsible for validating engineered feature rows, request/response shaping, and review-level orchestration.

The backend talks to the ML service over HTTP using the environment-configured URL:

- Local development: http://localhost:8000
- Render private network: http://prism-origin-model:8000

## Local setup

1. Install dependencies:
   npm install
2. Start the Python ML service locally (from the separate prism-origin-model-service project).
3. Start the backend:
   npm run dev
4. Test the app:
   npm test
5. Build the production bundle:
   npm run build
6. Run the compiled server:
   npm start

## Environment variables

Use the .env file or .env.example as the source of truth. Required values:

- PORT=3000
- ML_SERVICE_URL=http://localhost:8000
- ML_SERVICE_TIMEOUT_MS=4000

For future cloud deployment, the private network URL should be:

- ML_SERVICE_URL=http://prism-origin-model:8000

The backend must never hardcode the model URL into application logic.

## Local ML integration

The backend expects the deployed Python service to expose:

- GET /health
- GET /model-info
- POST /predict
- POST /predict/batch

The Node server calls:

- POST ${ML_SERVICE_URL}/predict
- POST ${ML_SERVICE_URL}/predict/batch

The ML service does not run inside the Node container. The architecture remains:

backend -> HTTP -> ML service -> eslint_surface_hybrid_ensemble.joblib

## Docker Compose

The repository includes a docker-compose.yml file that brings up:

- an ML service container using the surface hybrid artifact
- a Node backend container that connects over the private service URL
- a PostgreSQL 16 container for local persistence

Run:

```bash
docker compose up -d --wait postgres
npm run db:migrate
docker compose up --build
```

Set `DATABASE_URL` in `.env` for local migration commands. Compose configures the backend container to use the private PostgreSQL service; production deployments must provide their own `DATABASE_URL` and should not expose PostgreSQL publicly.
Run `npm run db:migrate` against the production database before deploying the backend update; migration `002_surface_model.sql` adds surface/suppression summary counts without rewriting legacy review history.

Then verify:

- http://localhost:3000/health
- POST http://localhost:3000/api/ml/predict

## API endpoints

### GET /health

Returns:

```json
{
  "status": "ok",
  "service": "prism-backend"
}
```

### POST /api/ml/predict

Accepts one already-engineered 43-field finding (the same shape as the model service request), calls the model, and returns component probabilities, ensemble surface probability, threshold, and `surface`/`suppress` decision.

### POST /api/ml/predict/batch

Accepts an array of findings and calls the model batch endpoint.

### POST /api/review/evaluate

Applies the orchestration process:

1. Validate request shape.
2. Validate each pre-engineered 43-feature row.
3. Call the ML service.
4. Return enriched review findings.
5. Fall back deterministically if the model is unavailable.

## Render deployment plan

This backend is prepared for a two-service deployment architecture:

- prism-backend on Render
- prism-origin-model on Render private network

The backend environment should set:

```env
ML_SERVICE_URL=http://prism-origin-model:8000
```

The model stays private and is not deployed inside the Node container.

## ML service contract

The model service accepts the exact 43 fields supplied in the prediction request. The backend applies a strict Zod schema and rejects contract drift. For `/api/review/evaluate`, each array entry wraps the model row as `{ "features": { ...43 fields... }, "finding_id": "...", "file_path": "..." }`; `finding_id` is optional and `file_path` is required for review metadata. The service median-imputes twelve additional artifact features; see the model service schema for details.

## Fallback behavior

When the model is unavailable, the backend never crashes the review flow. Instead:

- if `finding_overlaps_change` is 1, the fallback decision is `surface`
- otherwise it is `suppress`
- decision_source is deterministic_fallback
- ml_status is UNAVAILABLE or ERROR
- the backend still returns a review object with a UUID-based review_id

When the model succeeds, the response uses:

- decision_source: MODEL
- ml_status: OK

## Scripts

```bash
npm install
npm run dev
npm test
npm run build
npm run db:migrate
npm start
```

## Security and observability

The first backend intentionally stays simple and safe:

- no auth required yet
- no secrets committed
- no source code logged
- no full payload logging
- request bodies are validated and limited
- errors are surfaced without exposing internal stack traces

Logging is intentionally limited to the operational metadata the service needs for review and debugging.
