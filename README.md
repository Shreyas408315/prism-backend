# PRism Backend

PRism Backend is the Node.js orchestration layer for the PRism code-review intelligence pipeline. It validates raw findings, builds the exact 22-feature contract expected by the Python origin-classification model, calls the deployed ML service, and returns an enriched review result without crashing the PR pipeline when the model is unavailable.

## Architecture

The overall deployment model is intentionally split:

- Python ML service: PRism origin model, responsible only for inference.
- Node.js backend: PRism orchestration/API layer, responsible for validation, feature assembly, request/response shaping, and review-level orchestration.

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

backend -> HTTP -> ML service -> prism_ensemble_clean.joblib

## Docker Compose

The repository includes a docker-compose.yml file that brings up:

- an ML service container using the existing origin-model artifact
- a Node backend container that connects over the private service URL
- a PostgreSQL 16 container for local persistence

Run:

```bash
docker compose up -d --wait postgres
npm run db:migrate
docker compose up --build
```

Set `DATABASE_URL` in `.env` for local migration commands. Compose configures the backend container to use the private PostgreSQL service; production deployments must provide their own `DATABASE_URL` and should not expose PostgreSQL publicly.

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

Accepts a single finding payload, builds the exact 22 ML features, calls the model, and returns the validated ML response.

### POST /api/ml/predict/batch

Accepts an array of findings and calls the model batch endpoint.

### POST /api/review/evaluate

Applies the orchestration process:

1. Validate request shape.
2. Convert raw findings into the exact 22-feature contract.
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

The Python service expects exactly these 22 fields in order:

1. rule_id
2. rule_family
3. severity
4. is_error
5. message_length
6. has_fix
7. fix_text_length
8. fix_range_length
9. has_suggestions
10. suggestion_count
11. changed_line_count
12. file_size_lines
13. start_line
14. finding_start_line_ratio
15. finding_span_lines
16. finding_span_columns
17. pr_change_code_lines
18. pr_total_findings_in_file
19. same_rule_findings_in_file
20. same_rule_findings_in_repo
21. finding_overlaps_change
22. finding_change_distance

The backend uses a strict Zod schema to validate all ML payloads and rejects any contract drift.

## Fallback behavior

When the model is unavailable, the backend never crashes the review flow. Instead:

- if finding_overlaps_change is true or equivalent, the origin decision is INTRODUCED
- otherwise it is PRE_EXISTING
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
